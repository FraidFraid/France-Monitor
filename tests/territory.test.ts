// tests/territory.test.ts : périmètre V2 « au-dessus de la France » (spec 2026-10-04 souveraineté V2 ; contrats, arbitrage 5) :
// département métropolitain, ou eaux françaises à moins de 22 km de la côte ; jamais une frontière terrestre élargie.
import { describe, expect, it } from 'vitest';
import { FRANCE_SEA_MARGIN_KM, inFranceV2, nearFrance } from '../api/_lib/territory.js';
import { distanceToMetropoleKm } from '../api/_lib/geo-fr.js';

describe('inFranceV2', () => {
  it('Genève : hors de France, bien qu’à 4,4 km de la frontière', () => {
    expect(distanceToMetropoleKm(46.204, 6.143, 40)).toBeCloseTo(4.4, 1);
    expect(inFranceV2(46.204, 6.143)).toBe(false);
  });
  it('Solent (Manche, côté anglais) : hors de France', () => {
    expect(inFranceV2(50.78, -1.1)).toBe(false);
  });
  it('en mer à 7,7 km de Marseille : en France, sans département', () => {
    expect(distanceToMetropoleKm(43.2, 5.25, 40)).toBeCloseTo(7.7, 1);
    expect(inFranceV2(43.2, 5.25)).toBe(true);
  });
  it('au large au-delà de 22 km : hors de France ; sur le territoire : en France', () => {
    expect(FRANCE_SEA_MARGIN_KM).toBe(22);
    expect(inFranceV2(42.9, 5.25)).toBe(false);
    expect(inFranceV2(45.718826, 4.944384)).toBe(true);   // FICTIF04 au-dessus du Rhône
    expect(inFranceV2(43.381472, -0.468554)).toBe(true);  // A400 belge au-dessus des Pyrénées-Atlantiques
  });
  it('frontière franco-italienne de Menton : terre italienne hors de France ; baie de Menton en France (signalé par A3)', () => {
    expect(inFranceV2(43.79, 7.542)).toBe(false);    // Grimaldi (Vintimille), à 1 km de la frontière
    expect(inFranceV2(44.17, 7.40)).toBe(false);     // vallée de la Gesso, au nord du Mercantour
    expect(inFranceV2(43.76, 7.50)).toBe(true);      // en mer au large de Menton
  });
  it('coordonnées illisibles : hors de France', () => {
    expect(inFranceV2(Number.NaN, 2)).toBe(false);
  });
});

describe('nearFrance (approches des urgences, 40 km)', () => {
  it('Genève est dans les approches ; Bruxelles non ; le Solent non', () => {
    expect(nearFrance(46.204, 6.143, 40)).toBe(true);
    expect(nearFrance(50.85, 4.35, 40)).toBe(false);
    expect(nearFrance(50.78, -1.1, 40)).toBe(false);
  });
});
