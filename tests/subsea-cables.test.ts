// tests/subsea-cables.test.ts : câbles télécom sous-marins (spec 2026-10-04 souveraineté § 2.2, V5 ; contrats § 2.3, arbitrage 9 ;
// amendement 7, règle O18). Côté OpenStreetMap, sur la réponse Overpass réelle du 04/10/2026 (57 tracés touchant la France :
// 39 télécom, 9 électriques seuls, 9 sans nature) ; puis zones du Shom (mouillage hors zone de câbles, S9) et fichier public généré
// par scripts/fetch-subsea-cables.mjs (Shom en référence, OpenStreetMap en complément, source et licence par objet).
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { departementAt, departementsNear, metropoleDepartements } from '../api/_lib/geo-fr.js';
import { APPROACHES_BBOX, osmComplement } from '../api/_lib/shom-cables.js';
import {
  CABLES_FILE_PATH, CABLES_OVERPASS_QUERY, LANDING_KM, OSM_LICENCE, OSM_SOURCE, SHOM_CABLES_LICENCE, SHOM_REGULATION_LICENCE, SHOM_SOURCE,
  __resetCablesFileForTests, anchorageClearOfCablesAt, isTelecomSubseaCable, loadCablesFile, nameLandings, overpassToCables, pointToPathM,
  zoneContains,
} from '../api/_lib/subsea-cables.js';

// Forme du fichier (amendement 7) : à reporter dans src/types/index.ts (SubseaCablesFile), le dossier tests/ n'est pas typé par tsc.
type Ring = Array<[number, number]>;
interface Landing { commune: string; dept: string; lat: number; lon: number }
interface Cable { id: string; name: string | null; operator: string | null; path: Ring[]; landings: Landing[]; source: string; licence: string; outOfService: boolean }
interface Zone { id: string; name: string | null; info: string | null; source: string; licence: string; polygons: Ring[][] }
interface CableZone extends Zone { cableCategory: 'telecom' | 'power' | null }
interface AnchorageZone extends Zone { anchoringProhibited: boolean; crossesCableZone: boolean }
interface CableSource { source: string; dataset: string; layer: string; licence: string; attribution: string; edition: string | null; url: string; count: number }
interface CablesFile { generatedAt: string; osmBase: string; sources: CableSource[]; cables: Cable[]; cableZones: CableZone[]; anchorageZones: AnchorageZone[] }

interface OverpassWay { type: string; id: number; tags: Record<string, string>; geometry: Array<{ lat: number; lon: number }> }
const OSM = (): { osm3s: { timestamp_osm_base: string }; elements: OverpassWay[] } =>
  JSON.parse(readFileSync(new URL('./fixtures/sovereignty/osm-subsea-cables.json', import.meta.url), 'utf8'));
const GEO = { departementAt, departementsNear };
const tagsOf = (name: string): Record<string, string> => OSM().elements.find((e) => e.tags.name === name)?.tags ?? {};
const square = (lon: number, lat: number, d: number): Ring[] => [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]];

describe('isTelecomSubseaCable (arbitrage 9)', () => {
  it('télécom sous l’eau retenu ; électrique seul et sans nature écartés', () => {
    expect(isTelecomSubseaCable(tagsOf('Apollo South'))).toBe(true);           // communication=line, seamark:type=cable_submarine
    expect(isTelecomSubseaCable(tagsOf('AMITIE'))).toBe(true);                 // communication=line, location=underwater
    expect(isTelecomSubseaCable(tagsOf('Normandie 1'))).toBe(true);            // électrique ET télécom
    expect(isTelecomSubseaCable(tagsOf('IFA 2000'))).toBe(false);              // power=cable seul
    expect(isTelecomSubseaCable(tagsOf('Quiberon-Belle-Ile III'))).toBe(false);
    expect(isTelecomSubseaCable({ 'seamark:type': 'cable_submarine' })).toBe(false);
    expect(isTelecomSubseaCable({ telecom: 'line', submarine: 'yes' })).toBe(true);
    expect(isTelecomSubseaCable({ communication: 'line' })).toBe(false);       // ligne aérienne de la terre ferme
  });
  it('requête Overpass : télécom seulement, approches françaises, jamais `communication=line` seul', () => {
    expect(CABLES_OVERPASS_QUERY).toBe('[out:json][timeout:180];(way["communication"="line"]["location"="underwater"](41,-6,51.5,10);'
      + 'way["communication"="line"]["submarine"="yes"](41,-6,51.5,10);way["telecom"="line"]["location"="underwater"](41,-6,51.5,10);'
      + 'way["telecom"="line"]["submarine"="yes"](41,-6,51.5,10);way["communication"="line"]["seamark:type"="cable_submarine"](41,-6,51.5,10););out geom;');
  });
});

describe('overpassToCables', () => {
  const cables = overpassToCables(OSM(), GEO);
  it('39 tracés gardés sur 57, 50 atterrages, ordre de la réponse', () => {
    expect(OSM().elements).toHaveLength(57);
    expect([cables.length, cables.reduce((n, c) => n + c.landings.length, 0)]).toEqual([39, 50]);
    expect([cables[0].id, cables.at(-1)?.id]).toEqual(['way/78424042', 'way/761201757']);
    expect(cables.some((c) => c.name === 'IFA 2000')).toBe(false);
  });
  it('chaque câble porte sa source et sa licence (O18) ; jamais hors service (seules les lignes actives sont lues)', () => {
    expect(new Set(cables.map((c) => `${c.source} · ${c.licence} · ${c.outOfService}`))).toEqual(new Set(['OpenStreetMap · ODbL 1.0 · false']));
  });
  it('AMITIE : atterrage dans les Bouches-du-Rhône, tracé [lng, lat] à 5 décimales, commune à nommer', () => {
    const amitie = cables.find((c) => c.name === 'AMITIE');
    expect(amitie?.landings).toEqual([{ commune: '', dept: '13', lat: 43.32847, lon: 5.05475 }]);
    expect(amitie?.path[0][0]).toEqual([5.05475, 43.32847]);
    expect(amitie?.path[0]).toHaveLength(220);
    expect(amitie?.operator).toBeNull();
  });
  it('deux atterrages français (CC4 : Alpes-Maritimes et Haute-Corse) ; extrémité étrangère non retenue (Hugo Seg 2 : Guernesey)', () => {
    expect(cables.find((c) => c.name === 'CC4')?.landings.map((l) => l.dept)).toEqual(['06', '2B']);
    expect(cables.find((c) => c.name === 'Hugo Seg 2')?.landings.map((l) => l.dept)).toEqual(['22']);
  });
  it(`extrémité en mer à moins de ${LANDING_KM} km de la côte : atterrage du département le plus proche`, () => {
    const json = { elements: [{ type: 'way', id: 1, tags: { communication: 'line', location: 'underwater', name: 'Essai \u2014 Corse' },
      geometry: [{ lat: 42.95, lon: 9.0 }, { lat: 43.33, lon: 5.04 }] }] };
    const [c] = overpassToCables(json, { departementAt: () => null, departementsNear: (lat: number) => (lat < 43 ? ['2B'] : []) });
    expect(c.landings.map((l) => l.dept)).toEqual(['2B']);
    expect(c.name).toBe('Essai : Corse');
  });
  it('réponse sans « elements » : erreur', () => {
    expect(() => overpassToCables({ remark: 'runtime error' }, GEO)).toThrow('réponse Overpass sans « elements »');
  });
  it('atterrages nommés par la commune la plus proche ; aucune commune lisible : « commune inconnue »', () => {
    const named = nameLandings(cables.slice(0, 1), (dept) => (dept === '22' ? [{ name: 'Trébeurden' }] : []));
    expect(named[0].landings[0].commune).toBe('Trébeurden');
    expect(nameLandings(cables.slice(0, 1), () => [])[0].landings[0].commune).toBe('commune inconnue');
  });
});

describe('pointToPathM', () => {
  it('distance au segment le plus proche, en mètres', () => {
    const path: Array<Array<[number, number]>> = [[[5, 43], [5.01, 43]], [[6, 44], [6.01, 44]]];
    expect(pointToPathM(43.0027, 5.005, path)).toBeCloseTo(300.2, 0);
    expect(pointToPathM(43, 5.005, path)).toBeCloseTo(0, 6);
    expect(pointToPathM(43, 4.99, path)).toBeCloseTo(813, -1);   // au-delà de l'extrémité : distance au point de départ
    expect(pointToPathM(43, 5, [])).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('zones du Shom : point dans une zone, mouillage hors zone de câbles (S9)', () => {
  const zone = (over: Partial<AnchorageZone>): AnchorageZone => ({
    id: 'shom/essai', name: null, info: null, anchoringProhibited: false, crossesCableZone: false, source: 'Shom', licence: SHOM_REGULATION_LICENCE,
    polygons: [square(5, 43, 0.01)], ...over,
  });
  it('point dans un polygone, trous exclus', () => {
    const holed = zone({ polygons: [[...square(5, 43, 0.01), [[5.004, 43.004], [5.006, 43.004], [5.006, 43.006], [5.004, 43.006], [5.004, 43.004]]]] });
    expect([zoneContains(holed, 43.002, 5.002), zoneContains(holed, 43.005, 5.005), zoneContains(holed, 43.02, 5.002)]).toEqual([true, false, false]);
    expect(zoneContains(holed, Number.NaN, 5)).toBe(false);
  });
  it('navire dans une zone de mouillage permise qui ne recoupe aucune zone de câbles : zone rendue, il n’est pas signalé', () => {
    const quiet = zone({ id: 'shom/calme' });
    expect(anchorageClearOfCablesAt(43.005, 5.005, { anchorageZones: [quiet] })?.id).toBe('shom/calme');
    expect(anchorageClearOfCablesAt(43.005, 5.005, { anchorageZones: [zone({ crossesCableZone: true })] })).toBeNull();
    expect(anchorageClearOfCablesAt(43.005, 5.005, { anchorageZones: [zone({ anchoringProhibited: true })] })).toBeNull();
    expect(anchorageClearOfCablesAt(43.05, 5.005, { anchorageZones: [quiet] })).toBeNull();
    expect(anchorageClearOfCablesAt(43.005, 5.005, {})).toBeNull();
  });
});

describe('loadCablesFile', () => {
  it('lu une fois par processus ; fichier illisible ou sans zones : erreur', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cables-'));
    const good = join(dir, 'ok.json');
    writeFileSync(good, JSON.stringify({ generatedAt: '2026-10-04T15:49:06.828Z', osmBase: '2026-10-04T15:47:02Z', sources: [], cables: [], cableZones: [], anchorageZones: [] }));
    __resetCablesFileForTests();
    expect(loadCablesFile(good).cables).toEqual([]);
    writeFileSync(good, '{"cables": 3}');
    expect(loadCablesFile(good).cables).toEqual([]);                 // gardé en mémoire : pas relu
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, '{"cables": 3}');
    __resetCablesFileForTests();
    expect(() => loadCablesFile(bad)).toThrow('fichier des câbles illisible');
    const noZones = join(dir, 'no-zones.json');
    writeFileSync(noZones, JSON.stringify({ generatedAt: '2026-10-04T15:49:06.828Z', osmBase: '2026-10-04T15:47:02Z', sources: [], cables: [] }));
    expect(() => loadCablesFile(noZones)).toThrow('fichier des câbles illisible');
    __resetCablesFileForTests();
  });
});

describe('fichier public généré (public/data/subsea-cables.json)', () => {
  const file = JSON.parse(readFileSync(CABLES_FILE_PATH, 'utf8')) as CablesFile;
  const codes = new Set(metropoleDepartements().map((d) => d.code));
  const shom = file.cables.filter((c) => c.source === SHOM_SOURCE);
  const osm = file.cables.filter((c) => c.source === 'OpenStreetMap');
  const [west, south, east, north] = APPROACHES_BBOX;
  const inApproaches = ([lon, lat]: [number, number]): boolean => lon >= west && lon <= east && lat >= south && lat <= north;
  const closed = (ring: Ring): boolean => ring.length >= 4 && ring[0][0] === ring.at(-1)?.[0] && ring[0][1] === ring.at(-1)?.[1];

  it('daté : génération, base OSM et édition de chaque source, licence et attribution par source', () => {
    expect(Number.isFinite(Date.parse(file.generatedAt))).toBe(true);
    expect(Number.isFinite(Date.parse(file.osmBase))).toBe(true);
    expect(file.sources.map((s) => [s.source, s.layer, s.licence, s.attribution])).toEqual([
      ['Shom', 'CABLES_BDD_WFS:cblsub_lv', 'CC BY-SA', 'Shom'],
      ['Shom', 'REGLEMENTATION_NAVIGATION_BDD_WFS:cblare_polygon', 'Licence ouverte 2.0', 'Shom'],
      ['Shom', 'REGLEMENTATION_NAVIGATION_BDD_WFS:achare_polygon', 'Licence ouverte 2.0', 'Shom'],
      ['OpenStreetMap', 'Overpass', 'ODbL 1.0', OSM_SOURCE],
    ]);
    for (const s of file.sources) expect(s.edition === null || Number.isFinite(Date.parse(s.edition))).toBe(true);
    expect(file.sources[3].edition).toBe(file.osmBase);
    expect(file.sources.map((s) => s.count)).toEqual([shom.length, file.cableZones.length, file.anchorageZones.length, osm.length]);
  });
  it('câbles du Shom d’abord, compléments OpenStreetMap ensuite ; chacun avec sa source et sa licence, identifiants uniques', () => {
    expect(shom.length).toBeGreaterThanOrEqual(100);
    expect(osm.length).toBeGreaterThanOrEqual(5);
    expect(file.cables.findIndex((c) => c.source === 'OpenStreetMap')).toBe(shom.length);
    expect(new Set(file.cables.map((c) => c.id)).size).toBe(file.cables.length);
    for (const c of shom) expect([c.id.startsWith('shom/'), c.name, c.licence, typeof c.outOfService]).toEqual([true, null, SHOM_CABLES_LICENCE, 'boolean']);
    for (const c of osm) expect([/^way\/\d+$/.test(c.id), c.licence, c.outOfService]).toEqual([true, OSM_LICENCE, false]);
    expect(shom.some((c) => c.outOfService)).toBe(true);           // câbles hors service gardés (dessinés en gris, A14)
  });
  it('compléments OpenStreetMap : absents du Shom, chacun avec un atterrage en France', () => {
    expect(osmComplement(osm, shom)).toHaveLength(osm.length);
    for (const c of osm) expect(c.landings.length).toBeGreaterThan(0);
  });
  it('atterrages nommés dans un département ; tracés dans les approches de la métropole', () => {
    for (const c of file.cables) {
      for (const l of c.landings) {
        expect(codes.has(l.dept)).toBe(true);
        expect(l.commune.length).toBeGreaterThan(0);
      }
      expect(c.path.every((line) => line.length >= 2)).toBe(true);
      expect(c.path.some((line) => line.some(inApproaches))).toBe(true);
    }
  });
  it('zones de câbles et de mouillage du Shom : polygones fermés dans les approches, Licence ouverte 2.0', () => {
    expect(file.cableZones.length).toBeGreaterThanOrEqual(50);
    expect(file.anchorageZones.length).toBeGreaterThanOrEqual(1000);
    for (const z of [...file.cableZones, ...file.anchorageZones]) {
      expect([z.source, z.licence]).toEqual([SHOM_SOURCE, SHOM_REGULATION_LICENCE]);
      expect(z.polygons.length).toBeGreaterThan(0);
      expect(z.polygons.every((p) => p.every(closed))).toBe(true);
      expect(z.polygons.some((p) => p[0].some(inApproaches))).toBe(true);
    }
    expect(file.cableZones.some((z) => z.cableCategory === 'telecom')).toBe(true);
    expect(file.anchorageZones.some((z) => z.crossesCableZone)).toBe(true);
    expect(file.anchorageZones.some((z) => !z.crossesCableZone && !z.anchoringProhibited)).toBe(true);
  });
  it('moins de 1,5 Mo', () => {
    expect(readFileSync(CABLES_FILE_PATH).byteLength).toBeLessThan(1_500_000);
  });
});
