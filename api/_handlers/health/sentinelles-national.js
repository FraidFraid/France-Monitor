// api/_handlers/health/sentinelles-national.js : taux nationaux du réseau Sentinelles (France hexagonale,
// cas vus en médecine générale pour 100 000 habitants) lus dans le flux RSS officiel (spec 2026-10-03
// panneaux santé § 2.3). Remplace sentinelles.js (API par région limitée en débit, moyenne non pondérée :
// IRA 175 affiché contre 151 officiel) et sentinelles-ingestion.js (URL /html erronée), routes retirées.
// Le flux n'a pas de champs : tout se lit dans le texte (« estimé à 151 cas pour 100 000 habitants (IC 95% [144 ; 158]) »).
import { HealthFetchError, cachedSource, cleanText, fetchStrictXml, handlePreflight, sendHealthJson, sourceError } from '../../_lib/health-http.js';

export const SENTIWEB_RSS_URL = 'https://www.sentiweb.fr/rss/fr/fr';
export const CACHE_CONTROL = 's-maxage=21600, stale-while-revalidate=86400';
const DAY_MS = 86_400_000;

/** Indicateurs dans l'ordre de la réponse ; COVID-19, grippe, VRS et bronchiolite sont des sous-indicateurs des IRA. */
export const INDICATORS = Object.freeze([
  { key: 'ira', label: 'Infections respiratoires aiguës', parent: null },
  { key: 'covid', label: 'COVID-19', parent: 'ira' },
  { key: 'grippe', label: 'Grippe', parent: 'ira' },
  { key: 'vrs', label: 'VRS', parent: 'ira' },
  { key: 'bronchiolite', label: 'Bronchiolite (moins d’un an)', parent: 'ira' },
  { key: 'diarrhee', label: 'Diarrhée aiguë', parent: null },
  { key: 'varicelle', label: 'Varicelle', parent: null },
]);

/** Intertitres des sous-indicateurs dans l'article IRA. */
const SUB_HEADINGS = [
  ['covid', /Covid-19\s*:\s*le taux/i],
  ['grippe', /Grippe\s*:\s*le taux/i],
  ['vrs', /Infection à VRS\s*:\s*le taux/i],
  ['bronchiolite', /Bronchiolite chez les enfants de moins d['’]un an\s*:\s*le taux/i],
];
const KNOWN_ACTIVITY = new Set(['faible', 'modérée', 'forte', 'très forte']);
const FEMININE = { faible: 'faible', 'modéré': 'modérée', fort: 'forte', 'élevé': 'élevée' };
const warnedActivity = new Set();

/** Lundi (AAAA-MM-JJ) de la semaine ISO `week` de l'année `year`. */
export function isoWeekMonday(year, week) {
  const jan4 = Date.UTC(year, 0, 4);
  const dow = new Date(jan4).getUTCDay() || 7;
  return new Date(jan4 - (dow - 1) * DAY_MS + (week - 1) * 7 * DAY_MS).toISOString().slice(0, 10);
}

/** Articles du flux : titre et lien en texte, description en HTML brut (CDATA retiré). */
export function parseRssItems(xml) {
  return [...String(xml ?? '').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((m) => {
    const tag = (name) => (new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i').exec(m[1])?.[1] ?? '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
    return { title: cleanText(tag('title')), description: tag('description'), link: cleanText(tag('link')) };
  });
}

const num = (s) => Number(String(s).replace(/[\s\u00a0]/g, ''));

/** Taux, IC 95 %, semaine précédente consolidée, tendance et niveau d'un paragraphe en texte. */
export function parseSegment(text) {
  const rate = /estimé à\s*(\d[\d\s\u00a0]*?)\s*cas pour 100\s*000 habitants/i.exec(text);
  const ci = /IC\s*95\s*%\s*\[\s*(\d+)\s*;\s*(\d+)\s*\]/i.exec(text);
  const previous = /données consolidées pour \d{4}s\d{2}\s*:\s*(\d+)/i.exec(text);
  const trend = /ce taux est\s+(.+?)\s+par rapport/i.exec(text);
  const level = /à un\s+(très\s+)?(faible|modéré|fort|élevé)e?\s+niveau d['’]activité/i.exec(text)
    ?? /niveau d['’]activité\s+(très\s+)?(faible|modéré|fort|élevé)e?(?![a-zà-ÿ])/i.exec(text);
  return {
    rate: rate ? num(rate[1]) : null,
    ciLow: ci ? Number(ci[1]) : null,
    ciHigh: ci ? Number(ci[2]) : null,
    previous: previous ? Number(previous[1]) : null,
    trend: trend ? trend[1].trim() : null,
    activity: level ? `${level[1] ? 'très ' : ''}${FEMININE[level[2].toLowerCase()]}` : null,
  };
}

/** « Activité faible en médecine générale » → « faible » ; libellé inconnu gardé brut et journalisé une fois. */
export function titleActivity(title) {
  const m = /Activité\s+(.+?)\s+en médecine générale/i.exec(title);
  if (!m) return null;
  const word = m[1].trim().toLowerCase();
  if (!KNOWN_ACTIVITY.has(word) && !warnedActivity.has(word)) {
    warnedActivity.add(word);
    console.warn(`[api/health/sentinelles-national] niveau d'activité inconnu : « ${word} »`);
  }
  return word;
}

/** Régions les plus touchées citées dans le texte : « Bretagne (254 [212 ; 296]) ». */
export function parseTopRegions(text, indicator) {
  const sentence = /observés en\s*:\s*(.+?\))\s*\./i.exec(text)?.[1] ?? '';
  return [...sentence.matchAll(/([A-ZÀ-ÖØ-Ý][^(),]*?)\s*\((\d+)\s*\[(\d+)\s*;\s*(\d+)\]\)/g)]
    .map((m) => ({ indicator, region: m[1].trim(), rate: Number(m[2]), ciLow: Number(m[3]), ciHigh: Number(m[4]) }));
}

/** Flux RSS → SentinellesNationalResponse (sans `errors`, ajouté par l'appelant). */
export function parseSentinellesRss(xml) {
  const items = parseRssItems(xml);
  const byKey = {
    ira: items.find((i) => /infection respiratoire aigu/i.test(i.title)),
    diarrhee: items.find((i) => /diarrh/i.test(i.title)),
    varicelle: items.find((i) => /varicelle/i.test(i.title)),
  };
  if (!byKey.ira && !byKey.diarrhee && !byKey.varicelle) throw new HealthFetchError('aucun article Sentinelles reconnu', { kind: 'parse' });
  const weekMatch = items.map((i) => /Semaine\s+(\d{4})(\d{2})/i.exec(i.title)).find(Boolean);
  const week = weekMatch ? (() => {
    const start = isoWeekMonday(Number(weekMatch[1]), Number(weekMatch[2]));
    return { id: `${weekMatch[1]}-S${weekMatch[2]}`, start, end: new Date(Date.parse(`${start}T00:00:00Z`) + 6 * DAY_MS).toISOString().slice(0, 10) };
  })() : null;

  const values = {};
  const topRegions = [];
  let provisional = false;
  for (const key of ['ira', 'diarrhee', 'varicelle']) {
    const item = byKey[key];
    if (!item) continue;
    const text = cleanText(item.description);
    provisional = provisional || /sous réserve de la consolidation/i.test(text);
    const cuts = SUB_HEADINGS.map(([k, re]) => ({ k, at: key === 'ira' ? text.search(re) : -1 })).filter((c) => c.at >= 0).sort((a, b) => a.at - b.at);
    const mainText = cuts.length > 0 ? text.slice(0, cuts[0].at) : text;
    values[key] = { ...parseSegment(mainText), activity: titleActivity(item.title) };
    cuts.forEach((c, i) => { values[c.k] = parseSegment(text.slice(c.at, cuts[i + 1]?.at)); });
    topRegions.push(...parseTopRegions(mainText, key));
  }
  const indicators = INDICATORS.map((ind) => ({
    key: ind.key, label: ind.label, parent: ind.parent,
    ...(values[ind.key] ?? { rate: null, ciLow: null, ciHigh: null, previous: null, trend: null, activity: null }),
  }));
  const bulletin = items.find((i) => /sentiweb hebdo/i.test(i.title));
  return { week, provisional, indicators, topRegions, bulletinUrl: bulletin?.link || null };
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  let body;
  try {
    const xml = await cachedSource('sentinelles:rss', { ttlSec: 6 * 3600 }, () => fetchStrictXml(SENTIWEB_RSS_URL));
    const parsed = parseSentinellesRss(xml);
    const errors = parsed.indicators[0].rate === null ? ['Sentinelles : taux national des IRA introuvable dans le flux'] : [];
    body = { ...parsed, errors };
  } catch (err) {
    body = { week: null, provisional: false, indicators: [], topRegions: [], bulletinUrl: null, errors: [sourceError('Sentinelles, flux RSS', err)] };
  }
  sendHealthJson(res, body, { ok: body.indicators.some((i) => i.rate !== null), cacheControl: CACHE_CONTROL });
}
