// src/components/layer-panel/defense-b.ts : ajouts de la phase B au panneau Défense (spec 2026-10-04 souveraineté § 3.1, § 3.2, § 3.4 ;
// contrats § 4.1 ; amendement 7 : O15 à O17, S6, S7). Section « GNSS : précision de position et météo spatiale » : en direct un compte
// sans lieu (24 h glissantes), les deux derniers jours UTC complets, les mailles localisées du seul jour UTC complet précédent (jamais
// un lieu en direct, O17), dégradation générale, échelles NOAA du jour et prévues, dernière alerte, courbes Kp sur 7 jours et mailles
// par jour sur 14 jours. Section « Sanctions : gels d'avoirs » (registre national : comptes et différences seulement, jamais une fiche
// nominative), zones drones DGAC dans « Sites de défense » (titre, légende et renvoi officiels, S6), notes de méthode, pastille Défense
// avec le compte de mailles à précision dégradée. Seules la DGAC et l'ANFR qualifient un brouillage : la vue dit « précision de
// position dégradée » (O15). Pur, sans réseau ni DOM : appliqué par buildDefenseView (defense.ts) à la vue de la phase A. Aucun seuil de
// la grille recopié : la vue lit `cell.level`, `generalDegradation`, `degraded` et `gnssDegradedCount`.
import type { GnssResponse, KpPoint, NoaaAlert, NoaaScaleDay, SanctionsResponse } from '../../types/index.ts';
import { DRONES_LEGEND, DRONES_POINTER, DRONES_POINTER_URL, DRONES_TITLE } from '../../services/sovereignty-drones.ts';
import {
  GNSS_SITUATION_CELLS, defenseLevel, gnssDegradedCount, isSovereigntyDataLate,
} from '../../services/sovereignty-levels.ts';
import { GELS_REGISTRY_URL } from '../../services/sovereignty-sanctions.ts';
import { levelColorVar, type VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml, safeHref } from '../france-intel-events.ts';
import { kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { lineChart, stackedDayBars, type ChartPoint, type DayStack } from './chart.ts';
import { NBSP, frNumber } from './format.ts';
import { barRow, emptyLine, listRow, sourceLinkHtml, valueHtml, type LayerHeadModel, type LayerView } from './frame.ts';
import {
  CAT_GELS, CAT_KP_CALME, SCALE_WORD, clockOf, coordText, dateOf, formatCount, formatKp, gScaleLevel, glueSovUnits, kpGScale, note, plural, sourceDown,
} from './sovereignty-format.ts';
import type { DefenseSitesSummary, DefenseViewInput } from './defense.ts';

const SWPC_URL = 'https://www.swpc.noaa.gov/';
const GPSJAM_URL = 'https://gpsjam.org/faq';
const DRONES_MAP_URL = 'https://www.geoportail.gouv.fr/donnees/restrictions-pour-drones-de-loisirs';
const PARIS = 'Europe/Paris';
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Fenêtre de la grille ; moins de 23 h 50 de cumul : « référence en construction ». */
const GNSS_WINDOW_MS = DAY_MS;
const BUILDING_MARGIN_MS = 10 * 60_000;
const GNSS_DAYS_SPAN = 14;
const KP_SLOT_MS = 3 * HOUR_MS;
const CELL_HALF = 0.25;
/** Seuil d'une maille orange, en % des aéronefs : celui de la grille serveur (GNSS_ORANGE_PCT, api/_lib/gnss-grid.js ; identité testée). */
export const GNSS_ORANGE_PCT = 10;
const ORANGE_AT = `au-delà de ${GNSS_ORANGE_PCT}${NBSP}%`;
/** Gris des données en retard et des jours de dégradation générale (jeton de la légende Défense). */
const MUTED_GREY = 'var(--cat-mil-etranger)';
const PARIS_HOUR = new Intl.DateTimeFormat('fr-FR', { timeZone: PARIS, hour: '2-digit', hourCycle: 'h23' });

const glue = (text: string): string => glueSovUnits(text);
const paragraph = (text: string): string => note(glueSovUnits(text));

/** Part d'une maille : « 12,5 % » ; n.d. sans part. */
function pctText(v: number | null): string {
  return v === null ? 'n.d.' : `${frNumber(v, 1)}${NBSP}%`;
}
function dayMonth(ms: number): string {
  return new Date(ms).toLocaleDateString('fr-FR', { timeZone: PARIS, day: '2-digit', month: '2-digit' });
}
/** « 03/10 » d'un jour « 2026-10-03 » (jour UTC, sans fuseau). */
function dayLabel(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}
/** Jour UTC « AAAA-MM-JJ » de `iso` reculé de `back` jours. */
function utcDayBack(iso: string, back: number): string {
  return new Date(Date.parse(iso) - back * DAY_MS).toISOString().slice(0, 10);
}
/** « 04/10 11 h » (axe des tranches de 3 h, heure de Paris). */
function slotTick(ms: number): string {
  const hour = PARIS_HOUR.formatToParts(new Date(ms)).find((p) => p.type === 'hour')?.value ?? '';
  return `${dayMonth(ms)} ${hour}${NBSP}h`;
}
/** « 02/10 10:36 » (toujours daté). */
function dateClock(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return 'n.d.';
  return `${dayMonth(ms)} ${new Date(ms).toLocaleTimeString('fr-FR', { timeZone: PARIS, hour: '2-digit', minute: '2-digit' })}`;
}
const subhead = (text: string): string => `<h4 class="fmk-eyebrow">${escapeHtml(text)}</h4>`;

// ─── GNSS : grille mesurée ───

/** Kp le plus haut des tranches qui recouvrent la fenêtre de la grille (affichage seulement : le serveur décide). */
function windowKp(gn: GnssResponse): number | null {
  if (gn.readAt === null || gn.windowStart === null) return null;
  const from = Date.parse(gn.windowStart);
  const to = Date.parse(gn.readAt);
  let best: number | null = null;
  for (const p of gn.spaceWeather.kp) {
    const at = Date.parse(p.at);
    if (at < to && at + KP_SLOT_MS > from && (best === null || p.kp > best)) best = p.kp;
  }
  return best;
}

/** Couleur du compte glissant : la règle de la pastille (jaune pour 1 ou 2 mailles, orange à partir de GNSS_SITUATION_CELLS). */
function rollingLevel(n: number): VigilanceLevel {
  return n >= GNSS_SITUATION_CELLS ? 'orange' : n > 0 ? 'jaune' : 'vert';
}

/** Jour UTC complet : « 2 », « n.d. (jour non couvert) », « n.d. (dégradation générale) » ; jamais un 0 qui aurait l'air d'un calme. */
function previousDayText(gn: GnssResponse, back: 1 | 2): string {
  const n = gn.degraded.previousUtcDays[back - 1];
  if (n === null) return 'n.d. (jour non couvert)';
  const day = gn.readAt === null ? null : utcDayBack(gn.readAt, back);
  return day !== null && gn.days.days.some((d) => d.date === day && d.general) ? 'n.d. (dégradation générale)' : String(n);
}

/** Lignes des mailles françaises dégradées du seul jour UTC complet `cellsDay` (O17) ; couleur d'après `days[cellsDay].general`. */
function cellsPart(gn: GnssResponse, lateGrid: boolean, canFocus: boolean): string {
  if (gn.cellsDay === null) {
    return emptyLine('Mailles localisées : publiées pour le jour UTC précédent seulement, et seulement s’il est couvert en entier ; sinon aucune maille n’est publiée, ce qui n’est pas un calme.');
  }
  const dayGeneral = gn.days.days.find((d) => d.date === gn.cellsDay)?.general;
  const muted = lateGrid || dayGeneral !== false;
  const degraded = gn.cells
    .filter((c) => c.inFrance && (c.level === 'jaune' || c.level === 'orange'))
    .sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0));
  const orange = degraded.filter((c) => c.level === 'orange').length;
  const title = subhead(glue(`Mailles du ${dayLabel(gn.cellsDay)} (jour UTC complet) : ${degraded.length} dégradées (jaune et orange) sur ${formatCount(gn.frenchCells)} mesurées, dont ${orange} ${ORANGE_AT}`));
  const rows = degraded.map((c) => {
    const level: VigilanceLevel = c.level === 'orange' ? 'orange' : 'jaune';
    return listRow({
      text: `Maille ${coordText(c.lat + CELL_HALF, c.lon + CELL_HALF)}`,
      valueHtml: valueHtml(pctText(c.pct), muted ? null : level),
      level: muted ? 'gris' : level,
      note: glue(`${c.good + c.degraded} aéronefs au calcul · ${c.degraded} à précision dégradée · ${c.unknown} sans précision déclarée`),
      data: { 'gnss-cell': `${c.lat}:${c.lon}` },
      link: canFocus,
    });
  }).join('');
  const none = degraded.length === 0
    ? emptyLine(glue(`Aucune maille française à précision dégradée le ${dayLabel(gn.cellsDay)} parmi ${formatCount(gn.frenchCells)} mesurées ; une maille sans assez d’aéronefs n’est pas mesurée.`))
    : '';
  const general = dayGeneral === true
    ? paragraph(`Dégradation générale le ${dayLabel(gn.cellsDay)} (météo spatiale) : mailles en gris, hors pastille et hors score.`)
    : '';
  return title + general + rows + none;
}

function gridPart(gn: GnssResponse, input: DefenseViewInput): { html: string; summary: string } {
  const { now, canFocus } = input;
  if (gn.readAt === null) {
    const errors = gn.errors.filter((e) => e.startsWith('Grille GNSS'));
    return { summary: 'mailles n.d.', html: sourceDown(`grille GNSS (adsb.lol)${errors.length > 0 ? ` : ${errors.join(' ; ')}` : ''}`) };
  }
  const late = isSovereigntyDataLate('adsb-gnss', gn.readAt, now);
  const general = gn.generalDegradation;
  const rolling = gn.degraded.rolling24h;
  // En dégradation générale le serveur sert 0 : un 0 aurait l'air d'un calme, la valeur est dite n.d.
  const rollingValue = general ? valueHtml('n.d.') : valueHtml(String(rolling), late ? null : rollingLevel(rolling));
  const head = kvRow(glue(`Mailles françaises à précision dégradée ${ORANGE_AT} sur 24 h glissantes`), rollingValue)
    + kvRow(`Jours UTC complets (${ORANGE_AT})`, valueHtml(`veille ${previousDayText(gn, 1)}, avant-veille ${previousDayText(gn, 2)}`))
    + kvRow('Mesure', escapeHtml(glue(`adsb.lol ${clockOf(gn.readAt, now)}${late ? ' (en retard)' : ''} · ${plural(gn.aircraft, 'aéronef')} · ${plural(gn.reads, 'lecture')}`)));
  const kp = windowKp(gn);
  const generalBox = general
    ? `<p class="fmk-callout lp-callout">${escapeHtml(glue(`Dégradation générale, probablement météo spatiale : plus de 30 % des mailles françaises mesurées à précision dégradée et ${kp === null ? 'Kp n.d.' : formatKp(kp)} sur la fenêtre. Ces mailles ne comptent ni dans la pastille ni au score.`))}</p>`
    : '';
  const spanMs = gn.windowStart === null ? 0 : Date.parse(gn.readAt) - Date.parse(gn.windowStart);
  const hours = Math.max(0, Math.floor(spanMs / HOUR_MS));
  const building = spanMs < GNSS_WINDOW_MS - BUILDING_MARGIN_MS
    ? paragraph(`Référence en construction (${hours} h) : la mesure couvre ${hours} h sur les 24 h de la méthode (cumul repris au dernier redémarrage du serveur).`)
    : '';
  const summary = general ? 'dégradation générale (météo spatiale)'
    : `${plural(rolling, 'maille', 'mailles')} ${ORANGE_AT} sur 24 h${late ? ' (en retard)' : ''}`;
  return {
    summary,
    html: generalBox + head + paragraph('Un compte seulement, sans lieu : un lieu en direct pourrait signaler une protection en cours. Les mailles localisées sont celles du dernier jour UTC complet.')
      + cellsPart(gn, late, canFocus) + building,
  };
}

function daysChart(gn: GnssResponse, late: boolean): string {
  const list = gn.days.days;
  if (list.length === 0) return '';
  const generalDays = list.filter((d) => d.general).length;
  const generalNote = generalDays > 0 ? paragraph(`${plural(generalDays, 'jour')} de dégradation générale (météo spatiale) sur la période : leurs mailles, en gris, ne comptent pas.`) : '';
  const building = list.length < GNSS_DAYS_SPAN ? paragraph(`Courbe des mailles : référence en construction (${plural(list.length, 'jour')}).`) : '';
  const partial = paragraph('Le dernier jour est partiel : cumul du jour UTC en cours.');
  if (late) return building + generalNote;
  const stacks: DayStack[] = list.map((d) => ({
    day: Date.parse(`${d.date}T12:00:00Z`),
    parts: d.general
      ? [{ value: d.orange + d.jaune, color: MUTED_GREY, label: 'mailles, dégradation générale' }]
      : [
        { value: d.orange, color: levelColorVar('orange'), label: `mailles au-delà de 10${NBSP}%` },
        { value: d.jaune, color: levelColorVar('jaune'), label: `mailles de 2 à 10${NBSP}%` },
      ],
  }));
  return stackedDayBars(stacks, {
    label: 'Mailles françaises à précision dégradée, par jour UTC', value: (v) => frNumber(v, 0), tick: dayMonth,
    emptyNote: 'aucune maille à précision dégradée sur la période',
  }) + partial + building + generalNote;
}

// ─── GNSS : météo spatiale ───

const scaleText = (letter: 'R' | 'S' | 'G', v: number | null): string => (v === null ? `${letter}${NBSP}n.d.` : SCALE_WORD[letter][v] ?? `${letter}${v}`);

function forecastRow(d: NoaaScaleDay, late: boolean): string {
  const probs = [
    d.rMinorProb !== null ? `radio R1 ou R2 : ${d.rMinorProb} %` : '',
    d.rMajorProb !== null ? `R3 ou plus : ${d.rMajorProb} %` : '',
    d.sProb !== null ? `radiations S1 ou plus : ${d.sProb} %` : '',
  ].filter((t) => t !== '').join(' · ');
  return listRow({
    text: `${dayLabel(d.date)} (prévision)`,
    value: scaleText('G', d.g),
    ...(late || d.g === null ? { level: 'gris' as const } : gScaleLevel(d.g) !== null ? { level: gScaleLevel(d.g) } : { color: CAT_KP_CALME }),
    note: probs ? glue(probs) : null,
  });
}

/** Alerte NOAA en français : « alerte : indice K de 5 atteint (G1 mineur) » ; produit inconnu : « message NOAA K07X ». */
function noaaAlertWord(a: NoaaAlert): string {
  const k = /^K0?(\d)([AW])$/.exec(a.productId);
  const base = k ? (k[2] === 'A' ? `alerte : indice K de ${k[1]} atteint` : `avertissement : indice K de ${k[1]} attendu`)
    : /^A\d{2}F$/.test(a.productId) ? 'veille : orage géomagnétique prévu' : `message NOAA ${a.productId}`;
  return a.gScale !== null ? `${base} (${SCALE_WORD.G[a.gScale] ?? `G${a.gScale}`})` : base;
}

function kpColor(kp: number): string {
  const level = gScaleLevel(kpGScale(kp));
  return level === null ? CAT_KP_CALME : levelColorVar(level);
}

function kpChart(points: readonly KpPoint[], late: boolean): string {
  if (late || points.length < 2) return '';
  const days: DayStack[] = points.map((p) => ({ day: Date.parse(p.at), parts: [{ value: p.kp, color: kpColor(p.kp), label: formatKp(p.kp) }] }));
  return stackedDayBars(days, { label: 'Indice Kp par tranche de 3 h (NOAA), sur 7 jours, couleur de l’échelle G', value: (v) => frNumber(v, 0), tick: slotTick });
}

function spaceWeatherPart(gn: GnssResponse, now: number): string {
  const sw = gn.spaceWeather;
  if (sw.scalesAt === null && sw.kp.length === 0) {
    const errors = gn.errors.filter((e) => e.startsWith('NOAA SWPC'));
    return sourceDown(`météo spatiale (NOAA SWPC)${errors.length > 0 ? ` : ${errors.join(' ; ')}` : ''}`);
  }
  const late = isSovereigntyDataLate('noaa', sw.scalesAt, now);
  const today = sw.today;
  const todayHtml = today === null ? escapeHtml('n.d.')
    : `${escapeHtml(`radio ${scaleText('R', today.r)} · radiations ${scaleText('S', today.s)} · géomagnétique `)}`
      + valueHtml(scaleText('G', today.g), late || today.g === null ? null : gScaleLevel(today.g) ?? 'vert');
  const rows = [kvRow(`Échelles NOAA à ${clockOf(sw.scalesAt, now)}${late ? ' (en retard)' : ''}`, todayHtml), ...sw.forecast.map((d) => forecastRow(d, late))];
  const last = sw.kp.at(-1) ?? null;
  if (last) {
    rows.push(kvRow('Indice Kp', `${valueHtml(formatKp(last.kp), late ? null : gScaleLevel(kpGScale(last.kp)) ?? 'vert')} ${escapeHtml(`tranche de ${clockOf(last.at, now)}`)}`));
  }
  if (sw.lastAlert) rows.push(kvRow('Dernière alerte NOAA', escapeHtml(glue(`${noaaAlertWord(sw.lastAlert)} · émise ${clockOf(sw.lastAlert.issuedAt, now)}`))));
  return rows.join('') + kpChart(sw.kp, late)
    + paragraph('Un orage géomagnétique peut dégrader la précision de position partout ; une dégradation locale est autre chose : les deux sont montrés côte à côte pour ne pas les confondre.');
}

/** Section « GNSS : précision de position et météo spatiale » (ouverte). */
export function gnssSection(input: DefenseViewInput): FicheSection {
  const { now, open } = input;
  const gn = input.gnss ?? null;
  const gnssError = input.gnssError ?? null;
  const base = { id: 'gnss', title: 'GNSS : précision de position et météo spatiale', collapsible: true, open: open('gnss', true) };
  if (gn === null) {
    return gnssError !== null
      ? { ...base, summary: 'n.d.', html: sourceDown(`grille GNSS et météo spatiale (${gnssError})`) }
      : { ...base, summary: 'chargement…', html: emptyLine('Chargement de la grille GNSS et de la météo spatiale…') };
  }
  const grid = gridPart(gn, input);
  const last = gn.spaceWeather.kp.at(-1) ?? null;
  const kpText = last === null ? 'Kp n.d.' : `${formatKp(last.kp)} à ${clockOf(last.at, now)}`;
  const late = gn.readAt !== null && isSovereigntyDataLate('adsb-gnss', gn.readAt, now);
  return {
    ...base,
    summary: escapeHtml(glue(`${grid.summary} · ${kpText}`)),
    html: grid.html + daysChart(gn, late) + spaceWeatherPart(gn, now)
      + paragraph('Mesure sur les seuls aéronefs qui émettent leur position (ADS-B) : une maille sans avion n’est pas une maille calme ; une maille à précision dégradée est « à vérifier », jamais une qualification.'),
  };
}

// ─── Sanctions : registre national des gels ───

function gelsChart(s: SanctionsResponse, now: number): string {
  const pubs = s.history.publications;
  const sinceMs = s.history.since === null ? null : Date.parse(s.history.since);
  const building = sinceMs !== null && Number.isFinite(sinceMs) && now - sinceMs < 365 * DAY_MS
    ? paragraph(`Courbe des entrées : référence en construction depuis le ${dayMonth(sinceMs)} (${plural(pubs.length, 'publication')}).`)
    : '';
  if (pubs.length < 2) return building;
  const points: ChartPoint[] = pubs.map((p) => ({ at: Date.parse(p.publishedAt), value: p.total }));
  return lineChart(points, {
    label: 'Entrées du registre national des gels, par publication', from: points[0].at, to: Math.max(now, points[points.length - 1].at),
    stroke: CAT_GELS, value: (v) => frNumber(v, 0), tick: dayMonth, nowAt: now,
  }) + building;
}

/** « 2 nouveaux gels · 1 radiation » (S7) ; premier relevé ou KV perdu : n.d., jamais « tout est nouveau ». */
function gelsDiff(added: number | null, removed: number | null): string {
  if (added === null || removed === null) return 'n.d. (premier relevé : rien à comparer)';
  const count = (n: number, one: string, many: string): string => `${frNumber(n, 0)}${NBSP}${n > 1 ? many : one}`;
  return `${count(added, 'nouveau gel', 'nouveaux gels')} · ${count(removed, 'radiation', 'radiations')}`;
}

/** Section « Sanctions : gels d'avoirs » (repliée) : comptes et différences seulement, lien vers la dernière version du registre (S7). */
export function gelsSection(input: DefenseViewInput): FicheSection {
  const { now, open } = input;
  const s = input.sanctions ?? null;
  const sanctionsError = input.sanctionsError ?? null;
  const base = { id: 'gels', title: 'Sanctions : gels d’avoirs', collapsible: true, open: open('gels', false) };
  const link = (): string => `<p class="fmk-note">${sourceLinkHtml('Consulter la dernière version du registre', GELS_REGISTRY_URL)}${escapeHtml(' (DG Trésor)')}</p>`;
  if (s === null) {
    return sanctionsError !== null
      ? { ...base, summary: 'n.d.', html: sourceDown(`registre des gels (${sanctionsError})`) + link() }
      : { ...base, summary: 'chargement…', html: emptyLine('Chargement du registre des gels…') };
  }
  const own = s.errors.filter((e) => e.startsWith('Registre des gels'));
  const c = s.current;
  if (c === null) {
    return { ...base, summary: 'n.d.', html: sourceDown(`registre des gels (DG Trésor)${own.length > 0 ? ` : ${own.join(' ; ')}` : ''}`) + link() };
  }
  const late = isSovereigntyDataLate('gels', s.dateCheckedAt, now);
  const natures: ReadonlyArray<readonly [string, number]> = [['Personnes physiques', c.physiques], ['Personnes morales', c.morales], ['Navires', c.navires]];
  const parts = late
    ? natures.map(([label, n]) => kvRow(label, valueHtml(formatCount(n)))).join('')
    : natures.map(([label, n]) => barRow({ label, pct: c.total > 0 ? (100 * n) / c.total : null, value: formatCount(n), color: CAT_GELS })).join('');
  const html = kvRow('Publication', `${sourceLinkHtml('DG Trésor', GELS_REGISTRY_URL)} ${escapeHtml(`· ${dateClock(c.publishedAt)}`)}`)
    + kvRow('Entrées', valueHtml(formatCount(c.total)))
    + parts
    + kvRow('Depuis la publication précédente', escapeHtml(glue(gelsDiff(c.added, c.removed))))
    + (late ? '' : gelsChart(s, now))
    + kvRow('Date relue', escapeHtml(`${clockOf(s.dateCheckedAt, now)}${late ? ' (en retard)' : ''}`))
    + paragraph('Aucune fiche nominative n’est affichée ici : le détail des personnes, entités et navires se lit sur le registre officiel de la DG Trésor.')
    + paragraph('Hors score : une liste de sanctions est un état, pas un événement.')
    + (own.length > 0 ? paragraph(`Incidents de lecture : ${own.join(' ; ')}.`) : '')
    + link();
  return { ...base, summary: escapeHtml(glue(`publication du ${dateClock(c.publishedAt)} · ${formatCount(c.total)} entrées`)), html };
}

// ─── Zones drones DGAC (option de la couche Défense) ───

/** Renvoi officiel (S6) avec un seul lien : le SIA, dans la phrase de la DGAC reprise telle quelle. */
function dronesPointerHtml(): string {
  const label = 'SIA (sia.aviation-civile.gouv.fr)';
  const at = DRONES_POINTER.indexOf(label);
  const safe = safeHref(DRONES_POINTER_URL);
  if (at < 0 || !safe) return `<p class="fmk-note">${sourceLinkHtml(DRONES_POINTER, DRONES_POINTER_URL)}</p>`;
  return `<p class="fmk-note">${escapeHtml(DRONES_POINTER.slice(0, at))}${sourceLinkHtml(label, DRONES_POINTER_URL)}${escapeHtml(DRONES_POINTER.slice(at + label.length))}</p>`;
}

/** Bloc ajouté à « Sites de défense » : compte, titre et légende officiels, source et licence, édition, date du fichier, renvoi, bouton. */
export function droneZonesBlock(d: NonNullable<DefenseSitesSummary['drones']>): string {
  const button = `<button type="button" class="lp-toggle" data-drone-zones aria-pressed="${d.shown}">`
    + `${d.shown ? 'Masquer les zones drones' : 'Zones drones DGAC sur la carte'}</button>`;
  if (d.meta === null) {
    return kvRow('Zones drones DGAC', escapeHtml(d.error !== null ? 'fichier illisible' : 'lu à l’ouverture du panneau'))
      + (d.error !== null ? note(`Fichier des zones drones illisible : ${d.error}.`) : '') + button;
  }
  const m = d.meta;
  const edition = /^(\d{4})-(\d{2})-\d{2}$/.exec(m.edition);
  return kvRow('Zones drones DGAC', valueHtml(glue(`${formatCount(m.counts.kept)} zones`)))
    + paragraph(`Couche officielle « ${DRONES_TITLE} » : ${DRONES_LEGEND}`)
    + paragraph(`Zones « vol interdit » hors agglomération en métropole (aérodromes, plateformes, hélistations, sites sensibles) ; ${formatCount(m.counts.agglomerations)} zones d’agglomération sur ${formatCount(m.counts.volInterdit)} ne sont pas dessinées (agglomérations non dessinées).`)
    + paragraph(`Source : ${m.source}, à jour au ${edition ? `${edition[2]}-${edition[1]}` : m.edition} ; ${m.licence} ; fichier du ${dateOf(m.generatedAt)}.`)
    + paragraph('Zones permanentes seulement ; les interdictions temporaires (NOTAM) ne sont pas publiées en flux ouvert.')
    + dronesPointerHtml()
    + button;
}

/** Notes de méthode de la phase B (ajoutées à la fin de « Méthode et sources »). */
export function defenseMethodB(): string {
  return paragraph('Précision de position GNSS : cinq lectures adsb.lol (/v2/point, rayons de 80 à 200 milles) toutes les 10 min couvrent la métropole ; grille de 0,5° ; sur 24 h glissantes, un aéronef distinct par maille, avec sa pire précision déclarée : « bon » si nac_p vaut 8 ou plus (erreur de position sous 93 m), « dégradé » de 1 à 7 ; nac_p 0 ou absent compté à part, sauf chez un appareil qui avait déclaré une bonne précision le même jour UTC : il compte alors dégradé ; aéronefs au sol écartés. Part dégradée = 100 × (dégradés − 1) / (bons + dégradés), formule de gpsjam.org ; au moins 5 aéronefs au calcul, sinon « trop peu d’avions » (maille non dessinée). Jaune de 2 à 10 %, orange au-delà ; le seuil de précision et le minimum sont nos choix.')
    + paragraph('Seules la DGAC et l’ANFR qualifient un brouillage : cette mesure ne montre qu’une précision de position dégradée, à vérifier.')
    + paragraph('Localisation : en direct, un compte de mailles sans lieu sur 24 h glissantes (pastille et score) ; les mailles ne sont localisées que pour le jour UTC précédent, publié seulement s’il est couvert en entier (aucune lecture manquante de plus de 30 min). Un redémarrage du serveur ou une lecture interrompue rend le jour « non couvert » : aucune maille publiée, jamais un calme. La mémoire « bonne précision » repart à chaque jour UTC.')
    + paragraph('Dégradation générale : plus de 30 % des mailles françaises mesurées dégradées et un Kp de 5− ou plus sur la fenêtre ; ces mailles ne comptent alors ni dans la pastille ni au score ; les jours concernés sont grisés. Pastille : orange dès 3 mailles françaises au-delà de 10 % sur 24 h glissantes, jaune pour 1 ou 2. Grille en retard au-delà de 40 min après la dernière collecte complète.')
    + paragraph('Limite : certains équipements de l’aviation légère déclarent une précision moindre (nac_p 6) sans brouillage ; le 04/10/2026, deux mailles du sud de l’Angleterre étaient orange pour cette raison. Une maille orange est « à vérifier ».')
    + `<p class="fmk-note">${escapeHtml('Méthode de référence : ')}${sourceLinkHtml('gpsjam.org', GPSJAM_URL)}${escapeHtml(' ; données adsb.lol, ODbL 1.0.')}</p>`
    + `<p class="fmk-note">${escapeHtml('Météo spatiale : ')}${sourceLinkHtml('NOAA SWPC', SWPC_URL)}`
    + `${escapeHtml(glue(' (domaine public) : échelles R, S, G du jour et prévues, indice Kp planétaire par tranche de 3 h, dernière alerte ; en retard au-delà de 3 h après l’heure des échelles.'))}</p>`
    + `<p class="fmk-note">${escapeHtml('Zones drones : ')}${sourceLinkHtml('DGAC / IGN, Géoplateforme', DRONES_MAP_URL)}`
    + `${escapeHtml(' (CGU cartes.gouv.fr) : zones « vol interdit » hors agglomérations, tracés simplifiés pour la carte ; la carte officielle fait foi.')}</p>`
    + `<p class="fmk-note">${escapeHtml('Sanctions : ')}${sourceLinkHtml('registre national des gels, DG Trésor', GELS_REGISTRY_URL)}`
    + `${escapeHtml(glue(' : date relue chaque heure, fichier relu à chaque nouvelle publication ; comptes par nature et différences d’identifiants seulement (nouveaux gels, radiations) ; en retard au-delà de 26 h sans relecture de la date. Hors score.'))}</p>`;
}

// ─── Assemblage ───

/** Pastille avec le compte de mailles à précision dégradée : niveau et raison remplacés ; le gros chiffre suit la pastille (R3). */
function headWithGnss(head: LayerHeadModel, input: DefenseViewInput): LayerHeadModel {
  const m = input.military;
  if (m === null) return head;
  const count = gnssDegradedCount(input.gnss ?? null, input.now);
  const before = defenseLevel(m, input.now);
  // Relevé adsb.lol en retard (niveau suspendu par defenseLevel) mais grille GNSS fraîche : la couleur du GNSS reste (source fraîche,
  // signal propre, décision du contrôleur). Sa raison vient de defenseLevel sur un relevé frais sans urgence (un seul texte), elle
  // passe en premier et le retard adsb.lol est dit ; l'estampille datée est gardée.
  if (before.level === 'nd' && m.readAt !== null && count > 0) {
    const gnssOnly = defenseLevel({ ...m, emergencies: [], readAt: new Date(input.now).toISOString() }, input.now, count);
    return { ...head, level: gnssOnly.level, status: [`${glue(gnssOnly.reason)} · relevé adsb.lol en retard`, ...head.status.slice(1)] };
  }
  const after = defenseLevel(m, input.now, count);
  if (before.level === after.level && before.reason === after.reason) return head;
  const status = head.status.map((s) => (s === before.reason ? after.reason : s === glue(before.reason) ? glue(after.reason) : s));
  return { ...head, level: after.level, status };
}

/** Vue complète : sections GNSS et Sanctions insérées, zones drones et méthode ajoutées, pastille avec le compte GNSS. */
export function withDefenseB(view: LayerView, input: DefenseViewInput): LayerView {
  // Chargement initial : aucune section, le corps porte le chargement.
  if (view.sections.length === 0) return view;
  const sections = [...view.sections];
  const insertBefore = (id: string, section: FicheSection): void => {
    const at = sections.findIndex((s) => s.id === id);
    const fallback = sections.findIndex((s) => s.id === 'methode');
    sections.splice(at >= 0 ? at : fallback >= 0 ? fallback : sections.length, 0, section);
  };
  insertBefore('marine', gnssSection(input));
  insertBefore('methode', gelsSection(input));
  const drones = input.sites.drones ?? null;
  const sitesAt = sections.findIndex((s) => s.id === 'sites');
  if (sitesAt >= 0 && drones !== null) sections[sitesAt] = { ...sections[sitesAt], html: sections[sitesAt].html + droneZonesBlock(drones) };
  const methodAt = sections.findIndex((s) => s.id === 'methode');
  if (methodAt >= 0) sections[methodAt] = { ...sections[methodAt], html: sections[methodAt].html + defenseMethodB() };
  return { ...view, head: headWithGnss(view.head, input), sections };
}
