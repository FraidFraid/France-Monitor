// src/components/layer-panel/route.ts : vue pure du panneau Trafic routier (spec 2026-10-03 trafics § 3.1) ; aucun accès réseau ni
// DOM. Réseau routier national non concédé (DIR : DATEX II, vitesses QTV, Traficolor), autoroutes concédées (récapitulatif du CNIR),
// congestion de 12 agglomérations (TomTom, collecte du serveur). Chaque partie porte sa date réelle (S1) et son périmètre (T1) ;
// un événement planifié ou démarré depuis plus de 24 h va dans « Fermetures et chantiers de longue durée » (T2).
import type { ConcededJam, RoadAggloOfficial, RoadEvent, RoadNationalResponse, RoadUrbanResponse, UrbanAgglo } from '../../types/index.ts';
import { isTrafficDataLate, roadLevel } from '../../services/traffic-levels.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { NBSP, frNumber } from './format.ts';
import { barRow, listRow, loadingBody, sourceErrorCallout, sourceLinkHtml, valueHtml, type LayerHeadModel, type LayerView } from './frame.ts';
import {
  IMPORTANCE_LEVEL, ROAD_EVENT_LEVEL, ROAD_KIND_ORDER, TRAFFIC_THEME, clockOf, dataMs, dateOf, dirLoadLevel, emptyOrDown, fold, formatKm,
  formatKmh, formatMinutes, formatShare, glueUnits, note, plural, readErrors, shortDate, sourceDown, speedLevel, stamp,
} from './traffic-format.ts';

export interface RouteViewInput {
  national: RoadNationalResponse | null;
  nationalError: string | null;
  urban: RoadUrbanResponse | null;
  urbanError: string | null;
  /** La carte peut recentrer sur un événement (carte WebGL) ; sinon les lignes ne se donnent pas pour cliquables. */
  canFocus: boolean;
  now: number;
  open: (sectionId: string, byDefault: boolean) => boolean;
}
type OpenFn = RouteViewInput['open'];

const TITLE = 'Trafic routier';
const MAX_EVENTS = 10;
const MAX_DIRS = 6;
const MAX_AGGLOS = 8;
const MAX_CONCEDED = 5;
const MAX_LONG_TERM = 10;
/** Part saturée (Traficolor) en rouge dès 5 % (maquette). */
const SATURATED_RED_PCT = 5;
const DIR_URL = 'https://transport.data.gouv.fr/datasets/evenements-routiers-sur-le-reseau-routier-national-non-concede';
const QTV_URL = 'https://transport.data.gouv.fr/datasets/etat-de-circulation-en-temps-reel-sur-le-reseau-national-routier-non-concede';
const CNIR_URL = 'http://tipi.bison-fute.gouv.fr/bison-fute-ouvert/publicationsDIR/Evenementiel-DIR/cnir/RecapBouchonsFranceEntiere.html';
const TOMTOM_URL = 'https://developer.tomtom.com/traffic-api/documentation/traffic-incidents/incident-details';
const SEVERITY_WORDS: Readonly<Record<NonNullable<RoadEvent['severity']>, string | null>> = {
  low: null, medium: null, high: 'gravité élevée', highest: 'gravité très élevée',
};

function where(e: RoadEvent): string {
  return [e.road, e.place].filter((x): x is string => x !== null && x.trim() !== '').join(', ');
}

function eventTitle(e: RoadEvent): string {
  const w = where(e);
  return w ? `${e.label} · ${w}` : e.label;
}

/** Événements en cours : accidents, bouchons, coupures, météo, obstacles, voies (maquette), les plus récents d'abord. */
export function sortRoadEvents(events: readonly RoadEvent[]): RoadEvent[] {
  return [...events].sort((a, b) => ROAD_KIND_ORDER[a.kind] - ROAD_KIND_ORDER[b.kind] || (dataMs(b.start) ?? 0) - (dataMs(a.start) ?? 0));
}

function dirLate(n: RoadNationalResponse, now: number): boolean {
  return isTrafficDataLate('dir', n.publishedAt, now);
}

// ─── En-tête ───

function lead(n: RoadNationalResponse, u: RoadUrbanResponse | null, now: number): string {
  const sorted = sortRoadEvents(n.events);
  const accidents = sorted.filter((e) => e.kind === 'accident');
  const cuts = sorted.filter((e) => e.kind === 'closure');
  const parts: string[] = [];
  const first = accidents[0];
  parts.push(first
    ? `${plural(accidents.length, 'accident')} en cours, le plus récent à ${clockOf(first.start, now)}${first.road ? ` (${first.road})` : ''}.`
    : 'Aucun accident en cours sur le réseau national non concédé (les autoroutes concédées sont suivies à part).');
  const cut = cuts[0];
  if (cuts.length === 1 && cut) parts.push(`${cut.road ?? 'Route'} coupée${cut.place ? ` (${cut.place})` : ''} depuis ${clockOf(cut.start, now)}.`);
  else if (cuts.length > 1) parts.push(`${cuts.length} routes coupées depuis moins de 24${NBSP}h.`);
  const top = u && !isTrafficDataLate('tomtom', u.collectedAt, now) ? [...u.agglos].sort((a, b) => b.jamKm - a.jamKm)[0] : undefined;
  if (top && top.jamKm > 0) parts.push(`${top.name} : ${formatKm(top.jamKm)} de bouchons.`);
  return parts.join(' ');
}

function urbanStamp(u: RoadUrbanResponse | null, urbanError: string | null, now: number): string {
  if (u) return stamp('TomTom', u.collectedAt, isTrafficDataLate('tomtom', u.collectedAt, now), now);
  return urbanError !== null ? 'TomTom injoignable' : 'TomTom chargement…';
}

function headOf(input: RouteViewInput, n: RoadNationalResponse): LayerHeadModel {
  const { urban: u, urbanError, now } = input;
  const late = dirLate(n, now);
  const verdict = roadLevel(n);
  const accidents = n.counts.accidents;
  const tail = late ? ' (en retard)' : '';
  return {
    theme: TRAFFIC_THEME, title: TITLE,
    figure: {
      value: frNumber(n.counts.incidents, 0),
      caption: `incidents en cours sur le réseau national non concédé · dont ${plural(accidents, 'accident')} · DIR, ${clockOf(n.publishedAt, now)}${tail}`,
      level: late ? null : undefined,
    },
    level: late ? 'nd' : verdict.level,
    status: [late ? 'niveau suspendu : données DIR en retard' : glueUnits(verdict.reason), `${stamp('DIR', n.publishedAt, late, now)} · ${urbanStamp(u, urbanError, now)}`],
    lead: late ? null : lead(n, u, now),
  };
}

// ─── Événements en cours ───

function eventRow(e: RoadEvent, late: boolean, canFocus: boolean, now: number): string {
  const end = e.end !== null ? `fin prévue ${clockOf(e.end, now)}` : e.kind === 'closure' ? 'sans fin déclarée' : null;
  const parts = [e.detail.trim() || null, e.direction, end, e.severity ? SEVERITY_WORDS[e.severity] : null, e.dir]
    .filter((x): x is string => x !== null && x !== '');
  const focusable = canFocus && e.lat !== null && e.lon !== null;
  return listRow({
    text: eventTitle(e), value: clockOf(e.start, now), level: late ? 'gris' : ROAD_EVENT_LEVEL[e.kind], note: parts.join(' · '),
    ...(focusable ? { data: { 'road-event': e.id }, link: true } : {}),
  });
}

function restText(rest: readonly RoadEvent[]): string {
  const groups = new Map<string, number>();
  for (const e of rest) groups.set(e.label, (groups.get(e.label) ?? 0) + 1);
  const ranked = [...groups.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'));
  const shown = ranked.slice(0, 4).map(([label, n]) => `${label.toLowerCase()} (${n})`).join(', ');
  return `${rest.length} autre${rest.length > 1 ? 's' : ''} : ${shown}${ranked.length > 4 ? '…' : ''}.`;
}

const T2_NOTE = `Réseau national non concédé (DIR) ; les autoroutes concédées sont suivies à part, par les bouchons du CNIR. En cours : événement non planifié démarré depuis moins de 24${NBSP}h ; au-delà, ou planifié, il passe dans « Fermetures et `
  + 'chantiers de longue durée ». Les chantiers ne comptent jamais comme incidents.';

function eventsSection(n: RoadNationalResponse | null, canFocus: boolean, now: number, open: OpenFn): FicheSection {
  const base = { id: 'events', title: 'Événements en cours', collapsible: true, open: open('events', true) };
  if (!n) return { ...base, summary: 'n.d.', html: sourceDown('événements des DIR') };
  const sorted = sortRoadEvents(n.events);
  if (sorted.length === 0) {
    return { ...base, summary: n.errors.length > 0 ? 'n.d.' : 'aucun',
      html: emptyOrDown(n.errors, 'Aucun événement en cours sur le réseau national non concédé (les autoroutes concédées sont suivies à part).', 'événements des DIR') + note(T2_NOTE) };
  }
  const late = dirLate(n, now);
  const count = (kind: RoadEvent['kind']): number => sorted.filter((e) => e.kind === kind).length;
  const counted: Array<[number, string]> = [[count('accident'), 'accident'], [count('queue'), 'bouchon'], [count('closure'), 'coupure']];
  const summary = counted.filter(([c]) => c > 0).map(([c, word]) => plural(c, word)).join(' · ') || plural(sorted.length, 'événement');
  const rows = sorted.slice(0, MAX_EVENTS).map((e) => eventRow(e, late, canFocus, now)).join('');
  const rest = sorted.slice(MAX_EVENTS);
  return {
    ...base, summary: escapeHtml(`${summary}${late ? ' (en retard)' : ''}`),
    html: rows + (rest.length > 0 ? note(restText(rest)) : '') + note(T2_NOTE)
      + (canFocus ? note('Clic sur une ligne : l’événement sur la carte.') : ''),
  };
}

// ─── Par direction des routes ───

function dirsSection(n: RoadNationalResponse | null, now: number, open: OpenFn): FicheSection {
  const base = { id: 'dirs', title: 'Par direction des routes', collapsible: true, open: open('dirs', true) };
  if (!n) return { ...base, summary: 'n.d.', html: sourceDown('événements des DIR') };
  const ranked = [...n.byDir].sort((a, b) => b.incidents - a.incidents || a.dir.localeCompare(b.dir, 'fr'));
  const top = ranked[0];
  if (!top) return { ...base, summary: 'n.d.', html: emptyOrDown(n.errors, 'Aucun incident en cours.', 'événements des DIR') };
  const late = dirLate(n, now);
  const rows = ranked.slice(0, MAX_DIRS).map((d) => (late
    ? listRow({ text: d.dir, value: frNumber(d.incidents, 0), level: 'gris' })
    : barRow({ label: d.dir, pct: top.incidents > 0 ? (d.incidents / top.incidents) * 100 : 0, value: frNumber(d.incidents, 0), level: dirLoadLevel(d.incidents) })))
    .join('');
  const rest = ranked.slice(MAX_DIRS);
  const restMax = rest.reduce((m, d) => Math.max(m, d.incidents), 0);
  const restHtml = rest.length === 0 ? ''
    : note(`${rest.length} autre${rest.length > 1 ? 's' : ''} DIR : ${restMax === 0 ? 'aucun incident' : `${plural(restMax, 'incident')} ou moins`}.`);
  return {
    ...base, summary: escapeHtml(`${top.dir} ${frNumber(top.incidents, 0)}`),
    html: rows + restHtml + note('Jauge : incidents en cours dans la DIR (jaune dès 7, orange dès 20, rouge dès 40) ; hors chantiers et longue durée.'),
  };
}

// ─── Agglomérations ───

interface AggloLine { name: string; urban: UrbanAgglo | null; official: RoadAggloOfficial | null }

function aggloLines(urban: readonly UrbanAgglo[], official: readonly RoadAggloOfficial[]): AggloLine[] {
  const byName = new Map<string, AggloLine>();
  for (const a of urban) byName.set(fold(a.name), { name: a.name, urban: a, official: null });
  for (const o of official) {
    const line = byName.get(fold(o.label));
    if (line) line.official = o;
    else byName.set(fold(o.label), { name: o.label, urban: null, official: o });
  }
  return [...byName.values()].sort((a, b) => (b.urban?.jamKm ?? -1) - (a.urban?.jamKm ?? -1)
    || (b.official?.congestedPct ?? -1) - (a.official?.congestedPct ?? -1) || a.name.localeCompare(b.name, 'fr'));
}

function latestOfficial(official: readonly RoadAggloOfficial[]): string | null {
  return official.reduce<string | null>((m, o) => ((dataMs(o.at) ?? -Infinity) > (dataMs(m) ?? -Infinity) ? o.at : m), null);
}

function agglosSection(n: RoadNationalResponse | null, u: RoadUrbanResponse | null, urbanError: string | null, now: number, open: OpenFn): FicheSection {
  const base = { id: 'agglos', title: 'Agglomérations', collapsible: true, open: open('agglos', true) };
  const official = n?.agglos ?? [];
  const lines = aggloLines(u?.agglos ?? [], official);
  const urbanDown = u === null && urbanError !== null ? sourceDown('collecte TomTom des agglomérations') : '';
  if (lines.length === 0) {
    return { ...base, summary: 'n.d.', html: urbanDown + emptyOrDown([...(n?.errors ?? []), ...(u?.errors ?? [])], 'Aucune agglomération renseignée.', 'TomTom et Traficolor') };
  }
  const officialDown = official.length === 0 ? sourceDown('niveaux Traficolor des DIR') : '';
  const urbanLate = u ? isTrafficDataLate('tomtom', u.collectedAt, now) : false;
  const maxKm = Math.max(0, ...lines.map((l) => l.urban?.jamKm ?? 0));
  const nd = '<td class="lp-faint">n.d.</td>';
  const rows = lines.slice(0, MAX_AGGLOS).map((l) => {
    const km = l.urban
      ? `<td>${l.urban.jamKm === maxKm && maxKm > 0 ? `<b class="lp-val fmk-num">${escapeHtml(formatKm(l.urban.jamKm))}</b>` : valueHtml(formatKm(l.urban.jamKm))}</td>`
      : nd;
    const delay = l.urban ? `<td>${valueHtml(formatMinutes(l.urban.delayMin))}</td>` : nd;
    const pct = l.official ? l.official.congestedPct : null;
    const offLate = l.official ? isTrafficDataLate('traficolor', l.official.at, now) : false;
    const sat = pct !== null ? `<td>${valueHtml(formatShare(pct), !offLate && pct >= SATURATED_RED_PCT ? 'rouge' : null)}</td>` : nd;
    return `<tr><th scope="row">${escapeHtml(l.name)}</th>${km}${delay}${sat}</tr>`;
  }).join('');
  const table = '<table class="lp-tbl"><thead><tr><th scope="col">Agglomération</th><th scope="col">Bouchons</th>'
    + `<th scope="col">Retard</th><th scope="col">Saturé</th></tr></thead><tbody>${rows}</tbody></table>`;
  const more = lines.length > MAX_AGGLOS ? note(`${lines.length - MAX_AGGLOS} autres agglomérations.`) : '';
  const topUrban = lines.find((l) => l.urban !== null)?.urban ?? null;
  const topOfficial = [...lines].filter((l) => l.official !== null && l.official.congestedPct !== null)
    .sort((a, b) => (b.official?.congestedPct ?? 0) - (a.official?.congestedPct ?? 0))[0]?.official ?? null;
  const summary = topUrban ? `${topUrban.name} ${formatKm(topUrban.jamKm)} de bouchons${urbanLate ? ' (en retard)' : ''}`
    : topOfficial ? `${topOfficial.label} ${formatShare(topOfficial.congestedPct)} saturé` : 'n.d.';
  const offAt = latestOfficial(official);
  return {
    ...base, summary: escapeHtml(summary),
    html: urbanDown + officialDown + table + more
      + note(`Bouchons et retard cumulé : TomTom, ${u ? `${u.agglos.length} agglomérations` : 'agglomérations'}, embouteillages seulement (jamais les routes fermées), collecte du serveur toutes les 15${NBSP}min de 7${NBSP}h à 21${NBSP}h et toutes les 30${NBSP}min la nuit ; relevé de ${u ? clockOf(u.collectedAt, now) : 'n.d.'}${urbanLate ? ' (en retard)' : ''}.`)
      + note(`Saturé : part des sections officielles au niveau « saturé » parmi les sections renseignées (Traficolor des DIR${official.length > 0 ? `, ${official.length} réseaux d’agglomération` : ''}), en rouge dès 5${NBSP}%`
        + (official.length === 0 ? ' ; source indisponible.' : ` ; fichiers de ${clockOf(offAt, now)}. n.d. : la source ne couvre pas l’agglomération.`)),
  };
}

// ─── Autoroutes concédées (CNIR) ───

function jamTitle(j: ConcededJam): string {
  if (j.from && j.to) return `${j.motorway}, ${j.from} vers ${j.to}`;
  if (j.to) return `${j.motorway}, vers ${j.to}`;
  return j.motorway;
}

function concededSection(n: RoadNationalResponse | null, now: number, open: OpenFn): FicheSection {
  const base = { id: 'conceded', title: 'Autoroutes concédées', collapsible: true, open: open('conceded', true) };
  const down = sourceDown('récapitulatif national du CNIR (autoroutes concédées)');
  if (!n || n.conceded.at === null) return { ...base, summary: 'n.d.', html: down };
  const late = isTrafficDataLate('cnir', n.conceded.at, now);
  const clock = `${clockOf(n.conceded.at, now)}${late ? ' (en retard)' : ''}`;
  const jams = [...n.conceded.jams].sort((a, b) => b.importance - a.importance || (b.lengthKm ?? 0) - (a.lengthKm ?? 0));
  const top = jams[0];
  if (!top) return { ...base, summary: 'aucun bouchon', html: note(`Aucun bouchon signalé sur les autoroutes concédées (récapitulatif du CNIR, ${clock}).`) };
  const rows = jams.slice(0, MAX_CONCEDED).map((j) => listRow({
    text: jamTitle(j), value: formatKm(j.lengthKm), level: late ? 'gris' : IMPORTANCE_LEVEL[j.importance], note: j.operator,
  })).join('');
  const rest = jams.slice(MAX_CONCEDED);
  const operators = [...new Set(rest.map((j) => j.operator).filter((o): o is string => o !== null && o !== ''))];
  const restHtml = rest.length === 0 ? note(`Récapitulatif national du CNIR, ${clock}.`)
    : note(`${plural(rest.length, 'autre bouchon', 'autres bouchons')}${operators.length > 0 ? ` (${operators.join(', ')})` : ''} · récapitulatif national du CNIR, ${clock}.`);
  return {
    ...base, summary: escapeHtml(`${plural(jams.length, 'bouchon')} · ${top.motorway} ${formatKm(top.lengthKm)}`),
    html: rows + restHtml + note('Les sociétés d’autoroutes ne publient pas de flux ouvert : seuls les bouchons du récapitulatif national du CNIR sont repris ; importance *** orange, ** jaune, * vert.'),
  };
}

// ─── Vitesses mesurées (QTV) ───

function speedsSection(n: RoadNationalResponse | null, now: number, open: OpenFn): FicheSection {
  const base = { id: 'speeds', title: 'Vitesses mesurées', collapsible: true, open: open('speeds', false) };
  const s = n?.speeds;
  if (!s || s.at === null) return { ...base, summary: 'n.d.', html: sourceDown('vitesses des stations QTV des DIR') };
  const late = isTrafficDataLate('qtv', s.at, now);
  const slow = s.slowest.length === 0 ? '' : '<h4 class="fmk-eyebrow">Stations les plus lentes</h4>' + s.slowest.map((st) => listRow({
    text: `${st.dir}${st.road ? `, ${st.road}` : ''}`, value: formatKmh(st.speed), level: late ? 'gris' : speedLevel(st.speed),
    note: st.flow !== null ? `${frNumber(st.flow, 0)} véhicules par heure` : null,
  })).join('');
  const html = kvRow('Stations valides', valueHtml(frNumber(s.stations, 0)))
    + kvRow(`Sous 50${NBSP}km/h avec plus de 1${NBSP}000 véhicules par heure`, valueHtml(frNumber(s.under50, 0)))
    + kvRow('Vitesse médiane nationale', valueHtml(formatKmh(s.median))) + slow
    + note(`Mesure de ${clockOf(s.at, now)}${late ? ' (en retard)' : ''} ; vitesses moyennes sur 6${NBSP}min par station et par sens, valeurs aberrantes (0 et ${frNumber(9_999_999, 0)}) écartées ; le flux ne donne pas de vitesse libre de référence.`);
  return { ...base, summary: escapeHtml(`${plural(s.under50, 'station')} sous 50${NBSP}km/h${late ? ' (en retard)' : ''}`), html };
}

// ─── Fermetures et chantiers de longue durée (T2) ───

function longTermSection(n: RoadNationalResponse | null, now: number, open: OpenFn): FicheSection {
  const base = { id: 'longterm', title: 'Fermetures et chantiers de longue durée', collapsible: true, open: open('longterm', false) };
  if (!n) return { ...base, summary: 'n.d.', html: sourceDown('événements des DIR') };
  const items = [...n.longTerm].sort((a, b) => (a.kind === 'closure' ? 0 : 1) - (b.kind === 'closure' ? 0 : 1)
    || (dataMs(a.start) ?? 0) - (dataMs(b.start) ?? 0));
  const first = items[0];
  if (!first) return { ...base, summary: 'aucune', html: emptyOrDown(n.errors, 'Aucune fermeture ni chantier de longue durée publié.', 'événements des DIR') };
  const rows = items.slice(0, MAX_LONG_TERM).map((e) => listRow({
    text: eventTitle(e), value: shortDate(e.start, now), level: 'gris',
    note: [e.end !== null ? `du ${dateOf(e.start)} au ${dateOf(e.end)}` : `depuis le ${dateOf(e.start)}, sans fin déclarée`,
      e.planned ? 'planifié' : `démarré depuis plus de 24${NBSP}h`, e.dir].join(' · '),
  })).join('');
  const more = items.length > MAX_LONG_TERM ? note(`${items.length - MAX_LONG_TERM} autres.`) : '';
  return {
    ...base, summary: escapeHtml(`${plural(items.length, 'fermeture et chantier', 'fermetures et chantiers')} · ${first.place ?? first.road ?? first.label}`),
    html: rows + more + note(`${frNumber(n.counts.works, 0)} chantiers en cours sur le réseau national ; ils ne comptent jamais comme incidents.`),
  };
}

// ─── Méthode et sources ───

function methodSection(input: RouteViewInput): FicheSection {
  const { national: n, nationalError, urban: u, urbanError, now, open } = input;
  const state = (has: boolean, failed: boolean, text: string): string => (has ? text : failed ? 'source indisponible' : 'chargement…');
  const nLate = n ? dirLate(n, now) : false;
  const late = (b: boolean): string => (b ? ' (en retard)' : '');
  const offAt = n ? latestOfficial(n.agglos) : null;
  const rowList = [
    kvRow('Événements', `${sourceLinkHtml('DIR, DATEX II (Bison Futé)', DIR_URL)} · ${escapeHtml(state(n !== null, nationalError !== null,
      `publication de ${n ? clockOf(n.publishedAt, now) : 'n.d.'}${late(nLate)}`))}`),
    kvRow('Vitesses', `${sourceLinkHtml('DIR, stations QTV', QTV_URL)} · ${escapeHtml(state(n !== null, nationalError !== null,
      n?.speeds.at ? `mesure de ${clockOf(n.speeds.at, now)}${late(isTrafficDataLate('qtv', n.speeds.at, now))}` : 'source indisponible'))}`),
    kvRow('Niveaux de circulation', `${sourceLinkHtml('DIR, Traficolor', QTV_URL)} · ${escapeHtml(state(n !== null, nationalError !== null,
      offAt ? `fichiers de ${clockOf(offAt, now)}${late(isTrafficDataLate('traficolor', offAt, now))}` : 'source indisponible'))}`),
    kvRow('Autoroutes concédées', `${sourceLinkHtml('CNIR, récapitulatif national', CNIR_URL)} · ${escapeHtml(state(n !== null, nationalError !== null,
      n?.conceded.at ? `récapitulatif de ${clockOf(n.conceded.at, now)}${late(isTrafficDataLate('cnir', n.conceded.at, now))}` : 'source indisponible'))}`),
    kvRow('Agglomérations', `${sourceLinkHtml('TomTom, collecte du serveur', TOMTOM_URL)} · ${escapeHtml(state(u !== null, urbanError !== null,
      u ? `collecte de ${clockOf(u.collectedAt, now)}${late(isTrafficDataLate('tomtom', u.collectedAt, now))} · ${frNumber(u.quota.callsToday, 0)} appels sur ${frNumber(u.quota.limit, 0)} aujourd’hui` : ''))}`),
  ];
  const rows = rowList.join('');
  const down = rowList.filter((row) => row.includes('source indisponible')).length;
  const html = rows
    + note(`Périmètres : réseau routier national non concédé (DIR) ; les autoroutes concédées n’y figurent pas, leurs bouchons viennent du récapitulatif national du CNIR ; ${u ? `${u.agglos.length} agglomérations` : 'agglomérations'} (TomTom, Paris et Lyon en deux cadres). Jamais une couverture France entière.`)
    + note(`Pastille : rouge si un événement météo (neige, verglas, inondation, éboulement récent) touche au moins 2 DIR, ou au moins 5 coupures non planifiées de moins de 24${NBSP}h ; orange si un événement météo est actif, ou au moins 2 coupures ; jaune si au moins une coupure ou au moins 5 accidents ; vert sinon : les accidents ne dépassent jamais le jaune.`)
    + note(T2_NOTE)
    + note(`Retard : événements DIR au-delà de 30${NBSP}min après leur publication ; vitesses et Traficolor au-delà de 20${NBSP}min ; récapitulatif du CNIR au-delà de 2${NBSP}h ; TomTom au-delà de 45${NBSP}min le jour et 75${NBSP}min la nuit. Une donnée en retard perd ses couleurs ; la pastille passe à n.d.`)
    + note(`Couleurs : puce de l’événement selon sa nature (accident rouge ; bouchon, coupure, météo orange ; obstacle, voie fermée jaune) ; jauge par DIR selon le nombre d’incidents (jaune dès 7, orange dès 20, rouge dès 40) ; vitesse d’une station rouge sous 30${NBSP}km/h, orange sous 50, jaune sous 70.`)
    + note('Carte : événements des DIR (accidents et coupures au premier plan), bouchons TomTom des agglomérations (clic : vitesse mesurée sur le tronçon), tuiles de circulation TomTom à partir du zoom 10. Les sections Traficolor géolocalisées (référentiel des DIR) sont colorées par leur dernier niveau : fluide, dense, saturé.')
    + readErrors([...(n?.errors ?? []), ...(u?.errors ?? [])]);
  return {
    id: 'method', title: 'Méthode et sources', collapsible: true, open: open('method', false), tone: 'reference', html,
    summary: escapeHtml(`5 sources${down > 0 ? ` · ${down} indisponible${down > 1 ? 's' : ''}` : ''}`),
  };
}

// ─── Assemblage ───

export function buildRouteView(input: RouteViewInput): LayerView {
  const { national: n, nationalError, urban: u, urbanError, canFocus, now, open } = input;
  if (n === null && nationalError === null) {
    return { head: { theme: TRAFFIC_THEME, title: TITLE, status: ['chargement…'] }, sections: [], bodyHtml: loadingBody() };
  }
  const sections = [
    eventsSection(n, canFocus, now, open), dirsSection(n, now, open), agglosSection(n, u, urbanError, now, open),
    concededSection(n, now, open), speedsSection(n, now, open), longTermSection(n, now, open), methodSection(input),
  ];
  if (n === null) {
    return {
      head: {
        theme: TRAFFIC_THEME, title: TITLE, level: 'nd',
        figure: { value: 'n.d.', caption: 'incidents en cours sur le réseau national non concédé', level: null },
        status: ['DIR injoignable', urbanStamp(u, urbanError, now)],
      },
      sections, bodyHtml: sourceErrorCallout(null, now),
    };
  }
  return { head: headOf(input, n), sections, bodyHtml: nationalError !== null ? sourceErrorCallout(dataMs(n.publishedAt), now) : undefined };
}
