/**
 * rss-json-proxy.ts — Plugin Vite qui proxy les requêtes RSS et parse en JSON.
 * Utilisé par cyber.ts pour récupérer les alertes CERT-FR.
 *
 * Endpoint: /api/rss?url=<feed_url>
 * Response: { items: [{ title, link, pubDate, description }, ...] }
 */

import type { Plugin } from 'vite';

interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  description?: string;
}

/**
 * Parse RSS/Atom XML into structured JSON items
 */
function parseRssXml(xml: string): RssItem[] {
  const items: RssItem[] = [];

  // Try RSS 2.0 format first (<item> tags)
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

  // If no items found, try Atom format (<entry> tags)
  if (items.length === 0) {
    const entryMatches = xml.matchAll(/<entry[^>]*>([\s\S]*?)<\/entry>/gi);

    for (const match of entryMatches) {
      const entryXml = match[1];

      const title = extractTag(entryXml, 'title');
      // Atom uses <link href="..."/> format
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

function extractTag(xml: string, tagName: string): string | null {
  // Handle CDATA: <title><![CDATA[Content here]]></title>
  const cdataRegex = new RegExp(`<${tagName}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tagName}>`, 'i');
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) {
    return cdataMatch[1].trim();
  }

  // Handle regular tags: <title>Content here</title>
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, ''); // Strip HTML tags
}

export function rssJsonProxyPlugin(): Plugin {
  return {
    name: 'rss-json-proxy',
    configureServer(server) {
      // Register /api/rss endpoint (JSON output)
      server.middlewares.use('/api/rss', async (req, res) => {
        const url = new URL(req.url ?? '', 'http://localhost');
        const feedUrl = url.searchParams.get('url');

        console.log('[rss-json-proxy] Request for:', feedUrl);

        if (!feedUrl) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Missing ?url= parameter', items: [] }));
          return;
        }

        try {
          // User-Agent réaliste pour éviter les blocages anti-bot
          const userAgents = [
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          ];
          const ua = userAgents[Math.floor(Math.random() * userAgents.length)];

          console.log('[rss-json-proxy] Fetching:', feedUrl);

          const resp = await fetch(feedUrl, {
            headers: {
              'User-Agent': ua,
              'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml, */*',
              'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
              'Cache-Control': 'no-cache',
            },
            redirect: 'follow',
            signal: AbortSignal.timeout(10000),
          });

          if (!resp.ok) {
            console.error('[rss-json-proxy] Upstream error:', resp.status, resp.statusText);
            res.statusCode = resp.status;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({
              error: `Upstream HTTP ${resp.status}`,
              items: []
            }));
            return;
          }

          const xml = await resp.text();
          console.log('[rss-json-proxy] Received XML length:', xml.length);

          const items = parseRssXml(xml);
          console.log('[rss-json-proxy] Parsed items:', items.length);

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'public, max-age=300');
          res.end(JSON.stringify({ items }));

        } catch (err) {
          console.error('[rss-json-proxy] Fetch error:', feedUrl, err);
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            error: err instanceof Error ? err.message : 'Fetch failed',
            items: []
          }));
        }
      });
    },
  };
}
