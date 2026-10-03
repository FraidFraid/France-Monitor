// src/components/layer-panel/health-format.ts : formats et lectures communs des panneaux Santé (spec 2026-10-03 § 1 et § 3) ;
// pur, sans réseau ni DOM. Une valeur tient sur une ligne (R1) ; hausse d'un indicateur sanitaire en rouge, baisse en vert.
import type { AplProfession, HospitalCategory, SyndromeKey, SyndromicResponse, SyndromicSeries } from '../../types/index.ts';
import { URGENCES_PILL_SYNDROMES, franceRefs, seasonalLevel, type HealthLevel } from '../../services/health-levels.ts';
import { dataDateMs } from '../../services/health-surveillance.ts';
import { DEPARTEMENT_NAMES } from '../../config/departements.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';
import { formatPct, formatSignedPct, frNumber } from './format.ts';
import { emptyLine, valueHtml } from './frame.ts';

const DAY_MS = 86_400_000;

/** « pour 100 000 habitants » : séparateur de milliers insécable (U+202F), jamais coupé. */
export const PER_100K = `pour ${frNumber(100_000, 0)} habitants`;

/** Libellés des syndromes Odissé (spec § 2.1). */
export const SYNDROME_LABEL: Readonly<Record<SyndromeKey, string>> = {
  ira: 'IRA', bronchio: 'Bronchiolite', gastro: 'Gastro-entérite', asthme: 'Asthme', allergie: 'Allergie', grippe: 'Grippe', covid: 'COVID-19',
};

/** « 2026-S39 » → « S39 ». */
export function weekShort(id: string): string {
  const m = /S(\d{1,2})$/.exec(id);
  return m ? `S${Number(m[1])}` : id;
}

/** « 2026-S39 » → 39 ; null si illisible. */
export function weekNumber(id: string): number | null {
  const m = /S(\d{1,2})$/.exec(id);
  return m ? Number(m[1]) : null;
}

/** « 2026-S39 » → 2026 ; null si illisible. */
export function weekYear(id: string): number | null {
  const m = /^(\d{4})-S\d{1,2}$/.exec(id);
  return m ? Number(m[1]) : null;
}

/** Semaine ISO d'une date « AAAA-MM-JJ » : « 2026-S39 » (jeudi de la semaine, 4 janvier en semaine 1). */
export function isoWeekId(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / DAY_MS - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-S${String(week).padStart(2, '0')}`;
}

/** Date « AAAA-MM-JJ » décalée de `days` jours (calendrier, sans fuseau). */
export function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Date « AAAA-MM-JJ » ou ISO → « jj/mm », jour de Paris ; « n.d. » si absente ou illisible. */
export function parisDay(value: string | null | undefined): string {
  const ms = dataDateMs(value);
  return ms === null ? 'n.d.' : new Date(ms).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' });
}

/** Évolution en % ; null si une valeur manque ou si la référence est nulle. */
export function changePct(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return (current / previous - 1) * 100;
}

/** Spec § 3.2 : hausse de 10 % ou plus rouge, baisse de 10 % ou plus verte, sinon neutre ; seuil sur la valeur affichée (arrondie). */
export function changeLevel(pct: number | null): VigilanceLevel | null {
  if (pct === null || !Number.isFinite(pct)) return null;
  const shown = Math.round(pct);
  if (shown >= 10) return 'rouge';
  if (shown <= -10) return 'vert';
  return null;
}

/** Évolution affichée (« +11 % »), colorée ; aucune couleur si la donnée est en retard. */
export function changeHtml(pct: number | null, late = false): string {
  if (pct === null) return valueHtml('n.d.');
  return valueHtml(formatSignedPct(pct, 0), late ? null : changeLevel(pct));
}

export type TrendDir = 'up' | 'down' | 'stable';

/** Tendance en mots (« en augmentation », « légère augmentation », « stable », « en diminution ») → sens ; null si inconnue. */
export function trendOf(words: string | null): TrendDir | null {
  if (!words) return null;
  if (/augment|hausse/i.test(words)) return 'up';
  if (/diminu|baisse/i.test(words)) return 'down';
  if (/stable/i.test(words)) return 'stable';
  return null;
}

/** Flèche d'un indicateur sanitaire : ▲ rouge en hausse, ▼ verte en baisse, « = » neutre ; sans couleur en retard. */
export function trendArrowHtml(dir: TrendDir | null, late = false): string {
  if (dir === null) return '';
  if (dir === 'stable') return '<span class="lp-trend" aria-label="stable">=</span>';
  const level = late ? '' : dir === 'up' ? ' lp-lvl lp-lvl--rouge' : ' lp-lvl lp-lvl--vert';
  return `<span class="lp-trend${level}" aria-label="${dir === 'up' ? 'en hausse' : 'en baisse'}">${dir === 'up' ? '▲' : '▼'}</span>`;
}

/** Section d'une source en échec sans donnée antérieure (S3) : jamais une liste vide silencieuse. */
export function sourceUnavailable(name: string): string {
  return emptyLine(`Source indisponible : ${name}.`);
}

/** Rapport « ×2 » : entier quand l'arrondi est à moins de 0,05 près, sinon une décimale. */
export function ratioText(r: number): string {
  const rounded = Math.round(r);
  return `×${Math.abs(r - rounded) < 0.05 ? frNumber(rounded, 0) : frNumber(r, 1)}`;
}

/** Libellé dans une phrase : sigles (IRA, COVID-19) tels quels, sinon initiale en minuscule. */
export function inSentence(label: string): string {
  return /^[A-Z0-9-]{2,}\b/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** « a », « a et b », « a, b et c ». */
export function joinFr(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} et ${items[items.length - 1]}`;
}

/** Lieu d'une région Odissé (nouvelles régions et DROM 01 à 06) précédé de sa préposition. */
const REGION_IN: Readonly<Record<string, string>> = {
  '01': 'en Guadeloupe', '02': 'en Martinique', '03': 'en Guyane', '04': 'à La Réunion', '06': 'à Mayotte',
  '11': 'en Île-de-France', '24': 'en Centre-Val de Loire', '27': 'en Bourgogne-Franche-Comté', '28': 'en Normandie',
  '32': 'dans les Hauts-de-France', '44': 'dans le Grand Est', '52': 'dans les Pays de la Loire', '53': 'en Bretagne',
  '75': 'en Nouvelle-Aquitaine', '76': 'en Occitanie', '84': 'en Auvergne-Rhône-Alpes', '93': 'en Provence-Alpes-Côte d’Azur', '94': 'en Corse',
};

export function regionIn(code: string, name: string): string {
  return REGION_IN[code] ?? `en ${name}`;
}

const DIGIT_WORDS: readonly string[] = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf'];

/** 0 à 9 en lettres (« six habitants sur dix »), sinon en chiffres. */
export function digitWord(n: number): string {
  return DIGIT_WORDS[n] ?? String(n);
}

export interface SeasonalReading { value: number | null; previous: number | null; refs: number[]; level: HealthLevel }

/** Semaine `weekId` d'une série France : valeur, semaine précédente, même semaine des saisons précédentes, niveau saisonnier. */
export function seasonalReading(series: SyndromicSeries, weekId: string): SeasonalReading {
  const point = series.france.find((p) => p.week === weekId) ?? null;
  const prev = point ? series.france.find((p) => p.start === shiftDate(point.start, -7)) ?? null : null;
  const refs = franceRefs(series.france, weekId);
  const value = point?.er ?? null;
  return { value, previous: prev?.er ?? null, refs, level: seasonalLevel(value, refs) };
}

/** Décimales d'une lecture saisonnière : deux quand la valeur et une borne s'arrondissent pareil au dixième (1,10 % contre 1,06 %), sinon une. */
export function seasonalDigits(r: SeasonalReading): number {
  if (r.value === null || r.refs.length === 0) return 1;
  const one = formatPct(r.value, 1);
  return one === formatPct(Math.max(...r.refs), 1) || one === formatPct(Math.min(...r.refs), 1) ? 2 : 1;
}

/**
 * Position par rapport aux saisons précédentes, selon la règle du niveau saisonnier (partie A) : vert au plus leur maximum,
 * jaune au-dessus, orange à 1,15 fois le maximum ou plus, rouge à 1,5 fois ou plus ; null si n.d.
 */
export function positionWords(r: SeasonalReading): string | null {
  switch (r.level) {
    case 'vert':
      return r.value !== null && r.refs.length > 0 && r.value < Math.min(...r.refs) ? 'sous les saisons précédentes' : 'dans la fourchette des saisons précédentes';
    case 'jaune': return 'au-dessus des saisons précédentes';
    case 'orange': return 'bien au-dessus des saisons précédentes';
    case 'rouge': return 'très au-dessus des saisons précédentes';
    default: return null;
  }
}

/** Note de comparaison saisonnière : bornes ou maximum de la même semaine des saisons de référence (valeurs insécables). */
export function seasonalNote(r: SeasonalReading): string {
  const n = r.refs.length;
  if (r.value === null || n < 2) return 'comparaison saisonnière n.d. (moins de deux saisons de référence)';
  const digits = seasonalDigits(r);
  const min = formatPct(Math.min(...r.refs), digits);
  const max = formatPct(Math.max(...r.refs), digits);
  const same = `des ${n} saisons précédentes à la même semaine`;
  switch (r.level) {
    case 'rouge': return `au moins 1,5 fois le maximum ${same} (${max})`;
    case 'orange': return `au moins 1,15 fois le maximum ${same} (${max})`;
    case 'jaune': return `au-dessus ${same} (maximum ${max})`;
    default:
      return r.value < Math.min(...r.refs)
        ? `sous les ${n} saisons précédentes à la même semaine (${min} à ${max})`
        : `dans la fourchette ${same} (${min} à ${max})`;
  }
}

/** Syndrome qui porte le niveau des urgences : le premier de URGENCES_PILL_SYNDROMES à ce niveau, IRA par défaut. */
export function urgencesDriver(d: SyndromicResponse, level: HealthLevel): SyndromeKey {
  const week = d.week;
  if (!week) return 'ira';
  return URGENCES_PILL_SYNDROMES.find((k) => {
    const s = d.syndromes.find((x) => x.key === k);
    return s !== undefined && seasonalReading(s, week.id).level === level;
  }) ?? 'ira';
}

// ─── Urgences et SOS Médecins : sélecteur de la carte et des départements (spec § 3.2) ───

export type UrgencesSyndrome = 'ira' | 'bronchio' | 'gastro';
/** Syndromes du sélecteur, IRA par défaut (premier). */
export const URGENCES_SYNDROMES: readonly UrgencesSyndrome[] = ['ira', 'bronchio', 'gastro'];
export const URGENCES_SYNDROME_LABEL: Readonly<Record<UrgencesSyndrome, string>> = { ira: 'IRA', bronchio: 'Bronchiolite', gastro: 'Gastro-entérite' };

// ─── Accès aux soins : professions et seuils (spec § 3.3) ───

export const APL_PROFESSIONS: readonly AplProfession[] = ['mg', 'inf', 'kine', 'sf', 'dent'];
export const APL_PROFESSION_LABEL: Readonly<Record<AplProfession, string>> = {
  mg: 'Médecins généralistes', inf: 'Infirmiers', kine: 'Kinésithérapeutes', sf: 'Sages-femmes', dent: 'Chirurgiens-dentistes',
};
export const APL_PROFESSION_SHORT: Readonly<Record<AplProfession, string>> = {
  mg: 'Généralistes', inf: 'Infirmiers', kine: 'Kinés', sf: 'Sages-femmes', dent: 'Dentistes',
};
/** Unités DREES : consultations par habitant standardisé (généralistes), ETP pour 100 000 habitants (sages-femmes : femmes). */
export const APL_UNIT: Readonly<Record<AplProfession, string>> = {
  mg: 'consultations par an et par habitant', inf: `ETP ${PER_100K}`, kine: `ETP ${PER_100K}`,
  sf: `ETP pour ${frNumber(100_000, 0)} femmes`, dent: `ETP ${PER_100K}`,
};
export const APL_DIGITS: Readonly<Record<AplProfession, number>> = { mg: 2, inf: 1, kine: 1, sf: 1, dent: 1 };

/** Généralistes (spec § 3.3) : rouge sous 2,5, orange de 2,5 à 3,5, jaune de 3,5 à 4, vert au-delà. */
export function aplMgLevel(apl: number): VigilanceLevel {
  return apl < 2.5 ? 'rouge' : apl < 3.5 ? 'orange' : apl < 4 ? 'jaune' : 'vert';
}

/** Autres professions : rapport à la moyenne nationale, rouge sous 0,5, orange sous 0,75, jaune sous 1, vert au-delà. */
export function aplRatioLevel(value: number, national: number): VigilanceLevel | null {
  if (!(national > 0) || !Number.isFinite(value)) return null;
  const r = value / national;
  return r < 0.5 ? 'rouge' : r < 0.75 ? 'orange' : r < 1 ? 'jaune' : 'vert';
}

export function aplProfessionLevel(p: AplProfession, value: number | null, national: number | null): VigilanceLevel | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (p === 'mg') return aplMgLevel(value);
  return national === null ? null : aplRatioLevel(value, national);
}

// ─── Hôpitaux : catégories (jetons --cat-hosp-*) et noms de départements (spec § 3.4, § 3.6) ───

export const HOSPITAL_CATEGORY_ORDER: readonly HospitalCategory[] = ['chu', 'ch', 'private', 'gcs', 'army', 'other'];
export const HOSPITAL_CATEGORY_LABEL: Readonly<Record<HospitalCategory, string>> = {
  chu: 'CHU et CHR', ch: 'Centres hospitaliers', private: 'Cliniques privées', gcs: 'Groupements (GCS)', army: 'Hôpitaux des armées',
  other: 'Autres établissements',
};

/** Couleur de catégorie d'un site (jeton CSS) ; « autres » reprend le gris de catégorie --mix-other. */
export function hospitalCategoryVar(c: HospitalCategory): string {
  return c === 'other' ? 'var(--mix-other)' : `var(--cat-hosp-${c})`;
}

/** Codes INSEE dans l'ordre de DEPARTEMENT_NAMES : 01 à 19, 2A, 2B, 21 à 95, puis les DROM. */
const DEPARTEMENT_CODES: readonly string[] = [
  ...Array.from({ length: 19 }, (_, i) => String(i + 1).padStart(2, '0')), '2A', '2B',
  ...Array.from({ length: 75 }, (_, i) => String(i + 21)), '971', '972', '973', '974', '976',
];
const DEPARTEMENT_BY_CODE = new Map<string, string>(DEPARTEMENT_CODES.map((code, i) => [code, DEPARTEMENT_NAMES[i] ?? code]));

export function departementName(code: string): string {
  return DEPARTEMENT_BY_CODE.get(code) ?? code;
}
