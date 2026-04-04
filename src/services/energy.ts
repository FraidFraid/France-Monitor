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

// Génère des tranches par défaut avec 100% de disponibilité tant que l'API RTE n'est pas branchée
function generateDefaultReactors(plantName: string, totalCapacity: number, isShutdown: boolean): NuclearReactorData[] {
    let trancheSize = 900;
    if (totalCapacity > 5000) trancheSize = 1300;
    else if (totalCapacity >= 2900 && totalCapacity <= 3000) trancheSize = 1450;
    else if (totalCapacity === 2690 || totalCapacity === 5320) trancheSize = 1330;

    const numReactors = Math.max(2, Math.round((totalCapacity || 1800) / trancheSize));
    const reactors: NuclearReactorData[] = [];

    for (let i = 1; i <= numReactors; i++) {
        reactors.push({
            name: `${plantName} ${i}`,
            power: trancheSize,
            available: isShutdown ? 0 : trancheSize,
            status: isShutdown ? 'shutdown' : 'active',
            availabilityRatio: isShutdown ? 0 : 1,
            description: isShutdown ? 'Arrêt définitif' : undefined
        });
    }

    return reactors;
}

export async function fetchNuclearPlantsStatus(): Promise<NuclearPlantStatus[]> {
    const statuses: NuclearPlantStatus[] = [];

    for (const plant of NUCLEAR_PLANTS) {
        let reactors = generateDefaultReactors(plant.name, plant.capacity || 0, plant.status === 'shutdown');

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
