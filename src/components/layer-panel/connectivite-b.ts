// src/components/layer-panel/connectivite-b.ts : ajouts de la phase B au panneau Connectivité (spec 2026-10-04 souveraineté § 3.3 ;
// contrats § 4.1, arbitrage 31, S8). Gros chiffre « N / 6 grands réseaux français vus par au moins 99 % des routeurs témoins RIPE »
// (couleur du plus mauvais réseau lu ; sans couleur en retard), pastille connectivityLevel (le plus haut des câbles et des réseaux),
// section « Visibilité Internet des réseaux » en tête (une barre par réseau lu, une ligne grise par réseau non lu, courbe de la
// visibilité minimale sur 30 jours, préfixes annoncés et règle de baisse), compte des navires lents déplacé dans sa section, section
// « Points d'échange Internet » (annuaire PeeringDB, sans état en direct), méthode. Pur, sans réseau ni DOM : appliqué par
// buildConnectiviteView (connectivite.ts) à la vue de la phase A. Hors score. Une absence n'est jamais un calme : réseau non lu en gris,
// jamais une barre à 0 ; instantané en retard sans couleur ; série interrompue dite.
import type { ConnectivityResponse, MajorNetworkAsn, NetworkVisibility, PrefixSample, UnreadNetwork } from '../../types/index.ts';
import {
  FULL_VISIBILITY_PCT, cablesLevel, connectivityLevel, isSovereigntyDataLate, networkVisibilityLevel, visibilityPctLevel,
} from '../../services/sovereignty-levels.ts';
import { levelColorVar, maxLevel } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { lineChart, type ChartPoint } from './chart.ts';
import { NBSP } from './format.ts';
import { barRow, emptyLine, listRow, sourceLinkHtml, valueHtml, type LayerFigure, type LayerHeadModel, type LayerView } from './frame.ts';
import { clockOf, dateOf, formatAsn, formatCount, formatPctVisibility, glueSovUnits, note, plural, sourceDown } from './sovereignty-format.ts';
import type { ConnectiviteViewInput } from './connectivite.ts';

const RIPESTAT_URL = 'https://stat.ripe.net/';
const PEERINGDB_URL = 'https://www.peeringdb.com/';
const PARIS = 'Europe/Paris';
const MAJOR_NETWORKS = 6;
/** Ordre d'affichage des six grands réseaux (celui de MajorNetworkAsn). */
const MAJOR_ORDER: readonly MajorNetworkAsn[] = [3215, 15557, 5410, 12322, 2200, 16276];
const DAY_MS = 86_400_000;
const HISTORY_DAYS = 30;
/** Instantanés toutes les 8 h : au-delà de 9 h sans échantillon, la courbe est coupée (un trou reste un trou). */
const HISTORY_GAP_MS = 9 * 3_600_000;
/** Règle de baisse des préfixes annoncés (S8, arbitrage du contrôleur) : 10 % sous la médiane de 30 jours, référence dès 7 jours. */
export const PREFIX_DROP_PCT = 10;
export const PREFIX_REFERENCE_DAYS = 7;
const MINUS = '−';
const AIS_SUSPENDED = 'niveau suspendu : relevé AIS en retard';
const LATE_RIPE = 'instantané RIPEstat en retard';
const PREFIX_COLOR = 'var(--cat-cable)';

const glue = (text: string): string => glueSovUnits(text);
const paragraph = (text: string): string => note(glue(text));
const ratio = (a: number, b: number): string => `${formatCount(a)}${NBSP}/${NBSP}${formatCount(b)}`;
function dayMonth(ms: number): string {
  return new Date(ms).toLocaleDateString('fr-FR', { timeZone: PARIS, day: '2-digit', month: '2-digit' });
}
function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString('fr-FR', { timeZone: PARIS, hour: '2-digit', minute: '2-digit' });
}

// ─── Règle de baisse des préfixes annoncés (S8) ───

export type PrefixTrend =
  | { kind: 'building'; days: number }
  | { kind: 'steady' }
  | { kind: 'drop'; pct: number };

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 === 1 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/**
 * Tendance des préfixes annoncés d'un réseau (IPv4 + IPv6) : une baisse de 10 % ou plus sous la médiane des échantillons de 30 jours
 * est « à vérifier », jamais une panne (ni couleur ni pastille). Moins de 7 jours d'échantillons : référence en construction.
 * L'échantillon de l'instantané courant n'entre pas dans la médiane. Pur.
 */
export function prefixTrend(samples: readonly PrefixSample[] | undefined, asn: number, current: number, now: number, snapshotAt: string | null): PrefixTrend {
  const snapshotMs = snapshotAt === null ? Number.NaN : Date.parse(snapshotAt);
  const window = (samples ?? []).map((s) => ({ at: Date.parse(s.at), value: s.prefixes[String(asn)] }))
    .filter((s) => Number.isFinite(s.at) && typeof s.value === 'number' && Number.isFinite(s.value) && s.at <= now && s.at >= now - HISTORY_DAYS * DAY_MS);
  if (window.length === 0) return { kind: 'building', days: 0 };
  const days = Math.max(0, Math.floor((now - Math.min(...window.map((s) => s.at))) / DAY_MS));
  const past = window.filter((s) => s.at !== snapshotMs);
  if (days < PREFIX_REFERENCE_DAYS || past.length === 0 || !Number.isFinite(current)) return { kind: 'building', days };
  const ref = median(past.map((s) => s.value));
  if (!(ref > 0)) return { kind: 'steady' };
  const pct = ((ref - current) / ref) * 100;
  return pct >= PREFIX_DROP_PCT ? { kind: 'drop', pct: Math.round(pct) } : { kind: 'steady' };
}

/** Note de baisse (sans couleur) : « baisse des préfixes annoncés à vérifier (−12 %) ». */
function dropNote(t: PrefixTrend): string | null {
  return t.kind === 'drop' ? `baisse des préfixes annoncés à vérifier (${MINUS}${t.pct}${NBSP}%)` : null;
}

// ─── Gros chiffre ───

/** « 1 non lu », « 2 non lus » : insécable, jamais « non » et « lu » de part et d'autre d'un retour à la ligne (capture du 05/10). */
function unreadWord(missing: number): string {
  return `${missing}${NBSP}non${NBSP}lu${missing > 1 ? 's' : ''}`;
}

function unreadOf(c: ConnectivityResponse): UnreadNetwork[] {
  return c.unread ?? [];
}

/** Gros chiffre de la phase B : grands réseaux vus par au moins 99 % des routeurs témoins RIPE (arbitrage 31, S8). */
function networksFigure(c: ConnectivityResponse | null, error: string | null, now: number): LayerFigure {
  const caption = 'grands réseaux français vus par au moins 99 % des routeurs témoins RIPE';
  if (c === null) return { value: 'n.d.', caption: glue(`${caption} · ${error !== null ? 'RIPEstat indisponible' : 'chargement…'}`), level: null };
  if (c.snapshotAt === null || c.networks.length === 0) return { value: 'n.d.', caption: glue(`${caption} · RIPEstat indisponible`), level: null };
  const late = isSovereigntyDataLate('ripestat', c.snapshotAt, now);
  const full = c.networks.filter((n) => n.visibilityPct >= FULL_VISIBILITY_PCT).length;
  const missing = MAJOR_NETWORKS - c.networks.length;
  return {
    value: `${full}${NBSP}/${NBSP}${MAJOR_NETWORKS}`,
    caption: glue(`${caption} · instantané RIPE de ${clockOf(c.snapshotAt, now)}${late ? ' (en retard)' : ''}${missing > 0 ? ` · ${unreadWord(missing)}` : ''}`),
    level: late ? null : maxLevel(c.networks.map(networkVisibilityLevel)),
  };
}

// ─── Section « Visibilité Internet des réseaux » ───

function networkRow(n: NetworkVisibility, late: boolean, trend: PrefixTrend): string {
  const label = `${n.name} (${formatAsn(n.asn)})`;
  const prefixes = n.v4Prefixes + n.v6Prefixes;
  const drop = late ? null : dropNote(trend);
  const detail = glue([
    `IPv4 : ${n.v4Seeing} sur ${n.v4Total} routeurs · IPv6 : ${n.v6Seeing} sur ${n.v6Total} routeurs`,
    `${formatCount(prefixes)}${NBSP}préfixes annoncés (${formatCount(n.v4Prefixes)} IPv4, ${formatCount(n.v6Prefixes)} IPv6)`,
    `visibilité ${formatPctVisibility(n.visibilityPct)}`,
    ...(drop === null ? [] : [drop]),
  ].join(' · '));
  const data = { network: String(n.asn) };
  if (late) return listRow({ text: label, value: ratio(n.v4Seeing, n.v4Total), level: 'gris', note: detail, data });
  return barRow({ label, pct: n.visibilityPct, value: ratio(n.v4Seeing, n.v4Total), level: networkVisibilityLevel(n), note: detail, data });
}

/** Réseau non lu : ligne grise nommée, jamais une barre à 0 ; la panne est dite (« lecture en cours » sans panne). */
function unreadRow(u: UnreadNetwork): string {
  return listRow({
    text: `${u.name} (${formatAsn(u.asn)})`, value: 'n.d.', level: 'gris', note: `non lu · ${u.error ?? 'lecture en cours'}`, data: { network: String(u.asn) },
  });
}

function networkRows(c: ConnectivityResponse, now: number, late: boolean): string {
  const unread = unreadOf(c);
  return MAJOR_ORDER.map((asn) => {
    const n = c.networks.find((x) => x.asn === asn);
    if (n !== undefined) return networkRow(n, late, prefixTrend(c.history.prefixSamples, asn, n.v4Prefixes + n.v6Prefixes, now, c.snapshotAt));
    const u = unread.find((x) => x.asn === asn);
    return u !== undefined ? unreadRow(u) : '';
  }).join('');
}

/** Série interrompue : le dernier échantillon a plus de 9 h (un réseau illisible bloque l'écriture) ; dite, jamais une courbe d'air normal. */
function interruptedNote(c: ConnectivityResponse, now: number): string {
  const last = c.history.samples.map((s) => Date.parse(s.at)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  if (last === undefined) return paragraph('Courbe : historique n.d. (aucun instantané conservé).');
  return now - last > HISTORY_GAP_MS
    ? paragraph(`Série interrompue depuis le ${dayMonth(last)} à ${clock(last)} : dernier instantané conservé de l’historique, la courbe s’arrête là.`)
    : '';
}

/** « moins d’un jour » sous un jour révolu, « N jours » sinon. */
function daysWord(days: number): string {
  return days < 1 ? 'moins d’un jour' : plural(days, 'jour');
}

function historyChart(c: ConnectivityResponse, now: number, late: boolean): string {
  const samples = c.history.samples.filter((s) => Number.isFinite(Date.parse(s.at)) && Number.isFinite(s.minPct));
  const sinceMs = c.history.since === null ? null : Date.parse(c.history.since);
  const days = sinceMs === null || !Number.isFinite(sinceMs) ? 0 : Math.max(0, Math.floor((now - sinceMs) / DAY_MS));
  const building = sinceMs !== null && days < HISTORY_DAYS ? paragraph(`Courbe : référence en construction (${daysWord(days)}).`) : '';
  const stopped = interruptedNote(c, now);
  if (late || samples.length < 2) return stopped + building;
  const points: ChartPoint[] = samples.map((s) => ({ at: Date.parse(s.at), value: s.minPct }));
  const last = samples[samples.length - 1].minPct;
  // Série interrompue (dernier échantillon de plus de 9 h) : donnée périmée, courbe grise comme en retard.
  const stale = now - points[points.length - 1].at > HISTORY_GAP_MS;
  const chart = lineChart(points, {
    label: 'Visibilité minimale des six grands réseaux, par instantané RIPE, sur 30 jours', from: Math.max(points[0].at, now - HISTORY_DAYS * DAY_MS),
    to: now, stroke: stale ? 'var(--text-muted)' : levelColorVar(visibilityPctLevel(last)), value: (v) => formatPctVisibility(v), tick: dayMonth, gapMs: HISTORY_GAP_MS, nowAt: now,
  });
  return chart + stopped + building;
}

/** Courbes des préfixes annoncés par réseau sur 30 jours (sans couleur de niveau) ; repliées. */
function prefixCharts(c: ConnectivityResponse, now: number): string {
  const samples = c.history.prefixSamples ?? [];
  const blocks = c.networks.map((n) => {
    const points: ChartPoint[] = samples.filter((s) => typeof s.prefixes[String(n.asn)] === 'number' && Number.isFinite(Date.parse(s.at)))
      .map((s) => ({ at: Date.parse(s.at), value: s.prefixes[String(n.asn)] }));
    if (points.length < 2) return '';
    const label = `${n.name} (${formatAsn(n.asn)})`;
    const chart = lineChart(points, {
      label: `Préfixes annoncés par ${label}, sur 30 jours`, from: Math.max(Math.min(...points.map((p) => p.at)), now - HISTORY_DAYS * DAY_MS), to: now,
      stroke: PREFIX_COLOR, value: (v) => `${formatCount(v)}${NBSP}préfixes`, tick: dayMonth, gapMs: HISTORY_GAP_MS, nowAt: now,
    });
    return chart === '' ? '' : `${note(label)}${chart}`;
  }).join('');
  return blocks === '' ? '' : `<details class="lp-more"><summary>${escapeHtml('Courbes des préfixes annoncés (30 jours)')}</summary>${blocks}</details>`;
}

/** État de la référence des préfixes : une seule ligne pour les six réseaux. */
function prefixReference(c: ConnectivityResponse, now: number): string {
  const samples = c.history.prefixSamples ?? [];
  const building = c.networks.map((n) => ({ n, t: prefixTrend(samples, n.asn, n.v4Prefixes + n.v6Prefixes, now, c.snapshotAt) }))
    .filter((x): x is { n: NetworkVisibility; t: Extract<PrefixTrend, { kind: 'building' }> } => x.t.kind === 'building');
  if (building.length === 0) return '';
  // Réseaux sans aucun échantillon nommés à part : ils ne ramènent pas la référence des autres à zéro.
  const hasSample = (n: NetworkVisibility): boolean => samples.some((s) => typeof s.prefixes[String(n.asn)] === 'number');
  const withData = building.filter((x) => hasSample(x.n));
  const none = building.filter((x) => !hasSample(x.n)).map((x) => x.n.name);
  const lead = withData.length > 0 ? `référence en construction (${daysWord(Math.min(...withData.map((x) => x.t.days)))})` : 'référence en construction';
  const missing = none.length > 0 ? ` ; sans échantillon : ${none.join(', ')}` : '';
  return paragraph(`Préfixes annoncés : ${lead}${missing} ; la règle de baisse démarre à ${PREFIX_REFERENCE_DAYS} jours d’échantillons.`);
}

/** Section « Visibilité Internet des réseaux » (ouverte, en tête). */
export function reseauxSection(input: ConnectiviteViewInput): FicheSection {
  const { now, open } = input;
  const c = input.connectivity ?? null;
  const connectivityError = input.connectivityError ?? null;
  const base = { id: 'reseaux', title: 'Visibilité Internet des réseaux', collapsible: true, open: open('reseaux', true) };
  if (c === null) {
    return connectivityError !== null
      ? { ...base, summary: 'n.d.', html: sourceDown(`RIPEstat (${connectivityError})`) }
      : { ...base, summary: 'chargement…', html: emptyLine('Chargement de la visibilité des réseaux…') };
  }
  const own = c.errors.filter((e) => e.startsWith('RIPEstat'));
  if (c.snapshotAt === null || c.networks.length === 0) {
    return { ...base, summary: 'n.d.', html: sourceDown(`RIPEstat${own.length > 0 ? ` : ${own.join(' ; ')}` : ''}`) + (unreadOf(c).length > 0 ? networkRows(c, now, true) : '') };
  }
  const late = isSovereigntyDataLate('ripestat', c.snapshotAt, now);
  const full = c.networks.filter((n) => n.visibilityPct >= FULL_VISIBILITY_PCT).length;
  const unreadErrors = new Set(unreadOf(c).map((u) => u.error));
  const extra = own.filter((e) => !unreadErrors.has(e));
  const html = kvRow('Instantané RIPE', escapeHtml(`${clockOf(c.snapshotAt, now)}${late ? ' (en retard)' : ''}`))
    + networkRows(c, now, late)
    + historyChart(c, now, late)
    + (late ? '' : prefixCharts(c, now))
    + prefixReference(c, now)
    + paragraph('Vus par au moins 99 % des routeurs témoins RIPE (RIS) en IPv4 et en IPv6 : un écart d’un ou deux routeurs est habituel. Orange sous 90 %, rouge sous 50 %.')
    + paragraph('Instantanés RIPE RIS de 00 h, 08 h et 16 h UTC : la visibilité n’est jamais suivie en continu ; une perte se voit au plus tôt à l’instantané suivant.')
    + (extra.length > 0 ? paragraph(`Incidents de lecture : ${extra.join(' ; ')}.`) : '');
  const missing = MAJOR_NETWORKS - c.networks.length;
  return {
    ...base,
    summary: escapeHtml(glue(`${full}${NBSP}/${NBSP}${MAJOR_NETWORKS} vus à au moins 99 % · instantané de ${clockOf(c.snapshotAt, now)}${late ? ' (en retard)' : ''}${missing > 0 ? ` · ${unreadWord(missing)}` : ''}`)),
    html,
  };
}

// ─── Section « Points d'échange Internet » ───

/** Section « Points d'échange Internet » (repliée) : annuaire PeeringDB, sans état en direct. */
export function echangesSection(input: ConnectiviteViewInput): FicheSection {
  const { now, open } = input;
  const c = input.connectivity ?? null;
  const connectivityError = input.connectivityError ?? null;
  const base = { id: 'echanges', title: 'Points d’échange Internet', collapsible: true, open: open('echanges', false) };
  if (c === null) {
    return connectivityError !== null
      ? { ...base, summary: 'n.d.', html: sourceDown(`annuaire PeeringDB (${connectivityError})`) }
      : { ...base, summary: 'chargement…', html: emptyLine('Chargement de l’annuaire des points d’échange…') };
  }
  const own = c.errors.filter((e) => e.startsWith('PeeringDB'));
  const x = c.exchanges;
  if (x === null) return { ...base, summary: 'n.d.', html: sourceDown(`annuaire PeeringDB${own.length > 0 ? ` : ${own.join(' ; ')}` : ''}`) };
  const rows = x.items.map((i) => listRow({
    text: i.name,
    noteHtml: `${escapeHtml(i.city ?? 'ville n.d.')} · ${sourceLinkHtml('fiche PeeringDB', i.url)}${i.updated ? escapeHtml(` · mise à jour le ${dateOf(i.updated)}`) : ''}`,
    data: { exchange: String(i.id) },
  })).join('');
  const html = (rows || (own.length > 0 ? sourceDown(`annuaire PeeringDB : ${own.join(' ; ')}`) : emptyLine('Aucun point d’échange publié en France par PeeringDB.')))
    + paragraph('Annuaire, sans état en direct : l’état des points d’échange (France-IX) n’est pas publié en flux ouvert ; les pannes de centres de données et de points d’échange restent dans « Pannes réseau ».')
    + paragraph(`Annuaire lu ${x.readAt ? clockOf(x.readAt, now) : 'n.d.'}, relu une fois par jour.`)
    + (own.length > 0 && rows !== '' ? paragraph(`Incidents de lecture : ${own.join(' ; ')}.`) : '');
  return { ...base, summary: escapeHtml(`${x.items.length} en France (PeeringDB)`), html };
}

/** Sources de la phase B nommées dans « Méthode et sources » (le résumé « N sources » en est déduit, connectivite.ts). */
export const CONNECTIVITE_SOURCES_B: readonly string[] = ['RIPEstat', 'PeeringDB'];

/** Notes de méthode de la phase B (ajoutées à la fin de « Méthode et sources »). */
export function connectiviteMethodB(): string {
  return `<p class="fmk-note">${escapeHtml('Visibilité des réseaux : ')}${sourceLinkHtml('RIPEstat (RIPE NCC), routing-status', RIPESTAT_URL)}`
    + `${escapeHtml(glue(' : routeurs témoins RIS qui voient chacun des six grands réseaux (Orange AS3215, SFR AS15557, Bouygues Telecom AS5410, Free AS12322, RENATER AS2200, OVHcloud AS16276) en IPv4 et en IPv6, préfixes annoncés ; relevé toutes les heures, un instantané toutes les 8 h (00 h, 08 h et 16 h UTC) ; en retard au-delà de 10 h après l’instantané.'))}</p>`
    + `<p class="fmk-note">${escapeHtml('Points d’échange : ')}${sourceLinkHtml('PeeringDB', PEERINGDB_URL)}`
    + `${escapeHtml(' : annuaire public des points d’échange en France (nom, ville, date de mise à jour), sans état en direct.')}</p>`
    + paragraph('Pastille : le plus haut niveau des câbles (navire lent confirmé sur un tracé : orange ; vu une fois : jaune) et des grands réseaux (orange sous 90 % de visibilité, rouge sous 50 %) ; vus par au moins 99 % des routeurs témoins RIPE en IPv4 et en IPv6 ; n.d. seulement si la veille des câbles et RIPEstat manquent tous deux. Un instantané en retard (plus de 10 h) retire les couleurs.')
    + paragraph('Préfixes annoncés : une baisse de 10 % ou plus sous la médiane des instantanés de 30 jours se lit « à vérifier », jamais une panne ni une couleur ; la référence demande 7 jours d’échantillons.')
    + paragraph('Hors score : un instantané toutes les 8 h n’est pas un signal de crise.');
}

// ─── Assemblage ───

/** Pastille au plus haut des câbles et des réseaux ; gros chiffre des grands réseaux. */
function headWithNetworks(head: LayerHeadModel, input: ConnectiviteViewInput): LayerHeadModel {
  const { watch, now } = input;
  const c = input.connectivity ?? null;
  const error = input.connectivityError ?? null;
  const figure = networksFigure(c, error, now);
  // RIPEstat pas encore chargé : la pastille et la raison restent celles de la phase A (jamais « indisponible » pour ce qui charge).
  if (c === null && error === null) return { ...head, figure };
  const first = head.status[0] ?? '';
  const suspended = first === AIS_SUSPENDED;
  const verdict = connectivityLevel(suspended ? null : watch, c, now);
  let reason = glue(verdict.reason);
  if (suspended) reason = reason.replace('veille des câbles indisponible', 'relevé AIS en retard (niveau des câbles suspendu)');
  else if (watch !== null) {
    const cablesReason = glue(cablesLevel(watch, now).reason);
    if (first !== '' && first !== cablesReason) reason = reason.split(cablesReason).join(first);
  }
  if (c !== null && c.snapshotAt !== null && isSovereigntyDataLate('ripestat', c.snapshotAt, now)) {
    reason = reason.replace(LATE_RIPE, `${LATE_RIPE} (${clockOf(c.snapshotAt, now)})`);
  }
  return { ...head, level: verdict.level, status: [reason, ...head.status.slice(1)], figure };
}

/** Vue complète : grands réseaux en tête, navires lents dans leur section, points d'échange, méthode, pastille de la phase B. */
export function withConnectiviteB(view: LayerView, input: ConnectiviteViewInput): LayerView {
  if (view.sections.length === 0) return view;   // vue en chargement (phase A) : rien à ajouter
  const sections = [...view.sections];
  const old = view.head.figure ?? null;
  if (old) {
    // R3 : sans niveau propre, le chiffre garde la couleur de la pastille de la phase A (« nd » : sans couleur).
    const level = old.level !== undefined ? old.level : view.head.level && view.head.level !== 'nd' ? view.head.level : null;
    const block = kvRow('Navires lents sur un tracé', valueHtml(old.value, level)) + note(old.caption);
    const at = sections.findIndex((s) => s.id === 'navires');
    const target = at >= 0 ? at : sections.findIndex((s) => s.id === 'cables');
    if (target >= 0) sections[target] = { ...sections[target], html: block + sections[target].html };
  }
  sections.unshift(reseauxSection(input));
  const methodAt = sections.findIndex((s) => s.id === 'methode');
  sections.splice(methodAt >= 0 ? methodAt : sections.length, 0, echangesSection(input));
  const method = sections.findIndex((s) => s.id === 'methode');
  if (method >= 0) sections[method] = { ...sections[method], html: sections[method].html + connectiviteMethodB() };
  return { ...view, head: headWithNetworks(view.head, input), sections };
}
