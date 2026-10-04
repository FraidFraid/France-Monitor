// src/components/layer-panel/environment-legend.ts : légendes et teintes des couches Environnement de la carte (spec 2026-10-04
// environnement § 2 ; contrats § 4.1 et § 5) : sources, périmètres (E4), date réelle de chaque donnée (S1) ; donnée en retard (S2) :
// « (en retard) » et couleurs de niveau retirées (« En retard : couleurs de niveau retirées de la carte. »). Teintes de catégorie
// recopiées des jetons de main.css pour MapLibre, qui ne lit pas les variables CSS (égalité vérifiée par test).
import type { FiresResponse, FloodsResponse, VigilanceEcheance, VigilanceResponse } from '../../types/index.ts';
import { isEnvironmentDataLate, nextVigilanceMap, parisDayOf, vigilancePeriodOf } from '../../services/environment-levels.ts';
import type { Radar2dManifest } from '../../services/radar-2d.ts';
import { levelHex } from '../../services/vigilance.ts';
import type { LegendCategory, LegendItem } from '../MapLegend.ts';
import { formatAge, formatRainRate, marshallPalmerMmH, parisDayWord } from './environment-format.ts';
import { NBSP, frNumber } from './format.ts';

const PARIS = 'Europe/Paris';
const HEADER_HEX = '#9898a8';
const LINE = '━';
const COLORS_GONE = 'En retard : couleurs de niveau retirées de la carte.';

/** Teinte neutre : donnée en retard (S2) ; hors de la palette L1. */
export const ENV_NEUTRAL_HEX = '#c7c7cc';
/** Source de chaleur récurrente, « à vérifier, probablement industrielle » (jeton --cat-feu-recurrent). */
export const FIRE_RECURRENT_HEX = '#8e8e93';
/** Détection hors de France (jeton --cat-feu-etranger). */
export const FIRE_ABROAD_HEX = '#d1d1d6';
/** Station hydrométrique d'un tronçon en vigilance (jeton --cat-station-hydro). */
export const FLOOD_STATION_HEX = '#64d2ff';

/** Classes de réflectivité de l'image radar (seuil en dBZ, teinte) : palette du worker (services/radar-worker/render.py, PALETTE). */
export const RADAR_DBZ_CLASSES: ReadonlyArray<{ dbz: number; hex: string }> = [
  { dbz: -9, hex: '#5ed3ff' }, { dbz: 0, hex: '#39abff' }, { dbz: 10, hex: '#228be6' }, { dbz: 20, hex: '#26c56a' }, { dbz: 30, hex: '#f5dc42' },
  { dbz: 40, hex: '#f78f2d' }, { dbz: 50, hex: '#e74848' }, { dbz: 60, hex: '#ae3bc4' }, { dbz: 70, hex: '#ffffff' },
];
/** Classes des sommets d'écho (seuil en km, teinte) : ECHO_TOP_PALETTE du worker (render.py). */
export const ECHO_TOP_CLASSES: ReadonlyArray<{ km: number; hex: string }> = [
  { km: 0, hex: '#78909c' }, { km: 1, hex: '#26a69a' }, { km: 2, hex: '#43a047' }, { km: 4, hex: '#fdd835' }, { km: 6, hex: '#fb8c00' },
  { km: 8, hex: '#e53935' },
];

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString('fr-FR', { timeZone: PARIS, hour: '2-digit', minute: '2-digit' });
}
function dayMonth(ms: number): string {
  return new Date(ms).toLocaleDateString('fr-FR', { timeZone: PARIS, day: '2-digit', month: '2-digit' });
}
/** « 04/10 à 10:00 ». */
function dateAt(ms: number): string {
  return `${dayMonth(ms)} à ${clock(ms)}`;
}
function parse(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function copy(base: LegendCategory, items: readonly LegendItem[], refresh: string, notes: readonly string[]): LegendCategory {
  return { ...base, items: items.map((i) => ({ ...i })), refresh: { label: refresh }, notes: [...notes] };
}

// ─── Vigilance météo ───

export const VIGILANCE_LEGEND: LegendCategory = {
  id: 'environmental',
  title: 'Vigilance météo',
  items: [
    { id: 'env-vig-header', label: 'Vigilance Météo-France par département', color: HEADER_HEX, isHeader: true },
    { id: 'env-vig-red', label: 'Rouge', color: levelHex('rouge'), shape: 'zone' },
    { id: 'env-vig-orange', label: 'Orange', color: levelHex('orange'), shape: 'zone' },
    { id: 'env-vig-yellow', label: 'Jaune', color: levelHex('jaune'), shape: 'zone' },
    { id: 'env-vig-icon', label: 'Pictogramme : phénomène le plus fort du département', color: HEADER_HEX, isHeader: true },
  ],
  source: { label: 'Météo-France, vigilance météorologique', url: 'https://vigilance.meteofrance.fr' },
  refresh: { label: 'Cartes de 06 h et 16 h (05 h et 15 h en hiver), et mises à jour d’événement' },
  notes: [
    'Métropole et Corse ; l’outre-mer n’est pas dans ce flux.',
    'Échéance : aujourd’hui ou demain, selon la bascule du panneau.',
    'Vert : département non rempli.',
  ],
};

/** Vigilance datée : « carte du 04/10 à 10:00 · prochaine vers 16:00 » ; échéance affichée et ses bornes ; en retard : couleurs retirées. */
export function vigilanceLegend(v: VigilanceResponse | null, echeance: VigilanceEcheance, now: number): LegendCategory {
  const at = parse(v?.updateTime);
  if (v === null || at === null) {
    return copy(VIGILANCE_LEGEND, VIGILANCE_LEGEND.items, 'Carte Météo-France indisponible', VIGILANCE_LEGEND.notes ?? []);
  }
  const late = isEnvironmentDataLate('vigilance', v.updateTime, now);
  const period = vigilancePeriodOf(v, echeance);
  const begin = parse(period?.begin);
  const end = parse(period?.end);
  const endText = end === null ? 'n.d.' : clock(end) === '00:00' ? 'minuit' : clock(end);
  const shown = begin === null
    ? `Échéance ${echeance === 'J' ? 'du jour' : 'du lendemain'} absente de la carte.`
    : `Échéance affichée : ${parisDayWord(parisDayOf(begin), now)}, de ${clock(begin)} à ${endText}.`;
  return copy(VIGILANCE_LEGEND, VIGILANCE_LEGEND.items,
    `Carte du ${dateAt(at)}${late ? ' (en retard)' : ''} · prochaine vers ${clock(nextVigilanceMap(now))}`,
    [shown, 'Métropole et Corse ; l’outre-mer n’est pas dans ce flux.', 'Vert : département non rempli.', ...(late ? [COLORS_GONE] : [])]);
}

// ─── Crues ───

export const FLOODS_LEGEND: LegendCategory = {
  id: 'floods',
  title: 'Crues',
  items: [
    { id: 'flood-header', label: 'Tronçons Vigicrues en vigilance', color: HEADER_HEX, isHeader: true },
    { id: 'flood-red', label: 'Rouge', color: levelHex('rouge'), icon: LINE, iconSize: 18 },
    { id: 'flood-orange', label: 'Orange', color: levelHex('orange'), icon: LINE, iconSize: 18 },
    { id: 'flood-yellow', label: 'Jaune', color: levelHex('jaune'), icon: LINE, iconSize: 18 },
    { id: 'flood-stations-header', label: 'Stations des tronçons en vigilance', color: HEADER_HEX, isHeader: true },
    { id: 'flood-station', label: 'Station (hauteur au repère)', color: FLOOD_STATION_HEX, shape: 'circle' },
    { id: 'flood-station-up', label: 'Hauteur en hausse sur 1 h', color: levelHex('rouge'), shape: 'ring' },
    { id: 'flood-station-down', label: 'Hauteur en baisse sur 1 h', color: levelHex('vert'), shape: 'ring' },
  ],
  source: { label: 'Vigicrues (tronçons) · Hub’Eau (hauteurs et débits)', url: 'https://www.vigicrues.gouv.fr' },
  refresh: { label: `Relève toutes les 10${NBSP}min` },
  notes: [
    '337 tronçons surveillés par l’État ; verts non dessinés.',
    'Hauteur au repère de la station, pas une cote d’alerte : Vigicrues ne publie pas les seuils en API.',
  ],
};

/** Crues datées : « relevé Vigicrues 10:05 » (le flux n'a pas d'heure de bulletin) et nombre réel de tronçons surveillés. */
export function floodsLegend(f: FloodsResponse | null, now: number): LegendCategory {
  const at = parse(f?.readAt);
  if (f === null || at === null) return copy(FLOODS_LEGEND, FLOODS_LEGEND.items, 'Vigicrues indisponible', FLOODS_LEGEND.notes ?? []);
  const late = isEnvironmentDataLate('vigicrues', f.readAt, now);
  return copy(FLOODS_LEGEND, FLOODS_LEGEND.items, `Relevé Vigicrues ${clock(at)}${late ? ' (en retard)' : ''}`, [
    `${frNumber(f.total, 0)} tronçons surveillés par l’État ; verts non dessinés.`,
    'Hauteur au repère de la station, pas une cote d’alerte : Vigicrues ne publie pas les seuils en API.',
    ...(late ? [COLORS_GONE] : []),
  ]);
}

// ─── Radar météo ───

function dbzLabel(dbz: number): string {
  return `${frNumber(dbz, 0)}${NBSP}dBZ et plus · ${formatRainRate(marshallPalmerMmH(dbz))}`;
}

const RADAR_ITEMS: readonly LegendItem[] = [
  { id: 'radar-header', label: 'Réflectivité, pluie équivalente (Marshall-Palmer)', color: HEADER_HEX, isHeader: true },
  ...RADAR_DBZ_CLASSES.map((c): LegendItem => ({ id: `radar-dbz-${c.dbz}`, label: dbzLabel(c.dbz), color: c.hex, shape: 'square' })),
];
const ECHO_TOP_ITEMS: readonly LegendItem[] = [
  { id: 'echo-top-header', label: 'Sommets d’écho', color: HEADER_HEX, isHeader: true },
  ...ECHO_TOP_CLASSES.map((c, i): LegendItem => {
    const next = ECHO_TOP_CLASSES[i + 1];
    const label = next ? `${c.km} à ${next.km}${NBSP}km${c.km === 0 ? ' (classe d’image, pas un niveau)' : ''}` : `${c.km}${NBSP}km et plus`;
    return { id: `echo-top-${c.km}`, label, color: c.hex, shape: 'square' };
  }),
];

export const RADAR_LEGEND: LegendCategory = {
  id: 'weatherRadar',
  title: 'Radar météo',
  columns: 2,
  splitIndex: 5,
  items: [...RADAR_ITEMS],
  source: { label: 'Météo-France, mosaïque de réflectivité (DPRadar, Licence Ouverte 2.0)' },
  refresh: { label: `Une image toutes les 5${NBSP}min` },
  notes: [
    'Mosaïque 1 km : métropole et Corse, avec leurs marges.',
    'Pluie équivalente : Z = 200 R^1,6 ; au-delà de 50 dBZ, grêle possible et pluie surestimée.',
    'Clic sur la carte : profil vertical de réflectivité au radar le plus proche (démonstration).',
  ],
};

/** Radar daté : « image du 04/10 à 10:05 · mosaïque 1 km · une image toutes les 5 min » ; sommets d'écho si l'option est cochée. */
export function radarLegend(m: Radar2dManifest | null, echoTops: boolean, now: number): LegendCategory {
  const items = echoTops ? [...RADAR_ITEMS, ...ECHO_TOP_ITEMS] : RADAR_ITEMS;
  const at = parse(m?.observedAt);
  if (m === null || at === null) return copy(RADAR_LEGEND, items, 'Radar Météo-France indisponible', RADAR_LEGEND.notes ?? []);
  const late = isEnvironmentDataLate('radar', m.observedAt, now);
  return copy(RADAR_LEGEND, items, `Image du ${dateAt(at)}${late ? ' (en retard)' : ''} · mosaïque 1${NBSP}km · une image toutes les 5${NBSP}min`, [
    ...(RADAR_LEGEND.notes ?? []),
    ...(echoTops ? ['Sommets d’écho : altitude du plus haut écho significatif ; au-delà de 8 km, sommet orageux ou pyroconvection possible.'] : []),
    ...(late ? ['En retard : image ancienne, à lire avec sa date.'] : []),
  ]);
}

// ─── Feux de forêt ───

const FIRE_ITEMS: readonly LegendItem[] = [
  { id: 'fire-header', label: 'Détections en France, 24 h', color: HEADER_HEX, isHeader: true },
  { id: 'fire-major', label: `Foyer confirmé de 100${NBSP}MW ou plus`, color: levelHex('rouge'), shape: 'circle' },
  { id: 'fire-confirmed', label: `Foyer confirmé de 10${NBSP}MW ou plus (deux passages ou plus)`, color: levelHex('orange'), shape: 'circle' },
  { id: 'fire-isolated', label: `Détection isolée ou foyer confirmé de moins de 10${NBSP}MW`, color: levelHex('jaune'), shape: 'circle' },
  { id: 'fire-recurrent', label: 'Source récurrente, à vérifier (probablement industrielle)', color: FIRE_RECURRENT_HEX, shape: 'circle' },
  { id: 'fire-abroad', label: 'Détection hors de France', color: FIRE_ABROAD_HEX, shape: 'circle' },
];
const FOREST_DANGER_ITEMS: readonly LegendItem[] = [
  { id: 'mdf-header', label: 'Météo des forêts', color: HEADER_HEX, isHeader: true },
  { id: 'mdf-4', label: 'Danger très élevé', color: levelHex('rouge'), shape: 'zone' },
  { id: 'mdf-3', label: 'Danger élevé', color: levelHex('orange'), shape: 'zone' },
  { id: 'mdf-2', label: 'Danger modéré', color: levelHex('jaune'), shape: 'zone' },
  { id: 'mdf-1', label: 'Danger faible', color: levelHex('vert'), shape: 'zone' },
];

export const FIRES_LEGEND: LegendCategory = {
  id: 'fires',
  title: 'Feux de forêt',
  items: [...FIRE_ITEMS],
  source: { label: 'NASA FIRMS (VIIRS Suomi NPP, NOAA-20, NOAA-21 ; MODIS Terra, Aqua) · Météo-France, météo des forêts' },
  refresh: { label: `Collecte du serveur toutes les 15${NBSP}min` },
  notes: [
    'Départements français seulement ; détections hors de France en gris.',
    `Foyer : détections à moins de 1${NBSP}km et de 12${NBSP}h ; confirmé dès deux passages de satellite, orange dès 10${NBSP}MW cumulés ; confiance faible jamais en rouge.`,
    `Récurrente : une détection à moins de 1${NBSP}km au moins 5 des 10 derniers jours ; jamais un feu de forêt.`,
  ],
};

/**
 * Feux datés : « dernière acquisition 04:43 (il y a 3 h 27) » ; météo des forêts nommée avec sa publication et son jour réel quand le
 * remplissage est coché (amendement 4) ; en retard : couleurs retirées.
 */
export function firesLegend(f: FiresResponse | null, forestDangerFill: boolean, now: number): LegendCategory {
  const items = forestDangerFill ? [...FIRE_ITEMS, ...FOREST_DANGER_ITEMS] : FIRE_ITEMS;
  const at = parse(f?.lastAcquisitionAt);
  const late = f === null || isEnvironmentDataLate('firms', f.lastAcquisitionAt, now);
  const refresh = f === null || f.readAt === null
    ? 'NASA FIRMS indisponible'
    : at === null ? 'Aucune acquisition sur la zone' : `Dernière acquisition ${dateAt(at)} (${formatAge(at, now)})${late ? ' (en retard)' : ''}`;
  const fd = f?.forestDanger ?? null;
  const published = parse(fd?.publishedAt);
  const mdfNote = !forestDangerFill ? [] : fd === null || published === null
    ? ['Météo des forêts indisponible.']
    : [`Météo des forêts publiée le ${dateAt(published)}, niveaux pour ${parisDayWord(fd.j1Date, now)}${fd.season === 'hors-saison' ? ' (hors saison)' : ''}.`];
  return copy(FIRES_LEGEND, items, refresh, [...(FIRES_LEGEND.notes ?? []), ...mdfNote, ...(f !== null && f.readAt !== null && late && at !== null ? [COLORS_GONE] : [])]);
}
