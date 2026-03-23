/**
 * oil-infrastructure.ts - Points d'infrastructure pétrolière critique en France.
 * Raffineries, grands dépôts, pipelines principaux.
 * Coordonnées [lng, lat].
 */

import type { OilRefinery, OilDepot, OilPipeline } from '../types/index';

// ═══ Raffineries Françaises ═══
// 6 raffineries actives en France métropolitaine (+ SARA aux Antilles)

export const OIL_REFINERIES: OilRefinery[] = [
  {
    id: 'ref-gonfreville',
    name: 'Gonfreville-l\'Orcher',
    operator: 'TotalEnergies',
    capacityMtPerYear: 12.0,
    location: [0.2200, 49.4800],
    status: 'active',
    region: 'Normandie',
  },
  {
    id: 'ref-port-jerome',
    name: 'Port-Jérôme-Gravenchon',
    operator: 'Esso / ExxonMobil',
    capacityMtPerYear: 12.0,
    location: [0.5600, 49.4900],
    status: 'active',
    region: 'Normandie',
  },
  {
    id: 'ref-donges',
    name: 'Donges',
    operator: 'TotalEnergies',
    capacityMtPerYear: 11.0,
    location: [-2.0800, 47.3000],
    status: 'active',
    region: 'Pays de la Loire',
  },
  {
    id: 'ref-lavera',
    name: 'Lavéra',
    operator: 'Petroineos',
    capacityMtPerYear: 9.9,
    location: [4.9850, 43.3950],
    status: 'active',
    region: 'Provence-Alpes-Côte d\'Azur',
  },
  {
    id: 'ref-fos',
    name: 'Fos-sur-Mer',
    operator: 'Rhône Energies (ex-TotalEnergies)',
    capacityMtPerYear: 6.6,
    location: [4.9400, 43.4300],
    status: 'active',
    region: 'Provence-Alpes-Côte d\'Azur',
  },
  {
    id: 'ref-feyzin',
    name: 'Feyzin',
    operator: 'TotalEnergies',
    capacityMtPerYear: 5.6,
    location: [4.8600, 45.6700],
    status: 'active',
    region: 'Auvergne-Rhône-Alpes',
  },
];

// ═══ Grands Dépôts et Terminaux Pétroliers ═══

export const OIL_DEPOTS: OilDepot[] = [
  // Terminaux portuaires majeurs
  {
    id: 'depot-antifer',
    name: 'Terminal d\'Antifer',
    role: 'terminal',
    location: [-0.1500, 49.6700],
    capacityM3: 2_000_000,
    operator: 'Port du Havre',
  },
  {
    id: 'depot-le-havre',
    name: 'CIM Le Havre',
    role: 'terminal',
    location: [0.1200, 49.4800],
    capacityM3: 1_500_000,
    operator: 'CIM',
  },
  {
    id: 'depot-fos',
    name: 'Dépôt Fos-sur-Mer',
    role: 'terminal',
    location: [4.8900, 43.4200],
    capacityM3: 3_000_000,
    operator: 'Raffineries',
  },
  {
    id: 'depot-dunkerque',
    name: 'Terminal Dunkerque',
    role: 'terminal',
    location: [2.3700, 51.0500],
    capacityM3: 800_000,
    operator: 'Nord Pétrole',
  },
  {
    id: 'depot-nantes',
    name: 'Donges-Nantes',
    role: 'terminal',
    location: [-2.0700, 47.3100],
    capacityM3: 1_200_000,
    operator: 'TotalEnergies',
  },
  // Grands dépôts de distribution
  {
    id: 'depot-grandpuits',
    name: 'Grandpuits',
    role: 'distribution',
    location: [2.9800, 48.5900],
    capacityM3: 600_000,
    operator: 'TotalEnergies',
  },
  {
    id: 'depot-gennevilliers',
    name: 'Gennevilliers',
    role: 'distribution',
    location: [2.2800, 48.9300],
    capacityM3: 450_000,
    operator: 'DPF',
  },
  {
    id: 'depot-lyon-feyzin',
    name: 'Dépôt Lyon-Feyzin',
    role: 'distribution',
    location: [4.8650, 45.6800],
    capacityM3: 500_000,
    operator: 'DPL',
  },
  {
    id: 'depot-strasbourg',
    name: 'Strasbourg',
    role: 'distribution',
    location: [7.7700, 48.5800],
    capacityM3: 350_000,
    operator: 'SFDM',
  },
  {
    id: 'depot-metz',
    name: 'Metz-Frescaty',
    role: 'distribution',
    location: [6.1300, 49.0800],
    capacityM3: 300_000,
    operator: 'SFDM',
  },
  // Dépôts stratégiques (SAGESS)
  {
    id: 'depot-frontignan',
    name: 'Frontignan (SAGESS)',
    role: 'strategic',
    location: [3.7500, 43.4500],
    capacityM3: 800_000,
    operator: 'SAGESS',
  },
  {
    id: 'depot-manosque',
    name: 'Manosque (cavernes)',
    role: 'strategic',
    location: [5.7900, 43.8300],
    capacityM3: 1_200_000,
    operator: 'Géosel',
  },
];

// ═══ Pipelines Principaux ═══
// Définitions des pipelines - les tracés GeoJSON sont chargés séparément

export const OIL_PIPELINES: OilPipeline[] = [
  {
    id: 'pipeline-pse',
    name: 'Pipeline Sud-Européen (PSE)',
    operator: 'SPSE',
    kind: 'crude',
    description: 'Marseille/Fos → vallée du Rhône → Karlsruhe (Allemagne)',
  },
  {
    id: 'pipeline-dmm',
    name: 'Donges-Melun-Metz (DMM)',
    operator: 'SFDM',
    kind: 'products',
    description: 'Donges → Melun → Metz, produits raffinés',
  },
  {
    id: 'pipeline-plif',
    name: 'Pipeline d\'Île-de-France (PLIF)',
    operator: 'TRAPIL',
    kind: 'products',
    description: 'Le Havre → Grandpuits, dessert l\'Île-de-France',
  },
  {
    id: 'pipeline-lhp',
    name: 'Le Havre-Paris (LHP)',
    operator: 'TRAPIL',
    kind: 'products',
    description: 'Le Havre → Paris, produits raffinés',
  },
  {
    id: 'pipeline-odcf',
    name: 'Oléoduc de Défense Commune (ODCF/CEPS)',
    operator: 'OTAN / DGA',
    kind: 'products',
    description: 'Réseau OTAN Centre-Europe, partie française',
  },
  {
    id: 'pipeline-antifer-cim',
    name: 'Antifer-CIM-Raffineries',
    operator: 'Port du Havre',
    kind: 'crude',
    description: 'Terminal Antifer → CIM → raffineries Basse-Seine',
  },
  {
    id: 'pipeline-fos-feyzin',
    name: 'Fos-Feyzin',
    operator: 'SPMR',
    kind: 'crude',
    description: 'Fos-sur-Mer → Lyon/Feyzin',
  },
];

// ═══ Centroïde France (pour les arcs d'import/export) ═══
export const FRANCE_OIL_CENTER: [number, number] = [2.5, 46.5];

// ═══ Points d'import pétrolier (flux maritimes) ═══
export const OIL_IMPORT_ORIGINS = [
  { id: 'import-mer-nord', name: 'Mer du Nord', coordinates: [2.0, 56.0] as [number, number] },
  { id: 'import-russie', name: 'Russie (historique)', coordinates: [40.0, 60.0] as [number, number] },
  { id: 'import-moyen-orient', name: 'Moyen-Orient', coordinates: [50.0, 25.0] as [number, number] },
  { id: 'import-afrique', name: 'Afrique', coordinates: [-5.0, 5.0] as [number, number] },
  { id: 'import-usa', name: 'États-Unis', coordinates: [-90.0, 30.0] as [number, number] },
];

// ═══ Couleurs par statut ═══
export const OIL_STATUS_COLORS = {
  normal: '#22c55e',    // Green-500
  tense: '#f59e0b',     // Amber-500
  critical: '#ef4444',  // Red-500
  unknown: '#6b7280',   // Gray-500
} as const;

// ═══ Couleurs par type de pipeline ═══
export const OIL_PIPELINE_COLORS = {
  crude: '#78350f',     // Amber-900 (pétrole brut - foncé)
  products: '#a16207',  // Amber-700 (produits raffinés - plus clair)
} as const;

// ═══ Seuils de vigilance (jours de stock) ═══
export const OIL_VIGILANCE_THRESHOLDS = {
  critical: 30,   // < 30 jours = critique (rouge)
  tense: 60,      // 30-60 jours = sous tension (orange)
  // > 60 jours = normal (vert)
} as const;
