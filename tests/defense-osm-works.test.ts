// tests/defense-osm-works.test.ts : ouvrages de défense d'OpenStreetMap (spec 2026-10-04 souveraineté § 2.1, V2, V5 ; contrats,
// arbitrage 10) : filtre du script sur une réponse Overpass construite, puis fichier public généré (daté, licence, seulement des
// points situés dans un département métropolitain).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { departementAt } from '../api/_lib/geo-fr.js';
import { DEFENSE_OVERPASS_QUERY, OUTPUT_PATH, defenseWorksFromOverpass } from '../scripts/fetch-france-military.mjs';
import type { DefenseOsmWorksFile } from '../src/types/index.ts';

const el = (type: string, id: number, tags: Record<string, string>, lat: number, lon: number) => (type === 'node'
  ? { type, id, tags, lat, lon }
  : { type, id, tags, center: { lat, lon } });

describe('defenseWorksFromOverpass', () => {
  const json = {
    elements: [
      el('way', 22761044, { military: 'airfield', name: 'Base aérienne 105 Évreux-Fauville' }, 49.03051, 1.21751),
      el('node', 1, { military: 'airfield', name: 'Base aérienne 105 Évreux-Fauville' }, 49.0306, 1.2176),   // doublon du chemin, à moins de 200 m
      el('way', 2, { military: 'barracks', name: 'Quartier fictif de Bruxelles' }, 50.85, 4.35),            // hors de France
      el('node', 3, { military: 'bunker', name: 'R622' }, 49.3435, -0.69438),                                // code d'ouvrage de 1944
      el('node', 4, { military: 'yes', name: 'Batterie de la Pointe' }, 48.39, -4.49),                          // `yes` au nom pertinent
      el('node', 5, { military: 'yes', name: 'Hangar' }, 48.39, -4.49),                                         // `yes` sans nom pertinent
      el('way', 6, { military: 'naval_base', 'name:fr': 'Base navale \u2014 essai', name: 'Naval base' }, 43.125, 5.94),
      el('node', 7, { military: 'barracks' }, 48.8, 2.3),                                                     // sans nom
    ],
  };
  it('nommés, en France, sans doublon ; types internes ; tiret cadratin remplacé', () => {
    expect(defenseWorksFromOverpass(json, { departementAt })).toEqual([
      { id: 'node/4', name: 'Batterie de la Pointe', kind: 'yes', type: 'other', lat: 48.39, lon: -4.49, dept: '29' },
      { id: 'way/22761044', name: 'Base aérienne 105 Évreux-Fauville', kind: 'airfield', type: 'air', lat: 49.03051, lon: 1.21751, dept: '27' },
      { id: 'way/6', name: 'Base navale : essai', kind: 'naval_base', type: 'navy', lat: 43.125, lon: 5.94, dept: '83' },
    ]);
  });
  it('une seule requête Overpass sur la métropole, objets nommés seulement', () => {
    expect(DEFENSE_OVERPASS_QUERY).toBe('[out:json][timeout:180];(node["military"]["name"](41,-5.5,51.5,10);way["military"]["name"](41,-5.5,51.5,10););out center tags;');
    expect(() => defenseWorksFromOverpass({}, { departementAt })).toThrow('réponse Overpass sans « elements »');
  });
});

describe('fichier public généré (public/data/defense-osm-works.json)', () => {
  const file = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8')) as DefenseOsmWorksFile;
  it('daté, licence ODbL 1.0 et attribution', () => {
    expect(Number.isFinite(Date.parse(file.generatedAt))).toBe(true);
    expect(Number.isFinite(Date.parse(file.osmBase))).toBe(true);
    expect([file.licence, file.source]).toEqual(['ODbL 1.0', "© les contributeurs d'OpenStreetMap"]);
  });
  it('aucun point hors de France : chaque ouvrage est dans son département', () => {
    expect(file.items.length).toBeGreaterThan(500);
    for (const w of file.items) expect(departementAt(w.lat, w.lon)).toBe(w.dept);
  });
  it('types connus seulement, moins de 1,5 Mo', () => {
    expect(new Set(file.items.map((w) => w.type))).toEqual(new Set(['air', 'navy', 'army', 'joint', 'fortification', 'other']));
    expect(readFileSync(OUTPUT_PATH).byteLength).toBeLessThan(1_500_000);
  });
});
