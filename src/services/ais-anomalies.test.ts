// Anomalies AIS (revue finale I1) : un bâtiment de la Marine nationale, reconnu par un registre public, par son propre message
// (NAVY_MMSI_SET) ou par la règle FX2 (type 35 ou nom « FRENCH WARSHIP » sous pavillon français), ne déclenche jamais « Silence
// radio » ni « Rendezvous suspect » ; un navire civil à risque élevé reste suivi.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearAisAnomalyState, detectAisAnomalies } from './ais-anomalies.ts';
import { registerAisNavyIdentity, resetAisNavyIdentities, type MilitaryShip } from './military-ships.ts';

const T0 = Date.parse('2026-10-05T10:00:00Z');
const MIN = 60_000;

/** Navire au large du golfe de Gascogne (loin de tout port français), en route. */
function ship(mmsi: string, over: Partial<MilitaryShip> = {}): MilitaryShip {
  return { id: mmsi, name: `NAVIRE ${mmsi}`, type: 'n.d.', role: 'n.d.', mmsi, lat: 46.5, lon: -6.5, speed: 8, lastSeen: T0, ...over };
}

describe('anomalies AIS : Marine nationale jamais retenue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    clearAisAnomalyState();
    resetAisNavyIdentities();
  });
  afterEach(() => {
    vi.useRealTimers();
    clearAisAnomalyState();
    resetAisNavyIdentities();
  });

  it('bâtiment identifié par son propre message, muet 15 min : aucune anomalie', () => {
    expect(registerAisNavyIdentity('227123456', 35, 'FS PROVENCE', T0)).toBe(true);
    expect(detectAisAnomalies([ship('227123456', { name: 'FS PROVENCE' })])).toEqual([]);
    vi.setSystemTime(T0 + 15 * MIN);
    expect(detectAisAnomalies([])).toEqual([]);
  });

  it('nom « FRENCH WARSHIP » ou type 35 sous pavillon français, même à risque élevé et muet 30 min : aucune anomalie', () => {
    const named = ship('227000001', { name: 'FRENCH WARSHIP 12', riskLevel: 'high' });
    const typed = ship('540000018', { name: 'BATIMENT', shipType: 35, riskLevel: 'critical' });
    expect(detectAisAnomalies([named, typed])).toEqual([]);
    vi.setSystemTime(T0 + 30 * MIN);
    expect(detectAisAnomalies([])).toEqual([]);
  });

  it('navire à risque élevé à moins de 2 km d\'un bâtiment de la Marine : aucun rendez-vous', () => {
    registerAisNavyIdentity('227123456', 35, 'FS PROVENCE', T0);
    const tanker = ship('412000001', { name: 'PETROLIER', riskLevel: 'high' });
    const provence = ship('227123456', { name: 'FS PROVENCE', lat: 46.505 });
    const warship = ship('227000001', { name: 'FRENCH WARSHIP 12', lat: 46.495 });
    expect(detectAisAnomalies([tanker, provence, warship])).toEqual([]);
  });

  it('témoins : un civil à risque élevé muet 25 min et un rendez-vous entre civils restent signalés, en gravité moyenne', () => {
    const tanker = ship('412000001', { name: 'PETROLIER', riskLevel: 'high' });
    const cargo = ship('636000001', { name: 'CARGO', lat: 46.505 });
    const rendezvous = detectAisAnomalies([tanker, cargo]);
    expect(rendezvous.map((a) => [a.type, a.severity])).toEqual([['rendezvous', 'medium']]);
    vi.setSystemTime(T0 + 25 * MIN);
    const silence = detectAisAnomalies([cargo]);
    expect(silence.map((a) => [a.type, a.severity, a.mmsis])).toEqual([['radio_silence', 'medium', ['412000001']]]);
  });

  it('bâtiment militaire étranger (type 35, pavillon non français) à risque élevé : toujours suivi', () => {
    const foreign = ship('244000001', { name: 'FOREIGN NAVY', shipType: 35, riskLevel: 'high' });
    expect(detectAisAnomalies([foreign])).toEqual([]);
    vi.setSystemTime(T0 + 25 * MIN);
    expect(detectAisAnomalies([]).map((a) => a.type)).toEqual(['radio_silence']);
  });
});
