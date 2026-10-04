// api/_lib/vigicrues.js : vigilance crues par tronçon (spec 2026-10-04 environnement § 2.2). Lit le flux national
// InfoVigiCru (337 tronçons, sans clé), les territoires des services de prévision (SPC) et les stations de chaque tronçon
// en vigilance, puis leurs hauteurs et débits dans Hub'Eau (api/_lib/hubeau-stations.js). Le flux n'a pas d'heure de
// bulletin : la réponse est datée par le relevé du serveur (`readAt`). Les tracés sont ceux publiés par Vigicrues, sans
// recalage. Vigicrues ne publie pas les seuils de ses stations : aucune cote d'alerte n'est inventée.
import { mapLimit } from './map-limit.js';
import { cachedSource, fetchStrictJson, sourceError } from './source-http.js';
import { CODES_PER_REQUEST, buildStations, codesFingerprint, fetchObservations } from './hubeau-stations.js';

export const INFOVIGICRU_URL = 'https://www.vigicrues.gouv.fr/services/InfoVigiCru.geojson';
export const TERRITORIES_URL = 'https://www.vigicrues.gouv.fr/services/TerEntVigiCru.json';
/** Plafond de stations lues dans Hub'Eau (tronçons rouges, puis orange, puis jaunes, ordre du référentiel). */
export const MAX_STATIONS = 60;
const INFO_TTL_SEC = 600;
const REFERENTIAL_TTL_SEC = 86_400;
const HUBEAU_TTL_SEC = 600;
/** Attente de Hub'Eau par la route avant de répondre sans mesures (la lecture continue en arrière-plan). */
export const HUBEAU_WAIT_MS = 12_000;
/** Une valeur plus vieille que son TTL plus une minute a été servie parce que la relecture a échoué. */
const STALE_MARGIN_MS = 60_000;
/** Échéance totale de la route : le client abandonne à 20 s (health-surveillance.ts), la route répond avant. */
export const ROUTE_BUDGET_MS = 15_000;
/** Territoires et référentiels des tronçons : lectures annexes, bornées pour laisser sa place à Hub'Eau. */
const TERRITORIES_WAIT_MS = 4_000;
const SECTIONS_WAIT_MS = 6_000;

/** Stations d'un tronçon (la 302 vers /services/… est suivie par fetch). */
export function sectionStationsUrl(id) {
  return `https://www.vigicrues.gouv.fr/services/TronEntVigiCru.json?CdEntVigiCru=${encodeURIComponent(id)}&TypEntVigiCru=8`;
}

/** Page du territoire (service de prévision des crues) : « Méditerranée Ouest » pour 21. */
export function territoryUrl(code) {
  return `https://www.vigicrues.gouv.fr/territoire/${encodeURIComponent(code)}`;
}

/** Tracé publié : MultiLineString tel quel, LineString enveloppée ; points illisibles retirés ; rien d'autre. */
function pathOf(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return [];
  const lines = geometry.type === 'LineString' ? [geometry.coordinates] : geometry.type === 'MultiLineString' ? geometry.coordinates : [];
  return lines
    .filter(Array.isArray)
    .map((line) => line.filter((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])).map((p) => [p[0], p[1]]))
    .filter((line) => line.length >= 2);
}

/**
 * Lecture d'InfoVigiCru : niveaux par tronçon (NivInfViCr, 1 vert à 4 rouge), comptes, et tronçons jaunes, orange ou
 * rouges avec leur tracé publié et le code de leur territoire (`cdensup_1`). Lève sur une forme inattendue ; un tronçon
 * au niveau illisible est compté dans `unreadable`, jamais en vert.
 * @param {unknown} geojson
 */
export function parseInfoVigiCru(geojson) {
  if (!geojson || typeof geojson !== 'object' || !Array.isArray(geojson.features)) throw new Error('flux InfoVigiCru sans tronçons');
  const counts = { vert: 0, jaune: 0, orange: 0, rouge: 0 };
  const keys = { 1: 'vert', 2: 'jaune', 3: 'orange', 4: 'rouge' };
  const sections = [];
  let unreadable = 0;
  for (const f of geojson.features) {
    const p = f?.properties ?? {};
    const level = Number(p.NivInfViCr);
    const id = typeof p.CdEntCru === 'string' ? p.CdEntCru : null;
    if (!id || !Number.isInteger(level) || level < 1 || level > 4) {
      unreadable += 1;
      continue;
    }
    counts[keys[level]] += 1;
    if (level < 2) continue;
    sections.push({
      id,
      name: typeof p.lbentcru === 'string' && p.lbentcru.trim() ? p.lbentcru.trim() : id,
      level,
      territoryCode: typeof p.cdensup_1 === 'string' ? p.cdensup_1 : String(p.cdensup_1 ?? ''),
      path: pathOf(f.geometry),
    });
  }
  if (sections.length === 0 && counts.vert === 0) throw new Error('flux InfoVigiCru sans tronçon lisible');
  // Rouges d'abord, puis orange, puis jaunes ; ordre du flux à niveau égal (tri stable).
  sections.sort((a, b) => b.level - a.level);
  return { total: counts.vert + counts.jaune + counts.orange + counts.rouge, counts, sections, unreadable };
}

/** Territoires des SPC : code vers nom (« 21 » vers « Méditerranée Ouest »). Lève sur une forme inattendue. */
export function parseTerritories(json) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.ListEntVigiCru)) throw new Error('liste des territoires illisible');
  const out = {};
  for (const t of json.ListEntVigiCru) {
    if (t && typeof t.CdEntVigiCru === 'string' && typeof t.LbEntVigiCru === 'string') out[t.CdEntVigiCru] = t.LbEntVigiCru;
  }
  return out;
}

/** Stations d'un tronçon (entités filles de type 7), dans l'ordre du référentiel. Lève sur une forme inattendue. */
export function parseSectionStations(json) {
  const entity = Array.isArray(json?.ListEntVigiCru) ? json.ListEntVigiCru[0] : null;
  if (!entity || typeof entity !== 'object') throw new Error('référentiel du tronçon illisible');
  const children = Array.isArray(entity.aNMoinsUn) ? entity.aNMoinsUn : [];
  return children
    .filter((c) => c && String(c.TypEntVigiCruInferieur) === '7' && typeof c.CdEntVigiCruInferieur === 'string')
    .map((c) => ({ code: c.CdEntVigiCruInferieur, name: typeof c.LbEntVigiCruInferieur === 'string' ? c.LbEntVigiCruInferieur : c.CdEntVigiCruInferieur }));
}

function isStale(readAt, ttlSec, now) {
  const t = Date.parse(readAt);
  return Number.isFinite(t) && now - t > ttlSec * 1000 + STALE_MARGIN_MS;
}

function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Lectures en cours (clé de cache) : une valeur périmée servie pendant qu'une lecture court n'est pas un échec. */
const refreshing = new Set();

async function tracked(key, run) {
  refreshing.add(key);
  try {
    return await run();
  } finally {
    refreshing.delete(key);
  }
}

/** Mention d'un relevé périmé : « lecture en cours » si la relecture court encore, « lecture en échec » sinon. */
function staleNote(label, key) {
  return `${label} : relevé précédent servi (${refreshing.has(key) ? 'lecture en cours' : 'lecture en échec'})`;
}

/**
 * Lance `run` et rend son résultat, ou rejette à l'échéance (la lecture continue en arrière-plan et remplit le cache).
 * Échéance déjà passée : `run` n'est pas lancé.
 */
function withDeadline(run, ms) {
  if (ms <= 0) return Promise.reject(new Error("délai dépassé (échéance de la route)"));
  const work = run();
  work.catch(() => {});
  let timer;
  const late = new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('délai dépassé (échéance de la route)')), ms); });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/**
 * Hub'Eau, une grandeur : un cache par station (le changement de l'ensemble des tronçons en vigilance ne relance pas
 * la lecture des stations déjà lues) ; les stations à lire sont regroupées par paquets de 20 codes, une requête par
 * paquet. Erreurs nommées par grandeur, jamais un zéro.
 */
async function readGrandeur(codes, grandeur, label, now) {
  /** @type {Map<string, { resolve: (v: unknown) => void, reject: (e: unknown) => void }>} */
  const waiters = new Map();
  /** @type {string[]} */
  const queue = [];
  let scheduled = false;
  const flush = async () => {
    scheduled = false;
    const batch = queue.splice(0);
    await mapLimit(chunks(batch, CODES_PER_REQUEST), 2, async (chunk) => {
      try {
        const read = await fetchObservations(chunk, grandeur, now);
        const readAt = new Date(now).toISOString();
        for (const code of chunk) {
          waiters.get(code)?.resolve({ readAt, truncated: read.truncated, observations: read.observations.filter((o) => o.code_station === code) });
        }
      } catch (err) {
        for (const code of chunk) waiters.get(code)?.reject(err);
      }
    });
  };
  const request = (code) => new Promise((resolve, reject) => {
    waiters.set(code, { resolve, reject });
    queue.push(code);
    if (!scheduled) {
      scheduled = true;
      setTimeout(flush, 0);
    }
  });
  const results = await Promise.all(codes.map((code) => {
    const key = `env:hubeau:${grandeur}:${code}`;
    return cachedSource(key, { ttlSec: HUBEAU_TTL_SEC, staleSec: 3_600, shared: false }, () => tracked(key, () => request(code)))
      .then((value) => ({ ok: true, value, key }), (error) => ({ ok: false, error, key }));
  }));
  const observations = [];
  const readAts = [];
  const failures = new Set();
  let truncated = false;
  let staleKey = null;
  for (const r of results) {
    if (!r.ok) {
      failures.add(sourceError(label, r.error));
      continue;
    }
    observations.push(...r.value.observations);
    readAts.push(r.value.readAt);
    truncated ||= r.value.truncated;
    if (staleKey === null && isStale(r.value.readAt, HUBEAU_TTL_SEC, now)) staleKey = r.key;
  }
  const errors = [...failures];
  if (truncated) errors.push(`${label} : réponse coupée à 5 pages`);
  if (staleKey !== null) errors.push(staleNote(label, staleKey));
  return { observations, readAt: readAts.length > 0 ? readAts.sort()[0] : null, errors };
}

/** Erreur de la réponse partielle « Hub'Eau lent » : la route la met en cache 30 s seulement (voir le gestionnaire). */
export const HUBEAU_PENDING_ERROR = "Hub'Eau : lecture en cours, hauteurs à la prochaine relève";

/**
 * Hauteurs (H) et débits (Q) des stations, en parallèle. Hub'Eau répond en 10 à 40 s (mesuré le 04/10/2026 : 30 à 38 s
 * pour 20 stations sur 48 h) : au-delà de `waitMs`, la route répond sans mesures et le dit ; la lecture continue en
 * arrière-plan et remplit le cache pour la relève suivante (aucune valeur inventée en attendant).
 */
async function readStations(codes, now, waitMs) {
  const pending = Promise.all([readGrandeur(codes, 'H', "Hub'Eau", now), readGrandeur(codes, 'Q', "Hub'Eau, débits", now)]);
  pending.catch(() => {});
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), Math.max(0, waitMs)); });
  const done = await Promise.race([pending, late]);
  clearTimeout(timer);
  if (!done) return { h: { observations: [], readAt: null }, q: { observations: [] }, errors: [HUBEAU_PENDING_ERROR] };
  const [h, q] = done;
  return { h, q, errors: [...h.errors, ...q.errors] };
}

/**
 * Réponse complète (FloodsResponse) à l'instant `now`. 200 si InfoVigiCru est lu ou en cache (sa date reste celle du
 * relevé) ; territoires, stations et Hub'Eau en panne : erreurs partielles nommées, tronçons gardés.
 * @param {number} now
 * @param {{ hubeauWaitMs?: number, budgetMs?: number }} [options] `budgetMs` : échéance totale de la route (le client abandonne à 20 s)
 */
export async function loadFloods(now = Date.now(), { hubeauWaitMs = HUBEAU_WAIT_MS, budgetMs = ROUTE_BUDGET_MS } = {}) {
  const startedAt = Date.now();
  const remaining = () => budgetMs - (Date.now() - startedAt);
  /** @type {string[]} */
  const errors = [];
  let info = null;
  try {
    info = await withDeadline(() => cachedSource('env:vigicrues:info', { ttlSec: INFO_TTL_SEC, staleSec: 172_800, shared: false }, () => tracked('env:vigicrues:info', async () => ({
      readAt: new Date(now).toISOString(),
      ...parseInfoVigiCru(await fetchStrictJson(INFOVIGICRU_URL, { timeoutMs: 20_000 })),
    }))), remaining());
  } catch (err) {
    errors.push(sourceError('Vigicrues', err));
  }
  if (!info) {
    return {
      readAt: null, total: 0, counts: { vert: 0, jaune: 0, orange: 0, rouge: 0 }, sections: [],
      stationsReadAt: null, stationsOmitted: 0, errors,
    };
  }
  if (isStale(info.readAt, INFO_TTL_SEC, now)) errors.push(staleNote('Vigicrues', 'env:vigicrues:info'));
  if (info.unreadable > 0) errors.push(`Vigicrues : ${info.unreadable} tronçon${info.unreadable > 1 ? 's' : ''} au niveau illisible`);

  let territories = {};
  if (info.sections.length > 0) {
    try {
      territories = await withDeadline(() => cachedSource('env:vigicrues:territoires', { ttlSec: REFERENTIAL_TTL_SEC, staleSec: 7 * 86_400, shared: true },
        async () => parseTerritories(await fetchStrictJson(TERRITORIES_URL, { timeoutMs: 15_000 }))), Math.min(remaining(), TERRITORIES_WAIT_MS));
    } catch (err) {
      errors.push(sourceError('Vigicrues, territoires', err));
    }
  }

  const refsEnd = Date.now() + Math.min(remaining(), SECTIONS_WAIT_MS);
  const refsBySection = await mapLimit(info.sections, 4, (s) => withDeadline(() => cachedSource(
    `env:vigicrues:troncon:${s.id}`, { ttlSec: REFERENTIAL_TTL_SEC, staleSec: 7 * 86_400, shared: true },
    async () => parseSectionStations(await fetchStrictJson(sectionStationsUrl(s.id), { timeoutMs: 15_000 })),
  ), refsEnd - Date.now()));

  // Plafond de 60 stations distinctes, dans l'ordre des tronçons (rouges, orange, jaunes) puis du référentiel.
  const kept = new Set();
  let omitted = 0;
  const sectionRefs = info.sections.map((s, i) => {
    const r = refsBySection[i];
    if (!r.ok) {
      errors.push(sourceError(`Vigicrues, stations ${s.id}`, r.error));
      return [];
    }
    return r.value.filter((ref) => {
      if (kept.has(ref.code)) return true;
      if (kept.size >= MAX_STATIONS) {
        omitted += 1;
        return false;
      }
      kept.add(ref.code);
      return true;
    });
  });

  const codes = [...kept];
  let stationsReadAt = null;
  let hObs = [];
  let qObs = [];
  if (codes.length > 0) {
    const read = await readStations(codes, now, Math.min(hubeauWaitMs, remaining()));
    errors.push(...read.errors);
    hObs = read.h.observations;
    qObs = read.q.observations;
    stationsReadAt = read.h.readAt;
  }

  const sections = info.sections.map((s, i) => ({
    id: s.id,
    name: s.name,
    level: s.level,
    territory: { code: s.territoryCode, name: territories[s.territoryCode] ?? null, url: territoryUrl(s.territoryCode) },
    path: s.path,
    stations: buildStations(sectionRefs[i], hObs, qObs, now),
  }));

  return { readAt: info.readAt, total: info.total, counts: info.counts, sections, stationsReadAt, stationsOmitted: omitted, errors };
}
