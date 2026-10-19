// api/_lib/protests-demosphere.js : manifestations annoncées sur Démosphère, agenda militant participatif (spec 2026-10-17
// manifestations). Vérifié le 17/10/2026 : chaque édition publie `events.ics` (iCalendar, heures en UTC, `limit` accepté) ; GEO
// toujours « 0;0 », le lieu est un texte libre (« Toulouse 31200, Place Micoulaud », « Gare, … », « #Dunkerque ») ; l'agenda mêle
// manifestations, permanences, ateliers et fêtes : seul un titre de manifestation est gardé. Commune retrouvée dans le référentiel
// geo.api.gouv.fr des départements de l'édition (nom exact, code postal s'il est donné), jamais approchée ; sinon lieu inconnu.
import { cachedSource, cleanText, fetchStrictJson, fetchStrictText, sourceError } from './source-http.js';

/** Éditions françaises et départements qu'elles couvrent (les éditions étrangères de demosphere.net sont écartées). */
export const DEMOSPHERE_EDITIONS = Object.freeze([
  { key: 'paris', label: 'Paris / Île-de-France', depts: ['75', '92', '93', '94', '77', '78', '91', '95'] },
  { key: 'lille', label: 'Lille', depts: ['59', '62'] },
  { key: 'dunkerque', label: 'Dunkerque', depts: ['59', '62'] },
  { key: 'rennes', label: 'Rennes', depts: ['35'] },
  { key: 'sarthe', label: 'Sarthe', depts: ['72'] },
  { key: 'berry', label: 'Berry', depts: ['18', '36'] },
  { key: 'poitiers', label: 'Poitiers', depts: ['86'] },
  { key: 'gironde', label: 'Gironde', depts: ['33'] },
  { key: 'toulouse', label: 'Toulouse', depts: ['31'] },
  { key: 'pyrenees', label: 'Pyrénées', depts: ['31', '65', '09', '64'] },
  { key: 'ariege', label: 'Ariège', depts: ['09'] },
  { key: 'tarn', label: 'Tarn', depts: ['81'] },
  { key: 'lot', label: 'Lot', depts: ['46'] },
  { key: 'aveyron', label: 'Aveyron', depts: ['12'] },
  { key: 'carcassonne', label: 'Carcassonne', depts: ['11'] },
  { key: 'gard', label: 'Gard', depts: ['30'] },
  { key: 'nice', label: 'Nice', depts: ['06'] },
  { key: '05', label: 'Hautes-Alpes', depts: ['05'] },
  { key: 'strasbourgfurieuse', label: 'Strasbourg', depts: ['67', '68'] },
]);

/** Rendez-vous gardés : commencés depuis moins de 6 h, ou à venir dans les 7 jours. */
export const PAST_WINDOW_MS = 6 * 3_600_000;
export const FUTURE_WINDOW_MS = 7 * 86_400_000;
const FEED_TIMEOUT_MS = 15_000;
const FEED_TTL_SEC = 900;
const COMMUNES_TTL_SEC = 604_800;
const GEO_API_COMMUNES_URL = 'https://geo.api.gouv.fr/communes';

export const demosphereUrl = (key) => `https://${key}.demosphere.net/events.ics?limit=500`;
export const deptCommunesUrl = (dept) =>
  `${GEO_API_COMMUNES_URL}?codeDepartement=${encodeURIComponent(dept)}&fields=nom,code,centre,codeDepartement,codesPostaux&format=json`;

/** Minuscules sans accents, tirets et apostrophes en espaces, « st » et « ste » développés. */
export function normalizeName(text) {
  return String(text ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-'’_.#]/g, ' ')
    .replace(/\bste\b/g, 'sainte').replace(/\bst\b/g, 'saint')
    .replace(/\s+/g, ' ').trim();
}

// Titre de manifestation : un mot d'action. Un mot d'une autre activité placé AVANT lui l'écarte (« Formation sécurité en manif »,
// « Répète d'avant manif ») ; placé après, non (« Manifestation… suivie d'une assemblée »). « Marché » n'est pas « marche ».
const ACTION = /\bmanif|\bmanifestons\b|\brassembl|\bcortege|\bgreve|\bblocage|\bbloquons\b|\bpiquet de greve|\bmobilisation|\bsit in\b|\bdie in\b|\bchaine humaine|\boccupation\b|\bmarche (?:pour|contre|blanche|des|de la|du)\b/;
// Appel en tête de titre, sans mot d'action : « Ni congrès ni meeting pour le RN à Orléans », « Pas de congrès… », « Contre le flicage… »,
// « Free Palestine », « Stop… », éventuellement précédé d'« Appel national ». Gardé seulement si aucun mot d'une autre activité n'y figure
// (« Contre la guerre : conférence » reste écarté).
const CALL = /^(?:appel (?:national |unitaire )?(?:a |au |aux )?)?(?:ni [a-z]+ ni\b|pas de\b|pas d |non (?:a|au|aux)\b|contre (?:le|la|les|l)\b|stop\b|halte\b|free\b|liberez\b|liberte pour\b)/;
// Rassemblement silencieux ou statique nommé autrement.
const STATIC = /\bcercle de silence\b|\bveillee (?:pour|contre|de soutien)\b/;
const OTHER_ACTIVITY = /\bformation|\brepete|\brepetition|\bpermanence|\batelier|\bprojection|\breunion|\bconference|\bdebat|\bcafe\b|\bconcert|\brepas\b|\bcantine|\bfilm\b|\bspectacle|\bsoiree|\blecture|\brencontre/;

/** Vrai si le titre annonce une manifestation (et pas une formation, une permanence ou un marché). */
export function isProtestTitle(title) {
  // « Marché » (accentué) est lu « foire » avant de retirer les accents : il ne devient jamais « marche ».
  const text = normalizeName(String(title ?? '').replace(/march[éÉ]/gi, 'foire'));
  const action = ACTION.exec(text) ?? STATIC.exec(text);
  if (!action) return CALL.test(text) && !OTHER_ACTIVITY.test(text);
  const other = OTHER_ACTIVITY.exec(text);
  return !(other && other.index < action.index);
}

/** Décalage de Paris (ms) le jour donné, lu à midi UTC (heure d'été ou d'hiver). */
function parisOffsetMs(y, mo, d) {
  const noon = Date.UTC(y, mo - 1, d, 12);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).format(noon));
  return (hour - 12) * 3_600_000;
}

/** Date iCalendar en ms : `20261017T120000Z` (UTC), sans Z (heure de Paris) ou `20261017` (journée : minuit heure de Paris). */
export function icsTime(value, isDate = false) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(String(value ?? '').trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const [h, mi, s] = m[4] === undefined || isDate ? [0, 0, 0] : [Number(m[4]), Number(m[5]), Number(m[6])];
  const utc = Date.UTC(y, mo - 1, d, h, mi, s);
  return m[7] && !isDate ? utc : utc - parisOffsetMs(y, mo, d);
}

const unescapeIcs = (v) => String(v).replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

/**
 * Lieu de rendez-vous lisible d'un LOCATION : lignes jointes par « , », espaces normalisés, 200 caractères au plus ;
 * null si vide, réduit à « #Ville » ou au seul nom de la commune trouvée.
 */
export function cleanPlace(location, communeName = null) {
  const text = String(location ?? '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim().replace(/[\s,]+$/, '')).filter(Boolean)
    .join(', ').slice(0, 200).trim();
  if (!text || /^#/.test(text)) return null;
  if (communeName && normalizeName(text) === normalizeName(communeName)) return null;
  return text;
}

/** Rendez-vous d'un fichier iCalendar : `{ uid, title, start, allDay, location, url }` (start en ms, null si illisible). */
export function parseIcs(text) {
  const unfolded = String(text ?? '').replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '');
  const events = [];
  for (const block of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0];
    const field = (name) => {
      const m = new RegExp(`^${name}((?:;[^:\\n]*)?):(.*)$`, 'm').exec(body);
      return m ? { params: m[1], value: m[2] } : null;
    };
    const start = field('DTSTART');
    const allDay = Boolean(start && /VALUE=DATE(?!-)/.test(start.params));
    const url = field('URL')?.value.trim() || null;
    events.push({
      uid: field('UID')?.value.trim() || url,
      title: cleanText(unescapeIcs(field('SUMMARY')?.value ?? '')),
      start: start ? icsTime(start.value, allDay) : null,
      allDay,
      location: unescapeIcs(field('LOCATION')?.value ?? ''),
      url,
    });
  }
  return events;
}

/** Index des communes d'une liste geo.api.gouv.fr : par nom normalisé (plusieurs homonymes possibles) et par code postal. */
export function indexCommunes(list) {
  const byName = new Map();
  const byPostcode = new Map();
  for (const c of list) {
    const coords = c?.centre?.coordinates;
    if (typeof c?.nom !== 'string' || !Array.isArray(coords) || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) continue;
    const commune = { name: c.nom, dept: String(c.codeDepartement ?? ''), lon: coords[0], lat: coords[1] };
    const key = normalizeName(c.nom);
    byName.set(key, [...(byName.get(key) ?? []), commune]);
    for (const cp of Array.isArray(c.codesPostaux) ? c.codesPostaux : []) byPostcode.set(cp, [...(byPostcode.get(cp) ?? []), commune]);
  }
  return { byName, byPostcode };
}

/**
 * Commune d'un lieu Démosphère, ou null. Chaque morceau du lieu (lignes et virgules) est essayé dans l'ordre : nom exact d'une commune
 * (« Lille Moulins » essaie « lille moulins » puis « lille » ; « Paris 11e » donne Paris), restreint au code postal s'il est donné ; un
 * code postal d'une seule commune suffit. Un homonyme ambigu (deux communes du même nom) n'est jamais tranché.
 */
export function locateCommune(location, index) {
  const pieces = String(location ?? '').split(/[\n,]/).map((p) => p.trim()).filter(Boolean);
  const postcodes = String(location ?? '').match(/\b\d{5}\b/g) ?? [];
  for (const cp of postcodes) {
    const communes = index.byPostcode.get(cp) ?? [];
    if (communes.length === 1) {
      const named = pieces.some((p) => normalizeName(p.replace(/\b\d{5}\b/g, '')).includes(normalizeName(communes[0].name)));
      if (named || pieces.every((p) => !index.byName.has(normalizeName(p.replace(/\b\d{5}\b/g, ''))))) return communes[0];
    }
  }
  for (const piece of pieces) {
    const words = normalizeName(piece.replace(/\b\d{5}\b/g, '').replace(/\b\d+(?:e|er|eme)\b/gi, '')).split(' ').filter(Boolean);
    for (let n = words.length; n > 0; n -= 1) {
      const found = index.byName.get(words.slice(0, n).join(' '));
      if (!found) continue;
      const inPostcode = found.filter((c) => postcodes.some((cp) => (index.byPostcode.get(cp) ?? []).includes(c)));
      const pick = inPostcode.length === 1 ? inPostcode : found;
      if (pick.length === 1) return pick[0];
      break;
    }
  }
  return null;
}

/** Communes d'un département (référentiel stable, 7 jours de cache). Lève si la réponse n'en contient aucune. */
export async function deptCommunes(dept) {
  return cachedSource(`protests:communes:${dept}`, { ttlSec: COMMUNES_TTL_SEC }, async () => {
    const list = await fetchStrictJson(deptCommunesUrl(dept), { timeoutMs: FEED_TIMEOUT_MS });
    if (!Array.isArray(list) || list.length === 0) throw new Error(`aucune commune pour le département ${dept}`);
    return list.map((c) => ({ nom: c.nom, code: c.code, centre: c.centre, codeDepartement: c.codeDepartement, codesPostaux: c.codesPostaux }));
  });
}

/** Index des communes des départements d'une édition ; un département illisible est ignoré (ses lieux restent inconnus). */
async function editionIndex(edition) {
  const lists = await Promise.allSettled(edition.depts.map((d) => deptCommunes(d)));
  return indexCommunes(lists.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])));
}

export const nationalCommunesUrl = (name) =>
  `${GEO_API_COMMUNES_URL}?nom=${encodeURIComponent(name)}&fields=nom,centre,codeDepartement&limit=20&format=json`;

/** Morceaux nommables d'un lieu : lignes et virgules, sans code postal, numéro d'arrondissement ni signe. */
const locationPieces = (location) => String(location ?? '').split(/[\n,]/)
  .map((p) => p.replace(/\b\d{5}\b/g, '').replace(/\b\d+(?:e|er|eme)\b/gi, '').replace(/[#_]/g, ' ').trim())
  .filter((p) => p.length >= 3 && !/\d/.test(p));

/**
 * Secours national pour un lieu hors des départements de l'édition (« Montségur » annoncé par l'édition du Lot) : chaque morceau est
 * cherché dans tout le référentiel ; accepté seulement si une seule commune de France porte exactement ce nom (jamais une approchante).
 */
export async function locateNationally(location, lookup) {
  for (const piece of locationPieces(location)) {
    const list = await lookup(piece).catch(() => []);
    const exact = indexCommunes(list).byName.get(normalizeName(piece)) ?? [];
    if (exact.length === 1) return exact[0];
  }
  return null;
}

const nationalLookup = (name) => cachedSource(`protests:commune-nom:${normalizeName(name)}`, { ttlSec: COMMUNES_TTL_SEC }, async () => {
  const list = await fetchStrictJson(nationalCommunesUrl(name), { timeoutMs: FEED_TIMEOUT_MS });
  if (!Array.isArray(list)) throw new Error('liste de communes attendue');
  return list.map((c) => ({ nom: c.nom, centre: c.centre, codeDepartement: c.codeDepartement }));
});

/** Manifestations d'une édition dans la fenêtre, localisées si possible. */
export function protestsOfEdition(edition, events, index, now, fallback = new Map()) {
  const out = [];
  for (const ev of events) {
    if (ev.start === null || !ev.title || !isProtestTitle(ev.title)) continue;
    const end = ev.allDay ? ev.start + 86_400_000 : ev.start + PAST_WINDOW_MS;
    if (end < now || ev.start > now + FUTURE_WINDOW_MS) continue;
    const commune = locateCommune(ev.location, index) ?? fallback.get(ev.location) ?? null;
    out.push({
      id: `demosphere:${ev.uid ?? `${edition.key}:${ev.start}:${ev.title}`}`,
      source: 'demosphere',
      status: 'annonce',
      title: ev.title,
      startsAt: new Date(ev.start).toISOString(),
      allDay: ev.allDay,
      city: commune?.name ?? null,
      dept: commune?.dept || null,
      lat: commune?.lat ?? null,
      lon: commune?.lon ?? null,
      url: ev.url,
      place: cleanPlace(ev.location, commune?.name),
      edition: edition.label,
      violent: false,
      participants: null,
      precision: commune ? 'commune' : null,
      articles: [],
      articleCount: 0,
    });
  }
  return out;
}

// Mots trop courants pour dire que deux annonces parlent du même rendez-vous.
const COMMON_WORDS = new Set(['rassemblement', 'manifestation', 'contre', 'pour', 'avec', 'appel', 'national', 'nationale', 'devant', 'place', 'octobre',
  'novembre', 'decembre', 'janvier', 'fevrier', 'mars', 'avril', 'juin', 'juillet', 'aout', 'septembre', 'samedi', 'dimanche', 'meeting']);
const significantWords = (title) => new Set(normalizeName(title).split(' ').filter((w) => w.length >= 5 && !COMMON_WORDS.has(w)));

/**
 * Même rendez-vous relayé par plusieurs éditions (l'appel national pour Orléans l'est par dix) : même commune, départs à moins de 2 h
 * d'écart et au moins un mot significatif en commun. Le premier est gardé, avec le lieu le plus détaillé ; les éditions qui le relaient
 * sont jointes par « · ».
 */
export function mergeRelays(items) {
  const kept = [];
  for (const item of items) {
    const words = significantWords(item.title);
    const twin = item.city === null ? undefined : kept.find((k) => k.city === item.city && k.dept === item.dept
      && Math.abs(Date.parse(k.startsAt) - Date.parse(item.startsAt)) <= 2 * 3_600_000
      && [...significantWords(k.title)].some((w) => words.has(w)));
    if (!twin) { kept.push({ ...item }); continue; }
    if (item.edition && !String(twin.edition ?? '').split(' · ').includes(item.edition)) twin.edition = twin.edition ? `${twin.edition} · ${item.edition}` : item.edition;
    // Lieu le plus précis des relais (« Orléans, Place Sainte-Croix, 45000 Orléans » plutôt que « Orléans, Orléans »).
    if (item.place && item.place.length > String(twin.place ?? '').length) twin.place = item.place;
  }
  return kept;
}

/**
 * Toutes les éditions : `{ items, editions, failedEditions, scanned, errors }`. Une édition en panne est nommée et n'empêche pas les
 * autres ; un même rendez-vous publié par deux éditions (même fiche) n'est gardé qu'une fois. Lève si aucune édition n'a répondu.
 */
export async function loadDemosphere(now) {
  const reads = await Promise.allSettled(DEMOSPHERE_EDITIONS.map(async (edition) => {
    const events = await cachedSource(`protests:demosphere:${edition.key}`, { ttlSec: FEED_TTL_SEC }, async () => {
      const text = await fetchStrictText(demosphereUrl(edition.key), { timeoutMs: FEED_TIMEOUT_MS });
      if (!text.includes('BEGIN:VCALENDAR')) throw new Error('calendrier iCalendar attendu');
      return parseIcs(text);
    });
    const candidates = events.filter((ev) => ev.title && isProtestTitle(ev.title));
    const index = candidates.length > 0 ? await editionIndex(edition) : indexCommunes([]);
    const fallback = new Map();
    for (const ev of candidates) {
      if (fallback.has(ev.location) || locateCommune(ev.location, index)) continue;
      fallback.set(ev.location, await locateNationally(ev.location, nationalLookup));
    }
    return { scanned: events.length, items: protestsOfEdition(edition, events, index, now, fallback) };
  }));
  const items = new Map();
  const failedEditions = [];
  const errors = [];
  let scanned = 0;
  reads.forEach((r, i) => {
    if (r.status === 'rejected') {
      failedEditions.push(DEMOSPHERE_EDITIONS[i].label);
      errors.push(sourceError(`Démosphère ${DEMOSPHERE_EDITIONS[i].label}`, r.reason));
      return;
    }
    scanned += r.value.scanned;
    for (const item of r.value.items) if (!items.has(item.id)) items.set(item.id, item);
  });
  if (failedEditions.length === DEMOSPHERE_EDITIONS.length) throw new Error(errors[0] ?? 'aucune édition lisible');
  return { items: mergeRelays([...items.values()]), editions: DEMOSPHERE_EDITIONS.length - failedEditions.length, failedEditions, scanned, errors };
}
