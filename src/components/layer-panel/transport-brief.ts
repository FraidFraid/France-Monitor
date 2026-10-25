// src/components/layer-panel/transport-brief.ts : sections Transports de l'En bref (lots 1 et 2, 25/10/2026). Pur, sans DOM ni réseau.
// L'essentiel en une phrase, les points de vigilance numérotés (mêmes numéros que la carte), puis une section par mode avec ses
// chiffres clés et ses tableaux, et l'écart à la normale. Tout vient des données déjà lues par les panneaux et des niveaux de leurs
// pastilles (traffic-levels.ts) ; « n.d. » quand une source manque, jamais un chiffre inventé.
import type {
  AirOverviewResponse, MaritimeSnapshot, RailOverviewResponse, RailSituationsResponse, RoadEventKind, RoadNationalResponse, RoadUrbanResponse,
} from '../../types/index.ts';
import { airLevel, maritimeLevel, railCancelledShare, railLevel, roadLevel, worstGroup } from '../../services/traffic-levels.ts';
import { levelLabel, type VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { NBSP, formatSignedPct, frNumber } from './format.ts';
import { emptyLine, valueHtml } from './frame.ts';
import { ROAD_KIND_ORDER, ROAD_KIND_WORD, clockOf, formatKmh, formatMinutes, glueUnits, note, railGroupLevel } from './traffic-format.ts';
import { airNormalGap, stationName, type TransportMode, type TransportVigilancePoint } from './transport-vigilance.ts';
import type { WatchLevel } from './watch.ts';

type OpenFn = (sectionId: string, byDefault: boolean) => boolean;

export interface TransportBriefData {
  points: readonly TransportVigilancePoint[];
  rail: RailOverviewResponse | null;
  situations: RailSituationsResponse | null;
  road: RoadNationalResponse | null;
  urban: RoadUrbanResponse | null;
  /** Message de la source TomTom indisponible ou périmée (expireSlot), sinon null. */
  urbanError: string | null;
  air: AirOverviewResponse | null;
  maritime: MaritimeSnapshot | null;
  levels: Partial<Record<TransportMode, WatchLevel>>;
}

export const TRANSPORT_MODE_LABEL: Readonly<Record<TransportMode, string>> = {
  trafficRail: 'Rail', trafficRoad: 'Route', trafficAir: 'Aérien', trafficMaritime: 'Maritime',
};
const MODES: readonly TransportMode[] = ['trafficRail', 'trafficRoad', 'trafficAir', 'trafficMaritime'];
const ND = 'n.d.';

function levelWordOf(l: WatchLevel | undefined): string {
  return l === undefined ? 'non lu' : l === 'nd' ? ND : levelLabel(l);
}

function summaryOf(l: WatchLevel | undefined): string {
  const dot = l && l !== 'nd' ? `<i class="tb-dot tb-dot--${l}" aria-hidden="true"></i>` : '';
  return `${dot}${escapeHtml(levelWordOf(l))}`;
}

/** L'essentiel en une phrase par mode : ce que disent les points de vigilance, sinon l'état de la pastille. */
export function transportLead(d: Pick<TransportBriefData, 'points' | 'levels'>): string {
  const calm: string[] = [];
  const down: string[] = [];
  const parts: string[] = [];
  for (const mode of MODES) {
    const pts = d.points.filter((p) => p.mode === mode);
    const label = TRANSPORT_MODE_LABEL[mode];
    if (pts.length > 0) {
      const names = pts.slice(0, 3).map((p) => p.title);
      const more = pts.length > 3 ? ` et ${pts.length - 3} autre${pts.length - 3 > 1 ? 's' : ''}` : '';
      parts.push(`${label} : ${names.join(', ')}${more}`);
    } else if (d.levels[mode] === 'nd') {
      down.push(label.toLowerCase());
    } else if (d.levels[mode] === 'jaune' || d.levels[mode] === 'orange' || d.levels[mode] === 'rouge') {
      parts.push(`${label} : ${levelLabel(d.levels[mode] as VigilanceLevel).toLowerCase()}, sans point localisé`);
    } else if (d.levels[mode] === 'vert') {
      calm.push(label.toLowerCase());
    }
  }
  if (calm.length > 0) parts.push(`${calm.length > 1 ? `${calm.slice(0, -1).join(', ')} et ${calm.at(-1)}` : calm[0]} : rien d’anormal`.replace(/^./, (c) => c.toUpperCase()));
  if (down.length > 0) parts.push(`source indisponible : ${down.join(', ')}`.replace(/^./, (c) => c.toUpperCase()));
  return parts.length > 0 ? `${parts.join('. ')}.` : 'Sources Transports en cours de lecture.';
}

// ─── Points de vigilance ───

function pointRow(p: TransportVigilancePoint): string {
  const tag = `<span class="tb-tag tb-tag--${p.causeTag === 'annoncée' ? 'ok' : 'verif'}">${p.causeTag === 'annoncée' ? 'cause annoncée' : 'à vérifier'}</span>`;
  return `<div class="tb-point is-link" role="button" tabindex="0" data-lon="${p.lon}" data-lat="${p.lat}" data-point="${p.n}">`
    + `<span class="tb-num tb-num--${p.level}">${p.n}</span><div class="tb-body">`
    + `<b>${escapeHtml(p.title)}</b> <span class="tb-short">${escapeHtml(p.short)}</span>`
    + `<small>${escapeHtml(p.detail)}</small>`
    + `<small>Cause : ${escapeHtml(p.cause ?? 'non précisée par la source')} ${tag}</small>`
    + `<small class="tb-who">Concerne : ${escapeHtml(p.who)}</small></div></div>`;
}

export function pointsSection(points: readonly TransportVigilancePoint[], open: OpenFn): FicheSection {
  const html = points.length === 0
    ? emptyLine('Aucun point de vigilance : pas d’axe ferroviaire très perturbé, ni d’événement météo ou de coupure sur le réseau national, ni d’urgence en vol ou en mer.')
    : points.map(pointRow).join('') + note('Même numéro sur la carte ; clic : la carte se centre sur le point.');
  return { id: 'tb-points', title: 'Points de vigilance', collapsible: true, open: open('tb-points', true), summary: String(points.length), html };
}

// ─── Rail ───

function railSection(d: TransportBriefData, now: number, open: OpenFn): FicheSection {
  const base = { id: 'tb-rail', title: 'Réseau ferroviaire', collapsible: true, open: open('tb-rail', true), summary: summaryOf(d.levels.trafficRail) };
  const r = d.rail;
  if (!r || r.updatedAt === null) return { ...base, html: emptyLine('API SNCF indisponible : aucun chiffre affiché.') };
  const groups = [...r.axes, ...r.regions];
  const cancelled = groups.reduce((s, g) => s + g.cancelled, 0);
  const share = railCancelledShare(groups);
  const tracked = groups.reduce((s, g) => s + g.trains, 0);
  const sorted = groups.filter((g) => g.trains > 0).sort((a, b) => (b.avgDelayMin ?? -1) - (a.avgDelayMin ?? -1)).slice(0, 10);
  const rows = sorted.map((g) => {
    const level = railGroupLevel(g);
    const lv = level === 'gris' ? null : level;
    return `<tr><th scope="row">${lv ? `<i class="tb-dot tb-dot--${lv}" aria-hidden="true"></i>` : ''}${escapeHtml(g.label)}</th><td>${valueHtml(frNumber(g.trains, 0))}</td>`
      + `<td>${valueHtml(formatMinutes(g.avgDelayMin), lv === 'orange' || lv === 'rouge' ? lv : null)}</td><td>${valueHtml(formatMinutes(g.maxDelayMin))}</td>`
      + `<td>${valueHtml(frNumber(g.cancelled, 0))}</td></tr>`;
  }).join('');
  const table = rows === '' ? '' : `<table class="lp-tbl"><thead><tr><th scope="col">Axe ou région</th><th scope="col">Trains</th><th scope="col">Moyen</th>`
    + `<th scope="col">Max</th><th scope="col">Suppr.</th></tr></thead><tbody>${rows}</tbody></table>`;
  const top = r.topDelays.slice(0, 3).map((t) => `n°${NBSP}${t.number} ${stationName(t.origin)}-${stationName(t.destination)} (${t.effect === 'supprime' ? 'supprimé' : formatMinutes(t.delayMin)})`);
  const worst = worstGroup(groups);
  const situations = d.situations?.situations ?? [];
  const byKind = new Map<string, number>();
  for (const s of situations) byKind.set(s.causeKind, (byKind.get(s.causeKind) ?? 0) + 1);
  const html = `<p class="tb-reason">${escapeHtml(glueUnits(railLevel(r).reason))}</p>`
    + kvRow('Grandes lignes en circulation signalées', valueHtml(frNumber(r.longDistance.active, 0)))
    + kvRow('dont à 15\u00a0min ou plus', valueHtml(frNumber(r.longDistance.delayed15, 0)))
    + kvRow('Trains supprimés', valueHtml(`${frNumber(cancelled, 0)}${share !== null ? ` (${frNumber(share * 100, 0)}${NBSP}% de ${frNumber(tracked, 0)} trains suivis)` : ''}`))
    + (worst ? kvRow('Axe ou région le plus retardé', valueHtml(`${worst.label} · ${formatMinutes(worst.avgDelayMin)}`)) : '')
    + table
    + (top.length > 0 ? note(`Plus forts retards : ${top.join(' ; ')}.`) : '')
    + note(`SNCF, ${clockOf(r.updatedAt, now)}${d.situations?.at ? ` · SIRI SX, ${clockOf(d.situations.at, now)} : ${frNumber(situations.length, 0)} situations`
      + `${byKind.size > 0 ? ` (${[...byKind].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${n} ${RAIL_CAUSE_WORD[k] ?? k}`).join(', ')})` : ''}` : ''}.`);
  return { ...base, html };
}

const RAIL_CAUSE_WORD: Readonly<Record<string, string>> = {
  travaux: 'travaux', autre: 'autres', intemperies: 'intempéries', 'panne-train': 'pannes de train', 'panne-installation': 'pannes d’installation',
  obstacle: 'obstacles', 'passage-a-niveau': 'passages à niveau', 'forces-ordre': 'interventions des forces de l’ordre', malaise: 'malaises',
};

// ─── Route ───

function roadSection(d: TransportBriefData, now: number, open: OpenFn): FicheSection {
  const base = { id: 'tb-road', title: 'Trafic routier', collapsible: true, open: open('tb-road', true), summary: summaryOf(d.levels.trafficRoad) };
  const n = d.road;
  if (!n || n.publishedAt === null) return { ...base, html: emptyLine('Flux des DIR indisponible : aucun chiffre affiché.') };
  const counts = new Map<RoadEventKind, number>();
  for (const e of n.events) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
  const kinds = [...counts].sort((a, b) => ROAD_KIND_ORDER[a[0]] - ROAD_KIND_ORDER[b[0]]);
  const rows = kinds.map(([k, c]) => `<tr><th scope="row">${escapeHtml(capitalize(ROAD_KIND_WORD[k]))}</th><td>${valueHtml(frNumber(c, 0))}</td></tr>`).join('')
    + `<tr><th scope="row">Travaux et coupures de longue durée</th><td>${valueHtml(frNumber(n.longTerm.length, 0))}</td></tr>`;
  const sections = n.sections.filter((s) => s.status !== 'unknown');
  const congested = sections.filter((s) => s.status === 'congested').length;
  const heavy = sections.filter((s) => s.status === 'heavy').length;
  const urban = d.urban;
  const jams = urban ? urban.agglos.reduce((s, a) => s + a.jams, 0) : null;
  const jamKm = urban ? urban.agglos.reduce((s, a) => s + a.jamKm, 0) : null;
  const html = `<p class="tb-reason">${escapeHtml(glueUnits(roadLevel(n).reason))}</p>`
    + kvRow('Incidents en cours (réseau national)', valueHtml(frNumber(n.counts.incidents, 0)))
    + kvRow('Accidents · coupures', valueHtml(`${frNumber(n.counts.accidents, 0)} · ${frNumber(n.counts.closures, 0)}`))
    + kvRow('Vitesse médiane mesurée', valueHtml(n.speeds.median !== null ? `${formatKmh(n.speeds.median)} (${frNumber(n.speeds.stations, 0)} stations)` : ND))
    + `<table class="lp-tbl"><thead><tr><th scope="col">Nature</th><th scope="col">En cours</th></tr></thead><tbody>${rows}</tbody></table>`
    + note(`Autoroutes concédées (CNIR) : ${n.conceded.jams.length > 0 ? n.conceded.jams.slice(0, 4).map((j) => `${j.motorway}${j.from ? ` ${j.from}` : ''}${j.lengthKm !== null ? ` (${frNumber(j.lengthKm, 0)}${NBSP}km)` : ''}`).join(' ; ') : 'aucun bouchon signalé'}.`)
    + note(`Agglomérations (Traficolor, mesuré) : ${frNumber(n.agglos.length, 0)} réseaux, ${frNumber(congested, 0)} tronçons saturés et ${frNumber(heavy, 0)} denses sur ${frNumber(sections.length, 0)}.`)
    + note(urban && jams !== null && jamKm !== null
      ? `Bouchons TomTom (agglomérations) : ${frNumber(jams, 0)}, ${frNumber(jamKm, 1)}${NBSP}km, relevé de ${clockOf(urban.collectedAt, now)}.`
      : `Bouchons TomTom (agglomérations) : ${ND}${d.urbanError ? `, ${glueUnits(d.urbanError)}` : ''}.`)
    + note(`DIR (DATEX II), ${clockOf(n.publishedAt, now)}.`);
  return { ...base, html };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Aérien ───

function airSection(d: TransportBriefData, now: number, open: OpenFn): FicheSection {
  const base = { id: 'tb-air', title: 'Trafic aérien', collapsible: true, open: open('tb-air', false), summary: summaryOf(d.levels.trafficAir) };
  const a = d.air;
  if (!a || a.at === null) return { ...base, html: emptyLine('OpenSky indisponible : aucun chiffre affiché.') };
  const gap = airNormalGap(a);
  const airports = [...a.airports].sort((x, y) => (y.departures ?? -1) - (x.departures ?? -1));
  const rows = airports.map((p) => `<tr><th scope="row">${escapeHtml(`${p.name} (${p.iata})`)}</th><td>${valueHtml(p.departures === null ? ND : frNumber(p.departures, 0))}</td>`
    + `<td>${valueHtml(frNumber(p.approaching, 0))}</td></tr>`).join('');
  const html = `<p class="tb-reason">${escapeHtml(glueUnits(airLevel(a).reason))}</p>`
    + kvRow('Avions au-dessus du territoire', valueHtml(frNumber(a.airborneFrance, 0)))
    + kvRow('En vol dans la zone suivie', valueHtml(frNumber(a.airborneZone, 0)))
    + kvRow('Écart à la même heure (7 jours)', valueHtml(gap ? formatSignedPct(gap.pct, 0) : 'référence en construction'))
    + (rows ? `<table class="lp-tbl"><thead><tr><th scope="col">Aéroport</th><th scope="col">Départs 2${NBSP}h</th><th scope="col">En approche</th></tr></thead><tbody>${rows}</tbody></table>` : '')
    + note(`Urgences en cours : ${a.emergencies.length === 0 ? 'aucune' : frNumber(a.emergencies.length, 0)} ; journal du jour : ${frNumber(a.emergencyLog.length, 0)} épisodes.`)
    + note(`OpenSky, ${clockOf(a.at, now)}.`);
  return { ...base, html };
}

// ─── Maritime ───

function maritimeSection(d: TransportBriefData, now: number, open: OpenFn): FicheSection {
  const base = { id: 'tb-sea', title: 'Trafic maritime', collapsible: true, open: open('tb-sea', false), summary: summaryOf(d.levels.trafficMaritime) };
  const m = d.maritime;
  if (!m || m.at === null) return { ...base, html: emptyLine('AIS indisponible : aucun chiffre affiché.') };
  const rows = m.ports.map((p) => `<tr><th scope="row">${escapeHtml(p.port)}</th><td>${valueHtml(p.lastSeenAt ? frNumber(p.vessels, 0) : ND)}</td>`
    + `<td>${valueHtml(p.lastSeenAt ? frNumber(p.atAnchor, 0) : ND)}</td></tr>`).join('');
  const silent = m.ports.filter((p) => !p.lastSeenAt).map((p) => p.port);
  const html = `<p class="tb-reason">${escapeHtml(maritimeLevel(m).reason)}</p>`
    + kvRow('Navires dans les eaux suivies', valueHtml(frNumber(m.vessels, 0)))
    + kvRow('Pétroliers · navires à passagers', valueHtml(`${frNumber(m.sensitive.tankers, 0)} · ${frNumber(m.sensitive.passenger, 0)}`))
    + kvRow('Type déclaré', valueHtml(`${frNumber(m.typedShare, 0)}${NBSP}% des navires`))
    + (rows ? `<table class="lp-tbl"><thead><tr><th scope="col">Port</th><th scope="col">Navires</th><th scope="col">Au mouillage</th></tr></thead><tbody>${rows}</tbody></table>` : '')
    + (silent.length > 0 ? note(`${silent.join(', ')} : aucune réception AIS depuis 24${NBSP}h (couverture des récepteurs), pas un port vide.`) : '')
    + note(`AIS (relais, récepteurs bénévoles), ${clockOf(m.lastMessageAt, now)}.`);
  return { ...base, html };
}

// ─── Écart à la normale ───

function normalSection(d: TransportBriefData, open: OpenFn): FicheSection {
  const gap = airNormalGap(d.air);
  const r = d.rail;
  const n = d.road;
  const row = (label: string, value: string, normal: string, delta: string): string =>
    `<tr><th scope="row">${escapeHtml(label)}</th><td>${valueHtml(value)}</td><td>${valueHtml(normal)}</td><td>${valueHtml(delta)}</td></tr>`;
  const html = `<table class="lp-tbl"><thead><tr><th scope="col">Indicateur</th><th scope="col">Maintenant</th><th scope="col">Normale</th><th scope="col">Écart</th></tr></thead><tbody>`
    + row('Avions dans la zone suivie', d.air && d.air.at !== null ? frNumber(d.air.airborneZone, 0) : ND, gap ? frNumber(gap.normal, 0) : ND, gap ? formatSignedPct(gap.pct, 0) : ND)
    + row('Grandes lignes à 15\u00a0min ou plus', r && r.updatedAt !== null ? `${frNumber(r.longDistance.delayed15, 0)} sur ${frNumber(r.longDistance.active, 0)}` : ND, ND, ND)
    + row('Incidents routiers en cours', n && n.publishedAt !== null ? frNumber(n.counts.incidents, 0) : ND, ND, ND)
    + '</tbody></table>'
    + note('Normale : moyenne des 7 jours précédents à la même heure. L’aérien se compare dès maintenant (journal de 8 jours du serveur) ; rail et route : n.d. tant que leur journal ne couvre pas 14 jours.');
  return { id: 'tb-normal', title: 'Écart à la normale', collapsible: true, open: open('tb-normal', false), summary: gap ? formatSignedPct(gap.pct, 0) : ND, html };
}

/** Sections Transports de l'En bref, dans l'ordre de lecture du décideur. */
export function transportBriefSections(d: TransportBriefData, now: number, open: OpenFn): FicheSection[] {
  return [pointsSection(d.points, open), railSection(d, now, open), roadSection(d, now, open), airSection(d, now, open), maritimeSection(d, now, open), normalSection(d, open)];
}

/** Lignes de la note à copier : points de vigilance et état de chaque mode. Texte brut. */
export function transportNoteLines(d: TransportBriefData): string[] {
  const lines = ['Points de vigilance :'];
  if (d.points.length === 0) lines.push('- aucun.');
  for (const p of d.points) {
    lines.push(`- ${p.n}. ${p.title} (${levelLabel(p.level).toLowerCase()}) : ${p.short}. ${p.detail} Cause : ${p.cause ?? 'non précisée par la source'} (${p.causeTag === 'annoncée' ? 'cause annoncée' : 'à vérifier'}).`);
  }
  lines.push('', 'Par mode :');
  for (const mode of MODES) lines.push(`- ${TRANSPORT_MODE_LABEL[mode]} : ${levelWordOf(d.levels[mode]).toLowerCase()}.`);
  return lines;
}
