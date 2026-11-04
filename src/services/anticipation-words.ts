/**
 * anticipation-words.ts : échelle de probabilité de l'anticipation (04/11/2026).
 * Miroir de api/_lib/anticipation/probability.js (le code navigateur n'importe jamais api/) ;
 * src/services/anticipation.test.ts vérifie que les deux tables restent identiques.
 */
import type { AnticipationWord } from '../types/index.ts';

/** Les sept mots, du moins au plus probable (ordre de l'échelle). */
export const ALL_WORDS: readonly AnticipationWord[] = [
  'chance_infime',
  'tres_peu_probable',
  'peu_probable',
  'possibilite_reelle',
  'probable',
  'tres_probable',
  'quasi_certain',
];

/** Seuls mots attribuables en v1. */
export const V1_WORDS: readonly AnticipationWord[] = ['peu_probable', 'possibilite_reelle', 'probable', 'tres_probable'];

export const WORD_LABEL: Readonly<Record<AnticipationWord, string>> = {
  chance_infime: 'chance infime',
  tres_peu_probable: 'très peu probable',
  peu_probable: 'peu probable',
  possibilite_reelle: 'possibilité réelle',
  probable: 'probable',
  tres_probable: 'très probable',
  quasi_certain: 'quasi certain',
};

/** Fourchettes en espaces insécables (échappés) : une valeur et son unité tiennent sur une ligne. */
export const WORD_RANGE: Readonly<Record<AnticipationWord, string>> = {
  chance_infime: '≤ 5 %',
  tres_peu_probable: '10 à 20 %',
  peu_probable: '25 à 35 %',
  possibilite_reelle: '40 à 50 %',
  probable: '55 à 75 %',
  tres_probable: '80 à 90 %',
  quasi_certain: '≥ 95 %',
};

/** Variable CSS de couleur par mot attribuable en v1 (les trois mots hors v1 n'ont pas de couleur propre). */
export const WORD_COLOR_VAR: Readonly<Partial<Record<AnticipationWord, string>>> = {
  tres_probable: '--sev-red',
  probable: '--sev-orange',
  possibilite_reelle: '--sev-yellow',
  peu_probable: '--sev-blue',
};
