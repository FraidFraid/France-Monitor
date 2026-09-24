#!/usr/bin/env node
/**
 * check-generated.mjs — Vérifie en CI que les fichiers générés sous api/ sont à jour.
 *
 * Trois fichiers sont générés depuis des sources dans src/ et ne doivent jamais être
 * édités à la main (voir docs/deployment.md §5) :
 *   - api/_routes.js                              ← api/_handlers/** (scripts/generate-api-routes.mjs)
 *   - api/_lib/server-classifier.js, server-geocoder.js
 *                                                  ← src/services/classifier.ts, geocoder.ts, src/config/geo.ts
 *                                                    (scripts/generate-server-classifier.mjs)
 *   - api/_lib/feeds-snapshot.js                  ← src/config/feeds.ts (scripts/sync-feeds.mjs)
 *
 * Les trois générateurs ne font ni appel réseau ni accès base de données (ils
 * bundlent du TypeScript avec esbuild ; les fonctions qui appellent api-adresse.data.gouv.fr
 * ou Neon ne s'exécutent qu'au RUNTIME du handler généré, jamais pendant la génération) :
 * ce script peut donc tourner sans DATABASE_URL ni aucune autre variable d'environnement,
 * y compris sur un runner CI sans accès réseau sortant vers ces services.
 *
 * Usage : node scripts/check-generated.mjs
 * Échoue (code 1) si la régénération modifie l'un des fichiers générés (comparaison de
 * contenu avant/après, et non `git diff` : le contrôle reste juste même avec des
 * modifications locales non commitées ailleurs sous api/).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const GENERATED = [
  'api/_routes.js',
  'api/_lib/server-classifier.js',
  'api/_lib/server-geocoder.js',
  'api/_lib/feeds-snapshot.js',
];

/** @param {string} rel */
function read(rel) {
  const abs = path.join(ROOT, rel);
  return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
}

/** @param {string} label @param {string[]} args */
function run(label, args) {
  console.log(`[check-generated] ${label}…`);
  try {
    execFileSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' });
  } catch (err) {
    console.error(`[check-generated] échec de la régénération (${label}) : ${err.message}`);
    process.exit(1);
  }
}

// 1. Photographie des fichiers générés tels qu'ils sont dans l'arbre de travail.
const before = new Map(GENERATED.map((rel) => [rel, read(rel)]));

// 2. Régénération depuis les sources src/ et api/_handlers/.
run('api/_routes.js (generate:api-routes)', ['scripts/generate-api-routes.mjs']);
run('api/_lib/server-classifier.js + server-geocoder.js (generate:server-libs)', [
  'scripts/generate-server-classifier.mjs',
]);
run('api/_lib/feeds-snapshot.js (sync:feeds)', ['scripts/sync-feeds.mjs']);

// 3. Tout écart = fichier généré périmé (ou édité à la main).
const stale = GENERATED.filter((rel) => read(rel) !== before.get(rel));
if (stale.length > 0) {
  console.error('\n[check-generated] Fichiers générés périmés par rapport à leurs sources :\n');
  for (const rel of stale) console.error(`  - ${rel}`);
  console.error(
    [
      '',
      'Ces fichiers sont générés et ne doivent jamais être édités à la main.',
      'Ils viennent d\'être régénérés dans votre arbre de travail : vérifiez puis committez-les.',
      '',
      '  npm run generate:server-libs && npm run generate:api-routes && npm run sync:feeds',
      '',
      'Voir docs/deployment.md §5 pour le détail de chaque générateur.',
    ].join('\n'),
  );
  process.exit(1);
}

console.log('[check-generated] les fichiers générés sont à jour avec leurs sources.');
