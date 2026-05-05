import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const cwd = process.cwd();
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'france-monitor-cyber-scoring-tests-'));
const outfile = path.join(tempDir, 'cyber-threat-scoring.test.bundle.mjs');

try {
  await build({
    entryPoints: [path.join(cwd, 'src/services/cyber-threat-scoring.test.ts')],
    bundle: true,
    format: 'esm',
    outfile,
    platform: 'node',
    sourcemap: 'inline',
    target: ['node25'],
    tsconfig: path.join(cwd, 'tsconfig.json'),
  });

  const mod = await import(pathToFileURL(outfile).href);
  await mod.runCyberThreatScoringTests();
} finally {
  await rm(tempDir, { recursive: true, force: true });
}
