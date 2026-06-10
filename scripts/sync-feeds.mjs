/**
 * sync-feeds.mjs — Génère api/_lib/feeds-snapshot.js depuis src/config/feeds.ts.
 *
 * src/config/feeds.ts ne peut pas être importé directement côté serveur
 * (il lit `import.meta.env.VITE_USE_LOCAL_RSS_PROXY` au chargement → crash Node).
 * Ce script bundle le module via esbuild avec le flag défini à "false"
 * (les flux Cloudflare nécessitent Scrapling, indisponible sur Vercel),
 * puis sérialise la liste avec des ids slug déterministes (kebab-case).
 *
 * Régénération après toute modification de src/config/feeds.ts :
 *   npm run sync:feeds
 *
 * Le handler api/ingest/news.ts UPSERT ensuite ce snapshot dans la table `feeds`
 * à chaque tick (les feeds retirés sont désactivés, enabled=false).
 */

import { build } from 'esbuild';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { slugifyFeedId } from '../api/_lib/db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTFILE = path.join(ROOT, 'api/_lib/feeds-snapshot.js');

const tempDir = await mkdtemp(path.join(os.tmpdir(), 'france-monitor-feeds-'));
const bundlePath = path.join(tempDir, 'feeds.bundle.mjs');

try {
  await build({
    stdin: {
      contents: `export { ALL_FEEDS } from './src/config/feeds.ts';`,
      loader: 'ts',
      resolveDir: ROOT,
      sourcefile: 'feeds-snapshot-entry.ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: ['node18'],
    outfile: bundlePath,
    define: {
      'import.meta.env.VITE_USE_LOCAL_RSS_PROXY': '"false"',
    },
    tsconfig: path.join(ROOT, 'tsconfig.json'),
    logLevel: 'warning',
  });

  const { ALL_FEEDS } = await import(pathToFileURL(bundlePath).href);

  const seen = new Set();
  const feeds = ALL_FEEDS.map((feed) => {
    const id = slugifyFeedId(feed.name);
    if (seen.has(id)) {
      throw new Error(`Duplicate feed id slug "${id}" — rename the feed in src/config/feeds.ts`);
    }
    seen.add(id);
    return {
      id,
      name: feed.name,
      url: feed.url,
      region: feed.region ?? null,
      tier: feed.tier,
    };
  });

  const header = `/**
 * GENERATED FILE — DO NOT EDIT.
 * Généré par scripts/sync-feeds.mjs depuis src/config/feeds.ts.
 * Régénération : npm run sync:feeds
 */`;
  const body = `${header}\n\nexport const FEEDS = ${JSON.stringify(feeds, null, 2)};\n`;
  await writeFile(OUTFILE, body, 'utf8');
  console.log(`[sync-feeds] wrote ${path.relative(ROOT, OUTFILE)} (${feeds.length} feeds)`);
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
