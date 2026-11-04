// api/_handlers/anticipation/bilan.js : bilan mensuel de l'anticipation (04/11/2026). ?month=AAAA-MM, mois de Paris courant par défaut.
import { anticipationBilan } from '../../_lib/anticipation/room.js';
import { handlePreflight, sendSourceJson } from '../../_lib/source-http.js';
import { queryParam } from './note.js';

export const CACHE_CONTROL = 's-maxage=300, stale-while-revalidate=600';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  const month = queryParam(req, 'month');
  if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({ error: 'mois invalide (AAAA-MM attendu)' });
    return;
  }
  sendSourceJson(res, await anticipationBilan(month || null, Date.now()), { ok: true, cacheControl: CACHE_CONTROL });
}
