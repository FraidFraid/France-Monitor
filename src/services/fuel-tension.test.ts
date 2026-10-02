import { describe, it, expect } from 'vitest';
import { buildFuelTensionDashboardFromStations } from './fuel-tension.ts';
import type { FuelStation, FuelStationFuelStatus, FuelType } from '../types/index.ts';

const NOW = Date.parse('2026-10-02T11:30:00Z');
const LABELS: Record<FuelType, string> = { gazole: 'Gazole', sp95: 'SP95', sp98: 'SP98', e10: 'E10' };

type Spec = { ageH?: number; rupture?: 'temporaire' | 'definitive' };

/** Statut tel que normalisé depuis le flux v2 : une rupture définitive n'a ni prix ni date. */
function status(fuelType: FuelType, spec: Spec): FuelStationFuelStatus {
  const priced = spec.rupture === undefined;
  const updatedAt = priced ? new Date(NOW - (spec.ageH ?? 1) * 3_600_000).toISOString() : null;
  return {
    fuelType, label: LABELS[fuelType], price: priced ? 1.8 : null, updatedAt,
    updateAgeMinutes: priced ? Math.round((spec.ageH ?? 1) * 60) : null,
    ruptureType: spec.rupture ?? null, available: priced,
  };
}

let seq = 0;
function station(dep: string, fuels: Partial<Record<FuelType, Spec>>): FuelStation {
  seq += 1;
  return {
    id: `${dep}${String(seq).padStart(5, '0')}`, departmentCode: dep, departmentName: `Dép ${dep}`, city: 'Ville', location: null,
    fetchedAt: new Date(NOW).toISOString(),
    fuels: Object.fromEntries(Object.entries(fuels).map(([k, v]) => [k, status(k as FuelType, v)])),
  };
}

describe('tension carburants : ruptures, pas prix stables', () => {
  it('prix inchangés depuis des jours sans rupture : aucune anomalie, niveau LOW', () => {
    const stations = Array.from({ length: 100 }, (_, i) => station(i % 2 ? '13' : '59', {
      gazole: { ageH: 30 }, sp95: { ageH: 110 }, sp98: { ageH: 130 }, e10: { ageH: 100 },
    }));
    const d = buildFuelTensionDashboardFromStations(stations, NOW);
    expect(d.national.anomalyShare).toBe(0);
    expect(d.national.tensionLevel).toBe('LOW');
  });

  it('rupture définitive = carburant non vendu : ni anomalie ni station comptée pour ce carburant', () => {
    const stations = Array.from({ length: 50 }, () => station('13', {
      gazole: { ageH: 2 }, e10: { ageH: 2 }, sp95: { rupture: 'definitive' }, sp98: { rupture: 'definitive' },
    }));
    const d = buildFuelTensionDashboardFromStations(stations, NOW);
    expect(d.national.anomalyShare).toBe(0);
    expect(d.national.tensionLevel).toBe('LOW');
    expect(d.signals.find((s) => s.fuelType === 'sp95')?.stationCount).toBe(0);
  });

  it('rupture temporaire : comptée une fois par station, part nationale au niveau station', () => {
    const ok = Array.from({ length: 90 }, () => station('13', { gazole: { ageH: 2 }, e10: { ageH: 2 } }));
    const rupt = Array.from({ length: 10 }, () => station('13', { gazole: { rupture: 'temporaire' }, e10: { rupture: 'temporaire' } }));
    const d = buildFuelTensionDashboardFromStations([...ok, ...rupt], NOW);
    expect(d.national.anomalyShare).toBe(10);
    expect(d.national.tensionLevel).toBe('MEDIUM');
    expect(d.signals.find((s) => s.fuelType === 'gazole')?.anomalyShare).toBe(10);
  });

  it('station sans aucun carburant surveillé vendu : hors du dénominateur', () => {
    const only = station('13', { gazole: { rupture: 'definitive' }, sp95: { rupture: 'definitive' } });
    const fine = station('13', { gazole: { ageH: 1 } });
    expect(buildFuelTensionDashboardFromStations([only, fine], NOW).national.stationCount).toBe(1);
  });

  it('latestUpdateAt = dernier relevé de prix du flux', () => {
    const d = buildFuelTensionDashboardFromStations([
      station('13', { gazole: { ageH: 50 } }), station('59', { gazole: { ageH: 0.5 }, e10: { ageH: 3 } }),
    ], NOW);
    expect(d.national.latestUpdateAt).toBe(new Date(NOW - 0.5 * 3_600_000).toISOString());
  });
});
