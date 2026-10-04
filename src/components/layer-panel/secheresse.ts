// src/components/layer-panel/secheresse.ts : vue pure du panneau Sécheresse (spec 2026-10-04 environnement § 3.1) ; aucun accès réseau
// ni DOM. Arrêtés de restriction d'eau en vigueur par département (VigiEau). Un stock (E2) : affiché, jamais dans le score ni dans
// une situation. Date des arrêtés (S1), retard au-delà de 36 h (S2), périmètre dit (E4), courbe quotidienne depuis la mise en service
// (E5, « référence en construction »). La vigilance (sensibilisation) prend une teinte de catégorie, jamais une couleur de niveau.
import type { DroughtDept, DroughtLevel, DroughtResponse } from '../../types/index.ts';
import { droughtLevel, isEnvironmentDataLate } from '../../services/environment-levels.ts';
import { levelColorVar, type VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { stackedDayBars, type DayStack } from './chart.ts';
import { NBSP, frNumber } from './format.ts';
import { barRow, listRow, loadingBody, sourceErrorCallout, sourceLinkHtml, type LayerHeadModel, type LayerView } from './frame.ts';
import {
  CAT_SECHERESSE_VIGILANCE, DROUGHT_LEVEL, DROUGHT_WORD, ENVIRONMENT_THEME, capitalize, clockOf, dateOf, dayMonthClock, glueEnvUnits, note, plural,
  readErrors, shortDate, sourceDown, stamp,
} from './environment-format.ts';

export const SECHERESSE_TITLE = 'Sécheresse';
type OpenFn = (sectionId: string, byDefault: boolean) => boolean;
export interface SecheresseViewInput {
  drought: DroughtResponse | null;
  droughtError: string | null;
  /** La carte peut recentrer (carte WebGL) ; sinon les lignes ne se donnent pas pour cliquables. */
  canFocus: boolean;
  now: number;
  open: OpenFn;
}

const ORDER: readonly DroughtLevel[] = ['crise', 'alerte_renforcee', 'alerte', 'vigilance'];
const RANK: Readonly<Record<DroughtLevel, number>> = { vigilance: 1, alerte: 2, alerte_renforcee: 3, crise: 4 };
const HISTORY_WINDOW_DAYS = 30;
const MAX_NAMED = 12;
const VIGIEAU_URL = 'https://vigieau.gouv.fr';
const DOWN = 'arrêtés VigiEau';
const NONE_WORD = 'aucun arrêté';
/** Amendement 15 : département publié « unavailable » par VigiEau ; jamais « aucun arrêté ». */
const UNAVAILABLE_WORD = 'donnée indisponible';
const LATE_STROKE = 'var(--text-primary)';

type Tint = { level: VigilanceLevel; color?: undefined } | { color: string; level?: undefined };

/** Couleur d'un niveau VigiEau (R2) : crise, alerte renforcée, alerte en couleur de niveau ; vigilance en teinte de catégorie. */
function tintOf(level: DroughtLevel | null): Tint {
  if (level === null) return { level: 'vert' };
  const l = DROUGHT_LEVEL[level];
  return l === 'categorie' ? { color: CAT_SECHERESSE_VIGILANCE } : { level: l };
}

function cssOf(level: DroughtLevel): string {
  const l = DROUGHT_LEVEL[level];
  return l === 'categorie' ? CAT_SECHERESSE_VIGILANCE : levelColorVar(l);
}

function wordOf(level: DroughtLevel | null): string {
  return level === null ? NONE_WORD : DROUGHT_WORD[level];
}

function deptKey(code: string): number {
  if (code === '2A') return 20.1;
  if (code === '2B') return 20.2;
  return Number(code);
}

const isMetropole = (code: string): boolean => code.length === 2;

/** Niveau le plus haut d'abord (crise, alerte renforcée, alerte, vigilance, aucun arrêté, donnée indisponible), puis code INSEE. */
export function sortDroughtDepartments(depts: readonly DroughtDept[]): DroughtDept[] {
  const rank = (x: DroughtDept): number => (!x.available ? -1 : x.max ? RANK[x.max] : 0);
  return [...depts].sort((a, b) => rank(b) - rank(a) || deptKey(a.dept) - deptKey(b.dept));
}

function droughtLate(d: DroughtResponse, now: number): boolean {
  return isEnvironmentDataLate('vigieau', d.asOf, now);
}

// ─── En-tête ───

function leadOf(d: DroughtResponse): string {
  const c = d.counts;
  const potable = d.departments.filter((x) => x.potable === 'crise').length;
  return `${plural(c.crise, 'département')} en crise, ${frNumber(c.alerte_renforcee, 0)} en alerte renforcée, ${frNumber(c.alerte, 0)} en alerte, `
    + `${frNumber(c.vigilance, 0)} en vigilance. Eau potable : ${plural(potable, 'département')} en crise.`;
}

function headOf(d: DroughtResponse, now: number): LayerHeadModel {
  const late = droughtLate(d, now);
  const verdict = droughtLevel(d);
  const crise = d.counts.crise;
  return {
    theme: ENVIRONMENT_THEME, title: SECHERESSE_TITLE,
    figure: {
      value: frNumber(crise, 0),
      caption: `départements en crise · arrêtés en vigueur au ${dayMonthClock(d.asOf)}${late ? ' (en retard)' : ''}`,
      level: late || verdict.level === 'nd' ? null : crise > 0 ? 'rouge' : 'vert',
    },
    level: late ? 'nd' : verdict.level,
    status: [late ? 'niveau suspendu : arrêtés VigiEau en retard' : glueEnvUnits(verdict.reason), stamp('VigiEau', d.asOf, late, now)],
    lead: late || d.departments.length === 0 ? null : leadOf(d),
  };
}

// ─── Par niveau ───

function historyChart(d: DroughtResponse, late: boolean, now: number): string {
  const days = d.history.days.slice(-HISTORY_WINDOW_DAYS);
  const stacks: DayStack[] = days.flatMap((day) => {
    const ms = Date.parse(`${day.date}T12:00:00Z`);
    return Number.isFinite(ms)
      ? [{ day: ms, parts: ORDER.map((l) => ({ value: day[l], color: late ? LATE_STROKE : cssOf(l), label: DROUGHT_WORD[l] })) }]
      : [];
  });
  const chart = stacks.length === 0 ? '' : stackedDayBars(stacks, {
    label: 'Départements par niveau de restriction, par jour', value: (v) => frNumber(v, 0), tick: (ms) => shortDate(new Date(ms).toISOString(), now),
  });
  const keys = chart === '' ? '' : `<div class="lp-legend">${ORDER.map((l) => `<span class="lp-key"><i style="background:${late ? LATE_STROKE : cssOf(l)}"></i>${escapeHtml(DROUGHT_WORD[l])}</span>`).join('')}</div>`;
  const n = d.history.days.length;
  const since = d.history.since ? dateOf(`${d.history.since}T12:00:00Z`) : 'n.d.';
  const building = n < HISTORY_WINDOW_DAYS
    ? note(`Courbe : référence en construction (${plural(n, 'jour')}), série quotidienne relevée par le serveur depuis le ${since} ; elle couvrira 30${NBSP}jours une fois complète.`)
    : note(`Courbe : départements par niveau, un relevé par jour d’arrêtés, 30 derniers jours (depuis le ${since}).`);
  return chart + keys + building;
}

function niveauxSection(d: DroughtResponse | null, now: number, open: OpenFn): FicheSection {
  const base = { id: 'niveaux', title: 'Par niveau', collapsible: true, open: open('niveaux', true) };
  if (!d || d.departments.length === 0) return { ...base, summary: 'n.d.', html: sourceDown(DOWN) };
  const late = droughtLate(d, now);
  // Amendement 15 : un département « unavailable » n'entre pas dans la répartition ; il est dit à part, en gris.
  const unavailable = d.departments.filter((x) => !x.available);
  const total = d.departments.length - unavailable.length;
  const lines: Array<{ key: DroughtLevel | null; n: number }> = [...ORDER.map((key) => ({ key, n: d.counts[key] })), { key: null, n: d.counts.aucun }];
  const rows = lines.map(({ key, n }) => {
    const label = capitalize(wordOf(key));
    if (late) return listRow({ text: label, value: frNumber(n, 0), level: 'gris' });
    return barRow({ label, pct: total > 0 ? (n / total) * 100 : null, value: frNumber(n, 0), ...tintOf(key) });
  }).join('');
  return {
    ...base, summary: escapeHtml(`${frNumber(d.counts.crise, 0)} en crise${late ? ' (en retard)' : ''}`),
    html: rows
      + (unavailable.length === 0 ? '' : listRow({ text: capitalize(UNAVAILABLE_WORD), value: frNumber(unavailable.length, 0), level: 'gris', note: unavailable.map((x) => x.name).join(', ') }))
      + note(`Jauge : part des ${frNumber(total, 0)} départements dont VigiEau publie les arrêtés, au niveau le plus haut de leurs arrêtés${unavailable.length > 0 ? ` ; ${plural(unavailable.length, 'département')} sans donnée (« unavailable »), hors répartition` : ''}.`)
      + historyChart(d, late, now),
  };
}

// ─── Eau potable ───

function potableSection(d: DroughtResponse | null, now: number, open: OpenFn): FicheSection {
  const base = { id: 'eau-potable', title: 'Eau potable', collapsible: true, open: open('eau-potable', false) };
  if (!d || d.departments.length === 0) return { ...base, summary: 'n.d.', html: sourceDown(DOWN) };
  const late = droughtLate(d, now);
  const count = (level: DroughtLevel | null): number => d.departments.filter((x) => x.available && x.potable === level).length;
  const rows = [...ORDER, null].map((key) => listRow({
    text: capitalize(wordOf(key)), value: frNumber(count(key), 0), ...(late ? { level: 'gris' as const } : tintOf(key)),
  })).join('');
  const crisis = sortDroughtDepartments(d.departments.filter((x) => x.potable === 'crise'));
  const named = crisis.slice(0, MAX_NAMED).map((x) => x.name).join(', ');
  const rest = crisis.length - MAX_NAMED;
  const names = crisis.length === 0 ? note('Aucun département en crise pour l’eau potable.')
    : note(`En crise pour l’eau potable : ${named}${rest > 0 ? ` et ${plural(rest, 'autre')}` : ''}.`);
  return {
    ...base, summary: escapeHtml(`${frNumber(crisis.length, 0)} en crise${late ? ' (en retard)' : ''}`),
    html: rows + names + note('Eau potable : niveau le plus haut des zones d’alimentation en eau potable du département (champ AEP de VigiEau) ; la vigilance n’est pas une restriction.'),
  };
}

// ─── Départements ───

function deptRow(x: DroughtDept, late: boolean, canFocus: boolean): string {
  const focus = canFocus && isMetropole(x.dept);
  if (!x.available) {
    // Amendement 15 : donnée indisponible, en gris, jamais « aucun arrêté ».
    const why = 'VigiEau ne publie pas ses arrêtés (« unavailable »)';
    return listRow({
      text: `${x.name} (${x.dept})`, value: UNAVAILABLE_WORD, level: 'gris', note: x.region ? `${why} · ${x.region}` : why,
      ...(focus ? { data: { dept: x.dept }, link: true } : {}),
    });
  }
  const usages = `eaux superficielles ${wordOf(x.superficielle)} · eaux souterraines ${wordOf(x.souterraine)} · eau potable ${wordOf(x.potable)}`;
  return listRow({
    text: `${x.name} (${x.dept})`, value: wordOf(x.max), ...(late ? { level: 'gris' as const } : tintOf(x.max)),
    note: x.region ? `${usages} · ${x.region}` : usages,
    ...(focus ? { data: { dept: x.dept }, link: true } : {}),
  });
}

function departementsSection(d: DroughtResponse | null, canFocus: boolean, now: number, open: OpenFn): FicheSection {
  const base = { id: 'departements', title: 'Départements', collapsible: true, open: open('departements', false) };
  if (!d || d.departments.length === 0) return { ...base, summary: 'n.d.', html: sourceDown(DOWN) };
  const late = droughtLate(d, now);
  const rows = sortDroughtDepartments(d.departments).map((x) => deptRow(x, late, canFocus)).join('');
  return {
    ...base, summary: escapeHtml(`${plural(d.departments.length, 'département')}${late ? ' (en retard)' : ''}`),
    html: rows + (canFocus ? note('Clic sur un département de métropole : le département sur la carte.') : ''),
  };
}

// ─── Méthode et sources ───

function methodSection(d: DroughtResponse | null, failed: boolean, now: number, open: OpenFn): FicheSection {
  const late = d ? droughtLate(d, now) : false;
  const state = d && d.asOf !== null
    ? `arrêtés en vigueur au ${dayMonthClock(d.asOf)}${late ? ' (en retard)' : ''} · lecture du serveur ${clockOf(d.readAt, now)}`
    : failed ? 'source indisponible' : 'chargement…';
  const none = (d?.departments ?? []).filter((x) => x.available && x.max === null && x.superficielle === null && x.souterraine === null && x.potable === null).map((x) => x.name);
  const missing = (d?.departments ?? []).filter((x) => !x.available).map((x) => x.name);
  const html = kvRow('Arrêtés', `${sourceLinkHtml('VigiEau (ministère de la Transition écologique)', VIGIEAU_URL)} · ${escapeHtml(state)}`)
    + kvRow('Relève', escapeHtml(`serveur toutes les 6${NBSP}h ; série quotidienne depuis la mise en service`))
    + note('Un stock, pas un événement (E2) : une restriction en vigueur depuis des semaines est affichée, mais n’entre ni dans le score France ni dans une situation.')
    + note('Pastille : rouge si au moins un département est en crise ; orange en alerte renforcée ; jaune en alerte ; vert sinon. Couleurs : crise rouge, alerte renforcée orange, alerte jaune, aucun arrêté vert ; la vigilance (sensibilisation, sans restriction) prend une teinte bleue de catégorie, pas une couleur de niveau.')
    + note(`Périmètre : ${plural(d?.departments.length ?? 0, 'département')} publiés par VigiEau (métropole et outre-mer) ; la carte dessine les 96 de métropole${none.length > 0 ? ` ; sans arrêté : ${none.join(', ')}` : ''}${missing.length > 0 ? ` ; donnée indisponible (« unavailable », jamais lue comme « aucun arrêté ») : ${missing.join(', ')}` : ''}.`)
    + note(`Retard : au-delà de 36${NBSP}h après la date des arrêtés ; une donnée en retard perd ses couleurs et la pastille passe à n.d.`)
    + readErrors(d?.errors ?? []);
  return { id: 'methode', title: 'Méthode et sources', collapsible: true, open: open('methode', false), tone: 'reference', summary: 'VigiEau', html };
}

// ─── Assemblage ───

export function buildSecheresseView(input: SecheresseViewInput): LayerView {
  const { drought: d, droughtError, canFocus, now, open } = input;
  if (d === null && droughtError === null) {
    return { head: { theme: ENVIRONMENT_THEME, title: SECHERESSE_TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  }
  const sections = [
    niveauxSection(d, now, open), potableSection(d, now, open), departementsSection(d, canFocus, now, open), methodSection(d, droughtError !== null, now, open),
  ];
  if (d === null) {
    return {
      head: {
        theme: ENVIRONMENT_THEME, title: SECHERESSE_TITLE, level: 'nd',
        figure: { value: 'n.d.', caption: 'départements en crise', level: null }, status: ['VigiEau injoignable'],
      },
      sections, bodyHtml: sourceErrorCallout(null, now),
    };
  }
  const asOfMs = d.asOf ? Date.parse(d.asOf) : Number.NaN;
  return { head: headOf(d, now), sections, bodyHtml: droughtError !== null ? sourceErrorCallout(Number.isFinite(asOfMs) ? asOfMs : null, now) : undefined };
}
