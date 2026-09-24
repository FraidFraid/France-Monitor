import { describe, it, expect } from 'vitest';
import { isScoreText, splitScoreLines, splitScoreSentences, splitZoneScore } from './situation-text.ts';

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
