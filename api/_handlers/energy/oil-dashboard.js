// api/_handlers/energy/oil-dashboard.js : tableau de bord pétrole calculé par la VM (scripts/oil-snapshot.ts, minuteur fm-oil), lu
// tel quel. 404 si le relevé n'existe pas encore : le navigateur calcule alors lui-même (src/services/oil.ts, readOilSnapshot).
import { readFile } from 'node:fs/promises';
import { handlePreflight } from '../../_lib/source-http.js';

export const OIL_SNAPSHOT_FILES = Object.freeze([
  process.env.OIL_SNAPSHOT_FILE,
  '/var/lib/francemonitor/data/oil-dashboard.json',
].filter(Boolean));

export const CACHE_CONTROL = 's-maxage=600, stale-while-revalidate=1800';

export default async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  for (const file of OIL_SNAPSHOT_FILES) {
    try {
      const body = JSON.parse(await readFile(file, 'utf8'));
      res.setHeader('Cache-Control', CACHE_CONTROL);
      res.status(200).json(body);
      return;
    } catch { /* fichier suivant */ }
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(404).json({ error: 'relevé pétrole absent' });
}
