import type { OreIncident } from '../types/index.ts';

/**
 * ore-incidents.ts — Simulateur d'Incidents Réseau Enedis.
 *
 * NOTE: L'API ORE "Continuité" et "Pannes en cours" Enedis sont inaccessibles 
 * librement en temps réel (bloquées par DataDome / Cloudfront SPA).
 * Ce fichier agit comme un **Simulateur Réaliste (Crisis Mock)** pour
 * la démonstration des capacités du tableau de bord.
 */

const MAJOR_COMMUNES = [
    { city: 'Paris', department: '75', lat: 48.8566, lon: 2.3522 },
    { city: 'Marseille', department: '13', lat: 43.2965, lon: 5.3698 },
    { city: 'Lyon', department: '69', lat: 45.7640, lon: 4.8357 },
    { city: 'Toulouse', department: '31', lat: 43.6047, lon: 1.4442 },
    { city: 'Nice', department: '06', lat: 43.7102, lon: 7.2620 },
    { city: 'Nantes', department: '44', lat: 47.2184, lon: -1.5536 },
    { city: 'Montpellier', department: '34', lat: 43.6108, lon: 3.8767 },
    { city: 'Strasbourg', department: '67', lat: 48.5734, lon: 7.7521 },
    { city: 'Bordeaux', department: '33', lat: 44.8378, lon: -0.5792 },
    { city: 'Lille', department: '59', lat: 50.6292, lon: 3.0573 },
    { city: 'Brest', department: '29', lat: 48.3904, lon: -4.4861 },
    { city: 'Rennes', department: '35', lat: 48.1173, lon: -1.6778 },
    { city: 'Grenoble', department: '38', lat: 45.1885, lon: 5.7245 },
    { city: 'Rouen', department: '76', lat: 49.4432, lon: 1.0993 },
    { city: 'Toulon', department: '83', lat: 43.1242, lon: 5.9280 },
];

const INCIDENT_TYPES = [
    'Panne transformateur HTA',
    'Chute de ligne MT (Intempéries)',
    'Intervention d\'urgence Enedis',
    'Coupure accidentelle (Chantier)',
    'Défaut ligne souterraine',
    'Déclenchement poste de transformation',
    'Incendie poste électrique'
];

let cache: { data: OreIncident[]; fetchedAt: number } | null = null;
const CACHE_TTL = 15 * 60_000; // 15 min de rétention pour voir les mêmes pannes

function generateMockIncidents(): OreIncident[] {
    const numIncidents = Math.floor(Math.random() * 4) + 2; // 2 à 5 incidents en cours sur le pays
    const shuffledCommunes = [...MAJOR_COMMUNES].sort(() => 0.5 - Math.random());
    const selectedCommunes = shuffledCommunes.slice(0, numIncidents);

    return selectedCommunes.map((commune, i) => {
        const foyers = Math.floor(Math.random() * 4000) + 200;
        let severity: OreIncident['severity'] = 'low';
        if (foyers > 2000) severity = 'high';
        else if (foyers > 1000) severity = 'medium';

        // Offset de position pour ne pas être exactement sur le centre ville
        const latOffset = (Math.random() - 0.5) * 0.05;
        const lonOffset = (Math.random() - 0.5) * 0.05;

        // Date de début (entre 1h et 4h dans le passé)
        const pastMs = (Math.floor(Math.random() * 180) + 30) * 60000;

        return {
            id: `sim-enedis-${i}-${Date.now()}`,
            type: 'electricity',
            nature: `[SIMULATION] ${INCIDENT_TYPES[Math.floor(Math.random() * INCIDENT_TYPES.length)]} (${foyers} foyers)`,
            department: commune.department,
            city: commune.city,
            startDate: new Date(Date.now() - pastMs),
            severity,
            coordinates: [commune.lon + lonOffset, commune.lat + latOffset]
        };
    });
}

export async function fetchOreIncidents(): Promise<OreIncident[]> {
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL) {
        return cache.data;
    }

    // Délai artificiel
    await new Promise(resolve => setTimeout(resolve, 800));

    const incidents = generateMockIncidents();

    // Tri par gravité
    const severityScore: Record<OreIncident['severity'], number> = {
        critical: 4, high: 3, medium: 2, low: 1
    };
    incidents.sort((a, b) => severityScore[b.severity] - severityScore[a.severity]);

    cache = { data: incidents, fetchedAt: Date.now() };
    return incidents;
}

