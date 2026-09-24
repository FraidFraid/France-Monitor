import { describe, it, expect } from 'vitest';
import { isScoreText, splitScoreLines, splitScoreSentences } from './situation-text.ts';

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
