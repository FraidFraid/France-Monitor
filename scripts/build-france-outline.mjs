// scripts/build-france-outline.mjs : contour de la France métropolitaine et de la Corse (control room des pannes, 21/10/2026),
// union des départements de public/data/departements.geojson, simplifiée. Sortie : public/data/france-metro-outline.geojson.
// À relancer seulement si le fichier des départements change : node scripts/build-france-outline.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { area, featureCollection, multiPolygon, polygon, simplify, truncate, union } from '@turf/turf';

const OVERSEAS = new Set(['971', '972', '973', '974', '976']);
const src = JSON.parse(readFileSync(new URL('../public/data/departements.geojson', import.meta.url), 'utf8'));
const metro = src.features.filter((f) => !OVERSEAS.has(String(f.properties?.code)));
const simple = metro.map((f) => simplify(f, { tolerance: 0.004, highQuality: false }));
const merged = union(featureCollection(simple));
if (!merged) throw new Error('union vide');
// Contour seul : anneaux extérieurs (l'union laisse des trous parasites le long des limites), îlots de moins de 20 km² retirés.
const parts = (merged.geometry.type === 'Polygon' ? [merged.geometry.coordinates] : merged.geometry.coordinates)
  .map((rings) => [rings[0]])
  .filter((rings) => area(polygon(rings)) >= 20e6);
const outline = truncate(simplify(multiPolygon(parts), { tolerance: 0.015, highQuality: true }), { precision: 3 });
outline.properties = { name: 'France métropolitaine et Corse' };
const out = JSON.stringify(featureCollection([outline]));
writeFileSync(new URL('../public/data/france-metro-outline.geojson', import.meta.url), out);
console.log(`[france-outline] ${metro.length} départements, ${outline.geometry.type}, ${out.length} octets`);
