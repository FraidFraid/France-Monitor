import { describe, expect, it } from 'vitest';
import { parseGridSnapshot, type Eco2mixNatRecord, type Eco2mixDayRecord } from './ecowatt.ts';

const NAT: Eco2mixNatRecord = {
  date_heure: '2026-10-02T04:45:00+00:00', consommation: 40563, prevision_j: 41200, prevision_j1: 41150, taux_co2: 50,
  nucleaire: 30871, eolien: 1750, solaire: 0, hydraulique: 6638, gaz: 3931, fioul: 37, charbon: 0, bioenergies: 992,
  pompage: 0, ech_physiques: -3664,
  ech_comm_angleterre: 2728, ech_comm_espagne: 1996, ech_comm_italie: -2800, ech_comm_suisse: -1900, ech_comm_allemagne_belgique: 2800,
};
const day = (iso: string, c: number | null, f: number | null): Eco2mixDayRecord => ({ date_heure: iso, consommation: c, prevision_j: f });

describe('parseGridSnapshot', () => {
  const NOW = Date.parse('2026-10-02T05:00:00Z');
  it('lit l’enregistrement national : consommation, prévision, CO2, solde, filières (thermique = gaz + fioul + charbon)', () => {
    const g = parseGridSnapshot(NAT, [], NOW);
    expect(g).toMatchObject({ dataTime: Date.parse(NAT.date_heure), consumptionMw: 40563, forecastMw: 41200, co2gPerKwh: 50, netImportMw: -3664 });
    expect(g?.mix).toEqual({ nuclear: 30871, hydro: 6638, wind: 1750, solar: 0, thermal: 3968, bio: 992 });
  });
  it('garde null ce qui manque, jamais 0', () => {
    const g = parseGridSnapshot({ ...NAT, taux_co2: null, gaz: null, fioul: null, charbon: null, prevision_j: null }, [], NOW);
    expect(g?.co2gPerKwh).toBeNull();
    expect(g?.forecastMw).toBeNull();
    expect(g?.mix.thermal).toBeNull();
  });
  it('null sans enregistrement ou sans date valide', () => {
    expect(parseGridSnapshot(undefined, [], NOW)).toBeNull();
    expect(parseGridSnapshot({ ...NAT, date_heure: 'n.d.' }, [], NOW)).toBeNull();
  });
  it('série : journée de Paris seulement, ordre croissant', () => {
    const series = [
      day('2026-10-02T21:45:00+00:00', null, 41950), // 23:45 Paris le 02/10
      day('2026-10-01T22:00:00+00:00', 41659, 41100), // 00:00 Paris le 02/10
      day('2026-10-01T21:45:00+00:00', 42000, 42100), // 23:45 Paris le 01/10 : exclu
    ];
    const g = parseGridSnapshot(NAT, series, NOW);
    expect(g?.day.map((p) => p.at)).toEqual([Date.parse('2026-10-01T22:00:00+00:00'), Date.parse('2026-10-02T21:45:00+00:00')]);
    expect(g?.day[1]).toEqual({ at: Date.parse('2026-10-02T21:45:00+00:00'), consumptionMw: null, forecastMw: 41950, windMw: null });
  });
  it('après minuit à Paris (22:30 UTC), la série est celle du nouveau jour', () => {
    const late = Date.parse('2026-10-02T22:30:00Z'); // 00:30 Paris le 03/10
    const g = parseGridSnapshot(NAT, [day('2026-10-02T21:45:00+00:00', null, 41950), day('2026-10-02T22:15:00+00:00', 40000, 40100)], late);
    expect(g?.day).toHaveLength(1);
  });
  it("détail hydraulique (fil de l'eau, lacs, turbinage et pompage STEP) et éolien terre et mer", () => {
    const NOW = Date.parse('2026-10-02T05:00:00Z');
    const g = parseGridSnapshot({
      ...NAT, hydraulique_fil_eau_eclusee: 2186, hydraulique_lacs: 2653, hydraulique_step_turbinage: 1594, pompage: -820,
      eolien_terrestre: 2006, eolien_offshore: 75,
    }, [], NOW);
    expect(g?.hydroDetail).toEqual({ runOfRiver: 2186, lakes: 2653, stepTurbine: 1594, pumping: -820 });
    expect(g?.windDetail).toEqual({ onshore: 2006, offshore: 75 });
  });
  it('détail absent : null, jamais 0', () => {
    const NOW = Date.parse('2026-10-02T05:00:00Z');
    const g = parseGridSnapshot({ ...NAT, pompage: null }, [], NOW);
    expect(g?.hydroDetail).toEqual({ runOfRiver: null, lakes: null, stepTurbine: null, pumping: null });
    expect(g?.windDetail).toEqual({ onshore: null, offshore: null });
  });
  it("série du jour : éolien réalisé par quart d'heure, null pour l'avenir", () => {
    const NOW = Date.parse('2026-10-02T05:00:00Z');
    const g = parseGridSnapshot(NAT, [
      { date_heure: '2026-10-02T04:45:00+00:00', consommation: 40563, prevision_j: 41200, eolien: 1750 },
      { date_heure: '2026-10-02T17:30:00+00:00', consommation: null, prevision_j: 52300, eolien: null },
      { date_heure: '2026-10-02T17:45:00+00:00', consommation: null, prevision_j: 52100 },
    ], NOW);
    expect(g?.day.map((p) => p.windMw)).toEqual([1750, null, null]);
  });
});
