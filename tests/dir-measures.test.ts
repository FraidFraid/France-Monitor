import { afterEach, describe, expect, it, vi } from 'vitest';
import proj4 from 'proj4';
import {
  CNIR_URL, QTV_URL, REFDIR_URL, TRAFICOLOR_BASE, lambert93ToWgs84, latestDataFile, loadTraficolorNetwork, parseCnir, parseListing,
  parseQtv, parseRefDir, parseRefDirPaths, buildSections, parseTraficolor, summarizeSpeeds, summarizeTraficolor,
} from '../api/_lib/dir-measures.js';
import { parisLocalToIso } from '../api/_lib/paris-time.js';
import { fixtureText, respond, stubFetch } from './helpers/traffic-fixtures.ts';

afterEach(() => { vi.unstubAllGlobals(); });

describe('heure de Paris sans fuseau', () => {
  it('Traficolor, SNCF : heure murale de Paris → ISO UTC ; fuseau présent : gardé ; illisible : null', () => {
    expect(parisLocalToIso('2026-10-03T15:44:40')).toBe('2026-10-03T13:44:40.000Z');
    expect(parisLocalToIso('20261003T151029')).toBe('2026-10-03T13:10:29.000Z');
    expect(parisLocalToIso('2026-12-03T08:30:00.000')).toBe('2026-12-03T07:30:00.000Z');
    expect(parisLocalToIso('2026-10-03T15:48:26+02:00')).toBe('2026-10-03T13:48:26.000Z');
    expect(parisLocalToIso('hier')).toBeNull();
  });
});

describe('référentiel refDir.csv (Lambert-93)', () => {
  it('reprojection identique à proj4 (EPSG:2154) à 1e-9 degré près', () => {
    proj4.defs('EPSG:2154', '+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
    for (const [x, y] of [[571463.6, 6281905.0], [888942.06, 6254719.5], [160000, 6800000], [1240000, 6100000]]) {
      const ours = lambert93ToWgs84(x, y);
      const ref = proj4('EPSG:2154', 'EPSG:4326', [x, y]);
      expect(Math.abs((ours?.[0] ?? 0) - ref[0])).toBeLessThan(1e-9);
      expect(Math.abs((ours?.[1] ?? 0) - ref[1])).toBeLessThan(1e-9);
    }
    expect(lambert93ToWgs84(Number.NaN, 0)).toBeNull();
  });
  it('lignes à 19 colonnes pour un en-tête de 20 : colonnes lues sans « code_insee_commune »', () => {
    const ref = parseRefDir(fixtureText('refdir.csv'));
    expect(ref.size).toBe(74);
    expect(ref.get('MB731.B1')).toEqual({ dir: 'DIR Sud-Ouest', road: 'A621', lat: 43.62453, lon: 1.407806 });
    expect(ref.get('MWN44.U2')).toEqual({ dir: 'DIR Ouest', road: 'N844', lat: null, lon: null });
  });
  it('page HTML à la place du CSV : erreur', () => {
    expect(() => parseRefDir('<!DOCTYPE html><html></html>')).toThrow(SyntaxError);
  });
});

describe('sections Traficolor géolocalisées (amendement 3)', () => {
  const paths = parseRefDirPaths(fixtureText('refdir.csv'));
  const sections = buildSections('TraficMarius', parseTraficolor(fixtureText('traficolor-TraficMarius.xml')), paths);
  it('tracé début-fin reprojeté ; section sans géométrie absente', () => {
    expect(sections).toHaveLength(24);
    expect(sections.find((s) => s.id === 'MM213.N1')).toBeUndefined();
    const s = sections.find((x) => x.id === 'MM213.p2');
    expect(s?.network).toBe('TraficMarius');
    expect(['freeFlow', 'heavy', 'congested', 'unknown']).toContain(s?.status);
    expect(s?.path).toHaveLength(2);
    const [a, b] = [lambert93ToWgs84(896832.7, 6246926.5), lambert93ToWgs84(897034.6, 6245983.5)];
    expect(s?.path[0][0]).toBeCloseTo(a?.[0] ?? 0, 6);
    expect(s?.path[1][1]).toBeCloseTo(b?.[1] ?? 0, 6);
  });
  it('sections connues du référentiel mais sans coordonnées : hors carte, comptées dans l’agglomération', () => {
    const bordeaux = parseTraficolor(fixtureText('traficolor-ALIENOR.xml'));
    expect(buildSections('ALIENOR', bordeaux, paths)).toEqual([]);
    expect(summarizeTraficolor('ALIENOR', bordeaux).sections).toBe(bordeaux.statuses.length);
  });
});

describe('vitesses mesurées (QTV réel, mesure de 15 h)', () => {
  it('sentinelles 0 et 9999999 écartées, 16 stations lentes, médiane, dix plus lentes', () => {
    const s = summarizeSpeeds(parseQtv(fixtureText('qtv-dir.xml')), parseRefDir(fixtureText('refdir.csv')));
    expect(s).toMatchObject({ at: '2026-10-03T15:00:00.000+02:00', stations: 41, under50: 16, median: 67.8 });
    expect(s.slowest).toHaveLength(10);
    expect(s.slowest[2]).toEqual({ id: 'MB731.B1', dir: 'DIR Sud-Ouest', road: 'A621', speed: 14.2, flow: 1100, lat: 43.62453, lon: 1.407806 });
    expect(s.slowest.every((x) => x.speed < 50 && (x.flow ?? 0) > 1000)).toBe(true);
  });
  it('station lente mais à faible débit : jamais comptée', () => {
    const s = summarizeSpeeds({ at: null, stations: [{ id: 'x', speed: 20, flow: 400 }, { id: 'y', speed: 9_999_999, flow: 2000 }] }, new Map());
    expect([s.stations, s.under50, s.median]).toEqual([1, 0, 20]);
  });
});

describe('Traficolor (fichiers réels de 15 h 44 à 15 h 48)', () => {
  it('index et listes : réseaux, dernier fichier par horodatage du nom', () => {
    expect(parseListing(fixtureText('traficolor-index.html'))).toEqual(['ALIENOR/', 'TraficLille/', 'TraficMarius/']);
    expect(latestDataFile(parseListing(fixtureText('traficolor-listing-TraficLille.html')))).toBe('TraficLille_DataTRT_20261003_154826.xml');
    expect(latestDataFile(['TraficGentiane_1_DataTRT_20261003_154820.xml', 'TraficGentiane_1_DataTRT_20261003_155420.xml'])).toBe('TraficGentiane_1_DataTRT_20261003_155420.xml');
  });
  it('Marseille : 12 sections saturées sur 25 ; Bordeaux (date sans fuseau) : part sur les sections connues', () => {
    expect(summarizeTraficolor('TraficMarius', parseTraficolor(fixtureText('traficolor-TraficMarius.xml')))).toEqual({
      network: 'TraficMarius', label: 'Marseille', sections: 25, freeFlow: 13, heavy: 0, congested: 12, unknown: 0, congestedPct: 48, at: '2026-10-03T13:48:00.000Z',
    });
    expect(summarizeTraficolor('ALIENOR', parseTraficolor(fixtureText('traficolor-ALIENOR.xml')))).toMatchObject({
      label: 'Bordeaux', unknown: 8, congested: 3, congestedPct: 17.6, at: '2026-10-03T13:44:40.000Z',
    });
  });
  it('lecture d’un réseau : liste triée par date puis dernier fichier', async () => {
    const log = stubFetch((url) => (url.endsWith('/TraficLille/?C=M;O=D')
      ? respond(fixtureText('traficolor-listing-TraficLille.html'))
      : respond(fixtureText('traficolor-TraficLille.xml'))));
    expect(await loadTraficolorNetwork('TraficLille')).toMatchObject({ label: 'Lille', heavy: 10, congested: 1, congestedPct: 4.2 });
    expect(log.urls).toEqual([`${TRAFICOLOR_BASE}/TraficLille/?C=M;O=D`, `${TRAFICOLOR_BASE}/TraficLille/TraficLille_DataTRT_20261003_154826.xml`]);
  });
});

describe('autoroutes concédées (récapitulatif CNIR réel de 15 h 42)', () => {
  it('date de la page, six bouchons d’origine SCA ; la ligne DIRCE (A42, déjà dans DATEX) écartée', () => {
    const c = parseCnir(fixtureText('cnir-bouchons.html'));
    expect(c.at).toBe('2026-10-03T13:42:00.000Z');
    expect(c.jams.map((j) => j.motorway)).toEqual(['A8', 'A8', 'A709', 'A40', 'A4', 'A10']);
    expect(c.jams[0]).toEqual({
      motorway: 'A8', lengthKm: 1.5, from: 'Aix-en-Provence', to: 'Italie - Genova', operator: 'Escota', importance: 3,
      text: 'Bouchon de 1,5 km, A8, de Aix-en-Provence vers Italie - Genova, à Mougins',
    });
    expect(c.jams[2]).toMatchObject({ motorway: 'A709', from: null, to: null, operator: 'ASF', importance: 2 });
  });
  it('autre page servie à la place du récapitulatif : erreur', () => {
    expect(() => parseCnir('<html><body>Accueil</body></html>')).toThrow(SyntaxError);
  });
  it('URL des sources (HTTPS)', () => {
    expect([QTV_URL, REFDIR_URL, CNIR_URL].every((u) => u.startsWith('https://tipi.bison-fute.gouv.fr/'))).toBe(true);
  });
});
