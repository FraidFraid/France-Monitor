import { describe, expect, it } from 'vitest';
import { parseRecords, preferSnapshot, recentRecords, slotsFromRecords } from '../api/_lib/score-history.js';
import { HISTORY_GRACE_MS, historySnapshotReady, isRecorderPage, scoreCoverageOf } from '../src/services/situation-history.ts';

interface Rec { capturedAt: string; score: number; slotKey?: string; coverage?: { read: number; total: number; missing: string[] } }
const rec = (capturedAt: string, score: number, read?: number, total = 14): Rec => ({
  capturedAt, score, ...(read === undefined ? {} : { coverage: { read, total, missing: [] } }),
});

describe('relevés de l\'enregistreur (api/_lib/score-history.js)', () => {
  it('lit une ligne JSON par relevé et ignore une ligne coupée', () => {
    const text = `${JSON.stringify(rec('2026-10-26T06:00:00Z', 88, 14))}\n{"capturedAt":"2026-10-26T06:15\n\n`;
    expect(parseRecords(text)).toHaveLength(1);
  });

  it('un relevé plus couvrant remplace celui du créneau, pas un relevé moins couvrant', () => {
    expect(preferSnapshot(null, rec('a', 90, 7))).toBe(true);
    expect(preferSnapshot(rec('a', 90, 7), rec('b', 73, 14))).toBe(true);
    expect(preferSnapshot(rec('a', 73, 14), rec('b', 90, 7))).toBe(false);
    // Relevé d'avant la couverture (aucun champ) : remplacé par tout relevé qui en porte une.
    expect(preferSnapshot(rec('a', 90), rec('b', 73, 3))).toBe(true);
  });

  it('créneau de 6 h : premier relevé complet, sinon le plus couvrant ; clé du créneau, heure réelle gardée', () => {
    const grid = ['2026-10-26T00:00', '2026-10-26T06:00', '2026-10-26T12:00'];
    const records = [
      rec('2026-10-26T06:00:30Z', 95, 6),
      rec('2026-10-26T06:15:30Z', 74, 14),
      rec('2026-10-26T06:30:30Z', 72, 14),
      rec('2026-10-26T12:00:30Z', 80, 9),
      rec('2026-10-26T12:15:30Z', 81, 12),
    ];
    const slots = slotsFromRecords(grid, records);
    expect(slots.has('2026-10-26T00:00')).toBe(false);
    expect(slots.get('2026-10-26T06:00')).toMatchObject({ score: 74, slotKey: '2026-10-26T06:00', capturedAt: '2026-10-26T06:15:30Z' });
    expect(slots.get('2026-10-26T12:00')?.score).toBe(81);
  });

  it('relevés bruts des N derniers jours, dans l\'ordre', () => {
    const now = Date.parse('2026-10-26T12:00:00Z');
    const out = recentRecords([rec('2026-10-26T11:00:00Z', 2), rec('2026-10-18T11:00:00Z', 0), rec('2026-10-25T11:00:00Z', 1)], 7, now);
    expect(out.map((r: Rec) => r.score)).toEqual([1, 2]);
  });
});

describe('relevé côté navigateur (situation-history.ts)', () => {
  it('couverture : sources lues sur le total, manquantes nommées', () => {
    expect(scoreCoverageOf({ presse: true, ecowatt: false, trains: true })).toEqual({ read: 2, total: 3, missing: ['ecowatt'] });
  });

  it('un relevé incomplet attend le délai de grâce, un relevé complet part tout de suite', () => {
    const partial = scoreCoverageOf({ a: true, b: false });
    const full = scoreCoverageOf({ a: true, b: true });
    expect(historySnapshotReady(partial, 10_000)).toBe(false);
    expect(historySnapshotReady(partial, HISTORY_GRACE_MS)).toBe(true);
    expect(historySnapshotReady(full, 1_000)).toBe(true);
  });

  it('page de l\'enregistreur reconnue par ?recorder=1 seulement', () => {
    expect(isRecorderPage('?recorder=1')).toBe(true);
    expect(isRecorderPage('?view=app&recorder=1')).toBe(true);
    expect(isRecorderPage('?recorder=0')).toBe(false);
    expect(isRecorderPage('')).toBe(false);
  });
});
