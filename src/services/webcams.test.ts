// src/services/webcams.test.ts : garde du contrat webcams.json (docs/webcams_format.md de flux_osint), couleurs et états, lien et
// vignette, lecture unique mémorisée, et fichier publié réel.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { levelHex } from './vigilance.ts';
import { CAM, DS } from './webcams.fixture.ts';
import {
  WEBCAM_STATUS_HEX, fetchWebcamsDataset, frDateTime, isWebcamsDataset, resetWebcamsCache, webcamColor, webcamCounts, webcamOpenUrl,
  webcamPlace, webcamThumbnailUrl,
} from './webcams.ts';

const clone = (): Record<string, unknown> => JSON.parse(JSON.stringify(DS)) as Record<string, unknown>;
const camAt = (o: Record<string, unknown>, i: number): Record<string, unknown> => (o['webcams'] as Array<Record<string, unknown>>)[i];

describe('garde du contrat webcams.json', () => {
  it('accepte un exemple valide', () => {
    expect(isWebcamsDataset(DS)).toBe(true);
  });
  it.each(['id', 'name', 'lat', 'status', 'countable', 'checkedAt', 'imageUrl'])('rejette une webcam sans « %s »', (key) => {
    const o = clone();
    delete camAt(o, 0)[key];
    expect(isWebcamsDataset(o)).toBe(false);
  });
  it('rejette les champs mal typés', () => {
    const cases: Array<[string, unknown]> = [['lat', '45.7'], ['status', 'vivant'], ['countable', 'oui'], ['httpStatus', '200'], ['name', ''], ['lon', 400]];
    for (const [key, value] of cases) {
      const o = clone();
      camAt(o, 0)[key] = value;
      expect(isWebcamsDataset(o), key).toBe(false);
    }
  });
  it('rejette une source non déclarée, une source mal formée ou un en-tête absent', () => {
    const o = clone();
    camAt(o, 0)['source'] = 'inconnue';
    expect(isWebcamsDataset(o)).toBe(false);
    const p = clone();
    (p['sources'] as Array<Record<string, unknown>>)[0]['count'] = 'un';
    expect(isWebcamsDataset(p)).toBe(false);
    const q = clone();
    delete q['generatedAt'];
    expect(isWebcamsDataset(q)).toBe(false);
    expect(isWebcamsDataset(null)).toBe(false);
  });
});

describe('états et couleurs', () => {
  it('vert franc (L1) pour un lien actif, gris pour mort ou non vérifiable', () => {
    expect(webcamColor({ status: 'ok' })).toBe(levelHex('vert'));
    expect(webcamColor({ status: 'down' })).toBe(WEBCAM_STATUS_HEX.down);
    expect(webcamColor({ status: 'unknown' })).toBe(WEBCAM_STATUS_HEX.unknown);
    for (const hex of [WEBCAM_STATUS_HEX.down, WEBCAM_STATUS_HEX.unknown]) {
      const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
      expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(30); // gris : composantes proches
    }
  });
  it('comptes par état et « countable »', () => {
    expect(webcamCounts(DS.webcams)).toEqual({ total: 2, ok: 1, down: 1, unknown: 0, countable: 1 });
  });
  it('lien à ouvrir : page, sinon image, sinon flux', () => {
    expect(webcamOpenUrl({ pageUrl: 'https://a', imageUrl: 'https://b', streamUrl: null })).toBe('https://a');
    expect(webcamOpenUrl({ pageUrl: null, imageUrl: 'https://b', streamUrl: 'https://c' })).toBe('https://b');
    expect(webcamOpenUrl({ pageUrl: null, imageUrl: null, streamUrl: null })).toBeNull();
  });
  it('vignette seulement si countable et image directe', () => {
    expect(webcamThumbnailUrl(CAM)).toBe(CAM.imageUrl);
    expect(webcamThumbnailUrl({ ...CAM, countable: false })).toBeNull();
    expect(webcamThumbnailUrl({ countable: true, imageUrl: null })).toBeNull();
  });
  it('date de vérification en heure de Paris, lieu lisible', () => {
    expect(frDateTime('2026-10-18T17:02:00.000Z')).toBe('18/10/2026 à 19:02');
    expect(frDateTime(null)).toBeNull();
    expect(webcamPlace(CAM)).toBe('Vaulx-en-Velin (69)');
    expect(webcamPlace({ commune: null, dept: null })).toBe('Lieu n.d.');
  });
});

describe('lecture du fichier', () => {
  afterEach(() => resetWebcamsCache());
  it('lit une fois, rejette un fichier mal formé sans le mémoriser', async () => {
    let calls = 0;
    const bad = (async () => { calls += 1; return new Response(JSON.stringify({ webcams: 3 })); }) as typeof fetch;
    await expect(fetchWebcamsDataset(bad)).rejects.toThrow('mal formé');
    const good = (async () => { calls += 1; return new Response(JSON.stringify(DS)); }) as typeof fetch;
    await expect(fetchWebcamsDataset(good)).resolves.toEqual(DS);
    await fetchWebcamsDataset(good);
    expect(calls).toBe(2);
  });
  it('le fichier publié respecte le contrat', () => {
    const body: unknown = JSON.parse(readFileSync(new URL('../../public/data/webcams.json', import.meta.url), 'utf8'));
    expect(isWebcamsDataset(body)).toBe(true);
    if (!isWebcamsDataset(body)) return;
    expect(body.webcams.length).toBeGreaterThan(100);
    for (const w of body.webcams) {
      if (w.countable) expect(w.status === 'ok' && w.imageUrl !== null && (w.contentType ?? '').startsWith('image/')).toBe(true);
    }
    expect(new Set(body.webcams.map((w) => w.id)).size).toBe(body.webcams.length);
  });
});
