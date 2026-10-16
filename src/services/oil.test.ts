// src/services/oil.test.ts
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { buildStocksSnapshot, computeVigilanceScore, EUROSTAT_STOCKS_URL, parseEurostatCrudeImports, parseEurostatEmergencyStocks, parseInseeOilOrigins, parseSdesOilStats, SDES_PETROLE_URLS } from './oil.ts';
import { EUROSTAT_NRG_STK_OEM_FR } from './oil-eurostat.fixture.ts';
import { EUROSTAT_NRG_TI_OILM_FR } from './oil-eurostat-imports.fixture.ts';
import { INSEE_ORIGINES_2026_HTML, SDES_PETROLE_2026_HTML } from './oil.fixture.ts';

describe('pétrole : SDES, chiffres clés (édition 2026)', () => {
  it('lit l’année 2025 et les six valeurs, malgré les espaces insécables et un total sans décimale', () => {
    const s = parseSdesOilStats(SDES_PETROLE_2026_HTML);
    expect(s).toMatchObject({ year: 2025, crudeImportMtep: 46.9, reserveMtep: 5, refinedImportMtep: 34.5, refinedExportMtep: 17.5, refinedConsumptionMtep: 60 });
    expect(s.sourceLabel).toContain('2025');
  });
  it('nouvelle adresse du chapitre d’abord (l’ancienne renvoie l’accueil depuis l’édition 2026)', () => {
    expect(SDES_PETROLE_URLS[0]).toBe('https://www.statistiques.developpement-durable.gouv.fr/edition-numerique/chiffres-cles-energie/12-petrole.php');
  });
});

describe('pétrole : Insee, provenance du brut', () => {
  it('année de la colonne lue (2025 provisoire), pas la première du tableau', () => {
    const o = parseInseeOilOrigins(INSEE_ORIGINES_2026_HTML);
    expect(o.map((x) => x.label)).toEqual(['Afrique', 'Amérique du Nord', 'URSS/ex-URSS', 'Mer du Nord', 'Moyen-Orient', 'Autres']);
    expect(o[0]).toMatchObject({ volumeMt: 16.8, sharePct: 36.6, referenceYear: 2025 });
    expect(o[0].sourceLabel).toContain('2025 provisoire');
    expect(o[3].breakdown).toEqual([{ label: 'Norvège', volumeMt: 4.4, sharePct: 9.6 }]);
  });
});

describe('pétrole : stocks et vigilance', () => {
  const annual = { year: 2025, crudeImportMtep: 46.9, refinedImportMtep: 34.5, refinedExportMtep: 17.5, refinedConsumptionMtep: 60, reserveMtep: 5, sourceLabel: 'SDES' };
  it('les réserves du SDES sont en gisement, pas des stocks stratégiques : stocks inconnus, réserves exposées', () => {
    const s = buildStocksSnapshot(annual);
    expect(s.nationalStocksDays).toBeNull();
    expect(s.totalStocksTons).toBeNull();
    expect(s.byProduct).toEqual([]);
    expect(s.crudeReserveMtep).toBe(5);
    expect(s.crudeReserveDays).toBe(30);
  });
  it('sans stocks stratégiques connus, la vigilance est inconnue (aucune fausse tension vers le score et la note)', () => {
    expect(computeVigilanceScore(null, 'up')).toEqual({ score: null, status: 'unknown' });
    expect(computeVigilanceScore(95, 'stable').status).toBe('normal');
  });
});

describe('pétrole : stocks stratégiques (Eurostat, stocks d’urgence de la directive UE)', () => {
  it('dernier mois renseigné : jours au sens de la directive, minimum légal 90 jours', () => {
    expect(parseEurostatEmergencyStocks(EUROSTAT_NRG_STK_OEM_FR)).toEqual({ days: 97, month: '2026-07', minimumDays: 90, requiredKt: 15316 });
  });
  it('réponse vide ou inattendue : null (n.d.), jamais un chiffre inventé', () => {
    expect(parseEurostatEmergencyStocks({})).toBeNull();
    expect(parseEurostatEmergencyStocks(null)).toBeNull();
  });
  it('les stocks connus pilotent le chiffre et la vigilance ; les réserves en gisement restent à part', () => {
    const annual = { year: 2025, crudeImportMtep: 46.9, refinedImportMtep: 34.5, refinedExportMtep: 17.5, refinedConsumptionMtep: 60, reserveMtep: 5, sourceLabel: 'SDES' };
    const s = buildStocksSnapshot(annual, { days: 97, month: '2026-07', minimumDays: 90, requiredKt: 15316 });
    expect(s).toMatchObject({ nationalStocksDays: 97, stocksMonth: '2026-07', minimumDays: 90, crudeReserveDays: 30 });
    expect(computeVigilanceScore(s.nationalStocksDays, 'stable').status).toBe('normal');
  });
  it('adresse : jeu nrg_stk_oem, France, six derniers mois', () => {
    expect(EUROSTAT_STOCKS_URL).toBe('https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/nrg_stk_oem?geo=FR&lastTimePeriod=6&format=JSON&lang=FR');
  });
});

describe('pétrole : provenance du brut, mensuelle (Eurostat nrg_ti_oilm)', () => {
  it('douze derniers mois renseignés (août 2025 à juillet 2026) par grande région, mêmes libellés que l’Insee', () => {
    const o = parseEurostatCrudeImports(EUROSTAT_NRG_TI_OILM_FR);
    expect(o?.map((x) => x.label)).toEqual(['Afrique', 'Amérique du Nord', 'URSS/ex-URSS', 'Mer du Nord', 'Moyen-Orient', 'Autres']);
    const a = o?.[0];
    expect(a?.volumeMt).toBeCloseTo(16.1, 1);
    expect(a?.sharePct).toBeCloseTo(34.0, 1);
    expect(a?.periodLabel).toBe('12 mois jusqu’à juillet 2026');
    expect(a?.referenceYear).toBe(2026);
    expect(a?.sourceLabel).toContain('Eurostat');
    expect(a?.partialBreakdown).toBe(false);
  });
  it('détail par pays complet (noms français, du plus gros au plus petit) et dernier mois', () => {
    const mdn = parseEurostatCrudeImports(EUROSTAT_NRG_TI_OILM_FR)?.find((x) => x.label === 'Mer du Nord');
    expect(mdn?.breakdown?.[0].label).toBe('Norvège');
    expect(mdn?.breakdown?.reduce((t, b) => t + b.volumeMt, 0)).toBeCloseTo(mdn?.volumeMt ?? 0, 1);
    expect(mdn?.lastMonth).toMatchObject({ label: 'juillet 2026' });
    expect(mdn?.lastMonth?.sharePct).toBeCloseTo(11.4, 1);
  });
  it('rien de compté deux fois ni oublié : la somme des régions est le total déclaré (47,4 Mt sur 12 mois)', () => {
    const o = parseEurostatCrudeImports(EUROSTAT_NRG_TI_OILM_FR) ?? [];
    expect(o.reduce((t, x) => t + x.volumeMt, 0)).toBeCloseTo(47.4, 1);
    expect(o.reduce((t, x) => t + x.sharePct, 0)).toBeCloseTo(100, 5);
  });
  it('noms de pays en français, jamais en anglais ni en libellé d’agrégat à rallonge', () => {
    const names = (parseEurostatCrudeImports(EUROSTAT_NRG_TI_OILM_FR) ?? []).flatMap((x) => (x.breakdown ?? []).map((b) => b.label));
    expect(names).toContain('Royaume-Uni');
    expect(names).toContain('Irak');
    expect(names).not.toContain('United Kingdom');
    expect(names).not.toContain('Iraq');
    expect(names.some((l) => /agrégat variable/.test(l))).toBe(false);
  });
  it('réponse vide : null (repli sur l’Insee)', () => {
    expect(parseEurostatCrudeImports({})).toBeNull();
  });
});
