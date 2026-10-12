// src/services/themes.ts — thèmes de la barre de thèmes (refonte UI, spec §5.3 et §7.3). Les six
// thèmes reprennent les six vues de src/config/layer-presets.ts (mêmes identifiants) ; ce module
// dit à quel thème appartient chaque élément de la liste « À traiter ». Pur, sans DOM.

import type { SituationType } from '../types/index.ts';
import type { LayerPresetId } from '../config/layer-presets.ts';

export type ThemeId = LayerPresetId;
export type SpecificThemeId = Exclude<ThemeId, 'general'>;
type Lang = 'fr' | 'en';

interface ThemeDef {
  id: ThemeId;
  fr: string;
  en: string;
  /** Complément de « tirée par … ». */
  driverFr: string;
  driverEn: string;
}

export const THEMES: ReadonlyArray<ThemeDef> = [
  { id: 'general', fr: 'Vue générale', en: 'Overview', driverFr: 'l’ensemble', driverEn: 'overall' },
  { id: 'energy', fr: 'Énergie', en: 'Energy', driverFr: 'l’énergie', driverEn: 'energy' },
  { id: 'security', fr: 'Sécurité et défense', en: 'Security and defence', driverFr: 'la sécurité et la défense', driverEn: 'security and defence' },
  { id: 'health', fr: 'Santé', en: 'Health', driverFr: 'la santé', driverEn: 'health' },
  { id: 'environment', fr: 'Environnement', en: 'Environment', driverFr: 'l’environnement', driverEn: 'environment' },
  { id: 'transport', fr: 'Transports', en: 'Transport', driverFr: 'les transports', driverEn: 'transport' },
];

/** Thèmes proprement dits : « Vue générale » les montre tous. */
export const SPECIFIC_THEMES: ReadonlyArray<SpecificThemeId> = ['energy', 'security', 'health', 'environment', 'transport'];

function def(id: ThemeId): ThemeDef {
  return THEMES.find((th) => th.id === id) ?? THEMES[0];
}

export function themeLabel(id: ThemeId, lang: Lang = 'fr'): string {
  const d = def(id);
  return lang === 'fr' ? d.fr : d.en;
}

/** « tirée par l’énergie et la santé » ; « sans pression dominante » quand aucun thème ne tire. */
export function drivenByText(themes: readonly ThemeId[], lang: Lang = 'fr'): string {
  if (themes.length === 0) return lang === 'fr' ? 'sans pression dominante' : 'no dominant pressure';
  const parts = themes.map((id) => (lang === 'fr' ? def(id).driverFr : def(id).driverEn));
  return lang === 'fr' ? `tirée par ${parts.join(' et ')}` : `driven by ${parts.join(' and ')}`;
}

/** Catégorie d’article ou d’événement → thème (tableau §7.3) ; finance, general et l’inconnu → Vue générale. */
export function categoryTheme(category: string): ThemeId {
  switch (category) {
    case 'energy':
      return 'energy';
    case 'security':
    case 'cyber':
    case 'social':
      return 'security';
    case 'health':
      return 'health';
    case 'weather':
    case 'floods':
    case 'fires':
    case 'infrastructure':
      return 'environment';
    case 'transport':
      return 'transport';
    default:
      return 'general';
  }
}

const SITUATION_THEME: Record<SituationType, ThemeId> = {
  ENERGY_STRESS: 'energy',
  IMPORT_DEPENDENCY_RISK: 'energy',
  FUEL_SUPPLY_RISK: 'energy',
  CYBER_PRESSURE: 'security',
  SOCIAL_ESCALATION: 'security',
  MARITIME_ANOMALY: 'security',
  DEFENSE_SIGNAL_ELEVATED: 'security',
  MILITARY_SURGE_ALERT: 'security',
  AIS_ANOMALY_ALERT: 'security',
  DEFENSE_ALERT: 'security',
  GPS_JAMMING_ALERT: 'security',
  FLOOD_CRISIS: 'environment',
  WILDFIRE_ESCALATION: 'environment',
  WEATHER_ALERT: 'environment',
  SEISMIC_EVENT: 'environment',
  AIR_POLLUTION_EPISODE: 'environment',
  // Pannes télécoms : même thème que leurs couches dans les vues (décision du 12/10/2026, revient sur l'arbitrage A9).
  TELECOM_DISRUPTION: 'security',
  NEWS_ALERT: 'general',
};

/** Thème d’une situation du moteur ou d’une alerte ; une alerte presse suit la catégorie de son article. */
export function situationTheme(type: SituationType, category?: string): ThemeId {
  if (type === 'NEWS_ALERT' && category !== undefined) return categoryTheme(category);
  return SITUATION_THEME[type];
}

/** « Vue générale » montre tout ; un thème ne montre que ses éléments. */
export function inTheme(itemTheme: ThemeId, selected: ThemeId): boolean {
  return selected === 'general' || itemTheme === selected;
}
