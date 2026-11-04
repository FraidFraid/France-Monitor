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
      expect(out.revised).toHaveLength(1);
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
  const mk = (id: string, dept: string[], word: string, openedAt: string) => ({ id, zone: { dept, communes: [] }, word, openedAt, status: 'ouvert' });
  it('keeps 5 national / 3 per dept', () => {
    const list = [];
    for (let i = 0; i < 7; i++) list.push(mk(`n${i}`, [], 'probable', `2026-11-04T0${i}:00:00Z`));
    for (let i = 0; i < 5; i++) list.push(mk(`d${i}`, ['69'], i === 4 ? 'tres_probable' : 'probable', `2026-11-04T0${i}:00:00Z`));
    const kept = capOpen(list);
    expect(kept.filter((s: { zone: { dept: string[] } }) => s.zone.dept.length === 0)).toHaveLength(5);
    expect(kept.filter((s: { zone: { dept: string[] } }) => s.zone.dept[0] === '69')).toHaveLength(3);
    expect(kept.map((s: { id: string }) => s.id)).toContain('d4'); // le mot le plus fort passe avant
    expect(kept.map((s: { id: string }) => s.id)).not.toContain('n6');
  });
});
