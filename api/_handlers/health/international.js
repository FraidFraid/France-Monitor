// api/_handlers/health/international.js : veille internationale (spec 2026-10-03 panneaux santé § 2.5).
// OMS Disease Outbreak News (API OData, tri par date de publication : les numéros DON ne sont pas
// chronologiques) et rapport hebdomadaire des menaces de l'ECDC (RSS, trois derniers, sujets de la description).
// Titres traduits par le dictionnaire de api/_lib/health-terms.js ; terme inconnu : titre original.
import { HealthFetchError, cachedSource, cleanText, decodeEntities, fetchStrictJson, fetchStrictXml, handlePreflight, sendHealthJson, sourceError } from '../../_lib/health-http.js';
import { translateEcdcTitle, translateOutbreakTitle, translateTopic } from '../../_lib/health-terms.js';

export const WHO_DON_URL = `https://www.who.int/api/news/diseaseoutbreaknews?${new URLSearchParams({
  $top: '10', $orderby: 'PublicationDateAndTime desc', $select: 'DonId,Title,PublicationDateAndTime,UrlName,Summary',
}).toString()}`;
export const ECDC_CDTR_URL = 'https://www.ecdc.europa.eu/en/taxonomy/term/1505/feed';
export const CACHE_CONTROL = 's-maxage=3600, stale-while-revalidate=21600';
const SUMMARY_MAX = 400;

function shorten(text, max) {
  return text.length <= max ? text : `${text.slice(0, text.lastIndexOf(' ', max - 1))}…`;
}

const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);

/** Réponse OData de l'OMS → messages (OutbreakNews), plus récents d'abord. */
export function parseWhoDon(json) {
  const items = Array.isArray(json?.value) ? json.value : [];
  return items
    .filter((v) => typeof v?.DonId === 'string' && typeof v?.Title === 'string' && typeof v?.PublicationDateAndTime === 'string')
    .map((v) => {
      const originalTitle = cleanText(v.Title);
      return {
        id: v.DonId,
        title: translateOutbreakTitle(originalTitle) ?? originalTitle,
        originalTitle,
        date: v.PublicationDateAndTime,
        url: `https://www.who.int/emergencies/disease-outbreak-news/item/${encodeURIComponent(v.DonId)}`,
        summary: shorten(cleanText(v.Summary ?? ''), SUMMARY_MAX),
      };
    })
    .sort(byDateDesc);
}

/**
 * Sujets d'un rapport ECDC : « … includes updates on A, B and C. » → [A, B, C] traduits quand ils sont connus.
 * La description du flux est du HTML échappé (&lt;p&gt;) : décodée avant d'être réduite en texte.
 */
export function ecdcTopics(descriptionHtml) {
  const text = cleanText(decodeEntities(descriptionHtml));
  const list = /includes updates on\s+(.+?)\.?\s*$/i.exec(text)?.[1] ?? '';
  return list.split(/,\s*(?:and\s+)?|\s+and\s+/).map((s) => s.trim()).filter(Boolean).map(translateTopic);
}

/** Flux RSS ECDC → trois derniers rapports (EcdcReport). */
export function parseEcdcFeed(xml) {
  return [...String(xml ?? '').matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)]
    .map((m) => {
      const tag = (name) => new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i').exec(m[1])?.[1] ?? '';
      const date = new Date(cleanText(tag('pubDate')));
      return {
        title: translateEcdcTitle(cleanText(tag('title'))),
        date: Number.isNaN(date.getTime()) ? '' : date.toISOString(),
        url: cleanText(tag('link')),
        topics: ecdcTopics(tag('description')),
      };
    })
    .filter((r) => r.date && r.url.startsWith('https://'))
    .sort(byDateDesc)
    .slice(0, 3);
}

function nonEmpty(items, message) {
  if (items.length === 0) throw new HealthFetchError(message, { kind: 'empty' });
  return items;
}

/** Réponse complète (InternationalResponse) ; OMS et ECDC échouent séparément. */
export async function loadInternational() {
  const errors = [];
  const [who, ecdc] = await Promise.all([
    cachedSource('international:who', { ttlSec: 3600 }, () => fetchStrictJson(WHO_DON_URL)).then((json) => nonEmpty(parseWhoDon(json), 'aucun message'))
      .catch((err) => { errors.push(sourceError('OMS, Disease Outbreak News', err)); return []; }),
    cachedSource('international:ecdc', { ttlSec: 3600 }, () => fetchStrictXml(ECDC_CDTR_URL)).then((xml) => nonEmpty(parseEcdcFeed(xml), 'aucun rapport'))
      .catch((err) => { errors.push(sourceError('ECDC, rapport hebdomadaire des menaces', err)); return []; }),
  ]);
  return { who, ecdc, errors: errors.sort() };
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await loadInternational();
  sendHealthJson(res, body, { ok: body.who.length > 0 || body.ecdc.length > 0, cacheControl: CACHE_CONTROL });
}
