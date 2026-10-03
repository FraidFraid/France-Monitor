// src/components/layer-panel/aerien.ts : vue pure du panneau Trafic aérien (spec 2026-10-03 trafics § 3.2), nouveau panneau ; aucun
// accès réseau ni DOM. Collecte OpenSky du serveur : urgences (7500, 7600, 7700) et journal de 7 jours, départs par aéroport,
// volume comparé aux jours précédents, trajectoires inhabituelles (détection automatique, information).
import type { AirEmergency, AirOverviewResponse, AirportActivity, Squawk } from '../../types/index.ts';
import { airLevel, isTrafficDataLate } from '../../services/traffic-levels.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { lineChart, type ChartPoint } from './chart.ts';
import { NBSP, formatSignedPct, frNumber } from './format.ts';
import {
  barRow, emptyLine, listRow, loadingBody, sourceErrorCallout, sourceLinkHtml, valueHtml, type LayerHeadModel, type LayerView,
} from './frame.ts';
import {
  CAT_AIRPORT, SQUAWK_LEVEL, SQUAWK_WORD, TRAFFIC_THEME, anomalyLabel, clockOf, coordText, dataMs, emptyOrDown, formatMeters, glueUnits, note,
  plural, readErrors, sourceDown, stamp,
} from './traffic-format.ts';

export interface AerienViewInput {
  overview: AirOverviewResponse | null;
  error: string | null;
  now: number;
  open: (sectionId: string, byDefault: boolean) => boolean;
}
type OpenFn = AerienViewInput['open'];

const TITLE = 'Trafic aérien';
const OPENSKY_URL = 'https://opensky-network.org';
const OPENSKY_API_URL = 'https://openskynetwork.github.io/opensky-api/rest.html';
const ZONE_WORDS = 'zone suivie de 41° N à 51,8° N et de 5,8° O à 10,2° E, qui déborde sur les pays voisins';
const SQUAWK_ORDER: Readonly<Record<Squawk, number>> = { '7500': 0, '7700': 1, '7600': 2 };
const MAX_LOG = 10;
const MAX_ANOMALIES = 10;
const CREDITS_FLOOR = 500;
const HOUR_MS = 3_600_000;

function sortEmergencies(list: readonly AirEmergency[]): AirEmergency[] {
  return [...list].sort((a, b) => SQUAWK_ORDER[a.squawk] - SQUAWK_ORDER[b.squawk] || (dataMs(b.lastSeen) ?? 0) - (dataMs(a.lastSeen) ?? 0));
}

function departuresRanked(o: AirOverviewResponse): Array<AirportActivity & { departures: number }> {
  return o.airports.flatMap((a) => (a.departures === null ? [] : [{ ...a, departures: a.departures }]))
    .sort((a, b) => b.departures - a.departures || a.iata.localeCompare(b.iata));
}

function windowHours(a: AirportActivity): number | null {
  const w = a.departuresWindow;
  const begin = dataMs(w?.begin);
  const end = dataMs(w?.end);
  return begin === null || end === null ? null : Math.round((end - begin) / HOUR_MS);
}

const BOARD_IATA: ReadonlySet<string> = new Set(['BVA', 'BOD']);

/** Départs non relevés : le serveur les lit en tâche de fond (après un démarrage, ou en développement), jamais une panne ni un zéro. */
function departuresUnread(o: AirOverviewResponse): boolean {
  return o.airports.length > 0 && o.airports.every((a) => a.departures === null || a.departures === undefined);
}

function openskyLate(o: AirOverviewResponse, now: number): boolean {
  return isTrafficDataLate('opensky', o.at, now);
}

// ─── En-tête ───

function lead(o: AirOverviewResponse): string {
  const current = sortEmergencies(o.emergencies);
  const parts = [current.length === 0 ? 'Aucun code d’urgence en vol.'
    : `${plural(current.length, 'aéronef')} en urgence : ${current.slice(0, 3).map((e) => `${e.callsign ?? e.icao24} (${e.squawk}, ${SQUAWK_WORD[e.squawk]})`).join(', ')}.`];
  const top = departuresRanked(o)[0];
  const hours = top ? windowHours(top) : null;
  if (top && hours !== null) parts.push(`${top.name} : ${plural(top.departures, 'départ')} en ${hours}${NBSP}h.`);
  return parts.join(' ');
}

function headOf(o: AirOverviewResponse, now: number): LayerHeadModel {
  const late = openskyLate(o, now);
  const verdict = airLevel(o);
  const n = o.emergencies.length;
  return {
    theme: TRAFFIC_THEME, title: TITLE,
    figure: {
      value: frNumber(n, 0),
      caption: `${n > 1 ? 'aéronefs' : 'aéronef'} en urgence · ${frNumber(o.airborneZone, 0)} en vol dans la zone suivie · OpenSky, ${clockOf(o.at, now)}${late ? ' (en retard)' : ''}`,
      level: late ? null : undefined,
    },
    level: late ? 'nd' : verdict.level,
    status: [late ? 'niveau suspendu : données OpenSky en retard' : glueUnits(verdict.reason), stamp('OpenSky', o.at, late, now)],
    lead: late ? null : lead(o),
  };
}

// ─── Urgences ───

function emergencyRow(e: AirEmergency, late: boolean, current: boolean, now: number): string {
  return listRow({
    text: `${e.callsign ?? `transpondeur ${e.icao24}`} · ${e.squawk} (${SQUAWK_WORD[e.squawk]})`,
    value: clockOf(current ? e.lastSeen : e.firstSeen, now),
    level: late || !current ? 'gris' : SQUAWK_LEVEL[e.squawk],
    note: [coordText(e.lat, e.lon), e.altitudeM !== null ? formatMeters(e.altitudeM) : 'altitude n.d.',
      e.overFrance ? 'au-dessus du territoire ou de ses approches' : 'hors du territoire : ne colore pas la pastille',
      current ? `vu depuis ${clockOf(e.firstSeen, now)}` : `vu jusqu’à ${clockOf(e.lastSeen, now)}`].join(' · '),
  });
}

function emergenciesSection(o: AirOverviewResponse | null, now: number, open: OpenFn): FicheSection {
  const base = { id: 'emergencies', title: 'Urgences', collapsible: true, open: open('emergencies', true) };
  if (!o) return { ...base, summary: 'n.d.', html: sourceDown('OpenSky') };
  const late = openskyLate(o, now);
  const current = sortEmergencies(o.emergencies);
  const rows = current.length > 0 ? current.map((e) => emergencyRow(e, late, true, now)).join('')
    : listRow({ text: 'Aucun aéronef en urgence', value: clockOf(o.at, now), level: late ? 'gris' : 'vert',
      note: 'codes 7500 (détournement), 7600 (panne radio), 7700 (urgence) : 0' });
  const log = [...o.emergencyLog].sort((a, b) => (dataMs(b.lastSeen) ?? 0) - (dataMs(a.lastSeen) ?? 0));
  const logHtml = '<h4 class="fmk-eyebrow">7 derniers jours</h4>' + (log.length === 0 ? emptyLine('Aucune urgence dans le journal des 7 derniers jours.')
    : log.slice(0, MAX_LOG).map((e) => emergencyRow(e, late, false, now)).join('')
      + (log.length > MAX_LOG ? note(`${log.length - MAX_LOG} autres urgences dans le journal.`) : ''));
  const codes = [...new Set(current.map((e) => e.squawk))].join(', ');
  return {
    ...base, summary: escapeHtml(current.length === 0 ? `aucune en cours${late ? ' (en retard)' : ''}` : `${current.length} en cours (${codes})`),
    html: rows + logHtml + note('Journal tenu par le serveur : chaque code 7500, 7600 ou 7700 vu en vol y reste 7 jours avec son heure, son indicatif et sa position. '
      + 'Un 7700 hors du territoire et de ses approches est montré sans colorer la pastille.'),
  };
}

// ─── Aéroports ───

function airportsSection(o: AirOverviewResponse | null, now: number, open: OpenFn): FicheSection {
  const base = { id: 'airports', title: 'Aéroports', collapsible: true, open: open('airports', true) };
  if (!o) return { ...base, summary: 'n.d.', html: sourceDown('OpenSky') };
  const ranked = departuresRanked(o);
  const top = ranked[0];
  const hours = top ? windowHours(top) : null;
  const win = top?.departuresWindow ?? null;
  const depLate = win ? isTrafficDataLate('opensky-departures', win.end, now) : false;
  const rows = ranked.map((a) => {
    const sub = `au sol ${frNumber(a.onGround, 0)} · en approche ${frNumber(a.approaching, 0)}`;
    return depLate ? listRow({ text: a.name, value: frNumber(a.departures, 0), level: 'gris', note: sub })
      : barRow({ label: a.name, pct: top && top.departures > 0 ? (a.departures / top.departures) * 100 : 0, value: frNumber(a.departures, 0),
        color: CAT_AIRPORT, dot: false, note: sub });
  }).join('');
  const body = ranked.length === 0 ? (departuresUnread(o) && o.errors.length === 0
    ? emptyLine('Départs non relevés : le serveur ne les a pas encore lus.')
    : emptyOrDown(o.errors, 'Aucun départ détecté sur la fenêtre affichée.', 'départs par aéroport (OpenSky)'))
    : rows + (win && hours !== null
      ? note(`Départs détectés de ${clockOf(win.begin, now)} à ${clockOf(win.end, now)} (fenêtre de ${hours}${NBSP}h, relue toutes les 4${NBSP}h)${depLate ? ' (en retard)' : ''}. `
        + `Au sol : à moins de 4${NBSP}km ; en approche : à moins de 40${NBSP}km et sous ${frNumber(3000, 0)}${NBSP}m.`) : '');
  const suspended = o.credits.remaining !== null && o.credits.remaining < CREDITS_FLOOR ? note('Départs suspendus : crédits OpenSky du jour sous 500.') : '';
  const boards = o.airports.filter((a) => a.board !== null || BOARD_IATA.has(a.iata)).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const boardsHtml = boards.length === 0 ? '' : '<h4 class="fmk-eyebrow">Retards et annulations (annuaires officiels)</h4>'
    + boards.map((a) => listRow({
      text: a.name, value: a.board ? clockOf(a.board.at, now) : 'n.d.',
      note: !a.board ? 'tableau non relevé' : `${plural(a.board?.delayed ?? 0, 'vol retardé', 'vols retardés')} · ${plural(a.board?.cancelled ?? 0, 'vol annulé', 'vols annulés')}`,
    })).join('')
    + note('Retards et annulations lus sur les sites officiels des aéroports de Beauvais et de Bordeaux, seuls à les publier ; les autres aéroports n’ont pas de flux ouvert.');
  return {
    ...base, summary: escapeHtml(top && hours !== null ? `${top.iata} ${plural(top.departures, 'départ')} en ${hours}${NBSP}h` : 'n.d.'),
    html: body + suspended + note('Les arrivées ne sont publiées par la source qu’en différé : elles ne sont pas reprises.') + boardsHtml,
  };
}

// ─── Volume de vols ───

function volumeSection(o: AirOverviewResponse | null, now: number, open: OpenFn): FicheSection {
  const base = { id: 'volume', title: 'Volume de vols', collapsible: true, open: open('volume', true) };
  if (!o) return { ...base, summary: 'n.d.', html: sourceDown('OpenSky') };
  const late = openskyLate(o, now);
  const prev = o.volume.sameHourPrevDays;
  let reference: string;
  if (prev.length < 7) {
    reference = kvRow('Même heure, jours précédents', '<span class="lp-val fmk-num lp-faint">référence en construction</span>')
      + note(`${plural(prev.length, 'jour')} de collecte sur 7 : la comparaison commence au septième jour.`);
  } else {
    const week = prev.slice(0, 7);
    const avg = week.reduce((sum, v) => sum + v, 0) / week.length;
    const pct = avg > 0 ? (o.airborneZone / avg - 1) * 100 : null;
    reference = kvRow('Même heure, moyenne des 7 jours précédents', `${valueHtml(frNumber(avg, 0))}${pct !== null ? ` ${valueHtml(formatSignedPct(pct, 0))}` : ''}`);
  }
  const atMs = dataMs(o.at);
  const points: ChartPoint[] = o.volume.samples.flatMap((s) => {
    const at = dataMs(s.at);
    return at === null ? [] : [{ at, value: s.airborneZone }];
  });
  const to = atMs ?? points.at(-1)?.at ?? null;
  const from = to === null ? null : Math.max(to - 24 * HOUR_MS, points[0]?.at ?? to);
  const stroke = late ? 'var(--text-primary)' : CAT_AIRPORT;
  const chart = from === null || to === null ? '' : lineChart(points.filter((p) => p.at >= from), {
    label: 'Aéronefs en vol dans la zone suivie, dernières 24 heures', from, to, stroke, markPeak: true,
    value: (v) => frNumber(v, 0), tick: (ms) => clockOf(new Date(ms).toISOString(), now),
  });
  const legend = chart ? `<div class="lp-legend"><span class="lp-key"><i style="background:${stroke}"></i>en vol dans la zone suivie, toutes les 10${NBSP}min</span></div>` : '';
  const html = kvRow('En vol dans la zone suivie', valueHtml(frNumber(o.airborneZone, 0)))
    + kvRow('dont au-dessus du territoire', valueHtml(frNumber(o.airborneFrance, 0)))
    + kvRow('Au sol dans la zone suivie', valueHtml(frNumber(o.onGround, 0))) + reference + chart + legend
    + note(`Zone suivie : ${ZONE_WORDS}. Au-dessus du territoire : positions dans le polygone de la France métropolitaine et de la Corse. `
      + `Un échantillon toutes les 10${NBSP}min, gardé 8 jours.`);
  return { ...base, summary: escapeHtml(`${frNumber(o.airborneZone, 0)} en vol${late ? ' (en retard)' : ''}`), html };
}

// ─── Trajectoires inhabituelles ───

function anomaliesSection(o: AirOverviewResponse | null, now: number, open: OpenFn): FicheSection {
  const base = { id: 'anomalies', title: 'Trajectoires inhabituelles', collapsible: true, open: open('anomalies', false) };
  if (!o) return { ...base, summary: 'n.d.', html: sourceDown('OpenSky') };
  const list = [...o.anomalies].sort((a, b) => (dataMs(b.at) ?? 0) - (dataMs(a.at) ?? 0));
  const rows = list.slice(0, MAX_ANOMALIES).map((a) => listRow({
    text: `${a.callsign ?? 'indicatif inconnu'} · ${anomalyLabel(a.kind)}`, value: clockOf(a.at, now), level: 'gris', note: a.airport ? `près de ${a.airport}` : null,
  })).join('');
  const body = list.length === 0 ? emptyOrDown(o.errors, 'Aucune trajectoire inhabituelle détectée.', 'détection des trajectoires') : rows;
  return {
    ...base, summary: escapeHtml(list.length === 0 ? 'aucune' : plural(list.length, 'détection automatique', 'détections automatiques')),
    html: body + note('Détection automatique (circuits d’attente, approches interrompues, manœuvres brusques, déroutements probables) : une information, jamais une alerte ; elle ne colore pas la pastille.'),
  };
}

// ─── Méthode et sources ───

function methodSection(o: AirOverviewResponse | null, error: string | null, now: number, open: OpenFn): FicheSection {
  const late = o ? openskyLate(o, now) : false;
  const win = o ? departuresRanked(o)[0]?.departuresWindow ?? null : null;
  const depLate = win ? isTrafficDataLate('opensky-departures', win.end, now) : false;
  const boards = o ? o.airports.filter((a) => a.board !== null).sort((a, b) => a.name.localeCompare(b.name, 'fr')) : [];
  const unread = o !== null && departuresUnread(o) && o.errors.length === 0;
  const status = (text: string): string => (o ? text : error !== null ? 'source indisponible' : 'chargement…');
  const html = kvRow('Positions et urgences', `${sourceLinkHtml('OpenSky (ADS-B)', OPENSKY_URL)} · ${escapeHtml(status(`états de ${clockOf(o?.at, now)}${late ? ' (en retard)' : ''}`))}`)
    + kvRow('Départs par aéroport', `${sourceLinkHtml('OpenSky, départs', OPENSKY_API_URL)} · ${escapeHtml(status(win
      ? `fenêtre de ${clockOf(win.begin, now)} à ${clockOf(win.end, now)}${depLate ? ' (en retard)' : ''}` : unread ? 'départs non relevés' : 'source indisponible'))}`)
    + kvRow('Retards et annulations', escapeHtml(status(boards.length > 0
      ? `annuaires officiels : ${boards.map((a) => `${a.name} ${a.board ? clockOf(a.board.at, now) : 'tableau non relevé'}`).join(' · ')}`
      : o !== null && o.errors.length === 0 ? 'tableau non relevé' : 'source indisponible')))
    + kvRow('Crédits OpenSky du jour', valueHtml(o && o.credits.remaining !== null ? `${frNumber(o.credits.remaining, 0)} restants` : 'n.d.'))
    + note(`Périmètre : ${ZONE_WORDS} ; jamais un nombre d’avions au-dessus de la seule France.`)
    + note('Pastille : rouge si un 7500 ; orange si un 7700 au-dessus du territoire ou de ses approches ; jaune si un 7600 ; vert sinon ; n.d. si la source est en panne.')
    + note(`Retard : états au-delà de 10${NBSP}min ; départs au-delà de 4${NBSP}h après la fin de leur fenêtre. Une donnée en retard perd ses couleurs.`)
    + note('Collecte du serveur toutes les 2 minutes, départs de 8 aéroports toutes les 4 heures ; si les crédits restants passent sous 500, les départs sont suspendus avant les états.')
    + note('Carte : avions en densité, sans libellé d’indicatif (indicatif au survol) ; urgences en symbole rouge avec leur indicatif ; aéroports dimensionnés par leurs départs.')
    + readErrors(o?.errors ?? []);
  return {
    id: 'method', title: 'Méthode et sources', collapsible: true, open: open('method', false), tone: 'reference', html,
    summary: escapeHtml(o === null && error !== null ? 'OpenSky (ADS-B) · indisponible' : 'OpenSky (ADS-B)'),
  };
}

// ─── Assemblage ───

export function buildAerienView(input: AerienViewInput): LayerView {
  const { overview: o, error, now, open } = input;
  if (o === null && error === null) {
    return { head: { theme: TRAFFIC_THEME, title: TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  }
  const sections = [
    emergenciesSection(o, now, open), airportsSection(o, now, open), volumeSection(o, now, open), anomaliesSection(o, now, open),
    methodSection(o, error, now, open),
  ];
  if (o === null) {
    return {
      head: { theme: TRAFFIC_THEME, title: TITLE, level: 'nd', figure: { value: 'n.d.', caption: 'aéronef en urgence', level: null }, status: ['OpenSky injoignable'] },
      sections, bodyHtml: sourceErrorCallout(null, now),
    };
  }
  return { head: headOf(o, now), sections, bodyHtml: error !== null ? sourceErrorCallout(dataMs(o.at), now) : undefined };
}
