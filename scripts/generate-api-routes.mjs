#!/usr/bin/env node
// Génère api/_routes.js : table URL → import paresseux du handler, pour le routeur unique api/index.js.
// Sur le palier Vercel Hobby, un déploiement Vite + api/ est limité à 12 fonctions : tous les handlers
// vivent donc sous api/_handlers/ (dossier ignoré par Vercel) et sont servis par une seule fonction.
// Usage : npm run generate:api-routes   (le test tests/api-router.test.ts échoue si la table est périmée)
import { readdirSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HANDLERS_DIR = join(ROOT, 'api', '_handlers');
const OUT = join(ROOT, 'api', '_routes.js');

// Anciennes URL publiques conservées (auparavant des rewrites vercel.json).
const ALIASES = {
  '/api/outages/citizen': '/api/citizen-outages',
};

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|ts)$/.test(name) && !/\.test\.(js|ts)$/.test(name)) out.push(p);
  }
  return out;
}

export function buildRoutesSource() {
  const files = walk(HANDLERS_DIR);
  const lines = files.map((file) => {
    const rel = relative(HANDLERS_DIR, file).split(sep).join('/');
    const route = '/api/' + rel.replace(/\.(js|ts)$/, '');
    return `  '${route}': () => import('./_handlers/${rel}'),`;
  });
  const aliases = Object.entries(ALIASES).map(([from, to]) => `  '${from}': '${to}',`);
  return [
    '// GÉNÉRÉ par scripts/generate-api-routes.mjs — ne pas éditer à la main.',
    '// Régénérer après tout ajout, renommage ou suppression dans api/_handlers/ : npm run generate:api-routes',
    '',
    '/** @type {Record<string, () => Promise<Record<string, unknown>>>} */',
    'export const ROUTES = {',
    ...lines,
    '};',
    '',
    '/** @type {Record<string, string>} */',
    'export const ALIASES = {',
    ...aliases,
    '};',
    '',
  ].join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const next = buildRoutesSource();
  let prev = '';
  try { prev = readFileSync(OUT, 'utf8'); } catch { /* premier passage */ }
  if (prev !== next) writeFileSync(OUT, next);
  console.log(`api/_routes.js : ${next.split('\n').filter((l) => l.includes('import(')).length} routes${prev === next ? ' (inchangé)' : ''}`);
}
