// Le relais AIS tourne en production avec `npm ci --omit=dev` (VM, fm-relay.service) : il ne doit
// dépendre d'aucun paquet de développement (vite en est un).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../ais-relay.js', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  dependencies?: Record<string, string>;
};

describe('ais-relay.js — dépendances de production seulement', () => {
  it('n’importe pas vite (dépendance de développement)', () => {
    expect(source).not.toMatch(/from ['"]vite['"]/);
    expect(source).not.toMatch(/import\(['"]vite['"]\)/);
  });

  it('tous ses imports de paquets sont des dépendances de production', () => {
    const packages = [...source.matchAll(/^import .* from ['"]([^./'"][^'"]*)['"];?$/gm)]
      .map((m) => m[1])
      .filter((name) => !['http', 'url', 'fs', 'path', 'util'].includes(name) && !name.startsWith('node:'));
    for (const name of packages) expect(pkg.dependencies ?? {}, name).toHaveProperty(name);
  });
});
