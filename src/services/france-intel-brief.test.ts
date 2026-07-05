import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { buildDeterministicBrief, compactSituations, parseStructuredBrief } from './france-intel-brief.ts';
import type { DetectedSituation, FranceScoreBreakdown } from '../types/index.ts';

function situation(overrides: Partial<DetectedSituation> = {}): DetectedSituation {
  return {
    id: 'energy-stress',
    type: 'ENERGY_STRESS',
    severity: 'high',
    confidence: 0.8,
    title: 'Tension énergétique nationale',
    summary: 'Signal Ecowatt orange confirmé par 2 sources.',
    affectedZones: ['AURA', 'IDF'],
    drivers: ['Ecowatt orange — 2 régions'],
    recommendedActions: [
      { label: 'Surveiller Ecowatt J+1', ownerHint: 'Analyste énergie', actionType: 'monitor' },
    ],
    sourceRefs: ['Ecowatt RTE', 'REMIT RTE'],
    updatedAt: new Date(0),
    ...overrides,
  };
}

function breakdown(): FranceScoreBreakdown {
  return {
    score: 61,
    baseline: 95,
    pillars: [
      { key: 'continuity', value: 62, deduction: 19.3, components: [{ label: 'Pression électrique', value: 68 }] },
      { key: 'security', value: 41, deduction: 9.0, components: [] },
      { key: 'signal', value: 33, deduction: 4.4, components: [] },
      { key: 'defense', value: 18, deduction: 1.0, components: [] },
    ],
    shockValue: 55,
    shockExtra: 1.3,
    situationCap: 78,
  };
}

describe('parseStructuredBrief', () => {
  const valid = {
    bluf: 'Situation nationale sous tension, tirée par la continuité énergétique.',
    judgments: [
      { priority: 2, text: 'Risque J+1 probable.', confidence: 'high', sources: ['RTE'] },
      { priority: 1, text: 'Pression cyber découplée.', confidence: 'moderate', sources: [] },
    ],
    watch: [{ text: 'Signal Ecowatt J+1', horizon: '6h' }],
  };

  it('accepte un brief valide et trie les jugements par priorité', () => {
    const brief = parseStructuredBrief(valid, 'llm');
    assert.ok(brief);
    assert.equal(brief.origin, 'llm');
    assert.equal(brief.judgments[0].priority, 1);
  });

  it('rejette bluf manquant ou trop court, jugements vides, enums invalides', () => {
    assert.equal(parseStructuredBrief({ ...valid, bluf: 'court' }, 'llm'), null);
    assert.equal(parseStructuredBrief({ ...valid, judgments: [] }, 'llm'), null);
    assert.equal(parseStructuredBrief({
      ...valid,
      judgments: [{ priority: 9, text: 'x', confidence: 'high', sources: [] }],
    }, 'llm'), null);
    assert.equal(parseStructuredBrief('texte brut', 'llm'), null);
  });

  it('tronque : bluf ≤ 400, ≤ 4 jugements, ≤ 4 watch, horizon inconnu → 24h', () => {
    const brief = parseStructuredBrief({
      bluf: 'x'.repeat(600),
      judgments: Array.from({ length: 6 }, (_, i) => ({
        priority: 3, text: `jugement ${i}`, confidence: 'low', sources: [],
      })),
      watch: Array.from({ length: 6 }, (_, i) => ({ text: `w${i}`, horizon: 'demain' })),
    }, 'llm');
    assert.ok(brief);
    assert.equal(brief.bluf.length, 400);
    assert.equal(brief.judgments.length, 4);
    assert.equal(brief.watch.length, 4);
    assert.equal(brief.watch[0].horizon, '24h');
  });
});

describe('buildDeterministicBrief', () => {
  it('produit un brief complet depuis les situations', () => {
    const brief = buildDeterministicBrief(
      { score: 61, scoreBreakdown: breakdown(), situations: [situation(), situation({ id: 'cyber-pressure', severity: 'medium', confidence: 0.6, title: 'Pression cyber' })] },
      'fr',
      -2,
    );
    assert.equal(brief.origin, 'deterministic');
    assert.ok(brief.bluf.includes('61/100'));
    assert.ok(brief.bluf.includes('−2') || brief.bluf.includes('-2'));
    // priorité ← sévérité : high → P2, medium → P3
    assert.equal(brief.judgments[0].priority, 2);
    assert.equal(brief.judgments[1].priority, 3);
    // confiance mappée : 0.8 → high, 0.6 → moderate
    assert.equal(brief.judgments[0].confidence, 'high');
    assert.equal(brief.judgments[1].confidence, 'moderate');
    // watch depuis les actions monitor
    assert.ok(brief.watch.length >= 1);
    assert.equal(brief.watch[0].horizon, '24h');
  });

  it('sans situation : jugement P4 « pression diffuse » et watch par défaut', () => {
    const brief = buildDeterministicBrief(
      { score: 91, scoreBreakdown: { ...breakdown(), score: 91, situationCap: null }, situations: [] },
      'fr',
      null,
    );
    assert.equal(brief.judgments.length, 1);
    assert.equal(brief.judgments[0].priority, 4);
    assert.equal(brief.watch.length, 1);
  });
});

describe('compactSituations', () => {
  it('borne à 5 situations et tronque les champs', () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      situation({ id: `s${i}`, title: 't'.repeat(300), drivers: Array.from({ length: 9 }, () => 'd'.repeat(300)) }));
    const compact = compactSituations(many);
    assert.equal(compact.length, 5);
    assert.ok(compact[0].title.length <= 120);
    assert.equal(compact[0].drivers.length, 5);
    assert.ok(compact[0].drivers[0].length <= 160);
  });
});
