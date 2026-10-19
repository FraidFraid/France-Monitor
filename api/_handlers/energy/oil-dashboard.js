// api/_handlers/energy/oil-dashboard.js : tableau de bord pétrole calculé par la VM (scripts/vm-snapshot.ts --what oil, minuteur
// fm-oil), lu tel quel ; 404 tant que le relevé n'existe pas (le navigateur calcule alors lui-même, src/services/oil.ts).
import { snapshotHandler } from '../../_lib/vm-snapshot-file.js';

export const OIL_SNAPSHOT_FILES = Object.freeze([
  process.env.OIL_SNAPSHOT_FILE,
  '/var/lib/francemonitor/data/oil-dashboard.json',
].filter(Boolean));

export const CACHE_CONTROL = 's-maxage=600, stale-while-revalidate=1800';

export default snapshotHandler(OIL_SNAPSHOT_FILES, CACHE_CONTROL, 'relevé pétrole absent');
