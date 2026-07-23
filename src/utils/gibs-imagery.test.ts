import { describe, expect, it, vi } from 'vitest';

import {
  buildDefaultGibsViirsTileUrl,
  buildGibsViirsTileUrl,
  listGibsViirsCandidateDates,
  resolveLatestGibsViirsTileUrl,
} from './gibs-imagery.ts';

// GIBS exige le segment {Time} : l'URL non datée renvoie 404 (vérifié le 2026-07-23).
const NOW = Date.UTC(2026, 6, 23, 4, 0, 0); // 2026-07-23T04:00:00Z

function template(date: string): string {
  return 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/'
    + `VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${date}/`
    + 'GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpeg';
}

describe('buildGibsViirsTileUrl', () => {
  it('inclut le segment de date exigé par le WMTS GIBS', () => {
    expect(buildGibsViirsTileUrl('2026-07-21')).toBe(template('2026-07-21'));
  });
});

describe('listGibsViirsCandidateDates', () => {
  it('propose J-1, J-2, J-3 en UTC', () => {
    expect(listGibsViirsCandidateDates(NOW)).toEqual([
      '2026-07-22',
      '2026-07-21',
      '2026-07-20',
    ]);
  });
});

describe('buildDefaultGibsViirsTileUrl', () => {
  it('retombe sur J-2, le meilleur compromis latence/disponibilité', () => {
    expect(buildDefaultGibsViirsTileUrl(NOW)).toBe(template('2026-07-21'));
  });
});

describe('resolveLatestGibsViirsTileUrl', () => {
  it('sonde une tuile témoin en HEAD et retient la première date publiée', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true });

    const url = await resolveLatestGibsViirsTileUrl({ fetchFn, now: NOW });

    expect(url).toBe(template('2026-07-22'));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [probeUrl, init] = fetchFn.mock.calls[0];
    expect(probeUrl).toBe(
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/'
      + 'VIIRS_SNPP_CorrectedReflectance_TrueColor/default/2026-07-22/'
      + 'GoogleMapsCompatible_Level9/5/11/16.jpeg',
    );
    expect(init?.method).toBe('HEAD');
  });

  it('passe à la date suivante quand GIBS répond 404', async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true });

    const url = await resolveLatestGibsViirsTileUrl({ fetchFn, now: NOW });

    expect(url).toBe(template('2026-07-21'));
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('ignore une erreur réseau et continue le sondage', async () => {
    const fetchFn = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ ok: true });

    const url = await resolveLatestGibsViirsTileUrl({ fetchFn, now: NOW });

    expect(url).toBe(template('2026-07-21'));
  });

  it('retombe sur J-2 quand aucune date candidate ne répond', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false });

    const url = await resolveLatestGibsViirsTileUrl({ fetchFn, now: NOW });

    expect(url).toBe(template('2026-07-21'));
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });
});
