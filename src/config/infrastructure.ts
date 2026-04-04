/**
 * infrastructure.ts — Sélection sobre d'infrastructures énergétiques vitales.
 * Le layer regroupe uniquement les grands nœuds structurants, sans chercher l'exhaustivité.
 * Coordonnées [lng, lat].
 */

import type { InfrastructurePoint, NuclearUnitReference } from '../types/index.ts';

// ═══ Électricité ═══
// Source de référence visuelle : parc EDF / RTE.
// Le nucléaire reste enrichi dynamiquement via src/services/energy.ts.

export const NUCLEAR_PLANTS: InfrastructurePoint[] = [
  { id: 'nuc-gravelines',    name: 'Gravelines',             type: 'nuclear', coordinates: [2.1263, 51.0135], status: 'active',   capacity: 5440, capacityUnit: 'MW', operator: 'EDF' },
  { id: 'nuc-blayais',       name: 'Blayais',                type: 'nuclear', coordinates: [-0.7012, 45.1594], status: 'active',   capacity: 3800, capacityUnit: 'MW', operator: 'EDF' },
  { id: 'nuc-bugey',         name: 'Bugey',                  type: 'nuclear', coordinates: [5.2693, 45.7980], status: 'active',   capacity: 3600, capacityUnit: 'MW', operator: 'EDF' },
  { id: 'nuc-cattenom',      name: 'Cattenom',               type: 'nuclear', coordinates: [6.2172, 49.4023], status: 'active',   capacity: 5200, capacityUnit: 'MW', operator: 'EDF' },
  { id: 'nuc-chinon',        name: 'Chinon',                 type: 'nuclear', coordinates: [0.1667, 47.2333], status: 'active',   capacity: 3700, capacityUnit: 'MW', operator: 'EDF' },
  { id: 'nuc-chooz',         name: 'Chooz',                  type: 'nuclear', coordinates: [4.7991, 50.0908], status: 'active',   capacity: 2980, capacityUnit: 'MW', operator: 'EDF' },
  { id: 'nuc-civaux',        name: 'Civaux',                 type: 'nuclear', coordinates: [0.6544, 46.4575], status: 'active',   capacity: 2970, capacityUnit: 'MW', operator: 'EDF' },
  { id: 'nuc-cruas',         name: 'Cruas-Meysse',           type: 'nuclear', coordinates: [4.7580, 44.6307], status: 'active',   capacity: 3600, capacityUnit: 'MW', operator: 'EDF' },
  { id: 'nuc-dampierre',     name: 'Dampierre-en-Burly',     type: 'nuclear', coordinates: [2.5189, 47.7428], status: 'active',   capacity: 3560, capacityUnit: 'MW', operator: 'EDF' },
  { id: 'nuc-flamanville',   name: 'Flamanville',            type: 'nuclear', coordinates: [-1.8833, 49.5260], status: 'active',   capacity: 2690, capacityUnit: 'MW', operator: 'EDF' },
  { id: 'nuc-golfech',       name: 'Golfech',                type: 'nuclear', coordinates: [0.8447, 44.1099], status: 'active',   capacity: 2620, capacityUnit: 'MW', operator: 'EDF' },
  { id: 'nuc-nogent',        name: 'Nogent-sur-Seine',       type: 'nuclear', coordinates: [3.5192, 48.5163], status: 'active',   capacity: 2620, capacityUnit: 'MW', operator: 'EDF' },
  { id: 'nuc-paluel',        name: 'Paluel',                 type: 'nuclear', coordinates: [0.6310, 49.8657], status: 'active',   capacity: 5320, capacityUnit: 'MW', operator: 'EDF' },
  { id: 'nuc-penly',         name: 'Penly',                  type: 'nuclear', coordinates: [1.2132, 49.9750], status: 'active',   capacity: 2690, capacityUnit: 'MW', operator: 'EDF' },
  { id: 'nuc-saint-alban',   name: 'Saint-Alban',            type: 'nuclear', coordinates: [4.7628, 45.4730], status: 'active',   capacity: 2850, capacityUnit: 'MW', operator: 'EDF' },
  { id: 'nuc-saint-laurent', name: 'Saint-Laurent-des-Eaux', type: 'nuclear', coordinates: [1.5712, 47.7218], status: 'active',   capacity: 1830, capacityUnit: 'MW', operator: 'EDF' },
  { id: 'nuc-tricastin',     name: 'Tricastin',              type: 'nuclear', coordinates: [4.7335, 44.3288], status: 'active',   capacity: 3600, capacityUnit: 'MW', operator: 'EDF' },
  { id: 'nuc-belleville',    name: 'Belleville-sur-Loire',   type: 'nuclear', coordinates: [2.8689, 47.5086], status: 'active',   capacity: 2620, capacityUnit: 'MW', operator: 'EDF' },
  { id: 'nuc-fessenheim',    name: 'Fessenheim',             type: 'nuclear', coordinates: [7.5667, 47.9021], status: 'shutdown', capacity: 0,    capacityUnit: 'MW', operator: 'EDF', notes: 'Site arrêté, non affiché par défaut' },
];

const makeNuclearUnits = (
  plantId: string,
  plantName: string,
  units: Array<{ unitName: string; nominalPowerMW: number; aliases?: string[] }>,
): NuclearUnitReference[] =>
  units.map((unit, index) => ({
    id: `${plantId}-unit-${index + 1}`,
    plantId,
    plantName,
    unitName: unit.unitName,
    nominalPowerMW: unit.nominalPowerMW,
    aliases: unit.aliases ?? [],
  }));

export const NUCLEAR_UNITS: NuclearUnitReference[] = [
  ...makeNuclearUnits('nuc-belleville', 'Belleville-sur-Loire', [
    { unitName: 'BELLEVILLE 1', nominalPowerMW: 1310 },
    { unitName: 'BELLEVILLE 2', nominalPowerMW: 1310 },
  ]),
  ...makeNuclearUnits('nuc-blayais', 'Blayais', [
    { unitName: 'BLAYAIS 1', nominalPowerMW: 950 },
    { unitName: 'BLAYAIS 2', nominalPowerMW: 950 },
    { unitName: 'BLAYAIS 3', nominalPowerMW: 950 },
    { unitName: 'BLAYAIS 4', nominalPowerMW: 950 },
  ]),
  ...makeNuclearUnits('nuc-bugey', 'Bugey', [
    { unitName: 'BUGEY 2', nominalPowerMW: 900 },
    { unitName: 'BUGEY 3', nominalPowerMW: 900 },
    { unitName: 'BUGEY 4', nominalPowerMW: 900 },
    { unitName: 'BUGEY 5', nominalPowerMW: 900 },
  ]),
  ...makeNuclearUnits('nuc-cattenom', 'Cattenom', [
    { unitName: 'CATTENOM 1', nominalPowerMW: 1300 },
    { unitName: 'CATTENOM 2', nominalPowerMW: 1300 },
    { unitName: 'CATTENOM 3', nominalPowerMW: 1300 },
    { unitName: 'CATTENOM 4', nominalPowerMW: 1300 },
  ]),
  ...makeNuclearUnits('nuc-chinon', 'Chinon', [
    { unitName: 'CHINON B1', nominalPowerMW: 925, aliases: ['CHINON 1'] },
    { unitName: 'CHINON B2', nominalPowerMW: 925, aliases: ['CHINON 2'] },
    { unitName: 'CHINON B3', nominalPowerMW: 925, aliases: ['CHINON 3'] },
    { unitName: 'CHINON B4', nominalPowerMW: 925, aliases: ['CHINON 4'] },
  ]),
  ...makeNuclearUnits('nuc-chooz', 'Chooz', [
    { unitName: 'CHOOZ 1', nominalPowerMW: 1490, aliases: ['CHOOZ B1'] },
    { unitName: 'CHOOZ 2', nominalPowerMW: 1490, aliases: ['CHOOZ B2'] },
  ]),
  ...makeNuclearUnits('nuc-civaux', 'Civaux', [
    { unitName: 'CIVAUX 1', nominalPowerMW: 1485 },
    { unitName: 'CIVAUX 2', nominalPowerMW: 1485 },
  ]),
  ...makeNuclearUnits('nuc-cruas', 'Cruas-Meysse', [
    { unitName: 'CRUAS 1', nominalPowerMW: 900 },
    { unitName: 'CRUAS 2', nominalPowerMW: 900 },
    { unitName: 'CRUAS 3', nominalPowerMW: 900 },
    { unitName: 'CRUAS 4', nominalPowerMW: 900 },
  ]),
  ...makeNuclearUnits('nuc-dampierre', 'Dampierre-en-Burly', [
    { unitName: 'DAMPIERRE 1', nominalPowerMW: 890 },
    { unitName: 'DAMPIERRE 2', nominalPowerMW: 890 },
    { unitName: 'DAMPIERRE 3', nominalPowerMW: 890 },
    { unitName: 'DAMPIERRE 4', nominalPowerMW: 890 },
  ]),
  ...makeNuclearUnits('nuc-flamanville', 'Flamanville', [
    { unitName: 'FLAMANVILLE 1', nominalPowerMW: 1345 },
    { unitName: 'FLAMANVILLE 2', nominalPowerMW: 1345 },
  ]),
  ...makeNuclearUnits('nuc-golfech', 'Golfech', [
    { unitName: 'GOLFECH 1', nominalPowerMW: 1310 },
    { unitName: 'GOLFECH 2', nominalPowerMW: 1310 },
  ]),
  ...makeNuclearUnits('nuc-gravelines', 'Gravelines', [
    { unitName: 'GRAVELINES 1', nominalPowerMW: 910, aliases: ['GRAVELINES-1'] },
    { unitName: 'GRAVELINES 2', nominalPowerMW: 910, aliases: ['GRAVELINES-2'] },
    { unitName: 'GRAVELINES 3', nominalPowerMW: 910, aliases: ['GRAVELINES-3'] },
    { unitName: 'GRAVELINES 4', nominalPowerMW: 910, aliases: ['GRAVELINES-4'] },
    { unitName: 'GRAVELINES 5', nominalPowerMW: 900, aliases: ['GRAVELINES-5'] },
    { unitName: 'GRAVELINES 6', nominalPowerMW: 900, aliases: ['GRAVELINES-6'] },
  ]),
  ...makeNuclearUnits('nuc-nogent', 'Nogent-sur-Seine', [
    { unitName: 'NOGENT 1', nominalPowerMW: 1310 },
    { unitName: 'NOGENT 2', nominalPowerMW: 1310 },
  ]),
  ...makeNuclearUnits('nuc-paluel', 'Paluel', [
    { unitName: 'PALUEL 1', nominalPowerMW: 1330 },
    { unitName: 'PALUEL 2', nominalPowerMW: 1330 },
    { unitName: 'PALUEL 3', nominalPowerMW: 1330 },
    { unitName: 'PALUEL 4', nominalPowerMW: 1330 },
  ]),
  ...makeNuclearUnits('nuc-penly', 'Penly', [
    { unitName: 'PENLY 1', nominalPowerMW: 1345 },
    { unitName: 'PENLY 2', nominalPowerMW: 1345 },
  ]),
  ...makeNuclearUnits('nuc-saint-alban', 'Saint-Alban', [
    { unitName: 'ST ALBAN 1', nominalPowerMW: 1425, aliases: ['SAINT ALBAN 1'] },
    { unitName: 'ST ALBAN 2', nominalPowerMW: 1425, aliases: ['SAINT ALBAN 2'] },
  ]),
  ...makeNuclearUnits('nuc-saint-laurent', 'Saint-Laurent-des-Eaux', [
    { unitName: 'ST LAURENT 1', nominalPowerMW: 915, aliases: ['SAINT LAURENT 1'] },
    { unitName: 'ST LAURENT 2', nominalPowerMW: 915, aliases: ['SAINT LAURENT 2'] },
  ]),
  ...makeNuclearUnits('nuc-tricastin', 'Tricastin', [
    { unitName: 'TRICASTIN 1', nominalPowerMW: 900 },
    { unitName: 'TRICASTIN 2', nominalPowerMW: 900 },
    { unitName: 'TRICASTIN 3', nominalPowerMW: 900 },
    { unitName: 'TRICASTIN 4', nominalPowerMW: 900 },
  ]),
];

export const NUCLEAR_UNIT_COUNT = NUCLEAR_UNITS.length;
export const NUCLEAR_FLEET_INSTALLED_CAPACITY_MW = NUCLEAR_UNITS
  .reduce((sum, unit) => sum + unit.nominalPowerMW, 0);

export const MAJOR_THERMAL_PLANTS: InfrastructurePoint[] = [
  { id: 'th-saint-avold', name: 'Saint-Avold / Émile-Huchet', type: 'thermal', coordinates: [6.7080, 49.1080], status: 'active', capacity: 1295, capacityUnit: 'MW', operator: 'GazelEnergie', notes: 'Grand pôle thermique Grand Est' },
  { id: 'th-martigues',   name: 'Martigues - Ponteau',        type: 'thermal', coordinates: [5.0300, 43.4100], status: 'active', capacity: 1380, capacityUnit: 'MW', operator: 'EDF', notes: 'Appui PACA / façade méditerranéenne' },
];

export const MAJOR_HYDRO_PLANTS: InfrastructurePoint[] = [
  { id: 'hy-grand-maison',  name: 'Grand Maison',    type: 'hydro', coordinates: [6.0860, 45.2270], status: 'active', capacity: 1800, capacityUnit: 'MW', operator: 'EDF', notes: 'STEP majeure des Alpes' },
  { id: 'hy-montezic',      name: 'Montézic',        type: 'hydro', coordinates: [2.6730, 44.7670], status: 'active', capacity: 920,  capacityUnit: 'MW', operator: 'EDF', notes: 'STEP stratégique Massif central' },
  { id: 'hy-revin',         name: 'Revin',           type: 'hydro', coordinates: [4.6400, 49.9420], status: 'active', capacity: 800,  capacityUnit: 'MW', operator: 'EDF', notes: 'STEP des Ardennes' },
  { id: 'hy-super-bissorte', name: 'Super-Bissorte', type: 'hydro', coordinates: [6.6990, 45.2720], status: 'active', capacity: 748,  capacityUnit: 'MW', operator: 'EDF', notes: 'STEP Maurienne' },
];

export const RTE_SUBSTATIONS: InfrastructurePoint[] = [
  { id: 'rte-avelin',      name: 'Avelin',          type: 'substation', coordinates: [3.1467, 50.5270], operator: 'RTE', voltageKv: 400, notes: 'Nœud stratégique nord-européen' },
  { id: 'rte-cordemais',   name: 'Cordemais',       type: 'substation', coordinates: [-1.8850, 47.2748], operator: 'RTE', voltageKv: 400, notes: 'Interface ouest / axe Loire' },
  { id: 'rte-baixas',      name: 'Baixas',          type: 'substation', coordinates: [2.8136, 42.7430], operator: 'RTE', voltageKv: 400, notes: 'Interconnexion ibérique' },
  { id: 'rte-albertville', name: 'Albertville',     type: 'substation', coordinates: [6.3936, 45.6750], operator: 'RTE', voltageKv: 400, notes: 'Hub alpin hydraulique' },
  { id: 'rte-boutre',      name: 'Boutre',          type: 'substation', coordinates: [6.0340, 43.7140], operator: 'RTE', voltageKv: 400, notes: 'Sud-Est / PACA' },
  { id: 'rte-muhlbach',    name: 'Muhlbach',        type: 'substation', coordinates: [7.2300, 47.9780], operator: 'RTE', voltageKv: 400, notes: 'Porte du Rhin supérieur' },
  { id: 'rte-lonny',       name: 'Lonny',           type: 'substation', coordinates: [4.5450, 49.8270], operator: 'RTE', voltageKv: 400, notes: 'Transit Grand Est' },
  { id: 'rte-valdonne',    name: 'Val-de-Durance',  type: 'substation', coordinates: [5.5970, 43.6950], operator: 'RTE', voltageKv: 400, notes: 'Axe Durance / Provence' },
];

// ═══ Gaz ═══

export const MAJOR_GAS_TERMINALS: InfrastructurePoint[] = [
  { id: 'gas-fos-tonkin', name: 'Fos Tonkin',           type: 'gas-terminal', coordinates: [4.9230, 43.4050], status: 'active', capacity: 55,  capacityUnit: 'GWh', operator: 'Elengy', notes: 'Terminal méthanier' },
  { id: 'gas-fos-cavaou', name: 'Fos Cavaou',           type: 'gas-terminal', coordinates: [4.8800, 43.4100], status: 'active', capacity: 85,  capacityUnit: 'GWh', operator: 'Elengy', notes: 'Terminal méthanier majeur' },
  { id: 'gas-montoir',    name: 'Montoir-de-Bretagne',  type: 'gas-terminal', coordinates: [-2.1500, 47.3100], status: 'active', capacity: 100, capacityUnit: 'GWh', operator: 'Elengy', notes: 'Façade atlantique' },
  { id: 'gas-dunkerque',  name: 'Dunkerque LNG',        type: 'gas-terminal', coordinates: [2.2000, 51.0300], status: 'active', capacity: 130, capacityUnit: 'GWh', operator: 'Dunkerque LNG', notes: 'Hub nord-européen' },
];

export const MAJOR_GAS_STORAGES: InfrastructurePoint[] = [
  { id: 'gas-chemery',   name: 'Chémery',                type: 'gas-storage', coordinates: [1.4200, 47.3500], status: 'active', capacity: 7.0, capacityUnit: 'TWh', operator: 'Storengy', notes: 'Plus grand stockage souterrain' },
  { id: 'gas-germigny',  name: 'Germigny-sous-Coulombs', type: 'gas-storage', coordinates: [3.1300, 49.0800], status: 'active', capacity: 3.8, capacityUnit: 'TWh', operator: 'Storengy', notes: 'Bassin parisien' },
  { id: 'gas-gournay',   name: 'Gournay-sur-Aronde',     type: 'gas-storage', coordinates: [2.8500, 49.5200], status: 'active', capacity: 3.5, capacityUnit: 'TWh', operator: 'Storengy', notes: 'Hauts-de-France / Île-de-France' },
  { id: 'gas-lussagnet', name: 'Lussagnet',              type: 'gas-storage', coordinates: [-0.3200, 43.7500], status: 'active', capacity: 3.5, capacityUnit: 'TWh', operator: 'Teréga', notes: 'Sud-Ouest' },
  { id: 'gas-beynes',    name: 'Beynes',                 type: 'gas-storage', coordinates: [1.8700, 48.8600], status: 'active', capacity: 3.2, capacityUnit: 'TWh', operator: 'Storengy', notes: 'Île-de-France élargie' },
  { id: 'gas-manosque',  name: 'Manosque',               type: 'gas-storage', coordinates: [5.7800, 43.8300], status: 'active', capacity: 2.5, capacityUnit: 'TWh', operator: 'Géométhane', notes: 'Stockage souterrain Provence' },
];

// ═══ Pétrole ═══

export const MAJOR_REFINERIES: InfrastructurePoint[] = [
  { id: 'ref-gonfreville',  name: 'Gonfreville-l\'Orcher',   type: 'refinery', coordinates: [0.2200, 49.4800], status: 'active', capacity: 12.0, capacityUnit: 'Mt/an', operator: 'TotalEnergies', notes: 'Normandie' },
  { id: 'ref-port-jerome',  name: 'Port-Jérôme-Gravenchon',  type: 'refinery', coordinates: [0.5600, 49.4900], status: 'active', capacity: 12.0, capacityUnit: 'Mt/an', operator: 'Esso / ExxonMobil', notes: 'Axe Seine' },
  { id: 'ref-donges',       name: 'Donges',                  type: 'refinery', coordinates: [-2.0800, 47.3000], status: 'active', capacity: 11.0, capacityUnit: 'Mt/an', operator: 'TotalEnergies', notes: 'Façade atlantique' },
  { id: 'ref-lavera',       name: 'Lavéra',                  type: 'refinery', coordinates: [4.9850, 43.3950], status: 'active', capacity: 9.9,  capacityUnit: 'Mt/an', operator: 'Petroineos', notes: 'Golfe de Fos' },
  { id: 'ref-fos',          name: 'Fos-sur-Mer',             type: 'refinery', coordinates: [4.9400, 43.4300], status: 'active', capacity: 6.6,  capacityUnit: 'Mt/an', operator: 'Rhône Energies', notes: 'Golfe de Fos' },
  { id: 'ref-feyzin',       name: 'Feyzin',                  type: 'refinery', coordinates: [4.8600, 45.6700], status: 'active', capacity: 5.6,  capacityUnit: 'Mt/an', operator: 'TotalEnergies', notes: 'Couloir rhodanien' },
];

export const STRATEGIC_OIL_DEPOTS: InfrastructurePoint[] = [
  { id: 'oil-antifer',    name: 'Antifer',              type: 'oil-depot', coordinates: [-0.1500, 49.6700], status: 'active', capacity: 2_000_000, capacityUnit: 'm3', operator: 'Port du Havre', notes: 'Grand hub portuaire pétrolier' },
  { id: 'oil-fos',        name: 'Fos-sur-Mer',          type: 'oil-depot', coordinates: [4.8900, 43.4200], status: 'active', capacity: 3_000_000, capacityUnit: 'm3', operator: 'Zone Fos', notes: 'Hub méditerranéen majeur' },
  { id: 'oil-donges',     name: 'Donges-Nantes',        type: 'oil-depot', coordinates: [-2.0700, 47.3100], status: 'active', capacity: 1_200_000, capacityUnit: 'm3', operator: 'TotalEnergies', notes: 'Hub Atlantique' },
  { id: 'oil-frontignan', name: 'Frontignan',           type: 'oil-depot', coordinates: [3.7500, 43.4500], status: 'active', capacity: 800_000,  capacityUnit: 'm3', operator: 'SAGESS', notes: 'Réserve stratégique littorale' },
  { id: 'oil-manosque',   name: 'Manosque (cavernes)',  type: 'oil-depot', coordinates: [5.7900, 43.8300], status: 'active', capacity: 1_200_000, capacityUnit: 'm3', operator: 'Géosel', notes: 'Stockage souterrain stratégique' },
];

// ═══ Export consolidé ═══

export const ALL_INFRASTRUCTURE: InfrastructurePoint[] = [
  ...NUCLEAR_PLANTS,
  ...MAJOR_THERMAL_PLANTS,
  ...MAJOR_HYDRO_PLANTS,
  ...RTE_SUBSTATIONS,
  ...MAJOR_GAS_TERMINALS,
  ...MAJOR_GAS_STORAGES,
  ...MAJOR_REFINERIES,
  ...STRATEGIC_OIL_DEPOTS,
];

export function getActiveInfrastructure(): InfrastructurePoint[] {
  return ALL_INFRASTRUCTURE.filter((point) => point.status !== 'shutdown');
}
