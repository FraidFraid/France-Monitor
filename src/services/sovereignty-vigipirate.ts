// src/services/sovereignty-vigipirate.ts : vérification de la saisie Vigipirate par la relecture quotidienne de la page officielle
// (amendement 7, O14 et S1 ; arbitrage du contrôleur : route /api/sovereignty/vigipirate, forme VigipiratePageCheck). La saisie datée
// (src/config/vigipirate.ts) reste la référence ; ce service lit la vérification du serveur (empreinte du texte utile de
// https://www.sgdsn.gouv.fr/vigipirate, date de la lecture qui l'a vue changer) et rend les mentions de la ligne Vigipirate :
// fin des 12 jours d'une « alerte attentat » (échéance passée : à revérifier), « niveau à revérifier sur sgdsn.gouv.fr (page modifiée
// le JJ/MM) », rappel d'une saisie de plus de 4 mois, vérification en panne (S3 : une panne se voit, jamais « inchangée »). Lue avec la
// relève de la couche Défense.
import type { VigipirateEntry, VigipiratePageCheck } from '../types/index.ts';
import { parisDayOf } from './environment-levels.ts';
import { vigipirateAlertEnd, vigipiratePageChangedOn, vigipirateReminderDue } from './sovereignty-levels.ts';
import {
  isDateOrNull, isStringList, loadSovereigntySlot, mergeSlot, nullable, record, shapeOf, value, type SourceSlot,
} from './sovereignty-source.ts';

export const VIGIPIRATE_CHECK_URL = '/api/sovereignty/vigipirate';
/** Cache client : 30 min (la route se garde une heure au CDN ; le serveur relit la page une fois par jour). */
export const VIGIPIRATE_CHECK_TTL_MS = 30 * 60_000;
/** Relecture quotidienne (24 h), nouvel essai une heure après un échec : au-delà de 26 h, la vérification est en retard. */
export const VIGIPIRATE_CHECK_LATE_AFTER_H = 26;

export interface VigipirateCheckState { check: SourceSlot<VigipiratePageCheck> }

const CHECK_SHAPE = shapeOf<VigipiratePageCheck>(record({
  readAt: value(isDateOrNull),
  fingerprint: nullable(value((v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v))),
  pageChangedAt: value(isDateOrNull),
  errors: value(isStringList),
}));

/** Écarts à la forme de /api/sovereignty/vigipirate, nommés un par un ; liste vide : conforme. */
export function vigipiratePageCheckProblems(v: unknown): string[] {
  return CHECK_SHAPE.problems(v);
}

export function isVigipiratePageCheck(v: unknown): v is VigipiratePageCheck {
  return CHECK_SHAPE.is(v);
}

/** Ne rejette jamais : une lecture en échec porte `error` et garde la dernière vérification. */
export async function fetchVigipirateCheck(previous: VigipirateCheckState | null, now: number = Date.now()): Promise<VigipirateCheckState> {
  return {
    check: await loadSovereigntySlot(VIGIPIRATE_CHECK_URL, VIGIPIRATE_CHECK_TTL_MS, previous?.check, now, CHECK_SHAPE, 'de la vérification Vigipirate'),
  };
}

/** Fusion à l'écriture (S3) : une lecture en échec garde la vérification actuellement en mémoire. */
export function mergeVigipirateCheck(current: VigipirateCheckState | null, incoming: VigipirateCheckState): VigipirateCheckState {
  return { check: mergeSlot(current?.check, incoming.check) };
}

/** Mentions de la ligne Vigipirate, null quand elles n'ont pas lieu d'être. */
export interface VigipirateNotices {
  /**
   * Stade « alerte attentat » seulement : « jusqu’au 04/07, sauf renouvellement par le Premier ministre » ; le jour de Paris passé,
   * « échéance des 12 jours de l’alerte attentat passée le 04/07 · niveau à revérifier sur sgdsn.gouv.fr » (vigipirateAlertEndPassed).
   */
  alertEnd: string | null;
  /** « niveau à revérifier sur sgdsn.gouv.fr (page modifiée le 05/10) » : page modifiée après le jour de la saisie. */
  recheck: string | null;
  /** « saisie du 04/10/2026, de plus de 4 mois : à vérifier sur sgdsn.gouv.fr » ; espace insécable entre 4 et mois dans le texte (R1). */
  reminder: string | null;
  /** Vérification en panne ou en retard : « page officielle non relue depuis le 04/10 : SGDSN, page Vigipirate : HTTP 503 ». */
  checkFailure: string | null;
}

const PARIS_DAY_MONTH = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit' });

/** « 05/10 » d'un jour « AAAA-MM-JJ ». */
function dayMonth(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

/** « 04/10/2026 » d'un jour « AAAA-MM-JJ ». */
function fullDate(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
}

function checkFailureOf(slot: SourceSlot<VigipiratePageCheck>, now: number): string | null {
  const data = slot.data;
  const errors = [...(slot.error !== null ? [slot.error] : []), ...(data?.errors ?? [])];
  const readAt = data?.readAt ?? null;
  const t = readAt === null ? Number.NaN : Date.parse(readAt);
  if (!Number.isFinite(t)) {
    if (data === null && slot.error === null) return null;        // première lecture en cours
    return `page officielle jamais relue${errors.length > 0 ? ` : ${errors.join(' ; ')}` : ''}`;
  }
  const late = t + VIGIPIRATE_CHECK_LATE_AFTER_H * 3_600_000 < now;
  if (errors.length === 0 && !late) return null;
  return `page officielle non relue depuis le ${PARIS_DAY_MONTH.format(new Date(t))}${errors.length > 0 ? ` : ${errors.join(' ; ')}` : ''}`;
}

/**
 * Échéance des 12 jours d'une « alerte attentat » passée : le jour de Paris de `now` vient après le jour de fin (vigipirateAlertEnd,
 * « jusqu’au JJ/MM » compris). Faux pour un autre stade ou un début illisible. La saisie n'est pas changée : le niveau est à revérifier.
 */
export function vigipirateAlertEndPassed(entry: Pick<VigipirateEntry, 'stade' | 'depuis'>, now: number): boolean {
  const end = vigipirateAlertEnd(entry);
  return end !== null && parisDayOf(now) > end;
}

/**
 * Mentions de la ligne Vigipirate (O14, S1) : la saisie reste affichée telle quelle ; ces mentions s'y ajoutent. La page modifiée
 * n'est dite que d'après une empreinte relue (jamais supposée) ; une vérification en panne ou en retard se dit, sans rien conclure du
 * niveau.
 */
export function vigipirateNotices(entry: VigipirateEntry, check: SourceSlot<VigipiratePageCheck>, now: number): VigipirateNotices {
  const end = vigipirateAlertEnd(entry);
  const changed = vigipiratePageChangedOn(entry, check.data);
  return {
    alertEnd: end === null ? null
      : vigipirateAlertEndPassed(entry, now)
        ? `échéance des 12\u00a0jours de l’alerte attentat passée le ${dayMonth(end)} · niveau à revérifier sur sgdsn.gouv.fr`
        : `jusqu’au ${dayMonth(end)}, sauf renouvellement par le Premier ministre`,
    recheck: changed === null ? null : `niveau à revérifier sur sgdsn.gouv.fr (page modifiée le ${dayMonth(changed)})`,
    reminder: vigipirateReminderDue(entry, now) ? `saisie du ${fullDate(entry.saisiLe)}, de plus de 4\u00a0mois : à vérifier sur sgdsn.gouv.fr` : null,
    checkFailure: checkFailureOf(check, now),
  };
}
