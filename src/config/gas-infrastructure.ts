/**
 * gas-infrastructure.ts - Points d'infrastructure gaz critique en France.
 * Terminaux méthaniers, stockages souterrains, points d'interconnexion (PIR).
 * Coordonnées [lng, lat].
 */

import type { GasTerminal, GasStorage, GasInterconnection } from '../types/index';

// ═══ Terminaux Méthaniers (LNG) ═══
// 4 terminaux actifs en France métropolitaine

export const GAS_TERMINALS: GasTerminal[] = [
  {
    id: 'lng-fos-tonkin',
    name: 'Fos Tonkin',
    type: 'lng-terminal',
    coordinates: [4.9230, 43.4050],
    operator: 'Elengy',
    capacityGWh: 55,
    status: 'active',
  },
  {
    id: 'lng-fos-cavaou',
    name: 'Fos Cavaou',
    type: 'lng-terminal',
    coordinates: [4.8800, 43.4100],
    operator: 'Elengy',
    capacityGWh: 85,
    status: 'active',
  },
  {
    id: 'lng-montoir',
    name: 'Montoir-de-Bretagne',
    type: 'lng-terminal',
    coordinates: [-2.1500, 47.3100],
    operator: 'Elengy',
    capacityGWh: 100,
    status: 'active',
  },
  {
    id: 'lng-dunkerque',
    name: 'Dunkerque LNG',
    type: 'lng-terminal',
    coordinates: [2.2000, 51.0300],
    operator: 'Dunkerque LNG',
    capacityGWh: 130,
    status: 'active',
  },
];

// ═══ Stockages Souterrains ═══
// 14 sites de stockage (Storengy, Terega, Geomethane)

export const GAS_STORAGES: GasStorage[] = [
  // Storengy sites
  {
    id: 'sto-chemery',
    name: 'Chémery',
    type: 'underground-storage',
    coordinates: [1.4200, 47.3500],
    operator: 'Storengy',
    capacityTWh: 7.0,
    fillLevel: 65,
    fillTrend: 'stable',
    status: 'active',
  },
  {
    id: 'sto-cerville',
    name: 'Cerville-Velaine',
    type: 'underground-storage',
    coordinates: [6.2800, 48.6200],
    operator: 'Storengy',
    capacityTWh: 2.5,
    fillLevel: 70,
    fillTrend: 'stable',
    status: 'active',
  },
  {
    id: 'sto-germigny',
    name: 'Germigny-sous-Coulombs',
    type: 'underground-storage',
    coordinates: [3.1300, 49.0800],
    operator: 'Storengy',
    capacityTWh: 3.8,
    fillLevel: 60,
    fillTrend: 'stable',
    status: 'active',
  },
  {
    id: 'sto-gournay',
    name: 'Gournay-sur-Aronde',
    type: 'underground-storage',
    coordinates: [2.8500, 49.5200],
    operator: 'Storengy',
    capacityTWh: 3.5,
    fillLevel: 55,
    fillTrend: 'stable',
    status: 'active',
  },
  {
    id: 'sto-saint-illiers',
    name: 'Saint-Illiers-la-Ville',
    type: 'underground-storage',
    coordinates: [1.4800, 48.8500],
    operator: 'Storengy',
    capacityTWh: 2.0,
    fillLevel: 68,
    fillTrend: 'stable',
    status: 'active',
  },
  {
    id: 'sto-beynes',
    name: 'Beynes',
    type: 'underground-storage',
    coordinates: [1.8700, 48.8600],
    operator: 'Storengy',
    capacityTWh: 3.2,
    fillLevel: 72,
    fillTrend: 'stable',
    status: 'active',
  },
  {
    id: 'sto-saint-clair',
    name: 'Saint-Clair-sur-Epte',
    type: 'underground-storage',
    coordinates: [1.6800, 49.1200],
    operator: 'Storengy',
    capacityTWh: 1.8,
    fillLevel: 58,
    fillTrend: 'stable',
    status: 'active',
  },
  {
    id: 'sto-tersanne',
    name: 'Tersanne',
    type: 'underground-storage',
    coordinates: [5.0500, 45.0500],
    operator: 'Storengy',
    capacityTWh: 2.4,
    fillLevel: 62,
    fillTrend: 'stable',
    status: 'active',
  },
  {
    id: 'sto-hauterives',
    name: 'Hauterives',
    type: 'underground-storage',
    coordinates: [5.0200, 45.2500],
    operator: 'Storengy',
    capacityTWh: 1.5,
    fillLevel: 66,
    fillTrend: 'stable',
    status: 'active',
  },
  {
    id: 'sto-etrez',
    name: 'Etrez',
    type: 'underground-storage',
    coordinates: [5.2000, 46.2800],
    operator: 'Storengy',
    capacityTWh: 2.8,
    fillLevel: 70,
    fillTrend: 'stable',
    status: 'active',
  },
  // Terega sites (South-West)
  {
    id: 'sto-lussagnet',
    name: 'Lussagnet',
    type: 'underground-storage',
    coordinates: [-0.3200, 43.7500],
    operator: 'Terega',
    capacityTWh: 3.5,
    fillLevel: 68,
    fillTrend: 'stable',
    status: 'active',
  },
  {
    id: 'sto-izaute',
    name: 'Izaute',
    type: 'underground-storage',
    coordinates: [-0.2800, 43.6800],
    operator: 'Terega',
    capacityTWh: 2.2,
    fillLevel: 64,
    fillTrend: 'stable',
    status: 'active',
  },
  // Geomethane
  {
    id: 'sto-manosque',
    name: 'Manosque',
    type: 'underground-storage',
    coordinates: [5.7800, 43.8300],
    operator: 'Geomethane',
    capacityTWh: 2.5,
    fillLevel: 75,
    fillTrend: 'stable',
    status: 'active',
  },
];

// ═══ Points d'Interconnexion (PIR) ═══
// Échanges transfrontaliers

export const GAS_INTERCONNECTIONS: GasInterconnection[] = [
  {
    id: 'pir-biriatou',
    name: 'Biriatou',
    country: 'Espagne',
    direction: 'bidirectional',
    coordinates: [-1.7500, 43.3200],
    flowGWhDay: 0,
    maxCapacityGWhDay: 165,
  },
  {
    id: 'pir-larrau',
    name: 'Larrau',
    country: 'Espagne',
    direction: 'bidirectional',
    coordinates: [-0.9500, 43.0200],
    flowGWhDay: 0,
    maxCapacityGWhDay: 55,
  },
  {
    id: 'pir-obergailbach',
    name: 'Obergailbach',
    country: 'Allemagne',
    direction: 'bidirectional',
    coordinates: [7.2100, 49.1300],
    flowGWhDay: 0,
    maxCapacityGWhDay: 620,
  },
  {
    id: 'pir-taisnieres',
    name: 'Taisnières',
    country: 'Belgique',
    direction: 'import',
    coordinates: [3.8200, 50.3600],
    flowGWhDay: 0,
    maxCapacityGWhDay: 240,
  },
  {
    id: 'pir-oltingue',
    name: 'Oltingue',
    country: 'Suisse',
    direction: 'export',
    coordinates: [7.3900, 47.4900],
    flowGWhDay: 0,
    maxCapacityGWhDay: 180,
  },
];

// ═══ Grouped Export ═══

export const ALL_GAS_INFRASTRUCTURE = {
  terminals: GAS_TERMINALS,
  storages: GAS_STORAGES,
  interconnections: GAS_INTERCONNECTIONS,
};
