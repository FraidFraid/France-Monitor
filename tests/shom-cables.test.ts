// tests/shom-cables.test.ts : câbles, zones de câbles et zones de mouillage du Shom (amendement 7, règle O18 ; S9), sur trois
// lectures GetFeature réelles du 04/10/2026 (approches de Marseille, User-Agent FranceMonitor) : 25 câbles sur 32 (19 télécom),
// 2 zones de câbles, 10 zones de mouillage sur 15 ; complément OpenStreetMap sur la réponse Overpass réelle du même jour.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { departementAt, departementsNear } from '../api/_lib/geo-fr.js';
import {
  APPROACHES_BBOX, COVER_M, SHOM_LAYERS, ZONE_SIMPLIFY_M, assertWfsComplete, osmComplement, shomCableCounts, shomCapabilitiesUrl, shomEditionOf,
  shomExclusionsText, shomFeatureUrl, shomToAnchorageZones, shomToCableZones, shomToCables, simplifyRing, zonesOverlap,
} from '../api/_lib/shom-cables.js';
import { overpassToCables } from '../api/_lib/subsea-cables.js';

type Ring = Array<[number, number]>;
const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/sovereignty/${name}`, import.meta.url), 'utf8'));
const CABLES = (): unknown => fixture('shom-cblsub-lv.json');
const CABLE_ZONES = (): unknown => fixture('shom-cblare-polygon.json');
const ANCHORAGES = (): unknown => fixture('shom-achare-polygon.json');
const GEO = { departementAt, departementsNear };
const square = (lon: number, lat: number, d: number): Ring[] => [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]];
const zone = (polygons: Ring[][]) => ({ polygons });
/** Extrait de GetCapabilities du 04/10/2026. */
const CAPABILITIES = '<wfs:WFS_Capabilities><FeatureTypeList>'
  + '<FeatureType><Name>CABLES_BDD_WFS:cblsub_lv</Name><Title>CABLES_BDD_WFS:cblsub_lv.title</Title><Abstract>Câbles et conduites</Abstract><ows:Keywords><ows:Keyword>cables</ows:Keyword></ows:Keywords></FeatureType>'
  + '<FeatureType><Name>REGLEMENTATION_NAVIGATION_BDD_WFS:achare_polygon</Name><Title>REGLEMENTATION_NAVIGATION_BDD_WFS:achare_polygon.title</Title><Abstract>Réglementation - navigation 07_2021</Abstract><ows:Keywords><ows:Keyword>navigation</ows:Keyword></ows:Keywords></FeatureType>'
  + '</FeatureTypeList></wfs:WFS_Capabilities>';

describe('service WFS du Shom', () => {
  it('GetCapabilities et GetFeature seulement, GeoJSON sur les approches de la métropole', () => {
    expect(shomCapabilitiesUrl()).toBe('https://services.data.shom.fr/INSPIRE/wfs?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetCapabilities');
    expect(shomFeatureUrl(SHOM_LAYERS.cables.layer)).toBe('https://services.data.shom.fr/INSPIRE/wfs?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature'
      + '&TYPENAMES=CABLES_BDD_WFS:cblsub_lv&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326&BBOX=-6,41,10,51.5,EPSG:4326');
    expect(APPROACHES_BBOX).toEqual([-6, 41, 10, 51.5]);
    expect([SHOM_LAYERS.cables.licence, SHOM_LAYERS.cableZones.licence, SHOM_LAYERS.anchorageZones.licence])
      .toEqual(['CC BY-SA', 'Licence ouverte 2.0', 'Licence ouverte 2.0']);
    expect([SHOM_LAYERS.cableZones.layer, SHOM_LAYERS.anchorageZones.layer])
      .toEqual(['REGLEMENTATION_NAVIGATION_BDD_WFS:cblare_polygon', 'REGLEMENTATION_NAVIGATION_BDD_WFS:achare_polygon']);
  });
  it('édition lue dans le résumé de la couche ; couche absente du service : erreur', () => {
    expect(shomEditionOf(CAPABILITIES, SHOM_LAYERS.anchorageZones.layer)).toBe('2021-07');
    expect(shomEditionOf(CAPABILITIES, SHOM_LAYERS.cables.layer)).toBeNull();
    expect(() => shomEditionOf(CAPABILITIES, SHOM_LAYERS.cableZones.layer))
      .toThrow('couche REGLEMENTATION_NAVIGATION_BDD_WFS:cblare_polygon absente du service WFS du Shom');
  });
  it('réponse tronquée (25 objets sur 32) ou sans « features » : erreur, jamais un fichier incomplet', () => {
    expect(() => assertWfsComplete(CABLES(), SHOM_LAYERS.cables.layer)).toThrow('réponse WFS du Shom tronquée (CABLES_BDD_WFS:cblsub_lv : 25 objets sur 32)');
    expect(() => assertWfsComplete(CABLE_ZONES(), SHOM_LAYERS.cableZones.layer)).not.toThrow();
    expect(() => assertWfsComplete({ type: 'FeatureCollection', features: [] }, 'x')).not.toThrow();
    expect(() => assertWfsComplete('<html></html>', 'x')).toThrow('réponse WFS du Shom sans « features » (x)');
    expect(() => shomToCables({ features: 3 }, GEO)).toThrow('réponse WFS du Shom sans « features » (CABLES_BDD_WFS:cblsub_lv)');
  });
});

describe('shomToCables', () => {
  const cables = shomToCables(CABLES(), GEO);
  it('télécom seulement (catcbl 4) : 19 câbles sur 25 objets, sans nom, source Shom, licence CC BY-SA', () => {
    expect(cables).toHaveLength(19);
    expect(new Set(cables.map((c) => `${c.name} · ${c.operator} · ${c.source} · ${c.licence}`))).toEqual(new Set(['null · null · Shom · CC BY-SA']));
    expect(cables.map((c) => c.id).slice(0, 3)).toEqual(['shom/FR000013709500001', 'shom/FR000008435600001', 'shom/FR000014411700001']);
  });
  it('tracé [lng, lat] à 5 décimales ; tronçon en mer sans atterrage ; atterrages à Marseille', () => {
    const offshore = cables[0];
    expect(offshore.path[0][0]).toEqual([4.48057, 41.2395]);
    expect(offshore.landings).toEqual([]);
    expect(cables[1].landings).toEqual([{ commune: '', dept: '13', lat: 43.26064, lon: 5.37057 }]);
    expect(cables.filter((c) => c.landings.length > 0).every((c) => c.landings.every((l) => l.dept === '13'))).toBe(true);
  });
  it('hors service (STATUS S-57 4) : gardé dans le fichier, marqué ; relevé réel : 1 câble sur 19 (shom/FR000008435100001)', () => {
    expect(cables.filter((c) => c.outOfService).map((c) => c.id)).toEqual(['shom/FR000008435100001']);
    expect(cables.every((c) => typeof c.outOfService === 'boolean')).toBe(true);
  });
  it('câble en plusieurs objets : hors service seulement si tous ses objets le sont (jamais une alerte perdue)', () => {
    const seg = (n: number, status: string | null) => ({
      id: `cblsub_lv.${n}`, properties: { catcbl: 4, status, inspireid: n < 3 ? 'FR 1' : 'FR 2' },
      geometry: { type: 'LineString', coordinates: [[5 + n / 10, 43], [5.05 + n / 10, 43]] },
    });
    const out = shomToCables({ type: 'FeatureCollection', features: [seg(1, '4'), seg(2, null), seg(3, '4'), seg(4, '1,4')] }, GEO);
    expect(out.map((c) => [c.id, c.outOfService])).toEqual([['shom/FR1', false], ['shom/FR2', true]]);
  });
  it('objets de même identifiant INSPIRE regroupés en un tracé ; autres catégories écartées', () => {
    const json = { type: 'FeatureCollection', features: [
      { id: 'cblsub_lv.1', properties: { catcbl: 4, inspireid: 'FR 0000150197 00001' }, geometry: { type: 'MultiLineString', coordinates: [[[7.0468333, 43.5456667], [7.2, 43.4]]] } },
      { id: 'cblsub_lv.2', properties: { catcbl: 4, inspireid: 'FR 0000150197 00001' }, geometry: { type: 'LineString', coordinates: [[7.6702882, 43.18510221], [7.77, 43.14]] } },
      { id: 'cblsub_lv.3', properties: { catcbl: 1, inspireid: 'FR 1' }, geometry: { type: 'LineString', coordinates: [[5, 43], [5.1, 43]] } },
      { id: 'cblsub_lv.4', properties: { catcbl: 6, inspireid: 'FR 2' }, geometry: { type: 'LineString', coordinates: [[5, 43], [5.1, 43]] } },
      { id: 'cblsub_lv.5', properties: { catcbl: 0, status: '4', inspireid: 'FR 3' }, geometry: { type: 'LineString', coordinates: [[5, 43], [5.1, 43]] } },
    ] };
    const [c, ...rest] = shomToCables(json, { departementAt: (lat: number) => (lat > 43.5 ? '06' : null), departementsNear: () => [] });
    expect(rest).toEqual([]);
    expect([c.id, c.path]).toEqual(['shom/FR000015019700001', [[[7.04683, 43.54567], [7.2, 43.4]], [[7.67029, 43.1851], [7.77, 43.14]]]]);
    expect(c.landings).toEqual([{ commune: '', dept: '06', lat: 43.54567, lon: 7.04683 }]);
  });
});

describe('shomCableCounts : objets du Shom écartés, imprimés par le script (revue d’A4)', () => {
  it('relevé réel : 19 objets télécom gardés sur 25, dont 1 hors service ; 6 écartés, tous de catégorie non renseignée et hors service', () => {
    const counts = shomCableCounts(CABLES());
    expect(counts).toEqual({ objects: 25, telecom: 19, telecomOutOfService: 1, excluded: 6, excludedOutOfService: 6, excludedByCategory: { 0: 6 } });
    expect(shomExclusionsText(counts)).toBe('objets du Shom écartés : 6 sur 25 (catcbl autre que 4 · non renseignée : 6), dont 6 hors service ; '
      + 'objets télécom gardés : 19, dont 1 hors service');
  });
  it('catégories S-57 nommées (électrique, ligne de transport, chaîne de corps-mort) ; une liste « 1,6 » comptée sous sa liste', () => {
    const json = { type: 'FeatureCollection', features: [
      { properties: { catcbl: 1, status: null } }, { properties: { catcbl: 1, status: '4' } }, { properties: { catcbl: 6 } },
      { properties: { catcbl: 3 } }, { properties: { catcbl: '1,6' } }, { properties: { catcbl: 4, status: '1,4' } },
    ] };
    const counts = shomCableCounts(json);
    expect(counts).toEqual({ objects: 6, telecom: 1, telecomOutOfService: 1, excluded: 5, excludedOutOfService: 1, excludedByCategory: { 1: 2, 3: 1, 6: 1, '1,6': 1 } });
    expect(shomExclusionsText(counts)).toBe('objets du Shom écartés : 5 sur 6 (catcbl autre que 4 · électrique : 2, ligne de transport : 1, '
      + 'chaîne de corps-mort : 1, catégorie 1,6 : 1), dont 1 hors service ; objets télécom gardés : 1, dont 1 hors service');
    expect(() => shomCableCounts({})).toThrow('réponse WFS du Shom sans « features »');
  });
});

describe('simplifyRing et zonesOverlap', () => {
  it(`sommets alignés retirés sous ${ZONE_SIMPLIFY_M} m ; anneau fermé ; anneau qui tomberait sous 4 sommets rendu tel quel`, () => {
    const ring: Ring = [[5, 43], [5.005, 43.00001], [5.01, 43], [5.01, 43.01], [5, 43.01], [5, 43]];
    expect(simplifyRing(ring, ZONE_SIMPLIFY_M)).toEqual([[5, 43], [5.01, 43], [5.01, 43.01], [5, 43.01], [5, 43]]);
    const thin: Ring = [[5, 43], [5.00001, 43], [5.00002, 43], [5.00001, 43.00001], [5, 43]];
    expect(simplifyRing(thin, ZONE_SIMPLIFY_M)).toEqual(thin);
  });
  it('recouvrement : sommet dans l’autre, zone incluse, bords croisés sans sommet inclus ; zones disjointes', () => {
    expect(zonesOverlap(zone([square(5, 43, 0.01)]), zone([square(5.005, 43.005, 0.01)]))).toBe(true);
    expect(zonesOverlap(zone([square(5, 43, 0.1)]), zone([square(5.04, 43.04, 0.01)]))).toBe(true);
    const wide = zone([[[[5, 43.004], [5.03, 43.004], [5.03, 43.006], [5, 43.006], [5, 43.004]]]]);
    const tall = zone([[[[5.014, 42.99], [5.016, 42.99], [5.016, 43.02], [5.014, 43.02], [5.014, 42.99]]]]);
    expect(zonesOverlap(wide, tall)).toBe(true);
    expect(zonesOverlap(zone([square(5, 43, 0.01)]), zone([square(5.02, 43, 0.01)]))).toBe(false);
  });
});

describe('zones du Shom', () => {
  const cableZones = shomToCableZones(CABLE_ZONES());
  const anchorages = shomToAnchorageZones(ANCHORAGES(), cableZones);
  it('zones de câbles : catégorie télécom, polygones simplifiés à 10 m et fermés, Licence ouverte 2.0', () => {
    expect(cableZones.map((z) => [z.id, z.name, z.info, z.cableCategory, z.source, z.licence])).toEqual([
      ['shom/FR000050859100003', null, null, null, 'Shom', 'Licence ouverte 2.0'],
      ['shom/FR000009979300003', null, null, 'telecom', 'Shom', 'Licence ouverte 2.0'],
    ]);
    const ring = cableZones[1].polygons[0][0];
    expect(ring.length).toBeLessThan(887 / 2);
    expect(ring.at(-1)).toEqual(ring[0]);
  });
  it('zones de mouillage : nom, mouillage permis, recoupement d’une zone de câbles (S9), trous gardés', () => {
    expect(anchorages).toHaveLength(10);
    expect(anchorages.find((z) => z.name === 'Sainte-Marie')?.id).toBe('shom/FR000017261400001');
    expect(anchorages.some((z) => z.anchoringProhibited)).toBe(false);
    // Recoupements contrôlés à part sur les polygones d'origine (grille de 300 × 300 points, 04/10/2026).
    expect(anchorages.filter((z) => z.crossesCableZone).map((z) => z.id)).toEqual([
      'shom/FR000051251200003', 'shom/FR000051209200003', 'shom/FR000051209300003', 'shom/FR000051209600003', 'shom/FR000017261400001',
    ]);
    expect(anchorages.find((z) => z.id === 'shom/FR000051209600003')?.polygons[0]).toHaveLength(7);
  });
  it('restriction S-57 1 : mouillage interdit ; information en français, tiret cadratin remplacé', () => {
    const json = { type: 'FeatureCollection', features: [{ id: 'achare_polygon.1', properties: { inspireid: 'FR1', restrn: '1,4,8,11,27',
      inform: 'Small craft moorings', ninfom: 'Mouillage sur bouées \u2014 essai' }, geometry: { type: 'Polygon', coordinates: square(5, 43, 0.01) } }] };
    const [z] = shomToAnchorageZones(json, []);
    expect([z.id, z.info, z.anchoringProhibited, z.crossesCableZone]).toEqual(['shom/FR1', 'Mouillage sur bouées : essai', true, false]);
  });
  it('anneau extérieur illisible : zone écartée (jamais un trou promu en contour) ; trou illisible : seul retiré', () => {
    const hole: Ring = [[5.004, 43.004], [5.006, 43.004], [5.006, 43.006], [5.004, 43.004]];
    const feature = (id: string, rings: Ring[]) => ({ id, properties: { inspireid: id }, geometry: { type: 'Polygon', coordinates: rings } });
    const json = { type: 'FeatureCollection', features: [
      feature('FR-A', [[[5, 43], [5.01, 43], [5, 43]], hole]),
      feature('FR-B', [square(5, 43, 0.01)[0], [[5.004, 43.004], [5.006, 43.004], [5.004, 43.004]]]),
    ] };
    expect(shomToCableZones(json).map((z) => [z.id, z.polygons])).toEqual([['shom/FR-B', [square(5, 43, 0.01)]]]);
  });
});

describe('osmComplement : câbles OpenStreetMap absents du Shom', () => {
  it('sur les relevés du 04/10/2026 : les câbles de Marseille lus au Shom sont retirés, AMITIE et BARMAR restent', () => {
    const osm = overpassToCables(fixture('osm-subsea-cables.json'), GEO);
    const kept = osmComplement(osm, shomToCables(CABLES(), GEO));
    expect(osm.filter((c) => !kept.includes(c)).map((c) => c.name)).toEqual(['ARIANE 2', 'SEA ME WE4-S4.7', 'IMEWE Seg3.4']);
    expect(kept.map((c) => c.name)).toEqual(expect.arrayContaining(['AMITIE', 'BARMAR']));
  });
  it(`tracé parallèle à moins de ${COVER_M} m : déjà au Shom ; à 5 km : complément ; sans point près d’un atterrage : complément`, () => {
    const shom = [{ path: [[[5, 43.3], [5, 43]]] as Ring[] }];
    const osmAt = (dLon: number, lat = 43.3) => ({ path: [[[5 + dLon, lat], [5 + dLon, 43]]] as Ring[], landings: [{ lat, lon: 5 + dLon }] });
    const near = osmAt(0.012);
    const far = osmAt(0.062);
    const lonely = { path: [[[5, 43.3], [5, 43]]] as Ring[], landings: [{ lat: 45, lon: 5 }] };
    expect(osmComplement([near, far, lonely], shom)).toEqual([far, lonely]);
  });
});
