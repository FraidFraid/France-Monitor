import { describe, it, expect } from 'vitest';
import { renderScoreCard, renderSituationRow, scoreDriverText } from './france-intel-score.ts';
import type { DetectedSituation, FranceScoreBreakdown } from '../types/index.ts';

function breakdown(score = 43): FranceScoreBreakdown {
  return {
    score,
    baseline: 95,
    pillars: [
      { key: 'continuity', value: 61, deduction: 18.9, components: [{ label: 'Carburants & pétrole', value: 100 }, { label: 'Pression électrique', value: 75 }] },
      { key: 'security', value: 57, deduction: 14.7, components: [] },
      { key: 'signal', value: 28, deduction: 3.4, components: [] },
      { key: 'defense', value: 65, deduction: 8.8, components: [] },
    ],
    shockValue: 55,
    shockExtra: 1.3,
    situationCap: 55,
  };
}

function situation(over: Partial<DetectedSituation> = {}): DetectedSituation {
  return {
    id: 'energy-stress',
    type: 'ENERGY_STRESS',
    severity: 'critical',
    confidence: 0.95,
    title: 'Tension énergétique nationale',
    summary: 'Signal Écowatt orange confirmé.',
    affectedZones: ['AURA'],
    drivers: ['Écowatt orange — 2 régions'],
    recommendedActions: [{ label: 'Surveiller Écowatt J+1', ownerHint: 'Analyste', actionType: 'monitor' }],
    sourceRefs: ['Écowatt RTE'],
    updatedAt: new Date(0),
    ...over,
  };
}

const base = { delta24h: -4, pillarDeltas: null, series: [81, 70, 43], lang: 'fr' as const, whyOpen: false };

describe('renderScoreCard', () => {
  it('affiche le niveau en mot et en couleur, le nombre seulement dans « Pourquoi ce niveau ? »', () => {
    const html = renderScoreCard({ ...base, breakdown: breakdown(43) });
    const visible = html.slice(0, html.indexOf('<details'));
    expect(visible).toContain('<span class="fm-vig fm-vig--rouge">Rouge</span>');
    expect(visible).toContain('vigilance absolue');
    expect(visible).toContain('tirée par Carburants &amp; pétrole, Pression électrique');
    expect(visible).toContain('en dégradation sur 24 h');
    expect(visible).not.toContain('43');
    expect(html).toContain('Indice de stabilité 43/100');
    expect(html).toContain('Indice plafonné à 55');
  });

  it('garde le volet ouvert quand il l’était (le tiroir est reconstruit en continu)', () => {
    expect(renderScoreCard({ ...base, breakdown: breakdown(), whyOpen: false })).toContain('<details class="frintel-why">');
    expect(renderScoreCard({ ...base, breakdown: breakdown(), whyOpen: true })).toContain('<details class="frintel-why" open>');
  });

  it('passe en anglais avec la bascule EN', () => {
    const html = renderScoreCard({ ...base, breakdown: breakdown(90), lang: 'en', delta24h: 2 });
    expect(html).toContain('>Green</span>');
    expect(html).toContain('no particular vigilance');
    expect(html).toContain('improving over 24 h');
    expect(html).toContain('Why this level?');
  });
});

describe('scoreDriverText', () => {
  it('dit « sans pression dominante » quand aucun pilier ne pèse', () => {
    const bd = breakdown(92);
    bd.pillars = bd.pillars.map((p) => ({ ...p, deduction: 0.4 }));
    expect(scoreDriverText(bd, 'fr')).toBe('sans pression dominante');
  });

  it('retombe sur le nom du pilier sans composante détaillée', () => {
    const bd = breakdown();
    bd.pillars = [{ key: 'security', value: 57, deduction: 14.7, components: [] }];
    expect(scoreDriverText(bd, 'fr')).toBe('tirée par sécurité');
  });
});

describe('renderSituationRow', () => {
  it('n’affiche aucun code du moteur, niveau et confiance en mots', () => {
    const html = renderSituationRow(situation(), 'fr', false);
    expect(html).not.toContain('SIT-');
    expect(html).not.toContain('ENERGY_STRESS');
    expect(html).not.toContain('CONF');
    expect(html).toContain('<span class="fm-vig fm-vig--rouge">Rouge</span>');
    expect(html).toContain('confiance élevée');
  });

  it('échappe le titre et l’identifiant, déplie le détail sur demande', () => {
    const html = renderSituationRow(situation({ id: 'x"y', title: '<img src=x onerror=alert(1)>' }), 'fr', true);
    expect(html).not.toContain('<img');
    expect(html).toContain('data-sit-id="x&quot;y"');
    expect(html).toContain('frintel-sit-detail');
    expect(html).toContain('Action : Surveiller Écowatt J+1');
  });
});
