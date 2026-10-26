// src/components/layer-panel/manifestations.ts : vue pure du panneau Manifestations (spec 2026-10-17 manifestations) ; aucun accès réseau
// ni DOM. Natures jamais mêlées : ce que la presse a rapporté (presse française ingérée, ville par ville, et presse mondiale GDELT, 24 h)
// et l'agenda militant (Démosphère), qui n'annonce que des rendez-vous, jamais des manifestations constatées. Aucun effet sur l'indice de stabilité. Textes tiers échappés.
import type { FluxEvent, ProtestItem, ProtestsResponse } from '../../types/index.ts';
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
  /** Prévisions Flux piétons par identifiant de rendez-vous (fluxForecastsByProtest) : affluence estimée, clic = rues et rejeu. */
  forecasts?: ReadonlyMap<string, FluxEvent>;
  /** Annonces de la carte des gilets jaunes affichées (case du panneau, 26/10/2026) ; absent : affichées. */
  showGiletsJaunes?: boolean;
}

const PARIS = 'Europe/Paris';
const DEMOSPHERE_URL = 'https://demosphere.net/';
const GILETS_JAUNES_URL = 'https://www.17octobregiletjaune.net/carte/';
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
  /** Signalés par la presse française (le plus d'articles d'abord). */
  press: ProtestItem[];
  /** Signalés par GDELT seulement. */
  world: ProtestItem[];
  today: ProtestItem[];
  /** Jours à venir (ordre croissant) et leurs annonces. */
  upcoming: Array<{ day: string; items: ProtestItem[] }>;
  /** Annonces sans lieu précis (jamais placées sur la carte). */
  unplaced: ProtestItem[];
}

/** Répartition des items : annonces d'un jour passé encore en cours (moins de 6 h) rangées avec « aujourd'hui ». */
export function bucketProtests(items: readonly ProtestItem[], now: number): ProtestBuckets {
  const todayKey = parisDayOf(now);
  const out: ProtestBuckets = { signaled: [], press: [], world: [], today: [], upcoming: [], unplaced: [] };
  const byDay = new Map<string, ProtestItem[]>();
  for (const x of items) {
    if (x.status === 'signale') {
      out.signaled.push(x);
      (x.source === 'presse' ? out.press : out.world).push(x);
      continue;
    }
    if (x.lat === null || x.lon === null) { out.unplaced.push(x); continue; }
    const day = dayOfIso(x.startsAt);
    if (day === null || day <= todayKey) { out.today.push(x); continue; }
    byDay.set(day, [...(byDay.get(day) ?? []), x]);
  }
  out.press.sort((a, b) => b.articleCount - a.articleCount || Date.parse(b.startsAt ?? '') - Date.parse(a.startsAt ?? ''));
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

// Prévisions du rendu en cours (posées en tête de buildManifestationsView, lues par les lignes d'annonce).
let FORECASTS: ReadonlyMap<string, FluxEvent> = new Map();

/** « Foule estimée ≈ 800 personnes · rues et rejeu » : ouvre la prévision Flux piétons du rendez-vous. */
function forecastLine(x: ProtestItem): string {
  const ev = FORECASTS.get(x.id);
  if (!ev) return '';
  const n = Math.round(ev.affluence.p50).toLocaleString('fr-FR').replace(/\s/g, NBSP);
  return `<br><span class="lp-link" role="button" tabindex="0" data-flux-event="${escapeHtml(ev.id)}">Foule estimée ≈${NBSP}${n}${NBSP}personnes · rues et rejeu</span>`;
}

function announcedRow(x: ProtestItem, canFocus: boolean): string {
  const clock = x.allDay ? null : parisClock(x.startsAt);
  const when = clock ?? 'journée';
  const key = protestPlaceKey(x);
  const link = x.url ? ` · ${sourceLinkHtml(x.source === 'presse' ? 'Article' : x.source === 'prefecture' ? 'Recueil officiel' : x.source === 'giletsjaunes' ? 'Carte des gilets jaunes' : 'Fiche Démosphère', x.url)}` : '';
  const from = x.source === 'presse' ? ` · presse${x.articles[0]?.outlet ? ` (${escapeHtml(x.articles[0].outlet)})` : ''}`
    : x.source === 'prefecture' ? ` · ${escapeHtml(x.edition ?? 'préfecture')}${x.arrete?.hours ? `, ${escapeHtml(x.arrete.hours.join(' à '))}` : ''}`
      : x.source === 'giletsjaunes' ? ` · carte des gilets jaunes${x.place ? `, ${escapeHtml(x.place)}` : ''}`
      : x.edition ? ` · édition ${escapeHtml(x.edition)}` : '';
  return listRow({
    text: x.title, value: when, color: x.source === 'giletsjaunes' ? '#f2e600' : '#ec4899',
    noteHtml: `annoncé, non confirmé${from}${link}${forecastLine(x)}`,
    data: key !== null ? { protest: key } : undefined, link: canFocus && key !== null,
  });
}

/** Annonces d'une même commune sous un sous-titre « Ville · dép. ». */
function groupedByCity(items: readonly ProtestItem[], canFocus: boolean): string {
  const groups = new Map<string, ProtestItem[]>();
  for (const x of items) groups.set(placeOf(x), [...(groups.get(placeOf(x)) ?? []), x]);
  return [...groups.entries()].map(([place, list]) => `<p class="lp-subhead">${escapeHtml(place)}</p>${list.map((x) => announcedRow(x, canFocus)).join('')}`).join('');
}

const TITLE_MAX = 110;
const clip = (t: string): string => (t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX - 1).trimEnd()}…` : t);

/** « 800 pers. » sans coupure entre nombre et unité. */
export function participantsLabel(n: number | null): string | null {
  return n === null ? null : `${n.toLocaleString('fr-FR').replace(/\s/g, NBSP)}${NBSP}pers.`;
}

/** Deux articles les plus récents : « Le Dauphiné 14:30 · titre » (lien), puis le total. */
function pressArticles(x: ProtestItem): string {
  const shown = x.articles.slice(0, 2).map((a) => {
    const clock = parisClock(a.seenAt);
    const who = `${a.outlet ?? a.domain}${clock ? `${NBSP}${clock}` : ''}`;
    return `${escapeHtml(who)} : ${sourceLinkHtml(clip(a.title ?? a.domain), a.url)}`;
  });
  const more = x.articleCount > shown.length ? ` · ${plural(x.articleCount, 'article')} en 24${NBSP}h` : '';
  return shown.join('<br>') + more;
}

function pressRow(x: ProtestItem, canFocus: boolean): string {
  const place = x.city && x.city !== '' ? `${x.city}${x.precision === 'departement' ? ' (département)' : ''}` : NO_PLACE;
  const key = protestPlaceKey(x);
  // Chiffre cité par un titre qui ne nomme que ce lieu : un plancher, pas un comptage (Paris peut n'avoir qu'« une centaine » cité).
  const figure = participantsLabel(x.participants);
  const cited = figure ? `<br>Plus haut chiffre cité dans un titre : ${escapeHtml(figure)}` : '';
  return listRow({
    text: place, valueHtml: x.violent ? '<span class="lp-badge">heurts</span>' : null, level: x.violent ? 'rouge' : 'orange',
    noteHtml: pressArticles(x) + cited,
    data: key !== null ? { protest: key } : undefined, link: canFocus && key !== null,
  });
}

function pressSection(b: ProtestBuckets, canFocus: boolean, open: OpenFn): FicheSection {
  const html = b.press.length === 0 ? emptyLine('Aucune manifestation rapportée par la presse française ces 24 heures.')
    : b.press.map((x) => pressRow(x, canFocus)).join('');
  const clashes = b.press.filter((x) => x.violent).length;
  const summary = `${plural(b.press.length, 'lieu', 'lieux')}${clashes > 0 ? ` · ${clashes} avec heurts` : ''}`;
  return { id: 'presse', title: 'Rapporté par la presse française (24 h)', collapsible: true, open: open('presse', true), summary, html };
}

function worldSection(b: ProtestBuckets, canFocus: boolean, open: OpenFn): FicheSection {
  const html = b.world.length === 0 ? emptyLine('Aucun autre signalement de la presse mondiale ces 24 heures.')
    : b.world.map((x) => signaledRow(x, canFocus)).join('');
  return { id: 'monde', title: 'Presse mondiale, GDELT (24 h)', collapsible: true, open: open('monde', false), summary: plural(b.world.length, 'signalement'), html };
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
  const presseState = d.presse.readAt === null ? 'injoignable' : stamp('relevé', d.presse.readAt, isProtestsLate(d.presse.readAt, now), now);
  const failed = d.demosphere.failedEditions.length > 0 ? note(`Éditions Démosphère illisibles : ${d.demosphere.failedEditions.join(', ')}.`) : '';
  const html = kvRow('Démosphère', `${sourceLinkHtml('Démosphère', DEMOSPHERE_URL)} · ${escapeHtml(demoState)}`)
    + note(`Annonces : agenda militant Démosphère, ${d.demosphere.editions}${NBSP}éditions locales lues, couverture inégale selon les villes, Paris presque vide. Filtre sur le titre. Un rendez-vous annoncé n’est pas une manifestation constatée.`)
    + failed
    + kvRow('Gilets jaunes', `${sourceLinkHtml('17octobregiletjaune.net', GILETS_JAUNES_URL)} · ${plural(d.items.filter((x) => x.source === 'giletsjaunes').length, 'action')}`)
    + note(`Annonces : carte participative des gilets jaunes, relue toutes les 30${NBSP}min ; chaque action est posée par un visiteur sur un lieu précis (place, rond-point, gare, péage, station-service). Assemblées et messages libres non repris. Annonce non confirmée.`)
    + kvRow('Presse française', escapeHtml(presseState))
    + note(`Presse : titres des journaux nationaux et régionaux déjà suivis par France${NBSP}Monitor, lus toutes les 5${NBSP}min. Lieu = ville ou département nommé dans le titre ; une dépêche reprise par plusieurs journaux compte une fois ; « heurts » dès que le titre parle de tensions, d’affrontements ou d’interpellations. ${d.presse.matched}${NBSP}titres retenus, dont ${d.presse.unplaced}${NBSP}sans lieu (articles nationaux).`)
    + kvRow('GDELT', `${sourceLinkHtml('GDELT', GDELT_URL)} · ${escapeHtml(gdeltState)}`)
    + note(`Presse : GDELT (presse mondiale), mise à jour toutes les 15${NBSP}min ; le lieu n’est que rarement plus précis que la ville, souvent absent.`)
    + note('Cette couche n’a aucun effet sur l’indice de stabilité, les situations ni la synthèse.')
    + readErrors(d.errors);
  return { id: 'methode', title: 'Méthode et sources', collapsible: true, open: open('methode', false), tone: 'reference', summary: 'Démosphère · gilets jaunes · presse · GDELT', html };
}

/** Case « Afficher les annonces de la carte des gilets jaunes » (26/10/2026) : filtre d'affichage de la carte et des listes. */
function giletsJaunesToggle(count: number, show: boolean): FicheSection {
  return {
    id: 'gilets-jaunes', title: 'Carte des gilets jaunes', collapsible: false, summary: plural(count, 'annonce'),
    html: `<label class="fmk-note"><input type="checkbox" data-gj-toggle${show ? ' checked' : ''}> `
      + `Afficher sur la carte et dans les listes les annonces de la carte des gilets jaunes</label>`,
  };
}

export function buildManifestationsView(input: ManifestationsViewInput): LayerView {
  const { error, canFocus, now, open } = input;
  const show = input.showGiletsJaunes ?? true;
  const full = input.data;
  const data = full === null || show ? full : { ...full, items: full.items.filter((x) => x.source !== 'giletsjaunes') };
  const gjCount = full?.items.filter((x) => x.source === 'giletsjaunes').length ?? 0;
  FORECASTS = input.forecasts ?? new Map();
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
  // Pastille : toutes les annonces, masquées ou non (filtre d'affichage seulement).
  const level = protestsHeadLevel(full ?? data, now);
  const late = isProtestsLate(data.readAt, now);
  const readMs = Date.parse(data.readAt);
  return {
    head: {
      theme: MANIFESTATIONS_THEME, title: MANIFESTATIONS_TITLE, level,
      figure: { value: String(protestsTodayCount((full ?? data).items, now)), caption: 'aujourd’hui', level: level === 'nd' ? null : level },
      status: [stamp('relevé', data.readAt, late, now)],
    },
    sections: [
      ...(gjCount > 0 ? [giletsJaunesToggle(gjCount, show)] : []),
      pressSection(b, canFocus, open), worldSection(b, canFocus, open), todaySection(b, canFocus, open), upcomingSection(b, canFocus, open),
      unplacedSection(b, open), methodSection(full ?? data, now, open),
    ],
    bodyHtml: error !== null ? sourceErrorCallout(Number.isFinite(readMs) ? readMs : null, now) : undefined,
  };
}
