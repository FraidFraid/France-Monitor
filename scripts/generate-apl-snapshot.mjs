// Génère api/_shared/apl-departements-snapshot.js à partir du fichier curé
// public/data/apl-departements.json, pour que la fonction serverless
// /api/health/apl puisse renvoyer des données APL fiables même quand les
// sources DREES sont indisponibles (les fonctions Vercel n'ont PAS accès à
// public/ via fs — il faut bundler les données via un import).
//
// Usage : node scripts/generate-apl-snapshot.mjs
import fs from 'node:fs/promises';
import path from 'node:path';

const SRC = path.resolve('public/data/apl-departements.json');
const OUT = path.resolve('api/_shared/apl-departements-snapshot.js');

const raw = JSON.parse(await fs.readFile(SRC, 'utf8'));
const departements = Array.isArray(raw?.departements) ? raw.departements : [];
const metadata = raw?.metadata ?? null;

if (departements.length === 0) {
  throw new Error(`[generate-apl-snapshot] aucune donnée dans ${SRC}`);
}

const body = `// AUTO-GÉNÉRÉ par scripts/generate-apl-snapshot.mjs — NE PAS ÉDITER À LA MAIN.
// Snapshot APL (déserts médicaux) bundlé pour la fonction /api/health/apl.
export const APL_DEPARTEMENTS_SNAPSHOT = ${JSON.stringify(departements)};
export const APL_SNAPSHOT_METADATA = ${JSON.stringify(metadata)};
`;

await fs.writeFile(OUT, body, 'utf8');
console.log(`[generate-apl-snapshot] ${departements.length} départements → ${path.relative(process.cwd(), OUT)}`);
