// tests/anticipation-closing.test.ts : clôture des scénarios et crises manquées (04/11/2026).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error module JS sans déclaration
import { closeDue, missedCrises, collectWindowSignals } from '../api/_lib/anticipation/closing.js';
// @ts-expect-error module JS sans déclaration
import { openRegistry } from '../api/_lib/anticipation/registry.js';
// @ts-expect-error module JS sans déclaration
import greve from '../api/_lib/anticipation/rules/greve-carburant.js';

const NOW = Date.parse('2026-11-04T12:00:00Z');
const H = 3_600_000;
const WIN = { from: '2026-11-01T23:00:00.000Z', to: '2026-11-02T23:00:00.000Z' }; // jour de Paris du 02/11

function scenario(over: Record<string, unknown> = {}) {
  return {
    id: 'greve-carburant:national:2026-11-01T23:00:00.000Z', ruleId: 'greve-carburant', ruleVersion: 1, zone: { dept: [], communes: [] }, window: WIN,
    title: 't', chain: [], word: 'possibilite_reelle', why: '', unknowns: [], bascules: [], disconfirmers: [], verify: [], openedAt: '2026-11-01T10:00:00.000Z',
    revisedAt: '2026-11-01T10:00:00.000Z', status: 'ouvert', closedAt: null, outcomeNote: null, feedback: { utile: 0, deja_su: 0, faux: 0 }, ...over,
  };
}
const carb = (value: number, observedAt: string, over: Record<string, unknown> = {}) => ({
  id: 'carb-nat', domain: 'fuel', kind: 'tension_carburant', source: 'prix-carburants', origin: 'prix-carburants', official: true, dept: [], communes: [], level: null,
  value, window: null, publishedAt: null, observedAt, checkedAt: observedAt, ref: 'x', meta: { national: true }, ...over,
});

let dir = '';
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'antic-close-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('closeDue', () => {
  it('closes arrive from the archived window signals when the current snapshot has no evidence', async () => {
    const registry = await openRegistry({ dir, now: NOW });
    await registry.archiveSignals([carb(20, '2026-11-02T10:00:00.000Z')], Date.parse('2026-11-02T10:00:00Z'));
    const out = await closeDue([scenario()], [], [greve], NOW, { registry, unknown: [] });
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('arrive');
    expect(out[0].note).toMatch(/\S/);
    expect(out[0].scenario.status).toBe('arrive');
    expect(out[0].scenario.closedAt).toBe(new Date(NOW).toISOString());
  });

  it('closes pas_arrive when the archive shows the relevé read below the threshold', async () => {
    const registry = await openRegistry({ dir, now: NOW });
    await registry.archiveSignals([carb(5, '2026-11-02T10:00:00.000Z')], Date.parse('2026-11-02T10:00:00Z'));
    const out = await closeDue([scenario()], [], [greve], NOW, { registry, unknown: [] });
    expect(out[0].status).toBe('pas_arrive');
    expect(out[0].note).toMatch(/\S/);
  });

  it('closes indecidable when the relevé was not read during the window', async () => {
    const registry = await openRegistry({ dir, now: NOW });
    const out = await closeDue([scenario()], [], [greve], NOW, { registry, unknown: ['Carburants non lus'] });
    expect(out[0].status).toBe('indecidable');
    const out2 = await closeDue([scenario()], [], [greve], NOW, { registry, unknown: [] });
    expect(out2[0].status).toBe('indecidable'); // archive vide et rien d'actuel
  });

  it('does not close before window.to + 2 h, nor a scenario that is already closed', async () => {
    const registry = await openRegistry({ dir, now: NOW });
    const justAfter = Date.parse(WIN.to) + 2 * H - 1;
    expect(await closeDue([scenario()], [], [greve], justAfter, { registry, unknown: [] })).toEqual([]);
    expect(await closeDue([scenario({ status: 'arrive' })], [carb(20, '2026-11-02T10:00:00.000Z')], [greve], NOW, { registry, unknown: [] })).toEqual([]);
  });

  it('expires after 48 h when the rule gives no decision (unknown rule)', async () => {
    const registry = await openRegistry({ dir, now: NOW });
    const old = scenario({ ruleId: 'inconnue', window: { from: '2026-10-29T00:00:00.000Z', to: '2026-10-30T00:00:00.000Z' } });
    const out = await closeDue([old], [], [greve], NOW, { registry, unknown: [] });
    expect(out[0].status).toBe('expire');
    // moins de 48 h : sans décision de règle, indécidable
    const recent = scenario({ ruleId: 'inconnue', window: { from: '2026-11-03T00:00:00.000Z', to: '2026-11-04T00:00:00.000Z' } });
    const out2 = await closeDue([recent], [], [greve], NOW, { registry, unknown: [] });
    expect(out2[0].status).toBe('indecidable');
  });

  it('a rule that throws does not stop the others', async () => {
    const registry = await openRegistry({ dir, now: NOW });
    const bad = { id: 'boom', arrived: () => { throw new Error('x'); } };
    const out = await closeDue([scenario({ ruleId: 'boom', id: 'b' }), scenario()], [carb(20, '2026-11-02T10:00:00.000Z')], [bad, greve], NOW, { registry, unknown: [] });
    expect(out.map((o: { scenario: { id: string } }) => o.scenario.id)).toContain('greve-carburant:national:2026-11-01T23:00:00.000Z');
  });
});

describe('collectWindowSignals', () => {
  it('keeps every distinct (id, observedAt) observation and drops exact duplicates only', async () => {
    const registry = await openRegistry({ dir, now: NOW });
    const s = (level: string | null, at: string) => carb(1, at, { id: 'v', level });
    await registry.archiveSignals([s('orange', '2026-11-02T08:00:00.000Z')], Date.parse('2026-11-02T08:00:00Z'));
    await registry.archiveSignals([s('rouge', '2026-11-02T09:00:00.000Z')], Date.parse('2026-11-02T09:00:00Z'));
    const out = await collectWindowSignals(registry, scenario(), [s('jaune', '2026-11-04T11:00:00.000Z'), s('rouge', '2026-11-02T09:00:00.000Z')]);
    const v = out.filter((x: { id: string }) => x.id === 'v');
    expect(v.map((x: { level: string; observedAt: string }) => `${x.level}@${x.observedAt}`).sort()).toEqual([
      'jaune@2026-11-04T11:00:00.000Z', 'orange@2026-11-02T08:00:00.000Z', 'rouge@2026-11-02T09:00:00.000Z',
    ]);
  });

  it('reads each day file once when the window spans several hours of one day', async () => {
    const registry = await openRegistry({ dir, now: NOW });
    await registry.archiveSignals([carb(20, '2026-11-02T10:00:00.000Z')], Date.parse('2026-11-02T10:00:00Z'));
    const out = await registry.signalsBetween('2026-11-02T00:00:00.000Z', '2026-11-02T20:00:00.000Z');
    expect(out).toHaveLength(1);
  });
});

describe('closeDue regressions: a persistent signal does not erase its in-window copy', () => {
  it('archive value 20 in the window + current value 5 now -> arrive', async () => {
    const registry = await openRegistry({ dir, now: NOW });
    await registry.archiveSignals([carb(20, '2026-11-02T10:00:00.000Z')], Date.parse('2026-11-02T10:00:00Z'));
    const out = await closeDue([scenario()], [carb(5, '2026-11-04T11:30:00.000Z')], [greve], NOW, { registry, unknown: [] });
    expect(out[0].status).toBe('arrive');
  });

  it('a persistent Ecowatt rouge or electricity panne observed in the window still counts when its current copy is weaker', async () => {
    // @ts-expect-error module JS sans déclaration
    const chaleur = (await import('../api/_lib/anticipation/rules/chaleur-sante.js')).default;
    const registry = await openRegistry({ dir, now: NOW });
    const w = { from: '2026-11-02T00:00:00.000Z', to: '2026-11-03T00:00:00.000Z' };
    const base = { domain: 'energy', source: 's', origin: 'rte', official: true, dept: ['69'], communes: [], value: null, window: w, ref: 'r', checkedAt: '2026-11-02T10:00:00.000Z' };
    const eco = (level: string, at: string) => ({ ...base, id: 'eco', kind: 'ecowatt', level, publishedAt: at, observedAt: at });
    const panne = (level: string, at: string) => ({ ...base, id: 'pa', kind: 'panne', level, publishedAt: at, observedAt: at, meta: { network: 'electricite' } });
    const sc = scenario({ ruleId: 'chaleur-sante', id: 'c', window: w, zone: { dept: ['69'], communes: [] }, openedAt: '2026-11-01T10:00:00.000Z' });
    await registry.archiveSignals([eco('rouge', '2026-11-02T10:00:00.000Z')], Date.parse('2026-11-02T10:00:00Z'));
    const a = await closeDue([sc], [eco('orange', '2026-11-04T11:00:00.000Z')], [chaleur], NOW, { registry, unknown: [] });
    expect(a[0].status).toBe('arrive');
    const dir2 = await mkdtemp(path.join(tmpdir(), 'antic-close2-'));
    try {
      const registry2 = await openRegistry({ dir: dir2, now: NOW });
      await registry2.archiveSignals([panne('rouge', '2026-11-02T10:00:00.000Z')], Date.parse('2026-11-02T10:00:00Z'));
      const b = await closeDue([sc], [panne('jaune', '2026-11-04T11:00:00.000Z')], [chaleur], NOW, { registry: registry2, unknown: [] });
      expect(b[0].status).toBe('arrive');
    } finally { await rm(dir2, { recursive: true, force: true }); }
  });
});

describe('missedCrises', () => {
  const press = (over: Record<string, unknown> = {}) => ({
    id: 'p1', domain: 'press', kind: 'presse', source: 'presse', origin: 'presse:1', official: false, dept: ['69'], communes: [], level: null, value: null, window: null,
    publishedAt: '2026-11-04T10:00:00.000Z', observedAt: '2026-11-04T10:05:00.000Z', checkedAt: '2026-11-04T10:05:00.000Z', ref: 'r',
    meta: { category: 'security', severity: 'critical', title: 'x' }, ...over,
  });

  it('records a missed crisis when no scenario was opened in the département within 24 h', () => {
    const out = missedCrises([press()], [], [], NOW);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('manque');
    expect(out[0].ruleId).toBe('aucune');
    expect(out[0].id).toBe('manque:p1');
    expect(out[0].zone.dept).toEqual(['69']);
    expect(out[0].chain[0].signalIds).toEqual(['p1']);
  });

  it('also records a red panne, and ignores low severity or other categories', () => {
    const panne = press({ id: 'pa', kind: 'panne', domain: 'energy', meta: { network: 'electricite' }, level: 'rouge' });
    expect(missedCrises([panne], [], [], NOW)).toHaveLength(1);
    expect(missedCrises([press({ meta: { category: 'security', severity: 'medium' } })], [], [], NOW)).toEqual([]);
    expect(missedCrises([press({ meta: { category: 'weather', severity: 'critical' } })], [], [], NOW)).toEqual([]);
    expect(missedCrises([press({ id: 'po', kind: 'panne', level: 'orange', meta: {} })], [], [], NOW)).toEqual([]);
  });

  // La crise `press()` est publiée à 10:00 UTC ; couverture : ouvert strictement avant, et ouvert à un moment de [t - 24 h, t).
  it('no missed crisis when a scenario opened before it covers the département (open, or closed within the 24 h before)', () => {
    const sc = (over: Record<string, unknown>) => scenario({ zone: { dept: ['69'], communes: [] }, ...over });
    expect(missedCrises([press()], [sc({ openedAt: '2026-11-04T07:00:00.000Z' })], [], NOW)).toEqual([]);
    expect(missedCrises([press()], [], [sc({ status: 'pas_arrive', openedAt: '2026-11-03T20:00:00.000Z', closedAt: '2026-11-04T11:00:00.000Z' })], NOW)).toEqual([]);
    // longue durée, toujours ouvert depuis plus de 24 h : couvre encore
    expect(missedCrises([press()], [sc({ openedAt: new Date(NOW - 30 * H).toISOString() })], [], NOW)).toEqual([]);
    // clos plus de 24 h avant la crise : ne couvre pas
    expect(missedCrises([press()], [], [sc({ status: 'arrive', openedAt: '2026-11-02T00:00:00.000Z', closedAt: '2026-11-03T09:00:00.000Z' })], NOW)).toHaveLength(1);
    // autre département : ne couvre pas
    expect(missedCrises([press()], [sc({ zone: { dept: ['13'], communes: [] }, openedAt: '2026-11-04T07:00:00.000Z' })], [], NOW)).toHaveLength(1);
  });

  it('a scenario opened after the crisis (in reaction) does not cover it', () => {
    const late = scenario({ zone: { dept: ['69'], communes: [] }, openedAt: '2026-11-04T11:00:00.000Z' });
    expect(missedCrises([press()], [late], [], NOW)).toHaveLength(1);
  });

  it('is stable across ticks: an already recorded crisis is not recorded twice', () => {
    const first = missedCrises([press()], [], [], NOW);
    expect(missedCrises([press()], [], first, NOW + 30 * 60_000)).toEqual([]);
    // même après 24 h tant que le signal est encore là
    expect(missedCrises([press()], [], first, NOW + 30 * H)).toEqual([]);
  });

  it('records at most one missed crisis per département per call; tolerates junk', () => {
    expect(missedCrises([press(), press({ id: 'p2' })], [], [], NOW)).toHaveLength(1);
    expect(missedCrises(null, null, null, NOW)).toEqual([]);
    expect(missedCrises([null, {}, press({ dept: [] })], [], [], NOW)).toEqual([]);
  });
});
