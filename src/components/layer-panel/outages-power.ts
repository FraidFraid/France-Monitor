// src/components/layer-panel/outages-power.ts : vue pure du panneau Électricité (spec 2026-10-08 panneaux pannes § 2.2) ; aucun accès réseau
// ni DOM. MW de production perdus en arrêts imprévus en gros chiffre (paliers du parc nucléaire, relevés par Écowatt) ; lignes haute tension
// indisponibles ou réduites non planifiées ; maintenances ; annonces à 7 jours ; Écowatt ; îles ; ligne fixe sur les coupures chez les particuliers.
// EDF muet (jamais lu, ou en échec : R32) : gros chiffre et pastille n.d., jamais le total partiel des seules lignes IIP. EDF en retard
// (dernière lecture réussie + 2 h, R20) : « (en retard) », plus aucune couleur de niveau ni de catégorie.
import type { EcowattOfficial, EcowattSignal, PowerOutagesResponse, PowerUnitOutage, TransmissionOutage } from '../../types/index.ts';
import { parisDayOf } from '../../services/environment-levels.ts';
import { ecowattToday, ecowattUpcoming } from '../../services/ecowatt-official.ts';
import { isOutagesDataLate, powerLevel, powerUnplannedMw } from '../../services/outages-levels.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { absoluteTime, kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { lineChart } from './chart.ts';
import { NBSP, formatGw, formatMw, frNumber } from './format.ts';
import { emptyLine, listRow, loadingBody, sourceErrorCallout, sourceLinkHtml, valueHtml, type LayerView } from './frame.ts';
import {
  OUTAGES_THEME, OUT_LATE_VAR, OUT_MAINT_VAR, OUT_RECENT_VAR, countText, dayMonth, moreNote, note, parisClock, sinceText, when,
} from './outages-format.ts';

export const POWER_TITLE = 'Électricité : production et transport';
const FIGURE_CAPTION = 'de production perdus en arrêts imprévus en ce moment';
const ENEDIS_URL = 'https://www.enedis.fr/panne-et-interruption';
const EDF_URL = 'https://opendata.edf.fr/datasets/indisponibilites-des-moyens-de-production-edf-sa';
const IIP_URL = 'https://iip.cloud-rte-france.com';
const ECOWATT_WORD: Readonly<Record<EcowattSignal, string>> = { green: 'pas d’alerte', orange: 'système tendu', red: 'système très tendu' };
const ECOWATT_LEVEL: Readonly<Record<EcowattSignal, VigilanceLevel>> = { green: 'vert', orange: 'orange', red: 'rouge' };
const ISLAND_WORD = { reunion: 'La Réunion', corse: 'Corse' } as const;
/** R14 : table blanche des couleurs du signal horaire SEI ; tout autre mot (« bleu », « gris »…) n'a pas de pastille. */
const ISLAND_LEVEL: Readonly<Record<string, VigilanceLevel>> = { vert: 'vert', jaune: 'jaune', orange: 'orange', rouge: 'rouge' };
const MAINTENANCE_ROWS = 30;
const UPCOMING_ROWS = 20;

type OpenFn = (sectionId: string, byDefault: boolean) => boolean;
export interface PowerViewInput { power: PowerOutagesResponse | null; error: string | null; ecowatt: EcowattOfficial | null; canFocus: boolean; now: number; open: OpenFn }

/** Ce que chaque partie peut dire : EDF muet (jamais lu ou en échec), EDF et RTE en retard. */
interface Freshness { edfMute: boolean; edfNever: boolean; edfGrey: boolean; iipGrey: boolean }

/** Couleur d'une ligne : catégorie, ou gris si la partie qui la fournit est en retard ou muette. */
function colorOf(u: PowerUnitOutage, category: string, f: Freshness): string {
  return (u.source === 'edf' ? f.edfGrey : f.iipGrey) ? OUT_LATE_VAR : category;
}

function unitRow(u: PowerUnitOutage, now: number, canFocus: boolean, color: string): string {
  const span = u.end === null ? `depuis le ${when(u.start)}, fin n.d.` : `du ${when(u.start)} au ${when(u.end)}`;
  return listRow({
    text: `${u.name} · ${u.sector}`, value: formatMw(u.lostMw), color,
    note: [span, sinceText(u.start, now), u.cause, u.source === 'edf' ? 'EDF' : 'RTE IIP'].filter((x): x is string => x !== null && x.length > 0).join(' · '),
    ...(u.nuclear ? { data: { 'open-nuclear': u.name }, link: true } : canFocus ? { data: { unit: u.name }, link: true } : {}),
  });
}

/** « hors service » seulement si chaque sens est lu et entièrement indisponible ; sinon de la capacité reste, la ligne est « réduite ». */
function lineState(l: TransmissionOutage): string {
  const allOut = l.directions.length > 0 && l.directions.every((d) => d.unavailableMw !== null && d.installedMw !== null && d.unavailableMw >= d.installedMw);
  return allOut ? 'hors service' : 'réduite';
}

function lineRow(l: TransmissionOutage, color: string): string {
  const dirs = l.directions.map((d) => `${d.label}${NBSP}: ${d.unavailableMw === null ? 'n.d.' : formatMw(d.unavailableMw)} indisponibles sur ${d.installedMw === null ? 'n.d.' : formatMw(d.installedMw)}`).join(' · ');
  return listRow({
    text: `${l.asset} · ${lineState(l)}`, value: l.end === null ? 'fin n.d.' : `jusqu’au ${when(l.end)}`, color,
    note: [dirs, l.reason, `publié le ${when(l.publishedAt)}`].filter((x): x is string => x !== null && x.length > 0).join(' · '),
  });
}

function islandRow(i: PowerOutagesResponse['islands'][number], now: number): string {
  const late = isOutagesDataLate('sei', i.at, now);
  const level = ISLAND_LEVEL[i.color.toLowerCase()];
  const t = Date.parse(i.at);
  const stamp = Number.isFinite(t) ? `signal de ${parisDayOf(t) === parisDayOf(now) ? '' : `${dayMonth(parisDayOf(t))} à `}${parisClock(t)}` : 'heure n.d.';
  return listRow({
    text: ISLAND_WORD[i.zone], value: i.text || 'n.d.', ...(late || level === undefined ? { level: null } : { level }),
    note: [stamp, i.cyclone ? 'cyclone en cours' : null, late ? '(en retard)' : null].filter((x): x is string => x !== null).join(' · '),
  });
}

function sections(p: PowerOutagesResponse, input: PowerViewInput, f: Freshness): FicheSection[] {
  const { now, open, canFocus, ecowatt } = input;
  const edfGone = (what: string): string => emptyLine(`EDF OpenData injoignable : ${what} n.d.`);
  const unplanned = f.edfNever ? edfGone('arrêts imprévus')
    : p.unplanned.map((u) => unitRow(u, now, canFocus, colorOf(u, OUT_RECENT_VAR, f))).join('')
      + (p.unplanned.some((u) => u.nuclear) ? '<button type="button" class="fmk-link" data-open-nuclear="panneau">Voir le parc nucléaire</button>' : '');
  const lineColor = (category: string): string => (f.iipGrey ? OUT_LATE_VAR : category);
  const lines = p.transmission === null
    ? emptyLine('RTE IIP injoignable : lignes du transport n.d.')
    : p.transmission.unplanned.map((l) => lineRow(l, lineColor(OUT_RECENT_VAR))).join('') || emptyLine('Aucune ligne haute tension indisponible ou réduite non planifiée déclarée à RTE.');
  const plannedMw = p.planned.reduce((s, u) => s + u.lostMw, 0);
  const maint = f.edfNever ? edfGone('maintenances')
    : p.planned.slice(0, MAINTENANCE_ROWS).map((u) => unitRow(u, now, canFocus, colorOf(u, OUT_MAINT_VAR, f))).join('')
      + moreNote(p.planned.length, MAINTENANCE_ROWS)
      + (p.transmission ? p.transmission.planned.map((l) => lineRow(l, lineColor(OUT_MAINT_VAR))).join('') : '');
  const upcoming = f.edfNever ? edfGone('arrêts annoncés')
    : p.upcoming.slice(0, UPCOMING_ROWS).map((u) => listRow({
      text: `${u.name} · ${u.sector}`, value: when(u.start), color: f.edfGrey ? OUT_LATE_VAR : OUT_MAINT_VAR,
      note: `${formatMw(u.lostMw)} · ${u.kind === 'imprevue' ? 'arrêt imprévu' : 'arrêt planifié'}`,
    })).join('') + moreNote(p.upcoming.length, UPCOMING_ROWS);
  const days = ecowattUpcoming(ecowatt, now);
  const eco = days.length === 0
    ? emptyLine('Signal Écowatt n.d. (RTE)')
    : days.map((d) => kvRow(`${dayMonth(d.date)}${d.date === parisDayOf(now) ? ' (aujourd’hui)' : ''}`, valueHtml(ECOWATT_WORD[d.level], ECOWATT_LEVEL[d.level]))).join('');
  // Chaque île est toujours rendue : sans signal de l'heure, « n.d. » nommé (jamais une île qui disparaît).
  const islands = (['reunion', 'corse'] as const).map((zone) => {
    const signal = p.islands.find((i) => i.zone === zone);
    return signal ? islandRow(signal, now) : listRow({ text: ISLAND_WORD[zone], value: 'n.d.', level: null, note: 'signal de l’heure n.d.' });
  }).join('');
  const points = p.history.map((h) => ({ at: Date.parse(`${h.day}T10:00:00Z`), value: h.unplannedMw })).filter((x) => Number.isFinite(x.at));
  const first = points[0];
  const last = points[points.length - 1];
  const curve = first !== undefined && last !== undefined && points.length >= 2
    ? lineChart(points, {
      label: 'MW perdus en arrêts imprévus à 12 h, 30 jours', from: first.at, to: last.at, stroke: f.edfGrey ? OUT_LATE_VAR : OUT_RECENT_VAR,
      value: (v) => formatMw(v), tick: (ms) => dayMonth(new Date(ms).toISOString().slice(0, 10)), markPeak: true,
    })
    : emptyLine('Courbe n.d.');
  const method = note('Arrêts imprévus : indisponibilités « fortuites » publiées par EDF (version en vigueur, fenêtre contenant l’instant), puissance maximale moins puissance disponible. Les contraintes de réserve (« chroniques ») et les unités de Luminus en Belgique sont écartées. Une unité décrite par EDF et par RTE est comptée une fois.')
    + note('Transport : messages REMIT de RTE (version la plus haute, messages annulés écartés), datés par leur publication.')
    + `<p class="fmk-note">${sourceLinkHtml('EDF OpenData (Licence Ouverte 2.0)', EDF_URL)} · ${sourceLinkHtml('RTE, plateforme IIP', IIP_URL)}</p>`;
  return [
    { id: 'imprevus', title: 'Arrêts imprévus en cours', collapsible: true, open: open('imprevus', true), summary: f.edfNever ? 'n.d.' : escapeHtml(frNumber(p.unplanned.length, 0)), html: unplanned || emptyLine('Aucun arrêt imprévu en cours publié par EDF.') },
    { id: 'transport', title: 'Lignes haute tension indisponibles ou réduites, non planifiées', collapsible: true, open: open('transport', true), html: lines },
    { id: 'maintenances', title: 'Maintenances en cours', collapsible: true, open: open('maintenances', false), summary: f.edfNever ? 'n.d.' : escapeHtml(`${countText(p.planned.length, 'unité', 'unités')} · ${formatGw(plannedMw)}`), html: maint || emptyLine('Aucune maintenance en cours.') },
    { id: 'annonces', title: 'Annoncés dans les 7 prochains jours', collapsible: true, open: open('annonces', false), summary: f.edfNever ? 'n.d.' : escapeHtml(frNumber(p.upcoming.length, 0)), html: upcoming || emptyLine('Aucun arrêt annoncé.') },
    { id: 'ecowatt', title: 'Écowatt, aujourd’hui et les trois jours suivants', collapsible: true, open: open('ecowatt', true), html: eco },
    { id: 'iles', title: 'Outre-mer et Corse', collapsible: true, open: open('iles', false), html: islands + note('Signal horaire d’EDF SEI : conseil de consommation, pas un niveau de vigilance.') },
    { id: 'particuliers', title: 'Coupures chez les particuliers', collapsible: false, html: `<p class="fmk-note">${escapeHtml('Enedis ne publie pas de données ouvertes sur les coupures en cours. ')}${sourceLinkHtml('Page des pannes d’Enedis', ENEDIS_URL)}</p>` },
    { id: 'courbe', title: 'Arrêts imprévus, 30 jours', collapsible: true, open: open('courbe', true), html: curve },
    { id: 'methode', title: 'Méthode et sources', collapsible: true, open: open('methode', false), html: method },
  ];
}

export function buildPowerView(input: PowerViewInput): LayerView {
  const { power: p, error, ecowatt, now } = input;
  if (p === null && error === null) {
    return { head: { theme: OUTAGES_THEME, title: POWER_TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  }
  if (p === null || (p.edfReadAt === null && p.iipReadAt === null)) {
    const reasons = [error, ...(p?.errors ?? [])].filter((x): x is string => x !== null && x.length > 0);
    return {
      head: { theme: OUTAGES_THEME, title: POWER_TITLE, level: 'nd', figure: { value: 'n.d.', caption: FIGURE_CAPTION, level: null }, status: ['EDF et RTE injoignables'] },
      sections: [], bodyHtml: sourceErrorCallout(null, now) + reasons.map(note).join(''),
    };
  }
  const edfNever = p.edfReadAt === null;
  const edfLate = !edfNever && isOutagesDataLate('edf', p.edfReadAt, now);
  const edfMute = edfNever || edfLate;
  // Retard IIP sur la dernière lecture réussie (RTE ne publie parfois rien pendant des heures) ; la date affichée reste celle du flux.
  const iipLate = p.iipReadAt !== null && isOutagesDataLate('iip', p.iipReadAt, now);
  const f: Freshness = { edfMute, edfNever, edfGrey: edfMute, iipGrey: iipLate };
  const updated = p.edfUpdatedAt === null ? null : Date.parse(p.edfUpdatedAt);
  const edfAt = updated !== null && Number.isFinite(updated) ? absoluteTime(updated, now, 'fr') : null;
  const stamp = edfNever ? `EDF injoignable${edfAt === null ? '' : `, jeu du ${edfAt}`}`
    : `EDF ${edfAt ?? 'n.d.'}${edfLate ? ' (en retard)' : ''}`;
  const iip = p.iipPublishedAt === null ? 'RTE IIP n.d.' : `RTE IIP ${absoluteTime(Date.parse(p.iipPublishedAt), now, 'fr')}${iipLate ? ' (en retard)' : ''}`;
  // R32 : EDF muet, le total des seules lignes IIP serait partiel : « n.d. », jamais ce total.
  const figure = edfMute
    ? { value: 'n.d.', caption: FIGURE_CAPTION, level: null }
    : { value: formatGw(powerUnplannedMw(p)), caption: FIGURE_CAPTION };
  const level = edfMute ? 'nd' : powerLevel(p, ecowattToday(ecowatt, now));
  // Erreurs nommées : celle de la lecture client, puis celles du serveur (une partie en échec reste dite, même avec des données gardées).
  const body = (error !== null ? sourceErrorCallout(p.readAt ? Date.parse(p.readAt) : null, now) : '') + p.errors.map(note).join('');
  return {
    head: { theme: OUTAGES_THEME, title: POWER_TITLE, figure, level, status: [stamp, iip] },
    sections: sections(p, input, f),
    ...(body !== '' ? { bodyHtml: body } : {}),
  };
}
