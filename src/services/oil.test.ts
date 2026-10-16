// src/services/oil.test.ts
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { buildStocksSnapshot, computeVigilanceScore, EUROSTAT_STOCKS_URL, parseEurostatEmergencyStocks, parseInseeOilOrigins, parseSdesOilStats, SDES_PETROLE_URLS } from './oil.ts';
import { EUROSTAT_NRG_STK_OEM_FR } from './oil-eurostat.fixture.ts';
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
