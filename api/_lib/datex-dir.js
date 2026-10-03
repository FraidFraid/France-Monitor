// api/_lib/datex-dir.js : événements du réseau routier national non concédé publiés par les DIR (Bison Futé,
// DATEX II 2.0), spec 2026-10-03 panneaux trafic § 2.1 et T2.
// Source : instantané complet `content.xml` (régénéré une fois par heure, à hh:57, vérifié le 03/10/2026)
// plus le journal des fichiers numérotés publiés depuis (`<n>.xml`, un par mise à jour de situation, environ
// un par minute ; `index.txt` donne le prochain numéro, `feedType` de l'instantané le dernier numéro inclus).
// Le journal est appliqué en mémoire du processus : la donnée a une à deux minutes de retard, pas une heure.
// L'index est publié avant le fichier (vu le 03/10/2026) : un 404 sur les derniers fichiers annoncés arrête la lecture sans
// erreur (relus à la suivante) ; un 404 suivi d'un fichier publié est un trou, sauté et nommé. La nuit, le plus long écart
// mesuré entre deux fichiers est de 13 min 30 s (nuit du 2 au 3/10/2026, de 1 h à 6 h 30) : la date de publication ne dépasse
// pas le seuil de retard de 30 minutes sans panne.
// Analyse par expressions régulières (préfixe d'espace de noms facultatif : `ns2:` dans l'instantané, aucun
// dans le journal) ; aucune dépendance XML.
import { cleanText, fetchStrictText, fetchStrictXml } from './source-http.js';

export const DIR_BASE = 'https://tipi.bison-fute.gouv.fr/bison-fute-ouvert/publicationsDIR/Evenementiel-DIR/grt/RRN';
export const SNAPSHOT_URL = `${DIR_BASE}/content.xml`;
export const INDEX_URL = `${DIR_BASE}/index.txt`;
/** Au-delà, l'instantané horaire est relu plutôt que de lire tout le journal. */
export const MAX_INCREMENTS = 200;
/** L'instantané est relu quand la copie gardée a plus de 65 minutes (il est régénéré toutes les heures). */
export const SNAPSHOT_MAX_AGE_MS = 65 * 60_000;
const INCREMENT_CONCURRENCY = 4;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** URL d'un fichier du journal. */
export function incrementUrl(n) {
  return `${DIR_BASE}/${n}.xml`;
}

const NS = '(?:[A-Za-z0-9_]+:)?';

/** Blocs `<tag …>…</tag>` (préfixe facultatif) ; `tag` ne doit pas être le début d'un autre nom de balise. */
function blocks(xml, tag) {
  const re = new RegExp(`<${NS}${tag}(?=[\\s>/])([^>]*)>([\\s\\S]*?)</${NS}${tag}>`, 'g');
  const out = [];
  for (const m of xml.matchAll(re)) out.push({ attrs: m[1], inner: m[2] });
  return out;
}

/** Texte de la première balise `tag` (null si absente). */
function first(xml, tag) {
  const m = new RegExp(`<${NS}${tag}(?=[\\s>])[^>]*>([^<]*)</${NS}${tag}>`).exec(xml);
  return m ? m[1].trim() : null;
}

function attr(attrs, name) {
  const m = new RegExp(`${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : null;
}

/** « A0063 » → « A63 », « N0010 » → « N10 » ; null reste null. */
export function formatRoad(roadNumber) {
  if (!roadNumber) return null;
  const m = /^([A-Z]+)0*(\d.*)$/.exec(String(roadNumber).trim());
  return m ? `${m[1]}${m[2]}` : String(roadNumber).trim();
}

/** Libellés non harmonisés vus dans le flux, rattachés à leur DIR. */
const DIR_ALIASES = { AURA_DIRCE: 'DIR Centre-Est', AURA_DIRMC: 'DIR Massif-Central' };

/** « Direction interdépartementale des routes/DIR Ouest » → « DIR Ouest » ; organisme seul : gardé tel quel. */
export function dirLabel(sourceIdentification) {
  const raw = String(sourceIdentification ?? '').trim();
  if (!raw) return 'Organisme non précisé';
  const last = raw.split('/').map((p) => p.trim()).filter(Boolean).at(-1) ?? raw;
  if (Object.hasOwn(DIR_ALIASES, last)) return DIR_ALIASES[last];
  if (last === 'Direction interdépartementale des routes') return 'DIR non précisée';
  return last;
}

/** Balise du sous-type pour chaque `xsi:type` d'enregistrement. */
const SUBTYPE_TAG = {
  Accident: 'accidentType',
  VehicleObstruction: 'vehicleObstructionType',
  GeneralObstruction: 'obstructionType',
  AnimalPresenceObstruction: 'animalPresenceType',
  InfrastructureDamageObstruction: 'infrastructureDamageType',
  EnvironmentalObstruction: 'environmentalObstructionType',
  NonWeatherRelatedRoadConditions: 'nonWeatherRelatedRoadConditionType',
  WeatherRelatedRoadConditions: 'weatherRelatedRoadConditionType',
  PoorEnvironmentConditions: 'poorEnvironmentType',
  AbnormalTraffic: 'abnormalTrafficType',
  RoadOrCarriagewayOrLaneManagement: 'roadOrCarriagewayOrLaneManagementType',
  MaintenanceWorks: 'roadMaintenanceType',
  ConstructionWorks: 'constructionWorkType',
  ReroutingManagement: 'reroutingManagementType',
  SpeedManagement: 'speedManagementType',
  GeneralInstructionOrMessageToRoadUsers: 'generalInstructionToRoadUsersType',
  GeneralNetworkManagement: 'generalNetworkManagementType',
  RoadsideServiceDisruption: 'roadsideServiceDisruptionType',
  PublicEvent: 'publicEventType',
};

const OBSTRUCTION_TYPES = new Set([
  'VehicleObstruction', 'GeneralObstruction', 'AnimalPresenceObstruction', 'InfrastructureDamageObstruction', 'NonWeatherRelatedRoadConditions',
]);
const WEATHER_TYPES = new Set(['WeatherRelatedRoadConditions', 'PoorEnvironmentConditions']);
/** Obstacles naturels rangés en météo (neige, glace, inondation, tempête) ; les éboulements restent des obstacles. */
const WEATHER_ENVIRONMENT = new Set(['flooding', 'flashFloods', 'avalanches', 'fallingIce', 'fallingLightIceOrSnow', 'stormDamage']);
const CLOSURE_SUBTYPES = new Set(['roadClosed', 'carriagewayClosures', 'closedPermanentlyForTheWinter', 'overnightClosures', 'intermittentShortTermClosures']);
const BLOCKING_CONSTRICTIONS = new Set(['carriagewayBlocked', 'roadBlocked']);

const SUBTYPE_LABELS = {
  accident: 'Accident',
  brokenDownVehicle: 'Véhicule en panne', vehicleStuck: 'Véhicule bloqué', abandonedVehicle: 'Véhicule abandonné', vehicleOnFire: 'Véhicule en feu',
  obstructionOnTheRoad: 'Obstacle sur la chaussée', peopleOnRoadway: 'Personnes sur la chaussée', objectOnTheRoad: 'Objet sur la chaussée',
  cyclistsOnRoadway: 'Cyclistes sur la chaussée', incident: 'Incident',
  rockfalls: 'Éboulement', subsidence: 'Affaissement', landslips: 'Glissement de terrain', mudSlide: 'Coulée de boue', flooding: 'Inondation',
  flashFloods: 'Crue soudaine', fallenTrees: 'Chute d’arbres', avalanches: 'Avalanche', stormDamage: 'Dégâts de tempête',
  slipperyRoad: 'Chaussée glissante', oilOnRoad: 'Hydrocarbures sur la chaussée', looseChippings: 'Gravillons',
  snowOnTheRoad: 'Neige sur la chaussée', ice: 'Verglas', blackIce: 'Verglas', freezingOfWetRoads: 'Verglas', snowDrifts: 'Congères',
  fog: 'Brouillard', denseFog: 'Brouillard dense', strongWinds: 'Vent fort', heavyRain: 'Fortes pluies', heavySnowfall: 'Fortes chutes de neige',
  queuingTraffic: 'Bouchon', stationaryTraffic: 'Circulation arrêtée', slowTraffic: 'Ralentissement', heavyTraffic: 'Circulation dense',
  roadClosed: 'Route coupée', carriagewayClosures: 'Chaussée fermée', closedPermanentlyForTheWinter: 'Fermeture hivernale',
  overnightClosures: 'Fermeture de nuit', intermittentShortTermClosures: 'Fermetures intermittentes',
  laneClosures: 'Voie fermée', singleAlternateLineTraffic: 'Alternat', contraflow: 'Basculement de circulation', narrowLanes: 'Voies rétrécies',
  weightRestrictionInOperation: 'Limitation de tonnage', heightRestrictionInOperation: 'Limitation de hauteur', lanesDeviated: 'Voies déviées',
  roadworks: 'Travaux', maintenanceWork: 'Travaux d’entretien', repairWork: 'Réparations', resurfacingWork: 'Réfection de chaussée',
  roadMarkingWork: 'Marquage au sol', grassCuttingWork: 'Fauchage', constructionWork: 'Chantier de construction',
  followLocalDiversion: 'Déviation locale', doNotUseEntry: 'Entrée fermée', doNotUseExit: 'Sortie fermée', useExit: 'Sortie conseillée',
  speedRestrictionInOperation: 'Limitation de vitesse', noOvertaking: 'Interdiction de dépasser', serviceAreaClosed: 'Aire de service fermée',
};

const TYPE_LABELS = {
  Accident: 'Accident', VehicleObstruction: 'Véhicule gênant', GeneralObstruction: 'Obstacle', AnimalPresenceObstruction: 'Animal sur la chaussée',
  InfrastructureDamageObstruction: 'Dégât d’infrastructure', EnvironmentalObstruction: 'Obstacle naturel',
  NonWeatherRelatedRoadConditions: 'Chaussée dégradée', WeatherRelatedRoadConditions: 'Conditions météo', PoorEnvironmentConditions: 'Conditions difficiles',
  AbnormalTraffic: 'Trafic perturbé', RoadOrCarriagewayOrLaneManagement: 'Restriction de circulation', MaintenanceWorks: 'Travaux',
  ConstructionWorks: 'Chantier', ReroutingManagement: 'Déviation', SpeedManagement: 'Limitation de vitesse',
  GeneralInstructionOrMessageToRoadUsers: 'Consigne aux usagers', GeneralNetworkManagement: 'Gestion du réseau',
  RoadsideServiceDisruption: 'Service sur aire perturbé', PublicEvent: 'Événement public', OperatorAction: 'Intervention',
};

/**
 * Classement d'un enregistrement (§ 2.1) : incidents (accident, obstacle, bouchon, météo), coupures et
 * restrictions (closure, lane), chantiers (works), le reste en information (déviation, vitesse, consignes).
 * @param {string} type `xsi:type` sans préfixe
 * @param {string} subtype
 * @param {string | null} [constriction] `trafficConstrictionType` de l'impact
 * @returns {{ kind: import('../../src/types/index.ts').RoadEventKind, label: string }}
 */
export function classifyRecord(type, subtype, constriction = null) {
  const label = SUBTYPE_LABELS[subtype] ?? TYPE_LABELS[type] ?? 'Événement';
  if (type === 'Accident') return { kind: 'accident', label: 'Accident' };
  if (type === 'AbnormalTraffic') return { kind: 'queue', label };
  if (WEATHER_TYPES.has(type)) return { kind: 'weather', label };
  if (type === 'EnvironmentalObstruction') return { kind: WEATHER_ENVIRONMENT.has(subtype) ? 'weather' : 'obstruction', label };
  if (OBSTRUCTION_TYPES.has(type)) return { kind: 'obstruction', label };
  if (type === 'RoadOrCarriagewayOrLaneManagement') {
    if (CLOSURE_SUBTYPES.has(subtype) || BLOCKING_CONSTRICTIONS.has(constriction ?? '')) {
      return { kind: 'closure', label: CLOSURE_SUBTYPES.has(subtype) ? label : 'Chaussée fermée' };
    }
    return { kind: 'lane', label };
  }
  if (type === 'MaintenanceWorks' || type === 'ConstructionWorks') return { kind: 'works', label };
  return { kind: 'info', label };
}

function comments(inner) {
  return blocks(inner, 'generalPublicComment').map((c) => ({
    type: first(c.inner, 'commentType') ?? '',
    text: (first(c.inner, 'value') ?? '').trim(),
  }));
}

/** Noms de lieux d'un enregistrement : communes (`townName`) et noms de route (`linkName`), dans l'ordre, nettoyés (texte tiers). */
function placeNames(inner) {
  const towns = [];
  const links = [];
  for (const n of blocks(inner, 'name')) {
    const value = cleanText(first(n.inner, 'value') ?? '');
    const type = first(n.inner, 'tpegOtherPointDescriptorType');
    if (!value) continue;
    if (type === 'townName' && !towns.includes(value)) towns.push(value);
    if (type === 'linkName' && !links.includes(value)) links.push(value);
  }
  return { towns, links };
}

/**
 * Enregistrement d'une situation ; textes tiers affichés (communes, noms de route et de point, organisme) passés par
 * cleanText : entités XML décodées, tiret cadratin remplacé.
 * @returns {{ id: string, type: string, subtype: string, constriction: string | null, creation: string | null, start: string | null,
 *   end: string | null, status: string | null, probability: string | null, recurring: boolean, source: string, comments: Array<{ type: string, text: string }>,
 *   towns: string[], links: string[], roadNumber: string | null, alertName: string | null, lat: number | null, lon: number | null, safety: boolean }}
 */
function parseRecord(attrs, inner) {
  const type = (attr(attrs, 'xsi:type') ?? '').replace(/^[A-Za-z0-9_]+:/, '');
  const tag = SUBTYPE_TAG[type];
  const lat = Number(first(inner, 'latitude'));
  const lon = Number(first(inner, 'longitude'));
  const { towns, links } = placeNames(inner);
  const alertBlock = blocks(inner, 'alertCLocationName')[0];
  return {
    id: attr(attrs, 'id') ?? '',
    type,
    subtype: (tag ? first(inner, tag) : null) ?? '',
    constriction: first(inner, 'trafficConstrictionType'),
    creation: first(inner, 'situationRecordCreationTime'),
    start: first(inner, 'overallStartTime'),
    end: first(inner, 'overallEndTime'),
    status: first(inner, 'validityStatus'),
    probability: first(inner, 'probabilityOfOccurrence'),
    recurring: new RegExp(`<${NS}validPeriod[\\s>]`).test(inner),
    source: cleanText(first(inner, 'sourceIdentification') ?? ''),
    comments: comments(inner),
    towns,
    links,
    roadNumber: first(inner, 'roadNumber'),
    alertName: alertBlock ? cleanText(first(alertBlock.inner, 'value') ?? '') || null : null,
    lat: first(inner, 'latitude') !== null && Number.isFinite(lat) ? lat : null,
    lon: first(inner, 'longitude') !== null && Number.isFinite(lon) ? lon : null,
    safety: first(inner, 'safetyRelatedMessage') === 'true',
  };
}

/**
 * Analyse un document DATEX II des DIR (instantané ou fichier du journal).
 * @param {string} xml
 * @returns {{ publishedAt: string | null, feedNumber: number | null, situations: Array<{ id: string, version: number, severity: string | null, records: ReturnType<typeof parseRecord>[] }> }}
 */
export function parseDatex(xml) {
  const text = String(xml ?? '');
  if (!new RegExp(`<${NS}d2LogicalModel[\\s>]`).test(text)) throw new SyntaxError('document DATEX II attendu');
  const feed = Number(first(text, 'feedType'));
  const situations = blocks(text, 'situation').map(({ attrs, inner }) => ({
    id: attr(attrs, 'id') ?? '',
    version: Number(attr(attrs, 'version') ?? 0),
    severity: first(inner, 'overallSeverity'),
    records: blocks(inner, 'situationRecord').map((r) => parseRecord(r.attrs, r.inner)),
  }));
  return { publishedAt: first(text, 'publicationTime'), feedNumber: Number.isFinite(feed) && feed > 0 ? feed : null, situations };
}

/** Applique des mises à jour de situations (version égale ou plus récente : la situation est remplacée en entier). */
export function mergeSituations(map, updates) {
  for (const s of updates) {
    const current = map.get(s.id);
    if (!current || s.version >= current.version) map.set(s.id, s);
  }
  return map;
}

/** Enregistrement en vigueur à `now` : non suspendu, commencé, non terminé. */
export function isActive(record, now) {
  if (record.status === 'suspended') return false;
  const start = Date.parse(record.start ?? '');
  if (!Number.isFinite(start) || start > now) return false;
  const end = record.end ? Date.parse(record.end) : Number.NaN;
  return !Number.isFinite(end) || end >= now;
}

/**
 * Planifié (T2) : chantier, occurrence « probable » (programmée), plages horaires récurrentes, ou saisi au moins
 * une heure avant son début (fermeture par arrêté). Une coupure saisie au moment où elle commence ne l'est pas.
 */
export function isPlanned(record, kind) {
  if (kind === 'works' || record.probability === 'probable' || record.recurring) return true;
  const start = Date.parse(record.start ?? '');
  const creation = Date.parse(record.creation ?? '');
  return Number.isFinite(start) && Number.isFinite(creation) && start - creation >= HOUR_MS;
}

const DIRECTION_RE = /^De (.+?) vers (.+)$/;

function eventDetail(record, dir) {
  const parts = [];
  for (const c of record.comments) {
    const text = cleanText(c.text);
    if (!text || /^Sur 0 m$/i.test(text) || DIRECTION_RE.test(text)) continue;
    if (c.type === 'locationDescriptor' && (text.includes('/') || text === dir)) continue;
    if (c.type === 'internalNote') continue;
    if (!parts.includes(text)) parts.push(text);
  }
  const detail = parts.join(' · ');
  return detail.length > 400 ? `${detail.slice(0, 399)}…` : detail;
}

const SEVERITIES = new Set(['low', 'medium', 'high', 'highest']);

/**
 * Événement routier (contrat RoadEvent) d'un enregistrement en vigueur ; null sinon.
 * @param {{ severity: string | null }} situation
 * @param {ReturnType<typeof parseRecord>} record
 * @param {number} now
 */
export function toRoadEvent(situation, record, now) {
  if (!isActive(record, now)) return null;
  const { kind, label } = classifyRecord(record.type, record.subtype, record.constriction);
  const dir = dirLabel(record.source);
  const planned = isPlanned(record, kind);
  const started = Date.parse(record.start ?? '');
  const directionText = record.comments.map((c) => cleanText(c.text)).find((t) => DIRECTION_RE.test(t));
  const linkRoad = record.links.find((l) => /^[A-Z]{1,2}\s?\d/.test(l)) ?? null;
  return {
    id: record.id,
    kind,
    subtype: record.subtype || record.type,
    label,
    road: formatRoad(record.roadNumber) ?? linkRoad,
    place: record.towns.length >= 2 ? `de ${record.towns[0]} à ${record.towns.at(-1)}` : (record.towns[0] ?? record.alertName ?? null),
    direction: directionText ? `vers ${DIRECTION_RE.exec(directionText)?.[2] ?? ''}`.trim() : null,
    dir,
    start: record.start ?? '',
    end: record.end,
    severity: SEVERITIES.has(situation.severity ?? '') ? situation.severity : null,
    safety: record.safety,
    planned,
    longTerm: planned || now - started > DAY_MS,
    lat: record.lat,
    lon: record.lon,
    detail: eventDetail(record, dir),
  };
}

const EVENT_RANK = { accident: 0, closure: 1, queue: 2, weather: 3, obstruction: 4, lane: 5 };
const LONG_TERM_RANK = { closure: 0, lane: 1, works: 2, weather: 3, obstruction: 4, queue: 5, accident: 6 };
const INCIDENT_KINDS = new Set(['accident', 'obstruction', 'queue', 'weather']);
const byStartDesc = (a, b) => Date.parse(b.start) - Date.parse(a.start);

/**
 * Partie DIR de la réponse /api/traffic/road-national : événements en cours (non planifiés, moins de 24 h,
 * hors information), fermetures et chantiers de longue durée, comptes et incidents par DIR.
 * Les mesures d'accompagnement (déviations, limitations de vitesse, consignes) ne sont pas listées.
 * @param {Iterable<{ severity: string | null, records: ReturnType<typeof parseRecord>[] }>} situations
 * @param {number} now
 */
export function buildRoadNational(situations, now) {
  const events = [];
  const longTerm = [];
  const dirs = new Set();
  for (const situation of situations) {
    for (const record of situation.records) {
      const event = toRoadEvent(situation, record, now);
      if (!event || event.kind === 'info') continue;
      dirs.add(event.dir);
      if (event.longTerm) longTerm.push(event);
      else if (event.kind !== 'works') events.push(event);
    }
  }
  events.sort((a, b) => EVENT_RANK[a.kind] - EVENT_RANK[b.kind] || byStartDesc(a, b));
  longTerm.sort((a, b) => LONG_TERM_RANK[a.kind] - LONG_TERM_RANK[b.kind] || byStartDesc(a, b));
  const incidents = events.filter((e) => INCIDENT_KINDS.has(e.kind));
  const perDir = new Map([...dirs].map((d) => [d, 0]));
  for (const e of incidents) perDir.set(e.dir, (perDir.get(e.dir) ?? 0) + 1);
  return {
    events,
    longTerm,
    counts: {
      incidents: incidents.length,
      accidents: events.filter((e) => e.kind === 'accident').length,
      closures: events.filter((e) => e.kind === 'closure').length,
      obstructions: events.filter((e) => e.kind === 'obstruction').length,
      weather: events.filter((e) => e.kind === 'weather').length,
      works: longTerm.filter((e) => e.kind === 'works').length,
    },
    byDir: [...perDir].map(([dir, n]) => ({ dir, incidents: n }))
      .sort((a, b) => b.incidents - a.incidents || a.dir.localeCompare(b.dir, 'fr')),
  };
}

function isNotFound(err) {
  return Boolean(err && typeof err === 'object' && 'status' in err && err.status === 404);
}

/** État du flux gardé en mémoire du processus entre deux lectures. */
let state = null;

/** Réservé aux tests. */
export function __resetDatexStateForTests() {
  state = null;
}

async function readSnapshot(now) {
  const parsed = parseDatex(await fetchStrictXml(SNAPSHOT_URL, { timeoutMs: 30_000 }));
  if (parsed.feedNumber === null) throw new SyntaxError('instantané DIR sans numéro de journal (feedType)');
  if (parsed.situations.length === 0) throw new SyntaxError('instantané DIR sans situation');
  return {
    fetchedAt: now,
    lastApplied: parsed.feedNumber,
    publishedAt: parsed.publishedAt,
    situations: mergeSituations(new Map(), parsed.situations),
  };
}

/**
 * Situations des DIR à jour : instantané horaire (relu après 65 min) et journal appliqué depuis.
 * Lève si aucun état n'est disponible ; sinon une lecture partielle ajoute une erreur nommée.
 * @param {number} now
 * @returns {Promise<{ publishedAt: string | null, situations: Array<{ id: string, version: number, severity: string | null, records: unknown[] }>, errors: string[] }>}
 */
export async function loadDirSituations(now = Date.now()) {
  const errors = [];
  if (!state || now - state.fetchedAt > SNAPSHOT_MAX_AGE_MS) {
    try {
      state = await readSnapshot(now);
    } catch (err) {
      if (!state) throw err;
      errors.push(`DIR, instantané : ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  try {
    const next = Number((await fetchStrictText(INDEX_URL, { timeoutMs: 10_000 })).trim());
    if (!Number.isInteger(next) || next <= 0) throw new SyntaxError('index du journal illisible');
    let from = state.lastApplied + 1;
    let missing = [];
    if (next - from > MAX_INCREMENTS) {
      errors.push(`DIR, journal : ${next - from} fichiers en attente, seuls les ${MAX_INCREMENTS} derniers sont lus`);
      from = next - MAX_INCREMENTS;
    }
    for (let n = from; n < next; n += INCREMENT_CONCURRENCY) {
      const numbers = Array.from({ length: Math.min(INCREMENT_CONCURRENCY, next - n) }, (_, i) => n + i);
      const results = await Promise.allSettled(numbers.map((k) => fetchStrictXml(incrementUrl(k), { timeoutMs: 10_000 })));
      for (let i = 0; i < results.length; i += 1) {
        const r = results[i];
        if (r.status === 'rejected') {
          // HTTP 404 : fichier pas encore publié (l'index l'annonce avant) ou trou du journal ; tranché par la suite.
          if (isNotFound(r.reason)) { missing.push(numbers[i]); continue; }
          throw new Error(`fichier ${numbers[i]} : ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
        }
        if (missing.length > 0) {
          // Un fichier publié après un 404 : trou au milieu du journal, sauté et nommé (jamais relu).
          errors.push(`DIR, journal : ${missing.length > 1 ? `fichiers ${missing.join(', ')} absents (HTTP 404), sautés` : `fichier ${missing[0]} absent (HTTP 404), sauté`}`);
          missing = [];
        }
        const parsed = parseDatex(r.value);
        mergeSituations(state.situations, parsed.situations);
        state.lastApplied = numbers[i];
        if (parsed.publishedAt) state.publishedAt = parsed.publishedAt;
      }
    }
    // Derniers fichiers annoncés par l'index mais pas encore publiés (404 sans fichier publié après) : arrêt silencieux,
    // `lastApplied` reste avant eux, ils sont relus à la lecture suivante.
  } catch (err) {
    errors.push(`DIR, journal : ${err instanceof Error ? err.message : String(err)}`);
  }
  return { publishedAt: state.publishedAt, situations: [...state.situations.values()], errors };
}
