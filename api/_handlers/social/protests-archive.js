// api/_handlers/social/protests-archive.js : archive horaire de la couche Manifestations écrite par la VM (27/10/2026,
// api/_lib/protest-archive.js). Recopiée hors VM par .github/workflows/archive-protests.yml, relue pour rejouer une mobilisation.
//   GET /api/social/protests-archive            → { days: ['AAAA-MM-JJ', …] } (plus récents d'abord ; liste vide hors VM)
//   GET /api/social/protests-archive?day=AAAA-MM-JJ → { day, items: [lignes d'archive] }, 404 si le jour n'est pas archivé
import { isArchiveDay, listArchiveDays, readArchiveDay } from '../../_lib/protest-archive.js';

export const CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=300';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  const day = new URL(req.url ?? '/', 'http://localhost').searchParams.get('day');
  if (day === null) {
    res.setHeader('Cache-Control', CACHE_CONTROL);
    res.status(200).json({ days: await listArchiveDays() });
    return;
  }
  if (!isArchiveDay(day)) {
    res.status(400).json({ error: 'day attendu au format AAAA-MM-JJ' });
    return;
  }
  const items = await readArchiveDay(day);
  if (items === null) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).json({ error: 'jour non archivé' });
    return;
  }
  res.setHeader('Cache-Control', CACHE_CONTROL);
  res.status(200).json({ day, items });
}
