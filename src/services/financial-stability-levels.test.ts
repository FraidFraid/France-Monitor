// src/services/financial-stability-levels.test.ts : seuils France Monitor du bloc « Stabilité financière » (spec 2026-10-12 § 2),
// bornes exactes (borne basse = palier du dessus), texte des seuils, niveau du bloc.
import { describe, expect, it } from 'vitest';
import type { EcbSeries, FinancialStabilityResponse, OatBundSpread } from '../types/index.ts';
import { CISS_BANDS, SPREAD_BANDS, bandOf, blockLevel, frMonth, levelDriverText, officialSpreadText, spreadCapped, thresholdsText } from './financial-stability-levels.ts';

const ciss = (id: 'cissFr' | 'cissEa', value: number | null, status: EcbSeries['status'] = 'ok'): EcbSeries =>
  ({ id, value, date: value === null ? null : '2026-10-09', history: [], status, error: null });
const spread = (value: number | null, status: OatBundSpread['status'] = 'ok'): OatBundSpread =>
  ({ value, fr10y: null, de10y: null, readAt: null, history: [], status, error: null });
const data = (fr: number | null, ea: number | null, sp: number | null): FinancialStabilityResponse => ({
  readAt: '2026-10-12T08:00:00.000Z',
  series: [ciss('cissFr', fr, fr === null ? 'unavailable' : 'ok'), ciss('cissEa', ea, ea === null ? 'unavailable' : 'ok')],
  rates: [],
  spread: spread(sp, sp === null ? 'unavailable' : 'ok'),
  errors: [],
});

describe('paliers', () => {
  it('CISS : bornes exactes', () => {
    expect([0, 0.1499, 0.15, 0.2999, 0.3, 0.4999, 0.5, 0.9].map((v) => bandOf(v, CISS_BANDS).level))
      .toEqual(['vert', 'vert', 'jaune', 'jaune', 'orange', 'orange', 'rouge', 'rouge']);
    expect(bandOf(0.05, CISS_BANDS).word).toBe('calme');
    expect(bandOf(0.5, CISS_BANDS).word).toBe('crise systémique');
  });
  it('écart OAT-Bund : bornes exactes ; 1,43 pt du 12/10 en rouge « critique »', () => {
    expect([-0.2, 0.59, 0.6, 0.89, 0.9, 1.29, 1.3].map((v) => bandOf(v, SPREAD_BANDS).level))
      .toEqual(['vert', 'vert', 'jaune', 'jaune', 'orange', 'orange', 'rouge']);
    expect(bandOf(1.43, SPREAD_BANDS)).toMatchObject({ level: 'rouge', word: 'critique' });
  });
  it('texte des seuils, nombres à la française, unité insécable', () => {
    expect(thresholdsText(CISS_BANDS, 2, '')).toBe('Seuils France Monitor : tension dès 0,15 ; stress élevé dès 0,30 ; crise systémique dès 0,50.');
    expect(thresholdsText(SPREAD_BANDS, 1, ' pt')).toBe('Seuils France Monitor : tension dès 0,6 pt ; élevé dès 0,9 pt ; critique dès 1,3 pt.');
  });
});

describe('niveau du bloc', () => {
  it('le plus haut des trois indicateurs', () => {
    expect(blockLevel(data(0.05, 0.015, 1.43))).toBe('rouge');
    expect(blockLevel(data(0.2, 0.015, 0.4))).toBe('jaune');
  });
  it('indicateur absent ignoré ; aucun : null ; pas de données : null', () => {
    expect(blockLevel(data(null, 0.35, null))).toBe('orange');
    expect(blockLevel(data(null, null, null))).toBeNull();
    expect(blockLevel(null)).toBeNull();
  });
});

describe('ce qui fait le niveau (03/11/2026 : « ROUGE » à côté d’un CISS « calme »)', () => {
  it('rouge de marché contredit par le repère officiel BCE : retenu à orange, dit et expliqué (règle de corroboration)', () => {
    const d = { ...data(0.08, 0.01, 1.6), officialSpread: { month: '2026-09', fr10y: 4.44, de10y: 3.473, value: 0.97 } };
    expect(blockLevel(d)).toBe('orange');
    expect(spreadCapped(d)).toBe(true);
    const r = levelDriverText(d);
    expect(r?.short).toBe('écart OAT-Bund');
    expect(r?.text).toContain('Niveau tiré par l’écart OAT-Bund : 1,60\u00a0pt, critique sur le marché (TradingView, source non officielle), retenu à orange car le repère officiel de la BCE ne le confirme pas.');
    expect(r?.text).toContain('Le stress mesuré par la BCE reste calme (CISS France 0,080 ; zone euro 0,010).');
    expect(r?.text).toContain('Repère officiel BCE (moyenne de septembre 2026) : 0,97\u00a0pt, élevé.');
  });
  it('repère officiel lui aussi rouge : le rouge est confirmé ; sans repère : niveau de marché inchangé (calibration du score)', () => {
    expect(blockLevel({ ...data(0.08, 0.01, 1.6), officialSpread: { month: '2026-09', fr10y: 5, de10y: 3.4, value: 1.6 } })).toBe('rouge');
    expect(blockLevel(data(0.08, 0.01, 1.6))).toBe('rouge');
    expect(spreadCapped(data(0.08, 0.01, 1.6))).toBe(false);
    expect(levelDriverText(data(0.08, 0.01, 1.6))?.text).toContain('Niveau tiré par l’écart OAT-Bund (1,60\u00a0pt, critique) : un prix de marché');
  });
  it('CISS au même niveau ou plus haut que l’écart : rien à expliquer', () => {
    expect(levelDriverText(data(0.6, 0.1, 1.6))).toBeNull();
    expect(levelDriverText(data(0.08, 0.01, 0.4))).toBeNull();
    expect(levelDriverText(null)).toBeNull();
  });
  it('sans repère officiel : la phrase s’en passe', () => {
    expect(levelDriverText(data(0.08, null, 1.0))?.text).not.toContain('Repère officiel');
    expect(officialSpreadText(null)).toBeNull();
    expect(frMonth('2026-11')).toBe('novembre 2026');
  });
});
