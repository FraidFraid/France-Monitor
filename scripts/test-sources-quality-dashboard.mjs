import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const cwd = process.cwd();
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'france-monitor-sources-quality-tests-'));
const outfile = path.join(tempDir, 'sources-quality-dashboard.test.bundle.mjs');

try {
  await build({
    entryPoints: [path.join(cwd, 'src/services/sources-quality-dashboard.test.ts')],
    bundle: true,
    format: 'esm',
    outfile,
    platform: 'node',
    sourcemap: 'inline',
    target: ['node25'],
    tsconfig: path.join(cwd, 'tsconfig.json'),
  });

  const mod = await import(pathToFileURL(outfile).href);
  mod.runSourcesQualityDashboardTests();
  console.log('sources-quality-dashboard tests passed');
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
