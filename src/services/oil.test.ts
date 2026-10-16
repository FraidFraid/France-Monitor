// src/services/oil.test.ts
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parseInseeOilOrigins, parseSdesOilStats, SDES_PETROLE_URLS } from './oil.ts';
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
