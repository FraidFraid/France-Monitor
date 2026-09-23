// tests/jev-policy.test.ts
// Tests de la politique pure de combinaison Jev + repli mots-clés
// (api/_lib/jev-policy.js). Aucun appel réseau : fixtures de réponses
// System One construites à la main, au format exact de l'API TypeSafe
// (cf. docs.typesafe.ai/api.md — noul/choice/score answers).

import { describe, it, expect } from 'vitest';
// @ts-expect-error — module JS sans déclaration de types
import { derive, SEV, CATEGORY_MAP } from '../api/_lib/jev-policy.js';
// @ts-expect-error — module JS sans déclaration de types
import { QUESTIONS, RELEVANCE_LEVELS, SEVERITY_LEVELS } from '../api/_lib/jev-questions.js';

const KW_NEUTRAL = { category: 'general', severity: 'info', confidence: 0.2 };

function noul(value: number) {
  return { type: 'noul', noul: value };
}

function score(value: number, confidence: number) {
  return { type: 'score', score: value, confidence, probabilities: {}, legend: {} };
}

function choice(value: string, confidence: number) {
  return { type: 'choice', choice: value, confidence, probabilities: {} };
}

/** Réponses "neutres" par défaut, à surcharger par cas de test. */
function baseAnswers(overrides: Record<string, unknown> = {}) {
  return {
    relevance: score(0, 0.9),
    category: choice('other', 0.9),
    severity: score(0, 0.9),
    in_france: noul(0.05),
    ongoing: noul(0.05),
    institution_involved: noul(0.05),
    isolated_fait_divers: noul(0.5),
    scope: choice('unknown', 0.9),
    infrastructure_type: choice('none', 0.9),
    ...overrides,
  };
}

describe('jev-policy · cohérence avec jev-questions', () => {
  it('SEV et les critères severity ont le même nombre de niveaux', () => {
    expect(SEV.length).toBe(SEVERITY_LEVELS);
    expect(QUESTIONS.severity.criteria.length).toBe(SEVERITY_LEVELS);
  });

  it('les critères relevance ont RELEVANCE_LEVELS niveaux', () => {
    expect(QUESTIONS.relevance.criteria.length).toBe(RELEVANCE_LEVELS);
  });
});

describe('jev-policy · cas « Lady Di » (bruit, hors sujet)', () => {
  it('livre de Charles Spencer sur Lady Di → bruit, catégorie repliée sur mots-clés', () => {
    const answers = baseAnswers({
      relevance: score(0, 0.9), // niveau 0/3 = "Not useful"
      category: choice('other', 0.85),
      severity: score(0, 0.9),
      in_france: noul(0.03),
      ongoing: noul(0.1),
      isolated_fait_divers: noul(0.4),
    });
    const result = derive(answers, KW_NEUTRAL);

    expect(result.relevance).toBe(0);
    expect(result.noise).toBe(true);
    expect(result.alertable).toBe(false);
    // category='other' n'a pas de mapping → repli mots-clés
    expect(result.category).toBe(KW_NEUTRAL.category);
    // confidence severity haute → niveau Jev conservé (info)
    expect(result.severity).toBe('info');
  });
});

describe('jev-policy · alerte légitime', () => {
  it('menace sérieuse en cours, en France, institution impliquée → alertable', () => {
    const answers = baseAnswers({
      relevance: score(3, 0.9), // niveau max → relevance 1.0
      category: choice('security', 0.85),
      severity: score(3, 0.9), // "high"
      in_france: noul(0.95),
      ongoing: noul(0.9),
      institution_involved: noul(0.8),
      isolated_fait_divers: noul(0.05),
      scope: choice('region', 0.8),
    });
    const result = derive(answers, KW_NEUTRAL);

    expect(result.relevance).toBe(1);
    expect(result.noise).toBe(false);
    expect(result.category).toBe('security');
    expect(result.severity).toBe('high');
    expect(result.alertable).toBe(true);
    expect(result.scope).toBe('region');
  });

  it('projet déjoué (ongoing bas) → grave mais pas alertable', () => {
    // Cas §4.4 de l'audit : "attentat avorté" — France, institution, gravité
    // élevée, mais l'action est terminée (déjouée) → ongoing bas.
    const answers = baseAnswers({
      relevance: score(3, 0.9),
      category: choice('security', 0.85),
      severity: score(3, 0.9),
      in_france: noul(0.9),
      ongoing: noul(0.3), // sous le seuil de 0.6
      institution_involved: noul(0.9),
      isolated_fait_divers: noul(0.1),
    });
    const result = derive(answers, KW_NEUTRAL);

    expect(result.noise).toBe(false);
    expect(result.severity).toBe('high');
    expect(result.alertable).toBe(false);
  });

  it('gravité maximale sans institution nommée → alertable quand même', () => {
    const answers = baseAnswers({
      relevance: score(3, 0.9),
      category: choice('energy', 0.85),
      severity: score(4, 0.9), // "critical", sevIdx = SEVERITY_MAX_INDEX
      in_france: noul(0.9),
      ongoing: noul(0.9),
      institution_involved: noul(0.1), // sous le seuil de 0.5
      isolated_fait_divers: noul(0.05),
    });
    const result = derive(answers, KW_NEUTRAL);

    expect(result.severity).toBe('critical');
    expect(result.alertable).toBe(true); // sevIdx === SEVERITY_MAX_INDEX dispense d'institution
  });
});

describe('jev-policy · repli sur confiance basse', () => {
  it('severity peu sûre → repli sur la sévérité mots-clés', () => {
    const kw = { category: 'social', severity: 'medium', confidence: 0.5 };
    const answers = baseAnswers({
      severity: score(4, 0.3), // "critical" mais confiance < 0.6
    });
    const result = derive(answers, kw);
    expect(result.severity).toBe('medium');
  });

  it('category peu sûre → repli sur la catégorie mots-clés (même si choice valide)', () => {
    const kw = { category: 'transport', severity: 'low', confidence: 0.5 };
    const answers = baseAnswers({
      category: choice('security', 0.3), // choix valide mais confiance < 0.5
    });
    const result = derive(answers, kw);
    expect(result.category).toBe('transport');
  });
});

describe('jev-policy · mapping des catégories', () => {
  it('defense se replie sur security', () => {
    const answers = baseAnswers({ category: choice('defense', 0.9) });
    const result = derive(answers, KW_NEUTRAL);
    expect(result.category).toBe('security');
  });

  it('toutes les catégories mappées sont des valeurs EventCategory connues', () => {
    const known = new Set([
      'social', 'security', 'energy', 'weather', 'transport', 'infrastructure',
      'health', 'general', 'finance', 'floods', 'fires', 'cyber',
    ]);
    for (const mapped of Object.values(CATEGORY_MAP) as string[]) {
      expect(known.has(mapped)).toBe(true);
    }
  });
});

describe('jev-policy · noise', () => {
  it('hors France seul suffit à déclencher le bruit', () => {
    const answers = baseAnswers({
      relevance: score(3, 0.9),
      in_france: noul(0.1),
      isolated_fait_divers: noul(0.1),
    });
    expect(derive(answers, KW_NEUTRAL).noise).toBe(true);
  });

  it('fait divers isolé seul suffit à déclencher le bruit', () => {
    const answers = baseAnswers({
      relevance: score(3, 0.9),
      in_france: noul(0.9),
      isolated_fait_divers: noul(0.9),
    });
    expect(derive(answers, KW_NEUTRAL).noise).toBe(true);
  });

  it('France + pertinent + pas isolé → pas de bruit', () => {
    const answers = baseAnswers({
      relevance: score(2, 0.9),
      in_france: noul(0.9),
      isolated_fait_divers: noul(0.1),
    });
    expect(derive(answers, KW_NEUTRAL).noise).toBe(false);
  });
});

describe('jev-policy · rank', () => {
  it('rank croît avec la pertinence, la gravité, ongoing et in_france', () => {
    const low = derive(
      baseAnswers({ relevance: score(0, 0.9), severity: score(0, 0.9), in_france: noul(0.9), isolated_fait_divers: noul(0) }),
      KW_NEUTRAL,
    );
    const high = derive(
      baseAnswers({
        relevance: score(3, 0.9),
        severity: score(4, 0.9),
        ongoing: noul(0.9),
        in_france: noul(0.9),
        isolated_fait_divers: noul(0),
      }),
      KW_NEUTRAL,
    );
    expect(high.rank).toBeGreaterThan(low.rank);
    expect(high.rank).toBeLessThanOrEqual(1);
    expect(low.rank).toBeGreaterThanOrEqual(0);
  });
});
