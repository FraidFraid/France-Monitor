// src/components/layer-panel/vigilance.ts : vue pure du panneau Vigilance météo (spec 2026-10-04 environnement § 2.1 ; contrats
// § 4.1) ; aucun accès réseau ni DOM. Vigilance Météo-France par département et par phénomène, créneaux horaires, domaines
// littoraux, bulletin officiel en rubriques, départements en vigilance sur 30 jours (archive open data), jour aéronautique.
// E1 : couleurs officielles reprises telles quelles ; S1 : heure du produit (update_time), jamais l'heure du navigateur ;
// S2 : carte en retard au-delà de 15 h, couleurs retirées ; S3 : une panne est nommée, jamais « aucune vigilance ».
import type {
  OfficialColorId, VigilanceBulletin, VigilanceBulletinItem, VigilanceCoastDomain, VigilanceDepartment, VigilanceEcheance, VigilancePeriod,
  VigilancePhenomenon, VigilancePhenomenonId, VigilanceResponse,
} from '../../types/index.ts';
import { aeronauticalLine, departementAeronauticalDay } from '../../services/aeronautical-day.ts';
import {
  OFFICIAL_COLOR_LEVEL, isEnvironmentDataLate, nextVigilanceMap, parisDayOf, vigilanceLevel, vigilancePeriodOf,
} from '../../services/environment-levels.ts';
import { isProgressNote } from '../../services/environment-source.ts';
import { bulletinOf } from '../../services/environment-vigilance.ts';
import { levelColorVar, type VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { kvRow, levelCounts, levelDot } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { bandTimeline, multiLineChart, type BandRow, type ChartSeries } from './chart.ts';
import {
  COLOR_WORD, ENVIRONMENT_THEME, PHENOMENON_LABEL, capitalize, clockOf, dataMs, glueEnvUnits, note, parisDayWord, plural, readErrors, slotText,
  sourceDown, stamp,
} from './environment-format.ts';
import { NBSP, frNumber } from './format.ts';
import { emptyLine, listRow, loadingBody, sourceErrorCallout, sourceLinkHtml, type LayerHeadModel, type LayerTab, type LayerView } from './frame.ts';
import { departementName } from './health-format.ts';

export const VIGILANCE_TITLE = 'Vigilance météo';
/** Onglets « Aujourd’hui » et « Demain » (échéances J et J1 de la carte). */
export const VIGILANCE_TABS: readonly VigilanceEcheance[] = ['J', 'J1'];
const TAB_LABEL: Readonly<Record<VigilanceEcheance, string>> = { J: 'Aujourd’hui', J1: 'Demain' };

export interface VigilanceViewInput {
  vigilance: VigilanceResponse | null;
  vigilanceError: string | null;
  echeance: VigilanceEcheance;
  /** Département choisi (bulletin départemental, surbrillance de la carte). */
  selectedDept: string | null;
  /** La carte peut recentrer sur un département (carte WebGL) ; sinon les lignes ne se donnent pas pour cliquables. */
  canFocus: boolean;
  now: number;
  open: (sectionId: string, byDefault: boolean) => boolean;
}

const VIGILANCE_URL = 'https://vigilance.meteofrance.fr';
const API_URL = 'https://portail-api.meteofrance.fr';
const ARCHIVE_URL = 'https://www.data.gouv.fr/fr/datasets/donnees-de-vigilance-meteorologique/';
const HISTORY_DAYS = 30;
const DAY_MS = 86_400_000;
const ALL_PHENOMENA: readonly VigilancePhenomenonId[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const PERIMETER = 'Métropole et Corse ; l’outre-mer n’est pas dans ce flux.';

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
}
/** Borne de frise : « minuit » plutôt que « 00:00 ». */
function bandTick(ms: number): string {
  const c = clock(ms);
  return c === '00:00' ? 'minuit' : c;
}
function dayMonth(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}
/** Texte officiel tiers : unités collées à leur nombre (R1), dont « 30 mm » et « 20 mm/h ». */
function glueText(text: string): string {
  return glueEnvUnits(text).replace(/(\d) (mm)(?![\p{L}\p{N}])/gu, `$1${NBSP}$2`);
}

function lateOf(v: VigilanceResponse, now: number): boolean {
  return isEnvironmentDataLate('vigilance', v.updateTime, now);
}

/** Carte non lue alors que la réponse existe (502 de même forme, ou textes seuls) : panne nommée. */
function mapDown(v: VigilanceResponse): boolean {
  return v.updateTime === null || v.periods.length === 0;
}

/** Jour de l'échéance en mots (« aujourd’hui », « demain »), lu sur le début de sa validité. */
function dayWordOf(period: VigilancePeriod, now: number): string {
  const begin = dataMs(period.begin);
  return begin === null ? (period.echeance === 'J' ? 'aujourd’hui' : 'demain') : parisDayWord(parisDayOf(begin), now);
}

const levelOf = (c: OfficialColorId, late: boolean): VigilanceLevel | 'gris' => (late ? 'gris' : OFFICIAL_COLOR_LEVEL[c]);

// ─── En-tête ───

interface TopCount { n: number; color: OfficialColorId; noun: string }

/** Gros chiffre : départements à la couleur la plus haute ; si seuls des domaines littoraux l'atteignent, ces domaines (amendement 8). */
function topCount(p: VigilancePeriod): TopCount {
  const top = p.maxColor;
  const depts = p.departments.filter((d) => d.color === top).length;
  if (top === 1) return { n: 0, color: 1, noun: 'départements en vigilance jaune ou plus' };
  if (depts > 0) return { n: depts, color: top, noun: `${depts > 1 ? 'départements' : 'département'} en ${COLOR_WORD[top]}` };
  const coast = p.coast.filter((c) => c.color === top).length;
  return { n: coast, color: top, noun: `${coast > 1 ? 'domaines littoraux' : 'domaine littoral'} en ${COLOR_WORD[top]}` };
}

function lowerCounts(p: VigilancePeriod): string[] {
  const out: string[] = [];
  for (const c of [3, 2] as const) {
    if (c >= p.maxColor) continue;
    const n = p.departments.filter((d) => d.color === c).length;
    if (n > 0) out.push(`${frNumber(n, 0)} en ${COLOR_WORD[c]}`);
  }
  return out;
}

function tomorrowSentence(v: VigilanceResponse): string | null {
  const j1 = vigilancePeriodOf(v, 'J1');
  if (!j1) return null;
  if (j1.maxColor === 1) return 'Demain : aucune vigilance jaune ou plus.';
  const parts = ([4, 3, 2] as const).map((c) => ({ c, n: j1.departments.filter((d) => d.color === c).length })).filter((x) => x.n > 0);
  const text = parts.map((x, i) => `${i === 0 ? plural(x.n, 'département') : frNumber(x.n, 0)} en ${COLOR_WORD[x.c]}`).join(', ');
  return text ? `Demain : ${text}.` : 'Demain : vigilance sur le littoral seulement.';
}

function leadOf(v: VigilanceResponse): string | null {
  const j = vigilancePeriodOf(v, 'J');
  const comment = j?.comment?.trim() ?? '';
  const parts = [comment ? (/[.!?]$/.test(comment) ? comment : `${comment}.`) : '', tomorrowSentence(v) ?? ''].filter((s) => s !== '');
  return parts.length > 0 ? glueText(parts.join(' ')) : null;
}

function headOf(v: VigilanceResponse, period: VigilancePeriod, now: number): LayerHeadModel {
  const late = lateOf(v, now);
  const top = topCount(period);
  const verdict = vigilanceLevel(v, period.echeance);
  const caption = [`${top.noun} ${dayWordOf(period, now)}`, ...lowerCounts(period), `produit Météo-France de ${clockOf(v.updateTime, now)}${late ? ' (en retard)' : ''}`]
    .join(' · ');
  return {
    theme: ENVIRONMENT_THEME, title: VIGILANCE_TITLE,
    figure: { value: frNumber(top.n, 0), caption: glueEnvUnits(caption), level: late ? null : OFFICIAL_COLOR_LEVEL[top.color] },
    level: late ? 'nd' : verdict.level,
    status: [
      late ? 'niveau suspendu : carte Météo-France en retard' : glueEnvUnits(verdict.reason),
      `${stamp('Météo-France', v.updateTime, late, now)} · prochaine carte vers ${clock(nextVigilanceMap(now))}`,
    ],
    lead: late ? null : leadOf(v),
  };
}

function tabsOf(v: VigilanceResponse): LayerTab[] {
  return VIGILANCE_TABS.map((e) => ({ id: e, label: TAB_LABEL[e], count: vigilancePeriodOf(v, e)?.departments.length ?? null }));
}

// ─── Départements en vigilance ───

/** Créneaux d'un phénomène (jaune et plus) ; sans créneau publié (crues) : toute l'échéance. */
function phenomenonText(p: VigilancePhenomenon, now: number): string {
  const label = PHENOMENON_LABEL[p.id];
  const slots = p.slots.filter((s) => s.color >= 2);
  if (slots.length === 0) return `${label} ${COLOR_WORD[p.color]}, toute l’échéance`;
  return `${label} ${slots.map((s) => slotText(s, now)).join(', ')}`;
}

function bandRows(phenomena: readonly VigilancePhenomenon[], period: VigilancePeriod): BandRow[] {
  const begin = dataMs(period.begin) ?? 0;
  const end = dataMs(period.end) ?? 0;
  return phenomena.map((p) => ({
    label: PHENOMENON_LABEL[p.id],
    segments: p.slots.length === 0
      ? [{ from: begin, to: end, level: OFFICIAL_COLOR_LEVEL[p.color] }]
      : p.slots.map((s) => ({ from: dataMs(s.from) ?? begin, to: dataMs(s.to) ?? end, level: OFFICIAL_COLOR_LEVEL[s.color] })),
  }));
}

/** Jour aéronautique au centroïde : aujourd'hui avec « moins d’une heure de jour » ; demain : heures seules. */
function aeroText(code: string, period: VigilancePeriod, now: number): string | null {
  const at = period.echeance === 'J' ? now : (dataMs(period.begin) ?? now) + 12 * 3_600_000;
  const day = departementAeronauticalDay(code, at);
  return day === null ? null : `Jour aéronautique : ${aeronauticalLine(day, at).text}`;
}

function deptRow(d: VigilanceDepartment, period: VigilancePeriod, late: boolean, canFocus: boolean, now: number): string {
  const phen = d.phenomena.map((p) => `<span class="lp-phen">${late ? '' : levelDot(OFFICIAL_COLOR_LEVEL[p.color])}${escapeHtml(glueText(phenomenonText(p, now)))}</span>`);
  const begin = dataMs(period.begin);
  const end = dataMs(period.end);
  const frise = late || begin === null || end === null ? '' : bandTimeline(bandRows(d.phenomena, period), {
    label: `Frise horaire de la vigilance, ${d.name}`, from: begin, to: end, tick: bandTick, nowAt: now,
  });
  const aero = aeroText(d.code, period, now);
  return listRow({
    text: `${d.name} (${d.code})`, value: capitalize(COLOR_WORD[d.color]), level: levelOf(d.color, late),
    noteHtml: [phen.join(' · '), frise, aero ? escapeHtml(aero) : ''].filter((x) => x !== '').join('<br>'),
    ...(canFocus ? { data: { dept: d.code }, link: true } : {}),
  });
}

function coastRow(c: VigilanceCoastDomain, late: boolean, now: number): string {
  const slots = c.slots.filter((s) => s.color >= 2);
  const text = slots.length > 0 ? `vagues-submersion ${slots.map((s) => slotText(s, now)).join(', ')}` : `vagues-submersion ${COLOR_WORD[c.color]}`;
  return listRow({ text: c.name, value: capitalize(COLOR_WORD[c.color]), level: levelOf(c.color, late), note: glueText(text) });
}

function departementsSection(input: VigilanceViewInput, v: VigilanceResponse, period: VigilancePeriod | null): FicheSection {
  const { canFocus, now, open } = input;
  const base = { id: 'departements', title: 'Départements en vigilance', collapsible: true, open: open('departements', true) };
  if (mapDown(v) || !period) return { ...base, summary: 'n.d.', html: sourceDown('carte de vigilance Météo-France') + note(PERIMETER) };
  const late = lateOf(v, now);
  const coast = period.coast.filter((c) => c.color >= 2);
  const day = dayWordOf(period, now);
  if (period.departments.length === 0 && coast.length === 0) {
    return { ...base, summary: 'aucune', html: emptyLine(`Aucune vigilance jaune ou plus ${day} (carte Météo-France de ${clockOf(v.updateTime, now)}).`) + note(PERIMETER) };
  }
  const levels = [...period.departments, ...coast].map((x) => OFFICIAL_COLOR_LEVEL[x.color]);
  const count = plural(period.departments.length, 'département');
  const html = period.departments.map((d) => deptRow(d, period, late, canFocus, now)).join('')
    + coast.map((c) => coastRow(c, late, now)).join('')
    + note(`${PERIMETER} Phénomènes et créneaux publiés par Météo-France, en heure de Paris ; jour aéronautique au centre du département (règle française : coucher du soleil plus 30${NBSP}min).`)
    + (canFocus ? note('Clic sur une ligne : le département sur la carte et son bulletin.') : '');
  return { ...base, summary: late ? escapeHtml(`${count} (en retard)`) : levelCounts(levels, 'fr'), html };
}

// ─── Par phénomène ───

function historyChart(v: VigilanceResponse): string {
  const days = v.history.days;
  if (days.length < 2) return note(`Départements en vigilance sur ${HISTORY_DAYS} jours : référence en construction (${days.length} jour${days.length > 1 ? 's' : ''}).`);
  const at = (date: string): number => Date.parse(`${date}T12:00:00Z`);
  // Un jour partiel (jour en cours, cartes en partie illisibles) n'est jamais un fait plein : hors de la courbe, point creux à part.
  const full = days.filter((d) => d.partial !== true);
  const partial = days.filter((d) => d.partial === true);
  const colors = ['jaune', 'orange', 'rouge'] as const;
  const series: ChartSeries[] = [
    ...colors.map((c) => ({ label: `départements en ${c}`, stroke: levelColorVar(c), points: full.map((d) => ({ at: at(d.date), value: d[c] })) })),
    ...colors.map((c) => ({ label: `départements en ${c}, jour en cours`, stroke: levelColorVar(c), points: partial.map((d) => ({ at: at(d.date), value: d[c] })) })),
  ];
  const plotted = multiLineChart(series, {
    label: `Départements en vigilance jaune, orange et rouge, maximum par jour sur ${HISTORY_DAYS} jours`,
    from: at(days[0].date), to: at(days[days.length - 1].date), value: (x) => frNumber(x, 0), tick: (ms) => dayMonth(new Date(ms).toISOString().slice(0, 10)),
    gapMs: 1.5 * DAY_MS,
  });
  // Point isolé d'un jour partiel : cercle creux (le titre dit « jour en cours »).
  const svg = plotted.replace(/<circle ([^>]*?)fill="([^"]+)"([^>]*)>(<title>[^<]*jour en cours)/g, '<circle $1fill="none" stroke="$2" stroke-width="1.5"$3>$4');
  const peak = days.reduce((best, d) => (d.rouge * 10_000 + d.orange * 100 + d.jaune > best.rouge * 10_000 + best.orange * 100 + best.jaune ? d : best), days[0]);
  const legend = `<p class="fmk-note">${levelDot('jaune')} jaune · ${levelDot('orange')} orange · ${levelDot('rouge')} rouge · maximum de chaque jour de Paris sur les cartes publiées</p>`;
  const partialNote = partial.length > 0 ? note(`Point creux : jour en cours (${partial.map((d) => dayMonth(d.date)).join(', ')}), maximum encore susceptible de monter ou cartes en partie illisibles.`) : '';
  const emptyNote = days.every((d) => d.jaune + d.orange + d.rouge === 0) ? note('Aucun département en vigilance sur la période.') : '';
  const building = days.length < HISTORY_DAYS ? note(`Référence en construction (${days.length} jours).`) : '';
  return svg + legend + emptyNote + partialNote + building
    + note(`Jour le plus chargé : ${dayMonth(peak.date)} (${frNumber(peak.jaune, 0)} en jaune, ${frNumber(peak.orange, 0)} en orange, ${frNumber(peak.rouge, 0)} en rouge${peak.partial === true ? ', jour en cours' : ''}).`);
}

function phenomenesSection(input: VigilanceViewInput, v: VigilanceResponse, period: VigilancePeriod | null): FicheSection {
  const { now, open } = input;
  const base = { id: 'phenomenes', title: 'Par phénomène', collapsible: true, open: open('phenomenes', true) };
  if (mapDown(v) || !period) return { ...base, summary: 'n.d.', html: sourceDown('carte de vigilance Météo-France') + historyChart(v) };
  const late = lateOf(v, now);
  const rows = [...period.perPhenomenon].sort((a, b) => b.anyColor - a.anyColor || Number(a.id) - Number(b.id)).map((p) => {
    const top = p.counts.reduce<OfficialColorId>((m, c) => (c.color > m ? c.color : m), 1);
    const detail = [...p.counts].sort((a, b) => b.color - a.color).map((c) => `${frNumber(c.count, 0)} en ${COLOR_WORD[c.color]}`).join(', ');
    return listRow({ text: capitalize(PHENOMENON_LABEL[p.id]), value: plural(p.anyColor, 'département'), level: levelOf(top, late), note: detail });
  }).join('');
  const present = new Set(period.perPhenomenon.map((p) => p.id));
  const quiet = ALL_PHENOMENA.filter((id) => !present.has(id)).map((id) => PHENOMENON_LABEL[id]);
  const quietLine = quiet.length > 0 ? listRow({ text: `Sans vigilance : ${quiet.join(', ')}`, level: late ? 'gris' : 'vert' }) : '';
  const summary = period.perPhenomenon.length === 0 ? 'aucun' : plural(period.perPhenomenon.length, 'phénomène');
  return { ...base, summary: escapeHtml(`${summary}${late ? ' (en retard)' : ''}`), html: rows + quietLine + historyChart(v) };
}

// ─── Bulletin officiel ───

function itemHtml(item: VigilanceBulletinItem): string {
  const title = `${item.kind === 'situation' ? 'Situation' : 'Suivi'} · ${item.hazard} · ${COLOR_WORD[item.color]}`;
  const paragraphs = item.paragraphs.map((p) => {
    const text = p.text.filter((t) => t.trim() !== '').map((t) => escapeHtml(glueText(t))).join(' ');
    return `<p><b>${escapeHtml(p.heading)}</b>${text ? ` : ${text}` : ''}</p>`;
  }).join('');
  return `<p class="fmk-note">${escapeHtml(title)}</p>${paragraphs}`;
}

function bulletinBlock(title: string, b: VigilanceBulletin, echeance: VigilanceEcheance): string {
  const items = b.items.filter((i) => i.echeance === echeance);
  return items.length === 0 ? '' : `<h4 class="fmk-eyebrow">${escapeHtml(title)}</h4>${items.map(itemHtml).join('')}`;
}

function textsDown(v: VigilanceResponse): boolean {
  return v.textsUpdateTime === null || (v.bulletins.length === 0 && v.errors.filter((e) => !isProgressNote(e)).some((e) => /textes/i.test(e)));
}

function bulletinSection(input: VigilanceViewInput, v: VigilanceResponse): FicheSection {
  const { echeance, selectedDept, now, open } = input;
  const base = { id: 'bulletin', title: 'Bulletin officiel', collapsible: true, open: open('bulletin', false) };
  const advice = note('Les conseils de comportement ne sont pas dans ce flux : ') + `<p>${sourceLinkHtml('Conseils de comportement (vigilance.meteofrance.fr)', VIGILANCE_URL)}</p>`;
  if (textsDown(v)) {
    return { ...base, summary: 'n.d.', html: emptyLine('Textes indisponibles : le bulletin Météo-France n’a pas pu être lu.') + advice };
  }
  const day = echeance === 'J' ? 'aujourd’hui' : 'demain';
  const national = bulletinOf(v, 'national', 'FRA');
  const nationalHtml = national ? bulletinBlock('Bulletin national', national, echeance) : '';
  const zones = v.bulletins.filter((b) => b.scope === 'zonal').map((b) => bulletinBlock(b.domainName, b, echeance)).join('');
  const dept = selectedDept === null ? null : bulletinOf(v, 'departemental', selectedDept);
  const deptName = selectedDept === null ? null : departementName(selectedDept);
  const deptHtml = selectedDept === null
    ? note('Choisir un département dans la liste ou sur la carte pour lire son bulletin.')
    : dept && dept.items.some((i) => i.echeance === echeance)
      ? bulletinBlock(dept.domainName, dept, echeance)
      : note(`Pas de bulletin départemental publié pour ${deptName} (${day}).`);
  const html = (nationalHtml || note(`Pas de texte national pour ${day}.`)) + zones + deptHtml + advice
    + note(`Textes Météo-France de ${clockOf(v.textsUpdateTime, now)}.`);
  return { ...base, summary: escapeHtml(`textes de ${clockOf(v.textsUpdateTime, now)}`), html };
}

// ─── Méthode et sources ───

/** Note d'avancement du serveur, dite comme telle (« historique en cours de constitution »), jamais comme un incident. */
function progressText(text: string): string {
  return text === 'historique de la vigilance en cours de constitution' ? 'Note : historique en cours de constitution.' : `${text}.`;
}

function methodSection(input: VigilanceViewInput, v: VigilanceResponse | null): FicheSection {
  const { vigilanceError, now, open } = input;
  const late = v !== null && !mapDown(v) && lateOf(v, now);
  const mapState = v === null || mapDown(v) ? (vigilanceError !== null || v !== null ? 'source indisponible' : 'chargement…')
    : `carte de ${clockOf(v.updateTime, now)}${late ? ' (en retard)' : ''}`;
  const textState = v === null ? (vigilanceError !== null ? 'source indisponible' : 'chargement…')
    : textsDown(v) ? 'source indisponible' : `textes de ${clockOf(v.textsUpdateTime, now)}`;
  const since = v?.history.since ?? null;
  const histState = v === null || v.history.days.length === 0 ? 'en construction' : `${v.history.days.length} jours depuis le ${since ? dayMonth(since) : 'n.d.'}`;
  const failures = (v?.errors ?? []).filter((e) => !isProgressNote(e));
  const progress = (v?.errors ?? []).filter(isProgressNote);
  const rows = [
    kvRow('Carte de vigilance', `${sourceLinkHtml('Météo-France, API DPVigilance', API_URL)} · ${escapeHtml(mapState)}`),
    kvRow('Bulletin', `${sourceLinkHtml('Météo-France, textes de vigilance', API_URL)} · ${escapeHtml(textState)}`),
    kvRow('Historique', `${sourceLinkHtml('Archive open data de la vigilance', ARCHIVE_URL)} · ${escapeHtml(histState)}`),
  ];
  const down = [mapState, textState].filter((s) => s === 'source indisponible').length;
  const html = rows.join('')
    + note(`Périmètre : ${PERIMETER}`)
    + note('Couleurs : celles de Météo-France, reprises telles quelles (vert, jaune, orange, rouge), par département et par phénomène ; jamais recalculées.')
    + note('Pastille : couleur la plus haute de l’échéance affichée, départements et domaines littoraux compris ; la raison nomme le phénomène qui atteint cette couleur dans le plus de départements.')
    + note(`Retard : carte au-delà de 15${NBSP}h après sa production (cartes régulières à 06${NBSP}h et 16${NBSP}h, 05${NBSP}h et 15${NBSP}h en hiver, plus les mises à jour d’événement) ; une carte en retard perd ses couleurs et la pastille passe à n.d.`)
    + note('Historique : maximum de chaque jour de Paris des départements par couleur sur les cartes publiées (échéance du jour), relu une fois par jour.')
    + note(`Jour aéronautique : lever et coucher du soleil au centre du département (formule NOAA), nuit aéronautique de 30${NBSP}min après le coucher à 30${NBSP}min avant le lever (règle française).`)
    + readErrors(failures) + progress.map((e) => note(progressText(e))).join('');
  return {
    id: 'methode', title: 'Méthode et sources', collapsible: true, open: open('methode', false), tone: 'reference', html,
    summary: escapeHtml(`3 sources${down > 0 ? ` · ${down} indisponible${down > 1 ? 's' : ''}` : ''}`),
  };
}

// ─── Assemblage ───

export function buildVigilanceView(input: VigilanceViewInput): LayerView {
  const { vigilance: v, vigilanceError, echeance, now } = input;
  if (v === null && vigilanceError === null) {
    return { head: { theme: ENVIRONMENT_THEME, title: VIGILANCE_TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  }
  if (v === null) {
    return {
      head: {
        theme: ENVIRONMENT_THEME, title: VIGILANCE_TITLE, level: 'nd',
        figure: { value: 'n.d.', caption: 'départements en vigilance', level: null }, status: ['Météo-France injoignable'],
      },
      sections: [methodSection(input, null)], bodyHtml: sourceErrorCallout(null, now),
    };
  }
  const period = vigilancePeriodOf(v, echeance);
  const sections = [departementsSection(input, v, period), phenomenesSection(input, v, period), bulletinSection(input, v), methodSection(input, v)];
  const callout = vigilanceError !== null ? sourceErrorCallout(dataMs(v.updateTime), now) : undefined;
  if (mapDown(v) || !period) {
    return {
      head: {
        theme: ENVIRONMENT_THEME, title: VIGILANCE_TITLE, level: 'nd',
        figure: { value: 'n.d.', caption: 'départements en vigilance', level: null },
        status: [mapDown(v) ? 'carte de vigilance Météo-France indisponible' : `échéance ${TAB_LABEL[echeance].toLowerCase()} absente de la carte`],
      },
      tabs: tabsOf(v), activeTab: echeance, sections, bodyHtml: callout,
    };
  }
  return { head: headOf(v, period, now), tabs: tabsOf(v), activeTab: echeance, sections, bodyHtml: callout };
}
