// src/components/deckgl/health-map.ts : couches santé de la carte (spec 2026-10-03 § 3.1 à 3.4), parties pures.
// Régions colorées par les alertes Odissé en saison, départements par le niveau saisonnier des urgences ou par l'APL,
// marqueurs des zones d'endémie historiques du hantavirus, sites d'urgences ; infobulles et fiche de site.
// MapLibre ne lit pas les variables CSS : niveaux en levelHex (palette L1), catégories d'hôpitaux copiées des jetons
// --cat-hosp-* de main.css (vérifié par test). Aucun import de vue : la carte ne charge pas les panneaux.
import type { ExpressionSpecification } from 'maplibre-gl';
import type {
  AplDataset, AplDepartment, AplProfession, EmergencySite, HospitalCategory, HospitalsDataset, RegionalAlertLevel,
  SyndromicDepartment, SyndromicResponse,
} from '../../types/index.ts';
import { alertInSeason, epiWeekLabel, isHealthDataLate, phaseLabel, phaseLevel, seasonalLevel, type HealthLevel } from '../../services/health-levels.ts';
import { LEVEL_RANK, levelColorVar, levelHex, levelLabel, type VigilanceLevel } from '../../services/vigilance.ts';
import { HANTAVIRUS_HISTORICAL_DEPARTMENTS, HANTAVIRUS_HISTORICAL_REFERENCE } from '../../config/hantavirus.ts';
import { NBSP, formatPct, frNumber } from '../layer-panel/format.ts';
import {
  APL_DIGITS, APL_PROFESSIONS, APL_PROFESSION_LABEL, APL_UNIT, HOSPITAL_CATEGORY_LABEL, URGENCES_SYNDROMES, URGENCES_SYNDROME_LABEL,
  aplProfessionLevel, capitalize, departementName, joinFr, parisDay, weekShort, type UrgencesSyndrome,
} from '../layer-panel/health-format.ts';
import type { LegendCategory } from '../MapLegend.ts';
import { LYR_HEALTH_ALERT_FILL, LYR_HEALTH_APL_FILL, LYR_HEALTH_HANTAVIRUS, LYR_HEALTH_URG_FILL, LYR_HOSPITALS } from './constants.ts';
import { escapeHtml } from './format-utils.ts';

/** Hors saison (régions) : gris clair, distinct du vert « pas d'alerte » (spec § 3.1). */
export const HEALTH_OFF_SEASON_HEX = '#c7c7cc';
/** Anneau des zones d'endémie historiques du hantavirus (repère, pas un niveau). */
export const HANTAVIRUS_RING_HEX = '#f2f2f7';
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

/**
 * S2 : urgences en retard quand la fin de la dernière semaine publiée + 17 jours est dépassée (même règle que le panneau) ;
 * sans semaine publiée, rien à dater.
 */
export function urgencesLate(syndromic: SyndromicResponse | null, now: number): boolean {
  const week = syndromic?.week;
  return week ? isHealthDataLate('syndromic', week.end, now) : false;
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

const LEVEL_WORDS: Readonly<Record<HealthLevel, string>> = {
  vert: 'au plus le maximum des 3 saisons précédentes',
  jaune: `au-dessus de ce maximum, de moins de 15${NBSP}%`,
  orange: `de 15 à 50${NBSP}% au-dessus de ce maximum`,
  rouge: `plus de 50${NBSP}% au-dessus de ce maximum`,
  nd: 'moins de deux saisons de référence',
};

/**
 * Survol d'un département (Urgences) : part aux urgences, part SOS Médecins, niveau saisonnier, semaine.
 * En retard (S2) : valeurs gardées avec leur semaine suivie de « (en retard) », niveau suspendu, aucune puce de couleur.
 */
export function urgencesTooltipHtml(name: string, code: string, syndromic: SyndromicResponse | null, syndrome: UrgencesSyndrome, now: number): string {
  const d = syndromic?.departments.find((x) => x.code === code);
  const v = d?.values[syndrome];
  const er = v?.er ?? null;
  const sos = v?.sos ?? null;
  const late = urgencesLate(syndromic, now);
  const level: HealthLevel = late ? 'nd' : urgencesLevelOf(d, syndrome);
  const max = v && v.refEr.length > 0 ? Math.max(...v.refEr) : null;
  const week = syndromic?.week ? `${weekShort(syndromic.week.id)}${late ? ' (en retard)' : ''}` : 'n.d.';
  return tip(head(`${name} (${code})`, `${URGENCES_SYNDROME_LABEL[syndrome]} · ${week}`)
    + row('Urgences', er === null ? 'n.d.' : escapeHtml(`${formatPct(er, 1)} des passages`))
    + row('SOS Médecins', sos === null ? 'n.d.' : escapeHtml(`${formatPct(sos, 1)} des actes`))
    + row('Niveau', level === 'nd' ? 'n.d.' : `${dot(level)}${escapeHtml(levelLabel(level))}`)
    + (max === null ? '' : row('Maximum des 3 saisons précédentes', escapeHtml(formatPct(max, 1))))
    + note(late ? 'Niveau saisonnier suspendu : données en retard.' : `${capitalize(LEVEL_WORDS[level])}.`));
}

/**
 * Légende Urgences datée (S1) : semaine épidémiologique et date de publication ; en retard (S2), « (en retard) » et
 * couleurs de niveau retirées de la carte. Sans semaine publiée : la légende de base.
 */
export function urgencesLegend(base: LegendCategory, syndromic: SyndromicResponse | null, now: number): LegendCategory {
  const week = syndromic?.week;
  if (!syndromic || !week) return base;
  const published = syndromic.publishedAt ? `, publiées le ${parisDay(syndromic.publishedAt)}` : '';
  const period = `Données : ${epiWeekLabel(week)}${published}`;
  const line = urgencesLate(syndromic, now) ? `${period} (en retard) : couleurs de niveau retirées.` : `${period}.`;
  return { ...base, notes: [line, ...(base.notes ?? [])] };
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

// ─── Zones d'endémie historiques du hantavirus (§ 2.9 : le jeu « seed » part, les zones restent) ───

export function hantavirusFeatures(): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: Object.values(HANTAVIRUS_HISTORICAL_DEPARTMENTS).map((z): GeoJSON.Feature<GeoJSON.Point> => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [z.center[0], z.center[1]] },
      properties: { code: z.code, name: z.name, risk: z.risk },
    })),
  };
}

export function hantavirusTooltipHtml(props: Readonly<Record<string, unknown>>): string {
  const name = typeof props['name'] === 'string' ? props['name'] : 'n.d.';
  const from = HANTAVIRUS_HISTORICAL_REFERENCE.circulationPeriodStart.slice(0, 4);
  const to = HANTAVIRUS_HISTORICAL_REFERENCE.circulationPeriodEnd.slice(0, 4);
  const kind = props['risk'] === 'extended' ? 'Zone d’endémie historique du hantavirus (extension)' : 'Zone d’endémie historique du hantavirus';
  return tip(head(name, kind) + note(`Cas recensés de ${from} à ${to} (Santé publique France). Repère historique, sans lien avec un épisode en cours.`));
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

/** Couches santé sous la souris, de la plus précise à la plus large : un site, un marqueur, un département, une région. */
export const HEALTH_HOVER_LAYERS: readonly string[] = [LYR_HOSPITALS, LYR_HEALTH_HANTAVIRUS, LYR_HEALTH_URG_FILL, LYR_HEALTH_APL_FILL, LYR_HEALTH_ALERT_FILL];

export function healthTooltipHtml(layerId: string, props: Readonly<Record<string, unknown>>, d: HealthMapData): string | null {
  const code = String(props['code'] ?? '');
  const name = typeof props['nom'] === 'string' ? props['nom'] : departementName(code);
  switch (layerId) {
    case LYR_HOSPITALS: {
      const site = d.hospitals.get(String(props['finess'] ?? ''));
      return site ? hospitalTooltipHtml(site, d.hospitalsVintage) : null;
    }
    case LYR_HEALTH_HANTAVIRUS: return hantavirusTooltipHtml(props);
    case LYR_HEALTH_URG_FILL: return urgencesTooltipHtml(name, code, d.syndromic, d.syndrome, d.now);
    case LYR_HEALTH_APL_FILL: return aplTooltipHtml(name, code, d.apl, d.profession);
    case LYR_HEALTH_ALERT_FILL: return regionAlertTooltipHtml(name, code, d.alerts, d.now);
    default: return null;
  }
}
