// src/components/layer-panel/environment-format.ts : formats, mots et couleurs communs des panneaux Environnement et de leur carte
// (spec 2026-10-04 environnement § 1, § 2 ; contrats § 3.7). Pur, sans réseau ni DOM. Une valeur tient sur une ligne (R1) : espace
// insécable entre le nombre et l'unité, « n.d. » pour une valeur absente, jamais 0. Les formats communs viennent des Trafics.
import type {
  AirEpisodeState, DroughtLevel, FireSatellite, ForestDangerLevel, OfficialColorId, VigilancePhenomenonId, VigilanceSlot,
} from '../../types/index.ts';
import { FOREST_DANGER_COLOR, OFFICIAL_COLOR_LEVEL, PHENOMENON_WORD, nextDayOf, parisDayOf } from '../../services/environment-levels.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';
import type { IconName } from '../shared/icons.ts';
import { NBSP, frNumber } from './format.ts';

export const ENVIRONMENT_THEME = 'Environnement';
export {
  capitalize, clockOf, dataMs, dateOf, emptyOrDown, fold, formatCount, formatKm, formatMeters, formatShare, note, plural, readErrors, shortDate,
  sourceDown, stamp,
} from './traffic-format.ts';

const ND = 'n.d.';
const PARIS = 'Europe/Paris';

function ok(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function withUnit(v: number | null | undefined, digits: number, unit: string, signed = false): string {
  return ok(v) ? `${frNumber(v, digits, signed)}${NBSP}${unit}` : ND;
}

/** Hauteur d'eau au repère de la station : « 2,23 m ». */
export function formatHeightM(v: number | null | undefined, digits = 2): string { return withUnit(v, digits, 'm'); }
/** Variation signée sur 1 h : « +0,12 m », « −0,05 m », « 0,00 m ». */
export function formatChangeM(v: number | null | undefined): string { return withUnit(v, 2, 'm', true); }
/** Débit : deux décimales sous 1 m³/s, une sous 100, aucune au-delà (« 0,42 m³/s », « 12,4 m³/s », « 1 250 m³/s »). */
export function formatFlowM3s(v: number | null | undefined): string {
  if (!ok(v)) return ND;
  const a = Math.abs(v);
  return withUnit(v, a < 1 ? 2 : a < 100 ? 1 : 0, 'm³/s');
}
/** Puissance radiative d'un feu : « 4,2 MW ». */
export function formatFrp(v: number | null | undefined): string { return withUnit(v, 1, 'MW'); }
/** Réflectivité radar : « 35 dBZ », « −9 dBZ ». */
export function formatDbz(v: number | null | undefined): string { return withUnit(v, 0, 'dBZ'); }
/** Relation de Marshall-Palmer : Z = 200 R^1,6, soit R = (10^(dBZ/10) / 200)^(1/1,6), en mm/h. */
export function marshallPalmerMmH(dbz: number): number {
  return (10 ** (dbz / 10) / 200) ** (1 / 1.6);
}
/** Pluie équivalente : « 2,7 mm/h » ; sous 0,1 : « < 0,1 mm/h ». */
export function formatRainRate(mmh: number | null | undefined): string {
  if (!ok(mmh)) return ND;
  if (mmh > 0 && mmh < 0.1) return `<${NBSP}0,1${NBSP}mm/h`;
  return withUnit(mmh, mmh < 10 ? 1 : 0, 'mm/h');
}

/** Âge d'une donnée : « il y a 12 min », « il y a 3 h 27 », « il y a 2 j » ; jamais négatif (« il y a 0 min »). */
export function formatAge(ms: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - ms) / 60_000));
  if (minutes < 60) return `il y a ${minutes}${NBSP}min`;
  if (minutes < 48 * 60) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `il y a ${h}${NBSP}h${m > 0 ? `${NBSP}${String(m).padStart(2, '0')}` : ''}`;
  }
  return `il y a ${Math.floor(minutes / 1440)}${NBSP}j`;
}

/** Jour de Paris en mots : « aujourd’hui », « demain », sinon « mardi 6 octobre ». */
export function parisDayWord(day: string, now: number): string {
  const today = parisDayOf(now);
  if (day === today) return 'aujourd’hui';
  if (day === nextDayOf(today)) return 'demain';
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

function parisClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('fr-FR', { timeZone: PARIS, hour: '2-digit', minute: '2-digit' });
}

/**
 * Créneau d'un phénomène, heure de Paris : « orange de 10:00 à 16:00 » ; fin à minuit de Paris : « à minuit » ; créneau qui commence
 * un autre jour que `now` : « jaune le 05/10 de 04:00 à 13:00 ».
 */
export function slotText(slot: VigilanceSlot, now: number): string {
  const from = Date.parse(slot.from);
  const end = parisClock(Date.parse(slot.to));
  const day = parisDayOf(from);
  const on = day === parisDayOf(now) ? '' : ` le ${day.slice(8, 10)}/${day.slice(5, 7)}`;
  return `${COLOR_WORD[slot.color]}${on} de ${parisClock(from)} à ${end === '00:00' ? 'minuit' : end}`;
}

/** Couleur officielle (1 à 4) vers l'échelle L1 : 1 vert, 2 jaune, 3 orange, 4 rouge. */
export const COLOR_LEVEL: Readonly<Record<OfficialColorId, VigilanceLevel>> = OFFICIAL_COLOR_LEVEL;
export const COLOR_WORD: Readonly<Record<OfficialColorId, string>> = { 1: 'vert', 2: 'jaune', 3: 'orange', 4: 'rouge' };
/** Phénomènes de la vigilance : « vent violent », « pluie-inondation »… (mêmes mots que les raisons de pastille). */
export const PHENOMENON_LABEL: Readonly<Record<VigilancePhenomenonId, string>> = PHENOMENON_WORD;
/** Pictogrammes de la carte et du panneau (ceux de l'ancien service de vigilance, repris tels quels). */
export const PHENOMENON_ICON: Readonly<Record<VigilancePhenomenonId, IconName>> = {
  1: 'wind', 2: 'cloud-rain', 3: 'cloud-lightning', 4: 'waves', 5: 'snowflake', 6: 'thermometer', 7: 'thermometer-snowflake', 8: 'mountain-snow',
  9: 'waves',
};
/** Météo des forêts : 1 faible vert, 2 modéré jaune, 3 élevé orange, 4 très élevé rouge. */
export const FOREST_DANGER_LEVEL: Readonly<Record<ForestDangerLevel, VigilanceLevel>> = FOREST_DANGER_COLOR;
export const FOREST_DANGER_WORD: Readonly<Record<ForestDangerLevel, string>> = { 1: 'faible', 2: 'modéré', 3: 'élevé', 4: 'très élevé' };
/** Satellite et capteur, nommés exactement (E3) : jamais « VIIRS SNPP » pour une détection de NOAA-21. */
export const SATELLITE_WORD: Readonly<Record<FireSatellite, string>> = {
  'Suomi NPP': 'Suomi NPP (VIIRS)', 'NOAA-20': 'NOAA-20 (VIIRS)', 'NOAA-21': 'NOAA-21 (VIIRS)', Terra: 'Terra (MODIS)', Aqua: 'Aqua (MODIS)',
};

/** Unités de l'environnement ; l'unité s'arrête là où finit un mot. */
const UNITS = String.raw`(?:m³\/s|mm\/h|mm|dBZ|MW|km|min|m|h|j|%)(?![\p{L}\p{N}])`;
/** Mots comptés des raisons de pastille (« 10 départements », « 4 tronçons ») : collés à leur nombre par glueEnvUnits seulement. */
const COUNTED = String.raw`(?:départements?|tronçons?|foyers?|détections?|stations?|sources?|autres?|communes?|séismes?)(?![\p{L}\p{N}])`;
const ENV_BREAKABLE = new RegExp(String.raw`\d+(?:[,.]\d+)? ${UNITS}`, 'u');
const GLUE = new RegExp(String.raw`(\d+(?:[,.]\d+)?) (${UNITS}|${COUNTED})`, 'gu');

/** Contrôle R1 des unités de l'environnement : premier « nombre, espace sécable, unité » (m, m³/s, MW, dBZ, mm/h, km, h, min, %). */
export function envBreakable(text: string): string | null {
  return ENV_BREAKABLE.exec(text)?.[0] ?? null;
}

/** Phrases des niveaux (raisons de pastille, espaces ordinaires) : espace insécable entre un nombre et son unité ou son mot compté (R1). */
export function glueEnvUnits(text: string): string {
  return text.replace(GLUE, `$1${NBSP}$2`);
}

// ─── Phase B (tâche 20) : sécheresse, qualité de l'air, séismes ───

export { quakePlace } from '../../services/environment-levels.ts';

/** Niveaux VigiEau en français. */
export const DROUGHT_WORD: Readonly<Record<DroughtLevel, string>> = {
  vigilance: 'vigilance', alerte: 'alerte', alerte_renforcee: 'alerte renforcée', crise: 'crise',
};
/** Couleur d'un niveau VigiEau : crise rouge, alerte renforcée orange, alerte jaune ; la vigilance prend une teinte de catégorie (§ 3.1). */
export const DROUGHT_LEVEL: Readonly<Record<DroughtLevel, VigilanceLevel | 'categorie'>> = {
  vigilance: 'categorie', alerte: 'jaune', alerte_renforcee: 'orange', crise: 'rouge',
};
/** Jeton de la vigilance sécheresse (R2) ; valeur reprise par la carte dans environment-legend.ts (vérifiée par test). */
export const CAT_SECHERESSE_VIGILANCE = 'var(--cat-secheresse-vigilance)';

/** Indice ATMO (arrêté du 10 juillet 2020) : 1 bon à 6 extrêmement mauvais ; 7 événement exceptionnel (incendie…). */
export const AIR_INDEX_WORD: Readonly<Record<number, string>> = {
  1: 'bon', 2: 'moyen', 3: 'dégradé', 4: 'mauvais', 5: 'très mauvais', 6: 'extrêmement mauvais', 7: 'événement',
};
/** Couleur d'un indice ATMO sur la palette L1 (amendement 5) : 1 et 2 vert, 3 jaune, 4 orange, 5 et plus rouge. */
export function airIndexLevel(code: number): VigilanceLevel {
  if (code >= 5) return 'rouge';
  if (code === 4) return 'orange';
  if (code === 3) return 'jaune';
  return 'vert';
}
export const AIR_STATE_WORD: Readonly<Record<AirEpisodeState, string>> = {
  information: 'information-recommandation', alerte: 'alerte', inconnu: 'état non reconnu',
};

/** « M 4,2 » (R1 : espace insécable) ; n.d. sans valeur. */
export function formatMagnitude(m: number | null | undefined): string {
  return typeof m === 'number' && Number.isFinite(m) ? `M${NBSP}${frNumber(m, 1)}` : 'n.d.';
}
/** Seuil d'affichage (§ 3.3) : les séismes plus faibles sont en gris. */
export const QUAKE_DISPLAY_MIN = 2.5;
/** Couleur d'un séisme en France (arbitrage 5, amendement 16) : 5 rouge, 4 orange, 3 jaune, 2,5 à 2,9 vert, plus faible gris. */
export function quakeLevel(m: number): VigilanceLevel | 'gris' {
  if (m >= 5) return 'rouge';
  if (m >= 4) return 'orange';
  if (m >= 3) return 'jaune';
  return m >= QUAKE_DISPLAY_MIN ? 'vert' : 'gris';
}

/** Jour civil « AAAA-MM-JJ » en toutes lettres : « 6 octobre » ; n.d. si illisible. */
export function dayLong(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return 'n.d.';
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

/** Date et heure de Paris d'une donnée : « 4 octobre 02:43 » ; n.d. si absente ou illisible. */
export function dayMonthClock(iso: string | null | undefined): string {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(ms)) return 'n.d.';
  const d = new Date(ms);
  const day = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
  const time = d.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
  return `${day} ${time}`;
}
