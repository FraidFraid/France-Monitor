// src/components/layer-panel/manifestations.ts : vue pure du panneau Manifestations (spec 2026-10-17 manifestations) ; aucun accès réseau
// ni DOM. Deux natures jamais mêlées : le signal de la presse mondiale (GDELT, 24 h) et l'agenda militant (Démosphère), qui n'annonce
// que des rendez-vous, jamais des manifestations constatées. Aucun effet sur l'indice de stabilité. Textes tiers échappés.
import type { ProtestItem, ProtestsResponse } from '../../types/index.ts';
import { isProtestsLate } from '../../services/protests.ts';
import { parisDayOf } from '../../services/environment-levels.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { emptyLine, listRow, loadingBody, sourceErrorCallout, sourceLinkHtml, type LayerView } from './frame.ts';
import { NBSP } from './format.ts';
import { note, plural, readErrors, stamp } from './traffic-format.ts';
import { protestPlaceKey } from '../deckgl/protests-map.ts';

export const MANIFESTATIONS_THEME = 'Sécurité et défense';
export const MANIFESTATIONS_TITLE = 'Manifestations';
type OpenFn = (sectionId: string, byDefault: boolean) => boolean;

export interface ManifestationsViewInput {
  data: ProtestsResponse | null; error: string | null; canFocus: boolean; now: number; open: OpenFn;
}

const PARIS = 'Europe/Paris';
const DEMOSPHERE_URL = 'https://demosphere.net/';
const GDELT_URL = 'https://www.gdeltproject.org/';
const NO_PLACE = 'France, sans lieu précis';

const dayOfIso = (iso: string | null): string | null => {
  const ms = iso === null ? Number.NaN : Date.parse(iso);
  return Number.isFinite(ms) ? parisDayOf(ms) : null;
};

/** « 14:30 », heure de Paris ; null si la date est illisible. */
export function parisClock(iso: string | null): string | null {
  const ms = iso === null ? Number.NaN : Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms).toLocaleTimeString('fr-FR', { timeZone: PARIS, hour: '2-digit', minute: '2-digit' }) : null;
}

/** « samedi 18 octobre » pour un jour « AAAA-MM-JJ » (calendrier, sans fuseau). */
export function longDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

export interface ProtestBuckets {
  signaled: ProtestItem[];
  today: ProtestItem[];
  /** Jours à venir (ordre croissant) et leurs annonces. */
  upcoming: Array<{ day: string; items: ProtestItem[] }>;
  /** Annonces sans lieu précis (jamais placées sur la carte). */
  unplaced: ProtestItem[];
}

/** Répartition des items : annonces d'un jour passé encore en cours (moins de 6 h) rangées avec « aujourd'hui ». */
export function bucketProtests(items: readonly ProtestItem[], now: number): ProtestBuckets {
  const todayKey = parisDayOf(now);
  const out: ProtestBuckets = { signaled: [], today: [], upcoming: [], unplaced: [] };
  const byDay = new Map<string, ProtestItem[]>();
  for (const x of items) {
    if (x.status === 'signale') { out.signaled.push(x); continue; }
    if (x.lat === null || x.lon === null) { out.unplaced.push(x); continue; }
    const day = dayOfIso(x.startsAt);
    if (day === null || day <= todayKey) { out.today.push(x); continue; }
    byDay.set(day, [...(byDay.get(day) ?? []), x]);
  }
  out.upcoming = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, list]) => ({ day, items: list }));
  return out;
}

/** Chiffre de la pastille : annonces du jour (lieu connu ou non) et signalés. */
export function protestsTodayCount(items: readonly ProtestItem[], now: number): number {
  const todayKey = parisDayOf(now);
  return items.filter((x) => {
    if (x.status === 'signale') return true;
    const day = dayOfIso(x.startsAt);
    return day === null || day <= todayKey;
  }).length;
}

/** Niveau de la pastille : orange si des heurts sont signalés, jaune si la presse signale, vert sinon ; n.d. sans relevé lisible. */
export function protestsHeadLevel(data: ProtestsResponse | null, now: number): VigilanceLevel | 'nd' {
  if (data === null || data.readAt === null || isProtestsLate(data.readAt, now)) return 'nd';
  const signaled = data.items.filter((x) => x.status === 'signale');
  if (signaled.some((x) => x.violent)) return 'orange';
  return signaled.length > 0 ? 'jaune' : 'vert';
}

const placeOf = (x: ProtestItem): string => {
  if (x.city === null || x.city === '') return NO_PLACE;
  return x.dept ? `${x.city} · ${x.dept}` : x.city;
};

function articleLinks(x: ProtestItem): string {
  return x.articles.map((a) => {
    const clock = parisClock(a.seenAt);
    const label = `${a.domain}${clock ? ` ${clock}` : ''}${a.violent ? ' (heurts)' : ''}`;
    return sourceLinkHtml(label.replace(' ', NBSP), a.url);
  }).join(' · ');
}

function signaledRow(x: ProtestItem, canFocus: boolean): string {
  const place = x.city && x.city !== '' ? x.city : NO_PLACE;
  const key = protestPlaceKey(x);
  const badge = x.violent ? '<span class="lp-badge">heurts</span>' : null;
  return listRow({
    text: place, valueHtml: badge, level: x.violent ? 'rouge' : 'orange',
    noteHtml: `${escapeHtml(x.title)}${x.articles.length > 0 ? ` · ${articleLinks(x)}` : ''}`,
    data: key !== null ? { protest: key } : undefined, link: canFocus && key !== null,
  });
}

function announcedRow(x: ProtestItem, canFocus: boolean): string {
  const clock = x.allDay ? null : parisClock(x.startsAt);
  const when = clock ?? 'journée';
  const key = protestPlaceKey(x);
  const link = x.url ? ` · ${sourceLinkHtml('Fiche Démosphère', x.url)}` : '';
  return listRow({
    text: x.title, value: when, color: '#ec4899',
    noteHtml: `annoncé, non confirmé${x.edition ? ` · édition ${escapeHtml(x.edition)}` : ''}${link}`,
    data: key !== null ? { protest: key } : undefined, link: canFocus && key !== null,
  });
}

/** Annonces d'une même commune sous un sous-titre « Ville · dép. ». */
function groupedByCity(items: readonly ProtestItem[], canFocus: boolean): string {
  const groups = new Map<string, ProtestItem[]>();
  for (const x of items) groups.set(placeOf(x), [...(groups.get(placeOf(x)) ?? []), x]);
  return [...groups.entries()].map(([place, list]) => `<p class="lp-subhead">${escapeHtml(place)}</p>${list.map((x) => announcedRow(x, canFocus)).join('')}`).join('');
}

function pressSection(b: ProtestBuckets, canFocus: boolean, open: OpenFn): FicheSection {
  const html = b.signaled.length === 0 ? emptyLine('Aucune manifestation signalée par la presse mondiale ces 24 heures.')
    : b.signaled.map((x) => signaledRow(x, canFocus)).join('');
  return { id: 'presse', title: 'Signalé par la presse (24 h)', collapsible: true, open: open('presse', true), summary: plural(b.signaled.length, 'signalement'), html };
}

function todaySection(b: ProtestBuckets, canFocus: boolean, open: OpenFn): FicheSection {
  const html = b.today.length === 0 ? emptyLine('Aucun rendez-vous annoncé aujourd’hui.') : groupedByCity(b.today, canFocus);
  return { id: 'aujourdhui', title: 'Aujourd’hui', collapsible: true, open: open('aujourdhui', true), summary: `${plural(b.today.length, 'annonce')}`, html };
}

function upcomingSection(b: ProtestBuckets, canFocus: boolean, open: OpenFn): FicheSection {
  const total = b.upcoming.reduce((n, d) => n + d.items.length, 0);
  const html = total === 0 ? emptyLine(`Aucun rendez-vous annoncé dans les 7${NBSP}prochains jours.`)
    : b.upcoming.map((d) => `<p class="lp-subhead">${escapeHtml(longDay(d.day))}</p>${d.items.map((x) => {
      const place = placeOf(x);
      return announcedRow({ ...x, title: `${x.title} · ${place}` }, canFocus);
    }).join('')}`).join('');
  return { id: 'prochains', title: 'Prochains jours', collapsible: true, open: open('prochains', false), summary: plural(total, 'annonce'), html };
}

function unplacedSection(b: ProtestBuckets, open: OpenFn): FicheSection {
  const html = b.unplaced.length === 0 ? emptyLine('Aucune annonce sans lieu précis.') : b.unplaced.map((x) => announcedRow(x, false)).join('');
  return { id: 'sans-lieu', title: 'Sans lieu précis', collapsible: true, open: open('sans-lieu', false), summary: plural(b.unplaced.length, 'annonce'), html };
}

function methodSection(d: ProtestsResponse, now: number, open: OpenFn): FicheSection {
  const demoLate = isProtestsLate(d.demosphere.readAt, now);
  const gdeltLate = isProtestsLate(d.gdelt.readAt, now);
  const demoState = d.demosphere.readAt === null ? 'injoignable' : stamp('relevé', d.demosphere.readAt, demoLate, now);
  const gdeltState = d.gdelt.readAt === null ? 'injoignable' : stamp('relevé', d.gdelt.readAt, gdeltLate, now);
  const failed = d.demosphere.failedEditions.length > 0 ? note(`Éditions Démosphère illisibles : ${d.demosphere.failedEditions.join(', ')}.`) : '';
  const html = kvRow('Démosphère', `${sourceLinkHtml('Démosphère', DEMOSPHERE_URL)} · ${escapeHtml(demoState)}`)
    + note(`Annonces : agenda militant Démosphère, ${d.demosphere.editions}${NBSP}éditions locales lues, couverture inégale selon les villes, Paris presque vide. Filtre sur le titre. Un rendez-vous annoncé n’est pas une manifestation constatée.`)
    + failed
    + kvRow('GDELT', `${sourceLinkHtml('GDELT', GDELT_URL)} · ${escapeHtml(gdeltState)}`)
    + note(`Presse : GDELT (presse mondiale), mise à jour toutes les 15${NBSP}min ; le lieu n’est que rarement plus précis que la ville, souvent absent.`)
    + note('Cette couche n’a aucun effet sur l’indice de stabilité, les situations ni la synthèse.')
    + readErrors(d.errors);
  return { id: 'methode', title: 'Méthode et sources', collapsible: true, open: open('methode', false), tone: 'reference', summary: 'Démosphère · GDELT', html };
}

export function buildManifestationsView(input: ManifestationsViewInput): LayerView {
  const { data, error, canFocus, now, open } = input;
  if (data === null && error === null) {
    return { head: { theme: MANIFESTATIONS_THEME, title: MANIFESTATIONS_TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  }
  if (data === null || data.readAt === null) {
    return {
      head: {
        theme: MANIFESTATIONS_THEME, title: MANIFESTATIONS_TITLE, level: 'nd',
        figure: { value: 'n.d.', caption: 'aujourd’hui', level: null }, status: ['sources injoignables'],
      },
      sections: data === null ? [] : [methodSection(data, now, open)],
      bodyHtml: sourceErrorCallout(null, now),
    };
  }
  const b = bucketProtests(data.items, now);
  const level = protestsHeadLevel(data, now);
  const late = isProtestsLate(data.readAt, now);
  const readMs = Date.parse(data.readAt);
  return {
    head: {
      theme: MANIFESTATIONS_THEME, title: MANIFESTATIONS_TITLE, level,
      figure: { value: String(protestsTodayCount(data.items, now)), caption: 'aujourd’hui', level: level === 'nd' ? null : level },
      status: [stamp('relevé', data.readAt, late, now)],
    },
    sections: [pressSection(b, canFocus, open), todaySection(b, canFocus, open), upcomingSection(b, canFocus, open), unplacedSection(b, open), methodSection(data, now, open)],
    bodyHtml: error !== null ? sourceErrorCallout(Number.isFinite(readMs) ? readMs : null, now) : undefined,
  };
}
