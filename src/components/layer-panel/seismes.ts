// src/components/layer-panel/seismes.ts : vue pure du panneau Séismes (spec 2026-10-04 environnement § 3.3, amendement 2) ; aucun accès
// réseau ni DOM. Séismes des 7 derniers jours en France (territoire métropolitain, Corse comprise, ou eaux françaises) et à moins de
// 20 km hors de France (en gris) : lieu, magnitude, heure, profondeur, statut ; seuil d'affichage 2,5 (les plus faibles en gris) ;
// graphe magnitude selon l'heure (E5). Pastille sur 72 h. Relevé du serveur daté (S1), en retard au-delà de 30 min (S2).
import type { EarthquakesResponse, Quake } from '../../types/index.ts';
import { earthquakesLevel, isEnvironmentDataLate, quakeInFrance, quakePlace } from '../../services/environment-levels.ts';
import { levelColorVar, type VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { dotChart, type DotPoint } from './chart.ts';
import { NBSP, frNumber } from './format.ts';
import { emptyLine, listRow, loadingBody, sourceErrorCallout, sourceLinkHtml, type LayerHeadModel, type LayerView } from './frame.ts';
import { departementName } from './health-format.ts';
import {
  ENVIRONMENT_THEME, QUAKE_DISPLAY_MIN, capitalize, clockOf, formatKm, formatMagnitude, glueEnvUnits, note, plural, quakeLevel, readErrors, shortDate,
  sourceDown, stamp,
} from './environment-format.ts';

export const SEISMES_TITLE = 'Séismes';
type OpenFn = (sectionId: string, byDefault: boolean) => boolean;
export interface SeismesViewInput { quakes: EarthquakesResponse | null; quakesError: string | null; canFocus: boolean; now: number; open: OpenFn }

const WEEK_MS = 7 * 86_400_000;
const MAX_ROWS = 12;
const BCSF_URL = 'https://renass.unistra.fr/fr/';
const EMSC_URL = 'https://www.emsc-csem.org/';
const DOWN = 'BCSF-RéNaSS et EMSC';
const MUTED = 'var(--text-muted)';

function late(q: EarthquakesResponse, now: number): boolean {
  return isEnvironmentDataLate('bcsf', q.readAt, now);
}
function sourceLabel(q: EarthquakesResponse): string {
  return q.source === 'EMSC' ? 'EMSC (repli)' : 'BCSF-RéNaSS';
}
function inWeek(q: Quake, now: number): boolean {
  const t = Date.parse(q.at);
  return Number.isFinite(t) && t <= now && now - t <= WEEK_MS;
}
function placeText(q: Quake): string {
  const place = capitalize(quakePlace(q));
  return q.dept !== null ? `${place} (${departementName(q.dept)})` : place;
}

/** Couleur d'une ligne et d'un point : hors de France ou donnée en retard, gris ; sinon l'échelle des magnitudes (arbitrage 5). */
export function quakeRowLevel(q: Quake, isLate: boolean): VigilanceLevel | 'gris' {
  if (isLate || !quakeInFrance(q)) return 'gris';
  return quakeLevel(q.magnitude);
}

// ─── En-tête ───

function leadOf(q: EarthquakesResponse, now: number): string {
  const fr = q.quakes.filter((x) => quakeInFrance(x) && inWeek(x, now));
  if (fr.length === 0) return `Aucun séisme enregistré en France sur 7${NBSP}jours.`;
  const top = fr.reduce((best, x) => (x.magnitude > best.magnitude ? x : best), fr[0]);
  const felt = fr.filter((x) => x.magnitude >= QUAKE_DISPLAY_MIN).length;
  return `Le plus fort en France sur 7${NBSP}jours : magnitude ${frNumber(top.magnitude, 1)} ${quakePlace(top)}${top.dept !== null ? ` (${departementName(top.dept)})` : ''}, `
    + `${clockOf(top.at, now)}. ${capitalize(plural(fr.length, 'séisme'))} en France, dont ${frNumber(felt, 0)} de magnitude 2,5 ou plus.`;
}

function headOf(q: EarthquakesResponse, now: number): LayerHeadModel {
  const isLate = late(q, now);
  const verdict = earthquakesLevel(q, now);
  const strong = q.quakes.filter((x) => quakeInFrance(x) && inWeek(x, now) && x.magnitude >= 3);
  const top = strong.reduce((m, x) => Math.max(m, x.magnitude), 0);
  const figureLevel = quakeLevel(top);
  return {
    theme: ENVIRONMENT_THEME, title: SEISMES_TITLE,
    figure: {
      value: frNumber(strong.length, 0),
      caption: `séismes de magnitude 3 ou plus en France sur 7${NBSP}jours · ${sourceLabel(q)}, ${clockOf(q.readAt, now)}${isLate ? ' (en retard)' : ''}`,
      level: isLate ? null : strong.length === 0 ? 'vert' : figureLevel === 'gris' ? null : figureLevel,
    },
    level: isLate ? 'nd' : verdict.level,
    status: [isLate ? 'niveau suspendu : relevé des séismes en retard' : glueEnvUnits(verdict.reason), stamp(sourceLabel(q), q.readAt, isLate, now)],
    lead: isLate ? null : leadOf(q, now),
  };
}

// ─── Derniers séismes ───

function quakeRow(q: Quake, isLate: boolean, canFocus: boolean, now: number): string {
  const weak = q.magnitude < QUAKE_DISPLAY_MIN || !quakeInFrance(q);
  const where = quakeInFrance(q)
    ? (q.dept === null ? ` · en mer, à ${formatKm(q.distanceKm, 0)} des côtes` : '')
    : ` · hors de France, à ${formatKm(q.distanceKm, 0)} de la frontière`;
  const depth = q.depthKm !== null ? `profondeur ${formatKm(q.depthKm, 0)}` : 'profondeur non publiée';
  return listRow({
    text: placeText(q),
    valueHtml: `<span class="lp-val fmk-num${weak ? ' lp-faint' : ''}">${escapeHtml(formatMagnitude(q.magnitude))}</span>`,
    level: quakeRowLevel(q, isLate),
    note: `${clockOf(q.at, now)} · ${depth} · ${q.status}${where}`,
    ...(canFocus ? { data: { quake: q.id }, link: true } : {}),
  });
}

function pointColor(q: Quake, isLate: boolean): string {
  const level = quakeRowLevel(q, isLate);
  if (isLate) return 'var(--text-primary)';
  return level === 'gris' ? MUTED : levelColorVar(level);
}

function derniersSection(q: EarthquakesResponse | null, canFocus: boolean, now: number, open: OpenFn): FicheSection {
  const base = { id: 'derniers', title: 'Derniers séismes', collapsible: true, open: open('derniers', true) };
  if (!q || q.readAt === null) return { ...base, summary: 'n.d.', html: sourceDown(DOWN) };
  const isLate = late(q, now);
  const list = q.quakes.filter((x) => inWeek(x, now)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  if (list.length === 0) {
    return { ...base, summary: 'aucun', html: emptyLine(`Aucun séisme enregistré en France ni à moins de 20${NBSP}km sur 7${NBSP}jours.`) };
  }
  const fr = list.filter(quakeInFrance);
  const max = fr.reduce((m, x) => Math.max(m, x.magnitude), 0);
  const rows = list.slice(0, MAX_ROWS).map((x) => quakeRow(x, isLate, canFocus, now)).join('');
  const rest = list.slice(MAX_ROWS);
  const restNote = rest.length === 0 ? ''
    : note(`${plural(rest.length, 'autre événement', 'autres événements')}, magnitude au plus ${formatMagnitude(rest.reduce((m, x) => Math.max(m, x.magnitude), 0))}.`);
  const points: DotPoint[] = list.flatMap((x) => {
    const at = Date.parse(x.at);
    return Number.isFinite(at) ? [{ at, value: x.magnitude, color: pointColor(x, isLate), title: `${formatMagnitude(x.magnitude)} · ${placeText(x)}` }] : [];
  });
  const chart = dotChart(points, {
    label: 'Magnitude selon l’heure, 7 derniers jours', from: now - WEEK_MS, to: now, yMin: 0, nowAt: now,
    value: (v) => frNumber(v, 1), tick: (ms) => shortDate(new Date(ms).toISOString(), now),
  });
  return {
    ...base,
    summary: escapeHtml(`${frNumber(fr.length, 0)} en France · max ${formatMagnitude(max)}${isLate ? ' (en retard)' : ''}`),
    html: rows + restNote + chart
      + note(`Seuil d’affichage : magnitude 2,5 ; de 2,5 à 2,9 en vert, plus faibles en gris (listés à titre d’information). Couleur : jaune dès 3, orange dès 4, rouge dès 5 ; hors de France en gris.`)
      + (canFocus ? note('Clic sur une ligne : le séisme sur la carte.') : ''),
  };
}

// ─── Méthode et sources ───

function methodSection(q: EarthquakesResponse | null, failed: boolean, now: number, open: OpenFn): FicheSection {
  const state = q && q.readAt !== null
    ? `relevé du serveur ${clockOf(q.readAt, now)}${late(q, now) ? ' (en retard)' : ''}${q.source === 'EMSC' ? ', repli EMSC' : ''}`
    : failed || q !== null ? 'source indisponible' : 'chargement…';
  const html = kvRow('Séismes', `${sourceLinkHtml('BCSF-RéNaSS (Bureau central sismologique français)', BCSF_URL)} · ${escapeHtml(state)}`)
    + kvRow('Repli', `${sourceLinkHtml('EMSC (Centre sismologique euro-méditerranéen)', EMSC_URL)} · ${escapeHtml('seulement si le BCSF-RéNaSS est en panne ; il ne publie pas de révision : ses événements sont dits automatiques')}`)
    + note(`En France : épicentre sur le territoire métropolitain (Corse comprise) ou dans les eaux françaises. Les séismes à moins de 20${NBSP}km du territoire, hors de France, sont affichés en gris « hors de France » ; ils ne comptent ni dans la pastille ni dans le gros chiffre.`)
    + note(`${plural(q?.nonSeismic ?? 0, 'tir de carrière, explosions et autres événements non sismiques écartés', 'tirs de carrière, explosions et autres événements non sismiques écartés')} sur 7${NBSP}jours.`)
    + note(`Pastille : sur les 72 dernières heures, en France, rouge dès magnitude 5, orange dès 4, jaune dès 3, vert sinon. Situation : un séisme de magnitude 4 ou plus en France crée une situation de sévérité moyenne, élevée dès 5 (elle plafonne le score à 78).`)
    + note('Magnitude locale publiée (MLv, ml), arrondie au dixième comme la description ; statut « automatique » tant qu’un sismologue ne l’a pas revu.')
    + note(`Retard : relevé du serveur de plus de 30${NBSP}min. Relève : toutes les 10${NBSP}min. Séismes d’outre-mer hors du champ de ce panneau.`)
    + readErrors(q?.errors ?? []);
  return { id: 'methode', title: 'Méthode et sources', collapsible: true, open: open('methode', false), tone: 'reference', summary: 'BCSF-RéNaSS', html };
}

// ─── Assemblage ───

export function buildSeismesView(input: SeismesViewInput): LayerView {
  const { quakes: q, quakesError, canFocus, now, open } = input;
  if (q === null && quakesError === null) {
    return { head: { theme: ENVIRONMENT_THEME, title: SEISMES_TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  }
  const sections = [derniersSection(q, canFocus, now, open), methodSection(q, quakesError !== null, now, open)];
  if (q === null || q.readAt === null) {
    return {
      head: {
        theme: ENVIRONMENT_THEME, title: SEISMES_TITLE, level: 'nd',
        figure: { value: 'n.d.', caption: `séismes de magnitude 3 ou plus en France sur 7${NBSP}jours`, level: null }, status: ['BCSF-RéNaSS injoignable'],
      },
      sections, bodyHtml: sourceErrorCallout(null, now),
    };
  }
  const readMs = Date.parse(q.readAt);
  return { head: headOf(q, now), sections, bodyHtml: quakesError !== null ? sourceErrorCallout(Number.isFinite(readMs) ? readMs : null, now) : undefined };
}
