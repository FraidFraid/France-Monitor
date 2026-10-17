// src/components/layer-panel/criminalite.ts : vue pure du panneau Criminalité (spec 2026-10-17 criminalité) ; aucun accès réseau ni DOM.
// Délinquance ENREGISTRÉE (plaintes et constatations de la police et de la gendarmerie, SSMSI), annuelle, par département et par ville de
// 20 000 habitants et plus ; homicides au département seulement. Un sélecteur d'indicateur pilote la carte. Aucun effet sur l'indice de
// stabilité. Textes du fichier échappés.
import type { CrimeDataset, CrimeIndicatorKey } from '../../types/index.ts';
import {
  CRIME_INDICATOR_KEYS, crimeBand, franceLatest, indicatorOf, rankCities, rankDepartments,
} from '../../services/crime.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { CRIME_BAND_HEX } from '../deckgl/crime-map.ts';
import { lineChart } from './chart.ts';
import { formatCrimeCount, formatCrimeRate, formatEvolution, rateBaseWord, readingNote } from './crime-format.ts';
import { emptyLine, listRow, loadingBody, sourceLinkHtml, valueHtml, type LayerView } from './frame.ts';
import { NBSP, frNumber } from './format.ts';
import { note, plural } from './traffic-format.ts';

export const CRIMINALITE_THEME = 'Sécurité et défense';
export const CRIMINALITE_TITLE = 'Criminalité';
export const CRIME_CITY_ROWS = 20;
export const CRIME_DEPT_ROWS = 15;
type OpenFn = (sectionId: string, byDefault: boolean) => boolean;

export interface CriminaliteViewInput {
  data: CrimeDataset | null; error: string | null; indicator: CrimeIndicatorKey; canFocus: boolean; now: number; open: OpenFn;
}

/** « 09/07/2026 » pour un jour « AAAA-MM-JJ » ; null si illisible. */
export function frDate(day: string | null): string | null {
  const m = day === null ? null : /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : null;
}

function statusLine(ds: CrimeDataset): string {
  const date = frDate(ds.publishedAt);
  return `SSMSI · données ${ds.year}${date ? ` · publié le ${date}` : ''}`;
}

/** Sélecteur d'indicateur : liste de 16 entrées, la valeur choisie pilote la carte. */
export function indicatorSelectHtml(ds: CrimeDataset, selected: CrimeIndicatorKey): string {
  const labels = new Map(ds.indicators.map((i): [CrimeIndicatorKey, string] => [i.key, i.label]));
  const options = CRIME_INDICATOR_KEYS.filter((k) => labels.has(k))
    .map((k) => `<option value="${k}"${k === selected ? ' selected' : ''}>${escapeHtml(labels.get(k) ?? k)}</option>`).join('');
  return `<div class="lp-toolbar"><select class="lp-select" data-crime-indicator aria-label="Indicateur affiché sur la carte">${options}</select></div>`;
}

const focusData = (code: string, lat: number, lon: number): Readonly<Record<string, string>> => ({ crime: `${lat},${lon}`, 'crime-city': code });

function homicidesSection(ds: CrimeDataset, open: OpenFn): FicheSection {
  const ranked = rankDepartments(ds, 'homicides', CRIME_DEPT_ROWS);
  const fr = franceLatest(ds, 'homicides');
  const rows = ranked.map(({ dept, reading, ratio }) => listRow({
    text: `${dept.name} (${dept.code})`, value: formatCrimeRate('homicides', reading.rate), color: CRIME_BAND_HEX[crimeBand(ratio)],
    note: readingNote(reading, ds.previousYear),
  })).join('');
  const series = (ds.france.homicides ?? []).map((p) => ({ at: Date.UTC(p.year, 0, 1), value: p.count }));
  const chart = lineChart(series, {
    label: `Homicides en France, ${series.length > 0 ? new Date(series[0].at).getUTCFullYear() : ''} à ${ds.year}`,
    from: series[0]?.at ?? 0, to: series[series.length - 1]?.at ?? 0, stroke: CRIME_BAND_HEX.moyen, markPeak: true,
    value: (v) => frNumber(v, 0), tick: (ms) => String(new Date(ms).getUTCFullYear()),
  });
  const trend = chart !== '' ? `<p class="lp-subhead">France, ${escapeHtml(String(new Date(series[0].at).getUTCFullYear()))} à ${ds.year} (nombre d’homicides)</p>${chart}` : '';
  const html = (fr ? kvRow('France', escapeHtml(`${formatCrimeCount(fr.count)} · ${formatCrimeRate('homicides', fr.rate)}`)) : '')
    + (ranked.length === 0 ? emptyLine('Aucun taux publié.') : rows)
    + note('Pas de chiffre par ville : le ministère de l’Intérieur ne publie les homicides qu’au département.')
    + trend;
  return {
    id: 'homicides', title: `Homicides par département (${ds.year})`, collapsible: true, open: open('homicides', true),
    summary: fr ? `${formatCrimeCount(fr.count)}${NBSP}en France` : undefined, html,
  };
}

function citiesSection(ds: CrimeDataset, key: CrimeIndicatorKey, canFocus: boolean, open: OpenFn): FicheSection {
  const ind = indicatorOf(ds, key);
  const title = `Villes de ${frNumber(ds.cityMinPopulation, 0)}${NBSP}habitants et plus`;
  if (ind && !ind.communal) {
    return {
      id: 'villes', title, collapsible: true, open: open('villes', true), summary: ind.label,
      html: emptyLine(`${ind.label} : publié au département seulement. Choisir un autre indicateur pour classer les villes.`),
    };
  }
  const ranked = rankCities(ds, key, CRIME_CITY_ROWS);
  const html = ranked.length === 0 ? emptyLine('Aucune ville avec un taux publié pour cet indicateur.')
    : ranked.map(({ city, reading, ratio }) => listRow({
      text: `${city.name} · ${city.dept}`, value: formatCrimeRate(key, reading.rate), color: CRIME_BAND_HEX[crimeBand(ratio)],
      note: `${readingNote(reading, ds.previousYear)} · ${frNumber(city.population, 0)}${NBSP}hab.`,
      data: focusData(city.code, city.lat, city.lon), link: canFocus,
    })).join('');
  return {
    id: 'villes', title, collapsible: true, open: open('villes', true), summary: `${ind?.label ?? key} · ${plural(ranked.length, 'ville')}`,
    html: html + note(`Classement par taux (${rateBaseWord(ind)}), pas par nombre de faits.`),
  };
}

function departmentsSection(ds: CrimeDataset, key: CrimeIndicatorKey, open: OpenFn): FicheSection {
  const ind = indicatorOf(ds, key);
  const ranked = rankDepartments(ds, key, CRIME_DEPT_ROWS);
  const html = ranked.length === 0 ? emptyLine('Aucun taux publié pour cet indicateur.')
    : ranked.map(({ dept, reading, ratio }) => listRow({
      text: `${dept.name} (${dept.code})`, value: formatCrimeRate(key, reading.rate), color: CRIME_BAND_HEX[crimeBand(ratio)],
      note: `${ratio === null ? 'rapport n.d.' : `${frNumber(ratio, 2)}${NBSP}fois la France`} · ${readingNote(reading, ds.previousYear)}`,
    })).join('');
  return {
    id: 'departements', title: 'Départements', collapsible: true, open: open('departements', key !== 'homicides'),
    summary: ind?.label, html,
  };
}

function franceSection(ds: CrimeDataset, open: OpenFn): FicheSection {
  const rows = CRIME_INDICATOR_KEYS.map((k) => {
    const ind = indicatorOf(ds, k);
    const latest = franceLatest(ds, k);
    if (!ind || !latest) return '';
    const prev = (ds.france[k] ?? []).find((p) => p.year === (ds.previousYear ?? -1))?.count ?? null;
    return listRow({
      text: ind.label, valueHtml: valueHtml(formatCrimeCount(latest.count)),
      note: `${formatCrimeRate(k, latest.rate)} · ${formatEvolution(latest.count, prev)}${NBSP}vs${NBSP}${ds.previousYear ?? 'n.d.'}`,
    });
  }).join('');
  return { id: 'france', title: `France entière (${ds.year})`, collapsible: true, open: open('france', false), summary: plural(CRIME_INDICATOR_KEYS.length, 'indicateur'), html: rows };
}

function methodSection(ds: CrimeDataset, open: OpenFn): FicheSection {
  const date = frDate(ds.publishedAt);
  const html = kvRow('Source', `${sourceLinkHtml('SSMSI, bases statistiques', ds.sourceUrl)}`)
    + kvRow('Millésime', escapeHtml(`${ds.year}${date ? `, publié le ${date}` : ''}`))
    + note('Délinquance enregistrée : plaintes et constatations de la police et de la gendarmerie nationales, pas la délinquance réelle. Beaucoup de faits ne sont jamais déclarés, et l’enregistrement dépend aussi de l’activité des services.')
    + note('Lieu de commission des faits, et non domicile de la victime ou de l’auteur.')
    + note(`Taux pour mille habitants (cambriolages : pour mille logements) ; homicides : pour 100${NBSP}000 habitants. Villes de ${frNumber(ds.cityMinPopulation, 0)}${NBSP}habitants et plus seulement.`)
    + note('Secret statistique : quand un nombre est trop faible pour être publié, le ministère diffuse une estimation lissée du taux ; elle est signalée « estimé » et le nombre est absent.')
    + note('Homicides et tentatives d’homicide : publiés au département seulement.')
    + note('Données annuelles, rééditées en janvier et en juillet.')
    + note('Cette couche n’a aucun effet sur l’indice de stabilité, les situations ni la synthèse.');
  return { id: 'methode', title: 'Méthode et sources', collapsible: true, open: open('methode', false), tone: 'reference', summary: 'SSMSI · délinquance enregistrée', html };
}

export function buildCriminaliteView(input: CriminaliteViewInput): LayerView {
  const { data, error, indicator, canFocus, open } = input;
  if (data === null && error === null) {
    return { head: { theme: CRIMINALITE_THEME, title: CRIMINALITE_TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  }
  if (data === null) {
    return {
      head: { theme: CRIMINALITE_THEME, title: CRIMINALITE_TITLE, level: null, figure: { value: 'n.d.', caption: 'homicides', level: null }, status: ['fichier indisponible'] },
      sections: [], bodyHtml: '<p class="fmk-callout lp-callout">Fichier des statistiques de délinquance indisponible. Réessayer en rouvrant la couche.</p>',
    };
  }
  const fr = franceLatest(data, 'homicides');
  return {
    head: {
      theme: CRIMINALITE_THEME, title: CRIMINALITE_TITLE, level: null,
      figure: { value: fr ? frNumber(fr.count, 0) : 'n.d.', caption: `homicides en ${data.year}`, level: null },
      status: [statusLine(data)],
    },
    sections: [
      homicidesSection(data, open), citiesSection(data, indicator, canFocus, open), departmentsSection(data, indicator, open),
      franceSection(data, open), methodSection(data, open),
    ],
    bodyHtml: indicatorSelectHtml(data, indicator) + (error !== null ? '<p class="fmk-callout lp-callout">Relecture impossible : données précédentes conservées.</p>' : ''),
  };
}
