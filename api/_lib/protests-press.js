// api/_lib/protests-press.js : manifestations relevées dans la presse déjà ingérée (table news_items), ville par ville.
// Mesure du 17/10/2026 : ~200 titres « manif » en 48 h, dont la plupart classés « général / info » par le classifieur (bruit PQR) ;
// GDELT les place presque tous à « Paris » ou « France », la presse régionale nomme la ville (« 800 personnes rassemblées à Gap »).
// Lieu = villes et départements cités dans le TITRE (un titre « Lyon, Rennes, Marseille… » compte pour chaque ville), jamais le
// lieu stocké de l'article (repli sur la région du journal : un article du Progrès sur Paris serait placé à Lyon).
import { extractLocations, geocodeQuery } from './server-geocoder.js';
import { getDb, hasDatabaseUrl } from './db.js';
import { cachedSource, fetchStrictJson } from './source-http.js';
import { deptCommunes, indexCommunes, normalizeName } from './protests-demosphere.js';

export const PRESS_WINDOW_MS = 24 * 3_600_000;
const MAX_ROWS = 1500;
const MAX_ARTICLES = 8;

const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Mots qui suffisent seuls. « mobilisation » seulement dans ses tours militants (« mobilisation du 17 octobre », « journée de
// mobilisation ») : « Mobilisation générale des viticulteurs face à la flavescence » ou « les pompiers se mobilisent » n'en sont pas.
const STRONG = new RegExp([
  'manif(?:estation|estations|estant|estants|estent|ester|s)?\\b', 'rassembl', 'cortege', 'gilets? jaunes?', 'piquets? de greve',
  'grevistes', 'sit-?in', 'die-?in', 'marche blanche', 'intersyndicale', 'mobilisation (?:du \\d|des \\d|contre|sociale|lyceenne|syndicale|nationale|interprofessionnelle)',
  'journee (?:de mobilisation|d.action|de greve)', 'barrages? filtrants?', 'cortege sauvage',
].join('|'));
// Mots ambigus : comptent seulement avec un contexte militant (« route bloquée » par un accident n'en est pas, ni « les pompiers
// se mobilisent » pour un sauvetage).
const WEAK = /\bbloqu|\bblocage|\bbarrage|\bdefil(?:e|ent|aient)\b|\bont defile\b|\bgreve\b|\ben greve\b|(?<!\bse )\bmobilis/;
const CONTEXT = /lyceen|etudiant|syndica|\bcgt\b|\bcfdt\b|\bfo\b|agriculteur|militant|salaries|colere|vie chere|retraite|soignant|enseignant|pompiers|taxi|vtc|routier/;
// Titres qui ne rapportent pas une manifestation en cours : analyse, entretien, rappel historique, manifestation hors de France.
const NOT_EVENT = /^(?:entretien|tribune|edito|chronique|analyse|podcast|portrait|temoignage)\b|\bparoles? de\b|\bil y a \d+ ans\b|\bans apres\b|\barchives?\b|\banniversaire\b|\bdefile de mode\b|\bdefile militaire\b|\bcarnaval\b/;

/** Le titre rapporte-t-il une manifestation, un rassemblement, un blocage ou une grève militante ? */
export function isProtestHeadline(title) {
  const t = fold(title).replace(/[’']/g, "'");
  if (NOT_EVENT.test(t)) return false;
  if (STRONG.test(t)) return true;
  return WEAK.test(t) && CONTEXT.test(t);
}

// Heurts : affrontements, gaz lacrymogène, interpellations, incendies, intrusions. « Tensions » compte : c'est le mot de la presse
// pour les premiers heurts (« des tensions éclatent à Marseille »).
const VIOLENT = /heurt|affrontement|tension|lacrymo|interpell|incendi|en feu|barricade|attaqu|projectile|casse|degrad|canons? a eau|blesse|intrusion|envahi|investi|emeute|violences?\b|grenad/;

export function isViolentHeadline(title) {
  return VIOLENT.test(fold(title));
}

// Chiffre de participants cité (« 800 personnes rassemblées à Gap », « entre 150 et 200 manifestants ») : seulement si le titre ne
// cite qu'un lieu et ne parle ni d'un total national (« 32 800 manifestants dans les régions, vives tensions à Paris ») ni d'une
// prévision (« 40 000 personnes prévues à Paris »).
const COUNT = /(\d{1,3}(?:[\s  ]\d{3})*|\d+)\s+(?:manifestants|personnes|gilets jaunes|participants|lyceens|grevistes)\b/g;
// Marqueurs d'un total national, évalués PAR chiffre (sa proposition, ou la courte proposition qui la précède : « En France, 800 000
// manifestants ») : « 800 000 manifestants en France, 12 000 à Lyon » garde 12 000 pour Lyon et écarte 800 000.
const NATIONAL_COUNT = /\bfrance\b|\bpartout\b|\bpays\b|\bnational|\bsur tout le territoire\b|\btoute la nation\b|\bhexagone\b|\bensemble du territoire\b|\bun peu partout\b/;
// Marqueurs qui disqualifient tout le titre (total régional, prévision).
const NATIONAL = /\bregions?\b|\bministere\b|\bailleurs\b|\bprevue?s?\b|\battendue?s?\b|\benvisage/;
const WORD_COUNT = { une: 0, dizaine: 10, quinzaine: 15, vingtaine: 20, trentaine: 30, quarantaine: 40, cinquantaine: 50, soixantaine: 60, centaine: 100, millier: 1000 };
/** Un chiffre n'est jamais plus de 15 % des habitants de la commune : au-delà, c'est un total repris d'ailleurs. */
export const MAX_SHARE_OF_POPULATION = 0.15;
const CLAUSE_BREAK = /[,;:.()!?]/;

/** Vrai si le chiffre situé entre `index` et `end` porte un marqueur national dans sa proposition ou la courte proposition précédente. */
function isNationalCount(t, index, end) {
  let from = index;
  while (from > 0 && !CLAUSE_BREAK.test(t[from - 1])) from -= 1;
  let to = end;
  while (to < t.length && !CLAUSE_BREAK.test(t[to])) to += 1;
  const own = t.slice(from, to).replace(/[-']/g, ' ');
  if (NATIONAL_COUNT.test(own)) return true;
  if (from === 0) return false;
  let pFrom = from - 1;
  while (pFrom > 0 && !CLAUSE_BREAK.test(t[pFrom - 1])) pFrom -= 1;
  const prev = t.slice(pFrom, from - 1).replace(/[-']/g, ' ').trim();
  return prev.split(/\s+/).length <= 4 && NATIONAL_COUNT.test(prev);
}

/** Tous les chiffres locaux d'un titre (hors totaux nationaux), sans choix du plus grand. */
export function participantCandidates(title, placeCount) {
  const t = fold(title);
  if (placeCount !== 1 || NATIONAL.test(t)) return [];
  const out = [];
  for (const m of t.matchAll(COUNT)) {
    const n = Number(m[1].replace(/[\s  ]/g, ''));
    if (!Number.isFinite(n) || n <= 0 || isNationalCount(t, m.index, m.index + m[0].length)) continue;
    out.push(n);
  }
  if (out.length > 0) return out;
  const w = /(?<!plusieurs )\b(dizaine|quinzaine|vingtaine|trentaine|quarantaine|cinquantaine|soixantaine|centaine|millier)s? de (?:manifestants|personnes|gilets jaunes|lyceens)/.exec(t);
  return w && !isNationalCount(t, w.index, w.index + w[0].length) ? [WORD_COUNT[w[1]]] : [];
}

export function participantsOf(title, placeCount) {
  const all = participantCandidates(title, placeCount);
  return all.length > 0 ? Math.max(...all) : null;
}

/**
 * Population d'une commune (geo.api.gouv.fr, par coordonnées, sept jours de cache partagé) ; null si illisible : la plausibilité est
 * alors simplement non vérifiée, la source ne tombe jamais pour cela. Aucune liste de population dans le dépôt (CITIES = coordonnées).
 */
export async function communePopulation(place) {
  if (!place || place.dept) return null;
  try {
    const key = `${place.lat.toFixed(3)},${place.lon.toFixed(3)}`;
    return await cachedSource(`protests:population:${key}`, { ttlSec: 7 * 86_400 }, async () => {
      const list = await fetchStrictJson(`https://geo.api.gouv.fr/communes?lat=${place.lat}&lon=${place.lon}&fields=nom,population&format=json`, { timeoutMs: 8000 });
      const pop = Array.isArray(list) ? Number(list[0]?.population) : NaN;
      if (!Number.isFinite(pop) || pop <= 0) throw new Error('population absente');
      return pop;
    });
  } catch { return null; }
}

const domainOf = (url) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
};
// Même dépêche reprise par plusieurs titres du groupe (Le Progrès, Le Dauphiné, L'Est Républicain) : un seul article.
const titleKey = (title) => fold(title).replace(/^[a-z' -]{2,30}\.\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Départements d'outre-mer des journaux locaux (région du flux) : leurs communes passent avant les homonymes de métropole. */
export const OVERSEAS_FEED_DEPTS = Object.freeze({ 'La Réunion': '974', Guadeloupe: '971', Martinique: '972', Guyane: '973', Mayotte: '976' });

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Nom de voie ou de lieu-dit, pas de ville : « jusqu'à la place de Clichy », « porte de Versailles », « gare de Lyon ».
const isStreetName = (title, name) =>
  new RegExp(`\\b(?:place|porte|rue|avenue|boulevard|bd|pont|gare|quai|cours|rond-point|square|parc)\\s+(?:de\\s+|du\\s+|des\\s+|d['’]\\s*)?${escapeRe(fold(name))}\\b`)
    .test(fold(title));

/** Commune unique d'un index geo.api (outre-mer) pour un nom cité (« au Port » → Le Port), ou null. */
function localCommune(name, local) {
  if (!local) return null;
  const key = normalizeName(name);
  for (const k of [key, `le ${key}`, `la ${key}`, `les ${key}`]) {
    const found = local.byName.get(k);
    if (found?.length === 1) return { name: found[0].name, lat: found[0].lat, lon: found[0].lon, dept: false };
    if (found) return null;
  }
  return null;
}

/**
 * Lieux d'un titre : villes et départements nommés (jamais une région entière, jamais un nom de rue) ; un département cité à côté
 * d'une ville est écarté (« Isère. … à Grenoble » se passe à Grenoble). `resolve(nom)` rend `{ lat, lon, locationName, source }` ou
 * null (geocodeQuery en production, table fixe dans les tests) ; `local` = index des communes du département d'outre-mer du journal.
 */
export async function headlinePlaces(title, resolve = geocodeQuery, local = null) {
  const out = new Map();
  for (const name of extractLocations(title)) {
    if (isStreetName(title, name)) continue;
    const place = localCommune(name, local) ?? await (async () => {
      const r = await resolve(name);
      if (!r || r.source === 'regions' || !Number.isFinite(r.lat) || !Number.isFinite(r.lon)) return null;
      return { name: r.locationName, lat: r.lat, lon: r.lon, dept: r.source === 'departements' };
    })();
    if (!place) continue;
    const key = fold(place.name);
    if (!out.has(key)) out.set(key, place);
  }
  const places = [...out.values()];
  return places.some((p) => !p.dept) ? places.filter((p) => !p.dept) : places;
}

/**
 * Un relevé par lieu sur les 24 h : `rows` = `{ title, link, feed, region, at }` (at en ms). Titres sans manifestation ou sans lieu
 * écartés ; même dépêche reprise par plusieurs journaux comptée une fois ; heurts si un article du lieu en parle.
 */
export async function groupPress(rows, now, resolve = geocodeQuery, localByRegion = new Map(), population = null) {
  const byPlace = new Map();
  let matched = 0;
  let unplaced = 0;
  for (const row of rows) {
    if (!row.title || !/^https?:\/\//.test(row.link ?? '') || row.at < now - PRESS_WINDOW_MS || !isProtestHeadline(row.title)) continue;
    matched += 1;
    const places = await headlinePlaces(row.title, resolve, localByRegion.get(row.region) ?? null);
    if (places.length === 0) { unplaced += 1; continue; }
    const violent = isViolentHeadline(row.title);
    const candidates = participantCandidates(row.title, places.length);
    for (const place of places) {
      const key = `${place.lat.toFixed(3)},${place.lon.toFixed(3)}`;
      const group = byPlace.get(key) ?? { place, articles: new Map(), candidates: new Set() };
      const tk = titleKey(row.title);
      const prev = group.articles.get(tk);
      if (!prev || row.at > prev.at) group.articles.set(tk, { ...row, violent });
      for (const n of candidates) group.candidates.add(n);
      byPlace.set(key, group);
    }
  }
  // Un même chiffre (≥ 100) sur plusieurs lieux du relevé est un total repris partout, pas un chiffre local.
  const placesByValue = new Map();
  for (const [key, group] of byPlace) for (const n of group.candidates) placesByValue.set(n, (placesByValue.get(n) ?? new Set()).add(key));
  const items = [];
  for (const [key, group] of byPlace) {
    const pop = population && group.candidates.size > 0 ? await Promise.resolve(population(group.place)).catch(() => null) : null;
    const plausible = [...group.candidates].filter((n) => !(n >= 100 && placesByValue.get(n).size > 1)
      && !(Number.isFinite(pop) && pop > 0 && n > pop * MAX_SHARE_OF_POPULATION));
    group.participants = plausible.length > 0 ? Math.max(...plausible) : null;
    const articles = [...group.articles.values()].sort((a, b) => b.at - a.at);
    const violent = articles.some((a) => a.violent);
    items.push({
      id: `presse:${key}`,
      source: 'presse',
      status: 'signale',
      title: violent ? 'Heurts ou tensions' : 'Manifestation ou rassemblement',
      startsAt: new Date(articles[0].at).toISOString(),
      allDay: false,
      city: group.place.name,
      dept: null,
      lat: group.place.lat,
      lon: group.place.lon,
      url: articles[0].link,
      edition: null,
      violent,
      participants: group.participants,
      precision: group.place.dept ? 'departement' : 'commune',
      articles: articles.slice(0, MAX_ARTICLES).map((a) => ({
        url: a.link, domain: domainOf(a.link), seenAt: new Date(a.at).toISOString(), violent: a.violent, title: a.title, outlet: a.feed ?? null,
      })),
      place: null,
      articleCount: articles.length,
    });
  }
  return { items, matched, unplaced };
}

/** Index des communes d'outre-mer des journaux présents ; un département illisible est ignoré (repli sur le géocodeur). */
async function overseasIndexes(rows) {
  const regions = [...new Set(rows.map((r) => r.region))].filter((r) => Object.hasOwn(OVERSEAS_FEED_DEPTS, r));
  const out = new Map();
  await Promise.all(regions.map(async (region) => {
    try { out.set(region, indexCommunes(await deptCommunes(OVERSEAS_FEED_DEPTS[region]))); } catch { /* repli sur le géocodeur */ }
  }));
  return out;
}

// Préfiltre SQL large (le tri fin est fait par isProtestHeadline) : la base ne lit que les titres candidats des 24 h.
const SQL_PREFILTER = "(manif|rassembl|cort[eè]ge|gr[eè]v|bloqu|blocage|barrage|mobilis|gilets? jaunes?|d[ée]fil|sit-?in|intersyndicale|marche blanche)";

/**
 * Relevés presse des 24 h : `{ items, matched, unplaced, scanned }`. Lève sans DATABASE_URL (la source est alors nommée en panne).
 */
export async function loadPress(now) {
  if (!hasDatabaseUrl()) throw new Error('base des articles non configurée');
  return cachedSource('protests:presse', { ttlSec: 300, waitMs: 20_000 }, async () => {
    const sql = getDb();
    const rows = await sql.query(
      `SELECT n.title, n.link, f.name AS feed, f.region, COALESCE(n.published_at, n.collected_at) AS at
         FROM news_items n LEFT JOIN feeds f ON f.id = n.feed_id
        WHERE n.collected_at > $1 AND n.title ~* $2
        ORDER BY n.collected_at DESC LIMIT ${MAX_ROWS}`,
      [new Date(now - PRESS_WINDOW_MS - 6 * 3_600_000).toISOString(), SQL_PREFILTER],
    );
    const parsed = rows.map((r) => ({ title: r.title, link: r.link, feed: r.feed, region: r.region, at: new Date(r.at).getTime() }))
      .filter((r) => Number.isFinite(r.at) && r.at <= now + 3_600_000);
    const { items, matched, unplaced } = await groupPress(parsed, now, geocodeQuery, await overseasIndexes(parsed), communePopulation);
    return { items, matched, unplaced, scanned: rows.length };
  });
}
