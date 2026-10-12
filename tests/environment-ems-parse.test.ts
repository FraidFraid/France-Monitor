// tests/environment-ems-parse.test.ts
// Copernicus EMS (spec 2026-10-12) : lecture de la liste publique et du détail (fixtures réelles du 12/10/2026) : activations
// françaises (outre-mer déduit du nom ou du pays), TAAF écartées, fenêtre de 12 mois, catégories, ailleurs, polygones WKT.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  METROPOLE_LABEL, activatorOf, categoryOf, emsPageUrl, frenchTerritoryOf, parseEmsDetail, parseEmsList, parsePoint, parseWktPolygon, placeOf,
} from '../api/_lib/copernicus-ems.js';

const fx = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/environment/${name}`, import.meta.url), 'utf8'));
const LIST = fx('ems-liste-extrait.json') as { results: Array<Record<string, unknown>> };
const NOW = Date.parse('2026-10-12T08:00:00Z');
const item = (code: string): Record<string, unknown> => {
  const x = LIST.results.find((r) => r['code'] === code);
  if (!x) throw new Error(`fixture ${code} absente`);
  return x;
};
const withOpen = (codes: string[]) => ({ ...LIST, results: LIST.results.map((r) => (codes.includes(String(r['code'])) ? { ...r, closed: false } : { ...r, closed: true })) });

describe('territoire', () => {
  it('métropole par défaut ; outre-mer par le nom ; pays seul (Nouvelle-Calédonie) ; TAAF ; hors France', () => {
    expect(frenchTerritoryOf(item('EMSR866'))).toBe(METROPOLE_LABEL);
    expect(frenchTerritoryOf(item('EMSR780'))).toBe('Mayotte');
    expect(frenchTerritoryOf(item('EMSR790'))).toBe('La Réunion');
    expect(frenchTerritoryOf(item('EMSR852'))).toBe('Nouvelle-Calédonie');
    expect(frenchTerritoryOf(item('EMSR785'))).toBe('TAAF');
    expect(frenchTerritoryOf(item('EMSR934'))).toBeNull();
    expect(frenchTerritoryOf({ name: 'Flood in X', countries: ['New Caledonia'] })).toBe('Nouvelle-Calédonie');
  });
});

describe('libellés', () => {
  it('catégories traduites, inconnue = autre', () => {
    expect(['Wildfire', 'Flood', 'Storm', 'Earthquake', 'Mass movement', 'Volcanic activity', 'Industrial accident', 'Transport accident', 'Other', 'Zzz'].map(categoryOf))
      .toEqual(['feu', 'inondation', 'tempete', 'seisme', 'mouvement', 'volcan', 'industriel', 'transport', 'autre', 'autre']);
  });
  it('lieu : après le dernier « in », sans « , France »', () => {
    expect(placeOf('Flood in New Aquitaine, France')).toBe('New Aquitaine');
    expect(placeOf('Tropical Cyclone CHIDO in Mayotte, France')).toBe('Mayotte');
    expect(placeOf('Wildfire in New Caledonia')).toBe('New Caledonia');
    expect(placeOf('Sans lieu')).toBe('Sans lieu');
  });
  it('déclencheur : sigle sans points, sinon libellé après « | » ; absent : null', () => {
    expect(activatorOf('France|Centre Operationnel de Gestion Interministeriel de Crises (C.O.G.I.C)')).toBe('COGIC');
    expect(activatorOf('France|Préfecture de Mayotte')).toBe('Préfecture de Mayotte');
    expect(activatorOf('')).toBeNull();
    expect(activatorOf(null)).toBeNull();
  });
  it('page publique de l’activation', () => {
    expect(emsPageUrl('EMSR866')).toBe('https://mapping.emergency.copernicus.eu/activations/EMSR866');
  });
});

describe('géométrie WKT', () => {
  it('point et anneau extérieur ; moins de 4 points ou nombre illisible : null', () => {
    expect(parsePoint('POINT (-0.674064 45.265463)')).toEqual([-0.674064, 45.265463]);
    expect(parsePoint('n/a')).toBeNull();
    expect(parseWktPolygon('POLYGON ((0 0, 1 0, 1 1, 0 0))')).toEqual([[0, 0], [1, 0], [1, 1], [0, 0]]);
    expect(parseWktPolygon('POLYGON ((0 0, 1 0, 0 0))')).toBeNull();
    expect(parseWktPolygon('POLYGON ((0 0, x 0, 1 1, 0 0))')).toBeNull();
    expect(parseWktPolygon(null)).toBeNull();
  });
});

describe('liste', () => {
  it('en cours : françaises ouvertes seulement, données de la liste, page publique', () => {
    const { active } = parseEmsList(withOpen(['EMSR866', 'EMSR934', 'EMSR785']), NOW);
    expect(active.map((a: { code: string }) => a.code)).toEqual(['EMSR866']);
    expect(active[0]).toMatchObject({
      code: 'EMSR866', category: 'inondation', place: 'New Aquitaine', territory: METROPOLE_LABEL, closed: false,
      url: 'https://mapping.emergency.copernicus.eu/activations/EMSR866', activator: null, population: null, zones: [],
      activationTime: '2026-02-11T11:50:00.000Z',
    });
    expect(active[0].lon).toBeCloseTo(-0.674, 2);
  });
  it('historique : françaises closes de moins de 12 mois, plus récentes d’abord, sans TAAF', () => {
    const { recent } = parseEmsList(withOpen([]), NOW);
    expect(recent.map((a: { code: string }) => a.code)).toEqual(['EMSR902', 'EMSR866', 'EMSR852']);
  });
  it('ailleurs : nombre et pays traduits des activations ouvertes hors de France (TAAF exclues)', () => {
    const { elsewhere } = parseEmsList(withOpen(['EMSR934', 'EMSR933', 'EMSR785']), NOW);
    expect(elsewhere).toEqual({ count: 2, countries: ['Panama', 'Grèce'] });
  });
});

describe('détail', () => {
  it('déclencheur, population dans l’emprise, zones lues', () => {
    const d = parseEmsDetail(fx('ems-detail-EMSR866.json'));
    expect(d.activator).toBe('COGIC');
    expect(d.population).toBe(83890);
    expect(d.zones).toHaveLength(2);
    expect(d.zones[0]?.name).toBe('Cognac');
    expect(d.zones[0]?.ring.length).toBeGreaterThanOrEqual(4);
  });
  it('détail vide ou illisible : rien d’inventé', () => {
    expect(parseEmsDetail({ results: [] })).toEqual({ activator: null, population: null, zones: [] });
    expect(parseEmsDetail({ results: [{ aois: [{ name: 'X', extent: 'POLYGON ((0 0))' }], stats: { 'Population [No.]': 'n/a' } }] }))
      .toEqual({ activator: null, population: null, zones: [] });
  });
});

describe('revue finale : noms de communes de métropole', () => {
  it('Saint-Pierre-d’Oléron et Saint-Martin-Vésubie restent en métropole ; Saint-Martin et Saint-Pierre-et-Miquelon reconnus', () => {
    expect(frenchTerritoryOf({ name: "Wildfire in Saint-Pierre-d'Oleron, France", countries: ['France'] })).toBe(METROPOLE_LABEL);
    expect(frenchTerritoryOf({ name: 'Flood in Saint-Martin-Vesubie, France', countries: ['France'] })).toBe(METROPOLE_LABEL);
    expect(frenchTerritoryOf({ name: 'Hurricane IRMA in Saint Martin, France', countries: ['France'] })).toBe('Saint-Martin');
    expect(frenchTerritoryOf({ name: 'Storm in Saint Pierre and Miquelon', countries: ['France'] })).toBe('Saint-Pierre-et-Miquelon');
    expect(frenchTerritoryOf({ name: 'Storm in Saint-Pierre, France', countries: ['France'] })).toBe('Saint-Pierre-et-Miquelon');
  });
});
