import type { MilitaryBase, RestrictedZone, FrenchMilitaryOperator, FrenchAircraftType } from '../types/index.ts';

// ═══════════════════════════════════════════════════════════════════════════
// CALLSIGN PATTERNS — French + Allied military aircraft
// ═══════════════════════════════════════════════════════════════════════════

export interface FrenchCallsignPattern {
    pattern: RegExp;
    operator: FrenchMilitaryOperator;
    aircraftType?: FrenchAircraftType;
    description: string;
    country?: string;  // ISO 3166-1 alpha-2
}

export const FRENCH_MILITARY_CALLSIGNS: FrenchCallsignPattern[] = [
    // ─── France — Armée de l'Air et de l'Espace (AAE) ───
    { pattern: /^FAF/i, operator: 'armee-air', aircraftType: 'fighter', description: 'French Air Force (generic)', country: 'FR' },
    { pattern: /^CTM/i, operator: 'armee-air', aircraftType: 'transport', description: 'COTAM – transport', country: 'FR' },
    { pattern: /^FRAF/i, operator: 'armee-air', aircraftType: 'fighter', description: 'French Air Force Rafale', country: 'FR' },
    { pattern: /^FRAF/i, operator: 'armee-air', aircraftType: 'fighter', description: 'French Air Force', country: 'FR' },
    { pattern: /^COTAM/i, operator: 'armee-air', aircraftType: 'transport', description: 'COTAM transport', country: 'FR' },
    { pattern: /^FENEC/i, operator: 'armee-air', aircraftType: 'helicopter', description: 'Fennec helicopter', country: 'FR' },
    { pattern: /^RAFAL/i, operator: 'armee-air', aircraftType: 'fighter', description: 'Rafale (exercise)', country: 'FR' },

    // ─── France — Marine Nationale ───
    { pattern: /^FMY/i, operator: 'marine', aircraftType: 'patrol', description: 'Marine Nationale', country: 'FR' },
    { pattern: /^FNY/i, operator: 'marine', aircraftType: 'patrol', description: 'Marine Nationale (naval patrol)', country: 'FR' },
    { pattern: /^FLT/i, operator: 'marine', aircraftType: 'transport', description: 'Marine – transport logistique', country: 'FR' },
    { pattern: /^FRMAR/i, operator: 'marine', aircraftType: 'patrol', description: 'French Navy', country: 'FR' },
    { pattern: /^SURMAR/i, operator: 'marine', aircraftType: 'patrol', description: 'Surveillance Maritime', country: 'FR' },

    // ─── France — ALAT (Aviation Légère de l'Armée de Terre) ───
    { pattern: /^FAT/i, operator: 'alat', aircraftType: 'helicopter', description: 'ALAT', country: 'FR' },
    { pattern: /^ALAT/i, operator: 'alat', aircraftType: 'helicopter', description: 'ALAT', country: 'FR' },
    { pattern: /^TIGRE/i, operator: 'alat', aircraftType: 'helicopter', description: 'Tigre attack helicopter', country: 'FR' },
    { pattern: /^CAIMAN/i, operator: 'alat', aircraftType: 'helicopter', description: 'NH90 Caïman', country: 'FR' },

    // ─── France — Gendarmerie Nationale ───
    { pattern: /^FGN/i, operator: 'gendarmerie', aircraftType: 'helicopter', description: 'Gendarmerie Nationale Aviation', country: 'FR' },
    { pattern: /^GND/i, operator: 'gendarmerie', aircraftType: 'helicopter', description: 'Gendarmerie Nationale', country: 'FR' },
    { pattern: /^GEND/i, operator: 'gendarmerie', aircraftType: 'helicopter', description: 'Gendarmerie', country: 'FR' },

    // ─── France — Sécurité Civile ───
    { pattern: /^FSC/i, operator: 'securite-civile', aircraftType: 'patrol', description: 'Sécurité Civile', country: 'FR' },
    { pattern: /^SECIV/i, operator: 'securite-civile', aircraftType: 'patrol', description: 'Sécurité Civile', country: 'FR' },
    { pattern: /^MILAN/i, operator: 'securite-civile', aircraftType: 'patrol', description: 'Sécurité Civile Dash-8', country: 'FR' },
    { pattern: /^PELICAN/i, operator: 'securite-civile', aircraftType: 'patrol', description: 'Sécurité Civile Canadair', country: 'FR' },

    // ─── France — Douanes ───
    { pattern: /^FDO/i, operator: 'douanes', aircraftType: 'patrol', description: 'Direction des Douanes', country: 'FR' },
    { pattern: /^DOUANE/i, operator: 'douanes', aircraftType: 'patrol', description: 'Douanes françaises', country: 'FR' },
];

// ─── Allied military callsigns (NATO + partners operating in/near France) ───
export interface AlliedCallsignPattern {
    pattern: RegExp;
    country: string;       // ISO 3166-1 alpha-2
    branch: string;        // USAF, RAF, Luftwaffe, etc.
    aircraftType?: FrenchAircraftType;
    description: string;
}

export const ALLIED_MILITARY_CALLSIGNS: AlliedCallsignPattern[] = [
    // ─── United States ───
    { pattern: /^RCH/i, country: 'US', branch: 'USAF', aircraftType: 'transport', description: 'USAF Air Mobility Command' },
    { pattern: /^REACH/i, country: 'US', branch: 'USAF', aircraftType: 'transport', description: 'USAF Air Mobility Command' },
    { pattern: /^DOOM/i, country: 'US', branch: 'USAF', aircraftType: 'fighter', description: 'USAF F-15/F-16' },
    { pattern: /^VIPER/i, country: 'US', branch: 'USAF', aircraftType: 'fighter', description: 'USAF F-16 Viper' },
    { pattern: /^EAGLE/i, country: 'US', branch: 'USAF', aircraftType: 'fighter', description: 'USAF F-15 Eagle' },
    { pattern: /^RAPTOR/i, country: 'US', branch: 'USAF', aircraftType: 'fighter', description: 'USAF F-22 Raptor' },
    { pattern: /^BOLT/i, country: 'US', branch: 'USAF', aircraftType: 'fighter', description: 'USAF F-35 Lightning' },
    { pattern: /^QUID/i, country: 'US', branch: 'USAF', aircraftType: 'tanker', description: 'USAF KC-135/KC-46' },
    { pattern: /^SHELL/i, country: 'US', branch: 'USAF', aircraftType: 'tanker', description: 'USAF tanker' },
    { pattern: /^TEXACO/i, country: 'US', branch: 'USAF', aircraftType: 'tanker', description: 'USAF tanker' },
    { pattern: /^SENTRY/i, country: 'US', branch: 'USAF', aircraftType: 'awacs', description: 'USAF E-3 Sentry AWACS' },
    { pattern: /^AWACS/i, country: 'US', branch: 'USAF', aircraftType: 'awacs', description: 'AWACS' },
    { pattern: /^JSTAR/i, country: 'US', branch: 'USAF', aircraftType: 'awacs', description: 'USAF E-8 JSTARS' },
    { pattern: /^JAKE/i, country: 'US', branch: 'USAF', aircraftType: 'transport', description: 'USAF C-17 Globemaster' },
    { pattern: /^MOOSE/i, country: 'US', branch: 'USAF', aircraftType: 'transport', description: 'USAF C-17' },
    { pattern: /^HERKY/i, country: 'US', branch: 'USAF', aircraftType: 'transport', description: 'USAF C-130 Hercules' },
    { pattern: /^KING/i, country: 'US', branch: 'USAF', aircraftType: 'helicopter', description: 'USAF HH-60 rescue' },
    { pattern: /^PEDRO/i, country: 'US', branch: 'USAF', aircraftType: 'helicopter', description: 'USAF rescue helicopter' },
    { pattern: /^NAVY/i, country: 'US', branch: 'USN', aircraftType: 'patrol', description: 'US Navy' },
    { pattern: /^TOPGUN/i, country: 'US', branch: 'USN', aircraftType: 'fighter', description: 'US Navy fighter' },

    // ─── United Kingdom ───
    { pattern: /^RRR/i, country: 'GB', branch: 'RAF', aircraftType: 'transport', description: 'RAF transport' },
    { pattern: /^ASCOT/i, country: 'GB', branch: 'RAF', aircraftType: 'transport', description: 'RAF VIP/Government' },
    { pattern: /^TRAF/i, country: 'GB', branch: 'RAF', aircraftType: 'tanker', description: 'RAF tanker' },
    { pattern: /^TYPHOON/i, country: 'GB', branch: 'RAF', aircraftType: 'fighter', description: 'RAF Typhoon' },
    { pattern: /^LOSSIE/i, country: 'GB', branch: 'RAF', aircraftType: 'patrol', description: 'RAF Lossiemouth P-8' },
    { pattern: /^POSEIDON/i, country: 'GB', branch: 'RAF', aircraftType: 'patrol', description: 'RAF P-8 Poseidon' },
    { pattern: /^TARTAN/i, country: 'GB', branch: 'RAF', aircraftType: 'fighter', description: 'RAF Scotland' },
    { pattern: /^RAFAIR/i, country: 'GB', branch: 'RAF', description: 'Royal Air Force' },

    // ─── Germany ───
    { pattern: /^GAF/i, country: 'DE', branch: 'Luftwaffe', description: 'German Air Force' },
    { pattern: /^GERMAN/i, country: 'DE', branch: 'Luftwaffe', description: 'German Air Force' },
    { pattern: /^LUFTWAFFE/i, country: 'DE', branch: 'Luftwaffe', description: 'Luftwaffe' },
    { pattern: /^EUFI/i, country: 'DE', branch: 'Luftwaffe', aircraftType: 'fighter', description: 'Eurofighter' },

    // ─── Belgium ───
    { pattern: /^BAF/i, country: 'BE', branch: 'BAF', description: 'Belgian Air Force' },
    { pattern: /^BELGIAN/i, country: 'BE', branch: 'BAF', description: 'Belgian Air Force' },

    // ─── Netherlands ───
    { pattern: /^NAF/i, country: 'NL', branch: 'RNLAF', description: 'Royal Netherlands Air Force' },
    { pattern: /^DUTCH/i, country: 'NL', branch: 'RNLAF', description: 'Royal Netherlands Air Force' },

    // ─── Spain ───
    { pattern: /^AME/i, country: 'ES', branch: 'EdA', description: 'Spanish Air Force' },
    { pattern: /^SPANISH/i, country: 'ES', branch: 'EdA', description: 'Ejército del Aire' },

    // ─── Italy ───
    { pattern: /^IAM/i, country: 'IT', branch: 'AMI', description: 'Italian Air Force' },
    { pattern: /^ITALIAN/i, country: 'IT', branch: 'AMI', description: 'Aeronautica Militare' },

    // ─── NATO ───
    { pattern: /^NATO/i, country: 'NATO', branch: 'NATO', description: 'NATO' },
    { pattern: /^MAGIC/i, country: 'NATO', branch: 'NATO', aircraftType: 'awacs', description: 'NATO AWACS' },
    { pattern: /^NAEW/i, country: 'NATO', branch: 'NATO', aircraftType: 'awacs', description: 'NATO AEW&C' },
];

// ═══════════════════════════════════════════════════════════════════════════
// DETECTION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Identify French military aircraft by callsign prefix.
 * Returns the first matching pattern (highest priority = first match).
 */
export function identifyFrenchCallsign(callsign: string): FrenchCallsignPattern | undefined {
    const cs = callsign.trim().toUpperCase();
    for (const pat of FRENCH_MILITARY_CALLSIGNS) {
        if (pat.pattern.test(cs)) return pat;
    }
    return undefined;
}

/**
 * Identify Allied military aircraft by callsign prefix.
 */
export function identifyAlliedCallsign(callsign: string): AlliedCallsignPattern | undefined {
    const cs = callsign.trim().toUpperCase();
    for (const pat of ALLIED_MILITARY_CALLSIGNS) {
        if (pat.pattern.test(cs)) return pat;
    }
    return undefined;
}

export const MILITARY_BASES: MilitaryBase[] = [
    // Bases aériennes (Armée de l'Air et de l'Espace)
    {
        id: 'BA-105',
        name: 'BA 105 Évreux-Fauville',
        type: 'air',
        coordinates: [1.2197, 49.0286], // LFOE
    },
    {
        id: 'BA-125',
        name: 'BA 125 Istres-Le Tubé',
        type: 'air',
        coordinates: [4.9242, 43.5233], // LFMI
    },
    {
        id: 'BA-118',
        name: 'BA 118 Mont-de-Marsan',
        type: 'air',
        coordinates: [-0.5058, 43.9131], // LFBM
    },
    {
        id: 'BA-702',
        name: 'BA 702 Avord',
        type: 'air',
        coordinates: [2.6333, 47.0500], // LFOA
    },
    {
        id: 'BA-113',
        name: 'BA 113 Saint-Dizier',
        type: 'air',
        coordinates: [4.8992, 48.6364], // LFSI
    },
    {
        id: 'BA-133',
        name: 'BA 133 Nancy-Ochey',
        type: 'air',
        coordinates: [5.9525, 48.5830], // LFSO
    },

    // Bases Navales (Marine Nationale)
    {
        id: 'BN-TLN',
        name: 'Base navale de Toulon',
        type: 'navy',
        coordinates: [5.9189, 43.1190],
    },
    {
        id: 'BN-BRE',
        name: 'Base navale de Brest',
        type: 'navy',
        coordinates: [-4.5000, 48.3758],
    },
    {
        id: 'BN-CHE',
        name: 'Base navale de Cherbourg',
        type: 'navy',
        coordinates: [-1.6375, 49.6508],
    },

    // Armée de Terre / Interarmées
    {
        id: 'BT-MML',
        name: 'Mourmelon-le-Grand',
        type: 'army',
        coordinates: [4.3644, 49.1367],
    },
    {
        id: 'BT-CNS',
        name: 'Camp de Canjuers',
        type: 'army',
        coordinates: [6.3267, 43.7225],
    },
    {
        id: 'BA-103',
        name: 'BA 103 Cambrai',
        type: 'air',
        coordinates: [3.1522, 50.2211],
    },
    {
        id: 'BA-115',
        name: 'BA 115 Orange-Caritat',
        type: 'air',
        coordinates: [4.8672, 44.1403],
    },
    {
        id: 'BA-120',
        name: 'BA 120 Cazaux',
        type: 'air',
        coordinates: [-1.1250, 44.5328],
    },
    {
        id: 'BN-LAN',
        name: 'Base aéronavale de Lann-Bihoué',
        type: 'navy',
        coordinates: [-3.4667, 47.7606],
    },
    {
        id: 'BN-HYE',
        name: 'Base aéronavale de Hyères',
        type: 'navy',
        coordinates: [6.1467, 43.0967],
    },

    // ─── DROM — Antilles ───
    {
        id: 'DROM-MAR-971',
        name: 'Fort-de-France (Martinique)',
        type: 'joint',
        coordinates: [-61.0631, 14.6137],
    },
    {
        id: 'DROM-GUA-971',
        name: 'Abymes – Pointe-à-Pitre (Guadeloupe)',
        type: 'joint',
        coordinates: [-61.5181, 16.2578],
    },

    // ─── DROM — Guyane ───
    {
        id: 'DROM-GUF-CSG',
        name: 'Base de Cayenne (Guyane)',
        type: 'air',
        coordinates: [-52.3653, 4.8228],
    },

    // ─── DOM — La Réunion ───
    {
        id: 'DROM-REU-REU',
        name: 'FAZSOI – La Réunion',
        type: 'joint',
        coordinates: [55.5364, -20.9022],
    },

    // ─── COM — Mayotte ───
    {
        id: 'DROM-MYT-MYT',
        name: 'Dzaoudzi (Mayotte)',
        type: 'navy',
        coordinates: [45.2569, -12.7871],
    },

    // ─── COM — Polynésie Française ───
    {
        id: 'DROM-PF-FAA',
        name: 'Faa\'a (Polynésie Française)',
        type: 'joint',
        coordinates: [-149.6067, -17.5536],
    },

    // ─── COM — Nouvelle-Calédonie ───
    {
        id: 'DROM-NC-NOK',
        name: 'Nouméa (Nouvelle-Calédonie)',
        type: 'joint',
        coordinates: [166.4414, -22.2558],
    },

    // ─── COM — Djibouti ───
    {
        id: 'DROM-DJI',
        name: 'Camp Lemonnier (Djibouti)',
        type: 'joint',
        coordinates: [43.1547, 11.5483],
    },
];


// Mock Zones Interdites (ZIT)
export const RESTRICTED_ZONES: RestrictedZone[] = [
    {
        id: 'ZIT-PARIS',
        name: 'ZIT Paris (P-23)',
        type: 'ZIT',
        active: true,
        geometry: {
            type: 'Polygon',
            // Approx polygon for Paris
            coordinates: [[
                [2.22, 48.91],
                [2.45, 48.91],
                [2.45, 48.81],
                [2.22, 48.81],
                [2.22, 48.91]
            ]]
        },
        minAltitude: 0,
        maxAltitude: 10000
    },
    {
        id: 'ZIT-ILE-LONGUE',
        name: 'ZIT Île Longue',
        type: 'ZIT',
        active: true,
        geometry: {
            type: 'Polygon',
            // Circle around Île Longue (Approximated)
            coordinates: [[
                [-4.57, 48.31],
                [-4.53, 48.31],
                [-4.53, 48.29],
                [-4.57, 48.29],
                [-4.57, 48.31]
            ]]
        }
    },
    // We can generate circles for ZITs dynamically via Decker.GL or generate points explicitly
];
