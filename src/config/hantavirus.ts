import { REGIONS } from './geo.ts';

export interface HantavirusZoneDefinition {
  code: string;
  name: string;
  center: [number, number];
  risk: 'historic' | 'extended';
}

export interface HantavirusFacilityDefinition {
  code: string;
  label: string;
  center: [number, number];
}

export interface HantavirusNavireDefinition {
  code: string;
  label: string;
  center: [number, number];
}

export const HANTAVIRUS_HISTORICAL_REFERENCE = {
  sourceUrl: 'https://www.santepubliquefrance.fr/hantavirus/donnees',
  circulationPeriodStart: '2005-01-01',
  circulationPeriodEnd: '2023-12-31',
  latestCaseDataYear: 2024,
} as const;

export const HANTAVIRUS_HISTORICAL_DEPARTMENTS: Record<string, HantavirusZoneDefinition> = {
  'DEP-08': { code: 'DEP-08', name: 'Ardennes', center: [4.72, 49.77], risk: 'historic' },
  'DEP-10': { code: 'DEP-10', name: 'Aube', center: [4.08, 48.3], risk: 'extended' },
  'DEP-21': { code: 'DEP-21', name: "Cote-d'Or", center: [5.04, 47.32], risk: 'extended' },
  'DEP-25': { code: 'DEP-25', name: 'Doubs', center: [6.02, 47.24], risk: 'extended' },
  'DEP-39': { code: 'DEP-39', name: 'Jura', center: [5.55, 46.67], risk: 'historic' },
  'DEP-51': { code: 'DEP-51', name: 'Marne', center: [4.03, 49.04], risk: 'extended' },
  'DEP-52': { code: 'DEP-52', name: 'Haute-Marne', center: [5.14, 48.11], risk: 'extended' },
  'DEP-54': { code: 'DEP-54', name: 'Meurthe-et-Moselle', center: [6.18, 48.69], risk: 'historic' },
  'DEP-55': { code: 'DEP-55', name: 'Meuse', center: [5.38, 49.16], risk: 'historic' },
  'DEP-57': { code: 'DEP-57', name: 'Moselle', center: [6.18, 49.12], risk: 'historic' },
  'DEP-67': { code: 'DEP-67', name: 'Bas-Rhin', center: [7.75, 48.57], risk: 'historic' },
  'DEP-68': { code: 'DEP-68', name: 'Haut-Rhin', center: [7.34, 47.75], risk: 'historic' },
  'DEP-69': { code: 'DEP-69', name: 'Rhone', center: [4.84, 45.76], risk: 'extended' },
  'DEP-70': { code: 'DEP-70', name: 'Haute-Saone', center: [6.15, 47.62], risk: 'historic' },
  'DEP-88': { code: 'DEP-88', name: 'Vosges', center: [6.45, 48.18], risk: 'historic' },
  'DEP-90': { code: 'DEP-90', name: 'Territoire de Belfort', center: [6.87, 47.64], risk: 'extended' },
};

export const HANTAVIRUS_HISTORICAL_REGIONS: Record<string, HantavirusZoneDefinition> = {
  'REG-44': { code: 'REG-44', name: REGIONS['44'].name, center: REGIONS['44'].center, risk: 'historic' as const },
  'REG-27': { code: 'REG-27', name: REGIONS['27'].name, center: REGIONS['27'].center, risk: 'historic' as const },
  'REG-84': { code: 'REG-84', name: REGIONS['84'].name, center: REGIONS['84'].center, risk: 'extended' as const },
};

export const HANTAVIRUS_REFERENCE_FACILITIES: Record<string, HantavirusFacilityDefinition> = {
  'HOP-BICHAT': {
    code: 'HOP-BICHAT',
    label: 'Hopital Bichat-Claude-Bernard',
    center: [2.3317, 48.8984],
  },
  'HOP-PITIE-SALPETRIERE': {
    code: 'HOP-PITIE-SALPETRIERE',
    label: 'Hopital Pitie-Salpetriere',
    center: [2.365, 48.838],
  },
  'HOP-LA-CROIX-ROUSSE': {
    code: 'HOP-LA-CROIX-ROUSSE',
    label: 'Hopital de la Croix-Rousse',
    center: [4.8316, 45.7797],
  },
  'HOP-IHU-MARSEILLE': {
    code: 'HOP-IHU-MARSEILLE',
    label: 'IHU Mediterranee Infection - Marseille',
    center: [5.3938, 43.2895],
  },
};

export const HANTAVIRUS_NAVIRES: Record<string, HantavirusNavireDefinition> = {
  'SHIP-MV-HONDIUS': {
    code: 'SHIP-MV-HONDIUS',
    label: 'MV Hondius',
    center: [-23.5, 16.9],
  },
};

export function resolveHantavirusTerritoryCenter(code: string): [number, number] | null {
  if (code in HANTAVIRUS_HISTORICAL_DEPARTMENTS) {
    return HANTAVIRUS_HISTORICAL_DEPARTMENTS[code].center;
  }
  if (code in HANTAVIRUS_HISTORICAL_REGIONS) {
    return HANTAVIRUS_HISTORICAL_REGIONS[code].center;
  }
  if (code.startsWith('REG-')) {
    const regionCode = code.slice(4);
    if (regionCode in REGIONS) return REGIONS[regionCode].center;
  }
  if (code in HANTAVIRUS_REFERENCE_FACILITIES) {
    return HANTAVIRUS_REFERENCE_FACILITIES[code].center;
  }
  if (code in HANTAVIRUS_NAVIRES) {
    return HANTAVIRUS_NAVIRES[code].center;
  }
  if (code === 'FR') {
    return [2.2, 46.6];
  }
  if (code === 'GF') {
    return [-53.1, 3.9];
  }
  return null;
}
