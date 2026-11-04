// api/_shared/phenomenon-word.js : libellé par phénomène de vigilance Météo-France, pour le serveur (04/11/2026).
// Miroir de PHENOMENON_WORD de src/services/environment-levels.ts (le serveur tourne en Node sans TypeScript) ;
// tests/anticipation-room.test.ts vérifie que les deux tables restent égales.

/** @type {Readonly<Record<number, string>>} */
export const PHENOMENON_WORD = Object.freeze({
  1: 'vent violent', 2: 'pluie-inondation', 3: 'orages', 4: 'crues', 5: 'neige-verglas', 6: 'canicule', 7: 'grand froid', 8: 'avalanches',
  9: 'vagues-submersion',
});
