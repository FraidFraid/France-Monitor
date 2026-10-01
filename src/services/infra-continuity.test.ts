import { describe, it, expect } from 'vitest';
import { INFRA_NOTE, infraRows, infraValueLevel, nuclearInfraScore, windInfraScore, type InfraInput } from './infra-continuity.ts';
import type { NetworkBarometerResult } from './network-barometer.ts';
import type { NuclearState, NuclearRemitSignal, UnconfirmedRemitSignal } from '../types/index.ts';
import type { EolienLive } from './eolien/types.ts';

function nuclear(over: Partial<NuclearState> = {}, stress: Partial<NonNullable<NuclearState['stress']>> = {}): NuclearState {
  return {
    unavailabilities: [], remitSignals: [], unconfirmedSignals: [], rteAvailable: true, remitAvailable: true,
    remitStatus: 'ok', fetchedAt: new Date(0),
    stress: {
      installedCapacityMW: 61_370, availableCapacityMW: 51_550, stressRatio: 0.16, level: 'TENSION',
      gridTensionRisk: false, updatedAt: new Date(0), freshness: 'quasi-realtime', ...stress,
    },
    ...over,
  };
}

function eolien(alertLevel: EolienLive['alertLevel']): EolienLive {
  return { production: 2600, production_gw: 2.6, puissance_installee: 23_000, facteur_charge: 13, parcs_actifs: 2000, timestamp: new Date(0), alertLevel };
}

function result(details: Record<string, number | null>): NetworkBarometerResult {
  return { score: 96, status: 'nominal', details, computedAt: new Date(0), reliable: true };
}

function remitSignal(): NuclearRemitSignal {
  return {
    id: 'remit-1',
    plantName: 'Cattenom',
    unitName: 'Unit 1',
    classifiedAs: 'UNPLANNED_OUTAGE',
    capacityMW: 1300,
    publishedAt: new Date(0),
    title: 'Unplanned outage',
    link: 'https://example.com',
    confirmedByRTE: false,
    matchConfidence: 0.9,
  };
}

function unconfirmedSignal(): UnconfirmedRemitSignal {
  return {
    remitSignal: remitSignal(),
    reason: 'Not yet reflected in RTE data',
    confidence: 0.85,
  };
}

describe("baromètre des infrastructures (spec 2026-10-01 § 3.2)", () => {
  it("score nucléaire = disponible / installé, note REMIT ou tension", () => {
    expect(nuclearInfraScore(nuclear())).toEqual({ score: 84, note: null });
    expect(nuclearInfraScore(nuclear({}, { gridTensionRisk: true }))).toEqual({ score: 84, note: 'sous tension' });
    expect(nuclearInfraScore(nuclear({ rteAvailable: false }))).toEqual({ score: null, note: 'Indisponible' });
    expect(nuclearInfraScore(nuclear({ stress: null }))).toBeNull();
    expect(nuclearInfraScore(null)).toBeNull();
  });

  it("préséance de l'écart REMIT sur la tension réseau", () => {
    // Both gridTensionRisk and unconfirmedSignals set: REMIT takes precedence
    expect(
      nuclearInfraScore(
        nuclear(
          { unconfirmedSignals: [unconfirmedSignal()] },
          { gridTensionRisk: true }
        )
      )
    ).toEqual({ score: 84, note: 'écart REMIT' });
  });

  it("score éolien : alerte en direct, sinon valeur du baromètre", () => {
    expect(windInfraScore(eolien('normal'), 12)).toBe(100);
    expect(windInfraScore(eolien('watch'), 12)).toBe(70);
    expect(windInfraScore(eolien('low-production'), 12)).toBe(40);
    expect(windInfraScore(null, 12)).toBe(12);
    expect(windInfraScore(null, null)).toBeNull();
  });

  it("niveau d'une ligne : ≥ 85 vert, ≥ 60 jaune, sinon rouge", () => {
    expect(infraValueLevel(85)).toBe('vert');
    expect(infraValueLevel(84)).toBe('jaune');
    expect(infraValueLevel(60)).toBe('jaune');
    expect(infraValueLevel(59)).toBe('rouge');
    expect(infraValueLevel(null)).toBeNull();
  });

  it("8 lignes dans l'ordre du baromètre, résilience cyber en dernier", () => {
    const input: InfraInput = {
      result: result({ bgp: 100, elec: 100, telecom: 93, cloud: 99, space: 100, cyber: 43, wind: 55 }),
      nuclear: nuclear(), eolien: null,
    };
    const rows = infraRows(input, 'fr');
    expect(rows.map((r) => r.key)).toEqual(['bgp', 'elec', 'nuclear', 'wind', 'telecom', 'cloud', 'space', 'cyber']);
    expect(rows.map((r) => r.value)).toEqual([100, 100, 84, 55, 93, 99, 100, 43]);
    expect(rows[0]?.label).toBe('BGP / Internet');
    expect(rows[7]?.label).toBe('Résilience cyber infra');
  });

  it("sans résultat : aucune ligne ; source absente : valeur null", () => {
    expect(infraRows({ result: null, nuclear: null, eolien: null }, 'fr')).toEqual([]);
    const rows = infraRows({ result: result({}), nuclear: null, eolien: null }, 'fr');
    expect(rows.every((r) => r.value === null)).toBe(true);
  });

  it("libellés anglais et note d'explication", () => {
    expect(infraRows({ result: result({ bgp: 100 }), nuclear: null, eolien: null }, 'en')[1]?.label).toBe('Electricity (Ecowatt)');
    expect(INFRA_NOTE.fr).toBe('Score de continuité borné. La ligne cyber mesure la résilience infra, pas la pression cyber nationale.');
  });
});
