// api/_handlers/health/dgs-messages.js : messages DGS-Urgent et MARS du ministère de la Santé
// (spec 2026-10-03 panneaux santé § 2.5). Le site du ministère bloque toute lecture automatique (captcha
// Cegedim) : aucun contournement. Les messages sont lus sur la page publique du portail PEPS
// (https://peps.sante.gouv.fr/actu/actualites.html, sans captcha), qui les relaie ; un message peut manquer.
import { HealthFetchError, cachedSource, cleanText, fetchStrictHtml, handlePreflight, sendHealthJson, sourceError } from '../../_lib/health-http.js';

export const PEPS_URL = 'https://peps.sante.gouv.fr/actu/actualites.html';
const PEPS_BASE = 'https://peps.sante.gouv.fr/actu/';
/** Page officielle DGS-Urgent : lien affiché, jamais lue (captcha). */
export const DGS_URGENT_OFFICIAL_URL = 'https://sante.gouv.fr/ministere/informations-pratiques/site/dgs-urgent';
export const CACHE_CONTROL = 's-maxage=21600, stale-while-revalidate=86400';
const WINDOW_DAYS = 365;

// « DGS-Urgent n°2026_12, version REPLY du 28/09/2026 : titre », « MARS n°2026_14 du 22/09/2026 : titre »,
// « Version erratum du MARS n°2026_02 du 06/02/2026 : titre », « DGS-Urgent n°2026-02 du 04/02/2026 - titre ».
const MESSAGE_RE = /(DGS-Urgent|MARS)\s+n°\s*(\d{4})[-_](\d{2,3})(,\s*version REPLY)?\s+du\s+(\d{2})\/(\d{2})\/(\d{4})\s*[:\-–]\s*(.+)$/i;

function absoluteUrl(href) {
  try {
    const url = new URL(href, PEPS_BASE);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Ordre d'affichage : date décroissante, puis DGS-Urgent avant MARS, puis numéro décroissant. */
function compareMessages(a, b) {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  if (a.kind !== b.kind) return a.kind === 'DGS-Urgent' ? -1 : 1;
  return a.number < b.number ? 1 : a.number > b.number ? -1 : 0;
}

/**
 * Liens de la page PEPS → messages DGS-Urgent et MARS (MinistryMessage) des douze derniers mois, dédoublonnés
 * par type et numéro : la version la plus récente l'emporte (une version REPLY ou un erratum remplace l'originale).
 */
export function parseMinistryMessages(html, now) {
  const since = new Date(now - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  const byKey = new Map();
  for (const m of String(html ?? '').matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = cleanText(m[2]);
    const parts = MESSAGE_RE.exec(text);
    if (!parts) continue;
    const kind = parts[1].toUpperCase() === 'MARS' ? 'MARS' : 'DGS-Urgent';
    const message = {
      kind,
      number: `${parts[2]}-${parts[3]}`,
      date: `${parts[7]}-${parts[6]}-${parts[5]}`,
      title: parts[8].trim(),
      url: absoluteUrl(m[1]),
      reply: Boolean(parts[4]) || /erratum/i.test(text),
    };
    if (message.date < since) continue;
    const key = `${kind}|${message.number}`;
    const prev = byKey.get(key);
    if (!prev || message.date > prev.date || (message.date === prev.date && message.reply && !prev.reply)) byKey.set(key, message);
  }
  return [...byKey.values()].sort(compareMessages);
}

/**
 * Réponse complète (MinistryMessagesResponse). La page est analysée avant mise en cache : une page sans message reconnu
 * n'est jamais figée et la dernière liste lue reste servie ; la fenêtre de douze mois est réappliquée à chaque réponse.
 */
export async function loadMinistryMessages(now = Date.now()) {
  const base = { sourceUrl: PEPS_URL, officialUrl: DGS_URGENT_OFFICIAL_URL };
  try {
    const read = await cachedSource('dgs:peps:messages', { ttlSec: 6 * 3600 }, async () => {
      const parsed = parseMinistryMessages(await fetchStrictHtml(PEPS_URL, { timeoutMs: 20_000 }), now);
      if (parsed.length === 0) throw new HealthFetchError('aucun message DGS-Urgent ni MARS reconnu', { kind: 'parse' });
      return parsed;
    });
    const since = new Date(now - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
    return { messages: read.filter((m) => m.date >= since), ...base, errors: [] };
  } catch (err) {
    return { messages: [], ...base, errors: [sourceError('PEPS, messages DGS-Urgent et MARS', err)] };
  }
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const body = await loadMinistryMessages();
  sendHealthJson(res, body, { ok: body.messages.length > 0, cacheControl: CACHE_CONTROL });
}
