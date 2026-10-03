// api/_handlers/health/alert-levels.js : niveaux d'alerte épidémique par région (Odissé, grippe et
// bronchiolite) et bulletins régionaux Santé publique France des DROM (spec 2026-10-03 panneaux santé § 2.2).
// Échelle corrigée : 1 pas d'alerte, 2 pré-épidémie, 3 épidémie, 4 post-épidémie (4 revient toujours à 1).
// Remplace la lecture d'epidemic-alerts.js (échelle inversée, niveau 2 masqué, sous-titre codé en dur) et
// d'epidemiology-monitor.js (limit=400 refusé) ; ces deux routes sont retirées en tâche 19.
import { cachedSource, cleanText, fetchStrictHtml, handlePreflight, sendHealthJson, sourceError, HealthFetchError } from '../../_lib/health-http.js';
import { fetchExport, odsDate } from '../../_lib/odisse.js';

export const ALERTS_DATASET = 'ma_region_epidemies_hivernales_alertes';
const DAY_MS = 86_400_000;
const LOOKBACK_DAYS = 400;
export const BULLETIN_WINDOW_DAYS = 45;
const BULLETINS_PER_REGION = 3;
export const CACHE_CONTROL = 's-maxage=3600, stale-while-revalidate=21600';
const SPF_ORIGIN = 'https://www.santepubliquefrance.fr';

/** Régions publiées par Odissé avec un libellé ; 07 et 08 (sans libellé) sont écartés et comptés. */
export const REGION_NAMES = Object.freeze({
  '01': 'Guadeloupe', '02': 'Martinique', '03': 'Guyane', '04': 'La Réunion', '06': 'Mayotte',
  '11': 'Île-de-France', '24': 'Centre-Val de Loire', '27': 'Bourgogne-Franche-Comté', '28': 'Normandie',
  '32': 'Hauts-de-France', '44': 'Grand Est', '52': 'Pays de la Loire', '53': 'Bretagne', '75': 'Nouvelle-Aquitaine',
  '76': 'Occitanie', '84': 'Auvergne-Rhône-Alpes', '93': 'Provence-Alpes-Côte d’Azur', '94': 'Corse',
});

const PATHOLOGY = Object.freeze({ grippe: 'grippe', bronchiolite: 'bronchiolite' });
const PATHOLOGY_ORDER = ['grippe', 'bronchiolite'];

export const SPF_REGIONS = Object.freeze([
  { slug: 'ocean-indien', label: 'Océan Indien', url: `${SPF_ORIGIN}/regions-et-territoires/ocean-indien` },
  { slug: 'guyane', label: 'Guyane', url: `${SPF_ORIGIN}/regions-et-territoires/guyane` },
  { slug: 'antilles', label: 'Antilles', url: `${SPF_ORIGIN}/regions-et-territoires/antilles` },
]);

// Bulletins de surveillance sanitaire seulement (repris d'epidemic-alerts.js) ; bilans de santé mentale,
// de vaccination ou de nutrition écartés.
const HEALTH_RE = /surveillance sanitaire|grippe|bronchiolite|covid|chikungunya|dengue|chol[ée]ra|paludisme|leptospirose|arbovir|gastro|rougeole|virus|mpox/i;
const EXCLUDE_RE = /conduites suicidaires|suicide|vaccination|couverture vaccinale|sant[ée] mentale|tabac|nutrition/i;

function weekEnd(start) {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  return d.toISOString().slice(0, 10);
}

/**
 * Lignes Odissé → dernière ligne publiée par région et pathologie (RegionalAlertLevel), codes sans
 * libellé écartés, semaine la plus récente.
 */
export function buildAlertLevels(rows) {
  const latest = new Map();
  const ignored = new Set();
  for (const row of rows) {
    const region = String(row?.reg ?? '').trim();
    const pathology = PATHOLOGY[String(row?.theme ?? '').trim().toLowerCase()];
    const phase = Number(row?.valeur);
    const start = String(row?.date ?? '');
    const week = String(row?.date_lib ?? '');
    if (!pathology || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-S\d{2}$/.test(week)) continue;
    if (!Object.hasOwn(REGION_NAMES, region)) {
      if (region) ignored.add(region);
      continue;
    }
    if (![1, 2, 3, 4].includes(phase)) continue;
    const key = `${region}|${pathology}`;
    const prev = latest.get(key);
    if (prev && prev.start >= start) continue;
    latest.set(key, { region, regionName: REGION_NAMES[region], pathology, phase, week, start });
  }
  const levels = [...latest.values()].sort((a, b) =>
    (a.region < b.region ? -1 : a.region > b.region ? 1 : PATHOLOGY_ORDER.indexOf(a.pathology) - PATHOLOGY_ORDER.indexOf(b.pathology)));
  const last = levels.reduce((best, l) => (!best || l.start > best.start ? l : best), null);
  return {
    levels,
    ignoredRegionCodes: [...ignored].sort(),
    latestWeek: last ? { id: last.week, start: last.start, end: weekEnd(last.start) } : null,
  };
}

function absoluteSpfUrl(href) {
  const path = href.replace(/^https?:\/\/www\.santepubliquefrance\.fr/, '').replace(/^\/index\.php\//, '/');
  return `${SPF_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Cartes « bulletin régional » d'une page région SPF : titre, date de publication, lien. */
export function parseBulletinCards(html) {
  const cards = [];
  for (const chunk of String(html ?? '').split(/<article\b/i).slice(1)) {
    const card = chunk.split(/<\/article>/i)[0];
    const href = /href="((?:https?:\/\/www\.santepubliquefrance\.fr)?\/[^"]*\/bulletin-regional\/[^"#?]+)"/i.exec(card)?.[1];
    const date = /datetime="(\d{4}-\d{2}-\d{2})/i.exec(card)?.[1];
    const title = cleanText(/<h3[^>]*class="[^"]*card-title[^"]*"[^>]*>([\s\S]*?)<\/h3>/i.exec(card)?.[1] ?? '');
    if (!href || !date || !title) continue;
    cards.push({ title, date, url: absoluteSpfUrl(href) });
  }
  return cards;
}

const TERRITORY_WORDS = [['mayotte', 'Mayotte'], ['reunion', 'La Réunion'], ['guyane', 'Guyane'], ['martinique', 'Martinique'], ['guadeloupe', 'Guadeloupe'], ['antilles', 'Antilles']];

/** Territoire nommé par le titre (« à La Réunion », « aux Antilles ») ; sinon la région de la page. */
export function bulletinTerritory(title, fallback) {
  const t = String(title).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (t.includes('guadeloupe') && t.includes('martinique')) return 'Antilles';
  return TERRITORY_WORDS.find(([word]) => t.includes(word))?.[1] ?? fallback;
}

/** « Points clés » d'un bulletin : « Arboviroses : Cas sporadiques. · Gastro-entérite : … » (500 caractères au plus). */
export function bulletinSummary(html) {
  const text = String(html ?? '');
  const at = text.search(/<h2[^>]*>\s*Points cl[ée]s\s*<\/h2>/i);
  if (at < 0) return '';
  const block = text.slice(at, text.indexOf('</div>', at) > at ? text.indexOf('</div>', at) : undefined);
  const parts = [];
  for (const m of block.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>\s*<ul[^>]*>([\s\S]*?)<\/ul>/gi)) {
    const head = cleanText(m[1]);
    const first = cleanText(/<li[^>]*>([\s\S]*?)<\/li>/i.exec(m[2])?.[1] ?? '');
    if (head && first) parts.push(`${head} : ${first}`);
  }
  if (parts.length === 0) {
    for (const m of block.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) parts.push(cleanText(m[1]));
  }
  const summary = parts.filter(Boolean).join(' · ');
  return summary.length <= 500 ? summary : `${summary.slice(0, summary.lastIndexOf(' ', 499))}…`;
}

async function regionBulletins(region, now, errors) {
  const html = await cachedSource(`alerts:spf:${region.slug}`, { ttlSec: 3600 }, () => fetchStrictHtml(region.url));
  const since = new Date(now - BULLETIN_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  const cards = parseBulletinCards(html)
    .filter((c) => c.date >= since && HEALTH_RE.test(c.title) && !EXCLUDE_RE.test(c.title))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, BULLETINS_PER_REGION);
  return Promise.all(cards.map(async (card) => {
    let summary = '';
    try {
      summary = bulletinSummary(await cachedSource(`alerts:bulletin:${card.url}`, { ttlSec: 3600 }, () => fetchStrictHtml(card.url)));
    } catch (err) {
      errors.push(sourceError(`Santé publique France, bulletin du ${card.date.slice(8, 10)}/${card.date.slice(5, 7)} (${region.label})`, err));
    }
    return { territory: bulletinTerritory(card.title, region.label), title: card.title, date: card.date, url: card.url, summary };
  }));
}

/** Réponse complète (AlertLevelsResponse) ; Odissé et chaque page régionale échouent séparément. */
export async function loadAlertLevels(now = Date.now()) {
  const errors = [];
  let built = { levels: [], ignoredRegionCodes: [], latestWeek: null };
  try {
    const since = new Date(now - LOOKBACK_DAYS * DAY_MS).toISOString().slice(0, 10);
    const rows = await cachedSource('alerts:odisse', { ttlSec: 3 * 3600 }, async () => {
      const r = await fetchExport(ALERTS_DATASET, { select: 'theme,reg,date_lib,date,valeur', where: `date>=${odsDate(since)}`, orderBy: 'date desc' });
      if (r.length === 0) throw new HealthFetchError('aucune ligne', { kind: 'empty' });
      return r;
    });
    built = buildAlertLevels(rows);
  } catch (err) {
    errors.push(sourceError('Odissé, niveaux d’alerte', err));
  }
  const bulletins = [];
  await Promise.all(SPF_REGIONS.map(async (region) => {
    try {
      bulletins.push(...await regionBulletins(region, now, errors));
    } catch (err) {
      errors.push(sourceError(`Santé publique France, page ${region.label}`, err));
    }
  }));
  bulletins.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.title.localeCompare(b.title, 'fr')));
  return { levels: built.levels, bulletins, latestWeek: built.latestWeek, ignoredRegionCodes: built.ignoredRegionCodes, errors: errors.sort() };
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await loadAlertLevels();
  const failedEverywhere = body.levels.length === 0 && body.bulletins.length === 0 && body.errors.length > 0;
  sendHealthJson(res, body, { ok: !failedEverywhere, cacheControl: CACHE_CONTROL });
}
