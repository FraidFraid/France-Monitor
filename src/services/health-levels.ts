// src/services/health-levels.ts : niveaux, périodes et retards des données de santé
// (spec 2026-10-03 panneaux santé § 1 et § 2). Fonctions pures, sans DOM ni réseau,
// partagées par les services clients et les vues des quatre panneaux santé.
import type {
  EpiWeek,
  EpidemicPhase,
  RegionalAlertLevel,
  SyndromeKey,
  SyndromicResponse,
  SyndromicWeekPoint,
  WastewaterPoint,
} from '../types/index.ts';
import { LEVEL_RANK, type VigilanceLevel } from './vigilance.ts';

/** Échelle L1 plus « nd » (non disponible : donnée absente ou référence insuffisante). */
export type HealthLevel = VigilanceLevel | 'nd';

const DAY_MS = 86_400_000;
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

/** « AAAA-MM-JJ » ou date ISO complète → instant (ms) ; une date seule vaut minuit UTC. NaN si illisible. */
function parseDataDate(value: string): number {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T00:00:00Z`) : Date.parse(value);
}

function dayMonth(date: string): { day: number; month: number } {
  return { day: Number(date.slice(8, 10)), month: Number(date.slice(5, 7)) - 1 };
}

/** « S39 (21-27 sept.) » ; mois différents : « S40 (28 sept.-4 oct.) ». */
export function epiWeekLabel(week: EpiWeek): string {
  const num = week.id.slice(week.id.indexOf('S'));
  const a = dayMonth(week.start);
  const b = dayMonth(week.end);
  const range = a.month === b.month
    ? `${a.day}-${b.day} ${MONTHS[b.month]}`
    : `${a.day} ${MONTHS[a.month]}-${b.day} ${MONTHS[b.month]}`;
  return `${num} (${range})`;
}

/**
 * Niveau saisonnier (spec § 2.1, seuils arbitrés le 03/10) d'une part de passages, comparée au maximum m
 * des valeurs de la même semaine ISO des saisons précédentes : vert si v ≤ m, jaune si m < v < 1,15 × m,
 * orange si 1,15 × m ≤ v < 1,5 × m, rouge si v ≥ 1,5 × m ; nd sans valeur ou avec moins de deux saisons
 * de référence. Références toutes nulles (petits effectifs) : toute hausse est jaune au plus.
 */
export function seasonalLevel(value: number | null, refs: readonly number[]): HealthLevel {
  const usable = refs.filter((r) => Number.isFinite(r));
  if (value === null || !Number.isFinite(value) || usable.length < 2) return 'nd';
  const max = Math.max(...usable);
  if (value <= max) return 'vert';
  if (max <= 0) return 'jaune';
  if (value >= 1.5 * max) return 'rouge';
  if (value >= 1.15 * max) return 'orange';
  return 'jaune';
}

function weekParts(id: string): { year: number; week: number } | null {
  const m = /^(\d{4})-S(\d{2})$/.exec(id);
  return m ? { year: Number(m[1]), week: Number(m[2]) } : null;
}

/**
 * Parts aux urgences (er) de la même semaine ISO pour les `seasons` années précédentes, de la plus
 * récente à la plus ancienne ; valeurs absentes omises. Semaine 53 : repli sur la semaine 52.
 */
export function franceRefs(points: readonly SyndromicWeekPoint[], weekId: string, seasons = 3): number[] {
  const parts = weekParts(weekId);
  if (!parts) return [];
  const byWeek = new Map<string, number | null>(points.map((p) => [p.week, p.er]));
  const ww = String(parts.week).padStart(2, '0');
  const out: number[] = [];
  for (let k = 1; k <= seasons; k += 1) {
    const year = parts.year - k;
    let value = byWeek.get(`${year}-S${ww}`);
    if (value === undefined && parts.week === 53) value = byWeek.get(`${year}-S52`);
    if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
  }
  return out;
}

const PHASE_LEVEL: Record<EpidemicPhase, VigilanceLevel> = { 1: 'vert', 2: 'jaune', 3: 'orange', 4: 'jaune' };
const PHASE_LABEL: Record<EpidemicPhase, string> = { 1: 'pas d’alerte', 2: 'pré-épidémie', 3: 'épidémie', 4: 'post-épidémie' };

/** Échelle Odissé : 1 vert, 2 jaune, 3 orange, 4 jaune (post-épidémie, revient toujours à 1). */
export function phaseLevel(phase: EpidemicPhase): VigilanceLevel {
  return PHASE_LEVEL[phase];
}

export function phaseLabel(phase: EpidemicPhase): string {
  return PHASE_LABEL[phase];
}

/** En saison : la ligne a au plus trois semaines de retard sur la dernière semaine attendue (lundi + 28 j ≥ now). */
export function alertInSeason(level: RegionalAlertLevel, now: number): boolean {
  const start = parseDataDate(level.start);
  return Number.isFinite(start) && start + 28 * DAY_MS >= now;
}

/** Régions de l'Hexagone et la Corse : codes 11 à 94 ; DROM 01 à 06 (et 07, 08 sans libellé) exclus. */
export function isMetropoleRegion(code: string): boolean {
  if (!/^\d{2}$/.test(code)) return false;
  const n = Number(code);
  return n >= 11 && n <= 94;
}

/**
 * Entrée « alertes » du niveau national (spec § 3.1) sur les seules lignes en saison : épidémie dans une
 * région de l'Hexagone → orange ; pré-épidémie ou post-épidémie quelque part, ou épidémie seulement
 * outre-mer → jaune ; sinon vert (hors saison compris).
 */
export function alertsInputLevel(levels: readonly RegionalAlertLevel[], now: number): VigilanceLevel {
  const live = levels.filter((l) => alertInSeason(l, now));
  if (live.some((l) => l.phase === 3 && isMetropoleRegion(l.region))) return 'orange';
  if (live.some((l) => l.phase !== 1)) return 'jaune';
  return 'vert';
}

/** Niveau d'activité Sentinelles en mots → couleur ; libellé inconnu ou absent : nd. */
export function sentinellesActivityLevel(activity: string | null): HealthLevel {
  const word = (activity ?? '').trim().toLowerCase().normalize('NFC');
  if (word === 'faible') return 'vert';
  if (word === 'modérée' || word === 'moderee') return 'jaune';
  if (word === 'très forte' || word === 'tres forte') return 'rouge';
  if (word === 'forte') return 'orange';
  return 'nd';
}

/**
 * Eaux usées (spec § 2.4), sur national54 : critère A, la dernière valeur vaut au moins 1,5 fois celle de
 * deux semaines plus tôt ; critère B, elle dépasse la même semaine un an plus tôt. Un critère jaune,
 * deux orange, aucun vert ; nd sans dernière valeur ou sans aucune comparaison possible.
 */
export function wastewaterLevel(points: readonly WastewaterPoint[], lastYear: WastewaterPoint | null): HealthLevel {
  const last = points.at(-1);
  if (!last || last.national54 === null) return 'nd';
  const current = last.national54;
  const twoWeeksBefore = parseDataDate(last.start) - 14 * DAY_MS;
  const a = points.find((p) => parseDataDate(p.start) === twoWeeksBefore)?.national54 ?? null;
  const b = lastYear?.national54 ?? null;
  if (a === null && b === null) return 'nd';
  const criteria = (a !== null && current > a && current >= 1.5 * a ? 1 : 0) + (b !== null && current > b ? 1 : 0);
  if (criteria === 2) return 'orange';
  return criteria === 1 ? 'jaune' : 'vert';
}

export type HealthSource = 'syndromic' | 'sentinelles' | 'wastewater' | 'ansm' | 'recalls';

/** Délai normal de chaque source (spec S2), compté depuis la date passée par l'appelant. */
const LATE_AFTER_DAYS: Record<HealthSource, number> = { syndromic: 17, sentinelles: 13, wastewater: 28, ansm: 7, recalls: 4 };

/**
 * « (en retard) » (spec S2). dataDate : dimanche de la semaine (syndromic, sentinelles), lundi de la
 * semaine (wastewater), date de mise à jour (ansm) ou de publication (recalls), « AAAA-MM-JJ » ou ISO.
 * Date illisible : en retard (aucune fraîcheur prouvée).
 */
export function isHealthDataLate(source: HealthSource, dataDate: string, now: number): boolean {
  const t = parseDataDate(dataDate);
  if (!Number.isFinite(t)) return true;
  return t + LATE_AFTER_DAYS[source] * DAY_MS < now;
}

/** Syndromes qui fixent la pastille Urgences (grippe et COVID-19 sont déjà comptées dans les IRA). */
export const URGENCES_PILL_SYNDROMES: readonly SyndromeKey[] = ['ira', 'bronchio', 'gastro'];

/** Plus haut niveau saisonnier France parmi URGENCES_PILL_SYNDROMES ; à égalité, le premier de la liste. */
export function urgencesLevel(data: SyndromicResponse): { level: HealthLevel; driver: SyndromeKey | null } {
  let best: { level: VigilanceLevel; driver: SyndromeKey } | null = null;
  for (const key of URGENCES_PILL_SYNDROMES) {
    const series = data.syndromes.find((s) => s.key === key);
    if (!series) continue;
    const weekId = data.week?.id ?? series.france.at(-1)?.week;
    if (!weekId) continue;
    const point = series.france.find((p) => p.week === weekId);
    const level = seasonalLevel(point?.er ?? null, franceRefs(series.france, weekId));
    if (level === 'nd') continue;
    if (!best || LEVEL_RANK[level] > LEVEL_RANK[best.level]) best = { level, driver: key };
  }
  return best ? { level: best.level, driver: best.driver } : { level: 'nd', driver: null };
}

export interface NationalInput { key: 'alerts' | 'sentinelles' | 'urgences' | 'wastewater'; level: HealthLevel; late: boolean; label: string; value: string; period: string; note: string }

/**
 * Niveau national (spec § 3.1) : plus haut niveau des entrées ni en retard ni nd ; à égalité, la première
 * dans l'ordre reçu fixe la pastille (driver). `excluded` : entrées écartées (en retard ou nd), dans
 * l'ordre reçu. Toutes écartées : nd.
 */
export function nationalHealthLevel(inputs: readonly NationalInput[]): { level: HealthLevel; driver: NationalInput | null; excluded: NationalInput[] } {
  let driver: NationalInput | null = null;
  let best: VigilanceLevel | null = null;
  const excluded: NationalInput[] = [];
  for (const input of inputs) {
    const level = input.level;
    if (input.late || level === 'nd') {
      excluded.push(input);
      continue;
    }
    if (best === null || LEVEL_RANK[level] > LEVEL_RANK[best]) {
      best = level;
      driver = input;
    }
  }
  return { level: best ?? 'nd', driver, excluded };
}
