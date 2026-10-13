// api/_lib/asnr.js : événements de sûreté publiés par l'ASNR (spec 2026-10-13 ASNR sûreté). Sources publiques sans clé, vérifiées le
// 13/10/2026 : flux RSS (10 items mêlés, texte complet ; l'URL sans « ?q= » redirige par meta refresh), liste des actualités (16 cartes
// par page, 13 pages) et page de chaque avis. Classement sur le TITRE seul : tout texte ASNR contient « Autorité de sûreté nucléaire et
// de radioprotection ». Site : centrale EDF cherchée dans le titre, puis dans le texte ; jamais de site deviné hors des 19 centrales.
import { kvReadJson, kvWriteJson } from './kv-history.js';
import { mapLimit } from './map-limit.js';
import { cachedSource, cachedSourceReport, cleanText, decodeEntities, fetchStrictHtml, fetchStrictXml, sourceError } from './source-http.js';

export const ASNR_ORIGIN = 'https://www.asnr.fr';
export const ASNR_RSS_URL = `${ASNR_ORIGIN}/rss.xml?q=/rss.xml`;
export const asnrListUrl = (page) => `${ASNR_ORIGIN}/actualites?page=${page}`;

/** Centrales EDF : identifiant et nom de src/config/infrastructure.ts (alignés par un test), motif sur le texte replié. Tricastin couvre aussi Orano Tricastin (même site). */
export const ASNR_PLANTS = [
  ['nuc-gravelines', 'Gravelines', /\bgravelines\b/], ['nuc-blayais', 'Blayais', /\bblayais\b/], ['nuc-bugey', 'Bugey', /\bbugey\b/],
  ['nuc-cattenom', 'Cattenom', /\bcattenom\b/], ['nuc-chinon', 'Chinon', /\bchinon\b/], ['nuc-chooz', 'Chooz', /\bchooz\b/],
  ['nuc-civaux', 'Civaux', /\bcivaux\b/], ['nuc-cruas', 'Cruas-Meysse', /\bcruas\b/], ['nuc-dampierre', 'Dampierre-en-Burly', /\bdampierre\b/],
  ['nuc-flamanville', 'Flamanville', /\bflamanville\b/], ['nuc-golfech', 'Golfech', /\bgolfech\b/],
  ['nuc-nogent', 'Nogent-sur-Seine', /\bnogent-sur-seine\b/], ['nuc-paluel', 'Paluel', /\bpaluel\b/], ['nuc-penly', 'Penly', /\bpenly\b/],
  ['nuc-saint-alban', 'Saint-Alban', /\bsaint-alban\b/], ['nuc-saint-laurent', 'Saint-Laurent-des-Eaux', /\bsaint-laurent-des-eaux\b/],
  ['nuc-tricastin', 'Tricastin', /\btricastin\b/], ['nuc-belleville', 'Belleville-sur-Loire', /\bbelleville-sur-loire\b/],
  ['nuc-fessenheim', 'Fessenheim', /\bfessenheim\b/],
];

const fold = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’‘]/g, "'");

const CRISIS = /\bactive son centre de crise\b/;
const EVENT = /\bincident\b|\bevenement (?:radiologique|significatif)|\bcontamination (?:externe|interne)\b|\birradiation\b|\bincendie (?:maitrise )?(?:a|dans)\b|\bfuite\b|\brepli du reacteur\b/;
const NOT_EVENT = /\b(?:bilan|analyse|statistiques|rapport|retrace|projet|guide|barometre)\b/;
const RADIOPROTECTION = /radioprotection|contamination|irradiation|exposition|radiologique|hospices|hopita|\bchu\b|institut|clinique|medecine nucleaire|radiotherapie|laboratoire|musee|transport/;
const INES = /niveau\s+(\d)\s+(?:de|sur)\s+l'echelle\s+ines/g;

/** URL absolue sans requête, fragment ni barre finale (clé du journal) ; null si illisible. */
export function canonicalUrl(href) {
  try {
    const u = new URL(String(href).trim(), ASNR_ORIGIN);
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/** Centrale EDF nommée : titre d'abord, puis texte ; dans un même texte, la première citée. */
export function matchPlant(title, text = '') {
  for (const source of [fold(title), fold(text)]) {
    let best = null;
    for (const [id, name, re] of ASNR_PLANTS) {
      const m = re.exec(source);
      if (m && (best === null || m.index < best.index)) best = { id, name, index: m.index };
    }
    if (best) return { id: best.id, name: best.name };
  }
  return null;
}

/** Groupe d'un avis d'après son titre ; null hors sûreté (thèses, inspections, bilans, vie de l'institution). */
export function classifyAsnr(title, text = '') {
  const t = fold(title);
  if (CRISIS.test(t)) return 'crise';
  if (!EVENT.test(t) || NOT_EVENT.test(t)) return null;
  if (matchPlant(title, text)) return 'installation';
  return RADIOPROTECTION.test(t) ? 'radioprotection' : 'installation';
}

/** Niveau INES lu dans le texte (« au niveau 2 de l'échelle INES »), le plus haut cité ; null si absent. */
export function parseInes(text) {
  let max = null;
  for (const m of fold(text).matchAll(INES)) {
    const n = Number(m[1]);
    if (n <= 7 && (max === null || n > max)) max = n;
  }
  return max;
}

const PARIS_DAY = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Items du flux RSS : jour de Paris tiré de `<time datetime>` de la description, à défaut de pubDate. */
export function parseAsnrRss(xml) {
  const text = String(xml ?? '');
  if (!/<channel[\s>]/.test(text)) throw new Error('flux RSS illisible');
  const items = [];
  let undated = 0;
  for (const block of text.split(/<item>/).slice(1)) {
    const tag = (name) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block)?.[1] ?? '';
    const url = canonicalUrl(decodeEntities(tag('link')));
    const title = cleanText(tag('title'));
    const descHtml = decodeEntities(tag('description').replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, ''));
    const pub = Date.parse(tag('pubDate'));
    const date = /<time datetime="(\d{4}-\d{2}-\d{2})/.exec(descHtml)?.[1] ?? (Number.isFinite(pub) ? PARIS_DAY.format(pub) : null);
    if (!url || !title) continue;
    if (!date) { undated += 1; continue; }
    items.push({ url, title, date, text: cleanText(descHtml) });
  }
  return { items, undated };
}

/** Cartes d'une page de la liste des actualités (sans texte) ; aucune carte : erreur (maquette changée, jamais « 0 avis »). */
export function parseAsnrListPage(html) {
  const cards = String(html ?? '').split('irsn-related-card__link').slice(1);
  if (cards.length === 0) throw new Error('aucune actualité lisible');
  const items = [];
  let undated = 0;
  for (const card of cards) {
    const href = /href="([^"]+)"/.exec(card)?.[1];
    const url = href ? canonicalUrl(decodeEntities(href)) : null;
    const title = cleanText(/irsn-related-card__title[^>]*>([\s\S]*?)<\/div>/.exec(card)?.[1] ?? '');
    const d = /fr-card__date[^>]*>\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(card);
    if (!url || !title) continue;
    if (!d) { undated += 1; continue; }
    items.push({ url, title, date: `${d[3]}-${d[2]}-${d[1]}`, text: null });
  }
  return { items, undated, cards: cards.length };
}

/** Texte lisible du contenu principal d'un avis (`<main>`) ; sans `<main>` : erreur. */
export function parseAsnrDetail(html) {
  const main = /<main[\s\S]*?<\/main>/.exec(String(html ?? ''))?.[0];
  if (!main) throw new Error('page d’avis illisible');
  return cleanText(main.replace(/<script[\s\S]*?<\/script>/g, ' '));
}

// ── Chargeur et journal ───────────────────────────────────────────────────────

export const ASNR_LOG_KEY = 'nuc:asnr:log';
const DAY_MS = 86_400_000;
const LOG_MAX_AGE_MS = 365 * DAY_MS;
const LOG_TTL_SEC = 400 * 86_400;
const FETCH_TIMEOUT_MS = 20_000;
const TTL_SEC = 3_600;
/** Relevé encore servi sans panne : 1 h de cache après une lecture d'au plus FETCH_TIMEOUT_MS. */
const FRESH_READ_MS = TTL_SEC * 1000 + FETCH_TIMEOUT_MS;
const CACHE = { ttlSec: TTL_SEC, staleSec: 7 * 86_400, shared: true, waitMs: 2 * FETCH_TIMEOUT_MS + 5_000 };
const DETAIL_CACHE = { ttlSec: 30 * 86_400, staleSec: 30 * 86_400, shared: true, waitMs: FETCH_TIMEOUT_MS + 5_000 };
const LAST_PAGE = 12;
const PAGE_SIZE = 16;
const DETAIL_LIMIT = 4;
const MAX_DETAILS_PER_RUN = 12;
export const ASNR_STALE_SERVED_ERROR = 'ASNR : source indisponible, relevé précédent servi';
export const ASNR_LOG_READ_ERROR = 'ASNR : journal indisponible, relevé non enregistré';

const slugOf = (url) => url.split('/').pop() ?? url;
const inWindow = (date, now) => Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && now - Date.parse(`${date}T00:00:00Z`) <= LOG_MAX_AGE_MS;

/** Fusion de deux relevés d'un même avis : date la plus ancienne, INES le plus haut (jamais abaissé), site et texte complétés. */
export function mergeEvent(old, next) {
  const ines = old.ines === null ? next.ines : next.ines === null ? old.ines : Math.max(old.ines, next.ines);
  return {
    ...old, ...next,
    date: old.date < next.date ? old.date : next.date,
    ines,
    plantId: next.plantId ?? old.plantId,
    site: next.site ?? old.site,
    textRead: Boolean(old.textRead || next.textRead),
  };
}

/** Item lu → entrée du journal ; null s'il n'est pas un événement de sûreté. */
function toEntry(item) {
  const text = item.text ?? '';
  const kind = classifyAsnr(item.title, text);
  if (kind === null) return null;
  const plant = matchPlant(item.title, text);
  return {
    id: `asnr-${slugOf(item.url)}`, url: item.url, title: item.title, date: item.date, kind,
    ines: parseInes(text), plantId: plant?.id ?? null, site: plant?.name ?? null, textRead: item.text !== null,
  };
}

async function readText(url, expect) {
  return expect === 'xml' ? fetchStrictXml(url, { timeoutMs: FETCH_TIMEOUT_MS }) : fetchStrictHtml(url, { timeoutMs: FETCH_TIMEOUT_MS });
}

/** Relevé horaire : RSS et page 0 ; une partie en panne est nommée, les deux en panne : erreur (rien n'est mis en cache). */
async function readFeed(now) {
  const errors = [];
  const items = [];
  let undated = 0;
  let ok = 0;
  try {
    const rss = parseAsnrRss(await readText(ASNR_RSS_URL, 'xml'));
    items.push(...rss.items); undated += rss.undated; ok += 1;
  } catch (err) { errors.push(sourceError('ASNR (flux RSS)', err)); }
  try {
    const page = parseAsnrListPage(await readText(asnrListUrl(0), 'html'));
    items.push(...page.items); undated += page.undated; ok += 1;
  } catch (err) { errors.push(sourceError('ASNR (actualités)', err)); }
  if (ok === 0) throw new Error(errors.join(' ; '));
  return { readAt: new Date(now).toISOString(), items, undated, errors };
}

/** Rattrapage unique : pages 1 à 12 jusqu'à la première page de plus de 12 mois ou incomplète. Rend { items, done }. */
async function backfill(now, errors) {
  const items = [];
  for (let page = 1; page <= LAST_PAGE; page += 1) {
    let read;
    try {
      read = parseAsnrListPage(await readText(asnrListUrl(page), 'html'));
    } catch (err) {
      errors.push(sourceError(`ASNR (actualités, page ${page})`, err));
      return { items, done: false };
    }
    items.push(...read.items);
    const oldest = read.items.reduce((min, i) => (i.date < min ? i.date : min), '9999-12-31');
    if (!inWindow(oldest, now) || read.cards < PAGE_SIZE) break;
  }
  return { items, done: true };
}

/** Texte des avis retenus jamais lus (au plus MAX_DETAILS_PER_RUN, DETAIL_LIMIT à la fois) ; un avis en panne reste à lire. */
async function withDetails(entries, errors) {
  const pending = entries.filter((e) => !e.textRead).slice(0, MAX_DETAILS_PER_RUN);
  const results = await mapLimit(pending, DETAIL_LIMIT, async (e) => {
    const { value, error } = await cachedSourceReport(`nuc:asnr:detail:${slugOf(e.url)}`, DETAIL_CACHE, `ASNR ${slugOf(e.url)}`,
      async () => parseAsnrDetail(await readText(e.url, 'html')));
    if (error) errors.push(error);
    return value;
  });
  const texts = new Map();
  pending.forEach((e, i) => {
    const r = results[i];
    if (r.ok) texts.set(e.id, r.value);
    else errors.push(sourceError(`ASNR ${slugOf(e.url)}`, r.error));
  });
  return entries.map((e) => {
    const text = texts.get(e.id);
    if (text === undefined) return e;
    const plant = matchPlant(e.title, text);
    return mergeEvent(e, { ...e, kind: classifyAsnr(e.title, text) ?? e.kind, ines: parseInes(text), plantId: plant?.id ?? null, site: plant?.name ?? null, textRead: true });
  });
}

const publicEvent = ({ textRead: _textRead, ...e }) => e;
const byDateDesc = (a, b) => (a.date === b.date ? a.title.localeCompare(b.title, 'fr') : a.date < b.date ? 1 : -1);

/** Réponse de /api/nuclear/asnr : journal de 12 mois mis à jour par le relevé horaire. */
export async function loadAsnr(now) {
  const errors = [];
  const stored = await kvReadJson(ASNR_LOG_KEY, now);
  if (stored.failed) errors.push(ASNR_LOG_READ_ERROR);
  const log = stored.value && Array.isArray(stored.value.events) ? stored.value : { backfilledAt: null, events: [] };

  let readAt = null;
  let items = [];
  try {
    const feed = await cachedSource('nuc:asnr:feed', CACHE, () => readFeed(now));
    readAt = feed.readAt;
    items = feed.items;
    errors.push(...feed.errors);
    if (now - Date.parse(feed.readAt) > FRESH_READ_MS) errors.push(ASNR_STALE_SERVED_ERROR);
    if (feed.undated > 0) errors.push(`ASNR : ${feed.undated} actualité(s) sans date lisible écartée(s)`);
  } catch (err) {
    errors.push(sourceError('ASNR', err));
  }

  let backfilledAt = log.backfilledAt;
  if (readAt !== null && backfilledAt === null && !stored.failed) {
    const more = await backfill(now, errors);
    items = [...items, ...more.items];
    if (more.done) backfilledAt = new Date(now).toISOString();
  }

  const byId = new Map(log.events.filter((e) => inWindow(e.date, now)).map((e) => [e.id, e]));
  for (const item of items) {
    if (!inWindow(item.date, now)) continue;
    const entry = toEntry(item);
    if (entry === null) continue;
    const old = byId.get(entry.id);
    byId.set(entry.id, old ? mergeEvent(old, entry) : entry);
  }
  const events = (await withDetails([...byId.values()], errors)).sort(byDateDesc);

  const next = { backfilledAt, events };
  if (!stored.failed && JSON.stringify(next) !== JSON.stringify(log)) await kvWriteJson(ASNR_LOG_KEY, next, LOG_TTL_SEC, now);
  errors.sort();
  return { readAt, events: events.map(publicEvent), errors };
}
