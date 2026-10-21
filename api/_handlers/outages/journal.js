// api/_handlers/outages/journal.js : journal des pannes (control room, spec 2026-10-21 § 5.3) : GET /api/outages/journal?since=ISO|ms,
// 24 h par défaut, 7 jours au plus. Toujours 200 : `{ entries }`, plus récentes d'abord.
import { JOURNAL_MAX_AGE_MS, roomJournal } from '../../_lib/outages-room.js';
import { handlePreflight, sendSourceJson } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=60, stale-while-revalidate=120';
const DAY_MS = 24 * 3600 * 1000;

/** `since` lu en ISO ou en millisecondes ; absent ou illisible : 24 h ; borné à 7 jours. */
export function sinceOf(raw, now) {
  const n = raw === null || raw === undefined || raw === '' ? Number.NaN : /^\d+$/.test(String(raw)) ? Number(raw) : Date.parse(String(raw));
  return Math.max(Number.isFinite(n) ? n : now - DAY_MS, now - JOURNAL_MAX_AGE_MS);
}

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const now = Date.now();
  const since = sinceOf(new URL(req.url ?? '/', 'http://local').searchParams.get('since'), now);
  sendSourceJson(res, { entries: await roomJournal(since, now) }, { ok: true, cacheControl: CACHE_CONTROL });
}
