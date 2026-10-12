// src/components/FinancialStabilityStrip.test.ts : rendu du bloc « Stabilité financière » en tableau (spec 2026-10-12 § 2 et § 5 ;
// refonte « terminal » du 12/10) : valeurs réelles à la française, unités insécables, niveaux en mots, dates de valeur, lignes en
// alerte, « n.d. » par source, pas de courbe pour les taux directeurs ni le CAC 40, aucun tiret cadratin.
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
/** Une ligne court jusqu'au début de la suivante ou jusqu'à la fin du tableau. */
const rowOf = (html: string, id: string): string => {
  const m = new RegExp(`<div class="fin-row[^"]*" data-id="${id}"[^]*?(?=<div class="fin-row|</div>$)`).exec(html);
  if (!m) throw new Error(`ligne ${id} absente`);
  return m[0];
};
const value = (row: string): string => /<span class="fin-row__value">([^<]*)<\/span>/.exec(row)?.[1] ?? '';
const meta = (row: string): string => /<span class="fin-row__meta">([^<]*)<\/span>/.exec(row)?.[1] ?? '';
const note = (row: string): string => /<span class="fin-row__note[^"]*"[^>]*>([^<]*)<\/span>/.exec(row)?.[1] ?? '';

describe('rendu complet', () => {
  const { level, html, stamp } = buildFinancialStabilityHTML({ data: DATA, error: null, cac: CAC });
  it('niveau du bloc rouge (écart 1,43 pt) ; heure du relevé ; sept lignes dans l’ordre', () => {
    expect(level).toBe('rouge');
    expect(stamp).toMatch(/^MàJ \d{2}:\d{2}$/);
    expect([...html.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1])).toEqual(['cissFr', 'cissEa', 'spread', 'rates', 'estr', 'eurusd', 'cac']);
  });
  it('CISS : trois décimales, mot du niveau, date de valeur, vraie courbe, seuils en infobulle ; pas en alerte en vert', () => {
    const row = rowOf(html, 'cissFr');
    expect(value(row)).toBe('0,051');
    expect(note(row)).toBe('calme');
    expect(meta(row)).toBe('au 09/10');
    expect(row).toContain('<svg');
    expect(row).toContain('Seuils France Monitor');
    expect(row).not.toContain('is-alert');
  });
  it('écart : ligne en alerte rouge, points insécables, mot, en direct', () => {
    const row = rowOf(html, 'spread');
    expect(row).toContain('fin-row is-alert');
    expect(row).toContain(`--fin-lvl:${levelColorVar('rouge')}`);
    expect(value(row)).toBe(`1,43${NB}pt`);
    expect(note(row)).toBe('critique');
    expect(meta(row)).toBe('en direct · TradingView');
  });
  it('taux directeurs sur une ligne : dépôt et refi, sens et date du dernier changement, pas de courbe', () => {
    const row = rowOf(html, 'rates');
    expect(value(row)).toBe(`2,50 · 2,65${NB}%`);
    expect(note(row)).toBe(`↑${NB}16/09`);
    expect(meta(row)).toBe('');
    expect(row).toContain('title="Taux de dépôt et de refinancement de la BCE : hausse le 16/09/2026."');
    expect(row).not.toContain('<svg');
  });
  it('€STR et EUR/USD : vraies courbes ; EUR/USD en dollars, taux de référence', () => {
    expect(value(rowOf(html, 'estr'))).toBe(`2,437${NB}%`);
    expect(value(rowOf(html, 'eurusd'))).toBe(`1,1181${NB}$`);
    expect(rowOf(html, 'eurusd')).toContain('réf. BCE');
    expect(rowOf(html, 'eurusd')).toContain('<svg');
  });
  it('CAC 40 : cours et variation du jour, sans courbe', () => {
    const row = rowOf(html, 'cac');
    expect(value(row)).toBe('7 833');
    expect(note(row)).toBe(`+0,38${NB}%`);
    expect(row).toContain('is-up');
    expect(row).not.toContain('<svg');
  });
  it('aucun tiret cadratin', () => {
    expect(html).not.toContain('—');
  });
});

describe('pannes', () => {
  it('BCE absente : « n.d. » et « BCE indisponible » ; écart absent : « TradingView indisponible » ; CAC absent : « n.d. »', () => {
    const down: FinancialStabilityResponse = {
      ...DATA,
      series: DATA.series.map((s) => ({ ...s, value: null, date: null, history: [], status: 'unavailable' as const, error: 'x' })),
      rates: DATA.rates.map((r) => ({ ...r, value: null, since: null, previous: null, status: 'unavailable' as const, error: 'x' })),
      spread: { ...DATA.spread, value: null, readAt: null, history: [], status: 'unavailable', error: 'y' },
    };
    const { level, html } = buildFinancialStabilityHTML({ data: down, error: null, cac: null });
    expect(level).toBeNull();
    for (const id of ['cissFr', 'cissEa', 'estr', 'eurusd', 'rates']) {
      expect(value(rowOf(html, id))).toBe('n.d.');
      expect(meta(rowOf(html, id))).toBe('BCE indisponible');
    }
    expect(meta(rowOf(html, 'spread'))).toBe('TradingView indisponible');
    expect(value(rowOf(html, 'cac'))).toBe('n.d.');
  });
  it('écart sans courbe encore (un seul relevé) : « en constitution » à la place de la courbe', () => {
    const { html } = buildFinancialStabilityHTML({ data: DATA, error: null, cac: CAC });
    expect(rowOf(html, 'spread')).toContain('<span class="fin-row__pending">en constitution</span>');
  });
  it('écart absent mais courbe enregistrée : la courbe reste', () => {
    const data = { ...DATA, spread: { ...DATA.spread, value: null, status: 'unavailable' as const, history: [{ date: '2026-10-09', value: 1.3 }, { date: '2026-10-12', value: 1.4 }] } };
    expect(rowOf(buildFinancialStabilityHTML({ data, error: null, cac: CAC }).html, 'spread')).toContain('<svg');
  });
  it('série en retard : date gardée, « en retard »', () => {
    const data = { ...DATA, series: [{ ...DATA.series[0]!, status: 'stale' as const, date: '2026-10-06' }, ...DATA.series.slice(1)] };
    expect(meta(rowOf(buildFinancialStabilityHTML({ data, error: null, cac: CAC }).html, 'cissFr'))).toBe('au 06/10 · en retard');
  });
  it('rien lu (502) : lignes en « n.d. », CAC 40 gardé, cause nommée (revue I3)', () => {
    const { html, level, stamp } = buildFinancialStabilityHTML({ data: null, error: 'HTTP 502', cac: CAC });
    expect(level).toBeNull();
    expect(stamp).toBe('Source indisponible');
    for (const id of ['cissFr', 'cissEa', 'spread', 'rates', 'estr', 'eurusd']) expect(value(rowOf(html, id))).toBe('n.d.');
    expect(value(rowOf(html, 'cac'))).toBe('7 833');
    expect(html).toContain('HTTP 502');
  });
  it('week-end : écart marqué « clôture du vendredi », jamais « en direct » (revue I4)', () => {
    const data = { ...DATA, spread: { ...DATA.spread, readAt: '2026-10-10T09:00:00.000Z' } };
    expect(meta(rowOf(buildFinancialStabilityHTML({ data, error: null, cac: CAC }).html, 'spread'))).toBe('clôture du vendredi · TradingView');
  });
});

describe('courbes', () => {
  const { html } = buildFinancialStabilityHTML({ data: DATA, error: null, cac: CAC });
  const stroke = (row: string): string => /class="spark-line"[^>]*stroke="([^"]+)"/.exec(row)?.[1] ?? '';
  it('CISS et écart : couleur de leur niveau ; €STR et EUR/USD : neutre', () => {
    expect(stroke(rowOf(html, 'cissFr'))).toBe(levelColorVar('vert'));
    const withSpreadCurve = { ...DATA, spread: { ...DATA.spread, history: hist(1.4, 1.43) } };
    expect(stroke(rowOf(buildFinancialStabilityHTML({ data: withSpreadCurve, error: null, cac: CAC }).html, 'spread'))).toBe(levelColorVar('rouge'));
    expect(stroke(rowOf(html, 'estr'))).toBe('var(--spark-neutral)');
  });
  it('infobulle de la courbe : période et bornes au format de la ligne', () => {
    expect(rowOf(html, 'cissFr')).toContain('<title>90 jours · plus bas 0,044 · plus haut 0,051</title>');
    expect(rowOf(html, 'eurusd')).toContain(`plus haut 1,1206${NB}$`);
  });
});
