// src/components/layer-panel/outages-format.ts : mots et formats partagés des panneaux Pannes réseau (R1 : une valeur sur une ligne).
// Couleurs de catégorie en jetons CSS (R12 : --cat-out-* définis dans main.css), jamais en hexadécimal ; les teintes MapLibre vivent
// dans la couche de carte, avec leur test d'égalité aux jetons.
import { parisDayOf } from '../../services/environment-levels.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { NBSP, dayMonth, frNumber, localClock } from './format.ts';
import { departementName } from './health-format.ts';

export { dayMonth } from './format.ts';

export const OUTAGES_THEME = 'Pannes réseau';
/** Panne imprévue de moins de 24 h, panne imprévue plus ancienne, maintenance (jetons de main.css). */
export const OUT_RECENT_VAR = 'var(--cat-out-recent)';
export const OUT_LONG_VAR = 'var(--cat-out-long)';
export const OUT_MAINT_VAR = 'var(--cat-out-maint)';
/** Teinte neutre de l'inventaire et des zones sans état publié (GCP, AWS) : jamais une couleur de niveau (P4, P5), comme la carte. */
export const OUT_REF_VAR = 'var(--cat-out-ref)';
/** Gris d'une donnée en retard : plus aucune couleur de catégorie ni de niveau. */
export const OUT_LATE_VAR = 'var(--text-muted)';
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const PARIS = 'Europe/Paris';

export function note(text: string): string {
  return `<p class="fmk-note">${escapeHtml(text)}</p>`;
}
export function plural(n: number, one: string, many: string): string {
  return n > 1 ? many : one;
}
/** « 18 antennes » : nombre et nom insécables. */
export function countText(n: number, one: string, many: string): string {
  return `${frNumber(n, 0)}${NBSP}${plural(n, one, many)}`;
}
export function placeOf(dept: string | null): string {
  return dept === null ? 'département non renseigné' : `${departementName(dept)} (${dept})`;
}
/** « 11 h 02 » à Paris (heure de localClock, séparée par des espaces insécables). */
export function parisClock(ms: number): string {
  const [h, m] = localClock(ms, PARIS).split(':');
  return `${Number(h)}${NBSP}h${NBSP}${m}`;
}
/** « 08/10 à 11 h 02 » (Paris) ; « n.d. » si la date est illisible. */
export function when(iso: string | null): string {
  const t = iso === null ? Number.NaN : Date.parse(iso);
  return Number.isFinite(t) ? `${dayMonth(parisDayOf(t))} à ${parisClock(t)}` : 'n.d.';
}
/** « et 12 autres. » quand une liste est coupée : rien n'est tronqué en silence. */
export function moreNote(total: number, shown: number): string {
  return total > shown ? note(`et ${countText(total - shown, 'autre', 'autres')}.`) : '';
}
/** « depuis 6 h », « depuis 3 j » ; « date n.d. » sans date. */
export function sinceText(iso: string | null, now: number): string {
  const t = iso === null ? Number.NaN : Date.parse(iso);
  if (!Number.isFinite(t)) return 'date n.d.';
  const age = Math.max(0, now - t);
  if (age < HOUR_MS) return `depuis moins d’une${NBSP}heure`;
  if (age < 2 * DAY_MS) return `depuis ${frNumber(Math.floor(age / HOUR_MS), 0)}${NBSP}h`;
  return `depuis ${frNumber(Math.floor(age / DAY_MS), 0)}${NBSP}j`;
}
/** Durée d'un événement : « 15 min », « 1 h 05 » (moins de 48 h), « 7 j 7 h » au-delà ; « durée n.d. » si elle est illisible ou négative. */
export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return 'durée n.d.';
  const minutes = Math.floor(sec / 60);
  if (minutes < 60) return `${frNumber(minutes, 0)}${NBSP}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${frNumber(hours, 0)}${NBSP}h${NBSP}${String(minutes % 60).padStart(2, '0')}`;
  const days = Math.floor(hours / 24);
  return `${frNumber(days, 0)}${NBSP}j${NBSP}${frNumber(hours % 24, 0)}${NBSP}h`;
}
