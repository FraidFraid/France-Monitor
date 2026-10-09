// tests/client-no-api-imports.test.ts
// Un module du navigateur n'importe jamais un fichier de api/ : en dev, Vite le servirait à l'URL /api/…, que le routeur d'API
// intercepte (404, App.ts ne se charge pas : écran noir du 05/10/2026). Le code partagé vit sous src/ et le serveur l'importe de là
// (l'archive de déploiement le porte). Les greffons Vite (src/plugins, côté Node), les tests et leurs jeux d'essai (*.fixture.ts, jamais importés par l'application) ne sont pas concernés.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../src/', import.meta.url).pathname;

function browserModules(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'plugins' ? [] : browserModules(path);
    return /\.(ts|js|mjs)$/.test(name) && !/\.(test|fixture)\.ts$/.test(name) ? [path] : [];
  });
}

describe('modules du navigateur', () => {
  it('aucun import depuis api/ (le serveur de dev ne peut pas servir /api/* comme module)', () => {
    const offenders = browserModules(SRC).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return [...source.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g)]
        .map((m) => m[1] ?? '')
        .filter((spec) => /(^|\/)api\//.test(spec))
        .map((spec) => `${file.slice(SRC.length)} → ${spec}`);
    });
    expect(offenders).toEqual([]);
  });
});
