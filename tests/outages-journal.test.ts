// tests/outages-journal.test.ts : journal des pannes (api/_lib/outages-journal.js, 21/10/2026) : comparaison d'états, pur.
import { describe, expect, it } from 'vitest';
import { diffOutages } from '../api/_lib/outages-journal.js';

const T0 = Date.parse('2026-10-21T12:00:00Z');
const o = (id: string, level: 'jaune' | 'orange' | 'rouge', rung: 'signalee' | 'mesuree' | 'confirmee' = 'mesuree') => ({
  id, network: 'mobile' as const, scope: 'operateur' as const, operator: 'Orange', dept: null, label: 'Orange', level, since: null,
  national: false, measured: rung !== 'signalee', rung, evidence: [],
});

describe('journal des pannes', () => {
  it('premier état (prev null) : aucune entrée, état posé', () => {
    const { state, entries } = diffOutages(null, [o('a', 'orange')], T0);
    expect(entries).toEqual([]);
    expect(state.items.a).toMatchObject({ level: 'orange', missing: 0, network: 'mobile', name: 'Orange' });
  });
  it('apparition, aggravation, atténuation, confirmation', () => {
    const s0 = diffOutages(null, [o('a', 'jaune', 'signalee')], T0).state;
    const s1 = diffOutages(s0, [o('a', 'orange', 'signalee'), o('b', 'jaune')], T0 + 60_000);
    expect(s1.entries.map((e) => [e.id, e.kind])).toEqual([['a', 'aggravee'], ['b', 'nouvelle']]);
    const s2 = diffOutages(s1.state, [o('a', 'jaune', 'confirmee'), o('b', 'jaune')], T0 + 120_000);
    expect(s2.entries.map((e) => [e.id, e.kind])).toEqual([['a', 'attenuee'], ['a', 'confirmee']]);
    expect(s2.entries[0]).toMatchObject({ at: '2026-10-21T12:02:00.000Z', network: 'mobile', name: 'Orange', level: 'jaune', rung: 'confirmee' });
  });
  it('absente 1 tick : rien ; 2 ticks : rétablie et retirée ; revenue : nouvelle', () => {
    const s0 = diffOutages(null, [o('a', 'orange')], T0).state;
    const s1 = diffOutages(s0, [], T0 + 60_000);
    expect(s1.entries).toEqual([]);
    expect(s1.state.items.a?.missing).toBe(1);
    const s2 = diffOutages(s1.state, [], T0 + 120_000);
    expect(s2.entries).toEqual([expect.objectContaining({ id: 'a', kind: 'retablie', level: 'orange' })]);
    expect(s2.state.items.a).toBeUndefined();
    const s3 = diffOutages(s2.state, [o('a', 'orange')], T0 + 180_000);
    expect(s3.entries).toEqual([expect.objectContaining({ id: 'a', kind: 'nouvelle' })]);
  });
  it('absente 1 tick puis revenue : aucune entrée, compteur remis à zéro', () => {
    const s0 = diffOutages(null, [o('a', 'orange')], T0).state;
    const s1 = diffOutages(s0, [], T0 + 60_000).state;
    const s2 = diffOutages(s1, [o('a', 'orange')], T0 + 120_000);
    expect(s2.entries).toEqual([]);
    expect(s2.state.items.a?.missing).toBe(0);
  });
});
