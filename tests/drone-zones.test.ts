// tests/drone-zones.test.ts : zones drones DGAC (spec 2026-10-04 souveraineté § 3.2 ; contrats § 1.2, § 8 B21) : adresses WFS
// (filtre CQL toujours présent, pages sans SORTBY), édition lue dans GetCapabilities, agglomérations écartées, simplification bornée,
// fichier publié daté, sourcé, sous 1,5 Mio. Jeu d'essai réel du 04/10/2026 réduit à 12 zones.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DRONES_FILE_PATH, DRONES_LEGEND, assertCompleteRead, distinctIdCount, droppedIds, DRONES_LICENCE, DRONES_POINTER, DRONES_TITLE, DRONES_SOURCE, MAX_FILE_BYTES, NON_AGGLO_CQL, PAGE_SIZE, VOL_INTERDIT_CQL, buildDroneZonesFile, capabilitiesUrl,
  editionFromCapabilities, hitsUrl, isAgglomeration, numberMatchedOf, pageUrl, ringTolerance, simplifyRing, toDroneZone,
} from '../api/_lib/drone-zones.js';
import type { DroneZone, DroneZonesFile } from '../src/types/index.ts';

interface WfsFeature { type: 'Feature'; id: string; geometry: { type: 'MultiPolygon'; coordinates: number[][][][] }; properties: { limite: string | null; remarque: string | null } }
const FX = JSON.parse(readFileSync(new URL('./fixtures/sovereignty/geopf-drones-extrait.json', import.meta.url), 'utf8')) as { features: WfsFeature[] };
/** Extrait de GetCapabilities (04/10/2026) : la couche des drones, précédée d'une autre couche qui porte une autre édition. */
const CAPS = '<?xml version="1.0" encoding="UTF-8"?><wfs:WFS_Capabilities version="2.0.0"><FeatureTypeList>'
  + '<FeatureType><Name>AUTRE:couche</Name><Abstract>Édition 2019-01-01</Abstract></FeatureType>'
  + '<FeatureType xmlns:TRANSPORTS.DRONES.RESTRICTIONS="http://TRANSPORTS.DRONES.RESTRICTIONS"><Name>TRANSPORTS.DRONES.RESTRICTIONS:carte_restriction_drones_lf</Name>'
  + '<Title><![CDATA[Restrictions UAS catégorie Ouverte et Aéromodélisme ]]></Title><Abstract>{quote}Zones soumises à interdictions ou à restrictions pour l’usage, '
  + 'à titre de loisir, d’aéronefs télépilotés (ou drones), sur le territoire métropolitain, en Guyane, aux Antilles françaises, Saint-Pierre et Miquelon, '
  + 'Mayotte, La Réunion et aux Terres Australes, à jour au 07-2025. Elle intègre partiellement les interdictions s\'appuyant sur des données non publiées '
  + 'à l\'AIP et ne couvre pas les interdictions temporaires.{quote} ; Édition 2025-07-01</Abstract></FeatureType></FeatureTypeList></wfs:WFS_Capabilities>';
/** Réponse RESULTTYPE=hits du 04/10/2026 (zones hors agglomération de la métropole). */
const HITS = '<?xml version="1.0" encoding="UTF-8"?><wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" numberMatched="5543" numberReturned="0" timeStamp="2026-10-04T15:31:02.517Z"/>';
const points = (z: DroneZone): number => z.polygons.reduce((s, poly) => s + poly.reduce((t, ring) => t + ring.length, 0), 0);
const decimals = (v: number): number => (String(v).split('.')[1] ?? '').length;

describe('adresses WFS : filtre CQL toujours présent, pages sans tri', () => {
  it('compte et page de la métropole hors agglomérations ; ordre lat, lon de la boîte ; aucun SORTBY', () => {
    expect(hitsUrl(NON_AGGLO_CQL)).toBe('https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature'
      + '&TYPENAMES=TRANSPORTS.DRONES.RESTRICTIONS%3Acarte_restriction_drones_lf&RESULTTYPE=hits'
      + "&CQL_FILTER=limite%20LIKE%20'Vol%20interdit%25'%20AND%20BBOX(geom%2C41%2C-5.5%2C51.5%2C10)%20AND%20NOT%20(remarque%20LIKE%20'%25en%20agglom%25')");
    expect(pageUrl(NON_AGGLO_CQL, 2000)).toContain(`&OUTPUTFORMAT=application%2Fjson&COUNT=${PAGE_SIZE}&STARTINDEX=2000&CQL_FILTER=`);
    expect(pageUrl(VOL_INTERDIT_CQL, 0)).not.toContain('SORTBY');
    expect(capabilitiesUrl()).toBe('https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetCapabilities');
  });
  it('édition de la couche des drones (jamais celle d’une autre couche), compte des zones', () => {
    expect(editionFromCapabilities(CAPS)).toBe('2025-07-01');
    expect(editionFromCapabilities('<FeatureType><Name>AUTRE:couche</Name><Abstract>Édition 2019-01-01</Abstract></FeatureType>')).toBeNull();
    expect(numberMatchedOf(HITS)).toBe(5543);
    expect(numberMatchedOf('<html></html>')).toBeNull();
  });
});

describe('titre, légende officiels et renvoi (amendement S6)', () => {
  it('titre et légende de la couche repris du GetCapabilities ; renvoi au SIA et aux arrêtés préfectoraux ; aucun tiret cadratin', () => {
    expect(DRONES_TITLE).toBe('Restrictions UAS catégorie Ouverte et Aéromodélisme');
    expect(CAPS).toContain(DRONES_LEGEND.replace('s\u2019appuyant', "s'appuyant").replace('à l\u2019AIP', "à l'AIP"));
    expect(DRONES_LEGEND).toContain('ne couvre pas les interdictions temporaires');
    expect(DRONES_POINTER).toMatch(/SIA/);
    expect(DRONES_POINTER).toMatch(/arrêtés préfectoraux/);
    expect(`${DRONES_TITLE}${DRONES_LEGEND}${DRONES_POINTER}`).not.toContain('\u2014');
  });
});

describe('relevé complet (identifiants distincts lus = compte annoncé)', () => {
  it('relevé complet accepté ; page tronquée ou page répétée refusée, erreur nommée', () => {
    expect(distinctIdCount(FX.features)).toBe(12);
    expect(assertCompleteRead(FX.features, 12)).toBe(12);
    expect(() => assertCompleteRead(FX.features.slice(0, 10), 12)).toThrow('zones drones : 10 lues sur 12 annoncées, fichier non écrit');
    expect(() => assertCompleteRead([...FX.features.slice(0, 6), ...FX.features.slice(0, 6)], 12)).toThrow('6 lues sur 12 annoncées');
  });
  it('zones écartées nommées', () => {
    const flat = { ...FX.features[0], id: 'carte_restriction_drones_lf.999', geometry: { type: 'MultiPolygon' as const, coordinates: [[[[0, 0], [1, 0], [0, 0]]]] } };
    expect(droppedIds([...FX.features, flat])).toEqual(['999']);
    expect(droppedIds(FX.features)).toEqual([]);
  });
});

describe('zones gardées et simplifiées', () => {
  it('agglomération ou autre limite : jamais gardée', () => {
    expect(isAgglomeration('Évolution interdite en espace public en agglomération sauf conformément à l’arrêté Espace.')).toBe(true);
    expect(isAgglomeration("Altitude de référence de l'aérodrome : 113 m")).toBe(false);
    const geometry = FX.features[0].geometry;
    expect(toDroneZone({ type: 'Feature', id: 'carte_restriction_drones_lf.1', geometry, properties: { limite: 'Vol interdit *', remarque: 'Évolution interdite en espace public en agglomération sauf conformément à l’arrêté Espace.' } })).toBeNull();
    expect(toDroneZone({ type: 'Feature', id: 'carte_restriction_drones_lf.2', geometry, properties: { limite: 'Hauteur maximale de vol de 50 m *', remarque: null } })).toBeNull();
  });
  it('12 zones réelles : 6 508 sommets ramenés à 499, anneaux refermés d’au moins 4 points, 4 décimales au plus', () => {
    const file = buildDroneZonesFile({ features: FX.features, edition: '2025-07-01', volInterdit: 73_000, nonAgglomeration: 5543, generatedAt: '2026-10-04T15:40:00.000Z' });
    expect(file.zones.map((z) => `${z.id}:${points(z)}`)).toEqual([
      '54998:12', '54999:4', '55000:5', '55002:11', '55094:5', '55097:5', '56167:6', '56169:5', '56265:6', '56266:6', '59599:428', '59687:6',
    ]);
    expect(file.zones.reduce((s, z) => s + points(z), 0)).toBe(499);
    const zone59599 = file.zones.find((z) => z.id === '59599');
    expect([zone59599?.polygons.length, zone59599?.polygons[0].length]).toEqual([1, 51]);
    expect(file.zones.find((z) => z.id === '54999')).toEqual({
      id: '54999', remarque: "Altitude de référence de l'aérodrome : 112 m",
      polygons: [[[[5.4168, 43.457], [5.4181, 43.4584], [5.4196, 43.4585], [5.4168, 43.457]]]],
    });
    for (const z of file.zones) {
      for (const poly of z.polygons) {
        for (const ring of poly) {
          expect(ring.length).toBeGreaterThanOrEqual(4);
          expect(ring[0]).toEqual(ring[ring.length - 1]);
          for (const [lon, lat] of ring) expect(Math.max(decimals(lon), decimals(lat))).toBeLessThanOrEqual(4);
        }
      }
    }
  });
  it('fichier : comptes de la métropole, édition, source et licence ; une zone en double comptée une fois', () => {
    const file = buildDroneZonesFile({
      features: [...FX.features, FX.features[0]], edition: '2025-07-01', volInterdit: 73_000, nonAgglomeration: 5543, generatedAt: '2026-10-04T15:40:00.000Z',
    });
    expect([file.counts, file.edition, file.source, file.licence, file.generatedAt])
      .toEqual([{ volInterdit: 73_000, agglomerations: 67_457, kept: 12 }, '2025-07-01', DRONES_SOURCE, DRONES_LICENCE, '2026-10-04T15:40:00.000Z']);
    expect([DRONES_SOURCE, DRONES_LICENCE]).toEqual(['DGAC / IGN, Géoplateforme', 'CGU cartes.gouv.fr']);
  });
  it('tolérance bornée selon la taille ; anneau dégénéré écarté ; un point presque en double disparaît', () => {
    expect(ringTolerance([[0, 0], [0.001, 0], [0.001, 0.001], [0, 0]])).toBe(0.0003);
    expect(ringTolerance([[0, 0], [1, 0], [1, 1], [0, 0]])).toBe(0.006);
    expect(simplifyRing([[0, 0], [1, 0], [0, 0]], 0.01)).toBeNull();
    expect(simplifyRing([[0, 0], [0, 0], [0, 0], [0, 0]], 0.01)).toBeNull();
    expect(simplifyRing([[2, 48], [2.00001, 48], [2.1, 48], [2.1, 48.1], [2, 48.1], [2, 48]], 0.006))
      .toEqual([[2, 48], [2.1, 48], [2.1, 48.1], [2, 48.1], [2, 48]]);
  });
});

describe('fichier publié public/data/drone-restrictions.json (généré par le script le 04/10/2026)', () => {
  it('daté, sourcé, borné à 1,5 Mio, environ 5 540 zones « vol interdit » hors agglomération de la métropole', () => {
    expect(existsSync(DRONES_FILE_PATH)).toBe(true);
    expect(statSync(DRONES_FILE_PATH).size).toBeLessThan(MAX_FILE_BYTES);
    expect(MAX_FILE_BYTES).toBe(1_572_864);
    const file = JSON.parse(readFileSync(DRONES_FILE_PATH, 'utf8')) as DroneZonesFile;
    expect([file.edition, file.source, file.licence]).toEqual(['2025-07-01', 'DGAC / IGN, Géoplateforme', 'CGU cartes.gouv.fr']);
    expect(Number.isFinite(Date.parse(file.generatedAt))).toBe(true);
    expect(file.counts.kept).toBe(file.zones.length);
    expect(file.counts.kept).toBeGreaterThan(5000);
    expect(file.counts.kept).toBeLessThan(6000);
    expect(file.counts.volInterdit).toBeGreaterThan(60_000);
    expect(file.counts.agglomerations + file.counts.kept).toBeLessThanOrEqual(file.counts.volInterdit);
    // un fichier tronqué échoue : au plus 5 zones dégénérées écartées sur les hors-agglomération
    expect(file.counts.volInterdit - file.counts.agglomerations - file.counts.kept).toBeLessThanOrEqual(5);
    // Défauts collectés puis une seule assertion : un expect par sommet (des centaines de milliers) dépassait le délai de 5 s quand la
    // machine est chargée (suite entière, serveur de dev).
    const defects: string[] = [];
    for (const z of file.zones) {
      if (!/^\d+$/.test(z.id)) defects.push(`${z.id} : identifiant`);
      if (isAgglomeration(z.remarque)) defects.push(`${z.id} : agglomération`);
      if (z.polygons.length === 0) defects.push(`${z.id} : sans polygone`);
      for (const ring of z.polygons.flat()) {
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (ring.length < 4) defects.push(`${z.id} : anneau de ${ring.length} points`);
        if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) defects.push(`${z.id} : anneau non fermé`);
        for (const [lon, lat] of ring) {
          if (!(lon > -6 && lon < 10.5 && lat > 40.5 && lat < 52)) defects.push(`${z.id} : sommet hors métropole ${lon},${lat}`);
        }
      }
    }
    expect(defects.slice(0, 10)).toEqual([]);
  });
});
