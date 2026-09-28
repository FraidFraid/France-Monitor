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

  return dropPlaceholderDrafts(items);
}

/** Toute date antérieure est une date « zéro » de CMS (01/01/1970), pas une vraie publication. */
export const PLACEHOLDER_DATE_BEFORE_MS = Date.UTC(1971, 0, 1);

/**
 * @param {string | undefined} pubDate
 * @returns {boolean}
 */
export function isPlaceholderPubDate(pubDate) {
  if (!pubDate) return false;
  const time = Date.parse(pubDate);
  return !Number.isNaN(time) && time < PLACEHOLDER_DATE_BEFORE_MS;
}

/**
 * Items datés du 01/01/1970 : version provisoire pas encore publiée (vu sur imazpress.com, rubrique
 * france-monde : « Actualités du monde : <titre> » daté 1970, republié ~30 min plus tard avec son
 * vrai titre et sa vraie date sous le même lien). Dans un flux dont d'autres items sont datés, on les
 * écarte ; dans un flux qui ne date aucun item, on les garde avec l'heure de collecte, comme un item
 * sans date.
 * @template {{ pubDate: string }} T
 * @param {T[]} items
 * @returns {T[]}
 */
export function dropPlaceholderDrafts(items) {
  const placeholders = items.filter((item) => isPlaceholderPubDate(item.pubDate));
  if (placeholders.length === 0) return items;
  if (placeholders.length < items.length) {
    return items.filter((item) => !isPlaceholderPubDate(item.pubDate));
  }
  const now = new Date().toISOString();
  return items.map((item) => ({ ...item, pubDate: now }));
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
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // Entités numériques APRÈS &amp; : les flux doublement encodés (&amp;#039;) sont décodés.
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(Number(dec)))
    .replace(/<[^>]+>/g, '');
}

/**
 * Caractère d'une entité numérique. Hors plage (0, demi-substituts, > U+10FFFF) → U+FFFD :
 * fromCodePoint lèverait, et Postgres refuse le NUL.
 * @param {number} code
 * @returns {string}
 */
function safeCodePoint(code) {
  if (!Number.isInteger(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '�';
  return String.fromCodePoint(code);
}
