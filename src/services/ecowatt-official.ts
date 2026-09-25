// src/services/ecowatt-official.ts — lecture du signal Écowatt OFFICIEL de RTE (fonctions pures).
//
// Écowatt est un signal national : il n'existe pas de signal Écowatt régional. Source servie par
// /api/energy/ecowatt-signal (API RTE v5, jour J à J+3 ; repli open data ODRÉ, jours passés
// seulement). Un signal de la veille n'est jamais présenté comme celui du jour.

import type { EcowattOfficial, EcowattOfficialDay, EcowattSignal } from '../types/index.ts';

type Lang = 'fr' | 'en';

const PARIS_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Jour calendaire à Paris, « AAAA-MM-JJ » (les jours Écowatt sont exprimés en heure de Paris). */
export function parisDate(nowMs: number): string {
  return PARIS_DAY.format(new Date(nowMs));
}

function sortedDays(official: EcowattOfficial): EcowattOfficialDay[] {
  return [...official.days].sort((a, b) => a.date.localeCompare(b.date));
}

/** Niveau du jour (heure de Paris) ; null si le jour courant n'est pas publié. */
export function ecowattToday(official: EcowattOfficial | null | undefined, nowMs: number): EcowattSignal | null {
  if (!official) return null;
  const today = parisDate(nowMs);
  return official.days.find((d) => d.date === today)?.level ?? null;
}

/** Jour J et suivants (J+1 à J+3 avec l'API RTE), triés ; vide pour le repli open data. */
export function ecowattUpcoming(official: EcowattOfficial | null | undefined, nowMs: number): EcowattOfficialDay[] {
  if (!official) return [];
  const today = parisDate(nowMs);
  return sortedDays(official).filter((d) => d.date >= today);
}

/** Dernier jour publié jusqu'à aujourd'hui inclus (le jour même, sinon le plus récent des jours passés). */
export function ecowattLastPublished(official: EcowattOfficial | null | undefined, nowMs: number): EcowattOfficialDay | null {
  if (!official) return null;
  const today = parisDate(nowMs);
  const past = sortedDays(official).filter((d) => d.date <= today);
  return past.length > 0 ? past[past.length - 1] : null;
}

const LEVELS: readonly EcowattSignal[] = ['green', 'orange', 'red'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isDay(value: unknown): value is EcowattOfficialDay {
  if (!value || typeof value !== 'object') return false;
  const d = value as Record<string, unknown>;
  return typeof d.date === 'string' && DATE_RE.test(d.date)
    && LEVELS.includes(d.level as EcowattSignal)
    && typeof d.message === 'string'
    && Array.isArray(d.hours) && d.hours.length === 24
    && d.hours.every((h) => h === 0 || h === 1 || h === 2 || h === 3);
}

/** Vérifie la forme de la réponse serveur avant usage (jamais de signal inventé à partir d'un JSON inattendu). */
export function isEcowattOfficial(value: unknown): value is EcowattOfficial {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  return (o.source === 'rte' || o.source === 'odre')
    && (o.generatedAt === null || typeof o.generatedAt === 'string')
    && Array.isArray(o.days) && o.days.every(isDay);
}

const LABEL: Record<EcowattSignal, Record<Lang, string>> = {
  green: { fr: 'Pas d’alerte', en: 'No alert' },
  orange: { fr: 'Système électrique tendu', en: 'Power system under strain' },
  red: { fr: 'Système électrique très tendu', en: 'Power system under severe strain' },
};

/** Libellé RTE d'un niveau Écowatt. */
export function ecowattLevelLabel(level: EcowattSignal, lang: Lang = 'fr'): string {
  return LABEL[level][lang];
}

/** « 24/09 » depuis « 2026-09-24 ». */
function shortDate(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}`;
}

/** État du signal en une phrase (légende de la couche, sources) : jamais un jour passé présenté comme celui du jour. */
export function ecowattStatusNote(official: EcowattOfficial | null | undefined, nowMs: number): string {
  const today = ecowattToday(official, nowMs);
  if (today) return `Écowatt (RTE, signal national) : ${ecowattLevelLabel(today)} — TEMPS RÉEL`;
  const last = ecowattLastPublished(official, nowMs);
  if (last) return `Écowatt : signal du jour INDISPONIBLE · dernier publié le ${shortDate(last.date)} : ${ecowattLevelLabel(last.level)} (open data RTE)`;
  return 'Écowatt (RTE) : signal officiel INDISPONIBLE';
}
