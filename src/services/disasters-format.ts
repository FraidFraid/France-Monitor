// src/services/disasters-format.ts : libellés français des alertes GDACS (spec 2026-10-12 GDACS) et alertes « contexte européen ».
// GDACS publie gravité et nom en anglais ; les sept formats relevés le 12/10/2026 sont traduits ici (vent en km/h, jamais en mph ;
// nombres à la française, unité insécable). Un format inconnu garde le texte d'origine plutôt que d'inventer. Module pur.
import type { DisasterAlert } from '../types/index.ts';
import { NBSP, frNumber } from '../components/layer-panel/format.ts';

/** Libellé du territoire « métropole » posé par le serveur (api/_lib/gdacs.js, FRENCH_TERRITORIES). */
export const METROPOLE_LABEL = 'France (Hexagone et Corse)';

/**
 * Alerte qui touche la métropole mais dont l'événement est centré hors de France (pays principal GDACS étranger, ex. sécheresse
 * d'Europe centrale) : contexte, hors du chiffre et de la couleur du panneau, en gris sur la carte. Outre-mer : jamais (un cyclone
 * du Mozambique qui frappe Mayotte reste une alerte française). Séisme en mer sans pays : français.
 */
export function isEuropeanContext(a: DisasterAlert): boolean {
  return a.frenchTerritory === METROPOLE_LABEL && a.countries.length > 0 && a.countries[0] !== 'FRA';
}

const CYCLONE_CLASS: ReadonlyArray<readonly [RegExp, string]> = [
  [/^Hurricane\/Typhoon/i, 'Ouragan ou typhon'],
  [/^Moderate Tropical Storm/i, 'Tempête tropicale modérée'],
  [/^Severe Tropical Storm/i, 'Tempête tropicale sévère'],
  [/^Tropical Storm/i, 'Tempête tropicale'],
  [/^Tropical Depression/i, 'Dépression tropicale'],
];
const IMPACT: Readonly<Record<string, string>> = { minor: 'faible', low: 'faible', medium: 'moyen', major: 'fort', high: 'fort', severe: 'fort' };

const num = (text: string): number => Number(text.replace(/,/g, ''));

/** Gravité GDACS en français ; null si absente, vide ou « Magnitude 0 » (inondations) ; format inconnu : texte d'origine. */
export function frenchSeverity(a: DisasterAlert): string | null {
  const s = (a.severity ?? '').trim();
  if (s === '' || /^Magnitude 0(?![\d.,])/.test(s)) return null;
  const wind = /maximum wind speed of ([\d.]+) km\/h/i.exec(s);
  const cls = CYCLONE_CLASS.find(([re]) => re.test(s));
  if (cls && wind) return `${cls[1]}, vent maximal ${frNumber(num(wind[1] ?? ''), 0)}${NBSP}km/h`;
  const quake = /^Magnitude ([\d.]+)M?, Depth:\s*([\d.]+)\s*km/i.exec(s);
  if (quake) return `Magnitude ${frNumber(num(quake[1] ?? ''), 1)}, profondeur ${frNumber(num(quake[2] ?? ''), 0)}${NBSP}km`;
  const drought = /^(\w+) impact for agricultural drought in ([\d.,]+) km2/i.exec(s);
  const impact = drought ? IMPACT[(drought[1] ?? '').toLowerCase()] : undefined;
  if (drought && impact) return `Sécheresse agricole, impact ${impact}, ${frNumber(num(drought[2] ?? ''), 0)}${NBSP}km²`;
  const fire = /impact for forest ?fire in ([\d.,]+) ha/i.exec(s);
  if (fire) return `${frNumber(num(fire[1] ?? ''), 0)}${NBSP}ha touchés`;
  return s;
}

/**
 * Nom GDACS en français quand il apporte quelque chose : nom propre d'un cyclone ou d'un volcan, nombre de pays d'un événement
 * étendu ; null quand il ne fait que répéter l'aléa et le pays (« Earthquake in Panama »). Le nom d'origine reste en infobulle.
 */
export function frenchName(a: DisasterAlert): string | null {
  const name = a.name.trim();
  const cyclone = /^Tropical Cyclone\s+(.+)$/i.exec(name);
  if (cyclone) return `Cyclone tropical ${cyclone[1]}`;
  const volcano = /^Eruption\s+(.+)$/i.exec(name);
  if (volcano) {
    const v = volcano[1] ?? '';
    return /^[AEIOUYÉÈH]/i.test(v) ? `Éruption de l’${v}` : `Éruption du ${v}`;
  }
  return a.countries.length > 1 ? `${a.countries.length} pays touchés` : null;
}
