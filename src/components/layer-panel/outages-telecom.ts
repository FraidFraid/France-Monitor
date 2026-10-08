// src/components/layer-panel/outages-telecom.ts : vue pure du panneau Télécoms (spec 2026-10-08 panneaux pannes § 2.1) ; aucun accès réseau
// ni DOM. Pannes imprévues récentes (moins de 24 h avant la publication du fichier ARCEP) en gros chiffre ; longues, maintenances et sans
// date à part (P1) ; par opérateur, par département, depuis le fichier précédent, ancienneté, liste paginée, courbe de 30 jours.
// Fichier en retard (isArcepFileLate, passé explicitement) : « (en retard) », plus aucune couleur de niveau ni de catégorie (R30).
import type { TelecomOutagesResponse, TelecomSite } from '../../types/index.ts';
import { parisDayOf } from '../../services/environment-levels.ts';
import { isArcepFileLate, telecomLevel } from '../../services/outages-levels.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { lineChart } from './chart.ts';
import { NBSP, frNumber } from './format.ts';
import { barRow, emptyLine, listRow, loadingBody, sourceErrorCallout, sourceLinkHtml, valueHtml, type LayerView } from './frame.ts';
import {
  OUTAGES_THEME, OUT_LATE_VAR, OUT_LONG_VAR, OUT_MAINT_VAR, OUT_RECENT_VAR, countText, dayMonth, note, parisClock, placeOf, sinceText,
} from './outages-format.ts';

export const TELECOM_TITLE = 'Télécoms mobiles';
export const TELECOM_PAGE = 20;
const ARCEP_URL = 'https://www.data.gouv.fr/datasets/5f7c7fae9cd6c79b58da3e20/';
const DAY_MS = 86_400_000;
const FIGURE_CAPTION = `antennes en panne imprévue depuis moins de 24${NBSP}h`;
const BAND_LABEL = { '1-3j': `1 à 3${NBSP}jours`, '3-7j': `3 à 7${NBSP}jours`, '7-30j': `7 à 30${NBSP}jours`, '30j+': `plus de 30${NBSP}jours` } as const;
const BAND_ORDER = ['1-3j', '3-7j', '7-30j', '30j+'] as const;

type OpenFn = (sectionId: string, byDefault: boolean) => boolean;
export interface TelecomViewInput { telecom: TelecomOutagesResponse | null; error: string | null; canFocus: boolean; now: number; open: OpenFn; shown: number }

/** Jour de Paris précédent « AAAA-MM-JJ » (midi UTC du jour : à l'abri des changements d'heure). */
function dayBefore(day: string): string {
  return parisDayOf(Date.parse(`${day}T12:00:00Z`) - DAY_MS);
}

/** « fichier ARCEP du 08/10, publié à 11 h 02 » ; la veille : « de la veille (07/10) » ; plus ancien : « du jj/mm », « (en retard) » compris. */
function fileStatus(file: NonNullable<TelecomOutagesResponse['file']>, now: number): string {
  const today = parisDayOf(now);
  const label = file.day === today || file.day !== dayBefore(today)
    ? `fichier ARCEP du ${dayMonth(file.day)}`
    : `fichier ARCEP de la veille (${dayMonth(file.day)})`;
  const late = isArcepFileLate(file.day, now) ? ' (en retard)' : '';
  return `${label}, publié à ${parisClock(Date.parse(file.publishedAt))}${late}`;
}

function siteRow(s: TelecomSite, now: number, canFocus: boolean, isLate: boolean): string {
  const what = s.techs.length > 0 ? s.techs.join(', ') : 'technologies n.d.';
  const cut = [s.voice === 'HS' ? 'voix coupée' : null, s.data === 'HS' ? 'données coupées' : null].filter((x): x is string => x !== null).join(', ');
  const color = isLate ? OUT_LATE_VAR : s.cls === 'recente' ? OUT_RECENT_VAR : s.cls === 'longue' ? OUT_LONG_VAR : OUT_MAINT_VAR;
  return listRow({
    text: `${s.commune ?? 'commune n.d.'} · ${s.operator}`, value: sinceText(s.since, now), color,
    note: [placeOf(s.dept), `${what} hors service`, cut, s.detail].filter((x): x is string => x !== null && x.length > 0).join(' · '),
    ...(canFocus ? { data: { site: s.id }, link: true } : {}),
  });
}

function sections(t: TelecomOutagesResponse, input: TelecomViewInput, isLate: boolean): FicheSection[] {
  const { now, open, canFocus, shown } = input;
  const s = t.summary;
  if (s === null) return [];
  const mark = isLate ? { level: 'gris' as const } : { color: OUT_RECENT_VAR };
  const operators = t.byOperator.map((o) => listRow({
    text: o.operator, value: countText(o.recent, 'récente', 'récentes'), ...mark,
    note: `longues${NBSP}: ${frNumber(o.long, 0)} · maintenances${NBSP}: ${frNumber(o.maintenance, 0)} · voix coupée${NBSP}: ${frNumber(o.voiceCut, 0)} · données coupées${NBSP}: ${frNumber(o.dataCut, 0)}`,
  })).join('');
  const depts = t.byDept.slice(0, 12).map((d) => listRow({
    text: placeOf(d.dept), value: countText(d.recent, 'récente', 'récentes'), ...mark,
    ...(canFocus && d.dept !== null ? { data: { dept: d.dept }, link: true } : {}),
  })).join('');
  const evolution = s.newSincePrevious === null || s.resolvedSincePrevious === null || t.previousFile === null
    ? emptyLine('Fichier précédent illisible : comparaison n.d.')
    : kvRow(`Depuis le fichier du ${dayMonth(t.previousFile.day)}`, valueHtml(`${countText(s.newSincePrevious, 'nouvelle', 'nouvelles')} · ${countText(s.resolvedSincePrevious, 'rétablie', 'rétablies')}`));
  const maxBand = Math.max(1, s.recent, ...Object.values(s.bands));
  const bands = barRow({ label: `moins de 24${NBSP}h`, pct: (s.recent / maxBand) * 100, value: frNumber(s.recent, 0), color: isLate ? OUT_LATE_VAR : OUT_RECENT_VAR })
    + BAND_ORDER.map((b) => barRow({ label: BAND_LABEL[b], pct: (s.bands[b] / maxBand) * 100, value: frNumber(s.bands[b], 0), color: isLate ? OUT_LATE_VAR : OUT_LONG_VAR })).join('');
  const recent = t.sites.filter((x) => x.cls === 'recente');
  const left = recent.length - shown;
  const recentRows = recent.slice(0, shown).map((x) => siteRow(x, now, canFocus, isLate)).join('')
    + (left > 0 ? `<button type="button" class="fmk-link" data-more="recentes">Afficher ${frNumber(Math.min(TELECOM_PAGE, left), 0)} de plus (${countText(left, 'restante', 'restantes')})</button>` : '');
  const maint = t.sites.filter((x) => x.cls === 'maintenance');
  const maintRows = maint.slice(0, 40).map((x) => siteRow(x, now, canFocus, isLate)).join('')
    + (canFocus ? '<button type="button" class="fmk-link" data-option="maintenances">Afficher ou masquer les maintenances sur la carte</button>' : '');
  const points = t.history.map((h) => ({ at: Date.parse(`${h.day}T12:00:00Z`), value: h.recent })).filter((p) => Number.isFinite(p.at));
  const first = points[0];
  const last = points[points.length - 1];
  const curve = first !== undefined && last !== undefined && points.length >= 2
    ? lineChart(points, {
      label: 'Antennes en panne imprévue récente par fichier, 30 jours', from: first.at, to: last.at, stroke: isLate ? OUT_LATE_VAR : OUT_RECENT_VAR,
      value: (v) => frNumber(v, 0), tick: (ms) => dayMonth(new Date(ms).toISOString().slice(0, 10)), markPeak: true,
    }) + (points.length < 30 ? note(`Référence en construction (${countText(points.length, 'fichier', 'fichiers')} sur 30).`) : '')
    : emptyLine('Courbe en construction : un seul fichier lu.');
  const method = note(`Une panne imprévue est « récente » si elle a commencé moins de 24${NBSP}h avant la publication du fichier de l’ARCEP (vers 11${NBSP}h). Les pannes plus anciennes, les maintenances et les pannes sans date sont comptées à part : un stock n’est pas une panne du moment.`)
    + note('Voix et données coupées : état agrégé publié par l’ARCEP pour chaque site. Un site est compté une fois par opérateur.')
    + `<p class="fmk-note">${sourceLinkHtml('ARCEP, sites mobiles indisponibles (Licence Ouverte)', ARCEP_URL)}</p>`;
  const noneRecent = emptyLine(`Aucune panne imprévue de moins de 24${NBSP}h dans le fichier.`);
  return [
    { id: 'operateurs', title: 'Par opérateur', collapsible: true, open: open('operateurs', true), html: operators || emptyLine('Aucun opérateur dans le fichier.') },
    { id: 'departements', title: 'Pannes récentes par département', collapsible: true, open: open('departements', true), html: depts || noneRecent },
    { id: 'evolution', title: 'Depuis le fichier précédent', collapsible: true, open: open('evolution', true), html: evolution },
    { id: 'anciennete', title: 'Ancienneté des pannes imprévues', collapsible: true, open: open('anciennete', true), html: bands + (s.undated > 0 ? note(`${countText(s.undated, 'panne', 'pannes')} sans date de début, comptée${s.undated > 1 ? 's' : ''} à part.`) : '') },
    { id: 'recentes', title: 'Pannes récentes', collapsible: true, open: open('recentes', true), summary: escapeHtml(frNumber(recent.length, 0)), html: recentRows || noneRecent },
    { id: 'maintenances', title: 'Maintenances', collapsible: true, open: open('maintenances', false), summary: escapeHtml(frNumber(maint.length, 0)), html: maintRows || emptyLine('Aucune maintenance dans le fichier.') },
    { id: 'courbe', title: 'Pannes récentes, 30 jours', collapsible: true, open: open('courbe', true), html: curve },
    { id: 'methode', title: 'Méthode et source', collapsible: true, open: open('methode', false), html: method },
  ];
}

export function buildTelecomView(input: TelecomViewInput): LayerView {
  const { telecom: t, error, now } = input;
  if (t === null && error === null) {
    return { head: { theme: OUTAGES_THEME, title: TELECOM_TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  }
  if (t === null || t.summary === null || t.file === null) {
    const reasons = [error, ...(t?.errors ?? [])].filter((x): x is string => x !== null && x.length > 0);
    return {
      head: { theme: OUTAGES_THEME, title: TELECOM_TITLE, level: 'nd', figure: { value: 'n.d.', caption: FIGURE_CAPTION, level: null }, status: ['fichier ARCEP indisponible'] },
      sections: [], bodyHtml: sourceErrorCallout(null, now) + reasons.map(note).join(''),
    };
  }
  const isLate = isArcepFileLate(t.file.day, now);
  const level = telecomLevel(t);
  const figure = { value: frNumber(t.summary.recent, 0), caption: FIGURE_CAPTION, ...(isLate ? { level: null } : {}) };
  return {
    head: { theme: OUTAGES_THEME, title: TELECOM_TITLE, figure, level: isLate || level === null ? 'nd' : level, status: [fileStatus(t.file, now)] },
    sections: sections(t, input, isLate),
    ...(error !== null ? { bodyHtml: sourceErrorCallout(Date.parse(t.file.publishedAt), now) } : {}),
  };
}
