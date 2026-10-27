// scripts/archive-protests.mjs : relève horaire de la couche Manifestations sur la VM (minuteur fm-archive-protests, 27/10/2026).
// Lit /api/social/protests sur l'API locale et fusionne les rassemblements dans le fichier du jour (UTC), écrit d'un bloc
// (fichier temporaire puis renommage). Fichiers de plus de 90 jours retirés ; la copie hors VM (branche sauvegarde-historique)
// les garde. Forme et fusion : api/_lib/protest-archive.js.
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PROTEST_ARCHIVE_KEEP_DAYS, archiveRow, isArchiveDay, mergeArchive, parseArchive, protestArchiveDir } from '../api/_lib/protest-archive.js';

const SOURCE = process.env.PROTESTS_URL ?? `http://127.0.0.1:${Number(process.env.PORT) || 3000}/api/social/protests`;
const DIR = protestArchiveDir();

const resp = await fetch(SOURCE, { signal: AbortSignal.timeout(90_000) });
const body = resp.ok ? await resp.json() : null;
if (!body?.readAt || !Array.isArray(body.items)) {
  console.error(`[archive-protests] ARRET : couche Manifestations sans readAt (HTTP ${resp.status}) ${JSON.stringify(body?.errors ?? null)}`);
  process.exit(1);
}

const day = new Date().toISOString().slice(0, 10);
const file = path.join(DIR, `${day}.jsonl`);
let rows = [];
try {
  rows = parseArchive(await readFile(file, 'utf8'));
} catch {
  // premier relevé du jour
}
const merged = mergeArchive(rows, body.items.filter((i) => typeof i?.id === 'string').map((i) => archiveRow(i, body.readAt)));
await mkdir(DIR, { recursive: true });
await writeFile(`${file}.tmp`, `${merged.map((r) => JSON.stringify(r)).join('\n')}\n`);
await rename(`${file}.tmp`, file);

const oldest = new Date(Date.now() - PROTEST_ARCHIVE_KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
let removed = 0;
for (const f of await readdir(DIR)) {
  const d = f.replace(/\.jsonl$/, '');
  if (isArchiveDay(d) && d < oldest) {
    await unlink(path.join(DIR, f));
    removed += 1;
  }
}

console.log(`[archive-protests] relevé ${body.readAt} : ${body.items.length} servis, ${merged.length} dans ${day}.jsonl${removed ? `, ${removed} fichier(s) de plus de ${PROTEST_ARCHIVE_KEEP_DAYS} jours retiré(s)` : ''}`);
