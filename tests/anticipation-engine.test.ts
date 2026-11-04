// tests/anticipation-engine.test.ts : moteur de règles, révision sans doublon, plafonds (04/11/2026).
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error module JS sans déclaration
import { evaluate, capOpen } from '../api/_lib/anticipation/engine.js';
// @ts-expect-error module JS sans déclaration
import { openRegistry } from '../api/_lib/anticipation/registry.js';

const NOW = Date.parse('2026-11-04T09:00:00Z');
const win = { from: '2026-11-04T13:00:00.000Z', to: '2026-11-04T21:00:00.000Z' };

type Ev = { origins: number; hasOfficial: boolean; hasPublishedDeadline: boolean; officialLevel: string | null; basculeHit: boolean; precedentDay: string | null };
const strong: Ev = { origins: 3, hasOfficial: true, hasPublishedDeadline: true, officialLevel: 'rouge', basculeHit: false, precedentDay: null };

function cand(over: Record<string, unknown> = {}) {
  return {
    ruleId: 'r1', ruleVersion: 1, zone: { dept: ['69'], communes: [] }, window: win, title: 't',
    chain: [{ text: 'a', signalIds: ['s1'] }], word: 'probable', why: '', unknowns: [], bascules: [], disconfirmers: ['d'], verify: ['v'],
    evidence: strong, ...over,
  };
}
const rule = (id: string, fn: () => unknown[]) => ({ id, version: 1, title: id, domains: [], evaluate: fn, arrived: () => null, arrivalTest: 'x' });

async function reg() {
  const dir = await mkdtemp(path.join(tmpdir(), 'antic-eng-'));
  return { dir, registry: await openRegistry({ dir, now: NOW }) };
}

describe('evaluate', () => {
  it('opens a scenario with id ruleId:dept:window.from and applies the floor', async () => {
    const { dir, registry } = await reg();
    try {
      const weak = cand({ word: 'tres_probable', evidence: { ...strong, origins: 1, hasOfficial: false, hasPublishedDeadline: false, officialLevel: null } });
      const out = evaluate([], registry, NOW, [rule('r1', () => [weak])]);
      expect(out.opened).toHaveLength(1);
      expect(out.opened[0].id).toBe('r1:69:2026-11-04T13:00:00.000Z');
      expect(out.opened[0].word).toBe('peu_probable');
      expect(out.opened[0].status).toBe('ouvert');
      expect(out.opened[0].why).toContain('1 source');
      expect(out.opened[0].openedAt).toBe('2026-11-04T09:00:00.000Z');
      expect(out.open).toHaveLength(1);
      expect(out.errors).toEqual([]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('peakWord is set at opening, raised by a revision and never lowered', async () => {
    const { dir, registry } = await reg();
    try {
      const first = evaluate([], registry, NOW, [rule('r1', () => [cand({ word: 'probable' })])]);
      expect(first.opened[0].peakWord).toBe('probable');
      await registry.record({ at: new Date(NOW).toISOString(), type: 'ouverture', scenario: first.opened[0] });
      const up = evaluate([], registry, NOW + 60_000, [rule('r1', () => [cand({ word: 'tres_probable' })])]);
      expect(up.revised[0]).toMatchObject({ word: 'tres_probable', peakWord: 'tres_probable' });
      await registry.record({ at: new Date(NOW).toISOString(), type: 'revision', scenario: up.revised[0] });
      const down = evaluate([], registry, NOW + 120_000, [rule('r1', () => [cand({ word: 'probable' })])]);
      expect(down.revised[0]).toMatchObject({ word: 'probable', peakWord: 'tres_probable' });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('revises instead of duplicating', async () => {
    const { dir, registry } = await reg();
    try {
      const r = rule('r1', () => [cand()]);
      const first = evaluate([], registry, NOW, [r]);
      await registry.record({ at: new Date(NOW).toISOString(), type: 'ouverture', scenario: first.opened[0] });
      // fenêtre qui glisse mais chevauche : même scénario
      const later = NOW + 60_000;
      const shifted = cand({ window: { from: '2026-11-04T14:00:00.000Z', to: '2026-11-04T22:00:00.000Z' }, word: 'tres_probable' });
      const second = evaluate([], registry, later, [rule('r1', () => [shifted])]);
      expect(second.opened).toHaveLength(0);
      expect(second.revised).toHaveLength(1);
      expect(second.revised[0].id).toBe(first.opened[0].id);
      expect(second.revised[0].openedAt).toBe(first.opened[0].openedAt);
      expect(second.revised[0].word).toBe('tres_probable');
      expect(second.revised[0].revisedAt).toBe(new Date(later).toISOString());
      expect(second.open).toHaveLength(1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('a different dept or a disjoint window opens a new scenario', async () => {
    const { dir, registry } = await reg();
    try {
      const first = evaluate([], registry, NOW, [rule('r1', () => [cand()])]);
      await registry.record({ at: new Date(NOW).toISOString(), type: 'ouverture', scenario: first.opened[0] });
      const out = evaluate([], registry, NOW, [rule('r1', () => [cand(), cand({ zone: { dept: ['13'], communes: [] } }), cand({ window: { from: '2026-11-05T13:00:00.000Z', to: '2026-11-05T21:00:00.000Z' } })])]);
      expect(out.opened).toHaveLength(2);
      expect(out.revised).toHaveLength(0); // inchangé : pas de révision
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('rule that throws does not stop others', async () => {
    const { dir, registry } = await reg();
    try {
      const out = evaluate([], registry, NOW, [rule('boom', () => { throw new Error('casse'); }), rule('r1', () => [cand()])]);
      expect(out.opened).toHaveLength(1);
      expect(out.errors).toHaveLength(1);
      expect(out.errors[0]).toContain('boom');
      expect(out.errors[0]).toContain('casse');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('rule tolerates null inputs (signals [] → no candidate, no throw)', async () => {
    const { dir, registry } = await reg();
    try {
      const out = evaluate([], registry, NOW);
      expect(out).toMatchObject({ opened: [], revised: [], open: [], errors: [] });
      expect(() => evaluate(null, registry, NOW)).not.toThrow();
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('precedent comes from closed scenarios that arrived in the same dept', async () => {
    const { dir, registry } = await reg();
    try {
      const old = { ...evaluate([], registry, NOW, [rule('r1', () => [cand()])]).opened[0], id: 'r1:69:old', status: 'arrive', closedAt: '2026-10-12T20:00:00.000Z' };
      await registry.record({ at: '2026-10-12T20:00:00.000Z', type: 'cloture', scenario: old });
      let seen: string | null = null;
      evaluate([], registry, NOW, [rule('r1', function () { return []; }), { ...rule('r1', () => []), evaluate: (_s: unknown, c: { precedent(r: string, d: string): string | null }) => { seen = c.precedent('r1', '69'); return []; } }]);
      expect(seen).toBe('2026-10-12');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe('capOpen', () => {
  const NOON = Date.parse('2026-11-04T11:00:00Z');
  const today = { from: '2026-11-04T13:00:00.000Z', to: '2026-11-04T21:00:00.000Z' };
  const tomorrow = { from: '2026-11-05T13:00:00.000Z', to: '2026-11-05T21:00:00.000Z' };
  const mk = (id: string, dept: string[], word: string, openedAt: string, window = today) => ({ id, zone: { dept, communes: [] }, word, openedAt, status: 'ouvert', window });
  it('keeps 5 national for today / 3 per dept per Paris day; future days are not capped nationally', () => {
    const list = [];
    for (let i = 0; i < 7; i++) list.push(mk(`n${i}`, [], 'probable', `2026-11-04T0${i}:00:00Z`));
    for (let i = 0; i < 4; i++) list.push(mk(`f${i}`, [], 'probable', `2026-11-04T0${i}:00:00Z`, tomorrow));
    for (let i = 0; i < 5; i++) list.push(mk(`d${i}`, ['69'], i === 4 ? 'tres_probable' : 'probable', `2026-11-04T0${i}:00:00Z`));
    for (let i = 0; i < 2; i++) list.push(mk(`e${i}`, ['69'], 'probable', `2026-11-04T0${i}:00:00Z`, tomorrow));
    const kept = capOpen(list, NOON);
    const ids = kept.map((s: { id: string }) => s.id);
    expect(kept.filter((s: { id: string }) => s.id.startsWith('n'))).toHaveLength(5);
    expect(ids).not.toContain('n6');
    expect(kept.filter((s: { id: string }) => s.id.startsWith('f'))).toHaveLength(4);
    expect(kept.filter((s: { id: string }) => s.id.startsWith('d'))).toHaveLength(3);
    expect(ids).toContain('d4'); // le mot le plus fort passe avant
    expect(kept.filter((s: { id: string }) => s.id.startsWith('e'))).toHaveLength(2); // autre jour : autre plafond
  });
});

describe('engine fixes', () => {
  const morning = { from: '2026-11-04T05:00:00.000Z', to: '2026-11-04T13:00:00.000Z' };
  const afternoon = { from: '2026-11-04T13:00:00.000Z', to: '2026-11-04T21:00:00.000Z' };

  it('neighbouring half-days stay two scenarios, stable over two ticks', async () => {
    const { dir, registry } = await reg();
    try {
      const r = rule('r1', () => [cand({ window: morning }), cand({ window: afternoon })]);
      const t1 = evaluate([], registry, NOW, [r]);
      expect(t1.opened.map((s: { id: string }) => s.id)).toEqual(['r1:69:2026-11-04T05:00:00.000Z', 'r1:69:2026-11-04T13:00:00.000Z']);
      expect(t1.opened[0].window).toEqual(morning);
      for (const s of t1.opened) await registry.record({ at: new Date(NOW).toISOString(), type: 'ouverture', scenario: s });
      const t2 = evaluate([], registry, NOW + 60_000, [r]);
      expect(t2.opened).toHaveLength(0);
      expect(t2.revised).toHaveLength(0);
      expect(t2.open).toHaveLength(2);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('two identical ticks → second revised is empty; a changed word is revised', async () => {
    const { dir, registry } = await reg();
    try {
      const first = evaluate([], registry, NOW, [rule('r1', () => [cand()])]);
      await registry.record({ at: new Date(NOW).toISOString(), type: 'ouverture', scenario: first.opened[0] });
      expect(evaluate([], registry, NOW + 60_000, [rule('r1', () => [cand()])]).revised).toHaveLength(0);
      const weaker = cand({ evidence: { ...strong, officialLevel: 'orange' }, word: 'possibilite_reelle' });
      const t3 = evaluate([], registry, NOW + 120_000, [rule('r1', () => [weaker])]);
      expect(t3.revised).toHaveLength(1);
      expect(t3.revised[0].revisedAt).toBe(new Date(NOW + 120_000).toISOString());
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('reached bascules keep their date: only the relevé readAt changing does not revise', async () => {
    const { dir, registry } = await reg();
    try {
      const b = (at: string) => [{ id: 'arrete', label: 'Arrêté préfectoral publié', state: 'atteint', at }];
      const first = evaluate([], registry, NOW, [rule('r1', () => [cand({ bascules: b('2026-11-04T08:00:00.000Z') })])]);
      await registry.record({ at: new Date(NOW).toISOString(), type: 'ouverture', scenario: first.opened[0] });
      const t2 = evaluate([], registry, NOW + 60_000, [rule('r1', () => [cand({ bascules: b('2026-11-04T08:01:00.000Z') })])]);
      expect(t2.revised).toHaveLength(0);
      expect(t2.open[0].bascules[0].at).toBe('2026-11-04T08:00:00.000Z');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('a changed why or title is persisted', async () => {
    const { dir, registry } = await reg();
    try {
      const first = evaluate([], registry, NOW, [rule('r1', () => [cand()])]);
      await registry.record({ at: new Date(NOW).toISOString(), type: 'ouverture', scenario: first.opened[0] });
      const t2 = evaluate([], registry, NOW + 60_000, [rule('r1', () => [cand({ evidence: { ...strong, origins: 4 } })])]);
      expect(t2.revised).toHaveLength(1);
      expect(t2.revised[0].why).toContain('4 sources');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('a closed scenario is neither reopened nor overwritten', async () => {
    const { dir, registry } = await reg();
    try {
      const first = evaluate([], registry, NOW, [rule('r1', () => [cand()])]);
      await registry.record({ at: new Date(NOW).toISOString(), type: 'cloture', scenario: { ...first.opened[0], status: 'arrive', closedAt: new Date(NOW).toISOString() } });
      const same = evaluate([], registry, NOW + 60_000, [rule('r1', () => [cand()])]);
      expect(same.opened).toHaveLength(0);
      expect(same.revised).toHaveLength(0);
      const shifted = evaluate([], registry, NOW + 60_000, [rule('r1', () => [cand({ window: { from: '2026-11-04T14:00:00.000Z', to: '2026-11-04T22:00:00.000Z' } })])]);
      expect(shifted.opened).toHaveLength(0);
      expect(registry.state().get(first.opened[0].id).status).toBe('arrive');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('passes the unknown relevés to rules', async () => {
    const { dir, registry } = await reg();
    try {
      let seen: string[] = [];
      const r = { ...rule('r1', () => []), evaluate: (_s: unknown, c: { unknown: string[] }) => { seen = c.unknown; return []; } };
      evaluate([], registry, NOW, [r], ['Pannes non lues']);
      expect(seen).toEqual(['Pannes non lues']);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe('baseline des niveaux cités (clôture)', () => {
  // @ts-expect-error module JS sans déclaration
  const chaleurP = import('../api/_lib/anticipation/rules/chaleur-sante.js');
  const step = (level: string | null) => ({ text: 'a', signalIds: ['s1'], levels: { s1: level } });

  it('keeps the lowest level ever recorded on revision, without revising every tick, so a later escalation still counts', async () => {
    const { dir, registry } = await reg();
    try {
      let tick = 0;
      const r = rule('r1', () => [cand({ chain: [step(tick === 0 ? 'orange' : 'rouge')], unknowns: [tick === 2 ? 'changé' : 'u'] })]);
      const first = evaluate([], registry, NOW, [r]);
      await registry.record({ at: new Date(NOW).toISOString(), type: 'ouverture', scenario: first.opened[0] });
      tick = 1; // le signal cité est maintenant rouge : rien d'autre ne change, pas de révision, niveau stocké inchangé
      const second = evaluate([], registry, NOW + 60_000, [r]);
      expect(second.revised).toHaveLength(0);
      expect(registry.state().get(first.opened[0].id).chain[0].levels.s1).toBe('orange');
      tick = 2; // un autre champ change : révision, mais la baseline reste orange
      const third = evaluate([], registry, NOW + 120_000, [r]);
      expect(third.revised).toHaveLength(1);
      expect(third.revised[0].chain[0].levels.s1).toBe('orange');
      // règle 3 : le signal cité, rouge maintenant, est une montée par rapport à la baseline
      const chaleur = (await chaleurP).default;
      const stored = third.revised[0];
      const eco = { id: 's1', kind: 'ecowatt', level: 'rouge', dept: [], origin: 'rte', official: true, window: win, observedAt: '2026-11-04T10:00:00Z', publishedAt: '2026-11-04T10:00:00Z' };
      expect(chaleur.arrived({ ...stored, zone: { dept: ['69'], communes: [] } }, [eco], { now: NOW, unknown: [] })).toBe('arrive');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('lowers the baseline when a cited level goes down', async () => {
    const { dir, registry } = await reg();
    try {
      let lv: string | null = 'rouge';
      const r = rule('r1', () => [cand({ chain: [step(lv)] })]);
      const first = evaluate([], registry, NOW, [r]);
      await registry.record({ at: new Date(NOW).toISOString(), type: 'ouverture', scenario: first.opened[0] });
      lv = 'orange';
      const out = evaluate([], registry, NOW + 60_000, [r]);
      expect(out.revised[0].chain[0].levels.s1).toBe('orange');
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
