// src/components/layer-panel/traffic-format.ts : formats, heures et couleurs communs des quatre panneaux Trafics et de leur carte
// (spec 2026-10-03 trafics § 1, § 3) ; pur, sans réseau ni DOM. Une valeur tient sur une ligne (R1) : espace insécable entre le
// nombre et l'unité, « n.d. » pour une valeur absente, jamais 0. Couleurs sans règle dans la spec : maquette validée (arbitrage 7).
import type { RailAxis, RailEffect, RailGroupStats, RoadEvent, RoadEventKind, Squawk } from '../../types/index.ts';
import { dataMs } from '../../services/traffic-source.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';
import { absoluteTime } from '../fiche/kit.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { NBSP, frNumber } from './format.ts';
import { emptyLine } from './frame.ts';

export { dataMs };

export const TRAFFIC_THEME = 'Trafics';
const ND = 'n.d.';
const PARIS = 'Europe/Paris';

function ok(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
function withUnit(v: number | null | undefined, digits: number, unit: string, signed = false): string {
  return ok(v) ? `${frNumber(v, digits, signed)}${NBSP}${unit}` : ND;
}

export function formatKm(v: number | null | undefined, digits = 1): string { return withUnit(v, digits, 'km'); }
export function formatMinutes(v: number | null | undefined, opts: { signed?: boolean; digits?: number } = {}): string {
  return withUnit(v, opts.digits ?? 0, 'min', opts.signed === true);
}
export function formatKmh(v: number | null | undefined): string { return withUnit(v, 0, 'km/h'); }
export function formatMeters(v: number | null | undefined): string { return withUnit(v, 0, 'm'); }
export function formatNm(v: number | null | undefined, digits = 1): string { return withUnit(v, digits, 'milles'); }
export function formatKnots(v: number | null | undefined, digits = 1): string { return withUnit(v, digits, 'nœuds'); }
export function formatCount(v: number | null | undefined): string { return ok(v) ? frNumber(v, 0) : ND; }
/**
 * Part en % : « < 0,1 % » sous 0,1 ; une décimale sous 1 (« 0,4 % ») ; entier dès 1 (« 7 % », « 12 % »). Une part arrondie à 1,0
 * s'écrit « 1 % » : jamais « 0,0 % » pour une part non nulle, jamais une décimale inutile.
 */
export function formatShare(v: number | null | undefined): string {
  if (!ok(v)) return ND;
  const abs = Math.abs(v);
  if (abs > 0 && abs < 0.1) return `<${NBSP}0,1${NBSP}%`;
  const digits = abs > 0 && abs < 0.95 ? 1 : 0;
  return `${frNumber(v, digits)}${NBSP}%`;
}

/** Heure de Paris de la donnée : « hh:mm » le jour même, « jj/mm hh:mm » sinon ; « n.d. » si absente ou illisible. */
export function clockOf(iso: string | null | undefined, now: number): string {
  const ms = dataMs(iso);
  return ms === null ? ND : absoluteTime(ms, now, 'fr');
}

/** « jj/mm/aaaa » (jour de Paris). */
export function dateOf(iso: string | null | undefined): string {
  const ms = dataMs(iso);
  return ms === null ? ND : new Date(ms).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: PARIS });
}

/** « jj/mm » dans l'année en cours, « jj/mm/aaaa » sinon. */
export function shortDate(iso: string | null | undefined, now: number): string {
  const ms = dataMs(iso);
  if (ms === null) return ND;
  const year = (v: number): string => new Date(v).toLocaleDateString('fr-FR', { year: 'numeric', timeZone: PARIS });
  return year(ms) === year(now)
    ? new Date(ms).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: PARIS })
    : dateOf(iso);
}

/** Source et heure de sa donnée (« DIR 14:57 », « TomTom 15:00 (en retard) », « SNCF n.d. »). */
export function stamp(label: string, iso: string | null | undefined, late: boolean, now: number): string {
  const clock = clockOf(iso, now).replace(' ', NBSP);
  return `${label}${NBSP}${clock}${late && clock !== ND ? `${NBSP}(en retard)` : ''}`;
}

/** « 4 accidents », « 1 bouchon », « 0 coupure ». */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${frNumber(n, 0)} ${Math.abs(n) > 1 ? many : one}`;
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Comparaison de noms sans accents ni casse (« Île-de-France » = « ile-de-france »). */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

export function note(text: string): string {
  return `<p class="fmk-note">${escapeHtml(text)}</p>`;
}

/** Partie en panne (S3) : jamais une liste vide silencieuse. */
export function sourceDown(name: string): string {
  return emptyLine(`Source indisponible : ${name}.`);
}

/** Liste vide : « source indisponible » quand la réponse signale une panne (`errors[]` non vide), sinon la phrase d'absence. */
export function emptyOrDown(errors: readonly string[], emptyText: string, name: string): string {
  return errors.length > 0 ? sourceDown(name) : emptyLine(emptyText);
}

/** Messages d'erreur de la réponse, pour « Méthode et sources ». */
export function readErrors(errors: readonly string[]): string {
  return errors.length > 0 ? note(`Incidents de lecture : ${errors.join(' ; ')}.`) : '';
}

/** Unités des trafics ; l'unité s'arrête là où finit un mot (« 5 mètres » n'est pas « 5 m »). */
const UNITS = String.raw`(?:km\/h|km|min|milles|nœuds|ft|m|h|%)(?![\p{L}\p{N}])`;
/** Mots comptés des lignes de niveau (« 6 trains », « 4 accidents ») : collés à leur nombre par `glueUnits` seulement. */
const COUNTED = String.raw`(?:trains?|accidents?|coupures?|navires?|vols?|départs?)(?![\p{L}\p{N}])`;
const TRAFFIC_BREAKABLE = new RegExp(String.raw`\d+(?:[,.]\d+)? ${UNITS}`, 'u');
const GLUE_UNITS = new RegExp(String.raw`(\d+(?:[,.]\d+)?) (${UNITS}|${COUNTED})`, 'gu');

/** Contrôle R1 des unités des trafics, en complément de `breakableValue` (format.ts) : premier « nombre, espace sécable, unité ». */
export function trafficBreakable(text: string): string | null {
  return TRAFFIC_BREAKABLE.exec(text)?.[0] ?? null;
}

/** Phrases de la partie A (raisons des pastilles, espaces ordinaires) : espace insécable entre un nombre et son unité (R1). */
export function glueUnits(text: string): string {
  return text.replace(GLUE_UNITS, `$1${NBSP}$2`);
}

/** Trajectoires inhabituelles : clés de la partie A (tâche 6), libellés en minuscules pour la ligne « indicatif · type ». */
export const AIR_ANOMALY_LABEL: Readonly<Record<string, string>> = {
  holding: 'circuit d’attente', 'go-around': 'approche interrompue', 'rapid-manoeuvre': 'manœuvre brusque', 'reroute-probable': 'déroutement probable',
};

/** Clé inconnue : reprise telle quelle (échappée par la ligne qui l'affiche). */
export function anomalyLabel(kind: string): string {
  return AIR_ANOMALY_LABEL[kind] ?? kind;
}

/** « 45,673 N 0,140 E » (police du texte, jamais à chasse fixe). */
export function coordText(lat: number, lon: number): string {
  return `${frNumber(Math.abs(lat), 3)}${NBSP}${lat >= 0 ? 'N' : 'S'}${NBSP}${frNumber(Math.abs(lon), 3)}${NBSP}${lon >= 0 ? 'E' : 'O'}`;
}

// ─── Puces et couleurs (arbitrage 7), partagées par les vues et la carte ───

/** Puce d'un événement routier (maquette) : accident rouge ; bouchon, coupure, météo orange ; obstacle, voie jaune ; travaux et information gris. */
export const ROAD_EVENT_LEVEL: Readonly<Record<RoadEventKind, VigilanceLevel | 'gris'>> = {
  accident: 'rouge', queue: 'orange', closure: 'orange', weather: 'orange', obstruction: 'jaune', lane: 'jaune', works: 'gris', info: 'gris',
};
/** Nature d'un événement routier en français (export CSV, textes) ; jamais la clé anglaise du contrat. */
export const ROAD_KIND_WORD: Readonly<Record<RoadEventKind, string>> = {
  accident: 'accident', queue: 'bouchon', closure: 'coupure', weather: 'météo', obstruction: 'obstacle', lane: 'voie fermée', works: 'travaux',
  info: 'information',
};
/** Gravité DATEX II d'un événement routier en français (export CSV). */
export const ROAD_SEVERITY_WORD: Readonly<Record<NonNullable<RoadEvent['severity']>, string>> = {
  low: 'faible', medium: 'moyenne', high: 'élevée', highest: 'très élevée',
};
/** Ordre des événements en cours (maquette) : accidents, bouchons, coupures, météo, obstacles, voies, travaux, information. */
export const ROAD_KIND_ORDER: Readonly<Record<RoadEventKind, number>> = {
  accident: 0, queue: 1, closure: 2, weather: 3, obstruction: 4, lane: 5, works: 6, info: 7,
};
/** Jauge par DIR : nombre d'incidents en cours, jaune dès 7, orange dès 20, rouge dès 40. */
export function dirLoadLevel(incidents: number): VigilanceLevel {
  return incidents >= 40 ? 'rouge' : incidents >= 20 ? 'orange' : incidents >= 7 ? 'jaune' : 'vert';
}
/** Importance d'un bouchon du récapitulatif du CNIR (*, **, ***). */
export const IMPORTANCE_LEVEL: Readonly<Record<1 | 2 | 3, VigilanceLevel>> = { 1: 'vert', 2: 'jaune', 3: 'orange' };
/** Vitesse moyenne d'une station QTV : rouge sous 30 km/h, orange sous 50, jaune sous 70. */
export function speedLevel(kmh: number): VigilanceLevel {
  return kmh < 30 ? 'rouge' : kmh < 50 ? 'orange' : kmh < 70 ? 'jaune' : 'vert';
}
/** Bouchon TomTom : magnitude 1 (ralenti) jaune, 2 (à-coups) orange, 3 (bouchon) rouge. */
export function jamLevel(magnitude: 1 | 2 | 3): VigilanceLevel {
  return magnitude >= 3 ? 'rouge' : magnitude === 2 ? 'orange' : 'jaune';
}
export const SQUAWK_WORD: Readonly<Record<Squawk, string>> = { '7500': 'détournement', '7600': 'panne radio', '7700': 'urgence' };
/** Puce d'une urgence, comme la pastille (spec § 3.2) : 7500 rouge, 7700 orange, 7600 jaune. */
export const SQUAWK_LEVEL: Readonly<Record<Squawk, VigilanceLevel>> = { '7500': 'rouge', '7700': 'orange', '7600': 'jaune' };
/** Groupe ferroviaire (axe, région) : retard moyen jaune dès 20 min, orange dès 45, rouge dès 90 ou 10 trains supprimés. */
export function railGroupLevel(g: Pick<RailGroupStats, 'avgDelayMin' | 'cancelled'>): VigilanceLevel | 'gris' {
  if (g.cancelled >= 10) return 'rouge';
  const avg = g.avgDelayMin;
  if (avg === null || !Number.isFinite(avg)) return 'gris';
  return avg >= 90 ? 'rouge' : avg >= 45 ? 'orange' : avg >= 20 ? 'jaune' : 'vert';
}
/** Train ou gare : jaune dès 15 min (seuil des grandes lignes de la spec), orange dès 45, rouge dès 90 ; supprimé rouge. */
export function railDelayLevel(delayMin: number | null, cancelled: boolean): VigilanceLevel | 'gris' {
  if (cancelled) return 'rouge';
  if (delayMin === null || !Number.isFinite(delayMin)) return 'gris';
  return delayMin >= 90 ? 'rouge' : delayMin >= 45 ? 'orange' : delayMin >= 15 ? 'jaune' : 'vert';
}
export const RAIL_EFFECT_WORD: Readonly<Record<RailEffect, string>> = {
  retard: 'retard', supprime: 'supprimé', 'service-reduit': 'service réduit', detour: 'détour', modifie: 'service modifié', ajoute: 'train ajouté',
};
export const RAIL_AXIS_LABEL: Readonly<Record<RailAxis, string>> = {
  'sud-est': 'Sud-Est', atlantique: 'Atlantique', nord: 'Nord', est: 'Est', 'intercites-bercy': 'Intercités Bercy', normandie: 'Normandie',
  province: 'Province, transversales',
};
/** Jetons de catégorie (R2) : jauges des aéroports, jauges des ports et route récente d'un navire. */
export const CAT_AIRPORT = 'var(--cat-airport)';
export const CAT_PORT = 'var(--cat-port)';
