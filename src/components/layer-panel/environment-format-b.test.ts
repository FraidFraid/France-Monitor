// src/components/layer-panel/environment-format-b.test.ts
// Formats et couleurs de la phase B (contrats § 3.7, arbitrage 5) ; jeton --cat-secheresse-vigilance (R2).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NBSP } from './format.ts';
import {
  AIR_INDEX_WORD, AIR_STATE_WORD, CAT_SECHERESSE_VIGILANCE, DROUGHT_LEVEL, DROUGHT_WORD, QUAKE_DISPLAY_MIN, airIndexLevel, dayLong, dayMonthClock,
  formatMagnitude, quakeLevel, quakePlace,
} from './environment-format.ts';

describe('sécheresse', () => {
  it('mots VigiEau et couleurs : la vigilance prend une teinte de catégorie, jamais une couleur de niveau', () => {
    expect(DROUGHT_WORD).toEqual({ vigilance: 'vigilance', alerte: 'alerte', alerte_renforcee: 'alerte renforcée', crise: 'crise' });
    expect(DROUGHT_LEVEL).toEqual({ vigilance: 'categorie', alerte: 'jaune', alerte_renforcee: 'orange', crise: 'rouge' });
    expect(CAT_SECHERESSE_VIGILANCE).toBe('var(--cat-secheresse-vigilance)');
  });
  it('jeton défini dans :root (#7fb3d5)', () => {
    const css = readFileSync(new URL('../../styles/main.css', import.meta.url), 'utf8');
    expect(css).toMatch(/:root \{[^}]*--cat-secheresse-vigilance: #7fb3d5;/);
  });
});

describe('qualité de l’air', () => {
  it('indice ATMO : 1 et 2 vert, 3 jaune, 4 orange, 5 et plus rouge (amendement 5) ; mots de l’échelle', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(airIndexLevel)).toEqual(['vert', 'vert', 'jaune', 'orange', 'rouge', 'rouge', 'rouge']);
    expect([AIR_INDEX_WORD[2], AIR_INDEX_WORD[3], AIR_INDEX_WORD[4], AIR_INDEX_WORD[6]]).toEqual(['moyen', 'dégradé', 'mauvais', 'extrêmement mauvais']);
    expect(AIR_STATE_WORD).toEqual({ information: 'information-recommandation', alerte: 'alerte', inconnu: 'état non reconnu' });
  });
});

describe('séismes', () => {
  it('magnitude « M 4,2 » sur une ligne ; n.d. sans valeur', () => {
    expect(formatMagnitude(4.2)).toBe(`M${NBSP}4,2`);
    expect(formatMagnitude(2.495)).toBe(`M${NBSP}2,5`);
    expect(formatMagnitude(null)).toBe('n.d.');
  });
  it('couleurs : 5 rouge, 4 orange, 3 jaune, 2,5 vert, plus faible gris (seuil d’affichage)', () => {
    expect(QUAKE_DISPLAY_MIN).toBe(2.5);
    expect([5.1, 4.3, 3, 2.5, 2.49, 1].map(quakeLevel)).toEqual(['rouge', 'orange', 'jaune', 'vert', 'gris', 'gris']);
    expect(quakePlace({ description: 'Évènement de magnitude 1.2, proche de Turin' })).toBe('proche de Turin');
  });
});

describe('dates de Paris', () => {
  it('« 6 octobre » (jour civil) et « 4 octobre 02:43 » (arrêtés VigiEau de 00:43 UTC)', () => {
    expect(dayLong('2026-10-06')).toBe('6 octobre');
    expect(dayLong('pas une date')).toBe('n.d.');
    expect(dayMonthClock('2026-10-04T00:43:59.771Z')).toBe('4 octobre 02:43');
    expect(dayMonthClock('2026-12-04T00:43:59.771Z')).toBe('4 décembre 01:43');
    expect(dayMonthClock(null)).toBe('n.d.');
  });
});
