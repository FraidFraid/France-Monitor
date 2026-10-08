// api/_lib/cybermalveillance.js : alertes et actualités de Cybermalveillance.gouv.fr (flux Atom, GIP ACYMA ; spec 2026-10-04
// souveraineté § 2.3 ; contrats § 2.4). Titre, date et lien seulement (licence non publiée dans le flux) ; entités HTML décodées.
// Les dates `published` sont publiées sans fuseau, en heure de Paris (« 2026-09-15 10:54:02 »). Lecture toutes les heures.
import { parisLocalToIso } from './paris-time.js';
import { extractTag } from './parse-rss.js';
import { cachedSource, cleanText, fetchStrictXml, sourceError } from './source-http.js';

export const CYBERMALVEILLANCE_FEEDS = {
  alertes: 'https://www.cybermalveillance.gouv.fr/feed/atom-flux-alertes',
  actualites: 'https://www.cybermalveillance.gouv.fr/feed/atom-flux-actualites',
};
export const CYBERMALVEILLANCE_TTL_SEC = 3_600;
const FEED_LABEL = { alertes: 'alertes', actualites: 'actualités' };

/** Date Atom : avec fuseau, telle quelle (ISO UTC) ; « AAAA-MM-JJ HH:MM:SS » sans fuseau : heure de Paris ; null si illisible. */
function atomDate(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  return parisLocalToIso(s.replace(' ', 'T'));
}

/**
 * Entrées d'un flux Atom de Cybermalveillance.gouv.fr, dans l'ordre du flux : titre (entités décodées), lien, publication et mise à
 * jour (ISO UTC). Une entrée sans titre ou sans lien est écartée ; un flux vide rend une liste vide.
 * @param {string} xml
 * @param {'alertes' | 'actualites'} feed
 */
export function parseAtom(xml, feed) {
  const out = [];
  for (const m of String(xml ?? '').matchAll(/<entry[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const entry = m[1];
    const title = cleanText(extractTag(entry, 'title') ?? '');
    const url = (/<link[^>]*href=["']([^"']+)["'][^>]*>/i.exec(entry)?.[1] ?? extractTag(entry, 'id') ?? '').trim();
    if (!title || !/^https?:\/\//.test(url)) continue;
    out.push({ feed, title, url, published: atomDate(extractTag(entry, 'published')), updated: atomDate(extractTag(entry, 'updated')) });
  }
  return out;
}

/**
 * Les deux flux (`{ readAt, entries, errors }`), relus toutes les heures ; un flux en panne est nommé (« Cybermalveillance, alertes :
 * HTTP 503 »), l'autre est servi. `readAt` : lecture réussie la plus récente ; null si aucun flux n'a jamais été lu.
 * @param {number} now
 */
export async function loadCybermalveillance(now) {
  const parts = await Promise.all(Object.entries(CYBERMALVEILLANCE_FEEDS).map(async ([feed, url]) => {
    try {
      const value = await cachedSource(`sov:cybermalveillance:${feed}`, { ttlSec: CYBERMALVEILLANCE_TTL_SEC, staleSec: 7 * 86_400, shared: true },
        async () => ({ readAt: new Date(now).toISOString(), entries: parseAtom(await fetchStrictXml(url, { timeoutMs: 15_000 }), feed) }));
      return { ok: true, value };
    } catch (err) {
      return { ok: false, error: sourceError(`Cybermalveillance, ${FEED_LABEL[feed]}`, err) };
    }
  }));
  const read = parts.filter((p) => p.ok).map((p) => p.value);
  const readAts = read.map((v) => v.readAt).sort();
  return {
    readAt: readAts.at(-1) ?? null,
    entries: read.flatMap((v) => v.entries),
    errors: parts.filter((p) => !p.ok).map((p) => p.error),
  };
}
