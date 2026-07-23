import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _resetRadarColumnStateForTests, fetchRadarColumn, parseRadarColumnProfile } from './radar-column.ts';

const VALID = {
  schemaVersion: 1,
  source: 'Météo-France DPRadar',
  license: 'Licence Ouverte 2.0',
  station: { id: 41, name: 'BORDEAUX', lat: 44.83139, lon: -0.69194 },
  distanceKm: 42.7,
  observedAt: '2026-07-23T08:30:00Z',
  levels: [
    { elevationDeg: 0.4, altitudeM: 620, dbz: 24.5 },
    { elevationDeg: 8, altitudeM: 7150.2, dbz: null },
  ],
};

function jsonResponse(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('parseRadarColumnProfile', () => {
  it('accepte un profil conforme', () => {
    expect(parseRadarColumnProfile(VALID)).toEqual(VALID);
  });

  it('rejette schemaVersion, source ou licence inattendus', () => {
    expect(parseRadarColumnProfile({ ...VALID, schemaVersion: 2 })).toBeNull();
    expect(parseRadarColumnProfile({ ...VALID, source: 'autre' })).toBeNull();
    expect(parseRadarColumnProfile({ ...VALID, license: 'X' })).toBeNull();
  });

  it('rejette les niveaux non triés par altitude', () => {
    const shuffled = { ...VALID, levels: [VALID.levels[1], VALID.levels[0]] };
    expect(parseRadarColumnProfile(shuffled)).toBeNull();
  });

  it('rejette les valeurs hors bornes physiques', () => {
    expect(
      parseRadarColumnProfile({
        ...VALID,
        levels: [{ elevationDeg: 95, altitudeM: 620, dbz: 24.5 }],
      })
    ).toBeNull();
    expect(
      parseRadarColumnProfile({
        ...VALID,
        levels: [{ elevationDeg: 0.4, altitudeM: 620, dbz: 120 }],
      })
    ).toBeNull();
    expect(parseRadarColumnProfile({ ...VALID, distanceKm: -1 })).toBeNull();
  });

  it('rejette une station hors métropole ou un horodatage invalide', () => {
    expect(
      parseRadarColumnProfile({
        ...VALID,
        station: { ...VALID.station, lat: 14.6 },
      })
    ).toBeNull();
    expect(parseRadarColumnProfile({ ...VALID, observedAt: 'hier' })).toBeNull();
  });

  it('rejette plus de 16 niveaux', () => {
    const levels = Array.from({ length: 17 }, (_, index) => ({
      elevationDeg: 0.4,
      altitudeM: 100 * (index + 1),
      dbz: null,
    }));
    expect(parseRadarColumnProfile({ ...VALID, levels })).toBeNull();
  });
});

describe('fetchRadarColumn', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetRadarColumnStateForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retourne le profil validé et le met en cache 120 s', async () => {
    const implementation = vi.fn().mockResolvedValue(jsonResponse(200, VALID));
    const first = await fetchRadarColumn(44.5, -0.9, implementation);
    const second = await fetchRadarColumn(44.5, -0.9, implementation);
    expect(first).toEqual({ kind: 'profile', profile: VALID });
    expect(second).toEqual(first);
    expect(implementation).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(121_000);
    await fetchRadarColumn(44.5, -0.9, implementation);
    expect(implementation).toHaveBeenCalledTimes(2);
  });

  it('propage hors_couverture sans le compter en échec', async () => {
    const implementation = vi.fn().mockResolvedValue(
      jsonResponse(404, { error: 'hors_couverture' })
    );
    expect(await fetchRadarColumn(45.5, -5.5, implementation)).toEqual({
      kind: 'hors-couverture',
    });
  });

  it('ouvre le breaker après 3 échecs consécutifs', async () => {
    const failing = vi.fn().mockResolvedValue(jsonResponse(502, { error: 'x' }));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(await fetchRadarColumn(44.5, -0.9, failing)).toBeNull();
      vi.advanceTimersByTime(121_000); // dépasse le cache pour re-tenter
    }
    expect(failing).toHaveBeenCalledTimes(3);
    // Breaker ouvert : plus aucun appel réseau pendant le cooldown (5 min).
    expect(await fetchRadarColumn(44.5, -0.9, failing)).toBeNull();
    expect(failing).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(5 * 60_000 + 1_000);
    await fetchRadarColumn(44.5, -0.9, failing);
    expect(failing).toHaveBeenCalledTimes(4);
  });

  it('rejette un corps malformé', async () => {
    const implementation = vi.fn().mockResolvedValue(
      jsonResponse(200, { mauvais: true })
    );
    expect(await fetchRadarColumn(44.5, -0.9, implementation)).toBeNull();
  });
});
