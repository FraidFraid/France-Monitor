// api/_handlers/energy/fuel-tension.js : tension carburants nationale calculée par la VM (scripts/vm-snapshot.ts --what fuel,
// minuteur fm-fuel toutes les 15 min), lue telle quelle ; 404 tant que le relevé n'existe pas (le navigateur lit alors les 98 pages
// du flux des prix carburants lui-même, src/services/fuel-tension.ts).
import { snapshotHandler } from '../../_lib/vm-snapshot-file.js';

export const FUEL_SNAPSHOT_FILES = Object.freeze([
  process.env.FUEL_SNAPSHOT_FILE,
  '/var/lib/francemonitor/data/fuel-tension.json',
].filter(Boolean));

export const CACHE_CONTROL = 's-maxage=120, stale-while-revalidate=600';

export default snapshotHandler(FUEL_SNAPSHOT_FILES, CACHE_CONTROL, 'relevé tension carburants absent');
