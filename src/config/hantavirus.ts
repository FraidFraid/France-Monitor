// src/config/hantavirus.ts : zones d'endémie historiques du hantavirus (Santé publique France, cas 2005 à 2024), affichées
// par la couche Veille sanitaire (spec 2026-10-03 § 2.9) ; l'épisode 2026 se suit par le message OMS DON611.
import { REGIONS } from './geo.ts';

export interface HantavirusZoneDefinition {
  code: string;
  name: string;
  center: [number, number];
  risk: 'historic' | 'extended';
}

export const HANTAVIRUS_HISTORICAL_REFERENCE = {
  sourceUrl: 'https://www.santepubliquefrance.fr/hantavirus/donnees',
  circulationPeriodStart: '2005-01-01',
  circulationPeriodEnd: '2024-12-31',
  latestCaseDataYear: 2024,
} as const;

export const HANTAVIRUS_HISTORICAL_DEPARTMENTS: Record<string, HantavirusZoneDefinition> = {
  'DEP-08': { code: 'DEP-08', name: 'Ardennes', center: [4.72, 49.77], risk: 'historic' },
  'DEP-10': { code: 'DEP-10', name: 'Aube', center: [4.08, 48.3], risk: 'extended' },
  'DEP-21': { code: 'DEP-21', name: 'Côte-d’Or', center: [5.04, 47.32], risk: 'extended' },
  'DEP-25': { code: 'DEP-25', name: 'Doubs', center: [6.02, 47.24], risk: 'extended' },
  'DEP-39': { code: 'DEP-39', name: 'Jura', center: [5.55, 46.67], risk: 'historic' },
  'DEP-51': { code: 'DEP-51', name: 'Marne', center: [4.03, 49.04], risk: 'extended' },
  'DEP-52': { code: 'DEP-52', name: 'Haute-Marne', center: [5.14, 48.11], risk: 'extended' },
  'DEP-54': { code: 'DEP-54', name: 'Meurthe-et-Moselle', center: [6.18, 48.69], risk: 'historic' },
  'DEP-55': { code: 'DEP-55', name: 'Meuse', center: [5.38, 49.16], risk: 'historic' },
  'DEP-57': { code: 'DEP-57', name: 'Moselle', center: [6.18, 49.12], risk: 'historic' },
  'DEP-67': { code: 'DEP-67', name: 'Bas-Rhin', center: [7.75, 48.57], risk: 'historic' },
  'DEP-68': { code: 'DEP-68', name: 'Haut-Rhin', center: [7.34, 47.75], risk: 'historic' },
  'DEP-69': { code: 'DEP-69', name: 'Rhône', center: [4.84, 45.76], risk: 'extended' },
  'DEP-70': { code: 'DEP-70', name: 'Haute-Saône', center: [6.15, 47.62], risk: 'historic' },
  'DEP-88': { code: 'DEP-88', name: 'Vosges', center: [6.45, 48.18], risk: 'historic' },
  'DEP-90': { code: 'DEP-90', name: 'Territoire de Belfort', center: [6.87, 47.64], risk: 'extended' },
};

export const HANTAVIRUS_HISTORICAL_REGIONS: Record<string, HantavirusZoneDefinition> = {
  'REG-44': { code: 'REG-44', name: REGIONS['44'].name, center: REGIONS['44'].center, risk: 'historic' as const },
  'REG-27': { code: 'REG-27', name: REGIONS['27'].name, center: REGIONS['27'].center, risk: 'historic' as const },
  'REG-84': { code: 'REG-84', name: REGIONS['84'].name, center: REGIONS['84'].center, risk: 'extended' as const },
};
