// Garde-fou du déploiement VM : tout module importé à l'exécution par api/ ou server/ doit être dans
// l'archive de .github/workflows/deploy-vm.yml. Le 29/09/2026, /api/ministers/* et /api/energy/drom
// renvoyaient 500 en production (ERR_MODULE_NOT_FOUND) : ils importaient des fichiers de src/,
// absents de l'archive depuis la migration Oracle.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

/** Chemins passés à `tar -czf …` dans le workflow de déploiement. */
function archivedPaths(): string[] {
  const yml = readFileSync(path.join(ROOT, '.github/workflows/deploy-vm.yml'), 'utf8');
  const start = yml.indexOf('tar -czf');
  expect(start).toBeGreaterThan(-1);
  const lines: string[] = [];
  for (const line of yml.slice(start).split('\n')) {
    lines.push(line.replace(/\\\s*$/, ''));
    if (!/\\\s*$/.test(line)) break;
  }
  // Premier mot : tar ; puis -czf et le nom de l'archive ; le reste = chemins archivés.
  return lines.join(' ').trim().split(/\s+/).slice(3);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (name === 'node_modules') return [];
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(?:m?js|ts)$/.test(name) && !/\.test\.ts$/.test(name) ? [full] : [];
  });
}

/** Imports relatifs réellement exécutés (statiques et dynamiques), hors commentaires JSDoc et imports de types. */
function relativeImports(file: string): string[] {
  const out: string[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
    // `import type` / `export type` : effacés à l'exécution (Node retire les types), rien à livrer.
    if (/^(?:import|export)\s+type\b/.test(trimmed)) continue;
    for (const m of line.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|^\s*import\s+)['"](\.{1,2}\/[^'"]+)['"]/g)) out.push(m[1]);
  }
  return out;
}

describe('archive de déploiement VM', () => {
  it('contient tout module importé à l’exécution par api/ et server/', () => {
    const roots = archivedPaths().map((p) => path.join(ROOT, p));
    const covered = (target: string): boolean => roots.some((r) => target === r || target.startsWith(`${r}${path.sep}`));
    const missing: string[] = [];
    for (const file of [...sourceFiles(path.join(ROOT, 'api')), ...sourceFiles(path.join(ROOT, 'server'))]) {
      for (const spec of relativeImports(file)) {
        const target = path.resolve(path.dirname(file), spec);
        if (!covered(target)) missing.push(`${path.relative(ROOT, file)} → ${path.relative(ROOT, target)}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
