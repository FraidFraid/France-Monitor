// api/_handlers/anticipation/note.js : note de 7 h de l'anticipation (04/11/2026). ?day=AAAA-MM-JJ ; sans jour : celle d'aujourd'hui si elle
// est figée, sinon la plus récente d'avant. 404 si absente, 400 si le jour est mal formé.
import { anticipationNote } from '../../_lib/anticipation/room.js';
import { handlePreflight, sendSourceJson } from '../../_lib/source-http.js';

export const CACHE_CONTROL = 's-maxage=60, stale-while-revalidate=300';

/** Paramètre de requête, lu sur `req.query` ou sur l'adresse. */
export function queryParam(req, name) {
  const q = req?.query?.[name];
  if (typeof q === 'string') return q;
  if (Array.isArray(q)) return typeof q[0] === 'string' ? q[0] : '';
  try { return new URL(req?.url ?? '', 'http://localhost').searchParams.get(name); } catch { return null; }
}

/** Date AAAA-MM-JJ qui existe vraiment au calendrier. */
const validDay = (v) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const t = Date.parse(`${v}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === v;
};

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const day = queryParam(req, 'day');
  if (day !== null && day !== undefined && !validDay(day)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({ error: 'jour invalide (AAAA-MM-JJ attendu)' });
    return;
  }
  const note = await anticipationNote(day || null, Date.now());
  if (!note) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).json({ error: 'note absente' });
    return;
  }
  sendSourceJson(res, note, { ok: true, cacheControl: CACHE_CONTROL });
}
