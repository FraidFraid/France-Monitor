// src/components/layer-panel/outages-internet.ts : vue pure du panneau Internet (spec 2026-10-08 panneaux pannes § 2.3) ; aucun accès réseau
// ni DOM. Lieux en anomalie en ce moment (IODA et Cloudflare Radar, chacun compté une fois : internetLive) en gros chiffre ; événement IODA
// ouvert depuis plus de 7 jours nommé à part (probable recalage, hors gros chiffre et pastille) ; terminés des 7 derniers jours ; Radar ;
// départements touchés sur 30 jours ; rappel RIPEstat ; courbe de 30 jours.
// IODA en retard (lecture + 60 min) : « (en retard) », plus aucune couleur de niveau. Radar en retard ou sans jeton : jamais compté.
import type { InternetEvent, InternetOutagesResponse, RadarItem } from '../../types/index.ts';
import { parisDayOf } from '../../services/environment-levels.ts';
import { INTERNET_PENDING_NOTE } from '../../services/outages-internet.ts';
import { internetLevel, internetLive, internetPlaceLevel, internetSignalWord, isOutagesDataLate, radarPlace, type InternetLivePlace } from '../../services/outages-levels.ts';
import { isSovereigntyDataLate, visibilityPctLevel } from '../../services/sovereignty-levels.ts';
import { isNamedBy } from '../../services/sovereignty-source.ts';
import { levelColorVar, type VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { stackedDayBars, type DayStack } from './chart.ts';
import { NBSP, formatPct, frNumber } from './format.ts';
import { emptyLine, listRow, loadingBody, sourceErrorCallout, sourceLinkHtml, valueHtml, type LayerView } from './frame.ts';
import { OUTAGES_THEME, OUT_LATE_VAR, countText, dayMonth, formatDuration, moreNote, note, parisClock, placeOf, sinceText, when } from './outages-format.ts';

export const INTERNET_TITLE = 'Internet';
export const INTERNET_RECENT_ROWS = 30;
export const INTERNET_DEPT_ROWS = 12;
const FIGURE_CAPTION = 'anomalies Internet en cours en France';
const IODA_URL = 'https://ioda.inetintel.cc.gatech.edu';
const RADAR_URL = 'https://radar.cloudflare.com';
const RIPE_URL = 'https://stat.ripe.net';
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const CURVE_DAYS = 30;
const STALE_NOTE = `ouvert depuis plus de 7${NBSP}jours, probablement un recalage de référence`;
/** Niveau d'un événement IODA terminé, par sa portée (les lieux en cours lisent internetPlaceLevel). */
const SCOPE_LEVEL: Readonly<Record<InternetLivePlace['scope'], VigilanceLevel>> = { national: 'rouge', operateur: 'orange', departement: 'jaune', inconnu: 'orange' };

type OpenFn = (sectionId: string, byDefault: boolean) => boolean;
/** `canFocus` : lignes de département cliquables (recentrage de la carte) ; `canOpenConnectivity` : bouton du panneau Connectivité. Deux capacités indépendantes. */
export interface InternetViewInput { internet: InternetOutagesResponse | null; error: string | null; canFocus: boolean; canOpenConnectivity: boolean; now: number; open: OpenFn }

/** Ce que chaque source peut dire : IODA en retard (plus de couleur de niveau), Radar en retard (configuré mais lu trop tôt). */
interface Freshness { iodaLate: boolean; radarLate: boolean }

/** Puce d'une ligne : niveau de sa portée, ou puce grise quand IODA est en retard. */
function marker(level: VigilanceLevel, f: Freshness): { level: VigilanceLevel | 'gris' } {
  return { level: f.iodaLate ? 'gris' : level };
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}
function earliest(starts: readonly string[]): string | null {
  const times = starts.map((s) => Date.parse(s)).filter(Number.isFinite);
  return times.length === 0 ? null : new Date(Math.min(...times)).toISOString();
}

/** Événements IODA en cours qui disent ce lieu (un par source de signal). */
function eventsOf(p: InternetLivePlace, events: readonly InternetEvent[]): InternetEvent[] {
  return events.filter((e) => e.ongoing && !e.staleOpen && e.scope === p.scope && e.dept === p.dept && e.asn === p.asn);
}
function radarItemOf(p: InternetLivePlace, items: readonly RadarItem[]): RadarItem | undefined {
  return items.find((i) => i.end === null && i.kind === p.radarKind && radarPlace(i).key === p.key);
}

function liveRow(p: InternetLivePlace, r: InternetOutagesResponse, input: InternetViewInput, f: Freshness): string {
  const label = p.scope === 'departement' ? placeOf(p.dept) : p.label;
  const events = p.source === 'ioda' ? eventsOf(p, r.events) : [];
  const item = p.source === 'radar' ? radarItemOf(p, r.radar.items) : undefined;
  const start = events.length > 0 ? earliest(events.map((e) => e.start)) : item?.start ?? null;
  const detail = events.length > 0 ? unique(events.map((e) => internetSignalWord(e.signal))).join(' · ') : item?.kind === 'panne' ? 'panne signalée' : 'anomalie de trafic';
  return listRow({
    text: label, value: sinceText(start, input.now), ...marker(internetPlaceLevel(p), f),
    note: `${detail} · ${p.source === 'ioda' ? 'IODA' : 'Cloudflare Radar'}`,
    ...(input.canFocus && p.dept !== null ? { data: { dept: p.dept }, link: true } : {}),
  });
}

/** Événements « en cours » écartés du compte : ouverts depuis plus de 7 jours (recalage probable) ou d'une région IODA sans département. */
function setAsideRows(r: InternetOutagesResponse, now: number): string {
  const groups = new Map<string, { label: string; reason: string; events: InternetEvent[] }>();
  for (const e of r.events) {
    if (!e.ongoing || !(e.staleOpen || e.scope === 'inconnu')) continue;
    const reason = e.staleOpen ? STALE_NOTE : 'région non identifiée, non comptée';
    const key = `${e.label}|${reason}`;
    const g = groups.get(key) ?? { label: e.label, reason, events: [] };
    g.events.push(e);
    groups.set(key, g);
  }
  return [...groups.values()].map((g) => listRow({
    text: g.label, value: sinceText(earliest(g.events.map((e) => e.start)), now), level: 'gris',
    note: `${unique(g.events.map((e) => internetSignalWord(e.signal))).join(' · ')} · ${g.reason}`,
  })).join('');
}

function recentRows(r: InternetOutagesResponse, f: Freshness, readAt: number): { rows: string; total: number } {
  const done = r.events
    .filter((e) => !e.ongoing && e.end !== null && readAt - Date.parse(e.end) <= WEEK_MS)
    .sort((a, b) => (b.end ?? '').localeCompare(a.end ?? ''));
  const rows = done.slice(0, INTERNET_RECENT_ROWS).map((e) => listRow({
    text: e.scope === 'departement' ? placeOf(e.dept) : e.label, value: formatDuration(e.durationSec), ...marker(SCOPE_LEVEL[e.scope], f),
    note: `${internetSignalWord(e.signal)} · le ${when(e.start)}`,
  })).join('') + moreNote(done.length, INTERNET_RECENT_ROWS);
  return { rows, total: done.length };
}

function radarSection(r: InternetOutagesResponse, f: Freshness, now: number): string {
  if (!r.radar.configured) return emptyLine('Cloudflare Radar non configuré : jeton absent sur le serveur.');
  // E3 : l'erreur de lecture Radar est nommée dans sa section (« Cloudflare Radar : HTTP 400 »), pas seulement sous la pastille.
  const errors = r.errors.filter((e) => isNamedBy(e, 'Cloudflare Radar'));
  if (r.radar.readAt === null) {
    return errors.length > 0 ? emptyLine(`${errors.join(' ; ')} : anomalies n.d.`) : emptyLine('Cloudflare Radar : lecture n.d.');
  }
  const stamp = (f.radarLate ? note(`Cloudflare Radar lu à ${parisClock(Date.parse(r.radar.readAt))} (en retard) : anomalies non comptées.`) : '')
    + errors.map(note).join('');
  const rows = r.radar.items.map((i) => {
    const kind = i.kind === 'anomalie' ? 'anomalie de trafic' : 'panne signalée';
    const cause = [i.cause, i.outageType].filter((x): x is string => x !== null && x.length > 0).join(' · ');
    const verified = i.verified === null ? null : i.verified ? 'vérifiée' : 'non vérifiée';
    const span = i.end === null ? `depuis le ${when(i.start)}, en cours` : `du ${when(i.start)} au ${when(i.end)}`;
    return listRow({
      text: i.label, value: i.end === null ? sinceText(i.start, now) : 'terminée', level: f.radarLate || i.end !== null ? 'gris' : internetPlaceLevel(radarPlace(i)),
      note: [kind, cause, verified, span].filter((x): x is string => x !== null && x.length > 0).join(' · '),
    });
  }).join('');
  return stamp + (rows || emptyLine('Aucune anomalie ni panne dans les données de Cloudflare Radar sur la période.'));
}

function departmentRows(r: InternetOutagesResponse, input: InternetViewInput, f: Freshness): string {
  const counts = new Map<string, number>();
  let unknown = 0;
  for (const e of r.events) {
    if (e.scope === 'inconnu') unknown += 1;
    else if (e.scope === 'departement' && e.dept !== null) counts.set(e.dept, (counts.get(e.dept) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const rows = sorted.slice(0, INTERNET_DEPT_ROWS).map(([dept, n]) => listRow({
    text: placeOf(dept), value: countText(n, 'événement', 'événements'), ...marker('jaune', f),
    ...(input.canFocus ? { data: { dept }, link: true } : {}),
  })).join('') + moreNote(sorted.length, INTERNET_DEPT_ROWS);
  const other = unknown > 0 ? listRow({ text: 'région non identifiée', value: countText(unknown, 'événement', 'événements'), level: 'gris' }) : '';
  return rows + other;
}

function bgpSection(r: InternetOutagesResponse, input: InternetViewInput): string {
  const ripe = r.ripe;
  if (ripe === null || ripe.networks.length === 0) return emptyLine('RIPEstat : visibilité n.d.');
  const late = isSovereigntyDataLate('ripestat', ripe.snapshotAt, input.now);
  const rows = ripe.networks.map((n) => kvRow(n.name, valueHtml(formatPct(n.visibilityPct, 0), late ? null : visibilityPctLevel(n.visibilityPct)))).join('');
  const stamp = ripe.snapshotAt === null ? 'instantané n.d.' : `instantané de ${parisClock(Date.parse(ripe.snapshotAt))}`;
  return rows + note(`${stamp}${late ? ' (en retard)' : ''}`)
    + (input.canOpenConnectivity ? '<button type="button" class="fmk-link" data-open-connectivity="1">Voir le panneau Connectivité</button>' : '');
}

function curveSection(r: InternetOutagesResponse, f: Freshness, readAt: number): string {
  const days: string[] = [parisDayOf(readAt)];
  while (days.length < CURVE_DAYS) days.unshift(parisDayOf(Date.parse(`${days[0]}T12:00:00Z`) - DAY_MS));
  const color = (level: VigilanceLevel): string => (f.iodaLate ? OUT_LATE_VAR : levelColorVar(level));
  const stacks: DayStack[] = days.map((day) => {
    const of = (scope: InternetEvent['scope']): number => r.events.filter((e) => e.scope === scope && parisDayOf(Date.parse(e.start)) === day).length;
    return {
      day: Date.parse(`${day}T12:00:00Z`),
      parts: [
        { value: of('departement'), color: color('jaune'), label: 'départements' },
        { value: of('operateur'), color: color('orange'), label: 'opérateurs' },
        { value: of('national'), color: color('rouge'), label: 'France' },
      ],
    };
  });
  return stackedDayBars(stacks, {
    label: 'Événements IODA par jour, 30 jours', value: (v) => frNumber(v, 0), tick: (ms) => dayMonth(new Date(ms).toISOString().slice(0, 10)),
    emptyNote: 'aucun événement IODA sur la période',
  });
}

function methodSection(): string {
  return note('IODA voit les coupures assez larges pour changer ses signaux : une absence d’événement n’est pas une absence de panne.')
    + note('Un lieu est compté une fois, même si plusieurs signaux (BGP, sonde ping, télescope réseau) ou plusieurs sources le voient.')
    + note(`Un événement IODA ouvert depuis plus de 7${NBSP}jours est écarté du compte et de la pastille : c’est probablement un recalage de référence.`)
    + note('Cloudflare Radar demande un jeton gratuit posé sur le serveur ; sans lui, la source est « non configurée » et ne compte pour rien.')
    + note(`La visibilité des grands réseaux (RIPEstat) est reprise du panneau Connectivité : instantanés de 00${NBSP}h, 08${NBSP}h et 16${NBSP}h UTC.`)
    + `<p class="fmk-note">${sourceLinkHtml('IODA (Georgia Tech)', IODA_URL)} · ${sourceLinkHtml('Cloudflare Radar', RADAR_URL)} · ${sourceLinkHtml('RIPEstat', RIPE_URL)}</p>`;
}

function sections(r: InternetOutagesResponse, input: InternetViewInput, f: Freshness, readAt: number): FicheSection[] {
  const { now, open } = input;
  const live = internetLive(r, now);
  const lines = live.map((p) => liveRow(p, r, input, f)).join('');
  const none = f.iodaLate
    ? emptyLine('Anomalies en cours n.d. : lecture IODA en retard.')
    : emptyLine('Aucune anomalie en cours vue par IODA ni Cloudflare Radar.') + note('Une absence d’anomalie n’est pas une absence de panne.');
  const recent = recentRows(r, f, readAt);
  return [
    { id: 'encours', title: 'Anomalies en cours', collapsible: true, open: open('encours', true), summary: escapeHtml(f.iodaLate ? 'n.d.' : frNumber(live.length, 0)), html: (lines || none) + setAsideRows(r, now) },
    {
      id: 'recents', title: 'Terminées, 7 derniers jours', collapsible: true, open: open('recents', true), summary: escapeHtml(frNumber(recent.total, 0)),
      html: recent.rows || emptyLine('Aucun événement IODA terminé sur les 7 derniers jours.'),
    },
    { id: 'radar', title: 'Cloudflare Radar', collapsible: true, open: open('radar', true), html: radarSection(r, f, now) },
    {
      id: 'departements', title: 'Départements touchés, 30 jours', collapsible: true, open: open('departements', true),
      html: departmentRows(r, input, f) || emptyLine('Aucun département touché sur les 30 jours.'),
    },
    { id: 'bgp', title: 'Visibilité des grands réseaux (RIPEstat)', collapsible: true, open: open('bgp', true), html: bgpSection(r, input) },
    { id: 'courbe', title: 'Événements par jour, 30 jours', collapsible: true, open: open('courbe', true), html: curveSection(r, f, readAt) },
    { id: 'methode', title: 'Méthode et sources', collapsible: true, open: open('methode', false), html: methodSection() },
  ];
}

export function buildInternetView(input: InternetViewInput): LayerView {
  const { internet: r, error, now } = input;
  if (r === null && error === null) {
    return { head: { theme: OUTAGES_THEME, title: INTERNET_TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  }
  if (r === null || r.iodaReadAt === null) {
    const reasons = [error, ...(r?.errors ?? [])].filter((x): x is string => x !== null && x.length > 0);
    const named = reasons.filter((x) => x !== INTERNET_PENDING_NOTE);
    // Première collecte pas finie : un avancement, pas une panne (aucun encadré « Source injoignable »).
    const pending = named.length === 0 && reasons.length > 0;
    return {
      head: {
        theme: OUTAGES_THEME, title: INTERNET_TITLE, level: 'nd', figure: { value: 'n.d.', caption: FIGURE_CAPTION, level: null },
        status: [pending ? 'IODA : collecte en cours' : 'IODA injoignable'],
      },
      sections: [], bodyHtml: (pending ? '' : sourceErrorCallout(null, now)) + (pending ? reasons : named).map(note).join(''),
    };
  }
  const iodaReadAt = Date.parse(r.iodaReadAt);
  const f: Freshness = { iodaLate: isOutagesDataLate('ioda', r.iodaReadAt, now), radarLate: r.radar.configured && isOutagesDataLate('radar', r.radar.readAt, now) };
  const live = internetLive(r, now);
  const level = f.iodaLate ? 'nd' : internetLevel(r, now) ?? 'nd';
  // IODA en retard : « en cours » ne se dit plus au présent, le gros chiffre est « n.d. » (jamais un compte, 0 compris).
  const figure = f.iodaLate ? { value: 'n.d.', caption: FIGURE_CAPTION, level: null } : { value: frNumber(live.length, 0), caption: FIGURE_CAPTION };
  const radar = !r.radar.configured ? 'Cloudflare Radar non configuré'
    : r.radar.readAt === null ? 'Cloudflare Radar n.d.'
    : `Cloudflare Radar lu à ${parisClock(Date.parse(r.radar.readAt))}${f.radarLate ? ' (en retard)' : ''}`;
  const status = [`IODA lu à ${parisClock(iodaReadAt)}${f.iodaLate ? ' (en retard)' : ''}`, radar];
  // Erreurs nommées : celle de la lecture client (encadré daté), puis celles du serveur (hors avancement de la collecte).
  const body = (error !== null ? sourceErrorCallout(iodaReadAt, now) : '') + r.errors.filter((e) => e !== INTERNET_PENDING_NOTE).map(note).join('');
  return {
    head: { theme: OUTAGES_THEME, title: INTERNET_TITLE, figure, level, status },
    sections: sections(r, input, f, iodaReadAt),
    ...(body !== '' ? { bodyHtml: body } : {}),
  };
}
