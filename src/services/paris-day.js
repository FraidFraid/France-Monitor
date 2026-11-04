// src/services/paris-day.js : jour de Paris AAAA-MM-JJ d'un instant (04/11/2026). Seule implémentation, partagée par le client
// (src/services/upcoming.ts la réexporte), le registre, le moteur et l'agenda d'anticipation.
const PARIS_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * Jour de Paris « AAAA-MM-JJ » de l'instant donné (heure d'été et d'hiver gérées par Intl).
 * @param {number} ms
 * @returns {string}
 */
export function parisDay(ms) {
  return PARIS_DAY.format(new Date(ms));
}
