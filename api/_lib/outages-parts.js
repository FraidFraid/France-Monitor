// api/_lib/outages-parts.js : cadence et garde par partie, communes aux collecteurs des panneaux Pannes réseau (Électricité, Internet, Cloud).
// Une partie (une source ou un fournisseur) est relue quand elle est due, d'après l'heure de sa dernière lecture RÉUSSIE ; en échec, elle
// garde ses dernières données, nomme son erreur et est retentée après 5 min. Module neutre : aucun collecteur n'importe un autre.

const MINUTE_MS = 60_000;
export const RETRY_MS = 5 * MINUTE_MS;

/**
 * Une partie est due si elle n'a jamais été lue, si sa dernière lecture RÉUSSIE date de l'intervalle (1 min de tolérance), ou 5 min
 * après un échec (un échec n'avance jamais la date de lecture).
 */
export function partDue(part, interval, now) {
  if (!part) return true;
  const failed = part.failedAt ? Date.parse(part.failedAt) : Number.NaN;
  if (Number.isFinite(failed)) return now - failed >= RETRY_MS;
  const read = part.readAt ? Date.parse(part.readAt) : Number.NaN;
  return !Number.isFinite(read) || now - read >= interval - MINUTE_MS;
}

/** Partie après une tentative : réussie (lecture avancée, erreur effacée) ou en échec (données gardées, `failedAt` posé, `readAt` inchangé). */
export function succeeded(data, attemptedAt) {
  return { ...data, readAt: attemptedAt, failedAt: null, error: null };
}
export function failed(previous, empty, message, attemptedAt) {
  return { ...(previous ?? empty), failedAt: attemptedAt, error: message };
}
