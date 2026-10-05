// src/components/layer-panel/sovereignty-legend.ts : légendes et teintes des couches Souveraineté de la carte (spec 2026-10-04
// souveraineté § 2 ; contrats § 3.9) : sources réellement appelées avec leurs licences, date réelle de chaque donnée (S1) ; donnée en
// retard (S2) : « (en retard) » et couleurs retirées. Teintes de catégorie recopiées des jetons de main.css pour MapLibre, qui ne lit
// pas les variables CSS (égalité vérifiée par test). Jamais « temps réel », « ADS-B Exchange » ni « Marine Traffic » (audit 19).
import type {
  CablesWatchResponse, CyberResponse, DroneZonesFile, GnssResponse, MilitaryBase, MilitaryResponse, SubseaCablesFile,
} from '../../types/index.ts';
import { DRONES_LEGEND, DRONES_POINTER, DRONES_TITLE } from '../../services/sovereignty-drones.ts';
import { GNSS_ORANGE_PCT, GNSS_YELLOW_PCT, MILITARY_FIGURE_LABEL, isSovereigntyDataLate } from '../../services/sovereignty-levels.ts';
import { levelHex } from '../../services/vigilance.ts';
import type { LegendCategory, LegendItem } from '../MapLegend.ts';
import { NBSP } from './format.ts';
import { cablesUnevaluatedWhy, capitalize } from './sovereignty-format.ts';

const PARIS = 'Europe/Paris';
const HEADER_HEX = '#9898a8';
const LINE = '━━━';
const COLORS_GONE = 'En retard : couleurs retirées de la carte.';

/** Aéronef militaire du bloc OACI France (jeton --cat-mil-francais). */
export const MIL_FRANCAIS_HEX = '#4a9eff';
/** Aéronef militaire d'un autre pays (jeton --cat-mil-autres). */
export const MIL_AUTRES_HEX = '#ff6b9d';
/** Hors de France, jamais compté ; donnée en retard ; non évalué (jeton --cat-mil-etranger). */
export const SOV_ABROAD_HEX = '#d1d1d6';
/** Marine nationale (jeton --cat-navy). */
export const NAVY_HEX = '#00d4c8';
/** Tracé de câble télécom sous-marin (jeton --cat-cable). */
export const CABLE_HEX = '#22c7ff';
/** Atterrage de câble en France (jeton --cat-landing). */
export const LANDING_HEX = '#7dd3fc';
/** Sites de défense par catégorie : teintes de l'ancienne légende, gardées (triangles de la carte). */
export const BASE_TYPE_HEX: Readonly<Record<MilitaryBase['type'], string>> = {
  air: '#4a9eff', navy: '#00d4c8', army: '#22c55e', joint: '#a855f7', fortification: '#78716c', other: '#f59e0b',
};
/** Vulnérabilité exploitée du catalogue de la CISA (jeton --cat-kev) ; citée par le CERT-FR (jeton --cat-kev-cite). */
export const KEV_HEX = '#8e8ef0';
export const KEV_CITED_HEX = '#5e5ce6';
/** Revendications de rançongiciels (jeton --cat-revendication). */
export const CLAIMS_HEX = '#bf5af2';

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString('fr-FR', { timeZone: PARIS, hour: '2-digit', minute: '2-digit' });
}
function dayMonth(ms: number): string {
  return new Date(ms).toLocaleDateString('fr-FR', { timeZone: PARIS, day: '2-digit', month: '2-digit' });
}
function parse(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function copy(base: LegendCategory, items: readonly LegendItem[], refresh: string, notes: readonly string[]): LegendCategory {
  return { ...base, items: items.map((i) => ({ ...i })), refresh: { label: refresh }, notes: [...notes] };
}

// ─── Défense ───

const DEFENSE_ITEMS: readonly LegendItem[] = [
  { id: 'mil-header', label: capitalize(MILITARY_FIGURE_LABEL), color: HEADER_HEX, isHeader: true },
  { id: 'mil-autres', label: 'Autres pays', color: MIL_AUTRES_HEX, shape: 'circle' },
  { id: 'mil-abroad', label: 'Hors de France, jamais compté', color: SOV_ABROAD_HEX, shape: 'circle' },
  { id: 'mil-emergency-confirmed', label: 'Urgence confirmée (deux lectures)', color: levelHex('orange'), shape: 'ring' },
  { id: 'mil-emergency-once', label: 'Urgence vue une fois', color: levelHex('jaune'), shape: 'ring' },
  { id: 'navy-header', label: 'Marine nationale', color: HEADER_HEX, isHeader: true },
  { id: 'navy-observed', label: 'Bâtiment vu en AIS (heure en étiquette)', color: NAVY_HEX, shape: 'vessel' },
  { id: 'navy-reference', label: 'Port base : position de référence, pas une observation', color: NAVY_HEX, shape: 'ring' },
  { id: 'sites-header', label: 'Sites de défense (liste interne de sites publics)', color: HEADER_HEX, isHeader: true },
  { id: 'base-air', label: 'Base aérienne', color: BASE_TYPE_HEX.air, shape: 'triangle' },
  { id: 'base-navy', label: 'Base navale', color: BASE_TYPE_HEX.navy, shape: 'triangle' },
  { id: 'base-army', label: 'Site de l’armée de terre', color: BASE_TYPE_HEX.army, shape: 'triangle' },
  { id: 'base-joint', label: 'Site interarmées', color: BASE_TYPE_HEX.joint, shape: 'triangle' },
];
const OSM_WORKS_ITEM: LegendItem = { id: 'osm-works', label: 'Ouvrage OpenStreetMap (ODbL 1.0)', color: BASE_TYPE_HEX.fortification, shape: 'circle' };
const DEFENSE_NOTES: readonly string[] = [
  // S5 : la mer territoriale en milles, comme le panneau (jamais « 22 km »).
  `Au-dessus de la France : département métropolitain, ou au-dessus de la mer territoriale (moins de 12${NBSP}milles de la côte) ; pays par bloc d’adresse OACI.`,
  'Un appareil absent du flux n’est pas absent du ciel.',
  'Sites : liste interne de sites publics, sans date par site.',
];

export const DEFENSE_LEGEND: LegendCategory = {
  id: 'military',
  title: 'Défense',
  columns: 2,
  splitIndex: 5,
  items: [...DEFENSE_ITEMS],
  source: { label: 'Données adsb.lol, ODbL 1.0 · AIS : aisstream.io via le relais · sites : liste interne', url: 'https://www.adsb.lol' },
  refresh: { label: `Collecte du serveur toutes les 2${NBSP}min` },
  notes: [...DEFENSE_NOTES],
};

/** Défense datée : « Relevé adsb.lol 16:48 » ; en retard (10 min) : dit et couleurs retirées ; option des ouvrages OpenStreetMap. */
export function defenseLegend(m: MilitaryResponse | null, opts: { osmWorks: boolean; droneZones: boolean }, now: number): LegendCategory {
  const items = opts.osmWorks ? [...DEFENSE_ITEMS, OSM_WORKS_ITEM] : DEFENSE_ITEMS;
  const osmNote = opts.osmWorks ? ['Ouvrages OpenStreetMap (© les contributeurs d’OpenStreetMap, ODbL 1.0) : date du fichier dans le panneau.'] : [];
  const at = parse(m?.readAt);
  if (m === null || at === null) return copy(DEFENSE_LEGEND, items, 'adsb.lol indisponible', [...DEFENSE_NOTES, ...osmNote]);
  const late = isSovereigntyDataLate('adsb-mil', m.readAt, now);
  return copy(DEFENSE_LEGEND, items, `Relevé adsb.lol ${clock(at)}${late ? ' (en retard)' : ''}`, [...DEFENSE_NOTES, ...osmNote, ...(late ? [COLORS_GONE] : [])]);
}

// ─── Connectivité ───

const CONNECTIVITY_ITEMS: readonly LegendItem[] = [
  { id: 'cable-header', label: 'Câbles télécom sous-marins (Shom, OpenStreetMap)', color: HEADER_HEX, isHeader: true },
  { id: 'cable-route', label: 'Tracé de câble', color: CABLE_HEX, icon: LINE },
  { id: 'cable-landing', label: 'Atterrage en France', color: LANDING_HEX, shape: 'circle', borderColor: '#ffffff', borderWidth: 2 },
  { id: 'vessel-header', label: 'Navires lents sur un câble (AIS)', color: HEADER_HEX, isHeader: true },
  { id: 'vessel-confirmed', label: 'Confirmé sur deux relevés', color: levelHex('orange'), shape: 'circle' },
  { id: 'vessel-once', label: 'Vu une fois', color: levelHex('jaune'), shape: 'circle' },
  { id: 'vessel-unevaluated', label: 'Non évalué (AIS muet ou veille en panne)', color: SOV_ABROAD_HEX, shape: 'circle' },
];
const LICENCES_NOTE = 'Lien : fiche data.gouv.fr du Shom ; licences et lien OpenStreetMap (ODbL) : voir « Méthode et sources » du panneau.';
const PROXIMITY_NOTE = `Une proximité (moins de 500${NBSP}m, moins de 2${NBSP}nœuds) est « à vérifier », jamais une menace.`;

export const CONNECTIVITY_LEGEND: LegendCategory = {
  id: 'subseaCables',
  title: 'Connectivité',
  items: [...CONNECTIVITY_ITEMS],
  source: { label: 'Câbles : Shom (CC BY-SA), © les contributeurs d’OpenStreetMap, ODbL 1.0 · AIS : aisstream.io via le relais', url: 'https://www.data.gouv.fr/datasets/conduites-et-cables-sous-marins-repertories-par-le-shom/' },
  refresh: { label: `Veille du serveur toutes les 5${NBSP}min` },
  notes: ['Tracés du Shom (CC BY-SA) et d’OpenStreetMap, précision non garantie ; câbles électriques non retenus.', PROXIMITY_NOTE, LICENCES_NOTE],
};

/** Connectivité datée : « AIS à jour 16:47 », ou la cause d'une veille non évaluée (« AIS muet depuis hh:mm : alertes non évaluées ») ; fichier des câbles daté. */
export function connectivityLegend(file: SubseaCablesFile | null, watch: CablesWatchResponse | null, now: number): LegendCategory {
  const generated = parse(file?.generatedAt);
  const fileNote = file !== null && generated !== null
    ? `Tracés du Shom (CC BY-SA) et d’OpenStreetMap (ODbL 1.0) du ${dayMonth(generated)}, précision non garantie.`
    : 'Fichier des câbles illisible : tracés absents.';
  if (watch === null || watch.readAt === null) return copy(CONNECTIVITY_LEGEND, CONNECTIVITY_ITEMS, 'Veille des câbles indisponible', [fileNote, PROXIMITY_NOTE, LICENCES_NOTE]);
  const ais = parse(watch.aisLastMessageAt);
  if (!watch.evaluated) {
    return copy(CONNECTIVITY_LEGEND, CONNECTIVITY_ITEMS, `${capitalize(cablesUnevaluatedWhy(watch, now))} : alertes non évaluées`,
      [fileNote, PROXIMITY_NOTE, LICENCES_NOTE, 'Veille non évaluée : navires signalés en gris, ni confirmés ni retirés.']);
  }
  const late = isSovereigntyDataLate('ais-cables', watch.aisLastMessageAt, now);
  return copy(CONNECTIVITY_LEGEND, CONNECTIVITY_ITEMS, ais === null ? 'AIS : aucun message daté' : `AIS à jour ${clock(ais)}${late ? ' (en retard)' : ''}`,
    [fileNote, PROXIMITY_NOTE, LICENCES_NOTE, ...(late ? [COLORS_GONE] : [])]);
}

// ─── Vigilance cyber ───

export const CYBER_LEGEND: LegendCategory = {
  id: 'cyber',
  title: 'Vigilance cyber',
  items: [{ id: 'cyber-no-place', label: 'Pas de lieu publié : voir le panneau', color: HEADER_HEX, isHeader: true }],
  source: { label: 'CERT-FR (ANSSI) · CISA KEV · Ransomware.live · Have I Been Pwned · Cybermalveillance.gouv.fr', url: 'https://www.cert.ssi.gouv.fr' },
  refresh: { label: 'CERT-FR relu chaque heure' },
  notes: ['Aucun point n’est placé sans lieu réel : alertes, vulnérabilités et revendications restent dans le panneau.'],
};

/** Vigilance cyber datée par la lecture du CERT-FR (« CERT-FR lu à 16:47 ») ; en retard après 6 h. */
export function cyberLegend(c: CyberResponse | null, now: number): LegendCategory {
  const at = parse(c?.certfr.readAt);
  if (c === null || at === null) return copy(CYBER_LEGEND, CYBER_LEGEND.items, 'CERT-FR indisponible', CYBER_LEGEND.notes ?? []);
  const late = isSovereigntyDataLate('certfr', c.certfr.readAt, now);
  return copy(CYBER_LEGEND, CYBER_LEGEND.items, `CERT-FR lu à ${clock(at)}${late ? ' (en retard)' : ''}`, CYBER_LEGEND.notes ?? []);
}

// ─── Phase B (tâche B19) : jetons des zones drones, de l'indice Kp calme (G0) et du registre des gels ───
/** Zone drones DGAC « vol interdit » (jeton --cat-zone-drone). */
export const DRONE_ZONE_HEX = '#5e5ce6';
/** Indice Kp calme, G0 (jeton --cat-kp-calme). */
export const KP_CALM_HEX = '#64d2ff';
/** Registre des gels : barres et courbe (jeton --cat-gels). */
export const GELS_HEX = '#ac8e68';

// ─── Phase B (tâche B27) : mailles GNSS du jour UTC précédent et zones drones DGAC dans la légende Défense ───

/** Données de la phase B lues par App.ts ; dronesShown suit l'option « zones drones » de la couche Défense. */
export interface DefenseLegendB { gnss: GnssResponse | null; drones: DroneZonesFile | null; dronesShown: boolean }

/** « 04/10/2026 » (jour de Paris). */
function fullDateB(ms: number): string {
  return new Date(ms).toLocaleDateString('fr-FR', { timeZone: PARIS, day: '2-digit', month: '2-digit', year: 'numeric' });
}
/** « 07-2025 » pour l'édition « 2025-07-01 ». */
function editionB(edition: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(edition);
  return m ? `${m[2]}-${m[1]}` : edition;
}
/** « 03/10 » d'un jour UTC « 2026-10-03 ». */
function utcDayLabel(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}`;
}

/**
 * Légende Défense de la phase A complétée par les mailles GNSS et, option active, les zones drones. Mailles datées par leur jour UTC
 * complet (`cellsDay`, jamais l'heure de la grille glissante, O17) ; grille de plus de 40 min : « (en retard) : couleurs retirées ».
 */
export function withDefensePhaseB(base: LegendCategory, input: DefenseLegendB, now: number): LegendCategory {
  const items: LegendItem[] = base.items.map((i) => ({ ...i }));
  const notes: string[] = [...(base.notes ?? [])];
  const g = input.gnss;
  items.push({ id: 'sov-gnss-header', label: 'Précision de position GNSS dégradée, mailles de 0,5°', color: HEADER_HEX, isHeader: true });
  if (g === null || g.readAt === null || g.cellsDay === null || g.cells.length === 0) {
    items.push({ id: 'sov-gnss-nd', label: 'Mailles non publiées (jour non couvert)', color: SOV_ABROAD_HEX, shape: 'square' });
    notes.push('Mailles du jour UTC précédent : non publiées (jour non couvert).');
  } else {
    const late = isSovereigntyDataLate('adsb-gnss', g.readAt, now);
    const day = utcDayLabel(g.cellsDay);
    const general = g.days.days.find((d) => d.date === g.cellsDay)?.general === true;
    items.push(
      { id: 'sov-gnss-orange', label: `Au-delà de ${GNSS_ORANGE_PCT}${NBSP}% des aéronefs à précision dégradée`, color: late ? SOV_ABROAD_HEX : levelHex('orange'), shape: 'square' },
      { id: 'sov-gnss-jaune', label: `De ${GNSS_YELLOW_PCT}${NBSP}% à ${GNSS_ORANGE_PCT}${NBSP}%`, color: late ? SOV_ABROAD_HEX : levelHex('jaune'), shape: 'square' },
      { id: 'sov-gnss-abroad', label: 'Hors de France : jamais comptée', color: SOV_ABROAD_HEX, shape: 'square' },
    );
    notes.push(`Mailles du ${day}, jour UTC complet${late ? ' (en retard) : couleurs retirées' : ''} ; « trop peu d’avions » et mailles vertes non dessinées.`);
    if (general) notes.push(`Dégradation générale le ${day}, probablement météo spatiale : mailles françaises en contour seul, non comptées.`);
    notes.push('Précision de position, jamais un brouillage établi : seules la DGAC et l’ANFR qualifient un brouillage.');
  }
  if (input.dronesShown) {
    // Titre propre : sans lui, la zone drones se lit sous le titre des mailles GNSS (capture du 05/10).
    items.push(
      { id: 'sov-drones-header', label: 'Zones drones DGAC (option)', color: HEADER_HEX, isHeader: true },
      { id: 'sov-drones', label: 'Zone drones DGAC : vol interdit, hors agglomérations', color: DRONE_ZONE_HEX, shape: 'zone' },
    );
    const generated = input.drones ? Date.parse(input.drones.generatedAt) : Number.NaN;
    notes.push(input.drones !== null
      ? `Zones drones : ${input.drones.source}, à jour au ${editionB(input.drones.edition)} ; fichier du ${Number.isFinite(generated) ? fullDateB(generated) : 'n.d.'}.`
      : 'Zones drones : fichier pas encore lu.');
    notes.push(`Couche officielle « ${DRONES_TITLE} » : ${DRONES_LEGEND}`);
    notes.push('Zones permanentes hors agglomérations seulement ; les interdictions temporaires (NOTAM) ne sont pas couvertes.');
    notes.push(DRONES_POINTER);
    notes.push('Tracé simplifié pour la carte : la carte officielle fait foi.');
  }
  return { ...base, items, notes };
}
