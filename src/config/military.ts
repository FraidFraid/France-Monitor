import type { FrenchMilitaryOperator, FrenchAircraftType } from '../types/index.ts';

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
