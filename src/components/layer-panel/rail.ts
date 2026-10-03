// src/components/layer-panel/rail.ts : vue pure du panneau Réseau ferroviaire (spec 2026-10-03 trafics § 3.3) ; aucun accès réseau
// ni DOM. Perturbations SNCF agrégées par axe grandes lignes et par région TER, situations SIRI SX avec leur cause, plus gros retards,
// détail train par train (en cours et à venir séparés, filtre, pagination). Périmètre : trains signalés par la SNCF (T1).
import type { RailGroupStats, RailOverviewResponse, RailSituation, RailSituationsResponse, RailTrain } from '../../types/index.ts';
import { isTrafficDataLate, railLevel } from '../../services/traffic-levels.ts';
import { LEVEL_RANK } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { kvRow, levelDot } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { NBSP, frNumber } from './format.ts';
import { emptyLine, listRow, loadingBody, sourceErrorCallout, sourceLinkHtml, valueHtml, type LayerHeadModel, type LayerView } from './frame.ts';
import {
  RAIL_AXIS_LABEL, RAIL_EFFECT_WORD, TRAFFIC_THEME, clockOf, dataMs, emptyOrDown, formatMinutes, note, plural, railDelayLevel, railGroupLevel,
  glueUnits, readErrors, sourceDown, stamp,
} from './traffic-format.ts';

export const RAIL_PAGE_SIZE = 20;

export interface RailViewInput {
  overview: RailOverviewResponse | null;
  overviewError: string | null;
  situations: RailSituationsResponse | null;
  situationsError: string | null;
  /** Filtre de « Trains un par un » : 'all', 'axis:<clé>' ou 'region:<clé>'. */
  filter: string;
  /** Pages de RAIL_PAGE_SIZE trains affichées (1 au moins). */
  pages: number;
  /** La carte peut surligner le trajet d'un train (carte WebGL). */
  canFocus: boolean;
  now: number;
  open: (sectionId: string, byDefault: boolean) => boolean;
}
type OpenFn = RailViewInput['open'];

const TITLE = 'Réseau ferroviaire';
const SNCF_URL = 'https://numerique.sncf.com/startup/api/';
const SIRI_URL = 'https://transport.data.gouv.fr/datasets/horaires-sncf';
const MAX_REGIONS = 5;
const MAX_SITUATIONS = 6;
const MAX_TOP = 5;
const MIN_GROUP = 3;
const AXES_NOTE = 'Axe : gare terminale à Paris (Gare de Lyon : Sud-Est ; Montparnasse : Atlantique ; Nord ; Est ; Bercy : Intercités Bercy ; '
  + 'Saint-Lazare : Normandie), sinon province et transversales.';

function overviewLate(o: RailOverviewResponse, now: number): boolean {
  return isTrafficDataLate('sncf', o.updatedAt, now);
}

function groupRank(g: RailGroupStats): number {
  const level = railGroupLevel(g);
  return level === 'gris' ? -1 : LEVEL_RANK[level];
}

/** Par niveau, puis retard moyen, puis nombre de trains. */
function sortGroups(groups: readonly RailGroupStats[]): RailGroupStats[] {
  return [...groups].sort((a, b) => groupRank(b) - groupRank(a) || (b.avgDelayMin ?? -1) - (a.avgDelayMin ?? -1) || b.trains - a.trains);
}

/** Groupe d'au moins 3 trains au plus fort retard moyen (règle de la pastille). */
function worstGroup(groups: readonly RailGroupStats[]): RailGroupStats | null {
  return groups.filter((g) => g.trains >= MIN_GROUP && g.avgDelayMin !== null)
    .sort((a, b) => (b.avgDelayMin ?? 0) - (a.avgDelayMin ?? 0))[0] ?? null;
}

function sortedSituations(s: RailSituationsResponse): RailSituation[] {
  return [...s.situations].sort((a, b) => b.trains - a.trains || (dataMs(b.start) ?? 0) - (dataMs(a.start) ?? 0));
}

/** Groupe « Non rattaché » des axes : grandes lignes sans axe (distinct de la région TER du même nom). */
const UNATTACHED = 'non-rattache';
const UNATTACHED_LONG = 'grandes lignes non rattachées';

function groupLabel(t: RailTrain, o: RailOverviewResponse): string | null {
  if (t.axis !== null) return `axe ${o.axes.find((g) => g.key === t.axis)?.label ?? RAIL_AXIS_LABEL[t.axis]}`;
  if (t.kind === 'grandes-lignes') return UNATTACHED_LONG;
  if (t.region !== null) return `TER ${o.regions.find((g) => g.key === t.region)?.label ?? t.region}`;
  return null;
}

// ─── En-tête ───

/** Synthèse ; null quand aucun groupe ni situation ne la porte (rien d'inventé, jamais « aucun » sur une source partielle). */
function lead(o: RailOverviewResponse, s: RailSituationsResponse | null, now: number): string | null {
  const parts: string[] = [];
  const axis = worstGroup(o.axes);
  if (axis) parts.push(`${axis.key === UNATTACHED ? 'Grandes lignes non rattachées' : `Axe ${axis.label}`} le plus touché (${plural(axis.trains, 'train')}, ${formatMinutes(axis.avgDelayMin, { signed: true })} en moyenne).`);
  const region = worstGroup(o.regions);
  if (region) parts.push(`TER ${region.label} : ${formatMinutes(region.avgDelayMin, { signed: true })} en moyenne sur ${plural(region.trains, 'train')}.`);
  const top = s && !isTrafficDataLate('siri-sx', s.at, now) ? sortedSituations(s)[0] : undefined;
  if (top) parts.push(`Situation : ${top.title}.`);
  return parts.length > 0 ? parts.join(' ') : null;
}

function siriStamp(s: RailSituationsResponse | null, error: string | null, now: number): string {
  if (s) return stamp('SIRI SX', s.at, isTrafficDataLate('siri-sx', s.at, now), now);
  return error !== null ? 'SIRI SX injoignable' : 'SIRI SX chargement…';
}

function headOf(input: RailViewInput, o: RailOverviewResponse): LayerHeadModel {
  const { situations: s, situationsError, now } = input;
  const late = overviewLate(o, now);
  const verdict = railLevel(o);
  return {
    theme: TRAFFIC_THEME, title: TITLE,
    figure: {
      value: frNumber(o.longDistance.active, 0),
      caption: `trains grandes lignes perturbés en cours · ${frNumber(o.longDistance.delayed15, 0)} à 15${NBSP}min ou plus · SNCF, ${clockOf(o.updatedAt, now)}${late ? ' (en retard)' : ''}`,
      level: late ? null : undefined,
    },
    level: late ? 'nd' : verdict.level,
    status: [late ? 'niveau suspendu : données SNCF en retard' : glueUnits(verdict.reason), `${stamp('SNCF', o.updatedAt, late, now)} · ${siriStamp(s, situationsError, now)}`],
    lead: late ? null : lead(o, s, now),
  };
}

// ─── Tableaux par axe et par région ───

function groupTable(groups: readonly RailGroupStats[], header: string, late: boolean): string {
  const rows = groups.map((g) => {
    const level = railGroupLevel(g);
    const dot = levelDot(late || level === 'gris' ? null : level);
    const avgLevel = !late && (level === 'orange' || level === 'rouge') ? level : null;
    return `<tr><th scope="row">${dot}${escapeHtml(g.label)}</th><td>${valueHtml(frNumber(g.trains, 0))}</td>`
      + `<td>${valueHtml(formatMinutes(g.avgDelayMin, { signed: true }), avgLevel)}</td><td>${valueHtml(formatMinutes(g.maxDelayMin))}</td>`
      + `<td>${valueHtml(frNumber(g.cancelled, 0))}</td></tr>`;
  }).join('');
  return `<table class="lp-tbl"><thead><tr><th scope="col">${escapeHtml(header)}</th><th scope="col">Trains</th><th scope="col">Moyen</th>`
    + `<th scope="col">Max</th><th scope="col">Suppr.</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function groupSummary(groups: readonly RailGroupStats[], late: boolean): string {
  const worst = worstGroup(groups) ?? sortGroups(groups)[0] ?? null;
  return worst ? `${worst.label} ${formatMinutes(worst.avgDelayMin, { signed: true })}${late ? ' (en retard)' : ''}` : 'n.d.';
}

const GROUP_RULE = `Puce : retard moyen de 20${NBSP}min ou plus jaune, 45${NBSP}min orange, 90${NBSP}min rouge, ou 10 trains supprimés ; `
  + `retard moyen et maximum mesurés entre l’horaire prévu et l’horaire corrigé de chaque arrêt.`;

function axesSection(o: RailOverviewResponse | null, now: number, open: OpenFn): FicheSection {
  const base = { id: 'axes', title: 'Grandes lignes par axe', collapsible: true, open: open('axes', true) };
  if (!o) return { ...base, summary: 'n.d.', html: sourceDown('perturbations SNCF') };
  if (o.axes.every((g) => g.trains === 0)) return { ...base, summary: 'aucun', html: emptyOrDown(o.errors, 'Aucun train grandes lignes perturbé en cours.', 'perturbations SNCF') };
  const late = overviewLate(o, now);
  return {
    ...base, summary: escapeHtml(groupSummary(o.axes, late)),
    html: groupTable(sortGroups(o.axes), 'Grandes lignes', late) + note(AXES_NOTE) + note(GROUP_RULE),
  };
}

function regionsSection(o: RailOverviewResponse | null, now: number, open: OpenFn): FicheSection {
  const base = { id: 'regions', title: 'TER par région', collapsible: true, open: open('regions', true) };
  if (!o) return { ...base, summary: 'n.d.', html: sourceDown('perturbations SNCF') };
  if (o.regions.length === 0) return { ...base, summary: 'aucun', html: emptyOrDown(o.errors, 'Aucun TER perturbé en cours.', 'perturbations SNCF') };
  const late = overviewLate(o, now);
  const busiest = [...o.regions].sort((a, b) => b.trains - a.trains || (b.avgDelayMin ?? -1) - (a.avgDelayMin ?? -1));
  const shown = busiest.slice(0, MAX_REGIONS);
  const rest = busiest.slice(MAX_REGIONS);
  const restTrains = rest.reduce((sum, g) => sum + g.trains, 0);
  return {
    ...base, summary: escapeHtml(groupSummary(o.regions, late)),
    html: groupTable(sortGroups(shown), 'TER', late)
      + (rest.length > 0 ? note(`${plural(rest.length, 'autre région', 'autres régions')} : ${plural(restTrains, 'train')}.`) : '')
      + note('Région TER : région du premier arrêt du train (trains transfrontaliers non rattachés).'),
  };
}

// ─── Situations en cours (SIRI SX) ───

function situationsSection(s: RailSituationsResponse | null, error: string | null, now: number, open: OpenFn): FicheSection {
  const base = { id: 'situations', title: 'Situations en cours', collapsible: true, open: open('situations', true) };
  if (!s) return { ...base, summary: 'n.d.', html: error !== null ? sourceDown('SIRI SX (situations SNCF)') : emptyLine('Chargement des situations…') };
  const late = isTrafficDataLate('siri-sx', s.at, now);
  const list = sortedSituations(s);
  const rows = list.slice(0, MAX_SITUATIONS).map((x) => listRow({
    text: x.title, value: clockOf(x.start, now),
    note: [x.cause ? `Cause : ${x.cause}` : 'cause non précisée', x.scope, plural(x.trains, 'train concerné', 'trains concernés')].join(' · '),
  })).join('');
  const body = list.length === 0 ? emptyOrDown(s.errors, 'Aucune situation en cours.', 'SIRI SX (situations SNCF)')
    : rows + (list.length > MAX_SITUATIONS ? note(`${list.length - MAX_SITUATIONS} autres situations.`) : '');
  return {
    ...base, summary: escapeHtml(`${plural(list.length, 'situation')}${late ? ' (en retard)' : ''}`),
    html: body + note('Situations du flux SIRI SX de la SNCF : cause lue dans le texte (« Cause : … »), rattachement à un axe ou à une région par '
      + 'l’émetteur du message ; messages d’information voyageur sans effet sur la circulation (ascenseur, train complet, arrêt déporté) écartés.'),
  };
}

// ─── Trains ───

function trainRow(t: RailTrain, o: RailOverviewResponse, late: boolean, canFocus: boolean, now: number): string {
  const cancelled = t.effect === 'supprime';
  const level = railDelayLevel(t.delayMin, cancelled);
  const shown = late || level === 'gris' ? null : level;
  const value = cancelled ? 'supprimé' : formatMinutes(t.delayMin, { signed: true });
  const focusable = canFocus && t.stops.length > 0;
  return listRow({
    text: `n° ${t.number} · ${t.origin} – ${t.destination}`, valueHtml: valueHtml(value, shown), level: shown ?? 'gris',
    note: [RAIL_EFFECT_WORD[t.effect], groupLabel(t, o), t.status === 'a-venir' ? 'à venir' : null, `mis à jour ${clockOf(t.updatedAt, now)}`]
      .filter((x): x is string => x !== null).join(' · '),
    ...(focusable ? { data: { 'rail-train': t.id }, link: true } : {}),
  });
}

function topSection(o: RailOverviewResponse | null, canFocus: boolean, now: number, open: OpenFn): FicheSection {
  const base = { id: 'top', title: 'Plus gros retards', collapsible: true, open: open('top', false) };
  if (!o) return { ...base, summary: 'n.d.', html: sourceDown('perturbations SNCF') };
  const late = overviewLate(o, now);
  const top = o.topDelays.slice(0, MAX_TOP);
  const first = top[0];
  if (!first) return { ...base, summary: 'aucun', html: emptyOrDown(o.errors, 'Aucun retard signalé.', 'perturbations SNCF') };
  return {
    ...base,
    summary: escapeHtml(`${first.origin} – ${first.destination} n° ${first.number} ${first.effect === 'supprime' ? 'supprimé' : formatMinutes(first.delayMin, { signed: true })}`),
    html: top.map((t) => trainRow(t, o, late, canFocus, now)).join('') + (canFocus ? note('Clic sur un train : son trajet sur la carte.') : ''),
  };
}

export function railFilterOptions(o: RailOverviewResponse): Array<{ value: string; label: string }> {
  return [
    { value: 'all', label: 'Tous les axes et régions' },
    ...o.axes.map((g) => ({ value: `axis:${g.key}`, label: g.key === UNATTACHED ? 'Grandes lignes non rattachées' : `Axe ${g.label}` })),
    ...o.regions.map((g) => ({ value: `region:${g.key}`, label: `TER ${g.label}` })),
  ];
}

function matches(t: RailTrain, filter: string): boolean {
  if (filter.startsWith('axis:')) {
    const key = filter.slice('axis:'.length);
    return key === UNATTACHED ? t.axis === null && t.kind === 'grandes-lignes' : t.axis === key;
  }
  if (filter.startsWith('region:')) return t.region === filter.slice('region:'.length);
  return true;
}

/** Supprimés d'abord, puis le plus fort retard. */
function byGravity(a: RailTrain, b: RailTrain): number {
  return (b.effect === 'supprime' ? 1 : 0) - (a.effect === 'supprime' ? 1 : 0) || (b.delayMin ?? -1) - (a.delayMin ?? -1) || a.number.localeCompare(b.number);
}

function trainsSection(o: RailOverviewResponse | null, filter: string, pages: number, canFocus: boolean, now: number, open: OpenFn): FicheSection {
  const base = { id: 'trains', title: 'Trains un par un', collapsible: true, open: open('trains', false) };
  if (!o) return { ...base, summary: 'n.d.', html: sourceDown('perturbations SNCF') };
  const late = overviewLate(o, now);
  const options = railFilterOptions(o).map((op) => `<option value="${escapeHtml(op.value)}"${op.value === filter ? ' selected' : ''}>${escapeHtml(op.label)}</option>`).join('');
  const toolbar = `<div class="lp-toolbar"><select class="lp-select" data-rail-filter aria-label="Axe ou région">${options}</select></div>`;
  const chosen = o.trains.filter((t) => matches(t, filter));
  const current = chosen.filter((t) => t.status === 'en-cours').sort(byGravity);
  const upcoming = chosen.filter((t) => t.status === 'a-venir').sort(byGravity);
  const limit = Math.max(1, pages) * RAIL_PAGE_SIZE;
  const shownCurrent = current.slice(0, limit);
  const shownUpcoming = upcoming.slice(0, Math.max(0, limit - shownCurrent.length));
  const rest = current.length + upcoming.length - shownCurrent.length - shownUpcoming.length;
  const list = (trains: readonly RailTrain[], empty: string): string => (trains.length === 0 ? emptyLine(empty)
    : trains.map((t) => trainRow(t, o, late, canFocus, now)).join(''));
  const html = toolbar
    + `<h4 class="fmk-eyebrow">En cours (${current.length})</h4>${list(shownCurrent, 'Aucun train perturbé en cours pour ce choix.')}`
    + `<h4 class="fmk-eyebrow">À venir (${upcoming.length})</h4>${list(shownUpcoming, upcoming.length > 0 ? 'Affichés après les trains en cours.' : 'Aucun train perturbé à venir pour ce choix.')}`
    + (rest > 0 ? `<button type="button" class="lp-toggle" data-rail-more>Afficher ${Math.min(RAIL_PAGE_SIZE, rest)} de plus (${rest} restants)</button>` : '');
  return { ...base, summary: escapeHtml(`${current.length} en cours · ${upcoming.length} à venir`), html };
}

// ─── Méthode et sources ───

function methodSection(input: RailViewInput): FicheSection {
  const { overview: o, overviewError, situations: s, situationsError, now, open } = input;
  const state = (has: boolean, failed: boolean, text: string): string => (has ? text : failed ? 'source indisponible' : 'chargement…');
  const html = kvRow('Perturbations', `${sourceLinkHtml('API SNCF (perturbations du jour)', SNCF_URL)} · ${escapeHtml(state(o !== null, overviewError !== null,
    o ? `mise à jour de ${clockOf(o.updatedAt, now)}${overviewLate(o, now) ? ' (en retard)' : ''}` : ''))}`)
    + kvRow('Situations', `${sourceLinkHtml('SIRI SX (point d’accès national)', SIRI_URL)} · ${escapeHtml(state(s !== null, situationsError !== null,
      s ? `réponse de ${clockOf(s.at, now)}${isTrafficDataLate('siri-sx', s.at, now) ? ' (en retard)' : ''}` : ''))}`)
    + note(`Périmètre : trains signalés par la SNCF (pas le plan de transport complet), retards signalés à partir de 5${NBSP}min ; aucun taux de régularité.`)
    + note(`Pastille : rouge si un axe ou une région d’au moins 3 trains a 90${NBSP}min de retard moyen ou plus, ou au moins 10 trains supprimés en cours ; `
      + `orange si un axe ou une région d’au moins 3 trains a 45${NBSP}min ou plus ; jaune si au moins 15 trains grandes lignes ont 15${NBSP}min ou plus ; vert sinon.`)
    + note(AXES_NOTE)
    + note('Effets : retard (SIGNIFICANT_DELAYS), supprimé (NO_SERVICE), service réduit (REDUCED_SERVICE), détour (DETOUR), service modifié '
      + '(MODIFIED_SERVICE), train ajouté (ADDITIONAL_SERVICE) ; trains en cours et à venir séparés.')
    + note(`Retard : perturbations et situations au-delà de 20${NBSP}min sans mise à jour. Une donnée en retard perd ses couleurs.`)
    + note(`Couleurs d’un train : retard de 15${NBSP}min ou plus jaune, 45${NBSP}min orange, 90${NBSP}min rouge ; supprimé rouge.`)
    + note('Carte : gares des trains perturbés en cours, couleur selon le plus fort retard à l’arrêt ; les situations SIRI SX ne sont pas placées (le flux ne publie pas de lieu) ; trajet du train choisi dans le panneau.')
    + readErrors([...(o?.errors ?? []), ...(s?.errors ?? [])]);
  const down = [o === null && overviewError !== null, s === null && situationsError !== null].filter(Boolean).length;
  return {
    id: 'method', title: 'Méthode et sources', collapsible: true, open: open('method', false), tone: 'reference', html,
    summary: escapeHtml(`SNCF · SIRI SX${down > 0 ? ` · ${down} indisponible${down > 1 ? 's' : ''}` : ''}`),
  };
}

// ─── Assemblage ───

export function buildRailView(input: RailViewInput): LayerView {
  const { overview: o, overviewError, situations: s, situationsError, filter, pages, canFocus, now, open } = input;
  if (o === null && overviewError === null) {
    return { head: { theme: TRAFFIC_THEME, title: TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  }
  const sections = [
    axesSection(o, now, open), regionsSection(o, now, open), situationsSection(s, situationsError, now, open), topSection(o, canFocus, now, open),
    trainsSection(o, filter, pages, canFocus, now, open), methodSection(input),
  ];
  if (o === null) {
    return {
      head: {
        theme: TRAFFIC_THEME, title: TITLE, level: 'nd', figure: { value: 'n.d.', caption: 'trains grandes lignes perturbés en cours', level: null },
        status: ['SNCF injoignable', siriStamp(s, situationsError, now)],
      },
      sections, bodyHtml: sourceErrorCallout(null, now),
    };
  }
  return { head: headOf(input, o), sections, bodyHtml: overviewError !== null ? sourceErrorCallout(dataMs(o.updatedAt), now) : undefined };
}
