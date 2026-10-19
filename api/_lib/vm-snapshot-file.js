// api/_lib/vm-snapshot-file.js : relevé calculé par la VM (scripts/vm-snapshot.ts) servi tel quel ; 404 non mis en cache tant que
// le minuteur n'est pas passé (le navigateur calcule alors lui-même, src/services/vm-snapshot.ts).
import { readFile } from 'node:fs/promises';
import { handlePreflight } from './source-http.js';

export function snapshotHandler(files, cacheControl, missing) {
  return async function handler(req, res) {
    if (handlePreflight(req, res)) return;
    for (const file of files.filter(Boolean)) {
      try {
        const body = JSON.parse(await readFile(file, 'utf8'));
        res.setHeader('Cache-Control', cacheControl);
        res.status(200).json(body);
        return;
      } catch { /* fichier suivant */ }
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).json({ error: missing });
  };
}
