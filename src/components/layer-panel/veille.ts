// src/components/layer-panel/veille.ts : vue pure du panneau Veille sanitaire (spec 2026-10-03 § 3.1) : en-tête, niveau
// national, onglet France et « Méthode et sources » ; aucun accès réseau ni DOM. Les onglets Outre-mer, International et
// Produits et l'aiguillage des quatre onglets sont dans veille-tabs.ts.
import type {
  EpidemicPhase, RegionalAlertLevel, SentinellesIndicator, SentinellesIndicatorKey, SentinellesNationalResponse, SyndromeKey,
  SyndromicResponse, WastewaterResponse,
} from '../../types/index.ts';
import {
  alertInSeason, alertsInputLevel, epiWeekLabel, isMetropoleRegion, nationalHealthLevel, phaseLabel, phaseLevel, seasonalLevel,
  sentinellesActivityLevel, urgencesLevel, wastewaterLevel, type HealthLevel, type NationalInput,
} from '../../services/health-levels.ts';
import {
  dataDateMs, lastWastewaterPoint, surveillanceDataDate, surveillanceLate, type HealthSurveillanceKey, type HealthSurveillanceState,
} from '../../services/health-surveillance.ts';
import { LEVEL_RANK, levelColorVar, maxLevel, type VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { kvRow, levelCounts } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { lineChart } from './chart.ts';
import { NBSP, formatPct, formatSignedPct, frNumber } from './format.ts';
import {
  emptyLine, listRow, loadingBody, sourceErrorCallout, sourceLinkHtml, valueHtml,
  type LayerFigure, type LayerHeadModel, type LayerTab, type LayerView,
} from './frame.ts';
import {
  HEALTH_PART, PER_100K, SYNDROME_LABEL, capitalize, changeHtml, changePct, failedPillSyndromes, inSentence, isoWeekId, joinFr, parisDay,
  partFailed, positionWords, ratioText, regionIn, seasonalDigits, seasonalNote, seasonalReading, shiftDate, sourceUnavailable,
  trendArrowHtml, trendOf, urgencesDriver, weekNumber, weekShort, weekYear,
} from './health-format.ts';

export type VeilleTab = 'france' | 'outremer' | 'international' | 'produits';
export const VEILLE_TABS: readonly VeilleTab[] = ['france', 'outremer', 'international', 'produits'];

export interface VeilleViewInput {
  /** null : premier chargement en cours. */
  state: HealthSurveillanceState | null;
  tab: VeilleTab;
  now: number;
  open: (sectionId: string, byDefault: boolean) => boolean;
}

/** Niveau national et ses quatre entrées (spec § 3.1), partagé par le panneau et la fiche thème Santé (§ 3.5). */
export interface NationalHealthSummary {
  inputs: NationalInput[];
  level: HealthLevel;
  /** Entrée qui fixe la pastille, en mots (« eaux usées en forte hausse »). */
  driverPhrase: string;
}

export const VEILLE_THEME = 'Santé';
export const VEILLE_TITLE = 'Veille sanitaire';
const SOURCES_SEGMENT = 'Santé publique France, Sentinelles';
const DAY_MS = 86_400_000;
const ODISSE = 'https://odisse.santepubliquefrance.fr';
const DGS_OFFICIAL_URL = 'https://sante.gouv.fr/ministere/informations-pratiques/site/dgs-urgent';
/** Ordre remis à nationalHealthLevel, qui garde la première entrée au plus haut niveau : eaux usées, urgences, alertes, Sentinelles. */
const PILL_ORDER: ReadonlyArray<NationalInput['key']> = ['wastewater', 'urgences', 'alerts', 'sentinelles'];
const RULES: Readonly<Record<NationalInput['key'], string>> = {
  alerts: 'épidémie dans l’Hexagone : orange ; pré-épidémie, post-épidémie ou épidémie outre-mer seulement : jaune ; sinon vert',
  sentinelles: 'activité faible : vert ; modérée : jaune ; forte : orange ; très forte : rouge',
  urgences: 'plus haut niveau parmi IRA, bronchiolite et gastro-entérite, comparés à la même semaine des 3 saisons précédentes',
  wastewater: '×1,5 en 2 semaines ou au-dessus de l’an dernier : jaune ; les deux : orange ; sinon vert',
};
/** Gravité des phases Odissé : 4 (post-épidémie) est moins grave que 2 et 3 (spec § 2.2). */
const PHASE_RANK: Readonly<Record<EpidemicPhase, number>> = { 1: 0, 4: 1, 2: 2, 3: 3 };
const SCALE_NOTE = 'Échelle Odissé : 1 pas d’alerte (vert), 2 pré-épidémie (jaune), 3 épidémie (orange), 4 post-épidémie '
  + '(jaune, puis retour à « pas d’alerte » : jamais plus grave que 3). Hors saison, seule la dernière publication est connue.';

const note = (text: string): string => `<p class="fmk-note">${escapeHtml(text)}</p>`;

// ─── Alertes épidémiques (Odissé, spec § 2.2) ───

function worstPhase(lines: readonly RegionalAlertLevel[]): EpidemicPhase {
  return lines.reduce<EpidemicPhase>((w, l) => (PHASE_RANK[l.phase] > PHASE_RANK[w] ? l.phase : w), 1);
}

/** Phase en saison, sinon « hors saison (dernière publication le jj/mm : <phase>) » (S4) ; jamais « niveau 1 ». */
export function alertWords(level: RegionalAlertLevel, now: number): string {
  return alertInSeason(level, now) ? phaseLabel(level.phase) : `hors saison (dernière publication le ${parisDay(level.start)} : ${phaseLabel(level.phase)})`;
}

function phaseWords(pathology: string, phase: EpidemicPhase): string {
  return phase === 3 ? `épidémie de ${pathology}` : `${pathology} en ${phaseLabel(phase)}`;
}

/** Alertes en saison au-dessus du niveau 1, groupées par pathologie et phase, les plus graves d'abord (« grippe en pré-épidémie à Mayotte »). */
export function activeAlertPhrases(levels: readonly RegionalAlertLevel[], now: number, withPlace = true): string[] {
  const groups = new Map<string, RegionalAlertLevel[]>();
  for (const l of levels) {
    if (l.phase === 1 || !alertInSeason(l, now)) continue;
    const key = `${l.pathology}|${l.phase}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  return [...groups.values()]
    .sort((a, b) => PHASE_RANK[b[0].phase] - PHASE_RANK[a[0].phase])
    .map((g) => {
      const words = phaseWords(g[0].pathology, g[0].phase);
      return withPlace ? `${words} ${joinFr(g.map((l) => regionIn(l.region, l.regionName)))}` : words;
    });
}

function hexagoneWords(levels: readonly RegionalAlertLevel[], now: number): string {
  const metro = levels.filter((l) => isMetropoleRegion(l.region));
  if (metro.length === 0) return 'n.d.';
  const inSeason = metro.filter((l) => alertInSeason(l, now));
  if (inSeason.length === 0) {
    const last = metro.reduce((m, l) => (l.start > m ? l.start : m), metro[0].start);
    return `hors saison (dernière publication le ${parisDay(last)} : ${phaseLabel(worstPhase(metro.filter((l) => l.start === last)))})`;
  }
  const phrases = activeAlertPhrases(inSeason, now);
  return phrases.length > 0 ? phrases.join(' ; ') : 'pas d’alerte';
}

function outreMerWords(levels: readonly RegionalAlertLevel[], now: number): string {
  const drom = levels.filter((l) => !isMetropoleRegion(l.region));
  if (drom.length === 0) return 'n.d.';
  const phrases = activeAlertPhrases(drom, now);
  if (phrases.length > 0) return phrases.join(' ; ');
  return drom.some((l) => alertInSeason(l, now)) ? 'pas d’alerte' : 'hors saison';
}

/** Résumé de la section « Alertes épidémiques » : « Hexagone hors saison · Mayotte : grippe en pré-épidémie ». */
export function alertsSummary(levels: readonly RegionalAlertLevel[], now: number): string {
  const metroIn = levels.filter((l) => isMetropoleRegion(l.region) && alertInSeason(l, now));
  const regions = new Set(metroIn.filter((l) => l.phase !== 1).map((l) => l.region)).size;
  const hexagone = metroIn.length === 0 ? 'Hexagone hors saison'
    : regions === 0 ? 'Hexagone : pas d’alerte' : `Hexagone : ${regions} région${regions > 1 ? 's' : ''} en alerte`;
  const drom = levels.filter((l) => !isMetropoleRegion(l.region) && l.phase !== 1 && alertInSeason(l, now))
    .map((l) => `${l.regionName} : ${phaseWords(l.pathology, l.phase)}`);
  return [hexagone, ...drom].join(' · ');
}

// ─── Entrées du niveau national (spec § 3.1) ───

/** Entrée d'une source indisponible, en tout ou en partie (S3) : n.d., jamais verte, écartée de la pastille et nommée. */
function unavailable(key: NationalInput['key'], label: string, what?: string): NationalInput {
  return { key, level: 'nd', late: false, label, value: 'n.d.', period: 'n.d.', note: `source indisponible${what ? ` (${what})` : ''}`, unavailable: true };
}

/** Odissé en échec : réponse lue (pages régionales) mais niveaux d'alerte absents ; jamais lue comme « rien à signaler ». */
export function alertsDown(state: HealthSurveillanceState): boolean {
  const d = state.alerts.data;
  return d === null || partFailed(d.errors, HEALTH_PART.alerts);
}

function alertsInput(state: HealthSurveillanceState, now: number): NationalInput {
  const label = 'Alertes épidémiques (grippe, bronchiolite)';
  const d = state.alerts.data;
  if (!d || alertsDown(state)) return unavailable('alerts', label);
  const metroIn = d.levels.filter((l) => isMetropoleRegion(l.region) && alertInSeason(l, now));
  return {
    key: 'alerts', level: alertsInputLevel(d.levels, now), late: false, label,
    value: metroIn.length === 0 ? 'hors saison' : phaseLabel(worstPhase(metroIn)),
    period: d.latestWeek ? weekShort(d.latestWeek.id) : 'n.d.',
    note: `Hexagone : ${hexagoneWords(d.levels, now)} ; outre-mer : ${outreMerWords(d.levels, now)}`,
  };
}

export function sentinellesIra(d: SentinellesNationalResponse | null): SentinellesIndicator | null {
  return d?.indicators.find((i) => i.key === 'ira') ?? null;
}

function sentinellesInput(state: HealthSurveillanceState, now: number): NationalInput {
  const label = 'Médecine générale (Sentinelles)';
  const d = state.sentinelles.data;
  const ira = sentinellesIra(d);
  if (!d || !d.week || !ira) return unavailable('sentinelles', label);
  return {
    key: 'sentinelles', level: sentinellesActivityLevel(ira.activity), late: surveillanceLate(state, 'sentinelles', now), label,
    value: ira.activity ? `activité ${ira.activity}` : 'n.d.', period: weekShort(d.week.id),
    note: `IRA ${ira.rate === null ? 'n.d.' : frNumber(ira.rate, 0)} ${PER_100K}${d.provisional ? ', semaine provisoire' : ''}`,
  };
}

function urgencesInput(state: HealthSurveillanceState, now: number): NationalInput {
  const d = state.syndromic.data;
  if (!d || !d.week) return unavailable('urgences', 'Urgences');
  // Un syndrome de la pastille sans série France : le niveau calculé sur les autres pourrait être trop bas (S3).
  const failed = failedPillSyndromes(d);
  if (failed.length > 0) return unavailable('urgences', 'Urgences', joinFr(failed.map((k) => SYNDROME_LABEL[k])));
  const { level } = urgencesLevel(d);
  const key = urgencesDriver(d, level);
  const series = d.syndromes.find((s) => s.key === key);
  const reading = series ? seasonalReading(series, d.week.id) : null;
  return {
    key: 'urgences', level, late: surveillanceLate(state, 'syndromic', now), label: `Urgences, ${inSentence(SYNDROME_LABEL[key])}`,
    value: reading && reading.value !== null ? `${formatPct(reading.value, seasonalDigits(reading))} des passages` : 'n.d.',
    period: weekShort(d.week.id), note: reading ? seasonalNote(reading) : 'n.d.',
  };
}

function twoWeekRatio(d: WastewaterResponse): number | null {
  const last = lastWastewaterPoint(d);
  if (!last) return null;
  const before = d.points.find((p) => p.start === shiftDate(last.start, -14));
  return before && before.national54 ? last.national54 / before.national54 : null;
}

function wastewaterInput(state: HealthSurveillanceState, now: number): NationalInput {
  const label = 'Eaux usées, COVID-19';
  const d = state.wastewater.data;
  const last = lastWastewaterPoint(d);
  if (!d || !last) return unavailable('wastewater', label);
  const prev = d.points.find((p) => p.start === shiftDate(last.start, -7));
  const pct = changePct(last.national54, prev?.national54);
  const ratio = twoWeekRatio(d);
  const lastYear = d.lastYear;
  return {
    key: 'wastewater', level: wastewaterLevel(d.points, d.lastYear), late: surveillanceLate(state, 'wastewater', now), label,
    value: ratio === null ? 'n.d.' : `${ratioText(ratio)} en 2 semaines`, period: weekShort(last.week),
    note: `indicateur 54 stations : ${frNumber(last.national54, 0)} en ${weekShort(last.week)}`
      + (pct !== null && prev ? ` (${formatSignedPct(pct, 0)} sur ${weekShort(prev.week)})` : '')
      + (lastYear && lastYear.national54 !== null ? ` ; même semaine ${weekYear(lastYear.week) ?? 'un an plus tôt'} : ${frNumber(lastYear.national54, 0)}` : ''),
  };
}

function wastewaterWords(d: WastewaterResponse | null): string {
  const last = lastWastewaterPoint(d);
  if (!d || !last) return 'eaux usées n.d.';
  const ratio = twoWeekRatio(d);
  const rising = ratio !== null && ratio >= 1.5;
  const above = d.lastYear !== null && d.lastYear.national54 !== null && last.national54 > d.lastYear.national54;
  if (rising && above) return 'eaux usées en forte hausse, au-dessus de l’an dernier';
  if (rising) return 'eaux usées en forte hausse';
  if (above) return 'eaux usées au-dessus de l’an dernier';
  if (ratio !== null && ratio <= 1 / 1.5) return 'eaux usées en baisse';
  return 'eaux usées stables';
}

function urgencesPhrase(d: SyndromicResponse | null): string {
  if (!d) return 'urgences n.d.';
  const { level } = urgencesLevel(d);
  const label = inSentence(SYNDROME_LABEL[urgencesDriver(d, level)]);
  switch (level) {
    case 'vert': return 'urgences dans la norme des saisons précédentes';
    case 'jaune': return `${label} au-dessus des saisons précédentes`;
    case 'orange': return `${label} bien au-dessus des saisons précédentes`;
    case 'rouge': return `${label} très au-dessus des saisons précédentes`;
    default: return 'comparaison saisonnière n.d.';
  }
}

function driverPhrase(state: HealthSurveillanceState, driver: NationalInput | null, level: HealthLevel, now: number): string {
  if (level === 'nd') return 'niveau national n.d.';
  switch (driver?.key) {
    case 'urgences': return urgencesPhrase(state.syndromic.data);
    case 'sentinelles': return `activité ${sentinellesIra(state.sentinelles.data)?.activity ?? 'n.d.'} en médecine générale`;
    case 'wastewater': return wastewaterWords(state.wastewater.data);
    case 'alerts': return activeAlertPhrases(state.alerts.data?.levels ?? [], now)[0] ?? 'pas d’alerte épidémique en saison';
    default: return '';
  }
}

/** Niveau national : le plus haut des quatre entrées non en retard et disponibles (nationalHealthLevel, partie A). */
export function nationalSummary(state: HealthSurveillanceState, now: number): NationalHealthSummary {
  // Affichage : alertes, Sentinelles, urgences, eaux usées ; départage à égalité selon PILL_ORDER.
  const inputs = [alertsInput(state, now), sentinellesInput(state, now), urgencesInput(state, now), wastewaterInput(state, now)];
  const { level, driver } = nationalHealthLevel(PILL_ORDER.flatMap((k) => inputs.filter((i) => i.key === k)));
  return { inputs, level, driverPhrase: driverPhrase(state, driver, level, now) };
}

// ─── Outre-mer : plus haut signal d'un territoire (compteur de l'onglet, sections de veille-tabs.ts) ───

export interface Territory { region: string; dept: string; name: string }
export const DROM_TERRITORIES: readonly Territory[] = [
  { region: '01', dept: '971', name: 'Guadeloupe' }, { region: '02', dept: '972', name: 'Martinique' },
  { region: '03', dept: '973', name: 'Guyane' }, { region: '04', dept: '974', name: 'La Réunion' }, { region: '06', dept: '976', name: 'Mayotte' },
];
export const DROM_SYNDROMES: readonly SyndromeKey[] = ['ira', 'grippe', 'bronchio', 'gastro'];

/** Alertes en saison du territoire et niveau saisonnier départemental de l'IRA, de la grippe, de la bronchiolite et de la gastro-entérite. */
export function territoryLevel(state: HealthSurveillanceState, t: Territory, now: number): HealthLevel {
  const levels: VigilanceLevel[] = [];
  for (const l of state.alerts.data?.levels ?? []) if (l.region === t.region && alertInSeason(l, now)) levels.push(phaseLevel(l.phase));
  if (!surveillanceLate(state, 'syndromic', now)) {
    const dep = state.syndromic.data?.departments.find((d) => d.code === t.dept);
    for (const k of DROM_SYNDROMES) {
      const v = dep?.values[k];
      if (!v) continue;
      const lv = seasonalLevel(v.er, v.refEr);
      if (lv !== 'nd') levels.push(lv);
    }
  }
  return levels.length === 0 ? 'nd' : maxLevel(levels);
}

export function outreMerCount(state: HealthSurveillanceState, now: number): number {
  return DROM_TERRITORIES.filter((t) => {
    const l = territoryLevel(state, t, now);
    return l !== 'nd' && LEVEL_RANK[l] >= LEVEL_RANK.jaune;
  }).length;
}

/** Messages OMS des 30 derniers jours (les rapports hebdomadaires de l'ECDC ne comptent pas). */
export function internationalCount(state: HealthSurveillanceState, now: number): number {
  return (state.international.data?.who ?? []).filter((n) => (dataDateMs(n.date) ?? 0) >= now - 30 * DAY_MS).length;
}

/** Situations actives ANSM : ruptures et tensions ; null si la liste n'a pas été lue (S3). */
export function produitsCount(state: HealthSurveillanceState): number | null {
  const d = state.drugs.data;
  return d && !partFailed(d.errors, HEALTH_PART.drugs) ? d.counts.rupture + d.counts.tension : null;
}

export function veilleTabs(state: HealthSurveillanceState | null, now: number): LayerTab[] {
  const intl = state?.international.data ?? null;
  return [
    { id: 'france', label: 'France' },
    { id: 'outremer', label: 'Outre-mer', count: state && (state.alerts.data || state.syndromic.data) ? outreMerCount(state, now) : null },
    { id: 'international', label: 'International', count: state && intl && !partFailed(intl.errors, HEALTH_PART.who) ? internationalCount(state, now) : null },
    { id: 'produits', label: 'Produits', count: state ? produitsCount(state) : null },
  ];
}

// ─── En-tête ───

function sentinellesFigure(state: HealthSurveillanceState, now: number): LayerFigure {
  const d = state.sentinelles.data;
  const ira = sentinellesIra(d);
  // Taux nationaux du réseau Sentinelles : France hexagonale (les DROM n'y sont pas).
  if (!d || !d.week || !ira || ira.rate === null) return { value: 'n.d.', caption: `cas d’IRA ${PER_100K} · médecine générale, France hexagonale` };
  const late = surveillanceLate(state, 'sentinelles', now);
  const dir = trendOf(ira.trend);
  const trend = dir === 'up' ? 'en hausse' : dir === 'down' ? 'en baisse' : dir === 'stable' ? 'stable' : null;
  const base = `cas d’IRA ${PER_100K} · médecine générale, France hexagonale, ${epiWeekLabel(d.week)}`;
  const tail = late ? ' (en retard)' : '';
  const trendLevel: VigilanceLevel | null = late ? null : dir === 'up' ? 'rouge' : dir === 'down' ? 'vert' : null;
  const activity = sentinellesActivityLevel(ira.activity);
  return {
    value: frNumber(ira.rate, 0),
    caption: `${base}${trend ? ` · ${trend}` : ''}${tail}`,
    captionHtml: `${escapeHtml(base)}${trend ? ` · ${valueHtml(trend, trendLevel)}` : ''}${escapeHtml(tail)}`,
    level: late || activity === 'nd' ? null : activity,
  };
}

function periodSegment(state: HealthSurveillanceState, now: number): string {
  const s = state.syndromic.data;
  if (s?.week) {
    const late = surveillanceLate(state, 'syndromic', now);
    return `${weekShort(s.week.id)}${s.publishedAt ? ` · publiée le ${parisDay(s.publishedAt)}` : ''}${late ? ' (en retard)' : ''}`;
  }
  const w = state.sentinelles.data?.week;
  return w ? weekShort(w.id) : '';
}

function respiratorySentence(state: HealthSurveillanceState, now: number): string | null {
  const d = state.syndromic.data;
  const ira = d?.syndromes.find((s) => s.key === 'ira');
  if (!d?.week || !ira || surveillanceLate(state, 'syndromic', now)) return null;
  const r = seasonalReading(ira, d.week.id);
  if (r.value === null) return null;
  const pct = changePct(r.value, r.previous);
  const shown = pct === null ? null : Math.round(pct);
  const trend = shown === null ? null : shown >= 10 ? 'up' : shown <= -10 ? 'down' : 'stable';
  const wk = weekNumber(d.week.id);
  const rentree = trend === 'up' && wk !== null && wk >= 36 && wk <= 41;
  const trendText = trend === 'up' ? `en hausse${rentree ? ' de rentrée' : ''}` : trend === 'down' ? 'en baisse' : trend === 'stable' ? 'stables' : null;
  const below = r.level === 'vert' && r.refs.length > 0 && r.value < Math.min(...r.refs);
  const position = below ? 'sous le niveau des saisons précédentes' : positionWords(r);
  const encore = trend === 'up' && r.level === 'vert' ? 'encore ' : '';
  if (trendText === null) return position === null ? null : `Infections respiratoires ${position}.`;
  return `Infections respiratoires ${trendText}${position ? `, ${encore}${position}` : ''}.`;
}

function wastewaterSentence(state: HealthSurveillanceState, now: number): string | null {
  const d = state.wastewater.data;
  const last = lastWastewaterPoint(d);
  if (!d || !last || surveillanceLate(state, 'wastewater', now)) return null;
  const ratio = twoWeekRatio(d);
  const above = d.lastYear !== null && d.lastYear.national54 !== null && last.national54 > d.lastYear.national54;
  if (ratio !== null && ratio >= 1.5) return `COVID-19 en forte hausse dans les eaux usées (${ratioText(ratio)} en 2 semaines)${above ? ', au-dessus de l’an dernier' : ''}.`;
  if (above) return 'COVID-19 dans les eaux usées au-dessus de l’an dernier.';
  if (ratio !== null && ratio <= 1 / 1.5) return 'COVID-19 en baisse dans les eaux usées.';
  return 'COVID-19 stable dans les eaux usées.';
}

function alertsSentence(state: HealthSurveillanceState, now: number): string | null {
  const phrases = activeAlertPhrases(state.alerts.data?.levels ?? [], now);
  return phrases.length > 0 ? `${phrases.map(capitalize).join('. ')}.` : null;
}

/** Synthèse : infections respiratoires (urgences), eaux usées, alertes en saison ; rien d'inventé quand une source manque. */
function veilleLead(state: HealthSurveillanceState, now: number): string | null {
  const sentences = [respiratorySentence(state, now), wastewaterSentence(state, now), alertsSentence(state, now)]
    .filter((s): s is string => s !== null);
  return sentences.length > 0 ? sentences.join(' ') : null;
}

export function veilleHead(state: HealthSurveillanceState, summary: NationalHealthSummary, now: number): LayerHeadModel {
  return {
    theme: VEILLE_THEME, title: VEILLE_TITLE, figure: sentinellesFigure(state, now), level: summary.level,
    status: [summary.driverPhrase, periodSegment(state, now), SOURCES_SEGMENT].filter((s) => s !== ''),
    lead: veilleLead(state, now),
  };
}

// ─── Sections de l'onglet France ───

type OpenFn = VeilleViewInput['open'];

function nationalSection(summary: NationalHealthSummary, open: OpenFn): FicheSection {
  const rows = summary.inputs.map((i) => {
    const level: VigilanceLevel | 'gris' = i.late || i.level === 'nd' ? 'gris' : i.level;
    const off = i.late ? ' · en retard : écartée du niveau national' : i.unavailable ? ' : écartée du niveau national' : '';
    const text = `${i.note}${i.period !== 'n.d.' ? ` · ${i.period}` : ''}${off}`;
    return listRow({ text: i.label, value: i.value, level, noteHtml: `${escapeHtml(text)}<br>${escapeHtml(`Règle : ${RULES[i.key]}`)}` });
  }).join('');
  const counted = summary.inputs.flatMap((i) => (!i.late && i.level !== 'nd' ? [i.level] : []));
  const late = summary.inputs.filter((i) => i.late).length;
  const down = summary.inputs.filter((i) => i.unavailable).length;
  const tail = `${late > 0 ? ` · ${late} en retard` : ''}${down > 0 ? ` · ${down} indisponible${down > 1 ? 's' : ''}` : ''}`;
  return {
    id: 'national', title: 'Niveau national', collapsible: true, open: open('national', true),
    summary: levelCounts(counted, 'fr') + escapeHtml(tail),
    html: rows + note('Niveau national : le plus haut des quatre entrées ; une entrée en retard est écartée et nommée ici, de même qu’une entrée dont la source est indisponible.'),
  };
}

function alertsSection(state: HealthSurveillanceState, now: number, open: OpenFn): FicheSection {
  const base = { id: 'alerts', title: 'Alertes épidémiques', collapsible: true, open: open('alerts', false) };
  const d = state.alerts.data;
  if (!d || alertsDown(state)) return { ...base, summary: 'n.d.', html: sourceUnavailable('niveaux d’alerte Odissé') };
  if (d.levels.length === 0) return { ...base, summary: 'aucune publication', html: emptyLine('Aucun niveau d’alerte publié.') };
  const byRegion = new Map<string, RegionalAlertLevel[]>();
  for (const l of d.levels) byRegion.set(l.region, [...(byRegion.get(l.region) ?? []), l]);
  const regions = [...byRegion.entries()].sort(([a, la], [b, lb]) => {
    const ma = isMetropoleRegion(a) ? 0 : 1;
    const mb = isMetropoleRegion(b) ? 0 : 1;
    return ma - mb || (ma === 0 ? la[0].regionName.localeCompare(lb[0].regionName, 'fr') : a.localeCompare(b));
  });
  const rows = regions.map(([, lines]) => {
    const inSeason = lines.filter((l) => alertInSeason(l, now));
    const level: VigilanceLevel | 'gris' = inSeason.length > 0 ? maxLevel(inSeason.map((l) => phaseLevel(l.phase))) : 'gris';
    const text = (['grippe', 'bronchiolite'] as const).map((p) => {
      const l = lines.find((x) => x.pathology === p);
      return `${p} : ${l ? alertWords(l, now) : 'n.d.'}`;
    }).join(' · ');
    return listRow({ text: lines[0].regionName, level, note: text });
  }).join('');
  return { ...base, summary: escapeHtml(alertsSummary(d.levels, now)), html: rows + note(SCALE_NOTE) };
}

const SENTINELLES_ORDER: readonly SentinellesIndicatorKey[] = ['ira', 'covid', 'grippe', 'vrs', 'bronchiolite', 'diarrhee', 'varicelle'];
const SENTINELLES_LABEL: Readonly<Record<SentinellesIndicatorKey, string>> = {
  ira: 'IRA', covid: 'dont COVID-19', grippe: 'dont grippe', vrs: 'dont VRS', bronchiolite: 'Bronchiolite (moins de 1 an)',
  diarrhee: 'Diarrhée aiguë', varicelle: 'Varicelle',
};

function sentinellesSection(state: HealthSurveillanceState, now: number, open: OpenFn): FicheSection {
  const base = { id: 'sentinelles', title: 'Médecine générale', collapsible: true, open: open('sentinelles', true) };
  const d = state.sentinelles.data;
  if (!d) return { ...base, summary: 'n.d.', html: sourceUnavailable('réseau Sentinelles') };
  if (!d.week || d.indicators.length === 0) return { ...base, summary: 'n.d.', html: emptyLine('Aucun indicateur Sentinelles publié.') };
  const late = surveillanceLate(state, 'sentinelles', now);
  const week = weekShort(d.week.id);
  const prevWeek = weekShort(isoWeekId(shiftDate(d.week.start, -7)));
  const cell = (v: number | null): string => (v === null ? 'n.d.' : frNumber(v, 0));
  const rows = SENTINELLES_ORDER.map((key) => {
    const i = d.indicators.find((x) => x.key === key);
    if (!i) return '';
    const rate = key === 'ira' ? `<b class="lp-val fmk-num">${cell(i.rate)}</b>` : `<span class="lp-val fmk-num">${cell(i.rate)}</span>`;
    const ci = i.ciLow === null || i.ciHigh === null ? 'n.d.' : `${cell(i.ciLow)} à ${cell(i.ciHigh)}`;
    return `<tr><th scope="row">${escapeHtml(SENTINELLES_LABEL[key])}</th><td>${rate}${trendArrowHtml(trendOf(i.trend), late)}</td>`
      + `<td class="lp-faint">${ci}</td><td class="lp-faint">${cell(i.previous)}</td></tr>`;
  }).join('');
  const table = `<table class="lp-tbl"><thead><tr><th scope="col">Cas pour ${frNumber(100_000, 0)} hab.</th><th scope="col">${week}</th>`
    + `<th scope="col">IC 95${NBSP}%</th><th scope="col">${prevWeek}</th></tr></thead><tbody>${rows}</tbody></table>`;
  const top = d.topRegions.filter((r) => r.indicator === 'ira').slice(0, 3);
  const topHtml = top.length === 0 ? '' : '<h4 class="fmk-eyebrow">Régions les plus touchées (IRA)</h4>'
    + top.map((r) => kvRow(r.region, valueHtml(frNumber(r.rate, 0)))).join('');
  const text = `Taux nationaux officiels du réseau Sentinelles (France hexagonale), ${PER_100K}${d.provisional ? ` ; semaine ${week} provisoire` : ''}${late ? ' ; données en retard' : ''}.`;
  const foot = `<p class="fmk-note">${escapeHtml(text)}${d.bulletinUrl ? ` ${sourceLinkHtml('Bulletin Sentiweb Hebdo (PDF)', d.bulletinUrl)}` : ''}</p>`;
  const ira = sentinellesIra(d);
  return {
    ...base, html: table + topHtml + foot,
    summary: escapeHtml(`IRA ${cell(ira?.rate ?? null)} · ${ira?.activity ? `activité ${ira.activity}` : 'n.d.'}${late ? ' (en retard)' : ''}`),
  };
}

function wastewaterSection(state: HealthSurveillanceState, now: number, open: OpenFn): FicheSection {
  const base = { id: 'wastewater', title: 'Eaux usées · COVID-19', collapsible: true, open: open('wastewater', true) };
  const d = state.wastewater.data;
  const last = lastWastewaterPoint(d);
  if (!d) return { ...base, summary: 'n.d.', html: sourceUnavailable('SUM’eau') };
  if (!last) return { ...base, summary: 'n.d.', html: emptyLine('Aucune mesure nationale publiée.') };
  const late = surveillanceLate(state, 'wastewater', now);
  const level = late ? 'nd' : wastewaterLevel(d.points, d.lastYear);
  const stroke = level === 'nd' ? 'var(--text-primary)' : levelColorVar(level);
  const pts = d.points.flatMap((p) => {
    const at = dataDateMs(p.start);
    return p.national54 !== null && at !== null ? [{ at, value: p.national54, week: p.week }] : [];
  });
  const first = pts[0];
  if (!first) return { ...base, summary: 'n.d.', html: emptyLine('Aucune mesure nationale publiée.') };
  const from = first.at;
  const to = dataDateMs(last.start) ?? from;
  const lastYear = d.lastYear && d.lastYear.national54 !== null ? d.lastYear.national54 : null;
  const yearLabel = d.lastYear ? String(weekYear(d.lastYear.week) ?? 'un an plus tôt') : 'un an plus tôt';
  const chart = lineChart(pts, {
    label: 'Indicateur SARS-CoV-2 dans les eaux usées, 54 stations, 26 semaines', from, to, stroke, markPeak: true,
    value: (v) => frNumber(v, 0), tick: (ms) => weekShort(ms === from ? first.week : last.week), refValue: lastYear,
  });
  const legend = `<div class="lp-legend"><span class="lp-key"><i style="background:${stroke}"></i>${weekYear(last.week) ?? ''}</span>`
    + (lastYear !== null ? `<span class="lp-key"><i class="lp-dash"></i>même semaine ${escapeHtml(yearLabel)}</span>` : '') + '</div>';
  const prev = d.points.find((p) => p.start === shiftDate(last.start, -7));
  const pct = changePct(last.national54, prev?.national54);
  const ratio = twoWeekRatio(d);
  const html = chart + legend
    + kvRow(`Indicateur national (54 stations), ${weekShort(last.week)}`, `${valueHtml(frNumber(last.national54, 0))}${pct !== null ? ` ${changeHtml(pct, late)}` : ''}`)
    + (lastYear !== null ? kvRow(`Même semaine ${yearLabel}`, valueHtml(frNumber(lastYear, 0))) : '')
    + kvRow('Couverture de la dernière semaine', valueHtml(d.stationsReporting === null ? 'n.d.' : `${d.stationsReporting} stations sur ${d.stationsTotal}`))
    + note('Indicateur sans unité (virus rapporté à l’azote ammoniacal, lissé, valeurs passées réécrites à chaque livraison) : à lire en tendance ; recul de 2 semaines.');
  return { ...base, html, summary: escapeHtml(`${ratio === null ? 'n.d.' : `${ratioText(ratio)} en 2 semaines`} · ${weekShort(last.week)}${late ? ' (en retard)' : ''}`) };
}

function ministrySection(state: HealthSurveillanceState, open: OpenFn): FicheSection {
  const base = { id: 'ministry', title: 'Messages du ministère', collapsible: true, open: open('ministry', true) };
  const d = state.ministry.data;
  const caveat = `<p class="fmk-note">Messages relayés par le portail PEPS du ministère ; un message peut manquer : ${sourceLinkHtml('page officielle DGS-Urgent', d?.officialUrl ?? DGS_OFFICIAL_URL)}.</p>`;
  if (!d) return { ...base, summary: 'n.d.', html: sourceUnavailable('portail PEPS (messages DGS-Urgent et MARS)') + caveat };
  const sorted = [...d.messages].sort((a, b) => b.date.localeCompare(a.date));
  const first = sorted[0];
  if (!first) return { ...base, summary: 'aucun message', html: emptyLine('Aucun message DGS-Urgent ni MARS depuis 12 mois.') + caveat };
  const rows = sorted.slice(0, 4).map((m) => {
    const title = `${m.title}${m.reply ? ' (version mise à jour)' : ''}`;
    return listRow({ text: `${m.kind} ${m.number}`, value: parisDay(m.date), noteHtml: m.url ? sourceLinkHtml(title, m.url) : escapeHtml(title) });
  }).join('');
  const more = sorted.length - 4;
  const moreHtml = more > 0 ? note(`${more} autre${more > 1 ? 's' : ''} message${more > 1 ? 's' : ''} depuis 12 mois.`) : '';
  return { ...base, summary: escapeHtml(`${first.kind} ${first.number} du ${parisDay(first.date)}`), html: rows + moreHtml + caveat };
}

interface SourceLine { label: string; html: string; key: HealthSurveillanceKey; text: (s: HealthSurveillanceState, now: number) => string }

const lateTag = (s: HealthSurveillanceState, key: HealthSurveillanceKey, now: number): string => (surveillanceLate(s, key, now) ? ' (en retard)' : '');

const SOURCE_LINES: readonly SourceLine[] = [
  { label: 'Urgences et SOS Médecins', html: sourceLinkHtml('Odissé (Santé publique France)', ODISSE), key: 'syndromic',
    text: (s, now) => {
      const d = s.syndromic.data;
      return d?.week ? `${weekShort(d.week.id)}, publiée le ${parisDay(d.publishedAt)}${lateTag(s, 'syndromic', now)}` : 'n.d.';
    } },
  { label: 'Alertes épidémiques', html: sourceLinkHtml('Odissé (Santé publique France)', ODISSE), key: 'alerts',
    text: (s) => {
      const d = s.alerts.data;
      if (!d) return 'n.d.';
      const n = d.ignoredRegionCodes.length;
      const ignored = n > 0 ? ` ; ${n} code${n > 1 ? 's' : ''} de région sans libellé écarté${n > 1 ? 's' : ''} (${d.ignoredRegionCodes.join(', ')})` : '';
      return `dernière semaine ${d.latestWeek ? weekShort(d.latestWeek.id) : 'n.d.'}${ignored}`;
    } },
  { label: 'Médecine générale', html: sourceLinkHtml('Réseau Sentinelles', 'https://www.sentiweb.fr'), key: 'sentinelles',
    text: (s, now) => {
      const d = s.sentinelles.data;
      return d?.week ? `${weekShort(d.week.id)}${d.provisional ? ' provisoire' : ''}${lateTag(s, 'sentinelles', now)}` : 'n.d.';
    } },
  { label: 'Eaux usées', html: sourceLinkHtml('SUM’eau (Santé publique France)', `${ODISSE}/explore/dataset/sum-eau-indicateurs/`), key: 'wastewater',
    text: (s, now) => {
      const last = lastWastewaterPoint(s.wastewater.data);
      return last ? `${weekShort(last.week)}, publiée le ${parisDay(s.wastewater.data?.publishedAt)}${lateTag(s, 'wastewater', now)}` : 'n.d.';
    } },
  { label: 'Veille internationale',
    html: `${sourceLinkHtml('OMS', 'https://www.who.int/emergencies/disease-outbreak-news')}, ${sourceLinkHtml('ECDC', 'https://www.ecdc.europa.eu/en/threats-and-outbreaks/reports-and-data/weekly-threats')}`,
    key: 'international', text: (s) => `dernier message le ${parisDay(surveillanceDataDate(s, 'international'))}` },
  { label: 'Messages du ministère', html: sourceLinkHtml('portail PEPS', 'https://peps.sante.gouv.fr/actu/actualites.html'), key: 'ministry',
    text: (s) => `dernier message le ${parisDay(surveillanceDataDate(s, 'ministry'))}` },
  { label: 'Médicaments', html: sourceLinkHtml('ANSM', 'https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments'), key: 'drugs',
    text: (s, now) => `liste mise à jour le ${parisDay(s.drugs.data?.latestUpdate)}${lateTag(s, 'drugs', now)}` },
  { label: 'Rappels de produits', html: sourceLinkHtml('RappelConso', 'https://rappel.conso.gouv.fr'), key: 'recalls',
    text: (s, now) => `dernière publication le ${parisDay(surveillanceDataDate(s, 'recalls'))}${lateTag(s, 'recalls', now)}` },
];

/** « Méthode et sources » (tous les onglets) : chaque source datée ou dite indisponible (S3), règles de retard (S2). */
export function methodSection(state: HealthSurveillanceState, now: number, open: OpenFn): FicheSection {
  const rows = SOURCE_LINES.map((line) => {
    const slot = state[line.key];
    const status = slot.data === null ? (slot.error !== null ? 'source indisponible' : 'chargement…') : line.text(state, now);
    const failed = slot.data !== null && slot.error !== null ? ' ; source injoignable au dernier essai' : '';
    return kvRow(line.label, `${line.html} · ${escapeHtml(`${status}${failed}`)}`);
  }).join('');
  const incidents = SOURCE_LINES.flatMap((line) => state[line.key].data?.errors ?? []);
  const down = SOURCE_LINES.filter((line) => state[line.key].data === null && state[line.key].error !== null).length;
  const html = rows
    + note('Retard : urgences et SOS Médecins au-delà de 17 jours après la fin de la semaine ; Sentinelles au-delà de 13 jours ; '
      + 'eaux usées au-delà de 28 jours après le début de la semaine ; médicaments au-delà de 7 jours sans mise à jour ; '
      + 'rappels au-delà de 4 jours sans publication. Une donnée en retard perd ses couleurs et sort du niveau national.')
    + note('Hors saison n’est pas un retard : l’absence de niveau d’alerte se lit « hors saison » avec la date et le niveau de la dernière '
      + 'publication. Messages de l’OMS, de l’ECDC et du ministère : datés un par un, jamais en retard.')
    + note(SCALE_NOTE)
    + note('Données agrégées seulement : aucune donnée nominative ; médicaments et rappels décrivent des produits.')
    + (incidents.length > 0 ? note(`Incidents de lecture : ${incidents.join(' ; ')}.`) : '');
  return {
    id: 'method', title: 'Méthode et sources', collapsible: true, open: open('method', false), tone: 'reference',
    summary: escapeHtml(`${SOURCE_LINES.length} sources${down > 0 ? ` · ${down} indisponible${down > 1 ? 's' : ''}` : ''}`), html,
  };
}

export function allSourcesFailed(state: HealthSurveillanceState): boolean {
  return Object.values(state).every((slot) => slot.data === null && slot.error !== null);
}

export function veilleLoadingView(tab: VeilleTab): LayerView {
  return {
    head: { theme: VEILLE_THEME, title: VEILLE_TITLE, status: ['chargement…'] },
    tabs: veilleTabs(null, 0), activeTab: tab, sections: [], bodyHtml: loadingBody(),
  };
}

/** Onglet France : niveau national, alertes, médecine générale, eaux usées, messages du ministère, méthode et sources. */
export function buildVeilleFranceView(input: VeilleViewInput): LayerView {
  const { state, now, open } = input;
  if (state === null) return veilleLoadingView('france');
  const summary = nationalSummary(state, now);
  return {
    head: veilleHead(state, summary, now), tabs: veilleTabs(state, now), activeTab: 'france',
    sections: [
      nationalSection(summary, open), alertsSection(state, now, open), sentinellesSection(state, now, open),
      wastewaterSection(state, now, open), ministrySection(state, open), methodSection(state, now, open),
    ],
    bodyHtml: allSourcesFailed(state) ? sourceErrorCallout(null, now) : undefined,
  };
}
