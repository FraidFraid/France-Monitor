// api/_lib/cable-watch.js : veille des câbles sous-marins (spec 2026-10-04 souveraineté § 2.2, V1 ; contrats § 2.3, arbitrage 8 ;
// amendement 7, O18 et S9). Le serveur lit les navires lents du relais AIS (GET /slow-vessels, eaux françaises, moins de 2 nœuds,
// vitesse connue) toutes les 5 min et les rapproche des tracés du fichier des câbles (public/data/subsea-cables.json : câbles
// télécom du Shom en référence, compléments OpenStreetMap) : un navire à moins de 500 m d'un tracé est « à vérifier », jamais une
// « menace ». Écartés : vitesse inconnue (une absence n'est jamais un arrêt), message sans heure lisible, statut AIS 5 « amarré »,
// bâtiment de type AIS 35 sous pavillon français, navire dans une zone de mouillage du Shom où le mouillage est permis et qui ne
// recoupe aucune zone de câbles (S9 : il est à sa place). Ailleurs, le mouillage (statut 1) reste compté : une ancre est le vrai
// risque. Un câble du Shom hors service (STATUS S-57 4) reste dans le fichier mais ne donne jamais d'alerte. Un câble du Shom n'a
// pas de nom (`cableName: null`) et un tronçon au large n'a pas d'atterrage : la veille les traite comme les autres. Une alerte est
// confirmée quand le même navire est revu sur le même câble par deux messages AIS espacés d'au moins 5 min (le même message relu ne
// confirme jamais) ; absente d'un relevé, elle est retirée, sauf si sa position n'est couverte que par des lots amont muets : elle
// est alors gardée telle quelle, « non évaluée (flux de la zone muet) » (`zoneMuted`), jusqu'à ce que le lot reparle. Flux AIS
// muet depuis plus de 5 min (T3) : rien n'est évalué, les alertes restent telles quelles avec leur date, ni confirmées ni retirées,
// et aucun compte de navires n'est publié (`slowVessels: null`). États de confirmation dans le stockage clé-valeur (1 h). Aucun
// texte d'interface ici : la qualification d'une infraction appartient aux vues (« seule la préfecture maritime qualifie une
// infraction », A12).
import { UPSTREAM_SILENT_MS, isFrenchFlag } from './ais-snapshot.js';
import { kvGetJson, kvSetJson } from './kv-history.js';
import { fetchStrictJson, sourceError } from './source-http.js';
import { anchorageClearOfCablesAt, loadCablesFile, pointToPathM } from './subsea-cables.js';

export const CABLE_ALERT_M = 500;
export const CABLE_SLOW_KN = 2;
export const CONFIRM_GAP_MS = 5 * 60_000;
export const WATCH_INTERVAL_MS = 5 * 60_000;
export const WATCH_KEY = 'sov:cables:watch';
const WATCH_TTL_SEC = 3_600;
const MOORED = 5;
const MILITARY_TYPE = 35;
/** Une relève d'une minute peut arriver quelques millisecondes avant l'échéance : tolérance de 5 s. */
const TICK_TOLERANCE_MS = 5_000;
/** Marge de la boîte d'un tracé (degrés, plus de 500 m sous 51° N) : seuls les tracés proches sont mesurés. */
const BOX_MARGIN_DEG = 0.01;
const RELAY_TIMEOUT_MS = 10_000;
/** Panne du fichier des câbles (Shom et OpenStreetMap) ; même texte côté panneau (CABLES_FILE_ERROR_TEXT, sovereignty-format.ts). */
export const CABLES_FILE_ERROR = 'Câbles (Shom, OpenStreetMap) : fichier illisible';

/** Relais AIS interne (AIS_RELAY_INTERNAL_URL, sinon 127.0.0.1 et RELAY_PORT, 8090 par défaut, comme getRelayHttpBaseUrl). */
export function relayBaseUrl() {
  const configured = String(process.env.AIS_RELAY_INTERNAL_URL ?? '').trim().replace(/\/+$/, '');
  return configured || `http://127.0.0.1:${process.env.RELAY_PORT || 8090}`;
}

const boxes = new WeakMap();

/** Boîte englobante d'un câble (toutes ses lignes), élargie de la marge, calculée une fois ; null sans point. */
function boxOf(cable) {
  if (boxes.has(cable)) return boxes.get(cable);
  let minLon = Infinity; let minLat = Infinity; let maxLon = -Infinity; let maxLat = -Infinity;
  for (const line of Array.isArray(cable.path) ? cable.path : []) for (const [lon, lat] of line) {
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon); minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }
  const box = Number.isFinite(minLon) ? [minLon - BOX_MARGIN_DEG, minLat - BOX_MARGIN_DEG, maxLon + BOX_MARGIN_DEG, maxLat + BOX_MARGIN_DEG] : null;
  boxes.set(cable, box);
  return box;
}

/**
 * Navire retenu par la veille : message AIS daté (sans heure de message, aucune confirmation ne serait sûre), vitesse connue sous
 * 2 nœuds, non amarré, pas un bâtiment militaire français.
 */
function watched(v) {
  if (!v || typeof v.mmsi !== 'string' || !Number.isFinite(v.lat) || !Number.isFinite(v.lon)) return false;
  if (typeof v.lastAt !== 'string' || !Number.isFinite(Date.parse(v.lastAt))) return false;
  if (typeof v.sog !== 'number' || !Number.isFinite(v.sog) || v.sog >= CABLE_SLOW_KN) return false;
  if (v.status === MOORED) return false;
  return !(v.typeCode === MILITARY_TYPE && isFrenchFlag(v.mmsi));
}

/**
 * Navires lents à moins de 500 m d'un tracé en service : une entrée par navire et par câble (identifiant stable `${mmsi}:${cableId}`),
 * avec `seenAt`, l'heure du dernier message AIS du navire (base de la confirmation). Un navire dans une zone de mouillage permise du
 * Shom qui ne recoupe aucune zone de câbles n'est pas retenu (S9) ; un câble hors service n'est jamais mesuré. Tri : distance croissante.
 * @param {Array<{ mmsi: string, name: string | null, type: string | null, typeCode: number | null, status: number | null, lat: number, lon: number, sog: number | null, lastAt: string }>} vessels
 * @param {import('../../src/types/index.ts').SubseaCablesFile} file
 */
export function cableHits(vessels, file) {
  const out = [];
  for (const v of vessels) {
    if (!watched(v) || anchorageClearOfCablesAt(v.lat, v.lon, file)) continue;
    for (const c of file.cables) {
      if (c.outOfService === true) continue;
      const box = boxOf(c);
      if (!box || v.lon < box[0] || v.lon > box[2] || v.lat < box[1] || v.lat > box[3]) continue;
      const d = pointToPathM(v.lat, v.lon, c.path);
      if (d > CABLE_ALERT_M) continue;
      out.push({
        id: `${v.mmsi}:${c.id}`, mmsi: v.mmsi, name: v.name ?? null, vesselType: v.type ?? null, cableId: c.id, cableName: c.name ?? null,
        lat: v.lat, lon: v.lon, distanceM: Math.round(d), speedKn: v.sog, navStatus: Number.isInteger(v.status) ? v.status : null, seenAt: v.lastAt,
      });
    }
  }
  return out.sort((a, b) => a.distanceM - b.distanceM || a.id.localeCompare(b.id));
}

/**
 * Alertes du relevé : même identifiant revu sur un message AIS au moins 5 min après sa première vue : confirmée (pour de bon) ;
 * nouvelle : vue une fois ; absente du relevé : retirée, sauf si `isZoneMuted(alerte)` (sa zone n'est couverte que par des lots
 * amont muets) : gardée telle quelle, `zoneMuted: true` (« non évaluée, flux de la zone muet »), ni confirmée ni retirée. Le même
 * message relu par deux relevés ne confirme jamais. Tri : confirmées d'abord, puis distance croissante.
 * @param {Array<import('../../src/types/index.ts').CableAlert>} previous
 * @param {ReturnType<typeof cableHits>} hits
 * @param {string} atIso heure du relevé (à défaut de l'heure du message)
 * @param {(alert: import('../../src/types/index.ts').CableAlert) => boolean} [isZoneMuted]
 */
export function confirmAlerts(previous, hits, atIso, isZoneMuted = () => false) {
  const prev = new Map(previous.map((a) => [a.id, a]));
  const seenNow = new Set(hits.map((h) => h.id));
  const evaluated = hits.map(({ seenAt, ...hit }) => {
    const seen = typeof seenAt === 'string' && Number.isFinite(Date.parse(seenAt)) ? seenAt : atIso;
    const old = prev.get(hit.id);
    const firstSeen = old ? old.firstSeen : seen;
    const confirmed = Boolean(old?.confirmed) || Date.parse(seen) - Date.parse(firstSeen) >= CONFIRM_GAP_MS;
    return { ...hit, firstSeen, lastSeen: seen, confirmed, zoneMuted: false };
  });
  const kept = previous.filter((a) => !seenNow.has(a.id) && isZoneMuted(a)).map((a) => ({ ...a, zoneMuted: true }));
  return [...evaluated, ...kept]
    .sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || a.distanceM - b.distanceM || a.id.localeCompare(b.id));
}

/**
 * Vrai si la position n'est couverte que par des boîtes de lots amont muets (au moins une) : une absence n'y est pas une absence.
 * @param {number} lat
 * @param {number} lon
 * @param {Array<{ box: [[number, number], [number, number]], muted: boolean }>} zones
 */
function inMutedZone(lat, lon, zones) {
  const covering = zones.filter(({ box: [[s, w], [n, e]] }) => (
    lat >= Math.min(s, n) && lat <= Math.max(s, n) && lon >= Math.min(w, e) && lon <= Math.max(w, e)
  ));
  return covering.length > 0 && covering.every((z) => z.muted);
}

/** Fichier des câbles résumé (CablesWatchResponse.cablesFile) : date, base OSM, câbles (Shom et OSM) et atterrages ; null s'il est illisible. */
function fileMeta(file) {
  if (!file) return null;
  return {
    generatedAt: file.generatedAt, osmBase: file.osmBase, cables: file.cables.length,
    landings: file.cables.reduce((n, c) => n + (Array.isArray(c.landings) ? c.landings.length : 0), 0),
  };
}

function readCables() {
  try {
    return loadCablesFile();
  } catch {
    return null;
  }
}

function emptyBody(file, errors) {
  return { readAt: null, aisLastMessageAt: null, evaluated: false, cablesFile: fileMeta(file), slowVessels: null, alerts: [], errors };
}

/** Veille non évaluée : aucun compte de navires publié (un compte périmé ne passe jamais pour actuel). */
function unevaluated(body) {
  return { ...body, evaluated: false, slowVessels: null };
}

const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/** Boîte d'une zone du relais lisible ([[sud, ouest], [nord, est]], nombres finis) ; null sinon. */
function relayBox(box) {
  if (!Array.isArray(box) || box.length !== 2 || !box.every((p) => Array.isArray(p) && p.length === 2 && p.every(finite))) return null;
  return [[box[0][0], box[0][1]], [box[1][0], box[1][1]]];
}

/** Réponse du relais lisible : liste de navires, dernier message et erreurs ; lève sinon. */
function checkRelay(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.vessels)) throw new Error('réponse illisible');
  return {
    vessels: json.vessels.filter((v) => v && typeof v === 'object'),
    lastMessageAt: typeof json.lastMessageAt === 'string' && Number.isFinite(Date.parse(json.lastMessageAt)) ? json.lastMessageAt : null,
    errors: Array.isArray(json.errors) ? json.errors.filter((e) => typeof e === 'string') : [],
    zones: (Array.isArray(json.zones) ? json.zones : [])
      .map((z) => ({ box: relayBox(z?.box), muted: z?.muted === true }))
      .filter((z) => z.box !== null),
  };
}

async function collect(now, stored) {
  const prev = stored?.body ?? null;
  const file = readCables();
  const errors = file ? [] : [CABLES_FILE_ERROR];
  let relay;
  try {
    relay = checkRelay(await fetchStrictJson(`${relayBaseUrl()}/slow-vessels`, { timeoutMs: RELAY_TIMEOUT_MS }));
  } catch (err) {
    errors.push(sourceError('Relais AIS', err));
    // Relais injoignable : rien n'est évalué ; les alertes déjà vues restent telles quelles, avec leur date.
    const body = prev && prev.readAt !== null
      ? unevaluated({ ...prev, cablesFile: fileMeta(file) ?? prev.cablesFile, errors })
      : emptyBody(file, errors);
    await kvSetJson(WATCH_KEY, { body, attemptedAt: now }, WATCH_TTL_SEC, now);
    return body;
  }
  errors.push(...relay.errors);
  const readAt = new Date(now).toISOString();
  const silent = relay.lastMessageAt === null || now - Date.parse(relay.lastMessageAt) > UPSTREAM_SILENT_MS;
  const evaluated = !silent && file !== null;
  const alerts = evaluated
    ? confirmAlerts(prev?.alerts ?? [], cableHits(relay.vessels, file), readAt, (a) => inMutedZone(a.lat, a.lon, relay.zones))
    : prev?.alerts ?? [];
  const body = {
    readAt, aisLastMessageAt: relay.lastMessageAt, evaluated, cablesFile: fileMeta(file), slowVessels: evaluated ? relay.vessels.length : null,
    alerts, errors,
  };
  await kvSetJson(WATCH_KEY, { body, attemptedAt: now }, WATCH_TTL_SEC, now);
  return body;
}

let inflight = null;

/** Réservé aux tests : aucune veille en cours. */
export function __resetCablesWatchForTests() {
  inflight = null;
}

/**
 * Veille à jour (CablesWatchResponse) : nouveau relevé du relais si le dernier essai a 5 min ou plus. Un seul relevé à la fois ; ne
 * lève jamais (une erreur imprévue est nommée, la veille précédente gardée).
 * @param {number} [now]
 */
export async function ensureCablesWatchFresh(now = Date.now()) {
  const stored = await kvGetJson(WATCH_KEY, now);
  const record = stored && typeof stored === 'object' && stored.body ? stored : null;
  if (record && Number.isFinite(record.attemptedAt) && now - record.attemptedAt < WATCH_INTERVAL_MS - TICK_TOLERANCE_MS) return record.body;
  inflight ??= collect(now, record)
    .catch((err) => {
      console.error('[collecte cables-watch] relevé interrompu', err instanceof Error ? err.message : String(err));
      const errors = [sourceError('Veille des câbles interrompue', err)];
      return record ? unevaluated({ ...record.body, errors }) : emptyBody(null, errors);
    })
    .finally(() => { inflight = null; });
  return inflight;
}
