// tests/anticipation-agenda.test.ts : agenda 7 jours à l'heure de Paris (04/11/2026).
import { describe, expect, it } from 'vitest';
// @ts-expect-error module JS sans déclaration
import { buildAgenda } from '../api/_lib/anticipation/agenda.js';

const NOW = Date.parse('2026-11-04T09:00:00Z'); // 10:00 à Paris

function sc(id: string, from: string, to: string, over: Record<string, unknown> = {}) {
  return { id, ruleId: 'r', status: 'ouvert', window: { from, to }, zone: { dept: [], communes: [] }, ...over };
}
const item = (day: string, title = 't') => ({ day, level: null, title, detail: null, source: 'RTE' });

describe('buildAgenda', () => {
  it('returns today and the six following Paris days', () => {
    const days = buildAgenda([], [], NOW);
    expect(days.map((d: { day: string }) => d.day)).toEqual(['2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10']);
  });

  it('uses the Paris day: a window starting 2026-10-24T23:30Z belongs to 2026-10-25', () => {
    const now = Date.parse('2026-10-24T12:00:00Z');
    const days = buildAgenda([sc('a', '2026-10-24T23:30:00.000Z', '2026-10-25T05:00:00.000Z')], [], now);
    expect(days[0].day).toBe('2026-10-24');
    expect(days[0].scenarioIds).toEqual([]);
    expect(days[1].day).toBe('2026-10-25');
    expect(days[1].scenarioIds).toEqual(['a']);
  });

  it('Paris day across the winter-time change (25 h day) stays correct', () => {
    const now = Date.parse('2026-10-24T12:00:00Z');
    const days = buildAgenda([sc('b', '2026-10-25T22:30:00.000Z', '2026-10-26T05:00:00.000Z')], [], now);
    expect(days.map((d: { day: string }) => d.day)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
    expect(days[1].scenarioIds).toEqual(['b']); // 23:30 à Paris le 25 (heure d'hiver)
    expect(days[2].scenarioIds).toEqual(['b']);
  });

  it('today has three halves; a scenario crossing midnight is listed on both days', () => {
    // 15:00 à 23:30 UTC du 04/11 = 16:00 à 00:30 Paris
    const days = buildAgenda([sc('c', '2026-11-04T15:00:00.000Z', '2026-11-04T23:30:00.000Z'), sc('m', '2026-11-04T07:00:00.000Z', '2026-11-04T09:00:00.000Z')], [], NOW);
    expect(days[0].halves.map((h: { half: string }) => h.half)).toEqual(['matin', 'apres-midi', 'soir']);
    const by = Object.fromEntries(days[0].halves.map((h: { half: string, scenarioIds: string[] }) => [h.half, h.scenarioIds]));
    expect(by.matin).toEqual(['m']);
    expect(by['apres-midi']).toEqual(['c']);
    expect(by.soir).toEqual(['c']);
    expect(days[0].scenarioIds).toEqual(['c', 'm']);
    expect(days[1].scenarioIds).toEqual(['c']);
    expect(days[1].halves).toBeUndefined();
  });

  it('a day without crossing lists deadlines only', () => {
    const days = buildAgenda([], [item('2026-11-06', 'Écowatt orange')], NOW);
    expect(days[2].scenarioIds).toEqual([]);
    expect(days[2].deadlines.map((d: { title: string }) => d.title)).toEqual(['Écowatt orange']);
    expect(days[0].deadlines).toEqual([]);
  });

  it('ignores closed scenarios, bad windows and out-of-range items; tolerates null', () => {
    const days = buildAgenda([sc('x', '2026-11-04T10:00:00.000Z', '2026-11-04T12:00:00.000Z', { status: 'arrive' }), sc('y', 'n.d.', 'n.d.')], [item('2026-12-01')], NOW);
    expect(days.every((d: { scenarioIds: string[], deadlines: unknown[] }) => d.scenarioIds.length === 0 && d.deadlines.length === 0)).toBe(true);
    expect(buildAgenda(null, null, NOW)).toHaveLength(7);
  });
});
