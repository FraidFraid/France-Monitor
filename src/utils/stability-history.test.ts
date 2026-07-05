import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import {
  appendEntry,
  computeDelta24h,
  computePillarDeltas24h,
  findLastWithin,
  pruneEntries,
  selectSparkline,
  MAX_ENTRIES,
  MIN_INTERVAL_MS,
  type StabilityHistoryEntry,
} from './stability-history.ts';

const H = 60 * 60 * 1000;
const NOW = 1_800_000_000_000; // timestamp fixe arbitraire

function entry(agoMs: number, score: number): StabilityHistoryEntry {
  return {
    ts: NOW - agoMs,
    score,
    pillars: { continuity: 10, security: 10, signal: 10, defense: 5 },
  };
}

describe('stability-history — appendEntry', () => {
  it('ajoute une première entrée', () => {
    const out = appendEntry([], entry(0, 90));
    assert.equal(out.length, 1);
  });

  it('throttle : refuse une entrée à moins de 30 min de la dernière', () => {
    const base = [entry(10 * 60 * 1000, 90)]; // il y a 10 min
    const out = appendEntry(base, entry(0, 88));
    assert.equal(out.length, 1);
    assert.equal(out[0].score, 90);
  });

  it('accepte une entrée après 30 min', () => {
    const base = [entry(MIN_INTERVAL_MS + 1000, 90)];
    const out = appendEntry(base, entry(0, 88));
    assert.equal(out.length, 2);
  });

  it('frontière : accepte une entrée à exactement MIN_INTERVAL_MS (comparaison <)', () => {
    const base = [entry(MIN_INTERVAL_MS, 90)]; // écart exact de 30 min
    const out = appendEntry(base, entry(0, 88));
    assert.equal(out.length, 2);
    assert.equal(out[1].score, 88);
  });
});

describe('stability-history — pruneEntries', () => {
  it('purge les entrées de plus de 7 jours', () => {
    const out = pruneEntries([entry(8 * 24 * H, 90), entry(1 * H, 88)], NOW);
    assert.equal(out.length, 1);
    assert.equal(out[0].score, 88);
  });

  it('plafonne à MAX_ENTRIES (400) et conserve les plus récentes', () => {
    // 450 entrées récentes (1 min d'écart, toutes < 7 jours), score = index d'origine
    const entries: StabilityHistoryEntry[] = [];
    for (let i = 0; i < 450; i++) {
      entries.push({
        ts: NOW - (450 - i) * 60 * 1000,
        score: i,
        pillars: { continuity: 10, security: 10, signal: 10, defense: 5 },
      });
    }
    const out = pruneEntries(entries, NOW);
    assert.equal(out.length, 400);
    assert.equal(out.length, MAX_ENTRIES);
    // les 50 plus anciennes sont éliminées : la première conservée = entrée #50 d'origine
    assert.equal(out[0].score, 50);
    assert.equal(out[out.length - 1].score, 449);
  });
});

describe('stability-history — computeDelta24h', () => {
  it('retourne null sans entrée proche de -24h (tolérance ±6h)', () => {
    assert.equal(computeDelta24h([entry(40 * H, 95), entry(1 * H, 90)], NOW), null);
  });

  it("calcule le delta vs l'entrée la plus proche de -24h", () => {
    const entries = [entry(26 * H, 94), entry(23 * H, 92), entry(0, 89)];
    // plus proche de -24h : 23h → 89 − 92 = −3
    assert.equal(computeDelta24h(entries, NOW), -3);
  });

  it('retourne null avec moins de 2 entrées', () => {
    assert.equal(computeDelta24h([entry(0, 90)], NOW), null);
  });
});

describe('stability-history — computePillarDeltas24h', () => {
  it('calcule les deltas par pilier', () => {
    const old: StabilityHistoryEntry = {
      ts: NOW - 24 * H,
      score: 92,
      pillars: { continuity: 20, security: 15, signal: 10, defense: 5 },
    };
    const last: StabilityHistoryEntry = {
      ts: NOW,
      score: 88,
      pillars: { continuity: 32, security: 15, signal: 8, defense: 5 },
    };
    const deltas = computePillarDeltas24h([old, last], NOW);
    assert.ok(deltas);
    assert.equal(deltas.continuity, 12);
    assert.equal(deltas.security, 0);
    assert.equal(deltas.signal, -2);
  });
});

describe('stability-history — selectSparkline & findLastWithin', () => {
  it('série bornée à 28 points, ordre chronologique', () => {
    const entries: StabilityHistoryEntry[] = [];
    for (let i = 60; i >= 0; i--) entries.push(entry(i * 2 * H, 80 + (i % 5)));
    const series = selectSparkline(pruneEntries(entries, NOW), NOW);
    assert.ok(series.length <= 28);
    assert.ok(series.length >= 2);
    // le dernier point de la série = score de l'entrée la plus récente
    assert.equal(series[series.length - 1], entries[entries.length - 1].score);
  });

  it('findLastWithin respecte la fenêtre', () => {
    const entries = [entry(3 * H, 91), entry(1 * H, 90)];
    assert.equal(findLastWithin(entries, NOW, 2 * H)?.score, 90);
    assert.equal(findLastWithin([entry(3 * H, 91)], NOW, 2 * H), null);
  });
});
