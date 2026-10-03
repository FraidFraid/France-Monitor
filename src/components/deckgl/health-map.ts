// src/components/deckgl/health-map.ts : couches santé de la carte (spec 2026-10-03 § 3.1 à 3.4), parties pures.
// Régions colorées par les alertes Odissé en saison, départements par le niveau saisonnier des urgences ou par l'APL,
// sites d'urgences ; infobulles et fiche de site.
// MapLibre ne lit pas les variables CSS : niveaux en levelHex (palette L1), catégories d'hôpitaux copiées des jetons
// --cat-hosp-* de main.css (vérifié par test). Aucun import de vue : la carte ne charge pas les panneaux.
import type { ExpressionSpecification } from 'maplibre-gl';
import type {
  AplDataset, AplDepartment, AplProfession, EmergencySite, HospitalCategory, HospitalsDataset, RegionalAlertLevel,
  SyndromicDepartment, SyndromicResponse,
} from '../../types/index.ts';
import { alertInSeason, phaseLabel, phaseLevel, seasonalLevel, type HealthLevel } from '../../services/health-levels.ts';
import { LEVEL_RANK, levelColorVar, levelHex, levelLabel, type VigilanceLevel } from '../../services/vigilance.ts';
import { NBSP, formatPct, frNumber } from '../layer-panel/format.ts';
import {
  APL_DIGITS, APL_PROFESSIONS, APL_PROFESSION_LABEL, APL_UNIT, HOSPITAL_CATEGORY_LABEL, URGENCES_SYNDROMES, URGENCES_SYNDROME_LABEL,
  aplProfessionLevel, departementName, joinFr, parisDay, seasonalDigits, weekShort, type SeasonalReading, type UrgencesSyndrome,
} from '../layer-panel/health-format.ts';
import { urgencesLate } from '../layer-panel/urgences-legend.ts';
import {
  LYR_HEALTH_ALERT_FILL, LYR_HEALTH_ALERT_LINE, LYR_HEALTH_APL_FILL, LYR_HEALTH_APL_LINE, LYR_HEALTH_URG_FILL, LYR_HEALTH_URG_LINE, LYR_HOSPITALS,
} from './constants.ts';
import { escapeHtml } from './format-utils.ts';

/** Hors saison (régions) : gris clair, distinct du vert « pas d'alerte » (spec § 3.1). */
export const HEALTH_OFF_SEASON_HEX = '#c7c7cc';
/** Jetons --cat-hosp-* de main.css ; « autres » : --mix-other. */
export const HOSPITAL_CATEGORY_HEX: Readonly<Record<HospitalCategory, string>> = {
  chu: '#64d2ff', ch: '#bf5af2', private: '#5e5ce6', gcs: '#30b0c7', army: '#ac8e68', other: '#71717a',
};
const TRANSPARENT = 'rgba(0, 0, 0, 0)';

export function urgencesProp(s: UrgencesSyndrome): string {
  return `urg_${s}`;
}

export function aplProp(p: AplProfession): string {
  return `apl_${p}`;
}

/** Couleur portée par une propriété de la géométrie ; absente (n.d.) : transparent, jamais une couleur de niveau. */
export function colorFromProp(prop: string): ExpressionSpecification {
  return ['coalesce', ['get', prop], TRANSPARENT];
}

export const HOSPITAL_COLOR: ExpressionSpecification = [
  'match', ['get', 'category'],
  'chu', HOSPITAL_CATEGORY_HEX.chu, 'ch', HOSPITAL_CATEGORY_HEX.ch, 'private', HOSPITAL_CATEGORY_HEX.private,
  'gcs', HOSPITAL_CATEGORY_HEX.gcs, 'army', HOSPITAL_CATEGORY_HEX.army,
  HOSPITAL_CATEGORY_HEX.other,
];

/** Surface proportionnelle aux passages annuels : rayon = racine, 3 px sans donnée, 12 px vers 133 000 passages. */
export const HOSPITAL_RADIUS: ExpressionSpecification = ['interpolate', ['linear'], ['sqrt', ['get', 'passages']], 0, 3, 365, 12];

// ─── Infobulles : texte de l'interface, valeurs insécables (R1), tout texte de source échappé ───

/** Puce de niveau des infobulles : variable CSS de la palette L1 (le HTML se colore par les jetons, la carte par levelHex). */
function dot(level: VigilanceLevel): string {
  return `<i class="hm-dot" style="background:${levelColorVar(level)}"></i>`;
}

function row(label: string, valueHtml: string): string {
  return `<div class="hm-row"><span>${escapeHtml(label)}</span><span>${valueHtml}</span></div>`;
}

function head(title: string, sub: string): string {
  return `<b>${escapeHtml(title)}</b><div class="hm-sub">${escapeHtml(sub)}</div>`;
}

function tip(body: string): string {
  return `<div class="hm-tip">${body}</div>`;
}

function note(text: string): string {
  return `<div class="hm-note">${escapeHtml(text)}</div>`;
}

// ─── Régions : alertes Odissé (Veille sanitaire, § 3.1) ───

const PATHOLOGIES = ['grippe', 'bronchiolite'] as const;
const PATHOLOGY_LABEL: Readonly<Record<(typeof PATHOLOGIES)[number], string>> = { grippe: 'Grippe', bronchiolite: 'Bronchiolite' };

export interface RegionAlert { level: VigilanceLevel | 'hors'; lines: RegionalAlertLevel[] }

/** Plus haut niveau des lignes en saison (grippe, bronchiolite) ; aucune ligne en saison : hors saison. */
export function regionAlert(region: string, levels: readonly RegionalAlertLevel[], now: number): RegionAlert {
  const lines = levels.filter((l) => l.region === region);
  const inSeason = lines.filter((l) => alertInSeason(l, now));
  if (inSeason.length === 0) return { level: 'hors', lines };
  const level = inSeason.reduce<VigilanceLevel>((worst, l) => {
    const lv = phaseLevel(l.phase);
    return LEVEL_RANK[lv] > LEVEL_RANK[worst] ? lv : worst;
  }, 'vert');
  return { level, lines };
}

/** Niveau L1, gris clair hors saison, sans couleur (null) quand la région n'a aucune ligne publiée. */
export function regionAlertColor(a: RegionAlert): string | null {
  if (a.lines.length === 0) return null;
  return a.level === 'hors' ? HEALTH_OFF_SEASON_HEX : levelHex(a.level);
}

export function regionAlertFeatures(geo: GeoJSON.FeatureCollection, levels: readonly RegionalAlertLevel[], now: number): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: geo.features.map((f): GeoJSON.Feature => {
      const code = String(f.properties?.['code'] ?? '');
      return { ...f, properties: { ...(f.properties ?? {}), hmColor: regionAlertColor(regionAlert(code, levels, now)) } };
    }),
  };
}

/** Survol d'une région : nom, niveau, puis chaque pathologie (phase et semaine, ou « hors saison » daté). */
export function regionAlertTooltipHtml(name: string, code: string, levels: readonly RegionalAlertLevel[], now: number): string {
  const a = regionAlert(code, levels, now);
  const state = a.lines.length === 0 ? 'n.d.' : a.level === 'hors' ? 'hors saison' : levelLabel(a.level);
  const rows = PATHOLOGIES.map((p) => {
    const l = a.lines.find((x) => x.pathology === p);
    if (!l) return row(PATHOLOGY_LABEL[p], 'n.d.');
    const words = alertInSeason(l, now)
      ? `${dot(phaseLevel(l.phase))}${escapeHtml(`${phaseLabel(l.phase)} · ${weekShort(l.week)}`)}`
      : escapeHtml(`hors saison (dernière publication le ${parisDay(l.start)} : ${phaseLabel(l.phase)})`);
    return row(PATHOLOGY_LABEL[p], words);
  }).join('');
  return tip(head(name, `Alertes épidémiques · ${state}`) + rows);
}

// ─── Départements : urgences (§ 3.2) et APL (§ 3.3), une propriété de couleur par syndrome et par profession ───

function urgencesLevelOf(d: SyndromicDepartment | undefined, s: UrgencesSyndrome): HealthLevel {
  const v = d?.values[s];
  return v ? seasonalLevel(v.er, v.refEr) : 'nd';
}

/** Couleurs d'un département ; urgences en retard : aucune couleur de niveau (S2), l'APL annuelle n'est jamais en retard. */
function departmentProps(d: SyndromicDepartment | undefined, a: AplDepartment | undefined, apl: AplDataset | null, urgLate: boolean): Record<string, string> {
  const props: Record<string, string> = {};
  for (const s of urgLate ? [] : URGENCES_SYNDROMES) {
    const level = urgencesLevelOf(d, s);
    if (level !== 'nd') props[urgencesProp(s)] = levelHex(level);
  }
  for (const p of APL_PROFESSIONS) {
    const level = a && apl ? aplProfessionLevel(p, a.apl[p], apl.france.apl[p]) : null;
    if (level) props[aplProp(p)] = levelHex(level);
  }
  return props;
}

export function departmentHealthFeatures(
  base: GeoJSON.FeatureCollection, syndromic: SyndromicResponse | null, apl: AplDataset | null, now: number,
): GeoJSON.FeatureCollection {
  const urgLate = urgencesLate(syndromic, now);
  const synd = new Map((syndromic?.departments ?? []).map((d): [string, SyndromicDepartment] => [d.code, d]));
  const aplBy = new Map((apl?.departments ?? []).map((d): [string, AplDepartment] => [d.code, d]));
  return {
    type: 'FeatureCollection',
    features: base.features.map((f): GeoJSON.Feature => {
      const code = String(f.properties?.['code'] ?? '');
      return { ...f, properties: { ...(f.properties ?? {}), ...departmentProps(synd.get(code), aplBy.get(code), apl, urgLate) } };
    }),
  };
}

/** Décimales d'une part en % : jamais « 0,0 % » pour une part non nulle (trois au plus). */
function nonZeroDigits(v: number | null): number {
  return v !== null && v > 0 && v < 0.05 ? Math.min(3, Math.ceil(-Math.log10(2 * v))) : 1;
}

/** Position saisonnière en mots, avec le nombre réel de saisons de référence (vocabulaire de seasonalNote, panneau Urgences). */
function urgencesNote(r: SeasonalReading, late: boolean): string {
  if (late) return 'Niveau saisonnier suspendu : données en retard.';
  if (r.value === null) return 'Comparaison saisonnière n.d. : aucune valeur publiée cette semaine.';
  if (r.level === 'nd') return 'Comparaison saisonnière n.d. : moins de deux saisons de référence.';
  const n = r.refs.length;
  const same = `des ${n} saisons précédentes à la même semaine`;
  const max = Math.max(...r.refs);
  switch (r.level) {
    case 'rouge': return `Au moins 1,5 fois le maximum ${same}.`;
    case 'orange': return `Au moins 1,15 fois le maximum ${same}.`;
    case 'jaune': return max > 0 ? `Au-dessus du maximum ${same}, de moins de 15${NBSP}%.` : `Au-dessus ${same}, toutes à 0${NBSP}%.`;
    default: return r.value < Math.min(...r.refs) ? `Sous les ${n} saisons précédentes à la même semaine.` : `Dans la fourchette ${same}.`;
  }
}

/**
 * Survol d'un département (Urgences) : part aux urgences, part SOS Médecins, niveau saisonnier, semaine, référence.
 * Décimales du panneau (seasonalDigits : deux quand la valeur et une borne s'arrondissent pareil), jamais « 0,0 % » pour une
 * part non nulle ; libellé de la référence selon le nombre réel de saisons. En retard (S2) : valeurs gardées avec leur
 * semaine suivie de « (en retard) », niveau suspendu, aucune puce de couleur.
 */
export function urgencesTooltipHtml(name: string, code: string, syndromic: SyndromicResponse | null, syndrome: UrgencesSyndrome, now: number): string {
  const d = syndromic?.departments.find((x) => x.code === code);
  const v = d?.values[syndrome];
  const er = v?.er ?? null;
  const sos = v?.sos ?? null;
  const refs = (v?.refEr ?? []).filter((x) => Number.isFinite(x));
  const late = urgencesLate(syndromic, now);
  const r: SeasonalReading = { value: er, previous: null, refs, level: late ? 'nd' : urgencesLevelOf(d, syndrome) };
  const max = refs.length > 0 ? Math.max(...refs) : null;
  const digits = Math.max(seasonalDigits(r), nonZeroDigits(er), nonZeroDigits(max));
  const refLabel = refs.length === 1 ? 'Même semaine, saison précédente' : `Maximum des ${refs.length} saisons précédentes`;
  const week = syndromic?.week ? `${weekShort(syndromic.week.id)}${late ? ' (en retard)' : ''}` : 'n.d.';
  return tip(head(`${name} (${code})`, `${URGENCES_SYNDROME_LABEL[syndrome]} · ${week}`)
    + row('Urgences', er === null ? 'n.d.' : escapeHtml(`${formatPct(er, digits)} des passages`))
    + row('SOS Médecins', sos === null ? 'n.d.' : escapeHtml(`${formatPct(sos, nonZeroDigits(sos))} des actes`))
    + row('Niveau', r.level === 'nd' ? 'n.d.' : `${dot(r.level)}${escapeHtml(levelLabel(r.level))}`)
    + (max === null ? '' : row(refLabel, escapeHtml(formatPct(max, digits))))
    + note(urgencesNote(r, late)));
}

/** Survol d'un département (Accès aux soins) : APL de la profession choisie, France, rapport à la moyenne, niveau, millésime. */
export function aplTooltipHtml(name: string, code: string, apl: AplDataset | null, profession: AplProfession): string {
  const a = apl?.departments.find((x) => x.code === code);
  const value = a?.apl[profession] ?? null;
  const national = apl?.france.apl[profession] ?? null;
  const level = aplProfessionLevel(profession, value, national);
  const amount = (v: number | null): string => (v === null ? 'n.d.' : escapeHtml(`${frNumber(v, APL_DIGITS[profession])}${NBSP}${APL_UNIT[profession]}`));
  const ratio = profession !== 'mg' && value !== null && national !== null && national > 0
    ? row('Rapport à la moyenne nationale', escapeHtml(frNumber(value / national, 2))) : '';
  return tip(head(`${name} (${code})`, `${APL_PROFESSION_LABEL[profession]} · APL ${apl ? apl.vintage : 'n.d.'}`)
    + row('Département', amount(value))
    + row('France', amount(national))
    + ratio
    + row('Niveau', level ? `${dot(level)}${escapeHtml(levelLabel(level))}` : 'n.d.'));
}

// ─── Sites d'urgences (Hôpitaux, § 3.4) ───

/** Sites placés (coordonnées connues), les plus fréquentés d'abord : les petits disques sont dessinés par-dessus. */
export function hospitalFeatures(data: HospitalsDataset | null): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const sites = [...(data?.sites ?? [])].sort((a, b) => (b.passages ?? 0) - (a.passages ?? 0));
  return {
    type: 'FeatureCollection',
    features: sites.map((s): GeoJSON.Feature<GeoJSON.Point> => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: { finess: s.finess, category: s.category, passages: s.passages ?? 0 },
    })),
  };
}

export function hospitalAuthorizations(s: EmergencySite): string {
  const kinds = [s.general ? 'générales' : null, s.pediatric ? 'pédiatriques' : null].filter((k): k is string => k !== null);
  const parts = [kinds.length > 0 ? `urgences ${joinFr(kinds)}` : null, s.antenna ? 'antenne d’urgences' : null, s.seasonal ? 'ouverture saisonnière' : null]
    .filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(', ') : 'n.d.';
}

function place(s: EmergencySite): string {
  return `${s.commune} (${s.dept}) · ${HOSPITAL_CATEGORY_LABEL[s.category]}`;
}

function passagesLabel(vintage: number | null): string {
  return vintage === null ? 'Passages aux urgences' : `Passages aux urgences en ${vintage}`;
}

function count(n: number | null): string {
  return n === null ? 'n.d.' : escapeHtml(frNumber(n, 0));
}

/** Lits : null = aucune ligne déclarée dans le bordereau SAE (jamais un 0 inventé, plan partie A § 17). */
const NO_BEDS = 'aucun lit déclaré';

function bedTotal(n: number | null): string {
  return n === null ? NO_BEDS : escapeHtml(frNumber(n, 0));
}

function beds(n: number | null): string {
  return n === null ? NO_BEDS : escapeHtml(`${frNumber(n, 0)}${NBSP}lit${n > 1 ? 's' : ''}`);
}

export function hospitalTooltipHtml(s: EmergencySite, vintage: number | null): string {
  return tip(head(s.name, place(s)) + row(passagesLabel(vintage), count(s.passages)) + note('Clic : fiche du site.'));
}

/** Fiche d'un site (clic sur la carte ou dans le panneau) : catégorie, autorisations, passages, lits, réanimation, n° FINESS. */
export function hospitalPopupHtml(s: EmergencySite, vintage: number | null): string {
  return tip(head(s.name, place(s))
    + row('Autorisations', escapeHtml(hospitalAuthorizations(s)))
    + row(passagesLabel(vintage), count(s.passages))
    + row('Lits de médecine, chirurgie, obstétrique', bedTotal(s.bedsMco))
    + row('Réanimation', beds(s.bedsIcu))
    + row('Soins intensifs', beds(s.bedsIntensive))
    + row('Unité d’hospitalisation de courte durée', beds(s.bedsUhcd))
    + row('N° FINESS', escapeHtml(s.finess)));
}

// ─── Aiguillage du survol ───

export interface HealthMapData {
  alerts: readonly RegionalAlertLevel[];
  /** Instant de la dernière relève : règle « en saison » des alertes et retard des urgences (S2). */
  now: number;
  syndromic: SyndromicResponse | null;
  apl: AplDataset | null;
  hospitals: ReadonlyMap<string, EmergencySite>;
  hospitalsVintage: number | null;
  syndrome: UrgencesSyndrome;
  profession: AplProfession;
}

/** Ordre de dessin des couches santé, du bas vers le haut (moveLayer à l'initialisation de la carte). */
export const HEALTH_LAYER_ORDER: readonly string[] = [
  LYR_HEALTH_ALERT_FILL, LYR_HEALTH_ALERT_LINE, LYR_HEALTH_URG_FILL, LYR_HEALTH_URG_LINE,
  LYR_HEALTH_APL_FILL, LYR_HEALTH_APL_LINE, LYR_HOSPITALS,
];
const HOVERABLE: ReadonlySet<string> = new Set([LYR_HOSPITALS, LYR_HEALTH_APL_FILL, LYR_HEALTH_URG_FILL, LYR_HEALTH_ALERT_FILL]);

/**
 * Couches santé sous la souris, dans l'ordre inverse du dessin : celle qu'on voit au-dessus répond (un site, l'APL dessinée
 * au-dessus des urgences, une région).
 */
export const HEALTH_HOVER_LAYERS: readonly string[] = [...HEALTH_LAYER_ORDER].reverse().filter((id) => HOVERABLE.has(id));

/** Objet survolé qui répond : celui de la couche dessinée le plus haut parmi HEALTH_HOVER_LAYERS. */
export function topHealthHit<T extends { layer: { id: string } }>(hits: readonly T[]): T | undefined {
  for (const id of HEALTH_HOVER_LAYERS) {
    const hit = hits.find((f) => f.layer.id === id);
    if (hit) return hit;
  }
  return undefined;
}

export function healthTooltipHtml(layerId: string, props: Readonly<Record<string, unknown>>, d: HealthMapData): string | null {
  const code = String(props['code'] ?? '');
  const name = typeof props['nom'] === 'string' ? props['nom'] : departementName(code);
  switch (layerId) {
    case LYR_HOSPITALS: {
      const site = d.hospitals.get(String(props['finess'] ?? ''));
      return site ? hospitalTooltipHtml(site, d.hospitalsVintage) : null;
    }
    case LYR_HEALTH_URG_FILL: return urgencesTooltipHtml(name, code, d.syndromic, d.syndrome, d.now);
    case LYR_HEALTH_APL_FILL: return aplTooltipHtml(name, code, d.apl, d.profession);
    case LYR_HEALTH_ALERT_FILL: return regionAlertTooltipHtml(name, code, d.alerts, d.now);
    default: return null;
  }
}
