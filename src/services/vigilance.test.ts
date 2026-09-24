import { describe, it, expect } from 'vitest';
import {
  briefConfidenceLabel,
  confidenceBand,
  confidenceLabel,
  eventLevel,
  fuelTensionLevel,
  infraStatusLevel,
  levelColorVar,
  levelHex,
  levelLabel,
  levelPhrase,
  levelVigilanceWord,
  marketBarometer,
  marketTone,
  maxLevel,
  officialLevel,
  scoreLevel,
  situationLevel,
} from './vigilance.ts';
import { renderVigilancePill } from '../components/shared/vigilancePill.ts';

describe('scoreLevel (seuils du score v3 85/70/55)', () => {
  it('convertit l\'indice national aux bornes exactes', () => {
    expect(scoreLevel(100)).toBe('vert');
    expect(scoreLevel(85)).toBe('vert');
    expect(scoreLevel(84)).toBe('jaune');
    expect(scoreLevel(70)).toBe('jaune');
    expect(scoreLevel(69)).toBe('orange');
    expect(scoreLevel(55)).toBe('orange');
    expect(scoreLevel(54)).toBe('rouge');
    expect(scoreLevel(0)).toBe('rouge');
  });

  it('ne rassure jamais sur une donnée manquante', () => {
    expect(scoreLevel(Number.NaN)).toBe('jaune');
    expect(scoreLevel(Number.POSITIVE_INFINITY)).toBe('jaune');
  });
});

describe('conversions', () => {
  it('situations du moteur', () => {
    expect(situationLevel('critical')).toBe('rouge');
    expect(situationLevel('high')).toBe('orange');
    expect(situationLevel('medium')).toBe('jaune');
    expect(situationLevel('watch')).toBe('jaune');
  });

  it('événements consolidés', () => {
    expect(eventLevel('critical')).toBe('rouge');
    expect(eventLevel('high')).toBe('orange');
    expect(eventLevel('medium')).toBe('jaune');
    expect(eventLevel('low')).toBe('vert');
    expect(eventLevel('info')).toBe('vert');
  });

  it('signaux officiels, violet Météo compris', () => {
    expect(officialLevel('green')).toBe('vert');
    expect(officialLevel('yellow')).toBe('jaune');
    expect(officialLevel('orange')).toBe('orange');
    expect(officialLevel('red')).toBe('rouge');
    expect(officialLevel('violet')).toBe('rouge');
  });

  it('baromètre des infrastructures', () => {
    expect(infraStatusLevel('nominal')).toBe('vert');
    expect(infraStatusLevel('degraded')).toBe('jaune');
    expect(infraStatusLevel('critical')).toBe('rouge');
  });

  it('maxLevel garde le plus grave, vert sur une liste vide', () => {
    expect(maxLevel(['jaune', 'rouge', 'orange'])).toBe('rouge');
    expect(maxLevel([])).toBe('vert');
  });

  it('tension carburants (FuelTensionLevel, relecture finale F5)', () => {
    expect(fuelTensionLevel('LOW')).toBe('vert');
    expect(fuelTensionLevel('MEDIUM')).toBe('jaune');
    expect(fuelTensionLevel('HIGH')).toBe('orange');
    expect(fuelTensionLevel('CRITICAL')).toBe('rouge');
  });
});

describe('libellés', () => {
  it('mots, phrases officielles et vigilance, en français et en anglais', () => {
    expect(levelLabel('rouge')).toBe('Rouge');
    expect(levelLabel('jaune', 'en')).toBe('Yellow');
    expect(levelPhrase('vert')).toBe('pas de vigilance particulière');
    expect(levelPhrase('rouge')).toBe('vigilance absolue');
    expect(levelPhrase('orange', 'en')).toBe('be very vigilant');
    expect(levelVigilanceWord('orange')).toBe('vigilance orange');
    expect(levelVigilanceWord('vert')).toBe('vigilance verte');
    expect(levelVigilanceWord('rouge', 'en')).toBe('red vigilance');
  });

  it('couleurs : jetons CSS et hexadécimaux officiels', () => {
    expect(levelColorVar('rouge')).toBe('var(--sev-red)');
    expect(levelColorVar('vert')).toBe('var(--sev-green)');
    expect(levelHex('jaune')).toBe('#ffcc00');
    expect(levelHex('rouge')).toBe('#ff3b30');
  });

  it('confiance en mots, seuils 0,75 et 0,55', () => {
    expect(confidenceBand(0.75)).toBe('high');
    expect(confidenceBand(0.74)).toBe('moderate');
    expect(confidenceBand(0.55)).toBe('moderate');
    expect(confidenceBand(0.54)).toBe('low');
    expect(confidenceLabel(0.93)).toBe('confiance élevée');
    expect(confidenceLabel(0.6, 'en')).toBe('moderate confidence');
    expect(briefConfidenceLabel('low')).toBe('confiance faible');
  });
});

describe('renderVigilancePill', () => {
  it('affiche le mot dans une pastille de la couleur du niveau', () => {
    expect(renderVigilancePill('rouge')).toBe('<span class="fm-vig fm-vig--rouge">Rouge</span>');
    expect(renderVigilancePill('vert', 'en')).toBe('<span class="fm-vig fm-vig--vert">Green</span>');
  });
});

describe('marchés (spec §4.4)', () => {
  it('jaune au-delà de ±3 % pour un indice, ±5 % pour le pétrole ou le gaz', () => {
    expect(marketTone(-3, 'index')).toBe('alert');
    expect(marketTone(2.9, 'index')).toBe('neutral');
    expect(marketTone(5.1, 'energy')).toBe('alert');
    expect(marketTone(-4.9, 'energy')).toBe('neutral');
  });

  it('jamais coloré pour les autres lignes ni pour une variation manquante', () => {
    expect(marketTone(12, 'other')).toBe('neutral');
    expect(marketTone(Number.NaN, 'index')).toBe('neutral');
  });

  it('baromètre : neutre en temps normal, exceptionnel au-delà d\'un seuil', () => {
    expect(marketBarometer([{ name: 'CAC 40', changePercent: -0.31, kind: 'index' }, { name: 'DAX', changePercent: -0.13, kind: 'index' }]))
      .toEqual({ tone: 'neutral', text: 'Variation moyenne : −0,22 %' });
    expect(marketBarometer([{ name: 'CAC 40', changePercent: -3.42, kind: 'index' }, { name: 'DAX', changePercent: 0.1, kind: 'index' }]))
      .toEqual({ tone: 'alert', text: 'Mouvement exceptionnel : CAC 40 −3,42 %' });
    expect(marketBarometer([])).toEqual({ tone: 'neutral', text: 'Marchés : données indisponibles' });
  });
});
