import { describe, it, expect } from 'vitest';
import { buildFuelTensionDashboardFromStations, FUEL_TENSION_THRESHOLDS } from './fuel-tension.ts';
import type { FuelStation, FuelStationFuelStatus, FuelType } from '../types/index.ts';

const NOW = Date.parse('2026-10-02T11:30:00Z');
const LABELS: Record<FuelType, string> = { gazole: 'Gazole', sp95: 'SP95', sp98: 'SP98', e10: 'E10' };

type Spec = { ageH?: number; rupture?: 'temporaire' | 'definitive'; sinceD?: number };

/** Statut tel que normalisé depuis le flux v2 : une rupture définitive n'a ni prix ni date. */
function status(fuelType: FuelType, spec: Spec): FuelStationFuelStatus {
  const priced = spec.rupture === undefined;
  const updatedAt = priced ? new Date(NOW - (spec.ageH ?? 1) * 3_600_000).toISOString() : null;
  return {
    fuelType, label: LABELS[fuelType], price: priced ? 1.8 : null, updatedAt,
    updateAgeMinutes: priced ? Math.round((spec.ageH ?? 1) * 60) : null,
    ruptureType: spec.rupture ?? null, available: priced,
    ruptureSince: spec.rupture ? new Date(NOW - (spec.sinceD ?? 1) * 86_400_000).toISOString() : null,
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
    expect(d.national.tensionLevel).toBe('LOW');
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

  it('département dont tous les prix ont plus de 5 jours, sans rupture : reste LOW', () => {
    const stations = Array.from({ length: 20 }, () => station('13', { gazole: { ageH: 200 }, e10: { ageH: 250 } }));
    const d = buildFuelTensionDashboardFromStations(stations, NOW);
    expect(d.summaries[0].tensionLevel).toBe('LOW');
    expect(d.national.tensionLevel).toBe('LOW');
  });

  it('rupture définitive sur un carburant et temporaire sur un autre : une seule anomalie, station dans le dénominateur', () => {
    const mixed = station('13', { gazole: { rupture: 'temporaire' }, sp95: { rupture: 'definitive' }, e10: { ageH: 1 } });
    const fine = station('13', { gazole: { ageH: 1 } });
    const d = buildFuelTensionDashboardFromStations([mixed, fine], NOW);
    expect(d.national.stationCount).toBe(2);
    expect(d.national.anomalyShare).toBe(50);
    expect(d.summaries[0].stationCount).toBe(2);
    expect(d.summaries[0].anomalyShare).toBe(50);
    expect(d.signals.find((s) => s.fuelType === 'sp95')?.stationCount).toBe(0);
  });

  it('latestUpdateAt n’excède jamais l’heure de lecture', () => {
    const future = station('13', { gazole: { ageH: -5 } });
    expect(buildFuelTensionDashboardFromStations([future], NOW).national.latestUpdateAt).toBe(new Date(NOW).toISOString());
  });

  it('rupture « temporaire » de 30 jours ou plus = carburant non vendu (364 stations en rupture depuis plus d\'un an le 08/10/2026)', () => {
    const stale = station('13', { gazole: { rupture: 'temporaire', sinceD: 400 }, e10: { ageH: 1 } });
    const staleOnly = station('13', { gazole: { rupture: 'temporaire', sinceD: 30 } });
    const fine = station('13', { gazole: { ageH: 1 } });
    const d = buildFuelTensionDashboardFromStations([stale, staleOnly, fine], NOW);
    expect(d.national.stationCount).toBe(2);
    expect(d.national.anomalyShare).toBe(0);
    expect(d.signals.find((s) => s.fuelType === 'gazole')?.stationCount).toBe(1);
  });

  it('une station à sec depuis moins de 30 jours reste une anomalie : la pénurie reste visible', () => {
    const dry = Array.from({ length: 30 }, () => station('13', { gazole: { rupture: 'temporaire', sinceD: 29 }, e10: { rupture: 'temporaire', sinceD: 0.2 } }));
    const ok = Array.from({ length: 70 }, () => station('13', { gazole: { ageH: 1 } }));
    const d = buildFuelTensionDashboardFromStations([...dry, ...ok], NOW);
    expect(d.national.stationCount).toBe(100);
    expect(d.national.anomalyShare).toBe(30);
    expect(d.national.tensionLevel).toBe('HIGH');
  });

  it('seuils de part d\'anomalies : jaune dès 15 %, orange dès 25 %, rouge dès 40 % (décision du 08/10/2026)', () => {
    expect(FUEL_TENSION_THRESHOLDS).toMatchObject({ mediumAnomalyShare: 15, highAnomalyShare: 25, criticalAnomalyShare: 40 });
    const level = (pct: number) => {
      const bad = Array.from({ length: pct }, () => station('13', { gazole: { rupture: 'temporaire' } }));
      const ok = Array.from({ length: 100 - pct }, () => station('13', { gazole: { ageH: 1 } }));
      return buildFuelTensionDashboardFromStations([...bad, ...ok], NOW).national.tensionLevel;
    };
    expect([level(14), level(15), level(24), level(25), level(39), level(40)])
      .toEqual(['LOW', 'MEDIUM', 'MEDIUM', 'HIGH', 'HIGH', 'CRITICAL']);
  });
});
