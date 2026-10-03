// src/components/layer-panel/traffic-legend.ts : légendes des quatre couches Trafics de la carte (spec 2026-10-03 trafics § 3) :
// sources, périmètres (T1), date réelle de chaque partie (S1) ; donnée en retard (S2) : « (en retard) » et couleurs de niveau
// retirées. Léger (aucune vue, aucun service réseau) : App.ts l'importe au démarrage pour ses définitions de couches ;
// deckgl/traffic-map.ts et DeckGLMap.ts y lisent les teintes qu'ils partagent avec la légende (avions, navires par type).
import type {
  AirOverviewResponse, MaritimeSnapshot, RailOverviewResponse, RailSituationsResponse, RoadNationalResponse, RoadUrbanResponse,
} from '../../types/index.ts';
import { isTrafficDataLate, type TrafficSource } from '../../services/traffic-levels.ts';
import { levelHex } from '../../services/vigilance.ts';
import type { LegendCategory, LegendItem } from '../MapLegend.ts';
import { fmIcon } from '../shared/icons.ts';
import { NBSP, frNumber } from './format.ts';

const PARIS = 'Europe/Paris';
const ND = 'n.d.';
const HEADER_HEX = '#9898a8';
const LINE = '━';

/** Teinte neutre : donnée en retard (S2), travaux et information ; hors de la palette L1. */
export const TRAFFIC_NEUTRAL_HEX = '#c7c7cc';
/** Jetons de catégorie de main.css (R2), copiés pour MapLibre qui ne lit pas les variables CSS (vérifié par test). */
export const CAT_AIRPORT_HEX = '#5ac8fa';
export const CAT_PORT_HEX = '#30b0c7';
/** Avions civils : une seule teinte (l'altitude n'est pas une gravité, arbitrage 28), reprise par la densité. */
export const AIR_ICON_HEX = '#7dd3fc';

// ─── Types de navires : teinte de la carte, légende et comptes de l'instantané, un seul classement ───

/** Catégorie de type AIS : clé de `MaritimeSnapshot.byType`. */
export type VesselCategory = keyof MaritimeSnapshot['byType'];

/**
 * Copie client de `typeCategory` (api/_lib/ais-snapshot.js), classement UIT des codes de type AIS ; la teinte des navires, la
 * légende et les comptes du serveur suivent ce même classement (vérifié code par code de 0 à 99 : tests/vessel-type-category.test.ts).
 * « inconnu » sans type statique connu (null ou 0), « autre » pour tout autre code.
 */
export function vesselCategory(code: unknown): VesselCategory {
  const c = Number(code);
  if (code === null || code === undefined || !Number.isInteger(c) || c <= 0) return 'inconnu';
  if (c >= 80 && c <= 89) return 'petrolier';
  if (c >= 70 && c <= 79) return 'cargo';
  if (c >= 60 && c <= 69) return 'passagers';
  if (c >= 40 && c <= 49) return 'grande-vitesse';
  if (c === 30) return 'peche';
  if (c === 31 || c === 32 || c === 52) return 'remorqueur';
  if (c === 36 || c === 37) return 'plaisance';
  if (c === 35) return 'militaire';
  if ([33, 34, 50, 51, 53, 54, 55, 58].includes(c)) return 'service';
  return 'autre';
}

/** Teinte de chaque catégorie (couche Deck.gl des navires et légende) ; navire survolé ou choisi : teintes propres à DeckGLMap. */
export const VESSEL_TYPE_HEX: Readonly<Record<VesselCategory, string>> = {
  cargo: '#4ade80', petrolier: '#60a5fa', passagers: '#f97316', peche: '#facc15', remorqueur: '#a855f7', plaisance: '#06b6d4',
  'grande-vitesse': '#f472b6', service: '#2dd4bf', militaire: '#818cf8', autre: '#e2e8f0', inconnu: '#94a3b8',
};

/** Statut de navigation AIS « en pêche ». */
const AIS_STATUS_FISHING = 7;

/** Teinte d'un navire : celle de son type déclaré ; sans type déclaré mais « en pêche » (statut 7) : teinte de la pêche. */
export function vesselHex(typeCode: unknown, navStatus: number | null | undefined): string {
  const category = vesselCategory(typeCode);
  return category === 'inconnu' && navStatus === AIS_STATUS_FISHING ? VESSEL_TYPE_HEX.peche : VESSEL_TYPE_HEX[category];
}

/** Ordre et libellés de la légende maritime ; libellé aussi repris par l'infobulle d'un navire. */
const VESSEL_TYPES: ReadonlyArray<{ id: string; category: VesselCategory; label: string }> = [
  { id: 'sea-cargo', category: 'cargo', label: 'Cargo' },
  { id: 'sea-tanker', category: 'petrolier', label: 'Pétrolier' },
  { id: 'sea-passenger', category: 'passagers', label: 'Passagers' },
  { id: 'sea-fishing', category: 'peche', label: 'Pêche' },
  { id: 'sea-tug', category: 'remorqueur', label: 'Remorqueur' },
  { id: 'sea-sailing', category: 'plaisance', label: 'Plaisance' },
  { id: 'sea-highspeed', category: 'grande-vitesse', label: 'Grande vitesse' },
  { id: 'sea-service', category: 'service', label: 'Service : pilote, sauvetage, police' },
  { id: 'sea-military', category: 'militaire', label: 'Militaire' },
  { id: 'sea-other', category: 'autre', label: 'Autre type' },
  { id: 'sea-unknown', category: 'inconnu', label: 'Type inconnu' },
];

/** Libellé de la catégorie d'un type AIS (légende, infobulle d'un navire). */
export function vesselTypeLabel(category: VesselCategory): string {
  return VESSEL_TYPES.find((t) => t.category === category)?.label ?? 'Type inconnu';
}

// ─── Légendes de base (définitions des couches de App.ts) ───

export const ROAD_TRAFFIC_LEGEND: LegendCategory = {
  id: 'trafficRoad',
  title: 'Trafic routier',
  columns: 2,
  splitIndex: 5,
  items: [
    { id: 'road-dir-header', label: 'Événements DIR en cours', color: HEADER_HEX, isHeader: true },
    { id: 'road-accident', label: 'Accident', color: levelHex('rouge'), shape: 'circle' },
    { id: 'road-major', label: 'Bouchon, coupure, météo', color: levelHex('orange'), shape: 'circle' },
    { id: 'road-minor', label: 'Obstacle, voie fermée', color: levelHex('jaune'), shape: 'circle' },
    { id: 'road-other', label: 'Travaux, information', color: TRAFFIC_NEUTRAL_HEX, shape: 'circle' },
    { id: 'road-jams-header', label: 'Bouchons TomTom', color: HEADER_HEX, isHeader: true },
    { id: 'road-jam-3', label: 'Bouchon', color: levelHex('rouge'), icon: LINE, iconSize: 18 },
    { id: 'road-jam-2', label: 'À-coups', color: levelHex('orange'), icon: LINE, iconSize: 18 },
    { id: 'road-jam-1', label: 'Ralenti', color: levelHex('jaune'), icon: LINE, iconSize: 18 },
    { id: 'road-sections-header', label: 'Sections Traficolor', color: HEADER_HEX, isHeader: true },
    { id: 'road-section-congested', label: 'Saturé', color: levelHex('rouge'), icon: LINE, iconSize: 18 },
    { id: 'road-section-heavy', label: 'Dense', color: levelHex('orange'), icon: LINE, iconSize: 18 },
    { id: 'road-section-free', label: 'Fluide', color: levelHex('vert'), icon: LINE, iconSize: 18 },
  ],
  source: { label: 'DIR (DATEX II, Traficolor) · TomTom (collecte du serveur)' },
  refresh: { label: `Relève toutes les 5${NBSP}min` },
  notes: [
    `DIR : routes nationales non concédées, événements en cours depuis moins de 24${NBSP}h ; accidents et coupures au premier plan ; fermetures et chantiers de longue durée dans le panneau.`,
    'TomTom : bouchons de 12 agglomérations ; fond de vitesse TomTom à partir du zoom 10 ; clic sur un bouchon : vitesse du tronçon.',
    'Sections Traficolor : réseaux d’agglomération des DIR, là où leur référentiel donne le tracé ; section sans mesure non dessinée.',
  ],
};

export const AIR_TRAFFIC_LEGEND: LegendCategory = {
  id: 'trafficAir',
  title: 'Trafic aérien',
  items: [
    { id: 'air-density', label: 'Densité des avions (sous le zoom 7)', color: AIR_ICON_HEX, shape: 'square',
      gradient: `linear-gradient(90deg, rgba(125, 211, 252, 0.15), ${AIR_ICON_HEX}, #e0f7ff)` },
    { id: 'air-plane', label: 'Avion civil (à partir du zoom 7, indicatif au survol)', color: AIR_ICON_HEX, icon: fmIcon('plane') },
    { id: 'air-emergency', label: 'Urgence en vol (7500, 7600, 7700) et son indicatif', color: levelHex('rouge'), shape: 'circle' },
    { id: 'air-airport', label: 'Aéroport : surface selon les départs détectés', color: CAT_AIRPORT_HEX, shape: 'circle' },
  ],
  source: { label: 'OpenSky Network (ADS-B, compte authentifié)' },
  refresh: { label: `Positions toutes les 12${NBSP}s, synthèse toutes les 2${NBSP}min` },
  notes: [
    'Zone suivie : France métropolitaine et ses approches ; vols militaires dans la couche Défense.',
    `Départs : 8 aéroports, fenêtre de 2${NBSP}h relevée toutes les 4${NBSP}h ; Beauvais et Bordeaux : annuaires officiels ; arrivées publiées par la source seulement en différé.`,
  ],
};

export const RAIL_TRAFFIC_LEGEND: LegendCategory = {
  id: 'trafficRail',
  title: 'Réseau ferroviaire',
  items: [
    { id: 'rail-header', label: 'Gares des trains perturbés en cours', color: HEADER_HEX, isHeader: true },
    { id: 'rail-red', label: `Retard de 90${NBSP}min ou plus, ou train supprimé`, color: levelHex('rouge'), shape: 'circle' },
    { id: 'rail-orange', label: `De 45 à 89${NBSP}min`, color: levelHex('orange'), shape: 'circle' },
    { id: 'rail-yellow', label: `De 15 à 44${NBSP}min`, color: levelHex('jaune'), shape: 'circle' },
    { id: 'rail-green', label: `Moins de 15${NBSP}min`, color: levelHex('vert'), shape: 'circle' },
  ],
  source: { label: 'SNCF (perturbations du jour) · SIRI SX (situations)' },
  refresh: { label: `Relève toutes les 5${NBSP}min` },
  notes: [
    'Couleur d’une gare : retard du train le plus en retard à cet arrêt ; trains à venir dans le panneau seulement.',
    'Situations SIRI SX : dans le panneau ; elles ne sont pas placées sur la carte (le flux ne publie pas de lieu).',
    'Train choisi dans le panneau : trajet tracé dans la couleur de son retard.',
  ],
};

export const MARITIME_TRAFFIC_LEGEND: LegendCategory = {
  id: 'trafficMaritime',
  title: 'Trafic maritime',
  columns: 2,
  splitIndex: 7,
  items: [
    ...VESSEL_TYPES.map(({ id, category, label }): LegendItem => ({ id, label, color: VESSEL_TYPE_HEX[category], shape: 'vessel' })),
    { id: 'sea-signal-sensitive', label: 'Signalement : pétrolier ou passagers', color: levelHex('rouge'), shape: 'ring' },
    { id: 'sea-signal', label: 'Signalement : autre navire', color: levelHex('orange'), shape: 'ring' },
    { id: 'sea-anchorage', label: 'Mouillage devant un port (surface : navires)', color: CAT_PORT_HEX, shape: 'circle' },
  ],
  source: { label: 'AIS (aisstream.io, relais du serveur)' },
  refresh: { label: `Positions en continu, synthèse toutes les 2${NBSP}min` },
  notes: [
    'Eaux françaises : métropole et Corse.',
    'Couleur et comptes par type déclaré (données statiques AIS) ; sans type déclaré mais en pêche (statut AIS 7) : teinte de la pêche, compté en type inconnu.',
    `Signalement : non maître de sa manœuvre ou échoué, hors port, sous 0,5${NBSP}nœud depuis 30${NBSP}min et sur deux positions (règle T3).`,
  ],
};

// ─── Dates des données (S1, S2) ───

export interface LegendDataPart { label: string; source: TrafficSource; at: string | null; present: boolean }

function parisDay(ms: number): string {
  return new Date(ms).toLocaleDateString('fr-FR', { timeZone: PARIS });
}

/** Heure de Paris de la donnée : « hh:mm » le jour même, « jj/mm hh:mm » sinon ; « n.d. » sans date lisible. */
function when(iso: string | null, now: number): string {
  const ms = iso === null ? Number.NaN : Date.parse(iso);
  if (!Number.isFinite(ms)) return ND;
  const time = new Date(ms).toLocaleTimeString('fr-FR', { timeZone: PARIS, hour: '2-digit', minute: '2-digit' });
  if (parisDay(ms) === parisDay(now)) return time;
  return `${new Date(ms).toLocaleDateString('fr-FR', { timeZone: PARIS, day: '2-digit', month: '2-digit' })} ${time}`;
}

/** « Données : DIR 14:57 · TomTom 15:00. » ; partie absente : « indisponible » ; en retard (S2) : suffixe, puis couleurs retirées. */
export function dataNotes(parts: readonly LegendDataPart[], now: number): string[] {
  let late = false;
  const shown = parts.map((p) => {
    if (!p.present) return `${p.label} indisponible`;
    const clock = when(p.at, now);
    const isLate = isTrafficDataLate(p.source, p.at, now);
    late ||= isLate;
    return `${p.label} ${clock}${isLate && clock !== ND ? ' (en retard)' : ''}`;
  });
  return [`Données : ${shown.join(' · ')}.`, ...(late ? ['En retard : couleurs de niveau retirées de la carte pour ces données.'] : [])];
}

function dated(base: LegendCategory, parts: readonly LegendDataPart[], now: number, items: readonly LegendItem[] = base.items): LegendCategory {
  return { ...base, items: items.map((i) => ({ ...i })), notes: [...dataNotes(parts, now), ...(base.notes ?? [])] };
}

export function roadLegend(national: RoadNationalResponse | null, urban: RoadUrbanResponse | null, now: number): LegendCategory {
  return dated(ROAD_TRAFFIC_LEGEND, [
    { label: 'DIR', source: 'dir', at: national?.publishedAt ?? null, present: national !== null },
    { label: 'TomTom', source: 'tomtom', at: urban?.collectedAt ?? null, present: urban !== null },
  ], now);
}

export function airLegend(overview: AirOverviewResponse | null, now: number): LegendCategory {
  return dated(AIR_TRAFFIC_LEGEND, [{ label: 'OpenSky', source: 'opensky', at: overview?.at ?? null, present: overview !== null }], now);
}

export function railLegend(overview: RailOverviewResponse | null, situations: RailSituationsResponse | null, now: number): LegendCategory {
  return dated(RAIL_TRAFFIC_LEGEND, [
    { label: 'SNCF', source: 'sncf', at: overview?.updatedAt ?? null, present: overview !== null },
    { label: 'SIRI SX', source: 'siri-sx', at: situations?.at ?? null, present: situations !== null },
  ], now);
}

function count(n: number | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? frNumber(n, 0) : ND;
}

/** Compte de l'instantané (amendement 3) à côté de chaque type déclaré, onze catégories de `byType`. */
export function maritimeLegend(snapshot: MaritimeSnapshot | null, now: number): LegendCategory {
  const parts: LegendDataPart[] = [{ label: 'AIS', source: 'ais', at: snapshot?.lastMessageAt ?? null, present: snapshot !== null }];
  if (!snapshot) return dated(MARITIME_TRAFFIC_LEGEND, parts, now);
  const byType = snapshot.byType;
  const items = MARITIME_TRAFFIC_LEGEND.items.map((i): LegendItem => {
    const type = VESSEL_TYPES.find((t) => t.id === i.id);
    return type ? { ...i, label: `${type.label} · ${count(byType[type.category])}` } : i;
  });
  return dated(MARITIME_TRAFFIC_LEGEND, parts, now, items);
}
