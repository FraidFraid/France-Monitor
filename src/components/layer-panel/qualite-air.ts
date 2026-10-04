// src/components/layer-panel/qualite-air.ts : vue pure du panneau Qualité de l'air (spec 2026-10-04 environnement § 3.2) ; aucun accès
// réseau ni DOM. Épisodes de pollution de J à J+2 (procédures d'information-recommandation et d'alerte, Atmo France) et indice ATMO
// par commune agrégé par département. Niveau officiel tel que publié (E1), date de chaque couche (S1), périmètre des AASQA (E4),
// barres par polluant (E5). Un jour non publié n'est jamais « aucun épisode » (S3).
import type { AirEpisode, AirIndexDept, AirQualityResponse } from '../../types/index.ts';
import { airQualityLevel, isEnvironmentDataLate } from '../../services/environment-levels.ts';
import { levelColorVar, type VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { stackedDayBars, type DayStack } from './chart.ts';
import { NBSP, frNumber } from './format.ts';
import { barRow, emptyLine, listRow, loadingBody, sourceErrorCallout, sourceLinkHtml, type LayerHeadModel, type LayerView } from './frame.ts';
import { departementName } from './health-format.ts';
import {
  AIR_INDEX_WORD, AIR_STATE_WORD, ENVIRONMENT_THEME, airIndexLevel, capitalize, clockOf, dayLong, formatShare, glueEnvUnits, note, parisDayWord, plural,
  readErrors, sourceDown, stamp,
} from './environment-format.ts';

export const QUALITE_AIR_TITLE = 'Qualité de l’air';
type OpenFn = (sectionId: string, byDefault: boolean) => boolean;
export interface QualiteAirViewInput { air: AirQualityResponse | null; airError: string | null; now: number; open: OpenFn }

const MAX_INDEX_ROWS = 12;
const ATMO_URL = 'https://www.atmo-france.org/';
const ATMO_DATA_URL = 'https://data.atmo-france.org/';
const STATE_LEVEL: Readonly<Record<AirEpisode['state'], VigilanceLevel | 'gris'>> = { alerte: 'rouge', information: 'orange', inconnu: 'gris' };
/** Codes INSEE des 96 départements de métropole (01 à 19, 2A, 2B, 21 à 95). */
const METRO_CODES: readonly string[] = [
  ...Array.from({ length: 19 }, (_, i) => String(i + 1).padStart(2, '0')), '2A', '2B', ...Array.from({ length: 75 }, (_, i) => String(i + 21)),
];

function episodesLate(a: AirQualityResponse, now: number): boolean {
  return isEnvironmentDataLate('atmo', a.episodesUpdatedAt, now);
}
function indexLate(a: AirQualityResponse, now: number): boolean {
  return isEnvironmentDataLate('atmo', a.index.updatedAt, now);
}
function degraded(d: AirIndexDept): number {
  return d.degrade + d.mauvais + d.tresMauvaisEtPlus;
}
function share(d: AirIndexDept): number {
  return d.communes > 0 ? (degraded(d) / d.communes) * 100 : 0;
}
function deptLabel(d: AirIndexDept): string {
  const name = departementName(d.dept);
  return `${name === d.dept ? d.name : name} (${d.dept})`;
}
/** Jours de J à J+2 publiés par la couche des épisodes (arbitrage 8). */
function publishedDays(a: AirQualityResponse): Set<string> {
  return new Set(a.perPollutant.flatMap((p) => p.days.map((d) => d.date)));
}
function figureLevel(a: AirQualityResponse): VigilanceLevel {
  if (a.episodes.some((e) => e.state === 'alerte')) return 'rouge';
  if (a.episodes.some((e) => e.state === 'information')) return 'orange';
  return 'vert';
}

// ─── En-tête ───

function leadOf(a: AirQualityResponse, now: number): string {
  const parts: string[] = [];
  if (a.episodesUpdatedAt !== null) {
    const published = publishedDays(a);
    const shown = a.days.filter((d) => published.has(d));
    const missing = a.days.filter((d) => !published.has(d));
    const words = (days: string[]): string => {
      const w = days.map((d) => parisDayWord(d, now));
      return w.length < 2 ? w.join('') : `${w.slice(0, -1).join(', ')} et ${w[w.length - 1]}`;
    };
    const pending = missing.length === 0 ? '' : `${shown.length === 0 ? '' : ' ; '}${words(missing)} pas encore ${missing.length > 1 ? 'publiés' : 'publié'}`;
    if (shown.length === 0) parts.push(`Épisodes de pollution : ${words(missing)} pas encore ${missing.length > 1 ? 'publiés' : 'publié'}.`);
    else if (a.episodes.length === 0) parts.push(`Aucun épisode de pollution ${words(shown)} (${frNumber(a.zonesCovered, 0)} zones suivies)${pending}.`);
    else parts.push(`${capitalize(plural(a.episodes.length, 'épisode'))} de pollution en cours ou prévus, jours publiés : ${words(shown)}${pending}.`);
  }
  if (a.index.date !== null) {
    const deg = a.index.departments.reduce((n, d) => n + d.degrade, 0);
    const bad = a.index.departments.reduce((n, d) => n + d.mauvais + d.tresMauvaisEtPlus, 0);
    parts.push(`Indice ATMO du ${dayLong(a.index.date)} : ${frNumber(deg, 0)} communes en indice dégradé sur ${frNumber(a.index.communes, 0)} couvertes, `
      + `${bad === 0 ? 'aucune' : frNumber(bad, 0)} en indice mauvais ou pire.`);
  }
  return parts.join(' ');
}

function headOf(a: AirQualityResponse, now: number): LayerHeadModel {
  const late = a.episodesUpdatedAt !== null && episodesLate(a, now);
  const episodesDown = a.episodesUpdatedAt === null && a.index.communes > 0;
  const verdict = episodesDown ? { level: 'nd' as const, reason: 'épisodes Atmo indisponibles' } : airQualityLevel(a);
  const tail = late ? ' (en retard)' : '';
  return {
    theme: ENVIRONMENT_THEME, title: QUALITE_AIR_TITLE,
    figure: {
      value: a.episodesUpdatedAt === null ? 'n.d.' : frNumber(a.episodes.length, 0),
      caption: `épisodes de pollution en cours ou prévus, J à J+2 · Atmo France, ${clockOf(a.episodesUpdatedAt, now)}${tail}`,
      level: late || a.episodesUpdatedAt === null ? null : figureLevel(a),
    },
    level: late ? 'nd' : verdict.level,
    status: [
      late ? 'niveau suspendu : épisodes Atmo France en retard' : glueEnvUnits(verdict.reason),
      `${stamp('Atmo', a.episodesUpdatedAt, late, now)} · ${stamp('indice', a.index.updatedAt, indexLate(a, now), now)}`,
      ...(a.errors.length > 0 ? [`${plural(a.errors.length, 'incident')} de lecture (voir Méthode et sources)`] : []),
    ],
    lead: late ? null : leadOf(a, now) || null,
  };
}

// ─── Épisodes ───

function episodeRow(e: AirEpisode, late: boolean, now: number): string {
  const day = `${e.date.slice(8, 10)}/${e.date.slice(5, 7)}`;
  const raw = e.state === 'inconnu' ? ` · état publié : ${e.stateRaw || 'vide'}` : e.stateRaw ? ` · procédure publiée : ${e.stateRaw}` : '';
  return listRow({
    text: `${capitalize(e.pollutant)} · ${e.zone}`, value: day, level: late ? 'gris' : STATE_LEVEL[e.state],
    note: `${AIR_STATE_WORD[e.state]} · ${parisDayWord(e.date, now)}${raw}`,
  });
}

function pollutantBars(a: AirQualityResponse, late: boolean): string {
  return a.perPollutant.filter((p) => p.days.some((d) => d.information + d.alerte > 0)).map((p) => {
    const stacks: DayStack[] = p.days.flatMap((d) => {
      const ms = Date.parse(`${d.date}T12:00:00Z`);
      return Number.isFinite(ms) ? [{
        day: ms,
        parts: [
          { value: d.information, color: late ? 'var(--text-primary)' : levelColorVar('orange'), label: 'information-recommandation' },
          { value: d.alerte, color: late ? 'var(--text-primary)' : levelColorVar('rouge'), label: 'alerte' },
        ],
      }] : [];
    });
    return `<h4 class="fmk-eyebrow">${escapeHtml(capitalize(p.pollutant))}</h4>`
      + stackedDayBars(stacks, { label: `Épisodes par jour, ${p.pollutant}`, value: (v) => frNumber(v, 0), tick: (ms) => dayLong(new Date(ms).toISOString().slice(0, 10)) });
  }).join('');
}

function episodesSection(a: AirQualityResponse | null, now: number, open: OpenFn): FicheSection {
  const base = { id: 'episodes', title: 'Épisodes', collapsible: true, open: open('episodes', true) };
  const down = sourceDown('épisodes de pollution (Atmo France)');
  if (!a || a.episodesUpdatedAt === null) return { ...base, summary: 'n.d.', html: down };
  const late = episodesLate(a, now);
  const published = publishedDays(a);
  const missing = a.days.filter((d) => !published.has(d));
  const shown = a.days.filter((d) => published.has(d));
  const missingNote = missing.length === 0 ? ''
    : note(`Prévision non encore publiée pour ${missing.map((d) => `le ${dayLong(d)}`).join(' et ')} (publication vers 14${NBSP}h, heure de Paris).`);
  if (a.episodes.length === 0) {
    const when = shown.length === 0 ? 'publié' : shown.length === 1 ? `le ${dayLong(shown[0])}` : `du ${dayLong(shown[0])} au ${dayLong(shown[shown.length - 1])}`;
    if (late) return { ...base, summary: 'aucun (en retard)', html: emptyLine(`Aucun épisode au dernier relevé du ${clockOf(a.episodesUpdatedAt, now)} (en retard).`) + missingNote };
    return { ...base, summary: 'aucun', html: emptyLine(`Aucun épisode de pollution en cours ni prévu ${when} (${frNumber(a.zonesCovered, 0)} zones suivies).`) + missingNote };
  }
  const rows = a.episodes.map((e) => episodeRow(e, late, now)).join('');
  return {
    ...base, summary: escapeHtml(`${plural(a.episodes.length, 'épisode')}${late ? ' (en retard)' : ''}`),
    html: rows + pollutantBars(a, late) + missingNote
      + note('Épisode : une zone et un polluant en procédure d’information-recommandation (orange) ou d’alerte (rouge) ; « pas de dépassement » n’est pas listé ; un état non reconnu est gris, avec le texte publié.'),
  };
}

// ─── Indice ATMO par département ───

function indexSection(a: AirQualityResponse | null, now: number, open: OpenFn): FicheSection {
  const base = { id: 'indice', title: 'Indice ATMO par département', collapsible: true, open: open('indice', false) };
  if (!a) return { ...base, summary: 'n.d.', html: sourceDown('indice ATMO (Atmo France)') };
  const today = a.days[0] ?? '';
  if (a.index.date === null || a.index.departments.length === 0) {
    return { ...base, summary: 'n.d.', html: a.errors.length > 0 ? sourceDown('indice ATMO (Atmo France)') : emptyLine(`Indice ATMO du ${dayLong(today)} non encore publié.`) };
  }
  const late = indexLate(a, now);
  const ranked = [...a.index.departments].sort((x, y) => (y.maxIndex ?? 0) - (x.maxIndex ?? 0) || share(y) - share(x));
  const rows = ranked.slice(0, MAX_INDEX_ROWS).map((d) => {
    const word = d.maxIndex !== null ? AIR_INDEX_WORD[d.maxIndex] ?? String(d.maxIndex) : 'n.d.';
    const noteText = `${frNumber(degraded(d), 0)} communes sur ${frNumber(d.communes, 0)} en indice dégradé ou pire · indice le plus haut : ${word}`;
    if (late || d.maxIndex === null) return listRow({ text: deptLabel(d), value: formatShare(share(d)), level: 'gris', note: noteText });
    return barRow({ label: deptLabel(d), pct: share(d), value: formatShare(share(d)), level: airIndexLevel(d.maxIndex), note: noteText });
  }).join('');
  const rest = ranked.slice(MAX_INDEX_ROWS);
  const restMax = rest.reduce((m, d) => Math.max(m, d.maxIndex ?? 0), 0);
  const restNote = rest.length === 0 ? '' : note(`${plural(rest.length, 'autre département couvert', 'autres départements couverts')}, indice le plus haut au plus ${AIR_INDEX_WORD[restMax] ?? 'n.d.'}.`);
  const covered = new Set(a.index.departments.map((d) => d.dept));
  const uncovered = METRO_CODES.filter((c) => !covered.has(c));
  const uncoveredNote = uncovered.length === 0 ? ''
    : note(`Départements de métropole sans indice ce jour (${frNumber(uncovered.length, 0)}) : ${uncovered.map(departementName).join(', ')}.`);
  const total = a.index.departments.reduce((n, d) => n + degraded(d), 0);
  return {
    ...base, summary: escapeHtml(`${frNumber(total, 0)} communes en indice dégradé ou pire${late ? ' (en retard)' : ''}`),
    html: rows + restNote + uncoveredNote
      + note(`Jauge : part des communes du département en indice dégradé (3) ou pire, indice du ${dayLong(a.index.date)} mis à jour le ${clockOf(a.index.updatedAt, now)}${late ? ' (en retard)' : ''} ; couleur selon l’indice le plus haut du département : 1 et 2 vert, 3 jaune, 4 orange, 5 et plus rouge (couleurs de l’échelle FranceMonitor, pas la palette officielle ATMO).`),
  };
}

// ─── Méthode et sources ───

function methodSection(a: AirQualityResponse | null, failed: boolean, now: number, open: OpenFn): FicheSection {
  const state = (iso: string | null, late: boolean): string => (iso !== null ? `mise à jour ${clockOf(iso, now)}${late ? ' (en retard)' : ''}` : failed || a !== null ? 'source indisponible' : 'chargement…');
  const html = kvRow('Épisodes', `${sourceLinkHtml('Atmo France, procédures préfectorales (couche alrt3j)', ATMO_DATA_URL)} · ${escapeHtml(state(a?.episodesUpdatedAt ?? null, a ? episodesLate(a, now) : false))}`)
    + kvRow('Indice', `${sourceLinkHtml('Indice ATMO par commune (AASQA)', ATMO_URL)} · ${escapeHtml(state(a?.index.updatedAt ?? null, a ? indexLate(a, now) : false))}`)
    + note('Niveaux officiels tels que publiés par les associations agréées de surveillance de la qualité de l’air (E1). Les textes des arrêtés préfectoraux ne sont pas dans ce flux : le panneau donne la procédure et le polluant, pas l’arrêté.')
    + note('Périmètre : communes couvertes par les AASQA ce jour ; les zones intercommunales (codes SIREN) ne sont pas rattachées à un département ; les libellés de polluants, différents d’une AASQA à l’autre, sont regroupés par nom.')
    + note('Pastille : rouge si un épisode atteint le seuil d’alerte ; orange en information-recommandation ; jaune si au moins une commune est en indice mauvais (4) ou pire ; vert sinon. Couleurs de l’échelle FranceMonitor, pas la palette officielle ATMO.')
    + note('Situation : un épisode au seuil d’alerte en J ou J+1 crée une situation de sévérité moyenne ; elle ne plafonne pas le score.')
    + note(`Retard : au-delà de 36${NBSP}h après la mise à jour. Relève : toutes les heures de 13${NBSP}h à 19${NBSP}h (heure de Paris), toutes les 6${NBSP}h sinon ; requêtes toujours filtrées par date et par propriétés.`)
    + readErrors(a?.errors ?? []);
  return { id: 'methode', title: 'Méthode et sources', collapsible: true, open: open('methode', false), tone: 'reference', summary: 'Atmo France', html };
}

// ─── Assemblage ───

export function buildQualiteAirView(input: QualiteAirViewInput): LayerView {
  const { air: a, airError, now, open } = input;
  if (a === null && airError === null) {
    return { head: { theme: ENVIRONMENT_THEME, title: QUALITE_AIR_TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  }
  const sections = [episodesSection(a, now, open), indexSection(a, now, open), methodSection(a, airError !== null, now, open)];
  if (a === null) {
    return {
      head: {
        theme: ENVIRONMENT_THEME, title: QUALITE_AIR_TITLE, level: 'nd',
        figure: { value: 'n.d.', caption: 'épisodes de pollution en cours ou prévus, J à J+2', level: null }, status: ['Atmo France injoignable'],
      },
      sections, bodyHtml: sourceErrorCallout(null, now),
    };
  }
  const last = [a.episodesUpdatedAt, a.index.updatedAt].map((d) => (d ? Date.parse(d) : Number.NaN)).filter(Number.isFinite).sort((x, y) => x - y).at(-1) ?? null;
  return { head: headOf(a, now), sections, bodyHtml: airError !== null ? sourceErrorCallout(last, now) : undefined };
}
