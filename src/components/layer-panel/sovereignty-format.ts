// src/components/layer-panel/sovereignty-format.ts : formats, mots et couleurs communs des panneaux Souveraineté (Défense, Connectivité,
// Vigilance cyber) et de leur carte (spec 2026-10-04 souveraineté § 1, § 2 ; contrats § 3.6). Pur, sans réseau ni DOM. Une valeur tient
// sur une ligne (R1) : espace insécable entre le nombre et l'unité, « n.d. » pour une valeur absente, jamais 0. Les formats communs
// viennent des Trafics et de l'Environnement ; aucun texte anglais brut d'une source n'est affiché (audit 32).
import type { AircraftFamily, CablesWatchResponse, CertFrItem, MilitaryBase } from '../../types/index.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';
import { NBSP, frNumber } from './format.ts';
import { clockOf } from './traffic-format.ts';

export const SOVEREIGNTY_THEME = 'Souveraineté';
export {
  capitalize, clockOf, coordText, dataMs, dateOf, emptyOrDown, fold, formatCount, formatKm, formatKnots, formatMeters, formatShare, note,
  plural, readErrors, shortDate, sourceDown, stamp, SQUAWK_CAVEAT, SQUAWK_WORD,
} from './traffic-format.ts';
export { formatAge } from './environment-format.ts';

const ND = 'n.d.';

function ok(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Altitude barométrique publiée par adsb.lol, en pieds : « 38 000 ft » ; absente : « n.d. ». */
export function formatFeet(v: number | null | undefined): string {
  return ok(v) ? `${frNumber(v, 0)}${NBSP}ft` : ND;
}

/** Indicatif publié, sinon l'immatriculation, sinon l'adresse OACI (« adresse 3bf004 ») : jamais une ligne sans nom. */
export function aircraftLabel(a: { callsign: string | null; hex: string; registration?: string | null }): string {
  const callsign = a.callsign?.trim() ?? '';
  if (callsign !== '') return callsign;
  const registration = a.registration?.trim() ?? '';
  return registration !== '' ? registration : `adresse ${a.hex}`;
}

/** Famille par le bloc d'adresse OACI (V2) : jamais une hypothèse « France ». */
export const FAMILY_WORD: Readonly<Record<AircraftFamily, string>> = { francais: 'français', autres: 'autres' };
/** Puces et barres des familles (R2) ; mêmes teintes que la carte (MIL_FRANCAIS_HEX, MIL_AUTRES_HEX, vérifié par test). */
export const FAMILY_COLOR: Readonly<Record<AircraftFamily, string>> = { francais: 'var(--cat-mil-francais)', autres: 'var(--cat-mil-autres)' };

/** Champ `emergency` d'adsb.lol (format ADSBexchange v2) en français ; « none » n'est jamais affiché. */
export const EMERGENCY_WORD: Readonly<Record<string, string>> = {
  general: 'urgence', lifeguard: 'urgence médicale', minfuel: 'carburant minimal', nordo: 'panne radio', unlawful: 'intervention illicite',
  downed: 'aéronef abattu', reserved: 'code réservé',
};

/** Catégorie d'un site de défense (tooltips de la carte, comptes du panneau). */
export const BASE_TYPE_WORD: Readonly<Record<MilitaryBase['type'], string>> = {
  air: 'air', navy: 'marine', army: 'terre', joint: 'interarmées', fortification: 'fortification', other: 'autre',
};

/** Secteurs publiés par ransomware.live (champ `activity`), en français ; une valeur inconnue n'est jamais affichée en anglais. */
export const SECTOR_WORD: Readonly<Record<string, string>> = {
  'Agriculture and Food Production': 'agriculture et agroalimentaire',
  'Business Services': 'services aux entreprises',
  Construction: 'construction',
  'Consumer Services': 'services aux particuliers',
  Education: 'enseignement',
  'Energy & Utilities': 'énergie et services publics',
  'Financial Services': 'finance',
  'Government & Defense': 'administration et défense',
  Healthcare: 'santé',
  Hospitality: 'hôtellerie et tourisme',
  'Hospitality and Tourism': 'hôtellerie et tourisme',
  Manufacturing: 'industrie',
  'Not Found': 'secteur non publié',
  Other: 'autre secteur',
  'Professional Services': 'services professionnels',
  'Public Sector': 'secteur public',
  'Retail & E-Commerce': 'commerce',
  Technology: 'technologie',
  Telecommunication: 'télécommunications',
  Transportation: 'transport',
  'Transportation/Logistics': 'transport et logistique',
};

/** Secteur en français ; vide : « secteur non publié » ; inconnu : « autre secteur ». */
export function sectorWord(label: string): string {
  const key = label.trim();
  if (key === '') return 'secteur non publié';
  return SECTOR_WORD[key] ?? 'autre secteur';
}

/** Produit d'une alerte ou d'un avis CERT-FR (titre sans « Multiples vulnérabilités dans »), sinon son titre. */
export function certfrProductText(item: CertFrItem): string {
  return item.product ?? item.title;
}

/** Numéro de système autonome : « AS3215 ». */
export function formatAsn(asn: number): string {
  return `AS${asn}`;
}

// ─── Veille des câbles non évaluée (tâche A5 : `evaluated: false` a quatre causes) ───

/** Erreur de la veille quand le fichier des câbles est illisible (api/_lib/cable-watch.js, CABLES_FILE_ERROR). */
export const CABLES_FILE_ERROR_TEXT = 'Câbles (Shom, OpenStreetMap) : fichier illisible';

/**
 * Cause d'une veille des câbles non évaluée : fichier des câbles illisible, relais AIS injoignable, relevé interrompu, sinon flux AIS
 * muet depuis son dernier message (T3). Sans majuscule initiale ; heure de Paris.
 */
export function cablesUnevaluatedWhy(w: Pick<CablesWatchResponse, 'aisLastMessageAt' | 'errors'>, now: number): string {
  if (w.errors.includes(CABLES_FILE_ERROR_TEXT)) return 'fichier des câbles illisible';
  if (w.errors.some((e) => e.startsWith('Relais AIS'))) return 'relais AIS injoignable';
  if (w.errors.some((e) => e.startsWith('Veille des câbles interrompue'))) return 'veille des câbles interrompue';
  return w.aisLastMessageAt !== null ? `AIS muet depuis ${clockOf(w.aisLastMessageAt, now)}` : 'AIS muet';
}

/** Le flux AIS manque au serveur (muet, relais injoignable ou relevé interrompu), pas seulement le fichier des câbles (panneau Défense). */
export function cablesAisDown(w: Pick<CablesWatchResponse, 'evaluated' | 'errors'>): boolean {
  return !w.evaluated && !w.errors.includes(CABLES_FILE_ERROR_TEXT);
}

// ─── R1 : unités et mots comptés de la souveraineté ───

/** Unités ; l'unité s'arrête là où finit un mot (« 9 militaires » n'est pas « 9 m »). */
const UNITS = String.raw`(?:nœuds|milles|km|ft|minutes?|min|Mo|m|h|j|%)(?![\p{L}\p{N}])`;
/** Mots comptés des raisons de pastille et des résumés : collés à leur nombre par glueSovUnits seulement. */
const COUNTED = String.raw`(?:aéronefs?|urgences?|navires?|câbles?|atterrages?|alertes?|avis|vulnérabilités?|revendications?|fuites?|mailles?|réseaux?|semaines?|jours?|entrées?|zones?|publications?|routeurs?|lectures?|heures?|sites?|rapports?|secteurs?|groupes?|sources?|appareils?|bâtiments?|préfixes?|points?|ouvrages?|mois|ans?)(?![\p{L}\p{N}])`;
/** Contrôle R1 des tests : unités et mots comptés (revue finale M2 : « 7 jours », « 22 avis », « 112 sites » passaient le contrôle). */
const SOV_BREAKABLE = new RegExp(String.raw`\d+(?:[,.]\d+)? (?:${UNITS}|${COUNTED})|Kp \d`, 'u');
const GLUE = new RegExp(String.raw`(\d+(?:[,.]\d+)?) (${UNITS}|${COUNTED})`, 'gu');
const GLUE_KP = /Kp (\d)/gu;

/** Contrôle R1 : premier « nombre, espace sécable, unité ou mot compté » (ft, nœuds, km, m, %, min, h, j ; jours, avis, sites…) ou « Kp, espace sécable, indice ». */
export function sovBreakable(text: string): string | null {
  return SOV_BREAKABLE.exec(text)?.[0] ?? null;
}

/**
 * Résumé « 6 sources » d'une section « Méthode et sources », déduit de la liste de ses sources (phase A puis phase B), jamais tapé
 * (arbitrage FX2 : les « 4 sources » ne comptaient pas la phase B). Nombre et mot insécables (R1).
 */
export function sourcesSummary(sources: readonly string[]): string {
  return `${sources.length}${NBSP}${sources.length > 1 ? 'sources' : 'source'}`;
}

/** Phrases des niveaux (raisons de pastille, espaces ordinaires) : espace insécable entre un nombre et son unité ou son mot compté. */
export function glueSovUnits(text: string): string {
  return text.replace(GLUE, `$1${NBSP}$2`).replace(GLUE_KP, `Kp${NBSP}$1`);
}

// ─── Phase B (tâche B19) : météo spatiale, visibilité des réseaux, jetons de catégorie ───

const MINUS_B = '\u2212';
const SCALE_TERMS: readonly string[] = ['aucun', 'mineur', 'modéré', 'fort', 'sévère', 'extrême'];

/** Indice Kp au tiers (NOAA) : « Kp 5− » pour 4,67, « Kp 5 », « Kp 5+ » pour 5,33 ; n.d. sans valeur. */
export function formatKp(kp: number | null | undefined): string {
  if (typeof kp !== 'number' || !Number.isFinite(kp)) return ND;
  const thirds = Math.round(kp * 3);
  const base = Math.round(thirds / 3);
  const rest = thirds - base * 3;
  return `Kp${NBSP}${base}${rest < 0 ? MINUS_B : rest > 0 ? '+' : ''}`;
}

/** Échelle G de la NOAA pour un Kp : 5− à 5+ G1, 6− à 6+ G2, 7− à 7+ G3, 8− à 9− G4, 9 G5 ; G0 en dessous de 5−. */
export function kpGScale(kp: number): number {
  const thirds = Math.round(kp * 3);
  if (thirds >= 27) return 5;
  if (thirds >= 23) return 4;
  return Math.max(0, Math.min(3, Math.round(thirds / 3) - 4));
}

/** Couleur d'une échelle G (contrats § 3.8) : G1 jaune, G2 et G3 orange, G4 et G5 rouge ; null pour G0 (calme, jeton CAT_KP_CALME). */
export function gScaleLevel(g: number): VigilanceLevel | null {
  if (g >= 4) return 'rouge';
  if (g >= 2) return 'orange';
  return g >= 1 ? 'jaune' : null;
}

function scaleWords(letter: 'R' | 'S' | 'G'): Readonly<Record<number, string>> {
  return Object.fromEntries(SCALE_TERMS.map((w, i) => [i, `${letter}${i}${NBSP}${w}`]));
}

/** Échelles NOAA en français, valeur insécable : de « R0 aucun » à « G5 extrême ». */
export const SCALE_WORD: Readonly<Record<'R' | 'S' | 'G', Readonly<Record<number, string>>>> = {
  R: scaleWords('R'), S: scaleWords('S'), G: scaleWords('G'),
};

/** Visibilité d'un réseau : « 99,4 % », « 100 % » ; n.d. sans valeur. */
export function formatPctVisibility(v: number | null | undefined): string {
  if (!ok(v)) return ND;
  const rounded = Math.round(v * 10) / 10;
  return `${frNumber(rounded, Number.isInteger(rounded) ? 0 : 1)}${NBSP}%`;
}

/** Jetons de catégorie de la phase B (R2), valeurs reprises dans sovereignty-legend.ts pour MapLibre. */
export const CAT_KP_CALME = 'var(--cat-kp-calme)';
export const CAT_GELS = 'var(--cat-gels)';
export const CAT_ZONE_DRONE = 'var(--cat-zone-drone)';
