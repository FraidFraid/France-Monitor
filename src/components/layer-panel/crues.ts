// src/components/layer-panel/crues.ts : vue pure du panneau Crues (spec 2026-10-04 environnement § 2.2 ; contrats § 4.1) ; aucun
// accès réseau ni DOM. Tronçons Vigicrues en vigilance (niveau officiel tel quel, E1) et hauteurs de leurs stations (Hub'Eau, par
// station, jamais par département). Chaque partie porte sa date réelle (S1) : le flux InfoVigiCru n'a pas d'heure de bulletin, d'où
// « relevé Vigicrues » ; une station a l'heure de sa dernière mesure. Une hauteur au repère de la station n'est pas une cote d'alerte.
import type { FloodSection, FloodStation, FloodsResponse, OfficialColorId } from '../../types/index.ts';
import { floodsLevel, isEnvironmentDataLate, stationLate } from '../../services/environment-levels.ts';
import { isProgressNote } from '../../services/environment-source.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { absoluteTime, kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { lineChart, type ChartPoint } from './chart.ts';
import {
  COLOR_LEVEL, COLOR_WORD, ENVIRONMENT_THEME, clockOf, dataMs, emptyOrDown, formatChangeM, formatFlowM3s, formatHeightM, glueEnvUnits, note,
  plural, readErrors, sourceDown, stamp,
} from './environment-format.ts';
import { NBSP, frNumber } from './format.ts';
import { emptyLine, listRow, loadingBody, sourceErrorCallout, sourceLinkHtml, valueHtml, type LayerHeadModel, type LayerView } from './frame.ts';

export type OpenFn = (sectionId: string, byDefault: boolean) => boolean;
export interface CruesViewInput { floods: FloodsResponse | null; floodsError: string | null; canFocus: boolean; now: number; open: OpenFn }

export const CRUES_TITLE = 'Crues';
const HOUR_MS = 3_600_000;
/** Un point par quart d'heure au plus : un écart de plus de 40 min entre deux mesures est un trou de mesure, jamais comblé. */
export const STATION_GAP_MS = 40 * 60_000;
/** Teinte de catégorie des stations (jeton --cat-station-hydro) ; en retard : couleur du texte, jamais un gris de jauge. */
const STATION_STROKE = 'var(--cat-station-hydro)';
const LATE_STROKE = 'var(--text-primary)';
const VIGICRUES_URL = 'https://www.vigicrues.gouv.fr';
const HUBEAU_URL = 'https://hubeau.eaufrance.fr/page/api-hydrometrie';
const NOT_ALERT = 'Hauteur au repère de la station, pas une cote d’alerte : Vigicrues ne publie pas les seuils de ses stations en API.';

/** Variation telle qu'affichée (au centimètre) : une hausse de 3 mm s'écrit « 0,00 m » et n'est donc jamais colorée ni comptée. */
const shownChange = (c: number | null): number | null => (c === null ? null : Math.round(c * 100) / 100);
/** Panne réelle de Hub'Eau : une note d'avancement du serveur (lecture en cours, relevé précédent servi) n'en est pas une. */
const isHubeauError = (e: string): boolean => /^Hub['’]Eau/i.test(e) && !isProgressNote(e);
/** Erreurs du serveur qui sont de vraies pannes (les notes d'avancement sont dites à part, jamais « source indisponible »). */
const realErrors = (f: FloodsResponse): string[] => f.errors.filter((e) => !isProgressNote(e));
const isoOf = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

/** Niveau officiel le plus haut des tronçons (1 si aucun en vigilance). */
function topLevel(f: FloodsResponse): OfficialColorId {
  return f.counts.rouge > 0 ? 4 : f.counts.orange > 0 ? 3 : f.counts.jaune > 0 ? 2 : 1;
}

function countAt(f: FloodsResponse, level: 2 | 3 | 4): number {
  return level === 4 ? f.counts.rouge : level === 3 ? f.counts.orange : f.counts.jaune;
}

function late(f: FloodsResponse, now: number): boolean {
  return isEnvironmentDataLate('vigicrues', f.readAt, now);
}

/** Dernière mesure des stations (« mesures Hub'Eau 10:00 »), hauteur ou débit ; null sans aucune mesure. */
function lastMeasureMs(f: FloodsResponse): number | null {
  const all = f.sections.flatMap((s) => s.stations.flatMap((st) => [dataMs(st.lastAt), dataMs(st.flowAt ?? null)])).filter((x): x is number => x !== null);
  return all.length > 0 ? Math.max(...all) : null;
}

/** Hub'Eau en retard : la mesure la plus récente des stations a plus d'une heure (les hauteurs perdent leurs couleurs). */
function heightsLate(f: FloodsResponse, now: number): boolean {
  const ms = lastMeasureMs(f);
  return ms !== null && isEnvironmentDataLate('hubeau', isoOf(ms), now);
}

function sortedSections(f: FloodsResponse): FloodSection[] {
  return [...f.sections].sort((a, b) => b.level - a.level);
}

// ─── En-tête ───

/** « tronçons en jaune · 0 orange · 0 rouge » ; l'ordre suit le niveau le plus haut (« tronçon en orange · 0 rouge · 4 en jaune »). */
function countsCaption(f: FloodsResponse, top: 2 | 3 | 4): string {
  const n = countAt(f, top);
  const first = `${n > 1 ? 'tronçons' : 'tronçon'} en ${COLOR_WORD[top]}`;
  // Niveaux au-dessus du plus haut d'abord (« 0 orange · 0 rouge »), puis ceux en dessous.
  const others = ([3, 4, 2] as const).filter((l) => l !== top).map((l) => (l === 2 ? `${countAt(f, l)} en jaune` : `${countAt(f, l)} ${COLOR_WORD[l]}`));
  return [first, ...others].join(' · ');
}

function measuresStamp(f: FloodsResponse, now: number): string | null {
  const ms = lastMeasureMs(f);
  return ms === null ? null : `mesures Hub’Eau${NBSP}${absoluteTime(ms, now, 'fr')}${heightsLate(f, now) ? ' (en retard)' : ''}`;
}

function biggestRise(f: FloodsResponse, now: number): { station: FloodStation; section: FloodSection } | null {
  let best: { station: FloodStation; section: FloodSection } | null = null;
  for (const section of f.sections) for (const station of section.stations) {
    const c = shownChange(station.change1hM);
    if (c === null || c <= 0 || stationLate(station, now)) continue;
    if (!best || c > (shownChange(best.station.change1hM) ?? 0)) best = { station, section };
  }
  return best;
}

function headOf(f: FloodsResponse, now: number): LayerHeadModel {
  const isLate = late(f, now);
  const verdict = floodsLevel(f);
  const top = topLevel(f);
  const tail = `sur ${frNumber(f.total, 0)} surveillés · relevé Vigicrues ${clockOf(f.readAt, now)}${isLate ? ' (en retard)' : ''}`;
  const figure = top === 1
    ? { value: '0', caption: `tronçon en vigilance jaune ou plus · ${tail}`, level: isLate ? null : COLOR_LEVEL[1] }
    : { value: frNumber(countAt(f, top), 0), caption: `${countsCaption(f, top)} · ${tail}`, level: isLate ? null : COLOR_LEVEL[top] };
  const stamps = [stamp('Vigicrues', f.readAt, isLate, now), measuresStamp(f, now)].filter((s): s is string => s !== null).join(' · ');
  const rise = isLate ? null : biggestRise(f, now);
  const measured = f.sections.some((s) => s.stations.some((st) => st.heightM !== null));
  const lead = isLate || top === 1 || heightsLate(f, now) ? null
    : rise ? `Plus forte hausse sur 1${NBSP}h : ${rise.station.name} (${rise.section.name}), ${formatChangeM(rise.station.change1hM)}.`
      : measured ? `Aucune station des tronçons en vigilance en hausse sur 1${NBSP}h.` : null;
  return {
    theme: ENVIRONMENT_THEME, title: CRUES_TITLE, figure,
    level: isLate ? 'nd' : verdict.level,
    status: [isLate ? 'niveau suspendu : relevé Vigicrues en retard' : glueEnvUnits(verdict.reason), stamps],
    lead,
  };
}

// ─── Tronçons en vigilance ───

function sectionRow(s: FloodSection, isLate: boolean, canFocus: boolean): string {
  const level: VigilanceLevel = COLOR_LEVEL[s.level];
  const territory = s.territory.name ?? `territoire ${s.territory.code}`;
  const stations = s.stations.length > 0 ? ` · ${plural(s.stations.length, 'station')}` : '';
  return listRow({
    text: s.name, valueHtml: valueHtml(COLOR_WORD[s.level], isLate ? null : level), level: isLate ? 'gris' : level,
    noteHtml: `${escapeHtml(territory)} · ${sourceLinkHtml('bulletin du territoire', s.territory.url)}${escapeHtml(stations)}`,
    ...(canFocus ? { data: { section: s.id }, link: true } : {}),
  });
}

function sectionsSection(f: FloodsResponse | null, canFocus: boolean, now: number, open: OpenFn): FicheSection {
  const base = { id: 'troncons', title: 'Tronçons en vigilance', collapsible: true, open: open('troncons', true) };
  if (!f || f.readAt === null) return { ...base, summary: 'n.d.', html: sourceDown('tronçons Vigicrues') };
  const perimeter = note(`${frNumber(f.total, 0)} tronçons de cours d’eau surveillés par l’État ; les tronçons verts sont comptés, ni listés ni dessinés.`);
  const list = sortedSections(f);
  if (list.length === 0) {
    const vigicruesErrors = realErrors(f).filter((e) => /^Vigicrues/i.test(e) && !/stations|territoires/i.test(e));
    return { ...base, summary: 'aucun', html: emptyOrDown(vigicruesErrors, 'Aucun tronçon en vigilance jaune ou plus.', 'tronçons Vigicrues') + perimeter };
  }
  const isLate = late(f, now);
  return {
    ...base,
    summary: escapeHtml(`${plural(list.length, 'tronçon')} en vigilance${isLate ? ' (en retard)' : ''}`),
    html: list.map((s) => sectionRow(s, isLate, canFocus)).join('') + perimeter
      + note('Niveau officiel de Vigicrues, repris tel quel ; le bulletin du territoire donne la situation et son évolution.')
      + (canFocus ? note('Clic sur une ligne : le tronçon sur la carte.') : ''),
  };
}

// ─── Stations des tronçons en vigilance ───

function points(series: readonly { at: string; value: number }[]): ChartPoint[] {
  return series.flatMap((p) => {
    const at = dataMs(p.at);
    return at === null ? [] : [{ at, value: p.value }];
  });
}

/** Hauteur suivie de sa variation sur 1 h (rouge à la hausse, vert à la baisse, sans couleur à 0 ou en retard), dans une seule valeur insécable. */
function heightHtml(st: FloodStation, isLate: boolean): string {
  const c = st.change1hM;
  const shown = shownChange(c);
  const level: VigilanceLevel | null = shown === null || isLate || shown === 0 ? null : shown > 0 ? 'rouge' : 'vert';
  const change = c === null ? ''
    : ` <span class="lp-trend${level ? ` lp-lvl lp-lvl--${level}` : ''}" aria-label="variation sur 1${NBSP}h">${escapeHtml(formatChangeM(c))}</span>`;
  return `<span class="lp-val fmk-num">${escapeHtml(formatHeightM(st.heightM))}${change}</span>`;
}

function curves(st: FloodStation, isLate: boolean, now: number, openByDefault: boolean): string {
  const from = now - 48 * HOUR_MS;
  const stroke = isLate ? LATE_STROKE : STATION_STROKE;
  const tick = (ms: number): string => absoluteTime(ms, now, 'fr');
  const height = lineChart(points(st.heightSeries), {
    label: `Hauteur d’eau à ${st.name}, 48 dernières heures`, from, to: now, stroke, gapMs: STATION_GAP_MS, markPeak: true,
    value: (v) => formatHeightM(v), tick,
  });
  const flow = lineChart(points(st.flowSeries), {
    label: `Débit à ${st.name}, 48 dernières heures`, from, to: now, stroke, gapMs: STATION_GAP_MS, value: (v) => formatFlowM3s(v), tick,
  });
  if (!height && !flow) return '';
  const title = `${flow ? 'hauteur et débit' : 'hauteur'} sur 48${NBSP}h`;
  return `<details class="lp-more" data-curve="${escapeHtml(st.code)}"${openByDefault ? ' open' : ''}><summary>${escapeHtml(title)}</summary>`
    + (height ? `<div class="lp-legend"><span class="lp-key"><i style="background:${stroke}"></i>hauteur (m)</span></div>${height}` : '')
    + (flow ? `<div class="lp-legend"><span class="lp-key"><i style="background:${stroke}"></i>débit (m³/s)</span></div>${flow}` : '')
    + '</details>';
}

function stationRow(st: FloodStation, section: FloodSection, canFocus: boolean, now: number, first: boolean): string {
  const isLate = stationLate(st, now);
  const measured = st.heightM !== null && st.lastAt !== null;
  // Débit seul (hauteur absente) : le débit est la valeur de la ligne, avec sa propre date.
  const flowOnly = !measured && st.flowM3s !== null && st.flowAt != null;
  const flowLate = flowOnly && isEnvironmentDataLate('hubeau', st.flowAt ?? null, now);
  const value = measured ? heightHtml(st, isLate) : flowOnly ? valueHtml(formatFlowM3s(st.flowM3s)) : valueHtml('n.d.');
  const flowDate = measured && st.flowAt != null && clockOf(st.flowAt, now) !== clockOf(st.lastAt, now) ? ` (mesuré ${clockOf(st.flowAt, now)})` : '';
  const parts = [
    section.name,
    measured ? `mesure ${clockOf(st.lastAt, now)}${isLate ? ' (en retard)' : ''}`
      : flowOnly ? `débit mesuré ${clockOf(st.flowAt, now)}${flowLate ? ' (en retard)' : ''}` : 'aucune mesure lue',
    measured && st.flowM3s !== null ? `débit ${formatFlowM3s(st.flowM3s)}${flowDate}` : null,
  ].filter((x): x is string => x !== null);
  const focusable = canFocus && st.lat !== null && st.lon !== null;
  return listRow({
    text: st.name, valueHtml: value, level: null, color: isLate || flowLate || !(measured || flowOnly) ? null : STATION_STROKE, note: parts.join(' · '),
    ...(focusable ? { data: { station: st.code }, link: true } : {}),
  }) + (measured || flowOnly ? curves(st, isLate || flowLate, now, first) : '');
}

function stationsSection(f: FloodsResponse | null, canFocus: boolean, now: number, open: OpenFn): FicheSection {
  const base = { id: 'stations', title: 'Stations des tronçons en vigilance', collapsible: true, open: open('stations', true) };
  if (!f || f.readAt === null) return { ...base, summary: 'n.d.', html: sourceDown('stations Hub’Eau') };
  const list = sortedSections(f);
  if (list.length === 0) return { ...base, summary: 'aucune', html: emptyLine('Aucun tronçon en vigilance : aucune station suivie.') };
  const hubeau = f.errors.filter(isHubeauError);
  const progress = f.errors.filter(isProgressNote);
  const all = list.flatMap((s) => s.stations);
  const measured = all.filter((st) => st.heightM !== null);
  let html = '';
  if (hubeau.length > 0 && measured.length === 0) html += sourceDown('mesures Hub’Eau des stations');
  else if (hubeau.length > 0) html += note(`Lecture partielle : ${hubeau.join(' ; ')}.`);
  else if (progress.length > 0 && measured.length === 0) html += emptyLine('Mesures Hub’Eau en cours de lecture : hauteurs à la prochaine relève.');
  else if (progress.length > 0) html += note('Hauteurs en cours de lecture : relevé précédent servi.');
  const lastMs = lastMeasureMs(f);
  const heightsAreLate = heightsLate(f, now);
  if (heightsAreLate && lastMs !== null) html += note(`Hauteurs Hub’Eau en retard : dernière mesure ${absoluteTime(lastMs, now, 'fr')}.`);
  for (const s of list) {
    if (s.stations.length === 0) {
      const down = f.errors.some((e) => e.startsWith(`Vigicrues, stations ${s.id}`));
      html += down ? sourceDown(`stations du tronçon ${s.name}`) : emptyLine(`${s.name} : aucune station publiée par Vigicrues pour ce tronçon.`);
      continue;
    }
    html += s.stations.map((st, i) => stationRow(st, s, canFocus, now, i === 0 && st.heightM !== null)).join('');
  }
  if (f.stationsOmitted > 0) html += note(`${plural(f.stationsOmitted, 'station')} au-delà du plafond de 60 : non lues (tronçons rouges, puis orange, puis jaunes d’abord).`);
  html += note(NOT_ALERT)
    + note(`Variation sur 1${NBSP}h : en rouge si la hauteur monte, en vert si elle baisse. Une mesure de plus d’une heure est « (en retard) » et perd ses couleurs ; un trou de mesure reste un trou sur la courbe.`)
    + (canFocus ? note('Clic sur une station : sa position sur la carte.') : '');
  const rising = measured.filter((st) => (shownChange(st.change1hM) ?? 0) > 0 && !stationLate(st, now)).length;
  const summary = measured.length === 0 ? 'n.d.' : `${plural(measured.length, 'station')} mesurée${measured.length > 1 ? 's' : ''} · ${rising} en hausse${heightsAreLate ? ' (en retard)' : ''}`;
  return { ...base, summary: escapeHtml(summary), html };
}

// ─── Méthode et sources ───

function methodSection(input: CruesViewInput): FicheSection {
  const { floods: f, floodsError, now, open } = input;
  const read = f !== null && f.readAt !== null;
  const isLate = f ? late(f, now) : false;
  const lastMs = f ? lastMeasureMs(f) : null;
  const hubeauDown = f ? f.errors.some(isHubeauError) : false;
  const vigicruesState = read ? `relevé du serveur ${clockOf(f.readAt, now)}${isLate ? ' (en retard)' : ''}` : floodsError !== null || f ? 'source indisponible' : 'chargement…';
  const pending = f ? f.errors.some((e) => isProgressNote(e)) : false;
  const hubeauState = !read ? 'n.d.'
    : lastMs !== null ? `dernière mesure ${absoluteTime(lastMs, now, 'fr')}${f && heightsLate(f, now) ? ' (en retard)' : ''}`
      : hubeauDown ? 'source indisponible' : pending ? 'lecture en cours' : 'aucune station suivie';
  const html = kvRow('Tronçons', `${sourceLinkHtml('Vigicrues, InfoVigiCru', VIGICRUES_URL)} · ${escapeHtml(vigicruesState)}`)
    + kvRow('Hauteurs et débits', `${sourceLinkHtml('Hub’Eau, hydrométrie', HUBEAU_URL)} · ${escapeHtml(hubeauState)}`)
    + note(`Le flux InfoVigiCru ne publie pas d’heure de bulletin : l’heure affichée est celle du relevé du serveur (toutes les 10${NBSP}min). Vigicrues publie au moins deux bulletins par jour, davantage en crise.`)
    + note('Stations : celles que Vigicrues rattache aux tronçons en vigilance (60 au plus), lues dans Hub’Eau station par station, jamais par département (le filtre départemental de Hub’Eau n’est pas appliqué).')
    + note(`Hauteur au repère de la station (millimètres publiés, affichés en mètres) ; débit en m³/s quand la station le publie. ${NOT_ALERT}`)
    + note(`Retard : relevé Vigicrues au-delà de 30${NBSP}min ; mesure d’une station au-delà de 1${NBSP}h. Une donnée en retard perd ses couleurs ; la pastille passe à n.d.`)
    + note('Couleurs : niveau officiel du tronçon (jaune, orange, rouge) ; variation d’une station en rouge à la hausse, en vert à la baisse.')
    + readErrors(f ? realErrors(f) : []);
  const down = [!read, read && hubeauDown && lastMs === null].filter(Boolean).length;
  return {
    id: 'methode', title: 'Méthode et sources', collapsible: true, open: open('methode', false), tone: 'reference', html,
    summary: escapeHtml(`2 sources${down > 0 ? ` · ${down} indisponible${down > 1 ? 's' : ''}` : ''}`),
  };
}

// ─── Assemblage ───

export function buildCruesView(input: CruesViewInput): LayerView {
  const { floods: f, floodsError, canFocus, now, open } = input;
  if (f === null && floodsError === null) {
    return { head: { theme: ENVIRONMENT_THEME, title: CRUES_TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  }
  const sections = [sectionsSection(f, canFocus, now, open), stationsSection(f, canFocus, now, open), methodSection(input)];
  if (f === null || f.readAt === null) {
    return {
      head: {
        theme: ENVIRONMENT_THEME, title: CRUES_TITLE, level: 'nd',
        figure: { value: 'n.d.', caption: 'tronçons en vigilance · Vigicrues injoignable', level: null },
        status: ['Vigicrues injoignable'],
      },
      sections, bodyHtml: sourceErrorCallout(null, now),
    };
  }
  return { head: headOf(f, now), sections, bodyHtml: floodsError !== null ? sourceErrorCallout(dataMs(f.readAt), now) : undefined };
}
