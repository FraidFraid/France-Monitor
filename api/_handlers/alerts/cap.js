// api/_handlers/alerts/cap.js : GET /api/alerts/cap?id=…, une alerte au format CAP 1.2 (api/_lib/alerts.js) ; sans id : la plus récente.
import { alertsFromRecords, capXml } from '../../_lib/alerts.js';
import { readScoreRecords } from '../../_lib/score-history.js';

export const CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=300';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  const id = new URL(req.url ?? '/', 'http://localhost').searchParams.get('id');
  const alerts = alertsFromRecords(await readScoreRecords(), Date.now());
  const alert = id ? alerts.find((a) => a.id === id) : alerts[alerts.length - 1];
  if (!alert) {
    res.setHeader('Cache-Control', 'public, s-maxage=60');
    res.status(404).json({ error: id ? 'alerte inconnue ou plus ancienne que 30 jours' : 'aucune alerte sur les 30 derniers jours' });
    return;
  }
  res.setHeader('Content-Type', 'application/cap+xml; charset=utf-8');
  res.setHeader('Cache-Control', CACHE_CONTROL);
  res.status(200).send(capXml(alert));
}
