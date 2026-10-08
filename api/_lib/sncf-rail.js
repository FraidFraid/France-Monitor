// api/_lib/sncf-rail.js : perturbations ferroviaires du jour, API SNCF (Navitia, clé SNCF_API_KEY), agrégées
// par axe grandes lignes et par région TER (spec 2026-10-03 panneaux trafic § 2.4).
// Axe : gare terminale (premier ou dernier arrêt) ; région TER : région du premier arrêt (point dans les
// polygones de public/data/regions.geojson). Effets mappés exactement ; « en cours » et « à venir » séparés ;
// retard = plus grand écart entre horaires de base et horaires modifiés d'un arrêt.
import { regionAt } from './geo-fr.js';
import { parisDay, parisLocalToIso } from './paris-time.js';
import { fetchStrictJson } from './source-http.js';

export const SNCF_BASE = 'https://api.sncf.com/v1/coverage/sncf';
const PAGE_SIZE = 1000;
const MAX_PAGES = 2;
const MAX_TRIP_LOOKUPS = 40;
const TRIP_CONCURRENCY = 4;
const TRIP_FAILURE_MEMO_MS = 30 * 60_000;
const TRIP_DEADLINE_MS = 25_000;
const TRIP_CACHE_MS = 6 * 3_600_000;
export const TOP_DELAYS = 10;

export const AXIS_LABELS = {
  'sud-est': 'Sud-Est (Paris Gare de Lyon)',
  atlantique: 'Atlantique (Paris Montparnasse)',
  nord: 'Nord (Paris Nord)',
  est: 'Est (Paris Est)',
  'intercites-bercy': 'Intercités (Paris Bercy)',
  normandie: 'Normandie (Paris Saint-Lazare)',
  province: 'Province, transversales',
};
const AXIS_ORDER = ['sud-est', 'atlantique', 'nord', 'est', 'intercites-bercy', 'normandie', 'province'];
/** Gares terminales parisiennes (nom normalisé : minuscules, sans accents ni ponctuation). */
const AXIS_STATIONS = [
  ['paris gare de lyon', 'sud-est'], ['paris montparnasse', 'atlantique'], ['paris nord', 'nord'], ['paris est', 'est'],
  ['paris bercy', 'intercites-bercy'], ['paris saint lazare', 'normandie'],
];

/** Effets SNCF (`severity.effect`) → effets du contrat ; tout autre effet est ignoré. */
export const EFFECTS = {
  SIGNIFICANT_DELAYS: 'retard',
  NO_SERVICE: 'supprime',
  REDUCED_SERVICE: 'service-reduit',
  DETOUR: 'detour',
  MODIFIED_SERVICE: 'modifie',
  ADDITIONAL_SERVICE: 'ajoute',
};

/** En-tête d'authentification (clé en nom d'utilisateur, mot de passe vide) ; null sans clé. */
export function sncfAuth() {
  const key = (process.env.SNCF_API_KEY ?? '').trim();
  return key ? `Basic ${Buffer.from(`${key}:`).toString('base64')}` : null;
}

/** Perturbations du jour (heure de Paris), une page. */
export function disruptionsUrl(now, page) {
  const day = parisDay(now).replaceAll('-', '');
  const params = new URLSearchParams({ count: String(PAGE_SIZE), depth: '2', start_page: String(page), since: `${day}T000000`, until: `${day}T235959` });
  return `${SNCF_BASE}/disruptions?${params.toString()}`;
}

/** Arrêts d'un train (itinéraire), pour les trains supprimés publiés sans arrêt. */
export function tripUrl(tripId) {
  return `${SNCF_BASE}/trips/${encodeURIComponent(tripId)}/vehicle_journeys?depth=3`;
}

function normalizeName(name) {
  return String(name ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, ' ').trim();
}

/** Axe d'un train grandes lignes : gare terminale parisienne au premier ou au dernier arrêt, sinon « province ». */
export function trainAxis(stops) {
  for (const stop of [stops[0], stops.at(-1)]) {
    const n = normalizeName(stop?.name);
    for (const [station, axis] of AXIS_STATIONS) if (n === station || n.startsWith(`${station} `)) return axis;
  }
  return 'province';
}

/** Nature du train d'après l'identifiant (`…:LongDistanceTrain`, `…:Train`, autre). */
export function trainKind(ptObjectId) {
  const suffix = String(ptObjectId ?? '').split(':').at(-1);
  if (suffix === 'LongDistanceTrain') return 'grandes-lignes';
  if (suffix === 'Train') return 'ter';
  return 'autre';
}

function minutes(hhmmss) {
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(String(hhmmss ?? ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 60 : null;
}

/** Retard d'un arrêt (min) : plus grand écart base/modifié à l'arrivée ou au départ ; passage de minuit compris. */
export function stopDelayMin(stop) {
  let best = null;
  for (const [base, amended] of [['base_arrival_time', 'amended_arrival_time'], ['base_departure_time', 'amended_departure_time']]) {
    const a = minutes(stop[base]);
    const b = minutes(stop[amended]);
    if (a === null || b === null) continue;
    let d = b - a;
    if (d < -720) d += 1440;
    if (d > 720) d -= 1440;
    best = best === null ? d : Math.max(best, d);
  }
  return best === null ? null : Math.round(best);
}

function toStop(raw, withDelay) {
  const lat = Number(raw?.stop_point?.coord?.lat);
  const lon = Number(raw?.stop_point?.coord?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { name: String(raw.stop_point.name ?? ''), lat, lon, delayMin: withDelay ? stopDelayMin(raw) : null };
}

/** Objets d'une perturbation qui sont des circulations (trains) ; les autres types d'objets sont ignorés. */
function tripObjects(d) {
  return (d?.impacted_objects ?? []).filter((o) => o?.pt_object && (o.pt_object.embedded_type ? o.pt_object.embedded_type === 'trip' : true));
}

/**
 * Train perturbé (contrat RailTrain) ; null si la perturbation est passée ou d'un effet non suivi.
 * `fallbackStops` : arrêts lus sur l'itinéraire quand la perturbation n'en publie pas (train supprimé).
 * `impacted` : l'objet impacté lu (la première circulation par défaut).
 */
export function toRailTrain(d, fallbackStops = null, impacted = tripObjects(d)[0]) {
  const rawEffect = d?.severity?.effect;
  const effect = typeof rawEffect === 'string' && Object.hasOwn(EFFECTS, rawEffect) ? EFFECTS[rawEffect] : undefined;
  const status = d?.status === 'active' ? 'en-cours' : d?.status === 'future' ? 'a-venir' : null;
  const obj = impacted?.pt_object;
  if (!effect || !status || !obj) return null;
  const kind = trainKind(obj.id);
  const published = (impacted.impacted_stops ?? []).map((s) => toStop(s, effect !== 'supprime')).filter(Boolean);
  const stops = published.length > 0 ? published : (fallbackStops ?? []);
  const delays = stops.map((s) => s.delayMin).filter((v) => v !== null);
  return {
    id: tripObjects(d).length > 1 ? `${d.id}#${obj.id}` : String(d.id),
    number: String(obj.trip?.name ?? obj.name ?? ''),
    kind,
    axis: kind === 'grandes-lignes' && stops.length > 0 ? trainAxis(stops) : null,
    region: kind === 'ter' && stops.length > 0 ? regionAt(stops[0].lat, stops[0].lon) : null,
    origin: stops[0]?.name ?? '',
    destination: stops.at(-1)?.name ?? '',
    effect,
    delayMin: effect === 'supprime' || delays.length === 0 ? null : Math.max(...delays),
    status,
    updatedAt: parisLocalToIso(d.updated_at) ?? '',
    stops,
  };
}

/** Statistiques d'un groupe de trains en cours (contrat RailGroupStats). */
export function groupStats(key, label, trains) {
  const delays = trains.map((t) => t.delayMin).filter((v) => v !== null);
  return {
    key,
    label,
    trains: trains.length,
    avgDelayMin: delays.length ? Math.round((delays.reduce((s, v) => s + v, 0) / delays.length) * 10) / 10 : null,
    maxDelayMin: delays.length ? Math.max(...delays) : null,
    cancelled: trains.filter((t) => t.effect === 'supprime').length,
    reduced: trains.filter((t) => t.effect === 'service-reduit').length,
    detour: trains.filter((t) => t.effect === 'detour').length,
  };
}

const byDelayDesc = (a, b) => (b.delayMin ?? -1) - (a.delayMin ?? -1);

/**
 * Partie calculée de la réponse /api/transport/rail-overview (sans `errors`).
 * Un train n'est compté qu'une fois : la perturbation la plus récente (`updated_at`) remplace les précédentes.
 * `at` : heure de réponse de l'API (ISO UTC) ; à défaut, la dernière mise à jour de perturbation.
 */
export function buildRailOverview(disruptions, tripStops = new Map(), at = null) {
  const byTrip = new Map();
  let updated = null;
  for (const d of disruptions) {
    for (const impacted of tripObjects(d)) {
      const tripId = impacted.pt_object.id;
      const train = toRailTrain(d, tripStops.get(tripId) ?? null, impacted);
      if (!train) continue;
      if (train.updatedAt && (!updated || train.updatedAt > updated)) updated = train.updatedAt;
      const known = byTrip.get(tripId);
      if (!known || train.updatedAt >= known.updatedAt) byTrip.set(tripId, train);
    }
  }
  const trains = [...byTrip.values()];
  const active = trains.filter((t) => t.status === 'en-cours');
  const longDistance = active.filter((t) => t.kind === 'grandes-lignes');
  const ter = active.filter((t) => t.kind === 'ter');
  const regionNames = [...new Set(ter.map((t) => t.region ?? 'Non rattaché'))];
  const axes = AXIS_ORDER.map((axis) => groupStats(axis, AXIS_LABELS[axis], longDistance.filter((t) => t.axis === axis)));
  const unattached = longDistance.filter((t) => t.axis === null);
  if (unattached.length > 0) axes.push(groupStats('non-rattache', 'Non rattaché', unattached));
  return {
    updatedAt: at ?? updated,
    longDistance: { active: longDistance.length, delayed15: longDistance.filter((t) => (t.delayMin ?? 0) >= 15).length },
    axes,
    regions: regionNames
      .map((name) => groupStats(name === 'Non rattaché' ? 'non-rattache' : name, name, ter.filter((t) => (t.region ?? 'Non rattaché') === name)))
      .sort((a, b) => b.trains - a.trains || a.label.localeCompare(b.label, 'fr')),
    topDelays: active.filter((t) => t.delayMin !== null).sort(byDelayDesc).slice(0, TOP_DELAYS),
    trains: [...active.sort(byDelayDesc), ...trains.filter((t) => t.status === 'a-venir').sort(byDelayDesc)],
  };
}

/**
 * Perturbations du jour (au plus deux pages de 1 000).
 * @returns {Promise<{ disruptions: object[], at: string | null, total: number }>} `at` : heure de réponse de l'API
 *   (`context.current_datetime`, heure de Paris) en ISO UTC ; `total` : nombre annoncé par l'API.
 */
export async function fetchDisruptions(now, auth) {
  const all = [];
  let at = null;
  let total = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const json = await fetchStrictJson(disruptionsUrl(now, page), { headers: { Authorization: auth }, timeoutMs: 20_000 });
    if (!json || !Array.isArray(json.disruptions)) throw new SyntaxError('réponse SNCF sans « disruptions »');
    all.push(...json.disruptions);
    at ??= parisLocalToIso(json.context?.current_datetime);
    total = Number(json.pagination?.total_result ?? all.length);
    if (all.length >= total || json.disruptions.length === 0) break;
  }
  return { disruptions: all, at, total };
}

const tripCache = new Map();
const tripFailures = new Map();

/** Réservé aux tests. */
export function __resetSncfStateForTests() {
  tripCache.clear();
  tripFailures.clear();
}

/** Réservé aux tests : taille des mémoires d'itinéraires. */
export function __sncfStateSizesForTests() {
  return { trips: tripCache.size, failures: tripFailures.size };
}

/** Oublie les itinéraires de plus de 6 h et les échecs de plus de 30 min (jamais relus) : la mémoire du processus reste bornée. */
function pruneTripMemory(now) {
  for (const [id, entry] of tripCache) if (now - entry.at >= TRIP_CACHE_MS) tripCache.delete(id);
  for (const [id, at] of tripFailures) if (now - at >= TRIP_FAILURE_MEMO_MS) tripFailures.delete(id);
}

/**
 * Arrêts des trains supprimés publiés sans arrêt (itinéraire gardé 6 h ; échec mémorisé 30 min pour ne pas
 * redemander à chaque lecture). Quatre lectures à la fois, 25 s au plus.
 * Rend aussi le nombre d'échecs (lectures échouées, mémorisées ou abandonnées) et celui des trains non lus
 * faute de place (au-delà de 40).
 */
export async function readCancelledTripStops(disruptions, auth, now) {
  pruneTripMemory(now);
  const stops = new Map();
  let failures = 0;
  const ids = [];
  for (const d of disruptions) {
    if (d?.severity?.effect !== 'NO_SERVICE' || d.status === 'past') continue;
    for (const o of tripObjects(d)) if ((o.impacted_stops ?? []).length === 0 && !ids.includes(o.pt_object.id)) ids.push(o.pt_object.id);
  }
  const skipped = Math.max(0, ids.length - MAX_TRIP_LOOKUPS);
  const queue = [];
  for (const tripId of ids.slice(0, MAX_TRIP_LOOKUPS)) {
    const cached = tripCache.get(tripId);
    const failedAt = tripFailures.get(tripId);
    if (cached && now - cached.at < TRIP_CACHE_MS) stops.set(tripId, cached.stops);
    else if (failedAt !== undefined && now - failedAt < TRIP_FAILURE_MEMO_MS) failures += 1;
    else queue.push(tripId);
  }
  const deadline = Date.now() + TRIP_DEADLINE_MS;
  const worker = async () => {
    for (let tripId = queue.shift(); tripId !== undefined; tripId = queue.shift()) {
      if (Date.now() > deadline) { failures += 1; continue; }
      try {
        const json = await fetchStrictJson(tripUrl(tripId), { headers: { Authorization: auth }, timeoutMs: 10_000 });
        const list = (json?.vehicle_journeys?.[0]?.stop_times ?? []).map((s) => toStop(s, false)).filter(Boolean);
        tripCache.set(tripId, { at: now, stops: list });
        stops.set(tripId, list);
      } catch {
        tripFailures.set(tripId, now);
        failures += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(TRIP_CONCURRENCY, queue.length) }, worker));
  return { stops, failures, skipped };
}
