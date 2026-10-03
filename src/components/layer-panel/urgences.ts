// src/components/layer-panel/urgences.ts : vue pure du panneau Urgences et SOS Médecins (spec 2026-10-03 § 3.2) ; aucun
// accès réseau ni DOM. Parts des passages codés (jamais un taux pour 100 000 habitants), niveau saisonnier sur trois saisons.
import type {
  AlertLevelsResponse, EpiWeek, SyndromeKey, SyndromicDepartment, SyndromicDepartmentValue, SyndromicResponse, SyndromicSeries,
  SyndromicWeekPoint,
} from '../../types/index.ts';
import {
  alertInSeason, epiWeekLabel, isHealthDataLate, phaseLabel, seasonalLevel, urgencesLevel, type HealthLevel,
} from '../../services/health-levels.ts';
import { dataDateMs } from '../../services/health-surveillance.ts';
import { LEVEL_RANK, levelColorVar } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { kvRow, levelDot } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { lineChart } from './chart.ts';
import { NBSP, formatPct, formatSignedPct } from './format.ts';
import { emptyLine, listRow, loadingBody, sourceErrorCallout, sourceLinkHtml, valueHtml, type LayerView } from './frame.ts';
import {
  PER_100K, SYNDROME_LABEL, URGENCES_SYNDROMES, URGENCES_SYNDROME_LABEL, changeHtml, changeLevel, changePct, inSentence, isoWeekId,
  parisDay, positionWords, seasonalReading, shiftDate, urgencesDriver, weekNumber, weekShort, weekYear, type UrgencesSyndrome,
} from './health-format.ts';

export interface UrgencesViewInput {
  data: SyndromicResponse | null;
  error: string | null;
  /** Niveaux d'alerte : contexte outre-mer des départements (null s'ils manquent). */
  alerts: AlertLevelsResponse | null;
  /** Syndrome de la carte et des départements les plus hauts (sélecteur du panneau). */
  syndrome: UrgencesSyndrome;
  now: number;
  open: (sectionId: string, byDefault: boolean) => boolean;
}

const THEME = 'Santé';
const TITLE = 'Urgences et SOS Médecins';
const SOURCE = 'Santé publique France';
const DAY_MS = 86_400_000;
const ORDER: readonly SyndromeKey[] = ['ira', 'bronchio', 'gastro', 'asthme', 'allergie', 'grippe', 'covid'];
const ROW_LABEL: Readonly<Record<SyndromeKey, string>> = {
  ira: 'IRA', bronchio: 'Bronchiolite (moins de 1 an)', gastro: 'Gastro-entérite', asthme: 'Asthme', allergie: 'Allergie', grippe: 'Grippe', covid: 'COVID-19',
};
/** Département d'outre-mer → région Odissé (contexte des niveaux d'alerte). */
const DROM_REGION: Readonly<Record<string, string>> = { '971': '01', '972': '02', '973': '03', '974': '04', '976': '06' };
type OpenFn = UrgencesViewInput['open'];
const note = (text: string): string => `<p class="fmk-note">${escapeHtml(text)}</p>`;

/** Mots d'un niveau saisonnier au-dessus du vert (règle de la partie A : jaune au-dessus du maximum, orange à 1,15 fois, rouge à 1,5 fois). */
const ABOVE: Readonly<Record<'jaune' | 'orange' | 'rouge', string>> = { jaune: 'au-dessus', orange: 'bien au-dessus', rouge: 'très au-dessus' };

/** Ligne de niveau : position du syndrome qui porte la pastille (le premier au plus haut niveau, comme urgencesLevel). */
function statusPosition(d: SyndromicResponse, level: HealthLevel): string {
  if (level === 'nd') return 'comparaison saisonnière n.d.';
  if (level === 'vert') return 'sous le maximum des 3 saisons précédentes';
  return `${inSentence(SYNDROME_LABEL[urgencesDriver(d, level)])} ${ABOVE[level]} des 3 saisons précédentes`;
}

interface Move { key: SyndromeKey; pct: number }

/** Synthèse : dynamique sur deux semaines des syndromes en mouvement (±20 % ou plus), IRA d'abord, puis position saisonnière. */
function leadOf(d: SyndromicResponse, week: EpiWeek, level: HealthLevel): string {
  const twoWeeksAgo = shiftDate(week.start, -14);
  const moves: Move[] = d.syndromes.flatMap((s) => {
    const pct = changePct(s.france.find((p) => p.week === week.id)?.er, s.france.find((p) => p.start === twoWeeksAgo)?.er);
    return pct !== null && Math.abs(pct) >= 20 ? [{ key: s.key, pct }] : [];
  });
  const order = (a: Move, b: Move): number => (a.key === 'ira' ? -1 : b.key === 'ira' ? 1 : Math.abs(b.pct) - Math.abs(a.pct));
  const fmt = (m: Move): string => `${inSentence(SYNDROME_LABEL[m.key])} ${formatSignedPct(m.pct, 0)}`;
  const since = weekShort(isoWeekId(twoWeeksAgo));
  const wk = weekNumber(week.id);
  const rentree = wk !== null && wk >= 36 && wk <= 41;
  const rises = moves.filter((m) => m.pct > 0).sort(order);
  const falls = moves.filter((m) => m.pct < 0).sort(order);
  const parts: string[] = [];
  if (rises.length > 0) parts.push(`Hausse${rentree ? ' de rentrée' : ''} sur deux semaines (${rises.map(fmt).join(', ')} depuis ${since})`);
  if (falls.length > 0) parts.push(`${rises.length > 0 ? 'baisse' : 'Baisse'} sur deux semaines (${falls.map(fmt).join(', ')} depuis ${since})`);
  const head = parts.length > 0 ? parts.join(' ; ') : 'Activité stable sur deux semaines';
  const tail = level === 'nd' ? ''
    : level === 'vert' ? ', sans dépasser les saisons précédentes'
    : ` ; ${inSentence(SYNDROME_LABEL[urgencesDriver(d, level)])} ${ABOVE[level]} des saisons précédentes`;
  return `${head}${tail}.`;
}

function headOf(d: SyndromicResponse, week: EpiWeek, late: boolean): LayerView['head'] {
  const ira = d.syndromes.find((s) => s.key === 'ira');
  const r = ira ? seasonalReading(ira, week.id) : null;
  const pct = r ? changePct(r.value, r.previous) : null;
  const position = r ? positionWords(r) : null;
  const base = `des passages aux urgences pour IRA · ${weekShort(week.id)}`;
  const change = pct === null ? null : `${formatSignedPct(pct, 0)} sur ${weekShort(isoWeekId(shiftDate(week.start, -7)))}`;
  const tail = late ? ' (en retard)' : '';
  const level: HealthLevel = late ? 'nd' : urgencesLevel(d).level;
  return {
    theme: THEME, title: TITLE,
    figure: {
      value: r && r.value !== null ? formatPct(r.value, 1) : 'n.d.',
      caption: `${[base, change, position].filter((s): s is string => s !== null).join(' · ')}${tail}`,
      captionHtml: `${escapeHtml(base)}${change !== null ? ` · ${valueHtml(change, late ? null : changeLevel(pct))}` : ''}`
        + `${position ? escapeHtml(` · ${position}`) : ''}${escapeHtml(tail)}`,
      level: late || !r || r.level === 'nd' ? null : r.level,
    },
    level,
    status: [
      late ? 'niveau saisonnier suspendu : données en retard' : statusPosition(d, level),
      `${weekShort(week.id)}${d.publishedAt ? ` · publiée le ${parisDay(d.publishedAt)}` : ''}${tail}`,
      SOURCE,
    ],
    lead: leadOf(d, week, level),
  };
}

function seriesInOrder(d: SyndromicResponse): SyndromicSeries[] {
  return ORDER.flatMap((k) => d.syndromes.filter((s) => s.key === k));
}

function syndromesSection(d: SyndromicResponse, week: EpiWeek, late: boolean, open: OpenFn): FicheSection {
  const series = seriesInOrder(d);
  const readings = series.map((s) => ({ s, r: seasonalReading(s, week.id), sos: s.france.find((p) => p.week === week.id)?.sos ?? null }));
  const rows = readings.map(({ s, r, sos }) => {
    const er = r.value === null ? 'n.d.' : formatPct(r.value, 1);
    const erHtml = s.key === 'ira' ? `<b class="lp-val fmk-num">${er}</b>` : valueHtml(er);
    return `<tr><th scope="row">${levelDot(late || r.level === 'nd' ? null : r.level)}${escapeHtml(ROW_LABEL[s.key])}</th>`
      + `<td>${erHtml}</td><td>${valueHtml(sos === null ? 'n.d.' : formatPct(sos, 1))}</td><td>${changeHtml(changePct(r.value, r.previous), late)}</td></tr>`;
  }).join('');
  const rising = readings.filter(({ r }) => {
    const pct = changePct(r.value, r.previous);
    return pct !== null && Math.round(pct) > 0;
  }).length;
  const table = '<table class="lp-tbl"><thead><tr><th scope="col">Part des passages</th><th scope="col">Urgences</th>'
    + `<th scope="col">SOS Méd.</th><th scope="col">S/S-1</th></tr></thead><tbody>${rows}</tbody></table>`;
  return {
    id: 'syndromes', title: 'Syndromes', collapsible: true, open: open('syndromes', true),
    summary: escapeHtml(`${series.length} suivis · ${rising} en hausse`),
    html: table + note(`Part des passages aux urgences codés pour le syndrome (tous âges ; bronchiolite : moins de 1 an) et part des actes SOS Médecins ; `
      + `jamais un taux ${PER_100K}. Évolution sur la semaine précédente : rouge à +10${NBSP}% ou plus, verte à −10${NBSP}% ou moins ; puce : niveau saisonnier.`),
  };
}

function ira12Section(d: SyndromicResponse, week: EpiWeek, late: boolean, open: OpenFn): FicheSection {
  const base = { id: 'ira12', title: 'IRA, 12 semaines', collapsible: true, open: open('ira12', true) };
  const ira = d.syndromes.find((s) => s.key === 'ira');
  const end = dataDateMs(week.start);
  if (!ira || end === null) return { ...base, summary: 'n.d.', html: emptyLine('Série IRA indisponible.') };
  const from = end - 77 * DAY_MS;
  const points = (shift: number): Array<{ at: number; value: number }> => ira.france.flatMap((p) => {
    const at = dataDateMs(p.start);
    if (at === null || p.er === null) return [];
    const t = at + shift;
    return t >= from && t <= end ? [{ at: t, value: p.er }] : [];
  });
  const r = seasonalReading(ira, week.id);
  const stroke = late || r.level === 'nd' ? 'var(--text-primary)' : levelColorVar(r.level);
  const year = weekYear(week.id);
  const prevYear = year === null ? 'saison précédente' : String(year - 1);
  const firstWeek = weekShort(isoWeekId(shiftDate(week.start, -77)));
  const chart = lineChart(points(0), {
    label: 'Part des passages aux urgences pour IRA sur 12 semaines, saison précédente en pointillé', from, to: end, stroke, markPeak: true,
    dashed: points(364 * DAY_MS), value: (v) => formatPct(v, 1), tick: (ms) => (ms === from ? firstWeek : weekShort(week.id)),
  });
  const legend = `<div class="lp-legend"><span class="lp-key"><i style="background:${stroke}"></i>${year ?? ''}</span>`
    + `<span class="lp-key"><i class="lp-dash"></i>${prevYear}, même semaine</span></div>`;
  const refs = r.refs.length > 0 ? r.refs.map((v) => formatPct(v, 1)).join(' · ') : 'n.d.';
  const latest = r.refs[0];
  const summary = r.value === null ? 'n.d.' : latest !== undefined ? `${formatPct(r.value, 1)} contre ${formatPct(latest, 1)} en ${prevYear}` : formatPct(r.value, 1);
  return {
    ...base, summary: escapeHtml(summary),
    html: (chart || emptyLine('Moins de deux semaines publiées.')) + legend + kvRow(`Même semaine, ${r.refs.length} saisons précédentes`, valueHtml(refs)),
  };
}

function deptNote(dep: SyndromicDepartment, v: SyndromicDepartmentValue, alerts: AlertLevelsResponse | null, now: number): string {
  const parts: string[] = [];
  const region = DROM_REGION[dep.code];
  if (region && alerts) {
    for (const l of alerts.levels) {
      if (l.region !== region || l.phase === 1 || !alertInSeason(l, now)) continue;
      parts.push(l.phase === 3 ? `épidémie de ${l.pathology}` : `${l.pathology} en ${phaseLabel(l.phase)}`);
    }
  }
  parts.push(v.sos === null ? 'pas d’association SOS Médecins' : `SOS Médecins ${formatPct(v.sos, 1)} des actes`);
  if (v.hosp !== null) parts.push(`hospitalisations après passage ${formatPct(v.hosp, 1)}`);
  return parts.join(' · ');
}

function departmentsSection(input: UrgencesViewInput, d: SyndromicResponse, late: boolean): FicheSection {
  const k = input.syndrome;
  const base = { id: 'departments', title: 'Départements les plus hauts', collapsible: true, open: input.open('departments', true) };
  const ranked = d.departments
    .flatMap((dep) => {
      const v = dep.values[k];
      return v && v.er !== null ? [{ dep, v, er: v.er }] : [];
    })
    .sort((a, b) => b.er - a.er).slice(0, 5);
  const label = URGENCES_SYNDROME_LABEL[k];
  const top = ranked[0];
  if (!top) return { ...base, summary: escapeHtml(`${label} · n.d.`), html: emptyLine('Aucune valeur départementale publiée pour ce syndrome.') };
  const rows = ranked.map(({ dep, v, er }) => {
    const lv = late ? 'nd' : seasonalLevel(er, v.refEr);
    return listRow({ text: dep.name, value: formatPct(er, 1), level: lv === 'nd' ? 'gris' : lv, note: deptNote(dep, v, input.alerts, input.now), data: { dept: dep.code } });
  }).join('');
  return {
    ...base, summary: escapeHtml(`${label} · ${top.dep.name} ${formatPct(top.er, 1)}`),
    html: rows + note('Puce : niveau saisonnier du département (même semaine des 3 saisons précédentes). Valeurs départementales non agrégeables ; petits effectifs : valeurs extrêmes possibles.'),
  };
}

function agesSection(d: SyndromicResponse, week: EpiWeek, late: boolean, open: OpenFn): FicheSection {
  const ira = d.syndromes.find((s) => s.key === 'ira');
  const bronchio = d.syndromes.find((s) => s.key === 'bronchio');
  const covid = d.syndromes.find((s) => s.key === 'covid');
  const prevStart = shiftDate(week.start, -7);
  const prevWeek = weekShort(isoWeekId(prevStart));
  const erOf = (points: readonly SyndromicWeekPoint[] | undefined, pick: (p: SyndromicWeekPoint) => boolean): number | null => points?.find(pick)?.er ?? null;
  const rows: ReadonlyArray<readonly [string, readonly SyndromicWeekPoint[] | undefined]> = [
    ['IRA, 0-4 ans', ira?.ages['00-04 ans']], ['IRA, 5-14 ans', ira?.ages['05-14 ans']], ['IRA, 15-64 ans', ira?.ages['15-64 ans']],
    ['IRA, 65 ans et plus', ira?.ages['65 ans ou plus']], ['Bronchiolite, moins de 1 an', bronchio?.france],
    ['COVID-19, 65 ans et plus', covid?.ages['65 ans ou plus']],
  ];
  const html = rows.map(([label, points]) => {
    const cur = erOf(points, (p) => p.week === week.id);
    const prev = erOf(points, (p) => p.start === prevStart);
    return listRow({ text: label, value: cur === null ? 'n.d.' : formatPct(cur, 1), noteHtml: `${escapeHtml(`sur ${prevWeek} : `)}${changeHtml(changePct(cur, prev), late)}` });
  }).join('') + note('Part des passages aux urgences de la classe d’âge ; bronchiolite : moins de 1 an, comme la série principale.');
  const young = erOf(ira?.ages['00-04 ans'], (p) => p.week === week.id);
  const old = erOf(ira?.ages['65 ans ou plus'], (p) => p.week === week.id);
  return {
    id: 'ages', title: 'Par âge', collapsible: true, open: open('ages', false), html,
    summary: escapeHtml(`IRA 0-4 ans ${young === null ? 'n.d.' : formatPct(young, 1)} · 65 ans et plus ${old === null ? 'n.d.' : formatPct(old, 1)}`),
  };
}

/** Hospitalisations après passage de la même semaine ISO des trois saisons précédentes, de la plus récente à la plus ancienne. */
function hospRefs(series: SyndromicSeries, weekId: string): number[] {
  const year = weekYear(weekId);
  const wk = weekNumber(weekId);
  if (year === null || wk === null) return [];
  return [1, 2, 3].flatMap((k) => {
    const v = series.france.find((p) => weekYear(p.week) === year - k && weekNumber(p.week) === wk)?.hosp;
    return v === null || v === undefined || !Number.isFinite(v) ? [] : [v];
  });
}

function hospSection(d: SyndromicResponse, week: EpiWeek, late: boolean, open: OpenFn): FicheSection {
  const items = seriesInOrder(d).map((s) => {
    const hosp = s.france.find((p) => p.week === week.id)?.hosp ?? null;
    return { s, hosp, lv: late ? 'nd' as const : seasonalLevel(hosp, hospRefs(s, week.id)) };
  });
  const rows = items.map(({ s, hosp, lv }) => listRow({
    text: ROW_LABEL[s.key], value: hosp === null ? 'n.d.' : formatPct(hosp, 1), level: lv === 'nd' ? 'gris' : lv,
  })).join('');
  const high = items.filter((x) => x.lv !== 'nd' && LEVEL_RANK[x.lv] >= LEVEL_RANK.jaune).length;
  const ira = items.find((x) => x.s.key === 'ira');
  const summary = `IRA ${ira && ira.hosp !== null ? formatPct(ira.hosp, 1) : 'n.d.'} · `
    + (high === 0 ? 'toutes sous la moyenne saisonnière' : `${high} au-dessus de la moyenne saisonnière`);
  return {
    id: 'hosp', title: 'Hospitalisations après passage', collapsible: true, open: open('hosp', false), summary: escapeHtml(summary),
    html: rows + note('Part des hospitalisations après passage pour le syndrome parmi les hospitalisations après passage avec un diagnostic '
      + '(description Santé publique France) ; puce : niveau saisonnier, même semaine des 3 saisons précédentes.'),
  };
}

function methodSection(d: SyndromicResponse | null, error: string | null, now: number, open: OpenFn): FicheSection {
  const week = d?.week ?? null;
  const late = week ? isHealthDataLate('syndromic', week.end, now) : false;
  const state = week
    ? `${epiWeekLabel(week)}, publiée le ${parisDay(d?.publishedAt)}${late ? ' (en retard)' : ''}${error !== null ? ' ; source injoignable au dernier essai' : ''}`
    : error !== null ? 'source indisponible' : 'chargement…';
  const html = kvRow('Urgences et SOS Médecins', `${sourceLinkHtml('Odissé (Santé publique France)', 'https://odisse.santepubliquefrance.fr')} · ${escapeHtml(state)}`)
    + note(`Part des passages : passages pour le syndrome (diagnostic principal ou associé) rapportés aux passages ayant au moins un diagnostic codé, `
      + `même âge et même zone ; ce n’est pas un taux ${PER_100K}. SOS Médecins : part des actes avec un diagnostic.`)
    + note(`Couverture : environ 700 structures d’urgences (OSCOUR, 96${NBSP}% des passages) et 62 associations SOS Médecins (95${NBSP}% des actes) ; `
      + 'zone : lieu de recours, pas domicile.')
    + note('Niveau saisonnier : comparaison au maximum de la même semaine des 3 saisons précédentes ; vert au plus ce maximum, '
      + 'jaune au-dessus, orange à 1,15 fois ce maximum ou plus, rouge à 1,5 fois ou plus ; n.d. avec moins de deux saisons de référence.')
    + note('Départements : valeurs non agrégeables (Santé publique France), petits effectifs (valeurs extrêmes possibles) ; 55 départements sans association SOS Médecins.')
    + note('Retard : au-delà de 17 jours après la fin de la semaine (publication le mercredi suivant) ; la donnée perd alors ses couleurs.')
    + (d && d.errors.length > 0 ? note(`Jeux en échec : ${d.errors.join(' ; ')}.`) : '');
  return { id: 'method', title: 'Méthode et sources', collapsible: true, open: open('method', false), tone: 'reference', summary: 'OSCOUR · SOS Médecins', html };
}

function selectorHtml(selected: UrgencesSyndrome): string {
  const buttons = URGENCES_SYNDROMES.map((s) => `<button type="button" class="lp-toggle" data-urg-syndrome="${s}" aria-pressed="${s === selected}">`
    + `${escapeHtml(URGENCES_SYNDROME_LABEL[s])}</button>`).join('');
  return `<div class="lp-seg" role="group" aria-label="Syndrome affiché sur la carte et dans les départements">${buttons}</div>`;
}

export function buildUrgencesView(input: UrgencesViewInput): LayerView {
  const { data, error, now, open } = input;
  if (data === null && error === null) return { head: { theme: THEME, title: TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  const week = data?.week ?? null;
  if (data === null || week === null || data.syndromes.length === 0) {
    return {
      head: {
        theme: THEME, title: TITLE, figure: { value: 'n.d.', caption: 'des passages aux urgences pour IRA' }, level: 'nd',
        status: [data === null ? 'Odissé injoignable' : 'aucune semaine publiée', SOURCE],
      },
      sections: [methodSection(data, error, now, open)],
      bodyHtml: data === null ? sourceErrorCallout(null, now) : emptyLine('Aucune donnée de surveillance syndromique reçue.'),
    };
  }
  const late = isHealthDataLate('syndromic', week.end, now);
  return {
    head: headOf(data, week, late),
    sections: [
      syndromesSection(data, week, late, open), ira12Section(data, week, late, open), departmentsSection(input, data, late),
      agesSection(data, week, late, open), hospSection(data, week, late, open), methodSection(data, error, now, open),
    ],
    bodyHtml: selectorHtml(input.syndrome) + (error !== null ? sourceErrorCallout(dataDateMs(data.publishedAt), now) : ''),
  };
}
