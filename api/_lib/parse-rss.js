/**
 * api/_lib/parse-rss.js — Parsing RSS/Atom XML → items JSON.
 * Extrait de api/rss.js (Edge Function) pour réutilisation par l'ingestion serveur.
 *
 * IMPORTANT : ce module doit rester compatible Edge Runtime (api/rss.js l'importe).
 * → Uniquement des opérations string pures, aucune API Node-only.
 */

/**
 * Parse un flux RSS 2.0 ou Atom en liste d'items normalisés.
 * @param {string} xml
 * @returns {Array<{ title: string, link: string, pubDate: string, description: string | undefined }>}
 */
export function parseRssXml(xml) {
  const items = [];

  // RSS 2.0 : <item> tags
  const itemMatches = xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi);
  for (const match of itemMatches) {
    const itemXml = match[1];
    const title = extractTag(itemXml, 'title');
    const link = extractTag(itemXml, 'link') || extractTag(itemXml, 'guid');
    const pubDate = extractTag(itemXml, 'pubDate') || extractTag(itemXml, 'dc:date');
    const description = extractTag(itemXml, 'description');
    if (title && link) {
      items.push({
        title: decodeHtmlEntities(title),
        link,
        pubDate: pubDate || new Date().toISOString(),
        description: description ? decodeHtmlEntities(description).slice(0, 500) : undefined,
      });
    }
  }

  // Atom fallback : <entry> tags
  if (items.length === 0) {
    const entryMatches = xml.matchAll(/<entry[^>]*>([\s\S]*?)<\/entry>/gi);
    for (const match of entryMatches) {
      const entryXml = match[1];
      const title = extractTag(entryXml, 'title');
      const linkMatch = entryXml.match(/<link[^>]*href=["']([^"']+)["'][^>]*>/i);
      const link = linkMatch?.[1] || extractTag(entryXml, 'id');
      const pubDate = extractTag(entryXml, 'published') || extractTag(entryXml, 'updated');
      const description = extractTag(entryXml, 'summary') || extractTag(entryXml, 'content');
      if (title && link) {
        items.push({
          title: decodeHtmlEntities(title),
          link,
          pubDate: pubDate || new Date().toISOString(),
          description: description ? decodeHtmlEntities(description).slice(0, 500) : undefined,
        });
      }
    }
  }

  return items;
}

/**
 * Détecte si la réponse upstream est du XML de flux, du HTML ou inconnu.
 * @param {string} payload
 * @returns {'html' | 'xml' | 'unknown'}
 */
export function detectSourceFormat(payload) {
  const sample = String(payload || '').slice(0, 400).toLowerCase();
  if (
    sample.includes('<!doctype html') ||
    sample.includes('<html') ||
    sample.includes('<body') ||
    sample.includes('<app-root') ||
    sample.includes('ng-version')
  ) {
    return 'html';
  }
  if (sample.includes('<rss') || sample.includes('<feed') || sample.includes('<rdf:rdf')) {
    return 'xml';
  }
  return 'unknown';
}

/**
 * @param {string} xml
 * @param {string} tagName
 * @returns {string | null}
 */
export function extractTag(xml, tagName) {
  const cdataRegex = new RegExp(`<${tagName}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tagName}>`, 'i');
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

/**
 * @param {string} text
 * @returns {string}
 */
export function decodeHtmlEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, '');
}
