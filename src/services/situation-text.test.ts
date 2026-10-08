import { describe, it, expect } from 'vitest';
import { statusWordLevel, parseScoreLine, isScoreText, splitScoreLines, splitScoreSentences, splitZoneScore } from './situation-text.ts';

describe('sous-scores du moteur (refonte UI étape 2, arbitrage A7)', () => {
  it('reconnaît un sous-score « x/y », pas un pourcentage ni une puissance', () => {
    expect(isScoreText('Score cyber consolidé : 63/100 (tendance stable)')).toBe(true);
    expect(isScoreText('Ransomware : 25/25')).toBe(true);
    expect(isScoreText('Parc nucléaire dégradé (ratio 85%)')).toBe(false);
    expect(isScoreText('Import net actuel : +2300 MW')).toBe(false);
  });

  it('sépare les facteurs en clair des sous-scores', () => {
    expect(splitScoreLines(['Score cyber consolidé : 63/100', '2 alerte(s) critique(s) CERT-FR', 'Fuites : 10/20'])).toEqual({
      plain: ['2 alerte(s) critique(s) CERT-FR'],
      scored: ['Score cyber consolidé : 63/100', 'Fuites : 10/20'],
    });
  });

  it('coupe un résumé en phrases et range les phrases chiffrées à part', () => {
    expect(splitScoreSentences('3 département(s) avec tensions. Score national ISNR : 41/100.')).toEqual({
      plain: ['3 département(s) avec tensions.'],
      scored: ['Score national ISNR : 41/100.'],
    });
    expect(splitScoreSentences('')).toEqual({ plain: [], scored: [] });
  });
});

describe('zones du moteur « Nom (n/m) » (relecture finale I4, arbitrage A7)', () => {
  it('sépare le nom de la zone de son sous-score', () => {
    expect(splitZoneScore('Seine-Saint-Denis (72/100)')).toEqual({ name: 'Seine-Saint-Denis', score: '72/100' });
    expect(splitZoneScore('Bouches-du-Rhône (66/100)')).toEqual({ name: 'Bouches-du-Rhône', score: '66/100' });
  });

  it('une zone sans sous-score reste telle quelle', () => {
    expect(splitZoneScore('Bretagne')).toEqual({ name: 'Bretagne', score: null });
    expect(splitZoneScore('Zone aérienne (France)')).toEqual({ name: 'Zone aérienne (France)', score: null });
  });
});

describe('lignes chiffrées du moteur (spec 2026-10-01 fiches § 4.2)', () => {
  it('« libellé : n/m »', () => {
    expect(parseScoreLine('Ransomware : 25/25')).toEqual({ label: 'Ransomware', value: 25, max: 25, display: '25/25', note: null });
  });
  it('note entre parenthèses conservée', () => {
    expect(parseScoreLine('Score cyber consolidé : 65/100 (tendance stable)'))
      .toEqual({ label: 'Score cyber consolidé', value: 65, max: 100, display: '65/100', note: 'tendance stable' });
    expect(parseScoreLine('Vigilance stocks pétroliers : sous tension (score 49/100)'))
      .toEqual({ label: 'Vigilance stocks pétroliers', value: 49, max: 100, display: '49/100', note: 'sous tension' });
  });
  it('fraction décimale à la française', () => {
    expect(parseScoreLine('Indice : 3,5/10')).toEqual({ label: 'Indice', value: 3.5, max: 10, display: '3,5/10', note: null });
  });
  it('phrase sans « libellé : » ou sans fraction : null', () => {
    expect(parseScoreLine('Baromètre cyber consolidé à 65/100, dominé par ransomware.')).toBeNull();
    expect(parseScoreLine('Tension carburant : critique')).toBeNull();
  });
});

describe('ponctuation finale et mot de statut', () => {
  it('une phrase de synthèse ne laisse pas de « . » en note', () => {
    expect(parseScoreLine('Score national ISNR : 42/100.')).toEqual({ label: 'Score national ISNR', value: 42, max: 100, display: '42/100', note: null });
    expect(parseScoreLine('Indice : 3/10 (stable) ;')?.note).toBe('stable');
  });
  it('statusWordLevel : mots de statut, casse et accents indifférents', () => {
    expect(statusWordLevel('critiques')).toBe('rouge');
    expect(statusWordLevel('Sous tension')).toBe('orange');
    expect(statusWordLevel('tendue')).toBe('orange');
    expect(statusWordLevel('FORTE')).toBe('orange');
    expect(statusWordLevel('élevés')).toBe('orange');
    expect(statusWordLevel('Modérée')).toBe('jaune');
    expect(statusWordLevel('normaux')).toBe('vert');
    expect(statusWordLevel('faible')).toBe('vert');
    expect(statusWordLevel('tendance stable')).toBeNull();
    expect(statusWordLevel(null)).toBeNull();
  });
});
