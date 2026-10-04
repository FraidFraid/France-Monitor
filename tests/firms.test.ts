// Lecture des CSV FIRMS (spec 2026-10-04 environnement § 2.4, E3) : réponses réelles du 03 et du 04/10/2026.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FIRMS_PUBLIC_SOURCE, confidenceClass, firmsAreaUrl, inFirmsBox, normalizeDetection, normalizeRows, parseFirmsCsv,
} from '../api/_lib/firms.js';

const fx = (name: string): string => readFileSync(new URL(`./fixtures/environment/${name}`, import.meta.url), 'utf8');

describe('parseFirmsCsv', () => {
  it('lit les colonnes VIIRS telles que publiées (texte brut)', () => {
    const rows = parseFirmsCsv(fx('firms-viirs-snpp-nrt-extrait.csv'));
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ latitude: '45.14333', longitude: '9.94358', acq_date: '2026-10-03', acq_time: '137', satellite: 'N', confidence: 'n', frp: '0.97', daynight: 'N' });
  });
  it('lit les colonnes MODIS (brightness, confiance de 0 à 100)', () => {
    const rows = parseFirmsCsv(fx('firms-modis-nrt-extrait.csv'));
    expect(rows.map((r) => [r.satellite, r.confidence])).toEqual([['Aqua', '29'], ['Terra', '42'], ['Terra', '0']]);
  });
  it('un CSV réduit à son en-tête : aucune détection (vraie absence, pas une panne)', () => {
    expect(parseFirmsCsv('latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight\n')).toEqual([]);
  });
  it('lignes au nombre de champs inattendu : écartées et comptées (rejected)', () => {
    const head = 'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight';
    const ok = '43.4,4.8,317.35,0.43,0.46,2026-10-04,120,N,VIIRS,n,2.0NRT,285.92,1.83,N';
    const rows = parseFirmsCsv(`${head}\n${ok}\n43.4,4.8,truncated\n${ok},extra\n`);
    expect(rows).toHaveLength(1);
    expect((rows as unknown as { rejected: number }).rejected).toBe(2);
    expect((parseFirmsCsv(`${head}\n${ok}\n`) as unknown as { rejected: number }).rejected).toBe(0);
  });
  it('message ou page à la place du CSV, corps vide : erreur', () => {
    expect(() => parseFirmsCsv('Invalid MAP_KEY.')).toThrow('CSV FIRMS illisible (en-tête inattendu)');
    expect(() => parseFirmsCsv('<!DOCTYPE html><html><body>Maintenance</body></html>')).toThrow('CSV FIRMS illisible');
    expect(() => parseFirmsCsv('  \n')).toThrow('CSV FIRMS vide');
  });
});

describe('normalizeDetection', () => {
  const [snpp] = parseFirmsCsv(fx('firms-viirs-snpp-nrt-extrait.csv'));
  const modis = parseFirmsCsv(fx('firms-modis-nrt-extrait.csv'));
  it('VIIRS : satellite exact, capteur, confiance en lettres, heure complétée à 4 chiffres, identifiant du contrat', () => {
    expect(normalizeDetection(snpp, 'VIIRS_SNPP_NRT')).toEqual({
      id: '45.1433_9.9436_2026-10-03_0137_Suomi NPP', lat: 45.14333, lon: 9.94358, acquiredAt: '2026-10-03T01:37:00.000Z',
      satellite: 'Suomi NPP', sensor: 'VIIRS', confidence: 'nominale', confidenceRaw: 'n', frpMw: 0.97, daynight: 'N',
    });
  });
  it('MODIS : Aqua et Terra, classes FIRMS 0 à 29 faible, 30 à 79 nominale, 80 à 100 haute', () => {
    const [aqua, terra, terraZero] = modis.map((r) => normalizeDetection(r, 'MODIS_NRT'));
    expect(aqua).toMatchObject({ satellite: 'Aqua', sensor: 'MODIS', confidence: 'faible', confidenceRaw: '29', frpMw: 8.37, acquiredAt: '2026-10-03T04:32:00.000Z' });
    expect(terra).toMatchObject({ satellite: 'Terra', confidence: 'nominale', confidenceRaw: '42', daynight: 'D', acquiredAt: '2026-10-03T08:48:00.000Z' });
    expect(terraZero).toMatchObject({ confidence: 'faible', confidenceRaw: '0' });
    expect(normalizeDetection({ ...modis[0], satellite: 'T', confidence: '85' }, 'MODIS_NRT')).toMatchObject({ satellite: 'Terra', confidence: 'haute' });
    expect(normalizeDetection({ ...modis[0], satellite: 'A', confidence: '80' }, 'MODIS_NRT')).toMatchObject({ satellite: 'Aqua', confidence: 'haute' });
  });
  it('confiance VIIRS l et h ; NOAA-20 et NOAA-21', () => {
    expect(normalizeDetection({ ...snpp, confidence: 'h', satellite: 'N20' }, 'VIIRS_NOAA20_NRT')).toMatchObject({ satellite: 'NOAA-20', confidence: 'haute', confidenceRaw: 'h' });
    expect(normalizeDetection({ ...snpp, confidence: 'l', satellite: 'N21' }, 'VIIRS_NOAA21_NRT')).toMatchObject({ satellite: 'NOAA-21', confidence: 'faible' });
    expect(confidenceClass('101', 'MODIS')).toBeNull();
    expect(confidenceClass('x', 'VIIRS')).toBeNull();
  });
  it('CSV public sans colonne instrument : Suomi NPP par la source', () => {
    const { instrument: _ignored, ...row } = snpp;
    expect(normalizeDetection({ ...row, satellite: '' }, FIRMS_PUBLIC_SOURCE)).toMatchObject({ satellite: 'Suomi NPP', sensor: 'VIIRS' });
  });
  it('ligne illisible écartée, jamais de valeur inventée', () => {
    expect(normalizeDetection({ ...snpp, latitude: 'abc' }, 'VIIRS_SNPP_NRT')).toBeNull();
    expect(normalizeDetection({ ...snpp, acq_time: '2599' }, 'VIIRS_SNPP_NRT')).toBeNull();
    expect(normalizeDetection({ ...snpp, confidence: '?' }, 'VIIRS_SNPP_NRT')).toBeNull();
    expect(normalizeDetection({ ...snpp, frp: '1.2abc' }, 'VIIRS_SNPP_NRT')).toBeNull();
    expect(normalizeDetection({ ...snpp, frp: '' }, 'VIIRS_SNPP_NRT')).toBeNull();
    expect(normalizeDetection({ ...snpp, daynight: '' }, 'VIIRS_SNPP_NRT')).toBeNull();
  });
});

describe('normalizeRows et URL', () => {
  it('détections françaises réelles du 03 et du 04/10 : dans la boîte, sans doublon', () => {
    const rows = parseFirmsCsv(fx('firms-france-extrait.csv'));
    const all = normalizeRows([...rows, rows[0]], 'VIIRS_SNPP_NRT');
    expect(all).toHaveLength(17);
    expect(all.filter((d) => d.satellite === 'NOAA-21')).toHaveLength(8);
    expect(all.find((d) => d.frpMw === 11.67)).toMatchObject({ satellite: 'NOAA-21', acquiredAt: '2026-10-03T12:27:00.000Z', daynight: 'D' });
    expect(normalizeRows([{ ...rows[0], latitude: '60.1' }], 'VIIRS_SNPP_PUBLIC_24H')).toEqual([]);
    expect(inFirmsBox(43.44, 4.89)).toBe(true);
    expect(inFirmsBox(40.5, 4.89)).toBe(false);
  });
  it('API area : clé dans le chemin, 2 jours par défaut, amorçage par date de début et 5 jours', () => {
    expect(firmsAreaUrl('CLE', 'VIIRS_SNPP_NRT')).toBe('https://firms.modaps.eosdis.nasa.gov/api/area/csv/CLE/VIIRS_SNPP_NRT/-6,41,10,52/2');
    expect(firmsAreaUrl('CLE', 'MODIS_NRT', { days: 5, date: '2026-09-25' })).toBe('https://firms.modaps.eosdis.nasa.gov/api/area/csv/CLE/MODIS_NRT/-6,41,10,52/5/2026-09-25');
  });
});
