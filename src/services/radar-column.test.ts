import { describe, expect, it } from 'vitest';

import { parseRadarColumnProfile } from './radar-column.ts';

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
