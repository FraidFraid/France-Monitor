// src/components/layer-panel/maritime-tabs.ts : onglets Marine nationale et Alertes du panneau Trafic maritime, fiche d'un navire et
// aiguillage des trois onglets (spec 2026-10-03 trafics § 3.4) ; vue pure. Contenu de l'ancien MaritimePanel repris dans le cadre :
// navires militaires, pavillons à risque (millésime affiché), recherche et filtre de territoire gardés, listes paginées, sans police
// à chasse fixe ; l'ancienne liste « Trafic FR » est le filtre « Tous les navires » de l'onglet Alertes.
import type { MaritimeSnapshot } from '../../types/index.ts';
import { FRENCH_MARITIME_TERRITORIES, isInFranceZone, type FrenchMaritimeTerritoryCode } from '../../config/french-ports.ts';
import { BLACK_LIST_FLAGS, GREY_LIST_FLAGS, RISK_FLAGS_VINTAGE, SANCTIONED_FLAGS, type FlagRisk } from '../../config/risk-flags.ts';
import type { AisConnectionStatus } from '../../services/ais-connection.ts';
import type { MilitaryShip, RiskLevel } from '../../services/military-ships.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { absoluteTime, kvRow } from '../fiche/kit.ts';
import type { FicheSection } from '../fiche/parts.ts';
import { NBSP, frNumber } from './format.ts';
import { emptyLine, listRow, loadingBody, sourceErrorCallout, sourceLinkHtml, valueHtml, type LayerTab, type LayerView } from './frame.ts';
import { maritimeHead, maritimeMethodSection, veilleSections, type MaritimeTab, type MaritimeVeilleInput } from './maritime.ts';
import { CAT_PORT, coordText, dataMs, fold, formatKm, formatKnots, formatMeters, note, plural } from './traffic-format.ts';

export type MaritimeAlertFilter = 'alertes' | 'risque-eleve' | 'pavillon' | 'tous';
export const MARITIME_ALERT_FILTERS: readonly MaritimeAlertFilter[] = ['alertes', 'risque-eleve', 'pavillon', 'tous'];
export const MARITIME_PAGE_SIZE = 20;

/** Risque d'un navire (critères de military-ships.ts) dans la palette des niveaux : aucun vert, faible jaune, modéré orange, élevé et critique rouge. */
export const RISK_LEVEL: Readonly<Record<RiskLevel, VigilanceLevel>> = { none: 'vert', low: 'jaune', medium: 'orange', high: 'rouge', critical: 'rouge' };
const RISK_WORD: Readonly<Record<RiskLevel, string>> = { none: 'nul', low: 'faible', medium: 'modéré', high: 'élevé', critical: 'critique' };
const RISK_ORDER: Readonly<Record<RiskLevel, number>> = { none: 0, low: 1, medium: 2, high: 3, critical: 4 };
const FILTER_LABEL: Readonly<Record<MaritimeAlertFilter, string>> = {
  alertes: 'Alertes', 'risque-eleve': 'Risque élevé', pavillon: 'Pavillon suspect', tous: 'Tous les navires',
};
const FLAG_WORD: Readonly<Record<FlagRisk, string | null>> = {
  blacklist: 'liste noire Paris MOU', greylist: 'liste grise Paris MOU', sanctioned: 'registre sous sanctions (OFAC)', none: null,
};
/** Statuts de navigation AIS (classe A). */
const NAV_STATUS: Readonly<Record<number, string>> = {
  0: 'En route (moteur)', 1: 'Au mouillage', 2: 'Non maître de sa manœuvre', 3: 'Manœuvrabilité restreinte', 4: 'Contraint par son tirant d’eau',
  5: 'Amarré', 6: 'Échoué', 7: 'En pêche', 8: 'À la voile', 15: 'Non défini',
};

export interface MaritimeLiveInput {
  status: AisConnectionStatus;
  lastMessageAt: number | null;
  /** Base de la Marine nationale avec positions (getMilitaryShips). */
  navy: readonly MilitaryShip[];
  /** Trafic vivant dans les eaux françaises (getAllLiveTraffic, 10 min). */
  traffic: readonly MilitaryShip[];
  search: string;
  territory: FrenchMaritimeTerritoryCode | 'all';
  filter: MaritimeAlertFilter;
  /** Pages de MARITIME_PAGE_SIZE navires affichées (1 au moins). */
  pages: number;
  /** Fiche navire ouverte (liste ou clic sur la carte). */
  selected: MilitaryShip | null;
}

export interface MaritimeViewInput {
  snapshot: MaritimeSnapshot | null;
  error: string | null;
  tab: MaritimeTab;
  live: MaritimeLiveInput;
  now: number;
  open: (sectionId: string, byDefault: boolean) => boolean;
}
type OpenFn = MaritimeViewInput['open'];

export function isAlertShip(s: MilitaryShip): boolean {
  return RISK_ORDER[s.riskLevel ?? 'none'] >= RISK_ORDER.medium;
}

function flagIso(s: MilitaryShip): string {
  return (s.country ?? '').split('|')[0] ?? '';
}
function flagName(s: MilitaryShip): string {
  return (s.country ?? '').split('|')[1] ?? '';
}
function flagged(s: MilitaryShip): boolean {
  const iso = flagIso(s);
  return BLACK_LIST_FLAGS.has(iso) || GREY_LIST_FLAGS.has(iso) || SANCTIONED_FLAGS.has(iso);
}

const FILTERS: Readonly<Record<MaritimeAlertFilter, (s: MilitaryShip) => boolean>> = {
  alertes: isAlertShip, 'risque-eleve': (s) => s.riskLevel === 'high' || s.riskLevel === 'critical', pavillon: flagged, tous: () => true,
};

function aisStale(live: MaritimeLiveInput): boolean {
  return live.status === 'stale' || live.status === 'disconnected';
}

function inTerritory(s: MilitaryShip, territory: MaritimeLiveInput['territory']): boolean {
  return territory === 'all' || isInFranceZone(s.lat, s.lon, territory);
}

function searched(s: MilitaryShip, search: string): boolean {
  const q = search.trim();
  return q === '' || fold(s.name).includes(fold(q)) || (s.mmsi?.startsWith(q) ?? false);
}

export function maritimeTabs(_snapshot: MaritimeSnapshot | null, live: MaritimeLiveInput): LayerTab[] {
  return [
    { id: 'veille', label: 'Veille' },
    { id: 'marine', label: 'Marine nationale', count: live.navy.filter((s) => s.isLive === true).length },
    { id: 'alertes', label: 'Alertes', count: live.traffic.filter(isAlertShip).length },
  ];
}

// ─── Outils de liste ───

function toolbar(live: MaritimeLiveInput, withFilters: boolean): string {
  const options = [`<option value="all"${live.territory === 'all' ? ' selected' : ''}>Tous les territoires français</option>`,
    ...FRENCH_MARITIME_TERRITORIES.map((t) => `<option value="${escapeHtml(t.code)}"${t.code === live.territory ? ' selected' : ''}>${escapeHtml(t.name)}</option>`)].join('');
  const chips = withFilters ? `<div class="lp-seg" role="group" aria-label="Filtre des navires">${MARITIME_ALERT_FILTERS.map((f) =>
    `<button type="button" class="lp-toggle" data-mar-filter="${f}" aria-pressed="${f === live.filter}">${FILTER_LABEL[f]}</button>`).join('')}</div>` : '';
  return `<div class="lp-toolbar"><input type="search" class="lp-search" data-mar-search value="${escapeHtml(live.search)}" placeholder="Nom ou MMSI" `
    + `aria-label="Rechercher un navire par nom ou MMSI"><select class="lp-select" data-mar-territory aria-label="Territoire">${options}</select></div>${chips}`;
}

function homonymKeys(ships: readonly MilitaryShip[]): Set<string> {
  const counts = new Map<string, number>();
  for (const s of ships) {
    const key = fold(s.name);
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([k]) => k));
}

function shipRow(s: MilitaryShip, homonyms: ReadonlySet<string>, stale: boolean, now: number): string {
  const dup = homonyms.has(fold(s.name)) && s.mmsi !== undefined;
  const country = flagName(s);
  const seen = s.lastSeen !== undefined ? `vu à ${absoluteTime(s.lastSeen, now, 'fr')}`
    : s.isLive === false && s.port ? `position de référence : ${s.port}` : null;
  const role = s.role && s.role !== 'Civil/Inconnu' ? s.role : null;
  const noteText = [s.type, role, country ? `pavillon ${country}` : null, s.maritimeTerritory?.name ?? null,
    s.nearestPort ? `${s.nearestPort.name} à ${formatKm(s.nearestPort.distanceKm, 0)}` : null, seen, ...(s.riskReasons ?? [])]
    .filter((x): x is string => x !== null && x !== '').join(' · ');
  return listRow({
    text: dup ? `${s.name} · MMSI …${s.mmsi?.slice(-4) ?? ''}` : s.name,
    value: s.isLive === false ? 'port d’attache' : s.speed !== undefined ? formatKnots(s.speed) : 'n.d.',
    level: stale ? 'gris' : RISK_LEVEL[s.riskLevel ?? 'none'], note: noteText, data: { 'mar-ship': s.mmsi ?? s.id }, link: true,
  });
}

function paged(ships: readonly MilitaryShip[], live: MaritimeLiveInput, now: number, empty: string): string {
  const limit = Math.max(1, live.pages) * MARITIME_PAGE_SIZE;
  const homonyms = homonymKeys(ships);
  const stale = aisStale(live);
  const rest = ships.length - Math.min(limit, ships.length);
  if (ships.length === 0) return emptyLine(empty);
  return ships.slice(0, limit).map((s) => shipRow(s, homonyms, stale, now)).join('')
    + (rest > 0 ? `<button type="button" class="lp-toggle" data-mar-more>Afficher ${Math.min(MARITIME_PAGE_SIZE, rest)} de plus (${rest} restants)</button>` : '');
}

// ─── Marine nationale ───

function navySection(live: MaritimeLiveInput, now: number, open: OpenFn): FicheSection {
  const ships = live.navy.filter((s) => inTerritory(s, live.territory) && searched(s, live.search))
    .sort((a, b) => Number(b.isLive === true) - Number(a.isLive === true) || a.name.localeCompare(b.name, 'fr'));
  const atSea = live.navy.filter((s) => s.isLive === true).length;
  return {
    id: 'navy', title: 'Marine nationale', collapsible: true, open: open('navy', true),
    summary: escapeHtml(`${plural(atSea, 'en mer suivi', 'en mer suivis')} · ${plural(live.navy.length, 'navire')}`),
    html: toolbar(live, false) + paged(ships, live, now, 'Aucun navire de la Marine nationale pour ce choix.')
      + note('Navires de la Marine nationale identifiés par leur MMSI ; sans position AIS depuis 10 minutes, position de référence au port d’attache. Remplace le filtre « Militaire » de l’ancienne liste : les navires militaires étrangers se trouvent dans Alertes (risque élevé).'),
  };
}

// ─── Alertes ───

function alertsSection(live: MaritimeLiveInput, now: number, open: OpenFn): FicheSection {
  const inScope = live.traffic.filter((s) => inTerritory(s, live.territory));
  const ships = inScope.filter((s) => FILTERS[live.filter](s) && searched(s, live.search))
    .sort((a, b) => (live.filter === 'tous' ? 0 : RISK_ORDER[b.riskLevel ?? 'none'] - RISK_ORDER[a.riskLevel ?? 'none'])
      || (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
  const n = ships.length;
  const stale = aisStale(live);
  const counted = live.filter === 'alertes' ? plural(n, 'alerte') : live.filter === 'risque-eleve' ? `${frNumber(n, 0)} à risque élevé`
    : live.filter === 'pavillon' ? `${frNumber(n, 0)} sous pavillon à risque` : plural(n, 'navire suivi', 'navires suivis');
  // Flux figé : une absence d'alerte calculée sur des positions figées n'est jamais un fait (T3).
  const summary = !stale ? counted : live.filter !== 'tous' && n === 0 ? 'alertes non évaluées' : `${counted} (AIS indisponible)`;
  const empty = stale && live.traffic.length === 0 ? 'AIS indisponible : aucune position reçue.'
    : stale && live.filter !== 'tous' ? 'AIS indisponible : alertes non évaluées.'
    : live.status === 'connecting' && live.traffic.length === 0 ? 'Connexion au relais AIS…'
    : live.filter === 'tous' ? 'Aucun navire suivi pour ce choix.'
    : `Aucune ${live.filter === 'alertes' ? 'alerte' : 'correspondance'} parmi ${plural(inScope.length, 'navire suivi', 'navires suivis')}.`;
  return {
    id: 'alerts', title: 'Alertes', collapsible: true, open: open('alerts', true), summary: escapeHtml(summary),
    html: toolbar(live, true) + paged(ships, live, now, empty)
      + note(`Risque calculé sur les positions AIS : pavillon sous sanctions (OFAC) ou sur les listes noire et grise du Paris MOU, cargo au-delà de 22${NBSP}nœuds, navire militaire étranger. Listes : ${RISK_FLAGS_VINTAGE.parisMou} ; ${RISK_FLAGS_VINTAGE.sanctions}.`),
  };
}

function flagsSection(open: OpenFn): FicheSection {
  const names = new Intl.DisplayNames(['fr'], { type: 'region' });
  const list = (codes: ReadonlySet<string>): string => [...codes].map((c) => names.of(c) ?? c).sort((a, b) => a.localeCompare(b, 'fr')).join(', ');
  return {
    id: 'flags', title: 'Pavillons à risque', collapsible: true, open: open('flags', false),
    summary: escapeHtml(`${RISK_FLAGS_VINTAGE.parisMou} · ${RISK_FLAGS_VINTAGE.sanctions}`),
    html: listRow({ text: `Liste noire (${RISK_FLAGS_VINTAGE.parisMou})`, level: 'rouge', note: list(BLACK_LIST_FLAGS) })
      + listRow({ text: `Liste grise (${RISK_FLAGS_VINTAGE.parisMou})`, level: 'orange', note: list(GREY_LIST_FLAGS) })
      + listRow({ text: `Registres sous sanctions (${RISK_FLAGS_VINTAGE.sanctions})`, level: 'rouge', note: list(SANCTIONED_FLAGS) })
      + note('Pavillon déduit du MMSI (indicatif du pays) ; listes saisies dans le code de l’application et datées ci-dessus.'),
  };
}

// ─── Fiche navire ───

function pad(n: number | undefined): string {
  return n === undefined ? '' : String(n).padStart(2, '0');
}

function trailSvg(trail: ReadonlyArray<readonly [number, number]>): string {
  if (trail.length < 3) return '';
  const W = 384;
  const H = 110;
  const P = 10;
  const lons = trail.map((p) => p[0]);
  const lats = trail.map((p) => p[1]);
  const [minLon, maxLon, minLat, maxLat] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
  const x = (lon: number): string => (P + ((lon - minLon) / (maxLon - minLon || 1)) * (W - 2 * P)).toFixed(1);
  const y = (lat: number): string => (H - P - ((lat - minLat) / (maxLat - minLat || 1)) * (H - 2 * P)).toFixed(1);
  const last = trail[trail.length - 1];
  return `<svg class="lp-chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Route récente (${trail.length} positions)">`
    + `<polyline points="${trail.map(([lon, lat]) => `${x(lon)},${y(lat)}`).join(' ')}" fill="none" stroke="${CAT_PORT}" stroke-width="1.5"/>`
    + (last ? `<circle cx="${x(last[0])}" cy="${y(last[1])}" r="4" fill="${CAT_PORT}"/>` : '') + '</svg>';
}

function kv(label: string, text: string | null): string {
  return kvRow(label, valueHtml(text ?? 'n.d.'));
}

function shipSections(s: MilitaryShip, stale: boolean, now: number, open: OpenFn): FicheSection[] {
  const eta = s.eta && s.eta.day !== undefined && s.eta.month !== undefined && s.eta.hour !== undefined && s.eta.minute !== undefined
    ? `${pad(s.eta.day)}/${pad(s.eta.month)} ${pad(s.eta.hour)}:${pad(s.eta.minute)} UTC` : null;
  const position = kv('Statut', s.navStatus !== undefined ? NAV_STATUS[s.navStatus] ?? `statut ${s.navStatus}` : null)
    + kv('Vitesse', s.speed !== undefined ? formatKnots(s.speed) : null)
    + kv('Cap sur le fond', s.cog !== undefined ? `${frNumber(s.cog, 0)}°` : null)
    + kv('Cap vrai', s.heading !== undefined ? `${frNumber(s.heading, 0)}°` : null)
    + kv('Destination déclarée', s.destination ?? null) + kv('Arrivée prévue', eta)
    + kv('Port le plus proche', s.nearestPort ? `${s.nearestPort.name} à ${formatKm(s.nearestPort.distanceKm, 0)}` : null)
    + kv('Territoire maritime', s.maritimeTerritory?.name ?? null) + kv('Coordonnées', coordText(s.lat, s.lon))
    + kv('Dernière position', s.lastSeen !== undefined ? absoluteTime(s.lastSeen, now, 'fr') : s.isLive === false ? 'port d’attache' : null)
    + trailSvg(s.trail ?? []);
  const flag = s.flagRisk ? FLAG_WORD[s.flagRisk] : null;
  const specs = kv('Type AIS', s.shipType !== undefined ? `${s.type} (code ${s.shipType})` : s.type)
    + kv('Pavillon', flagName(s) ? `${flagName(s)}${flag ? ` · ${flag}` : ''}` : null)
    + kv('Longueur', s.dimensions?.length !== undefined ? formatMeters(s.dimensions.length) : null)
    + kv('Largeur', s.dimensions?.width !== undefined ? formatMeters(s.dimensions.width) : null)
    + kv('Tirant d’eau', s.draught !== undefined ? `${frNumber(s.draught, 1)}${NBSP}m` : null)
    + kv('Port d’attache', s.port ?? null) + kv('MMSI', s.mmsi ?? null)
    + kv('IMO', s.imoNumber !== undefined ? String(s.imoNumber) : null) + kv('Indicatif', s.callSign ?? null);
  const risk = s.riskLevel ?? 'none';
  const reasons = s.riskReasons ?? [];
  const riskHtml = listRow({ text: `Risque ${RISK_WORD[risk]}`, level: stale ? 'gris' : RISK_LEVEL[risk] })
    + (reasons.length > 0 ? reasons.map((r) => listRow({ text: r, level: 'gris' })).join('') : emptyLine('Aucun critère de risque détecté.'))
    + note(`Sources : ${RISK_FLAGS_VINTAGE.parisMou} ; registres sous sanctions (${RISK_FLAGS_VINTAGE.sanctions}) ; analyse du comportement AIS.`);
  const mmsi = s.mmsi ? encodeURIComponent(s.mmsi) : null;
  const imo = s.imoNumber !== undefined ? encodeURIComponent(String(s.imoNumber)) : null;
  const links = [
    mmsi ? sourceLinkHtml('MarineTraffic', `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${mmsi}`) : null,
    mmsi ? sourceLinkHtml('VesselTracker', `https://www.vesseltracker.com/en/Ships/mmsi/${mmsi}.html`) : null,
    mmsi ? sourceLinkHtml('VesselFinder', `https://www.vesselfinderimage.com/?mmsi=${mmsi}`) : null,
    imo ? sourceLinkHtml('Equasis (IMO)', 'https://www.equasis.org/EquasisWeb/public/HomePage') : null,
    imo ? sourceLinkHtml('ShipInfo (propriétaire)', `https://www.shipinfo.net/pages/default.aspx?shimsid=${imo}`) : null,
  ].filter((x): x is string => x !== null);
  return [
    { id: 'ship-position', title: `Position · ${s.name}`, collapsible: true, open: open('ship-position', true), html: position },
    { id: 'ship-specs', title: 'Caractéristiques', collapsible: true, open: open('ship-specs', true), html: specs },
    { id: 'ship-risk', title: 'Risque', collapsible: true, open: open('ship-risk', true), summary: escapeHtml(RISK_WORD[risk]), html: riskHtml },
    { id: 'ship-links', title: 'Liens', collapsible: true, open: open('ship-links', false),
      html: (links.length > 0 ? links.map((l) => `<p class="fmk-note">${l}</p>`).join('') : emptyLine('Aucun identifiant pour chercher ce navire.'))
        + note('Equasis donne accès aux données IMO : propriétaire, classe, certifications, inspections.') },
  ];
}

// ─── Aiguillage ───

function aisCallout(live: MaritimeLiveInput, now: number): string {
  if (!aisStale(live)) return '';
  const text = live.lastMessageAt !== null ? `AIS indisponible depuis ${absoluteTime(live.lastMessageAt, now, 'fr')} : positions figées.`
    : 'AIS indisponible : aucun message reçu.';
  return `<p class="fmk-callout lp-callout">${escapeHtml(text)}</p>`;
}

export function buildMaritimeView(input: MaritimeViewInput): LayerView {
  const { snapshot: s, error, tab, live, now, open } = input;
  const tabs = maritimeTabs(s, live);
  const veilleInput: MaritimeVeilleInput = { snapshot: s, error, now, open };
  const head = maritimeHead(s, error, now);
  const method = maritimeMethodSection(veilleInput);
  if (live.selected) {
    return {
      head, tabs, activeTab: tab, sections: [...shipSections(live.selected, aisStale(live), now, open), method],
      bodyHtml: '<button type="button" class="lp-toggle" data-mar-back>Retour à la liste</button>' + aisCallout(live, now),
    };
  }
  if (tab === 'veille') {
    if (s === null && error === null) return { head, tabs, activeTab: tab, sections: [], bodyHtml: loadingBody() };
    const callout = error !== null ? sourceErrorCallout(s ? dataMs(s.lastMessageAt) : null, now) : '';
    // Le retard de l'AIS est dit par l'en-tête (« AIS indisponible depuis hh:mm ») et retire les couleurs des sections.
    return { head, tabs, activeTab: tab, sections: [...veilleSections(veilleInput), method], bodyHtml: callout || undefined };
  }
  const sections = tab === 'marine' ? [navySection(live, now, open), method] : [alertsSection(live, now, open), flagsSection(open), method];
  return { head, tabs, activeTab: tab, sections, bodyHtml: aisCallout(live, now) || undefined };
}
