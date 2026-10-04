// src/components/layer-panel/sovereignty-format.ts : formats, mots et couleurs communs des panneaux Souveraineté (Défense, Connectivité,
// Vigilance cyber) et de leur carte (spec 2026-10-04 souveraineté § 1, § 2 ; contrats § 3.6). Pur, sans réseau ni DOM. Une valeur tient
// sur une ligne (R1) : espace insécable entre le nombre et l'unité, « n.d. » pour une valeur absente, jamais 0. Les formats communs
// viennent des Trafics et de l'Environnement ; aucun texte anglais brut d'une source n'est affiché (audit 32).
import type { AircraftFamily, CablesWatchResponse, CertFrItem, MilitaryBase } from '../../types/index.ts';
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

/** Indicatif publié, sinon l'adresse OACI (« adresse 3bf004 ») : jamais une ligne sans nom. */
export function aircraftLabel(a: { callsign: string | null; hex: string }): string {
  const callsign = a.callsign?.trim() ?? '';
  return callsign !== '' ? callsign : `adresse ${a.hex}`;
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
export const CABLES_FILE_ERROR_TEXT = 'Câbles OpenStreetMap : fichier illisible';

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
const UNITS = String.raw`(?:nœuds|km|ft|min|m|h|j|%)(?![\p{L}\p{N}])`;
/** Mots comptés des raisons de pastille et des résumés : collés à leur nombre par glueSovUnits seulement. */
const COUNTED = String.raw`(?:aéronefs?|urgences?|navires?|câbles?|atterrages?|alertes?|avis|vulnérabilités?|revendications?|fuites?|mailles?|réseaux?|semaines?|jours?)(?![\p{L}\p{N}])`;
const SOV_BREAKABLE = new RegExp(String.raw`\d+(?:[,.]\d+)? ${UNITS}|Kp \d`, 'u');
const GLUE = new RegExp(String.raw`(\d+(?:[,.]\d+)?) (${UNITS}|${COUNTED})`, 'gu');
const GLUE_KP = /Kp (\d)/gu;

/** Contrôle R1 : premier « nombre, espace sécable, unité » (ft, nœuds, km, m, %, min, h, j) ou « Kp, espace sécable, indice ». */
export function sovBreakable(text: string): string | null {
  return SOV_BREAKABLE.exec(text)?.[0] ?? null;
}

/** Phrases des niveaux (raisons de pastille, espaces ordinaires) : espace insécable entre un nombre et son unité ou son mot compté. */
export function glueSovUnits(text: string): string {
  return text.replace(GLUE, `$1${NBSP}$2`).replace(GLUE_KP, `Kp${NBSP}$1`);
}
