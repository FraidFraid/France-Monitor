import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { pillarResponse, scoreFromPillars } from './france-country-intel.ts';
import type { SituationSeverity } from '../types/index.ts';

function sits(...severities: SituationSeverity[]): Array<{ severity: SituationSeverity }> {
  return severities.map((severity) => ({ severity }));
}

// Fixtures-contrat du §4.4 de la spec — toute retouche des constantes doit les faire passer.
describe('score v3 — calibration', () => {
  it('jour calme → 88–94', () => {
    const { score } = scoreFromPillars({ continuity: 12, security: 15, signal: 10, defense: 3, shock: 10 });
    assert.ok(score >= 88 && score <= 94, `score=${score}`);
  });

  it('journée chargée → 74–86', () => {
    const { score } = scoreFromPillars(
      { continuity: 30, security: 25, signal: 30, defense: 10, shock: 30 },
      sits('medium'),
    );
    assert.ok(score >= 74 && score <= 86, `score=${score}`);
  });

  it('tension réelle (1 situation high) → 58–72', () => {
    const { score } = scoreFromPillars(
      { continuity: 62, security: 41, signal: 33, defense: 18, shock: 55 },
      sits('high'),
    );
    assert.ok(score >= 58 && score <= 72, `score=${score}`);
  });

  it('crise (1 situation critical) → 38–55', () => {
    const { score } = scoreFromPillars(
      { continuity: 70, security: 65, signal: 40, defense: 30, shock: 75 },
      sits('critical'),
    );
    assert.ok(score >= 38 && score <= 55, `score=${score}`);
  });

  it('crise majeure (2 critical) → < 40', () => {
    const { score } = scoreFromPillars(
      { continuity: 85, security: 80, signal: 60, defense: 50, shock: 90 },
      sits('critical', 'critical'),
    );
    assert.ok(score < 40, `score=${score}`);
  });
});

describe('score v3 — vivacité', () => {
  it('deux jours calmes voisins donnent des scores distincts, écart ≤ 4', () => {
    const a = scoreFromPillars({ continuity: 10, security: 12, signal: 8, defense: 3, shock: 5 }).score;
    const b = scoreFromPillars({ continuity: 13, security: 14, signal: 11, defense: 5, shock: 8 }).score;
    assert.notEqual(a, b);
    assert.ok(Math.abs(a - b) <= 4, `a=${a} b=${b}`);
  });
});

describe('score v3 — plafonds situations', () => {
  it('1 critical plafonne à 55 même par temps calme', () => {
    const { score, situationCap } = scoreFromPillars(
      { continuity: 12, security: 15, signal: 10, defense: 3, shock: 10 },
      sits('critical'),
    );
    assert.equal(situationCap, 55);
    assert.equal(score, 55);
  });

  it('2 high plafonnent à 65 ; 1 high à 78', () => {
    const calm = { continuity: 12, security: 15, signal: 10, defense: 3, shock: 10 };
    assert.equal(scoreFromPillars(calm, sits('high', 'high')).score, 65);
    assert.equal(scoreFromPillars(calm, sits('high')).score, 78);
  });
});

describe('score v3 — lissage', () => {
  it('EMA 0,5 quand l’écart au score précédent est ≤ 15', () => {
    // brut calme = 92 (cf. calibration) ; précédent 84 → round(0.5×92 + 0.5×84) = 88
    const { score } = scoreFromPillars(
      { continuity: 12, security: 15, signal: 10, defense: 3, shock: 10 },
      [],
      84,
    );
    assert.equal(score, 88);
  });

  it('débrayé au-delà de 15 points d’écart (rupture immédiate)', () => {
    const { score } = scoreFromPillars(
      { continuity: 85, security: 80, signal: 60, defense: 50, shock: 90 },
      [],
      90,
    );
    assert.ok(score < 40, `score=${score}`);
  });
});

describe('score v3 — pillarResponse', () => {
  it('réponse progressive par morceaux', () => {
    assert.equal(pillarResponse(0), 0);
    assert.equal(pillarResponse(15), 3.75);          // 15 × 0,25
    assert.equal(pillarResponse(40), 3.75 + 25);     // + zone linéaire
    assert.equal(pillarResponse(50), 3.75 + 25 + 12); // + 10 × 1,2
  });
});
