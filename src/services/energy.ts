import type { InfrastructurePoint } from '../types/index.ts';
import { NUCLEAR_PLANTS } from '../config/infrastructure.ts';

// ─── Interfaces Data Open Data RTE / EDF ───

export interface NuclearReactorData {
    name: string;
    power: number; // Puissance maximale MW
    available: number; // Puissance disponible MW
    status: 'active' | 'maintenance' | 'shutdown';
    availabilityRatio: number; // 0 to 1
    description?: string;
}

export interface NuclearPlantStatus extends InfrastructurePoint {
    reactors: NuclearReactorData[];
    totalPower: number;
    totalAvailable: number;
    globalAvailability: number; // 0 to 1
    status: 'active' | 'maintenance' | 'shutdown';
}

// Pour simplifier l'intégration dans l'immédiat (sans auth complexe ODRE pour les réacteurs unitaires),
// on mock l'état de maintenance de quelques tranches nucléaires françaises pour démontrer la fonctionnalité.
// Dans le monde réel, cela taperait l'API RTE "Unavailability of Generation facilities" (qui nécessite un token OAuth2).

const MOCK_MAINTENANCES: Record<string, NuclearReactorData[]> = {
    'nuc-bugey': [
        { name: 'Bugey 2', power: 900, available: 900, status: 'active', availabilityRatio: 1 },
        { name: 'Bugey 3', power: 900, available: 0, status: 'maintenance', availabilityRatio: 0, description: 'Visite décennale - Arrêt prolongé' },
        { name: 'Bugey 4', power: 900, available: 900, status: 'active', availabilityRatio: 1 },
        { name: 'Bugey 5', power: 900, available: 900, status: 'active', availabilityRatio: 1 },
    ],
    'nuc-flamanville': [
        { name: 'Flamanville 1', power: 1330, available: 1330, status: 'active', availabilityRatio: 1 },
        { name: 'Flamanville 2', power: 1330, available: 0, status: 'maintenance', availabilityRatio: 0, description: 'Maintenance programmée (Rechargement)' },
        { name: 'Flamanville 3 (EPR)', power: 1600, available: 1600, status: 'active', availabilityRatio: 1 }, // L'EPR a démarré !
    ],
    'nuc-tricastin': [
        { name: 'Tricastin 1', power: 900, available: 900, status: 'active', availabilityRatio: 1 },
        { name: 'Tricastin 2', power: 900, available: 900, status: 'active', availabilityRatio: 1 },
        { name: 'Tricastin 3', power: 900, available: 0, status: 'maintenance', availabilityRatio: 0, description: 'Arrêt fortuit (défaut alternateur)' },
        { name: 'Tricastin 4', power: 900, available: 900, status: 'active', availabilityRatio: 1 },
    ],
    'nuc-civaux': [
        { name: 'Civaux 1', power: 1450, available: 0, status: 'maintenance', availabilityRatio: 0, description: 'Arrêt pour corrosion sous contrainte (CSC)' },
        { name: 'Civaux 2', power: 1450, available: 1450, status: 'active', availabilityRatio: 1 },
    ],
    'nuc-fessenheim': [
        { name: 'Fessenheim 1', power: 880, available: 0, status: 'shutdown', availabilityRatio: 0, description: 'Arrêt définitif (2020)' },
        { name: 'Fessenheim 2', power: 880, available: 0, status: 'shutdown', availabilityRatio: 0, description: 'Arrêt définitif (2020)' },
    ]
};

// Génère des tranches par défaut pour les autres centrales qui n'ont pas de mock de panne
function generateDefaultReactors(plantName: string, totalCapacity: number): NuclearReactorData[] {
    // Arbitrairement, on divise la capacité par tranche de 900 ou 1300 ou 1450 MW
    let trancheSize = 900;
    if (totalCapacity > 5000) trancheSize = 1300;
    else if (totalCapacity >= 2900 && totalCapacity <= 3000) trancheSize = 1450;
    else if (totalCapacity === 2690 || totalCapacity === 5320) trancheSize = 1330;

    const numReactors = Math.max(2, Math.round((totalCapacity || 1800) / trancheSize));
    const reactors: NuclearReactorData[] = [];

    // Ajouter un peu d'aléatoire pour que ça 'vive' visuellement mais très peu
    for (let i = 1; i <= numReactors; i++) {
        // 5% chance of random maintenance for demo payload
        const isMaintenance = Math.random() < 0.05;
        reactors.push({
            name: `${plantName} ${i}`,
            power: trancheSize,
            available: isMaintenance ? 0 : trancheSize,
            status: isMaintenance ? 'maintenance' : 'active',
            availabilityRatio: isMaintenance ? 0 : 1,
            description: isMaintenance ? 'Arrêt programmé court' : undefined
        });
    }

    return reactors;
}

export async function fetchNuclearPlantsStatus(): Promise<NuclearPlantStatus[]> {
    const statuses: NuclearPlantStatus[] = [];

    for (const plant of NUCLEAR_PLANTS) {
        let reactors = MOCK_MAINTENANCES[plant.id];

        if (!reactors) {
            reactors = generateDefaultReactors(plant.name, plant.capacity || 0);
        }

        let totalPower = 0;
        let totalAvailable = 0;

        for (const r of reactors) {
            totalPower += r.power;
            totalAvailable += r.available;
        }

        const globalAvailability = totalPower > 0 ? totalAvailable / totalPower : 0;

        let plantStatus: 'active' | 'maintenance' | 'shutdown' = 'active';
        if (plant.status === 'shutdown') {
            plantStatus = 'shutdown';
        } else if (globalAvailability < 0.5) {
            plantStatus = 'maintenance';
        }

        statuses.push({
            ...plant,
            reactors,
            totalPower,
            totalAvailable,
            globalAvailability,
            status: plantStatus
        });
    }

    return statuses;
}
