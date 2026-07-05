import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import {
  BRIEF_MAX_ITEMS,
  formatSinceLabel,
  resolvedSituationsFromHistory,
  selectBriefItems,
  type BriefSourceSituation,
} from './situation-brief.ts';
import type { HistorySlot, SituationSeverity, SnapshotSituation } from '../types/index.ts';

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = Date.UTC(2026, 6, 5, 12, 0, 0); // 2026-07-05T12:00:00Z
const MIN = 60_000;
const HOUR = 60 * MIN;

function src(overrides: Partial<BriefSourceSituation> = {}): BriefSourceSituation {
  return {
    id: overrides.id ?? 'sit-1',
    type: overrides.type ?? 'ENERGY_STRESS',
    severity: overrides.severity ?? 'medium',
    title: overrides.title ?? 'Situation',
    affectedZones: overrides.affectedZones ?? ['France'],
    since: overrides.since ?? NOW - HOUR,
    ...(overrides.lat != null ? { lat: overrides.lat } : {}),
    ...(overrides.lon != null ? { lon: overrides.lon } : {}),
  };
}

// ─── Tri par sévérité ────────────────────────────────────────────────────────────

describe('selectBriefItems — tri des situations actives', () => {
  it('classe les actives par sévérité décroissante', () => {
    const active = [
      src({ id: 'a', severity: 'watch' }),
      src({ id: 'b', severity: 'critical' }),
      src({ id: 'c', severity: 'medium' }),
    ];
    const items = selectBriefItems(active, [], NOW);
    assert.deepEqual(items.map((i) => i.id), ['b', 'c', 'a']);
    assert.equal(items[0].severity, 'critical');
  });

  it('à sévérité égale, la plus ancienne passe en premier', () => {
    const active = [
      src({ id: 'recent', severity: 'high', since: NOW - 10 * MIN }),
      src({ id: 'ancienne', severity: 'high', since: NOW - 3 * HOUR }),
    ];
    const items = selectBriefItems(active, [], NOW);
    assert.deepEqual(items.map((i) => i.id), ['ancienne', 'recent']);
  });
});

// ─── Cap à 3 ────────────────────────────────────────────────────────────────────

describe('selectBriefItems — plafond', () => {
  it('ne retourne jamais plus de BRIEF_MAX_ITEMS', () => {
    const active = Array.from({ length: 6 }, (_, i) =>
      src({ id: `a${i}`, severity: 'high' }),
    );
    const items = selectBriefItems(active, [], NOW);
    assert.equal(items.length, BRIEF_MAX_ITEMS);
    assert.equal(items.length, 3);
  });

  it('plafonne aussi le mélange actives + résolues à 3', () => {
    const active = [src({ id: 'a', severity: 'critical' }), src({ id: 'b', severity: 'high' })];
    const recent = [
      src({ id: 'r1', since: NOW - 2 * HOUR }),
      src({ id: 'r2', since: NOW - 4 * HOUR }),
    ];
    const items = selectBriefItems(active, recent, NOW);
    assert.equal(items.length, 3);
    assert.deepEqual(items.map((i) => i.id), ['a', 'b', 'r1']);
  });
});

// ─── Complétion par les résolues ─────────────────────────────────────────────────

describe('selectBriefItems — complétion par les résolues 24 h', () => {
  it('complète avec les résolues quand moins de 3 actives', () => {
    const active = [src({ id: 'a', severity: 'critical' })];
    const recent = [
      src({ id: 'r1', since: NOW - 30 * MIN }),
      src({ id: 'r2', since: NOW - 5 * HOUR }),
    ];
    const items = selectBriefItems(active, recent, NOW);
    assert.deepEqual(items.map((i) => i.id), ['a', 'r1', 'r2']);
    assert.equal(items[0].resolved, false);
    assert.equal(items[1].resolved, true);
    assert.equal(items[2].resolved, true);
  });

  it('trie les résolues de la plus récente à la plus ancienne', () => {
    const recent = [
      src({ id: 'vieille', since: NOW - 20 * HOUR }),
      src({ id: 'fraiche', since: NOW - 15 * MIN }),
      src({ id: 'moyenne', since: NOW - 3 * HOUR }),
    ];
    const items = selectBriefItems([], recent, NOW);
    assert.deepEqual(items.map((i) => i.id), ['fraiche', 'moyenne', 'vieille']);
  });

  it('exclut une résolue dont l’id est déjà actif (dédoublonnage)', () => {
    const active = [src({ id: 'shared', severity: 'high' })];
    const recent = [
      src({ id: 'shared', since: NOW - 10 * MIN }),
      src({ id: 'other', since: NOW - 2 * HOUR }),
    ];
    const items = selectBriefItems(active, recent, NOW);
    assert.deepEqual(items.map((i) => i.id), ['shared', 'other']);
    assert.equal(items.filter((i) => i.id === 'shared').length, 1);
  });
});

// ─── État vide ──────────────────────────────────────────────────────────────────

describe('selectBriefItems — état nominal', () => {
  it('retourne une liste vide sans situation', () => {
    assert.deepEqual(selectBriefItems([], [], NOW), []);
  });
});

// ─── Libellés ───────────────────────────────────────────────────────────────────

describe('selectBriefItems — libellés FR', () => {
  it('mappe la sévérité vers le libellé français attendu', () => {
    const cases: Array<[SituationSeverity, string]> = [
      ['critical', 'Critique'],
      ['high', 'Élevé'],
      ['medium', 'Moyen'],
      ['watch', 'Veille'],
    ];
    for (const [severity, label] of cases) {
      const [item] = selectBriefItems([src({ id: severity, severity })], [], NOW);
      assert.equal(item.severityLabel, label);
    }
  });

  it('reprend la première zone concernée', () => {
    const [item] = selectBriefItems(
      [src({ affectedZones: ['PACA', 'Occitanie'] })],
      [],
      NOW,
    );
    assert.equal(item.zone, 'PACA');
  });

  it('sinceLabel actif utilise "depuis"', () => {
    const [item] = selectBriefItems([src({ since: NOW - 2 * HOUR })], [], NOW);
    assert.equal(item.sinceLabel, 'depuis 2 h');
  });

  it('sinceLabel résolu utilise "il y a"', () => {
    const [item] = selectBriefItems([], [src({ since: NOW - 40 * MIN })], NOW);
    assert.equal(item.sinceLabel, 'il y a 40 min');
  });
});

// ─── formatSinceLabel ────────────────────────────────────────────────────────────

describe('formatSinceLabel', () => {
  it('affiche "à l’instant" sous la minute (et borne les délais négatifs)', () => {
    assert.equal(formatSinceLabel(30 * 1000, false), 'à l’instant');
    assert.equal(formatSinceLabel(-5000, true), 'à l’instant');
  });

  it('affiche les minutes, heures et jours', () => {
    assert.equal(formatSinceLabel(25 * MIN, false), 'depuis 25 min');
    assert.equal(formatSinceLabel(3 * HOUR, false), 'depuis 3 h');
    assert.equal(formatSinceLabel(50 * HOUR, true), 'il y a 2 j');
  });
});

// ─── resolvedSituationsFromHistory ───────────────────────────────────────────────

function snapshotSituation(overrides: Partial<SnapshotSituation> = {}): SnapshotSituation {
  return {
    id: overrides.id ?? 's',
    type: overrides.type ?? 'FLOOD_CRISIS',
    severity: overrides.severity ?? 'high',
    title: overrides.title ?? 'Crise',
    topDriver: overrides.topDriver ?? '',
    affectedZones: overrides.affectedZones ?? ['France'],
    confidence: overrides.confidence ?? 0.8,
  };
}

function slot(capturedAt: string, situations: SnapshotSituation[]): HistorySlot {
  return {
    version: 1,
    slotKey: capturedAt.slice(0, 16),
    capturedAt,
    score: 50,
    axes: { continuity: null, defense: null, security: null, signal: null, cyber: null, social: null },
    situations,
    meta: { totalSituations: situations.length, maxSeverity: 'high', avgConfidence: 0.8 },
    dataStatus: { overall: 'ok', sources: { countryAxes: 'ok', cyber: 'ok', social: 'ok' } },
  };
}

function iso(offsetMs: number): string {
  return new Date(NOW - offsetMs).toISOString();
}

describe('resolvedSituationsFromHistory', () => {
  it('ignore les créneaux manquants et hors fenêtre 24 h', () => {
    const slots: HistorySlot[] = [
      { slotKey: '2026-07-05T00:00', status: 'missing' },
      slot(iso(2 * HOUR), [snapshotSituation({ id: 'recent' })]),
      slot(iso(30 * HOUR), [snapshotSituation({ id: 'ancienne' })]),
    ];
    const out = resolvedSituationsFromHistory(slots, NOW);
    assert.deepEqual(out.map((s) => s.id), ['recent']);
  });

  it('ramène chaque situation à son observation la plus récente', () => {
    const slots: HistorySlot[] = [
      slot(iso(6 * HOUR), [snapshotSituation({ id: 'x', title: 'Ancien titre' })]),
      slot(iso(1 * HOUR), [snapshotSituation({ id: 'x', title: 'Titre récent' })]),
    ];
    const [item] = resolvedSituationsFromHistory(slots, NOW);
    assert.equal(item.since, NOW - 1 * HOUR);
    assert.equal(item.title, 'Titre récent');
  });

  it('replie un type inconnu vers NEWS_ALERT', () => {
    const slots: HistorySlot[] = [
      slot(iso(1 * HOUR), [snapshotSituation({ id: 'x', type: 'TYPE_INCONNU' })]),
    ];
    const [item] = resolvedSituationsFromHistory(slots, NOW);
    assert.equal(item.type, 'NEWS_ALERT');
  });

  it('alimente selectBriefItems en situations résolues exploitables', () => {
    const slots: HistorySlot[] = [
      slot(iso(45 * MIN), [snapshotSituation({ id: 'flood', severity: 'high', title: 'Crue Loire' })]),
    ];
    const resolved = resolvedSituationsFromHistory(slots, NOW);
    const items = selectBriefItems([], resolved, NOW);
    assert.equal(items.length, 1);
    assert.equal(items[0].resolved, true);
    assert.equal(items[0].sinceLabel, 'il y a 45 min');
  });
});
