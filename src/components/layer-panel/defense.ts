// src/components/layer-panel/defense.ts : vue pure du panneau Défense (spec 2026-10-04 souveraineté § 2.1 ; contrats § 4.1 ;
// amendement 7 : O9, O10, O11, O13, O14, S1 à S5) ; aucun accès réseau ni DOM. Collecte adsb.lol du serveur (/v2/mil) ramenée au
// territoire français (V2) : appareils français comptés par département seulement, sans indicatif, type ni position (O10) ; appareils
// marqués PIA ou LADD et adresses non OACI comptés, jamais montrés ; autres appareils nommés avec leur pays (bloc d'adresse OACI) ;
// urgences confirmées sur deux lectures (règle T3 du Trafic aérien), masquées au besoin ; posture Vigipirate saisie et datée (V4,
// hors score), vérifiée par la relecture quotidienne de la page officielle (O14) ; Marine nationale vue en AIS, les autres bâtiments
// à leur port base comme position de référence (V1, S2), sans sous-marin (O11) ; sites de la liste interne (O13). Chaque partie porte
// la date de sa donnée (S1) ; une panne se voit (S3) ; une absence n'est jamais un calme.
import type { MilitaryAircraft, MilitaryBase, MilitaryDeptCount, MilitaryEmergency, MilitaryResponse, OsmFileMeta, Squawk, VigipiratePageCheck } from '../../types/index.ts';
import { VIGIPIRATE_LABEL, VIGIPIRATE_RANK_LABEL, VIGIPIRATE_SOURCE_LABEL, type VigipirateEntry } from '../../config/vigipirate.ts';
import {
  MILITARY_FIGURE_LABEL, defenseLevel, isSovereigntyDataLate, militaryCounts, militaryEmergencyLevel, vigipirateAlertEnd,
} from '../../services/sovereignty-levels.ts';
import { emptySlot, type SourceSlot } from '../../services/sovereignty-source.ts';
import { vigipirateNotices, type VigipirateNotices } from '../../services/sovereignty-vigipirate.ts';
import { isEmergencyConfirmed, parisHour } from '../../services/traffic-levels.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { absoluteTime, kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { stackedDayBars, type DayStack } from './chart.ts';
import { NBSP, frNumber } from './format.ts';
import { emptyLine, listRow, loadingBody, sourceLinkHtml, valueHtml, type LayerHeadModel, type LayerView } from './frame.ts';
import { departementName } from './health-format.ts';
import { frozenWord, homonymKeys, navyLiveState, shipRow, splitNavy, type NavyLiveInput, type NavyLiveState } from './navy.ts';
import {
  EMERGENCY_WORD, FAMILY_COLOR, SOVEREIGNTY_THEME, SQUAWK_CAVEAT, SQUAWK_WORD, aircraftLabel, capitalize, clockOf, dataMs, dateOf,
  emptyOrDown, formatCount, formatFeet, formatKnots, glueSovUnits, note, plural, readErrors, sourceDown, stamp,
} from './sovereignty-format.ts';

export type OpenFn = (sectionId: string, byDefault: boolean) => boolean;

export const DEFENSE_TITLE = 'Défense';

/** Comptes de la section « Sites de défense » ; la phase B ajoute les zones drones de la DGAC (B25). */
export interface DefenseSitesSummary {
  curated: { total: number; byType: Readonly<Record<MilitaryBase['type'], number>>; overseas: number; abroad: number };
  osm: { meta: (OsmFileMeta & { count: number }) | null; error: string | null; shown: boolean };
}

/** Entrée de la vue ; la phase B y ajoute la grille GNSS et le registre des gels (B25). */
export interface DefenseViewInput {
  military: MilitaryResponse | null; militaryError: string | null;
  vigipirate: VigipirateEntry;
  /**
   * Relecture quotidienne de la page officielle par le serveur (/api/sovereignty/vigipirate, O14) ; null avant la première lecture.
   * Ses mentions (page modifiée, fin des 12 jours, rappel de 4 mois, vérification en panne) s'affichent sous l'insigne.
   */
  vigipirateCheck: SourceSlot<VigipiratePageCheck> | null;
  navy: NavyLiveInput;
  /** État AIS du serveur (relevé des câbles) : `evaluated: false` dit « AIS indisponible » dans la section Marine nationale. */
  aisRelay: { evaluated: boolean; lastMessageAt: string | null } | null;
  sites: DefenseSitesSummary;
  canFocus: boolean; now: number; open: OpenFn;
}

const ADSB_URL = 'https://www.adsb.lol';
/** Réponse du ministère des Armées à la question écrite n° 93414 (JO du 25/10/2016) : adresses mode S de la flotte gouvernementale. */
const JO_2016_URL = 'https://www.assemblee-nationale.fr/dyn/14/questions/QANR5L14QE93414';
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const WINDOW_HOURS = 7 * 24;
const PARIS = 'Europe/Paris';
const SQUAWK_ORDER: Readonly<Record<Squawk, number>> = { '7500': 0, '7700': 1, '7600': 2 };
const SITE_ORDER: readonly MilitaryBase['type'][] = ['air', 'navy', 'army', 'joint', 'fortification', 'other'];
const SITE_LABEL: Readonly<Record<MilitaryBase['type'], string>> = {
  air: 'Bases aériennes', navy: 'Bases navales', army: 'Sites de l’armée de terre', joint: 'Sites interarmées', fortification: 'Fortifications',
  other: 'Autres sites',
};
/** Collectivités d'outre-mer de la base curée (champ `region`) ; hors de la métropole et hors de cette liste : forces à l'étranger. */
const OVERSEAS_REGIONS: ReadonlySet<string> = new Set([
  'Martinique', 'Guadeloupe', 'Guyane', 'La Réunion', 'Mayotte', 'Polynésie Française', 'Nouvelle-Calédonie', 'Saint-Pierre-et-Miquelon',
]);
/** Espace aérien national au-dessus de la mer (S5) : la mer territoriale, 12 milles marins (22 km) de la côte. */
const TERRITORIAL_SEA = `au-dessus de la mer territoriale (moins de 12${NBSP}milles de la côte)`;
const APPROACHES = `approches de la France (moins de 40${NBSP}km)`;
const MASKED_FRENCH = 'appareil d’État français';
const MASKED_OTHER = 'appareil à identité protégée ou de nationalité inconnue';
const V1_SENTENCE = 'Couverture communautaire : un appareil absent du flux n’est pas absent du ciel (transpondeur coupé, appareils d’État souvent masqués). '
  + 'Pays déduit du bloc d’adresse OACI, pas de l’opérateur.';

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function late(m: MilitaryResponse, now: number): boolean {
  return isSovereigntyDataLate('adsb-mil', m.readAt, now);
}

function callout(text: string): string {
  return `<p class="fmk-callout lp-callout">${escapeHtml(text)}</p>`;
}

/**
 * Insigne d'en-tête, toujours présent (S1) : « Vigipirate : vigilance renforcée (niveau d’alerte intermédiaire) depuis le 22/06/2026 ·
 * Source : site internet du SGDSN ». Repris par la tuile et le panneau.
 */
export function vigipirateBadge(entry: VigipirateEntry): string {
  return `Vigipirate : ${lowerFirst(VIGIPIRATE_LABEL[entry.stade])} (${VIGIPIRATE_RANK_LABEL[entry.stade]}) depuis le ${dateOf(entry.depuis)} · `
    + VIGIPIRATE_SOURCE_LABEL;
}

function noticesOf(input: Pick<DefenseViewInput, 'vigipirate' | 'vigipirateCheck' | 'now'>): VigipirateNotices {
  return vigipirateNotices(input.vigipirate, input.vigipirateCheck ?? emptySlot<VigipiratePageCheck>(), input.now);
}

/**
 * Mentions affichées sous l'insigne (O14) : fin des 12 jours d'une « alerte attentat » en note ; page officielle modifiée, saisie de
 * plus de 4 mois et vérification en panne ou en retard en encadré (une panne se voit, S3).
 */
function noticesHtml(n: VigipirateNotices): string {
  return (n.alertEnd !== null ? note(`Alerte attentat ${n.alertEnd}.`) : '')
    + [n.recheck, n.reminder, n.checkFailure].filter((t): t is string => t !== null).map((t) => callout(`${capitalize(t)}.`)).join('');
}

/** Source adsb.lol injoignable, nommée : l'encadré suit les mentions Vigipirate, il ne doit pas sembler parler d'elles. */
function adsbErrorCallout(lastDataMs: number | null, now: number): string {
  return callout(lastDataMs === null ? 'Source adsb.lol injoignable. Aucune donnée reçue.'
    : `Source adsb.lol injoignable. Dernières données : ${absoluteTime(lastDataMs, now, 'fr')}.`);
}

function inMetropole(lon: number, lat: number): boolean {
  return lon >= -5.5 && lon <= 10 && lat >= 41 && lat <= 51.5;
}

/** Comptes de la liste interne : par catégorie, et parmi eux l'outre-mer et les forces françaises à l'étranger (arbitrage 24). */
export function summarizeCuratedSites(bases: ReadonlyArray<MilitaryBase & { region?: string }>): DefenseSitesSummary['curated'] {
  const byType: Record<MilitaryBase['type'], number> = { air: 0, navy: 0, army: 0, joint: 0, fortification: 0, other: 0 };
  let overseas = 0;
  let abroad = 0;
  for (const b of bases) {
    byType[b.type] += 1;
    const [lon, lat] = b.coordinates;
    if (inMetropole(lon, lat)) continue;
    if (b.region !== undefined && OVERSEAS_REGIONS.has(b.region)) overseas += 1;
    else abroad += 1;
  }
  return { total: bases.length, byType, overseas, abroad };
}

// ─── En-tête ───

/** O9 : « aéronefs militaires ou d’État visibles en ADS-B au-dessus de la métropole · 4 français · 5 autres · relevé adsb.lol 16:48 ». */
function figureCaption(m: MilitaryResponse, isLate: boolean, now: number): string {
  const { francais, autres } = militaryCounts(m);
  return `${MILITARY_FIGURE_LABEL} · ${frNumber(francais, 0)} français · ${frNumber(autres, 0)} ${autres > 1 ? 'autres' : 'autre'} · `
    + `relevé adsb.lol ${clockOf(m.readAt, now)}${isLate ? ' (en retard)' : ''}`;
}

function headOf(input: DefenseViewInput, m: MilitaryResponse): LayerHeadModel {
  const { now, vigipirate } = input;
  const lead = vigipirateBadge(vigipirate);
  if (m.readAt === null) {
    return {
      theme: SOVEREIGNTY_THEME, title: DEFENSE_TITLE, level: 'nd',
      figure: { value: 'n.d.', caption: `${MILITARY_FIGURE_LABEL} : adsb.lol indisponible`, level: null },
      status: ['adsb.lol indisponible'], lead,
    };
  }
  const isLate = late(m, now);
  const verdict = defenseLevel(m, now);
  return {
    theme: SOVEREIGNTY_THEME, title: DEFENSE_TITLE,
    // R3 : sans niveau propre, le gros chiffre prend celui de la pastille ; en retard, couleur retirée.
    figure: { value: formatCount(militaryCounts(m).total), caption: figureCaption(m, isLate, now), ...(isLate ? { level: null } : {}) },
    level: isLate ? 'nd' : verdict.level,
    status: [isLate ? 'niveau suspendu : relevé adsb.lol en retard' : glueSovUnits(verdict.reason), stamp('adsb.lol', m.readAt, isLate, now)],
    lead,
  };
}

// ─── Posture Vigipirate (V4, hors score ; O14, S1) ───

function pageCheckText(check: SourceSlot<VigipiratePageCheck> | null, now: number): string | null {
  if (check === null) return null;
  const readMs = dataMs(check.data?.readAt ?? null);
  if (readMs !== null) return `relue le ${absoluteTime(readMs, now, 'fr', { withDate: true }).replace(' ', ' à ')}`;
  return check.error !== null || check.data !== null ? 'jamais relue' : null;
}

function vigipirateSection(input: DefenseViewInput, notices: VigipirateNotices): FicheSection {
  const { vigipirate: entry, vigipirateCheck, now, open } = input;
  const label = lowerFirst(VIGIPIRATE_LABEL[entry.stade]);
  const end = vigipirateAlertEnd(entry);
  const checked = pageCheckText(vigipirateCheck, now);
  const html = kvRow('Stade', valueHtml(`${label} (${VIGIPIRATE_RANK_LABEL[entry.stade]})`))
    + kvRow('Depuis le', valueHtml(dateOf(entry.depuis)))
    + (end !== null ? kvRow('Fin des 12 jours', valueHtml(`${dateOf(end)}, sauf renouvellement par le Premier ministre`)) : '')
    + kvRow('Posture', escapeHtml(entry.posture))
    + kvRow('Accents', escapeHtml(entry.accents.join(', ')))
    + kvRow('Saisie', valueHtml(dateOf(entry.saisiLe)))
    + (checked !== null ? kvRow('Page officielle', valueHtml(checked)) : '')
    + `<p class="fmk-note">${sourceLinkHtml('Page officielle du plan Vigipirate (SGDSN)', entry.lien)}</p>`
    + note(`${VIGIPIRATE_SOURCE_LABEL}. Niveau public du plan Vigipirate, repris de sgdsn.gouv.fr le ${dateOf(entry.saisiLe)} ; les mesures de la `
      + 'posture sont diffusées aux services par le SGDSN : la note de posture fait foi. Pas de flux public : la page est relue chaque jour par le '
      + 'serveur (empreinte du texte, sans le reprendre) et une modification fait revérifier le niveau. Hors score : une posture n’est pas un événement.');
  const summary = notices.recheck !== null ? `${label} · à revérifier` : label;
  return { id: 'vigipirate', title: 'Posture Vigipirate', collapsible: true, open: open('vigipirate', true), summary: escapeHtml(summary), html };
}

// ─── Aéronefs au-dessus de la France (O10) ───

/** Valeur courte du lieu d'un appareil montré : « Rhône (69) », « mer territoriale ». */
function placeOf(dept: string | null): string {
  return dept !== null ? `${departementName(dept)} (${dept})` : 'mer territoriale';
}

/** Appareil d'une autre nation montré un par un (ni français, ni PIA, ni LADD, ni adresse non OACI) : jamais d'immatriculation. */
function aircraftRow(a: MilitaryAircraft, isLate: boolean, canFocus: boolean, now: number): string {
  const parts = [a.country ?? 'pays non identifié', formatFeet(a.altitudeFt), formatKnots(a.speedKt, 0), `vu à ${clockOf(a.seenAt, now)}`,
    a.dept === null ? TERRITORIAL_SEA : null];
  return listRow({
    text: `${aircraftLabel(a)} · ${a.type ?? 'type n.d.'}`, value: placeOf(a.dept),
    ...(isLate ? { level: 'gris' as const } : { color: FAMILY_COLOR.autres }),
    note: parts.filter((p): p is string => p !== null && p !== '').join(' · '),
    ...(canFocus ? { data: { aircraft: a.hex }, link: true } : {}),
  });
}

/** Appareils français d'un département (ou de la mer territoriale) : un compte, sans indicatif, type ni position (O10). */
function frenchDeptRow(d: MilitaryDeptCount, isLate: boolean): string {
  return listRow({
    text: d.dept !== null ? placeOf(d.dept) : capitalize(TERRITORIAL_SEA), value: formatCount(d.count),
    ...(isLate ? { level: 'gris' as const } : { color: FAMILY_COLOR.francais }),
  });
}

function subhead(text: string): string {
  return `<h4 class="fmk-eyebrow">${escapeHtml(text)}</h4>`;
}

/** Paris : « 04/10 16 h » (insécable, R1). */
function hourTick(ms: number): string {
  const day = new Date(ms).toLocaleDateString('fr-FR', { timeZone: PARIS, day: '2-digit', month: '2-digit' });
  return `${day} ${String(parisHour(ms)).padStart(2, '0')}${NBSP}h`;
}

/** Aéronefs distincts par heure UTC (heure de Paris affichée), français et autres empilés ; une heure sans collecte reste vide. */
function hourlyChart(m: MilitaryResponse, now: number): string {
  const byHour = new Map<number, { francais: number; autres: number }>();
  for (const h of m.hourly.hours) {
    const at = Date.parse(`${h.hour}:00:00Z`);
    if (Number.isFinite(at)) byHour.set(at, { francais: h.francais, autres: h.autres });
  }
  if (byHour.size === 0) return '';
  const last = Math.floor(now / HOUR_MS) * HOUR_MS;
  const first = Math.max(Math.min(...byHour.keys()), last - (WINDOW_HOURS - 1) * HOUR_MS);
  const days: DayStack[] = [];
  for (let at = first; at <= last; at += HOUR_MS) {
    const h = byHour.get(at);
    days.push({
      day: at,
      parts: h ? [{ value: h.francais, color: FAMILY_COLOR.francais, label: 'français' }, { value: h.autres, color: FAMILY_COLOR.autres, label: 'autres' }] : [],
    });
  }
  const chart = stackedDayBars(days, {
    label: 'Aéronefs militaires ou d’État au-dessus de la métropole par heure, sur 7 jours', value: (v) => formatCount(v), tick: hourTick,
  });
  if (!chart) return '';
  const since = dataMs(m.hourly.since === null ? null : `${m.hourly.since}:00:00Z`);
  const spanDays = since === null ? 7 : Math.max(1, Math.ceil((now - since) / DAY_MS));
  return `<div class="lp-legend"><span class="lp-key"><i style="background:${FAMILY_COLOR.francais}"></i>français</span>`
    + `<span class="lp-key"><i style="background:${FAMILY_COLOR.autres}"></i>autres</span></div>${chart}`
    + (spanDays < 7 ? note(`Référence en construction (${spanDays} ${spanDays > 1 ? 'jours' : 'jour'} sur 7).`) : '');
}

function aircraftSection(input: DefenseViewInput, m: MilitaryResponse | null): FicheSection {
  const { canFocus, now, open } = input;
  const base = { id: 'aeronefs', title: 'Aéronefs militaires ou d’État au-dessus de la métropole', collapsible: true, open: open('aeronefs', true) };
  if (m === null || m.readAt === null) return { ...base, summary: 'n.d.', html: sourceDown('aéronefs adsb.lol') };
  const isLate = late(m, now);
  const counts = militaryCounts(m);
  const french = counts.francais > 0
    ? subhead(`Français : ${frNumber(counts.francais, 0)}, comptés par département`) + m.frenchByDept.map((d) => frenchDeptRow(d, isLate)).join('')
    : '';
  const others = m.others.length > 0
    ? subhead(`Autres pays : ${frNumber(m.others.length, 0)}`) + m.others.map((a) => aircraftRow(a, isLate, canFocus, now)).join('')
    : '';
  const masked = m.maskedOthers > 0
    ? listRow({ text: 'Identité protégée ou nationalité inconnue (PIA, LADD, adresse non OACI) : comptés, jamais montrés', value: formatCount(m.maskedOthers), level: 'gris' })
    : '';
  const rows = counts.total > 0 ? french + others + masked
    : emptyOrDown(m.errors, 'Aucun aéronef militaire ou d’État visible en ADS-B au-dessus de la métropole ; une absence du flux n’est pas une absence d’activité.', 'aéronefs adsb.lol');
  return {
    ...base,
    summary: escapeHtml(`${frNumber(counts.total, 0)} en France · ${frNumber(m.abroadCount, 0)} hors de France${isLate ? ' (en retard)' : ''}`),
    html: rows
      + listRow({ text: 'Hors de France (approches, mer, pays voisins), jamais comptés', value: formatCount(m.abroadCount), level: 'gris' })
      + hourlyChart(m, now)
      + note('Appareils français : un compte par département, sans indicatif, type ni position ; appareils à identité protégée : un compte seulement.')
      + note(V1_SENTENCE)
      + (canFocus && m.others.length > 0 ? note('Clic sur un aéronef d’une autre nation : sa position au relevé sur la carte.') : ''),
  };
}

// ─── Urgences (règle T3 du Trafic aérien, arbitrage 6 ; O10, S3) ───

/**
 * Clé d'un épisode : adresse, code et début pour un appareil montré ; code, début et département pour un appareil masqué, qui n'a
 * pas d'adresse côté client (O10).
 */
function emergencyKey(e: MilitaryEmergency): string {
  return e.masked ? `${e.squawk}:${e.firstSeen}:${e.dept}` : `${e.icao24}:${e.squawk}:${e.firstSeen}`;
}

/** Lieu dit d'une urgence : département, mer territoriale, approches ou hors de France. */
function emergencyPlace(e: MilitaryEmergency): string {
  if (e.inFrance) return e.dept !== null ? placeOf(e.dept) : TERRITORIAL_SEA;
  return e.overFrance ? APPROACHES : 'hors de France';
}

/** Appareil masqué (O10) : « appareil d’État français · Dépt 56 » ; jamais une adresse, un indicatif ni une position. */
function maskedWho(e: Extract<MilitaryEmergency, { masked: true }>): string {
  const who = e.family === 'francais' ? MASKED_FRENCH : MASKED_OTHER;
  const where = e.dept !== null ? `Dépt${NBSP}${e.dept}` : e.inFrance ? 'mer territoriale' : e.overFrance ? 'approches de la France' : 'hors de France';
  return `${who} · ${where}`;
}

function emergencyRow(e: MilitaryEmergency, isLate: boolean, current: boolean, canFocus: boolean, now: number): string {
  const confirmed = isEmergencyConfirmed(e);
  const seen = confirmed ? `confirmée sur deux lectures, vue de ${clockOf(e.firstSeen, now)} à ${clockOf(e.lastSeen, now)}`
    : `vue une fois à ${clockOf(e.firstSeen, now)}, ${current ? 'à confirmer' : 'non confirmée'}`;
  // Champ « emergency » publié, dit seulement s'il ajoute au code (« general » d'un 7700 redirait « urgence »).
  const published = e.emergency !== null ? EMERGENCY_WORD[e.emergency] ?? null : null;
  const word = published !== null && published !== SQUAWK_WORD[e.squawk] ? `statut publié : ${published}` : null;
  const who = e.masked ? [] : [e.type ?? 'type n.d.', e.country ?? 'pays non identifié'];
  const parts = [...who, emergencyPlace(e), word, seen, e.squawk === '7500' ? SQUAWK_CAVEAT : null];
  return listRow({
    text: `${e.masked ? maskedWho(e) : e.callsign ?? `adresse ${e.icao24}`} · ${e.squawk} (${SQUAWK_WORD[e.squawk]})`,
    value: clockOf(e.lastSeen, now), level: isLate || !current ? 'gris' : militaryEmergencyLevel(e),
    note: parts.filter((p): p is string => p !== null && p !== '').join(' · '),
    // Un appareil masqué n'a pas de position : rien à recentrer sur la carte (O10).
    ...(canFocus && current && !e.masked ? { data: { emergency: `${e.icao24}:${e.squawk}` }, link: true } : {}),
  });
}

function sortEmergencies(list: readonly MilitaryEmergency[]): MilitaryEmergency[] {
  return [...list].sort((a, b) => SQUAWK_ORDER[a.squawk] - SQUAWK_ORDER[b.squawk] || (dataMs(b.lastSeen) ?? 0) - (dataMs(a.lastSeen) ?? 0));
}

function emergenciesSection(input: DefenseViewInput, m: MilitaryResponse | null): FicheSection {
  const { canFocus, now, open } = input;
  const current = m === null || m.readAt === null ? [] : sortEmergencies(m.emergencies);
  const base = { id: 'urgences', title: 'Urgences', collapsible: true, open: open('urgences', current.length > 0) };
  if (m === null || m.readAt === null) return { ...base, summary: 'n.d.', html: sourceDown('urgences adsb.lol') };
  const isLate = late(m, now);
  const shown = new Set(current.map(emergencyKey));
  const log = m.emergencyLog.filter((e) => !shown.has(emergencyKey(e))).slice(0, 10);
  const html = (current.length > 0
    ? current.map((e) => emergencyRow(e, isLate, true, canFocus, now)).join('')
    : emptyLine('Aucun code d’urgence (7500, 7600, 7700) dans le flux adsb.lol : un appareil qui n’émet pas n’en déclare pas.'))
    + (log.length > 0 ? note('Journal sur 7 jours') + log.map((e) => emergencyRow(e, isLate, false, false, now)).join('') : '')
    + note(`Une urgence ne colore qu’au-dessus de la France ou à moins de 40${NBSP}km, confirmée sur deux lectures (règle du Trafic aérien) ; `
      + 'vue une fois : jaune. Intervention illicite (7500) rouge ; urgence (7700) et panne radio (7600) orange. '
      + 'Chaque code est affiché par le transpondeur, non confirmé par les autorités. Appareil français ou à identité protégée : département '
      + 'seul, sans indicatif ni position.');
  const summary = current.length > 0 ? `${plural(current.length, 'urgence')}${isLate ? ' (en retard)' : ''}`
    : isLate ? `non évalué · adsb.lol muet depuis ${clockOf(m.readAt, now)}` : 'aucune';
  return { ...base, summary: escapeHtml(summary), html };
}

// ─── Marine nationale (V1, arbitrage 7 ; O11, O12, S2) ───

function navySection(input: DefenseViewInput): FicheSection {
  const { navy, aisRelay, now, open } = input;
  const state: NavyLiveState = navyLiveState(navy, aisRelay !== null && !aisRelay.evaluated, now);
  const { observed, reference } = splitNavy(navy.ships);
  const homonyms = homonymKeys(navy.ships);
  const lastMs = navy.lastMessageAt ?? dataMs(aisRelay?.lastMessageAt ?? null);
  const since = lastMs !== null ? ` depuis ${absoluteTime(lastMs, now, 'fr')}` : '';
  const summary = state.frozen
    ? `non évalué · ${frozenWord(state)}${since}`
    : `${frNumber(observed.length, 0)} ${observed.length > 1 ? 'vus' : 'vu'} en AIS · ${frNumber(reference.length, 0)} au port base (référence)`;
  const html = (state.frozen ? callout(`${frozenWord(state)}${since} : positions figées, non évaluées.`) : '')
    + (observed.length > 0 ? observed.map((s) => shipRow(s, homonyms, state.frozen, now, 'navy')).join('')
      : emptyLine(`Aucun bâtiment de la Marine nationale identifié en AIS depuis 10${NBSP}minutes : un bâtiment qui n’émet pas ou ne s’identifie pas n’est pas vu.`))
    + note('Port base : position de référence, pas une observation')
    + reference.map((s) => shipRow(s, homonyms, true, now, 'navy')).join('')
    + note('Bâtiment vu en AIS : reconnu par son propre message AIS (type militaire, MMSI français, nom de la liste) ou par un MMSI vérifié '
      + `sur une source officielle publique, daté de son dernier message. Sans message depuis 10${NBSP}minutes, un bâtiment est montré à son port base `
      + 'comme position de référence, jamais comme une observation.');
  return { id: 'marine', title: 'Marine nationale', collapsible: true, open: open('marine', false), summary: escapeHtml(summary), html };
}

// ─── Sites de défense (O13) ───

function osmBlock(osm: DefenseSitesSummary['osm'], now: number): string {
  const button = `<button type="button" class="lp-toggle" data-osm-works aria-pressed="${osm.shown}">`
    + `${osm.shown ? 'Masquer les ouvrages OpenStreetMap' : 'Afficher les ouvrages OpenStreetMap'}</button>`;
  if (osm.meta !== null) {
    const base = dataMs(osm.meta.osmBase);
    const baseText = base === null ? 'n.d.' : absoluteTime(base, now, 'fr', { withDate: true });
    return button + note(`Ouvrages OpenStreetMap : ${formatCount(osm.meta.count)} points en France, fichier du ${dateOf(osm.meta.generatedAt)} `
      + `(base OSM du ${baseText}), ${osm.meta.source}, ${osm.meta.licence}.`);
  }
  if (osm.error !== null) return button + emptyLine(`Fichier des ouvrages OpenStreetMap illisible : ${osm.error}.`);
  return button + (osm.shown ? emptyLine('Chargement des ouvrages OpenStreetMap…')
    : note('Ouvrages OpenStreetMap (blockhaus, casernes, terrains militaires) : chargés à l’affichage, points hors de France retirés.'));
}

function sitesSection(input: DefenseViewInput): FicheSection {
  const { sites, now, open } = input;
  const { curated, osm } = sites;
  const rows = SITE_ORDER.filter((t) => curated.byType[t] > 0).map((t) => listRow({ text: SITE_LABEL[t], value: formatCount(curated.byType[t]) })).join('')
    + listRow({ text: 'dont outre-mer', value: formatCount(curated.overseas) })
    + listRow({ text: 'dont forces françaises à l’étranger', value: formatCount(curated.abroad) });
  const osmShown = osm.shown && osm.meta !== null ? ` · ${formatCount(osm.meta.count)} ouvrages OpenStreetMap` : '';
  return {
    id: 'sites', title: 'Sites de défense', collapsible: true, open: open('sites', false),
    summary: escapeHtml(`${plural(curated.total, 'site')}${osmShown}`),
    html: rows
      + note('Liste interne de sites publics (ministère des Armées, Wikipédia, OpenStreetMap), sans date par site. '
        + 'Chaque site : nom, catégorie et lien officiel s’il existe ; ni description, ni unités.')
      + osmBlock(osm, now)
      + note('Zones interdites : deux tracés approchés saisis à la main, non datés.'),
  };
}

// ─── Méthode et sources (S4, S5) ───

function methodSection(input: DefenseViewInput): FicheSection {
  const { military: m, militaryError, navy, vigipirate, now, open } = input;
  const read = m !== null && m.readAt !== null;
  const adsbState = read ? `relevé du serveur ${clockOf(m.readAt, now)}${late(m, now) ? ' (en retard)' : ''}`
    : militaryError !== null || m !== null ? 'source indisponible' : 'chargement…';
  const aisState = navy.lastMessageAt !== null ? `dernier message ${absoluteTime(navy.lastMessageAt, now, 'fr')}` : 'aucun message reçu';
  const html = kvRow('Aéronefs', `${sourceLinkHtml('adsb.lol', ADSB_URL)} · ${escapeHtml(adsbState)}`)
    + kvRow('Marine nationale', escapeHtml(`aisstream.io via le relais · ${aisState}`))
    + kvRow('Vigipirate', `${sourceLinkHtml(VIGIPIRATE_SOURCE_LABEL, vigipirate.lien)} · ${escapeHtml(`saisie du ${dateOf(vigipirate.saisiLe)}, page relue chaque jour`)}`)
    + kvRow('Sites', escapeHtml('liste interne de sites publics · ouvrages OpenStreetMap en option'))
    + note('Données adsb.lol, ODbL 1.0 : réseau communautaire de récepteurs ADS-B. Un appareil est militaire ou d’État si la base adsb.lol le classe '
      + 'ainsi ; elle classe aussi des appareils d’État non militaires (hélicoptères de la Sécurité civile). Ce compte d’appareils qui émettent '
      + 'n’est pas l’activité militaire.')
    + note(`Au-dessus de la France : position dans un département métropolitain, ou ${TERRITORIAL_SEA}. `
      + 'Hors de France : dessiné en gris, jamais compté. Pays : bloc d’adresse OACI de l’appareil (annexe 10 de l’OACI).')
    + `<p class="fmk-note">${escapeHtml('Appareils français (bloc d’adresse OACI France) : comptés par département, sans indicatif, type, immatriculation ni '
      + 'point sur la carte ; appareils marqués PIA ou LADD et adresses non OACI : comptés, jamais montrés ; aucune immatriculation, pour aucun pays. '
      + 'Le ministère des Armées modifie l’adresse mode S des avions de la flotte gouvernementale et demande aux sites de suivi de préserver la '
      + 'confidentialité des activités militaires (')}${sourceLinkHtml('réponse ministérielle publiée au JO le 25/10/2016', JO_2016_URL)}).</p>`
    + note(`Position au relevé, sans trajectoire ni interpolation ; une position de plus de 2${NBSP}minutes n’est pas retenue.`)
    + note(`Urgences : code 7500, 7600 ou 7700, ou champ « emergency » publié, confirmés sur deux lectures du serveur ; ${SQUAWK_CAVEAT}.`)
    + note(`Retard : relevé de plus de 10${NBSP}min ; la pastille passe à n.d. et les couleurs sont retirées.`)
    + readErrors(m !== null ? m.errors.map(glueSovUnits) : []);
  return { id: 'methode', title: 'Méthode et sources', collapsible: true, open: open('methode', false), tone: 'reference', html, summary: escapeHtml('4 sources') };
}

// ─── Assemblage ───

export function buildDefenseView(input: DefenseViewInput): LayerView {
  const { military: m, militaryError, vigipirate, now } = input;
  const notices = noticesOf(input);
  const underBadge = noticesHtml(notices);
  if (m === null && militaryError === null) {
    return {
      head: { theme: SOVEREIGNTY_THEME, title: DEFENSE_TITLE, status: ['chargement…'], lead: vigipirateBadge(vigipirate) }, sections: [],
      bodyHtml: underBadge + loadingBody(),
    };
  }
  const sections = [
    vigipirateSection(input, notices), aircraftSection(input, m), emergenciesSection(input, m), navySection(input), sitesSection(input),
    methodSection(input),
  ];
  if (m === null) {
    return {
      head: {
        theme: SOVEREIGNTY_THEME, title: DEFENSE_TITLE, level: 'nd',
        figure: { value: 'n.d.', caption: `${MILITARY_FIGURE_LABEL} : adsb.lol injoignable`, level: null },
        status: ['adsb.lol injoignable'], lead: vigipirateBadge(vigipirate),
      },
      sections, bodyHtml: underBadge + adsbErrorCallout(null, now),
    };
  }
  const bodyHtml = underBadge + (militaryError !== null ? adsbErrorCallout(dataMs(m.readAt), now) : '');
  return { head: headOf(input, m), sections, ...(bodyHtml !== '' ? { bodyHtml } : {}) };
}
