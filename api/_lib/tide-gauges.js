// api/_lib/tide-gauges.js : hauteurs d'eau observées aux marégraphes des ports sensibles (SHOM, REFMAR, sans clé ; spec 2026-10-04
// environnement § 3.4, contrats § 2.9). Liste FIXE versionnée (identifiants vérifiés le 04/10 sur le référentiel du SHOM, état
// « OK ») ; une mesure par minute, servie en JSON sous l'en-tête text/html (lecture stricte du corps). Aucune marée prédite : le
// service de prédiction exige une clé (contrats § 9), la section le dit (S4).
import { mapLimit } from './map-limit.js';
import { cachedSource, fetchStrictJson, sourceError } from './source-http.js';

/** 19 marégraphes des ports sensibles, de la mer du Nord à la Corse ; domaine littoral « XX10 » de la vigilance vagues-submersion. */
export const TIDE_GAUGES = [
  { id: 2, name: 'Dunkerque', coastDomain: '5910', dept: '59', lat: 51.048091, lon: 2.366698 },
  { id: 55, name: 'Calais', coastDomain: '6210', dept: '62', lat: 50.9693985, lon: 1.86772001 },
  { id: 4, name: 'Le Havre', coastDomain: '7610', dept: '76', lat: 49.481892, lon: 0.10598 },
  { id: 13, name: 'Cherbourg', coastDomain: '5010', dept: '50', lat: 49.651447, lon: -1.635508 },
  { id: 410, name: 'Saint-Malo', coastDomain: '3510', dept: '35', lat: 48.640812, lon: -2.028103 },
  { id: 3, name: 'Brest', coastDomain: '2910', dept: '29', lat: 48.38290024, lon: -4.49503994 },
  { id: 160, name: 'Concarneau', coastDomain: '2910', dept: '29', lat: 47.873549, lon: -3.907207 },
  { id: 37, name: 'Saint-Nazaire', coastDomain: '4410', dept: '44', lat: 47.266862, lon: -2.20155 },
  { id: 62, name: 'Les Sables-d’Olonne', coastDomain: '8510', dept: '85', lat: 46.497358, lon: -1.793528 },
  { id: 34, name: 'La Rochelle-Pallice', coastDomain: '1710', dept: '17', lat: 46.15850067138672, lon: -1.2206499576568604 },
  { id: 297, name: 'Port-Bloc', coastDomain: '3310', dept: '33', lat: 45.56843333, lon: -1.06148333 },
  { id: 190, name: 'Arcachon', coastDomain: '3310', dept: '33', lat: 44.66500092, lon: -1.16355002 },
  { id: 94, name: 'Bayonne-Boucau', coastDomain: '6410', dept: '64', lat: 43.52732, lon: -1.51483 },
  { id: 75, name: 'Port-Vendres', coastDomain: '6610', dept: '66', lat: 42.519922, lon: 3.10745 },
  { id: 250, name: 'Sète', coastDomain: '3410', dept: '34', lat: 43.399907, lon: 3.701918 },
  { id: 524, name: 'Marseille', coastDomain: '1310', dept: '13', lat: 43.278814, lon: 5.353758 },
  { id: 68, name: 'Toulon', coastDomain: '8310', dept: '83', lat: 43.11722, lon: 5.91306 },
  { id: 339, name: 'Nice', coastDomain: '0610', dept: '06', lat: 43.695508, lon: 7.285257 },
  { id: 300, name: 'Ajaccio', coastDomain: '2A10', dept: '2A', lat: 41.92279816, lon: 8.76284981 },
];

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const CHANGE_TOLERANCE_MS = 2 * 60_000;

function isoSeconds(ms) {
  return `${new Date(ms).toISOString().slice(0, 19)}Z`;
}

/** Observation d'un marégraphe entre deux instants (ms) ; source 1 = données brutes horaires de la minute. */
export function refmarUrl(id, from, to) {
  return `https://services.data.shom.fr/maregraphie/observation/json/${id}?sources=1&dtStart=${isoSeconds(from)}&dtEnd=${isoSeconds(to)}`;
}

/** Mesures { at, value } en ordre chronologique ; horodatage SHOM « AAAA/MM/JJ HH:MM:SS » en UTC ; valeur illisible écartée. */
export function parseRefmar(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.data)) throw new Error('mesures illisibles');
  const points = [];
  for (const d of json.data) {
    const m = /^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(d?.timestamp ?? ''));
    const value = Number(d?.value);
    if (!m || typeof d?.value !== 'number' || !Number.isFinite(value)) continue;
    const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
    points.push({ at: new Date(t).toISOString(), value });
  }
  return points.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** Une valeur toutes les 10 min (la mesure de la minute ronde, jamais une moyenne), plus la dernière mesure. */
export function downsampleTenMinutes(points) {
  const out = points.filter((p) => {
    const d = new Date(p.at);
    return d.getUTCMinutes() % 10 === 0 && d.getUTCSeconds() === 0;
  });
  const last = points.at(-1);
  if (last && out.at(-1)?.at !== last.at) out.push(last);
  return out;
}

/** Dernière mesure moins celle d'une heure avant, à 2 min près (la plus proche) ; null sans mesure assez proche. */
export function change1h(points) {
  const last = points.at(-1);
  if (!last) return null;
  const target = Date.parse(last.at) - HOUR_MS;
  let best = null;
  let bestGap = Infinity;
  for (const p of points) {
    const gap = Math.abs(Date.parse(p.at) - target);
    if (gap <= CHANGE_TOLERANCE_MS && gap < bestGap) { best = p; bestGap = gap; }
  }
  return best ? Math.round((last.value - best.value) * 10_000) / 10_000 : null;
}

export function emptySeaLevels(errors) {
  return { readAt: null, gauges: TIDE_GAUGES.map((g) => ({ ...g, lastAt: null, heightM: null, change1hM: null, series: [] })), predictionAvailable: false, errors };
}

/** Les 19 marégraphes, 4 à la fois, chacun en cache 10 min ; 200 si l'un répond, sinon 502 avec chaque panne nommée. */
export async function loadSeaLevels(now = Date.now()) {
  const readAt = new Date(now).toISOString();
  const results = await mapLimit(TIDE_GAUGES, 4, (g) => cachedSource(`env:refmar:${g.id}`, { ttlSec: 600, staleSec: DAY_MS / 1000, shared: false }, async () => {
    const points = parseRefmar(await fetchStrictJson(refmarUrl(g.id, now - DAY_MS, now), { timeoutMs: 15_000 }));
    if (points.length === 0) throw new Error('aucune mesure sur 24 h');
    return { points, readAt };
  }));
  const errors = [];
  let latestRead = null;
  const gauges = results.map((r, i) => {
    const g = TIDE_GAUGES[i];
    if (!r.ok) {
      errors.push(sourceError(`Marégraphe ${g.name}`, r.error));
      return { ...g, lastAt: null, heightM: null, change1hM: null, series: [] };
    }
    const { points } = r.value;
    const last = points.at(-1);
    if (latestRead === null || r.value.readAt > latestRead) latestRead = r.value.readAt;
    return { ...g, lastAt: last.at, heightM: last.value, change1hM: change1h(points), series: downsampleTenMinutes(points) };
  });
  return { readAt: latestRead, gauges, predictionAvailable: false, errors };
}
