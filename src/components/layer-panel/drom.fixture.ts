// src/components/layer-panel/drom.fixture.ts : jeux d'essai des tests du panneau Énergie DROM (jamais importé par l'application).
import type { DromLiveMix, DromLiveResponse, DromLiveTerritory } from '../../types/index.ts';

export const DROM_NOW = Date.parse('2026-10-02T07:00:00Z'); // 09:00 Paris, 11:00 La Réunion, 03:00 Antilles

const mix = (over: Partial<DromLiveMix>): DromLiveMix => ({
  coal: null, oil: null, turbine: null, bio: null, geothermal: null, hydro: null, solar: null, wind: null, storage: null, links: null, other: null, ...over,
});
const ok = (code: DromLiveTerritory['code'], name: string, timeZone: string, utcOffsetLabel: string, date: string, totalMw: number,
  m: DromLiveMix, share: number, status: string | null = 'Estimé'): DromLiveTerritory => ({
  code, name, timeZone, utcOffsetLabel, state: 'ok', error: null, dataTime: Date.parse(date), status, totalMw, mix: m, renewableSharePct: share,
  day: [{ at: Date.parse(date) - 6 * 3_600_000, totalMw: totalMw - 80 }, { at: Date.parse(date), totalMw }],
});

export function dromLiveFixture(): DromLiveResponse {
  return {
    fetchedAt: DROM_NOW,
    territories: [
      ok('RE', 'La Réunion', 'Indian/Reunion', 'UTC+4', '2026-10-02T10:55:00+04:00', 339.125,
        mix({ oil: 118.11, coal: 75.992, bio: 67.71, solar: 69.63, wind: 5.2198, hydro: 2.6778, turbine: -0.23, storage: 0.0156 }), 43),
      ok('GP', 'Guadeloupe', 'America/Guadeloupe', 'UTC−4', '2026-10-02T02:56:00-04:00', 141.094,
        mix({ oil: 87.4, turbine: 0, bio: 17.85, coal: 16.27, geothermal: 10.83, solar: 0, hydro: 5.54, wind: 3.21 }), 27),
      { code: 'MQ', name: 'Martinique', timeZone: 'America/Martinique', utcOffsetLabel: 'UTC−4', state: 'error', error: 'HTTP 503',
        dataTime: null, status: null, totalMw: null, mix: mix({}), renewableSharePct: null, day: [] },
      ok('GF', 'Guyane', 'America/Cayenne', 'UTC−3', '2026-10-02T04:00:00-03:00', 83.599,
        mix({ bio: 21.03, hydro: 26.86, turbine: 21.34, oil: 14.38, solar: 0 }), 57, null),
      ok('COR', 'Corse', 'Europe/Paris', 'heure de Paris', '2026-10-02T08:45:00+02:00', 249.589,
        mix({ oil: 175.42, turbine: 10.78, hydro: 21.62, solar: 26.68, bio: 0.61, wind: 0.002, links: 9.584, storage: 4.9 }), 20),
    ],
  };
}
