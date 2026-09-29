// /api/energy/drom lit ses fichiers statiques dans public/ en développement et dans dist/ sur la VM
// (l'archive de déploiement ne contient pas public/) : sans repli, l'API répondait 200 avec des
// données vides (29/09/2026).
import { describe, it, expect } from 'vitest';
import path from 'node:path';
// @ts-expect-error — module JS sans déclaration de types
import { resolveDromDataDir } from '../api/_handlers/energy/drom.js';

describe('resolveDromDataDir', () => {
  const cwd = '/srv/francemonitor/current';
  it('préfère public/ quand il existe (développement)', () => {
    expect(resolveDromDataDir(cwd, () => true)).toBe(path.join(cwd, 'public/data/drom-energy'));
  });
  it('se replie sur dist/ quand public/ manque (VM de production)', () => {
    const exists = (p: string) => p === path.join(cwd, 'dist/data/drom-energy');
    expect(resolveDromDataDir(cwd, exists)).toBe(path.join(cwd, 'dist/data/drom-energy'));
  });
  it('aucun des deux : public/ (le message d’erreur de lecture pointe le chemin attendu)', () => {
    expect(resolveDromDataDir(cwd, () => false)).toBe(path.join(cwd, 'public/data/drom-energy'));
  });
});
