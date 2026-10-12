#!/usr/bin/env node
// scripts/generate-departement-centers.mjs — point intérieur de chaque département de métropole (12/10/2026).
//
// Le géocodeur place « dans le Var », « dans l'Hérault » à ce point : il est garanti DANS le département (milieu du plus large
// segment intérieur sur la ligne horizontale médiane du plus grand polygone), contrairement au centre d'une boîte ou d'une
// région. Source : public/data/departements.geojson. Sortie : src/config/departement-centers.ts.
//
//   node scripts/generate-departement-centers.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const geo = JSON.parse(readFileSync(new URL('public/data/departements.geojson', ROOT), 'utf8'));

/** Anneau extérieur du plus grand polygone (aire de la boîte englobante). */
function mainRing(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const size = (ring) => {
    const xs = ring.map((p) => p[0]);
    const ys = ring.map((p) => p[1]);
    return (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  };
  return polys.map((p) => p[0]).sort((a, b) => size(b) - size(a))[0];
}

/** Milieu du plus large segment intérieur sur une horizontale ; plusieurs hauteurs essayées, la plus large gagne. */
function interiorPoint(ring) {
  const ys = ring.map((p) => p[1]);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  let best = null;
  for (const t of [0.5, 0.4, 0.6, 0.3, 0.7]) {
    const y = minY + (maxY - minY) * t;
    const xs = [];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[j];
      if ((y1 > y) !== (y2 > y)) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const width = xs[k + 1] - xs[k];
      if (!best || width > best.width) best = { width, point: [(xs[k] + xs[k + 1]) / 2, y] };
    }
  }
  return best.point;
}

const round = (n) => Math.round(n * 1e4) / 1e4;
const rows = geo.features
  .map((f) => ({ code: String(f.properties.code), nom: String(f.properties.nom), center: interiorPoint(mainRing(f.geometry)).map(round) }))
  .sort((a, b) => a.code.localeCompare(b.code));

const body = rows.map((r) => `  ${JSON.stringify(r.nom)}: { code: '${r.code}', center: [${r.center[0]}, ${r.center[1]}] },`).join('\n');
const out = `/**
 * GENERATED FILE — DO NOT EDIT.
 * Généré par scripts/generate-departement-centers.mjs depuis public/data/departements.geojson.
 * Point intérieur de chaque département de métropole, [lon, lat] : le géocodeur y place « dans le Var ».
 */
export const DEPARTEMENT_CENTERS: Readonly<Record<string, { code: string; center: [number, number] }>> = {
${body}
};
`;
writeFileSync(new URL('src/config/departement-centers.ts', ROOT), out);
console.log(`[departement-centers] ${rows.length} départements écrits dans src/config/departement-centers.ts`);
