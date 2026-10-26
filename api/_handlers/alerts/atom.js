// api/_handlers/alerts/atom.js : GET /api/alerts/atom, flux Atom des alertes (api/_lib/alerts.js), chaque entrée liée à son CAP 1.2.
import { alertsFromRecords, atomXml } from '../../_lib/alerts.js';
import { readScoreRecords } from '../../_lib/score-history.js';

export const CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=300';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  const now = Date.now();
  const body = atomXml(alertsFromRecords(await readScoreRecords(), now), now);
  res.setHeader('Content-Type', 'application/atom+xml; charset=utf-8');
  res.setHeader('Cache-Control', CACHE_CONTROL);
  res.status(200).send(body);
}
