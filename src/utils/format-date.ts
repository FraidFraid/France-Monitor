/**
 * format-date.ts — Parsing robuste des dates RTE / éCO2mix.
 *
 * Formats rencontrés dans les APIs :
 *   "2026-03-15 08:30:00"        (espace — non standard, rejeté par Safari)
 *   "2026-03-15T08:30:00"        (ISO sans fuseau)
 *   "2026-03-15T08:30:00+01:00"  (ISO avec offset)
 *   "2026-03-15T08:30:00Z"       (ISO UTC)
 *   1710494200000                (timestamp ms)
 */

/**
 * Parse une valeur date brute issue d'une API RTE/éCO2mix.
 * Retourne un Date valide, ou null si la valeur est invalide.
 */
export function parseApiDate(raw: string | number | Date | null | undefined): Date | null {
  if (raw == null) return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === 'number') {
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }

  // Normalise "YYYY-MM-DD HH:mm:ss" → "YYYY-MM-DDTHH:mm:ss" (ISO compatible)
  const normalized = raw.trim().replace(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/, '$1T$2');
  const d = new Date(normalized);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Formate une date pour le champ "Mis à jour" des tooltips.
 *
 * @returns "HH:mm" si valide, "-" sinon (jamais "Invalid Date")
 */
export function formatUpdateTime(raw: string | number | Date | null | undefined): string {
  const d = parseApiDate(raw);
  if (!d) return '-';
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Formate une date complète courte : "15/03 08:45"
 * Utile si on veut afficher jour + heure dans un tooltip.
 */
export function formatUpdateDateTime(raw: string | number | Date | null | undefined): string {
  const d = parseApiDate(raw);
  if (!d) return '-';
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}
