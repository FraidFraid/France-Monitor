import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { briefSituationIds, buildDeterministicBrief, compactSituations, parseStructuredBrief } from './france-intel-brief.ts';
import type { BriefEventInput, DetectedSituation, FranceScoreBreakdown } from '../types/index.ts';

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

  it('trie les jugements par priorité croissante même si les situations sont désordonnées', () => {
    const brief = buildDeterministicBrief(
      {
        score: 45,
        scoreBreakdown: breakdown(),
        situations: [
          situation({ id: 'weak-signal', severity: 'watch', confidence: 0.5, title: 'Signal faible' }),
          situation({ id: 'major-crisis', severity: 'critical', confidence: 0.9, title: 'Crise majeure' }),
        ],
      },
      'fr',
      null,
    );
    // watch → P4 fourni en premier, critical → P1 en second : le tri doit remettre P1 en tête
    assert.equal(brief.judgments[0].priority, 1);
    assert.equal(brief.judgments[brief.judgments.length - 1].priority, 4);
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

describe('brief v14 — preuves', () => {
  const bluf = 'Situation nationale sous tension, tirée par la continuité énergétique.';

  it('parseStructuredBrief conserve les preuves valides et le drapeau « non étayé » du serveur', () => {
    const brief = parseStructuredBrief({
      bluf,
      judgments: [
        { priority: 1, text: 'Étayé.', confidence: 'high', sources: ['Sud Ouest'], evidence: ['E42', 'S1', 'bogus'], unsupported: false },
        { priority: 2, text: 'Sans preuve.', confidence: 'low', sources: [], evidence: [], unsupported: true },
      ],
      watch: [],
    }, 'llm');
    assert.ok(brief);
    assert.deepEqual(brief.judgments[0].evidence, ['E42', 'S1']);
    assert.equal(brief.judgments[1].unsupported, true);
  });

  it('buildDeterministicBrief cite S1… puis complète avec les événements corroborés', () => {
    const events: BriefEventInput[] = [
      { id: 'E7', title: 'Explosion dans une usine chimique', category: 'security', severity: 'critical', sources: ['France Info', 'Le Monde'], sourceCount: 2, independentCount: 2, lastSeen: '2026-09-23T06:00:00Z', status: 'active' },
      { id: 'E8', title: 'Fait divers mono-source', category: 'security', severity: 'high', sources: ['Le Progrès'], sourceCount: 1, independentCount: 1, lastSeen: '2026-09-23T06:00:00Z', status: 'active' },
    ];
    const brief = buildDeterministicBrief({ score: 61, scoreBreakdown: breakdown(), situations: [situation()] }, 'fr', null, events);
    assert.deepEqual(brief.judgments.map((j) => j.evidence), [['E7'], ['S1']]);
    assert.equal(brief.judgments[0].priority, 1);
    assert.equal(brief.judgments[0].confidence, 'low');
    assert.ok(brief.judgments.every((j) => !j.unsupported));
  });
});

describe('briefSituationIds (relecture finale #3)', () => {
  it('suit la numérotation S1…S5 de compactSituations', () => {
    const situations = Array.from({ length: 7 }, (_, i) => situation({ id: `sit-${i + 1}`, title: `Situation ${i + 1}` }));
    const ids = briefSituationIds(situations);
    assert.deepEqual(ids, ['sit-1', 'sit-2', 'sit-3', 'sit-4', 'sit-5']);
    assert.equal(ids.length, compactSituations(situations).length);
  });
});
