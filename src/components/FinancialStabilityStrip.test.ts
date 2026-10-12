// src/components/FinancialStabilityStrip.test.ts : rendu du bloc « Stabilité financière » (spec 2026-10-12 § 2 et § 5) : valeurs
// réelles à la française, unités insécables, niveaux en mots, dates de valeur, « n.d. » par source, pas de courbe pour les taux
// directeurs ni le CAC 40, aucun tiret cadratin.
import { describe, expect, it } from 'vitest';
import type { FinancialStabilityResponse, MarketData } from '../types/index.ts';
import { buildFinancialStabilityHTML } from './FinancialStabilityStrip.ts';
import { levelColorVar } from '../services/vigilance.ts';

const NB = ' ';
const hist = (...v: number[]) => v.map((value, i) => ({ date: `2026-10-0${i + 7}`, value }));
const DATA: FinancialStabilityResponse = {
  readAt: '2026-10-12T08:00:00.000Z',
  series: [
    { id: 'cissFr', value: 0.0507, date: '2026-10-09', history: hist(0.044, 0.051, 0.0507), status: 'ok', error: null },
    { id: 'cissEa', value: 0.0145, date: '2026-10-09', history: hist(0.016, 0.017, 0.0145), status: 'ok', error: null },
    { id: 'estr', value: 2.437, date: '2026-10-09', history: hist(2.439, 2.439, 2.437), status: 'ok', error: null },
    { id: 'eurusd', value: 1.1181, date: '2026-10-12', history: hist(1.1186, 1.1206, 1.1181), status: 'ok', error: null },
  ],
  rates: [
    { id: 'depot', value: 2.5, since: '2026-09-16', previous: 2.25, status: 'ok', error: null },
    { id: 'refi', value: 2.65, since: '2026-09-16', previous: null, status: 'ok', error: null },
  ],
  spread: { value: 1.43, fr10y: 4.9, de10y: 3.47, readAt: '2026-10-12T08:00:00.000Z', history: [{ date: '2026-10-12', value: 1.43 }], status: 'ok', error: null },
  errors: [],
};
const CAC: MarketData = {
  symbol: 'CAC.INDX', name: 'CAC 40', price: 7832.88, changePercent: 0.3787, trend: 'up', lastUpdated: new Date('2026-10-12T08:00:00Z'), history: [], category: 'indices',
};
const rowOf = (html: string, id: string): string => {
  // Une ligne court jusqu'au début de la suivante ou jusqu'à la fermeture du conteneur `fin-stab`.
  const m = new RegExp(`<div class="fin-stab__row" data-id="${id}"[^]*?(?=<div class="fin-stab__row"|</div>$)`).exec(html);
  if (!m) throw new Error(`ligne ${id} absente`);
  return m[0];
};

describe('rendu complet', () => {
  const { level, html, stamp } = buildFinancialStabilityHTML({ data: DATA, error: null, cac: CAC });
  it('niveau du bloc rouge (écart 1,43 pt) ; heure du relevé', () => {
    expect(level).toBe('rouge');
    expect(stamp).toMatch(/^MàJ \d{2}:\d{2}$/);
  });
  it('CISS : trois décimales, mot du niveau, date de valeur, vraie courbe', () => {
    const row = rowOf(html, 'cissFr');
    expect(row).toContain('0,051');
    expect(row).toContain('calme');
    expect(row).toContain('au 09/10');
    expect(row).toContain('<svg');
    expect(row).toContain('Seuils France Monitor');
  });
  it('écart : points insécables, mot, source de marché, en direct', () => {
    const row = rowOf(html, 'spread');
    expect(row).toContain(`1,43${NB}pt`);
    expect(row).toContain('critique');
    expect(row).toContain('en direct');
    expect(row).toContain('TradingView');
  });
  it('taux directeurs : pourcentage insécable, date et sens du changement, pas de courbe', () => {
    const depot = rowOf(html, 'depot');
    expect(depot).toContain(`2,50${NB}%`);
    expect(depot).toContain('depuis le 16/09/2026 (hausse)');
    expect(depot).not.toContain('<svg');
    const refi = rowOf(html, 'refi');
    expect(refi).toContain(`2,65${NB}%`);
    expect(refi).toContain('depuis le 16/09/2026');
    expect(refi).not.toContain('(hausse)');
  });
  it('€STR et EUR/USD : vraies courbes ; EUR/USD en dollars', () => {
    expect(rowOf(html, 'estr')).toContain(`2,437${NB}%`);
    expect(rowOf(html, 'eurusd')).toContain(`1,1181${NB}$`);
    expect(rowOf(html, 'eurusd')).toContain('<svg');
  });
  it('CAC 40 : cours et variation du jour, sans courbe', () => {
    const row = rowOf(html, 'cac');
    expect(row).toContain('7 833');
    expect(row).toContain(`+0,38${NB}%`);
    expect(row).not.toContain('<svg');
  });
  it('aucun tiret cadratin', () => {
    expect(html).not.toContain('—');
  });
});

describe('pannes', () => {
  it('BCE absente : « n.d. · BCE indisponible » ; écart absent : « n.d. · TradingView indisponible » ; CAC absent : « n.d. »', () => {
    const down: FinancialStabilityResponse = {
      ...DATA,
      series: DATA.series.map((s) => ({ ...s, value: null, date: null, history: [], status: 'unavailable' as const, error: 'x' })),
      rates: DATA.rates.map((r) => ({ ...r, value: null, since: null, previous: null, status: 'unavailable' as const, error: 'x' })),
      spread: { ...DATA.spread, value: null, readAt: null, history: [], status: 'unavailable', error: 'y' },
    };
    const { level, html } = buildFinancialStabilityHTML({ data: down, error: null, cac: null });
    expect(level).toBeNull();
    // Valeur « n.d. » et cause sous la valeur (deux éléments : la valeur reste sur une ligne).
    const nd = '<span class="fin-stab__value">n.d.</span>';
    for (const id of ['cissFr', 'cissEa', 'estr', 'eurusd', 'depot', 'refi']) {
      expect(rowOf(html, id)).toContain(nd);
      expect(rowOf(html, id)).toContain('<div class="fin-stab__meta">BCE indisponible</div>');
    }
    expect(rowOf(html, 'spread')).toContain(nd);
    expect(rowOf(html, 'spread')).toContain('<div class="fin-stab__meta">TradingView indisponible</div>');
    expect(rowOf(html, 'cac')).toContain(nd);
  });
  it('écart absent mais courbe enregistrée : la courbe reste', () => {
    const data = { ...DATA, spread: { ...DATA.spread, value: null, status: 'unavailable' as const, history: [{ date: '2026-10-10', value: 1.3 }, { date: '2026-10-11', value: 1.4 }] } };
    expect(rowOf(buildFinancialStabilityHTML({ data, error: null, cac: CAC }).html, 'spread')).toContain('<svg');
  });
  it('série en retard : date gardée, « en retard »', () => {
    const data = { ...DATA, series: [{ ...DATA.series[0]!, status: 'stale' as const, date: '2026-10-06' }, ...DATA.series.slice(1)] };
    expect(rowOf(buildFinancialStabilityHTML({ data, error: null, cac: CAC }).html, 'cissFr')).toContain('au 06/10 · en retard');
  });
  it('rien lu (502) : lignes en « n.d. », CAC 40 gardé, cause nommée (I3)', () => {
    const { html, level, stamp } = buildFinancialStabilityHTML({ data: null, error: 'HTTP 502', cac: CAC });
    expect(level).toBeNull();
    expect(stamp).toBe('Source indisponible');
    for (const id of ['cissFr', 'cissEa', 'spread', 'depot', 'refi', 'estr', 'eurusd']) {
      expect(rowOf(html, id)).toContain('<span class="fin-stab__value">n.d.</span>');
    }
    expect(rowOf(html, 'cac')).toContain('7\u202f833');
    expect(html).toContain('HTTP 502');
  });
  it('week-end : écart marqué « clôture du vendredi », jamais « en direct » (I4)', () => {
    const data = { ...DATA, spread: { ...DATA.spread, readAt: '2026-10-10T09:00:00.000Z' } };
    const row = rowOf(buildFinancialStabilityHTML({ data, error: null, cac: CAC }).html, 'spread');
    expect(row).toContain('clôture du vendredi');
    expect(row).not.toContain('en direct');
  });
});

describe('courbes (refonte du 12/10)', () => {
  const { html } = buildFinancialStabilityHTML({ data: DATA, error: null, cac: CAC });
  const stroke = (row: string): string => /class="spark-line"[^>]*stroke="([^"]+)"/.exec(row)?.[1] ?? '';
  it('CISS et écart : couleur de leur niveau ; €STR et EUR/USD : neutre', () => {
    expect(stroke(rowOf(html, 'cissFr'))).toBe(levelColorVar('vert'));
    expect(stroke(rowOf(buildFinancialStabilityHTML({ data: { ...DATA, spread: { ...DATA.spread, history: hist(1.4, 1.43) } }, error: null, cac: CAC }).html, 'spread'))).toBe(levelColorVar('rouge'));
    expect(stroke(rowOf(html, 'estr'))).toBe('var(--spark-neutral)');
  });
  it('infobulle de la courbe : période et bornes au format de la ligne', () => {
    expect(rowOf(html, 'cissFr')).toContain('<title>90 jours · plus bas 0,044 · plus haut 0,051</title>');
    expect(rowOf(html, 'eurusd')).toContain(`plus haut 1,1206${NB}$`);
  });
});
