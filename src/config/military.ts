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
// HEX CODE RANGES — ICAO24 allocations for military aircraft
// ═══════════════════════════════════════════════════════════════════════════

export const FRENCH_HEX_RANGES: { start: string; end: string; operator: FrenchMilitaryOperator }[] = [
    { start: '3AA000', end: '3AFFFF', operator: 'armee-air' },
    { start: '3B0000', end: '3B0FFF', operator: 'armee-air' },
    { start: '3B7000', end: '3BFFFF', operator: 'armee-air' },
];

export interface AlliedHexRange {
    start: string;
    end: string;
    country: string;
    branch: string;
}

export const ALLIED_HEX_RANGES: AlliedHexRange[] = [
    // United States (AE prefix = military)
    { start: 'AE0000', end: 'AFFFFF', country: 'US', branch: 'USAF/USN/USMC' },
    // United Kingdom
    { start: '43C000', end: '43CFFF', country: 'GB', branch: 'RAF' },
    // Germany
    { start: '3F4000', end: '3F7FFF', country: 'DE', branch: 'Luftwaffe' },
    // Belgium
    { start: '448000', end: '448FFF', country: 'BE', branch: 'BAF' },
    // Netherlands
    { start: '480000', end: '480FFF', country: 'NL', branch: 'RNLAF' },
    // Spain
    { start: '340000', end: '340FFF', country: 'ES', branch: 'EdA' },
    // Italy
    { start: '300000', end: '300FFF', country: 'IT', branch: 'AMI' },
];

// ═══════════════════════════════════════════════════════════════════════════
// AIRCRAFT TYPES — ICAO type designators → aircraft classification
// ═══════════════════════════════════════════════════════════════════════════

export const AIRCRAFT_TYPES: Record<string, { type: FrenchAircraftType; model: string; country?: string }> = {
    // ─── Fighters ───
    'RFAL': { type: 'fighter', model: 'Rafale', country: 'FR' },
    'M2K': { type: 'fighter', model: 'Mirage 2000D/N', country: 'FR' },
    'M2KC': { type: 'fighter', model: 'Mirage 2000C', country: 'FR' },
    'M2KD': { type: 'fighter', model: 'Mirage 2000D', country: 'FR' },
    'M2KN': { type: 'fighter', model: 'Mirage 2000N', country: 'FR' },
    'EUFI': { type: 'fighter', model: 'Eurofighter Typhoon' },
    'F16': { type: 'fighter', model: 'F-16 Fighting Falcon', country: 'US' },
    'F15': { type: 'fighter', model: 'F-15 Eagle', country: 'US' },
    'F15E': { type: 'fighter', model: 'F-15E Strike Eagle', country: 'US' },
    'F18': { type: 'fighter', model: 'F/A-18 Hornet', country: 'US' },
    'FA18': { type: 'fighter', model: 'F/A-18 Super Hornet', country: 'US' },
    'F22': { type: 'fighter', model: 'F-22 Raptor', country: 'US' },
    'F35': { type: 'fighter', model: 'F-35 Lightning II', country: 'US' },
    'F35A': { type: 'fighter', model: 'F-35A Lightning II', country: 'US' },
    'F35B': { type: 'fighter', model: 'F-35B Lightning II', country: 'US' },
    'TORD': { type: 'fighter', model: 'Tornado', country: 'EU' },

    // ─── Transports ───
    'A400': { type: 'transport', model: 'A400M Atlas' },
    'A400M': { type: 'transport', model: 'A400M Atlas' },
    'C130': { type: 'transport', model: 'C-130 Hercules' },
    'C130J': { type: 'transport', model: 'C-130J Super Hercules' },
    'C30J': { type: 'transport', model: 'C-130J Super Hercules' },
    'C17': { type: 'transport', model: 'C-17 Globemaster III', country: 'US' },
    'C160': { type: 'transport', model: 'C-160 Transall', country: 'FR' },
    'C235': { type: 'transport', model: 'CN-235' },
    'C295': { type: 'transport', model: 'C-295' },
    'C5': { type: 'transport', model: 'C-5 Galaxy', country: 'US' },
    'C5M': { type: 'transport', model: 'C-5M Super Galaxy', country: 'US' },
    'A310': { type: 'transport', model: 'A310 MRTT' },
    'A320': { type: 'transport', model: 'A320 (VIP)' },
    'A330': { type: 'transport', model: 'A330' },

    // ─── Tankers ───
    'KC135': { type: 'tanker', model: 'KC-135 Stratotanker', country: 'US' },
    'KC10': { type: 'tanker', model: 'KC-10 Extender', country: 'US' },
    'KC46': { type: 'tanker', model: 'KC-46 Pegasus', country: 'US' },
    'A332': { type: 'tanker', model: 'A330 MRTT' },
    'MRTT': { type: 'tanker', model: 'A330 MRTT' },
    'A339': { type: 'tanker', model: 'A330 MRTT' },
    'VOYA': { type: 'tanker', model: 'Voyager (A330 MRTT)', country: 'GB' },

    // ─── AWACS / ISR ───
    'E3TF': { type: 'awacs', model: 'E-3F Sentry', country: 'FR' },
    'E3': { type: 'awacs', model: 'E-3 Sentry AWACS' },
    'E3A': { type: 'awacs', model: 'E-3A Sentry' },
    'E3B': { type: 'awacs', model: 'E-3B Sentry' },
    'E3C': { type: 'awacs', model: 'E-3C Sentry' },
    'E7': { type: 'awacs', model: 'E-7 Wedgetail' },
    'E8': { type: 'awacs', model: 'E-8 JSTARS' },
    'E2C': { type: 'awacs', model: 'E-2C Hawkeye' },
    'E2D': { type: 'awacs', model: 'E-2D Advanced Hawkeye' },
    'RC135': { type: 'awacs', model: 'RC-135 Rivet Joint' },
    'U2': { type: 'awacs', model: 'U-2 Dragon Lady', country: 'US' },

    // ─── Maritime patrol ───
    'ATL2': { type: 'patrol', model: 'Atlantique 2', country: 'FR' },
    'ATLA': { type: 'patrol', model: 'Atlantique 2', country: 'FR' },
    'P3': { type: 'patrol', model: 'P-3 Orion' },
    'P3C': { type: 'patrol', model: 'P-3C Orion' },
    'P8': { type: 'patrol', model: 'P-8 Poseidon' },
    'P8A': { type: 'patrol', model: 'P-8A Poseidon' },

    // ─── Helicopters ───
    'EC35': { type: 'helicopter', model: 'EC135' },
    'EC45': { type: 'helicopter', model: 'EC145' },
    'EC55': { type: 'helicopter', model: 'EC155' },
    'EC65': { type: 'helicopter', model: 'EC165' },
    'EC72': { type: 'helicopter', model: 'EC725 Caracal', country: 'FR' },
    'H225': { type: 'helicopter', model: 'H225M Caracal', country: 'FR' },
    'AS55': { type: 'helicopter', model: 'AS555 Fennec', country: 'FR' },
    'AS5': { type: 'helicopter', model: 'AS555 Fennec', country: 'FR' },
    'NH90': { type: 'helicopter', model: 'NH90 Caïman' },
    'SA33': { type: 'helicopter', model: 'SA330 Puma/Cougar' },
    'AS32': { type: 'helicopter', model: 'AS332 Super Puma' },
    'S70': { type: 'helicopter', model: 'S-70/UH-60 Black Hawk' },
    'H60': { type: 'helicopter', model: 'UH-60 Black Hawk', country: 'US' },
    'UH60': { type: 'helicopter', model: 'UH-60 Black Hawk', country: 'US' },
    'AH64': { type: 'helicopter', model: 'AH-64 Apache', country: 'US' },
    'CH47': { type: 'helicopter', model: 'CH-47 Chinook' },
    'V22': { type: 'helicopter', model: 'V-22 Osprey', country: 'US' },
    'TIGR': { type: 'helicopter', model: 'Tigre', country: 'FR' },
    'LYNX': { type: 'helicopter', model: 'Lynx' },
    'WILD': { type: 'helicopter', model: 'Wildcat', country: 'GB' },
    'MRN1': { type: 'helicopter', model: 'Merlin', country: 'GB' },

    // ─── Liaison ───
    'TBM': { type: 'liaison', model: 'TBM 700/900', country: 'FR' },
    'TBM7': { type: 'liaison', model: 'TBM 700', country: 'FR' },
    'TBM9': { type: 'liaison', model: 'TBM 900', country: 'FR' },
    'PC12': { type: 'liaison', model: 'PC-12' },
    'PC21': { type: 'trainer', model: 'PC-21' },
    'TUCA': { type: 'liaison', model: 'EMB-312 Tucano' },

    // ─── Trainers ───
    'ALPH': { type: 'trainer', model: 'Alpha Jet', country: 'FR' },
    'AJET': { type: 'trainer', model: 'Alpha Jet' },
    'HAWK': { type: 'trainer', model: 'BAE Hawk' },
    'T38': { type: 'trainer', model: 'T-38 Talon', country: 'US' },
    'T6': { type: 'trainer', model: 'T-6 Texan II', country: 'US' },
    'M346': { type: 'trainer', model: 'M-346 Master' },

    // ─── Drones / UAV ───
    'MQ9': { type: 'drone', model: 'MQ-9 Reaper', country: 'US' },
    'MQ1': { type: 'drone', model: 'MQ-1 Predator', country: 'US' },
    'RQ4': { type: 'drone', model: 'RQ-4 Global Hawk', country: 'US' },
    'HRON': { type: 'drone', model: 'Heron', country: 'IL' },
    'MALE': { type: 'drone', model: 'Eurodrone MALE', country: 'EU' },
    'ANKA': { type: 'drone', model: 'Anka', country: 'TR' },
    'TB2': { type: 'drone', model: 'Bayraktar TB2', country: 'TR' },
};

// Keep backwards compatibility alias
export const FRENCH_AIRCRAFT_TYPES = AIRCRAFT_TYPES;

// ═══════════════════════════════════════════════════════════════════════════
// SQUAWK CODES — Emergency and special transponder codes
// ═══════════════════════════════════════════════════════════════════════════

export interface SquawkAlert {
    code: string;
    type: 'emergency' | 'military' | 'special';
    severity: 'critical' | 'high' | 'info';
    description: string;
}

export const SPECIAL_SQUAWKS: Record<string, SquawkAlert> = {
    '7500': { code: '7500', type: 'emergency', severity: 'critical', description: 'HIJACK — Détournement en cours' },
    '7600': { code: '7600', type: 'emergency', severity: 'high', description: 'RADIO FAILURE — Panne radio' },
    '7700': { code: '7700', type: 'emergency', severity: 'critical', description: 'EMERGENCY — Urgence générale' },
    '7777': { code: '7777', type: 'military', severity: 'high', description: 'MILITARY INTERCEPT — Interception militaire' },
    '7000': { code: '7000', type: 'special', severity: 'info', description: 'VFR (Europe)' },
    '1200': { code: '1200', type: 'special', severity: 'info', description: 'VFR (USA)' },
    '2000': { code: '2000', type: 'special', severity: 'info', description: 'IFR sans code assigné' },
};

/**
 * Check if a squawk code indicates an emergency or special condition
 */
export function checkSquawk(squawk: string | undefined): SquawkAlert | undefined {
    if (!squawk) return undefined;
    return SPECIAL_SQUAWKS[squawk];
}

// ─── Operator labels for display ───
export const FRENCH_OPERATOR_LABELS: Record<FrenchMilitaryOperator, string> = {
    'armee-air': 'Armée de l\'Air et de l\'Espace',
    'marine': 'Marine Nationale',
    'gendarmerie': 'Gendarmerie Nationale',
    'alat': 'ALAT (Armée de Terre)',
    'securite-civile': 'Sécurité Civile',
    'douanes': 'Douanes & Droits Indirects',
    'unknown': 'Militaire (non identifié)',
};

// ─── Operator color identifiers for styling ───
export const FRENCH_OPERATOR_COLORS: Record<FrenchMilitaryOperator, string> = {
    'armee-air': '#4a9eff',   // bleu
    'marine': '#00d4c8',   // cyan
    'gendarmerie': '#a855f7',   // violet
    'alat': '#22c55e',   // vert
    'securite-civile': '#ff6b35',   // orange
    'douanes': '#eab308',   // jaune
    'unknown': '#9898a8',   // gris
};

// ─── Base-type labels ───
export const MILITARY_BASE_TYPE_LABELS: Record<string, string> = {
    'air': 'Base Aérienne',
    'navy': 'Base Navale',
    'army': 'Armée de Terre',
    'joint': 'Interarmées',
};

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

/**
 * Check if an ICAO hex code falls in known French military ranges.
 */
export function detectFrenchHex(hexCode: string): FrenchMilitaryOperator | undefined {
    const hex = hexCode.toUpperCase();
    for (const range of FRENCH_HEX_RANGES) {
        if (hex >= range.start && hex <= range.end) {
            return range.operator;
        }
    }
    return undefined;
}

/**
 * Check if an ICAO hex code falls in known Allied military ranges.
 */
export function detectAlliedHex(hexCode: string): AlliedHexRange | undefined {
    const hex = hexCode.toUpperCase();
    for (const range of ALLIED_HEX_RANGES) {
        if (hex >= range.start && hex <= range.end) {
            return range;
        }
    }
    return undefined;
}

/**
 * Identify aircraft type from ICAO type code.
 */
export function identifyFrenchAircraftType(typeCode: string): { type: FrenchAircraftType; model: string; country?: string } | undefined {
    if (!typeCode) return undefined;
    const normalized = typeCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return AIRCRAFT_TYPES[normalized];
}

/**
 * Enhanced aircraft info with allied detection + squawk alerts
 */
export interface EnhancedAircraftInfo {
    operator: FrenchMilitaryOperator;
    operatorLabel: string;
    aircraftType: FrenchAircraftType;
    aircraftModel?: string;
    confidence: 'high' | 'medium' | 'low';
    country?: string;
    branch?: string;
    isAllied?: boolean;
    squawkAlert?: SquawkAlert;
}

/**
 * Derive classification info for a given callsign + ICAO hex + type code + squawk.
 * Returns operator, aircraftType, confidence level, and squawk alerts.
 */
export function determineAircraftInfo(
    callsign: string,
    icao24: string,
    typeCode?: string,
    squawk?: string
): EnhancedAircraftInfo {
    // Check squawk first (critical alerts)
    const squawkAlert = checkSquawk(squawk);

    // 1. French callsign match → high confidence
    const frCallsign = identifyFrenchCallsign(callsign);
    if (frCallsign) {
        const typeInfo = typeCode ? identifyFrenchAircraftType(typeCode) : undefined;
        return {
            operator: frCallsign.operator,
            operatorLabel: FRENCH_OPERATOR_LABELS[frCallsign.operator],
            aircraftType: typeInfo?.type ?? frCallsign.aircraftType ?? 'unknown',
            aircraftModel: typeInfo?.model,
            confidence: 'high',
            country: 'FR',
            isAllied: false,
            squawkAlert,
        };
    }

    // 2. Allied callsign match → high confidence
    const alliedCallsign = identifyAlliedCallsign(callsign);
    if (alliedCallsign) {
        const typeInfo = typeCode ? identifyFrenchAircraftType(typeCode) : undefined;
        return {
            operator: 'unknown',
            operatorLabel: `${alliedCallsign.branch} (${alliedCallsign.country})`,
            aircraftType: typeInfo?.type ?? alliedCallsign.aircraftType ?? 'unknown',
            aircraftModel: typeInfo?.model,
            confidence: 'high',
            country: alliedCallsign.country,
            branch: alliedCallsign.branch,
            isAllied: true,
            squawkAlert,
        };
    }

    // 3. French hex range match → medium confidence
    const frHex = detectFrenchHex(icao24);
    if (frHex) {
        const typeInfo = typeCode ? identifyFrenchAircraftType(typeCode) : undefined;
        return {
            operator: frHex,
            operatorLabel: FRENCH_OPERATOR_LABELS[frHex],
            aircraftType: typeInfo?.type ?? 'unknown',
            aircraftModel: typeInfo?.model,
            confidence: 'medium',
            country: 'FR',
            isAllied: false,
            squawkAlert,
        };
    }

    // 4. Allied hex range match → medium confidence
    const alliedHex = detectAlliedHex(icao24);
    if (alliedHex) {
        const typeInfo = typeCode ? identifyFrenchAircraftType(typeCode) : undefined;
        return {
            operator: 'unknown',
            operatorLabel: `${alliedHex.branch} (${alliedHex.country})`,
            aircraftType: typeInfo?.type ?? 'unknown',
            aircraftModel: typeInfo?.model,
            confidence: 'medium',
            country: alliedHex.country,
            branch: alliedHex.branch,
            isAllied: true,
            squawkAlert,
        };
    }

    // 5. Type code only → low confidence
    const typeInfo = typeCode ? identifyFrenchAircraftType(typeCode) : undefined;
    if (typeInfo) {
        return {
            operator: 'unknown',
            operatorLabel: FRENCH_OPERATOR_LABELS['unknown'],
            aircraftType: typeInfo.type,
            aircraftModel: typeInfo.model,
            confidence: 'low',
            country: typeInfo.country,
            squawkAlert,
        };
    }

    // 6. Fallback
    return {
        operator: 'unknown',
        operatorLabel: FRENCH_OPERATOR_LABELS['unknown'],
        aircraftType: 'unknown',
        confidence: 'low',
        squawkAlert,
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// AIRCRAFT TYPE COLORS — For map icons by aircraft type
// ═══════════════════════════════════════════════════════════════════════════

export const AIRCRAFT_TYPE_COLORS: Record<FrenchAircraftType, string> = {
    'fighter': '#ff3b30',      // Rouge - chasseur
    'transport': '#4a9eff',    // Bleu - transport
    'tanker': '#ff9500',       // Orange - ravitailleur
    'awacs': '#a855f7',        // Violet - AWACS/ISR
    'patrol': '#00d4c8',       // Cyan - patrouille maritime
    'helicopter': '#22c55e',   // Vert - hélicoptère
    'trainer': '#ffcc00',      // Jaune - entraînement
    'drone': '#ff6b9d',        // Rose - drone/UAV
    'liaison': '#9898a8',      // Gris - liaison
    'unknown': '#9898a8',      // Gris - inconnu
};

// ═══════════════════════════════════════════════════════════════════════════
// SURGE DETECTION — Detect unusual military activity concentration
// ═══════════════════════════════════════════════════════════════════════════

export interface MilitarySurge {
    type: 'concentration' | 'high_value' | 'emergency';
    severity: 'info' | 'warning' | 'alert';
    description: string;
    location?: { lat: number; lon: number };
    radius?: number;  // km
    flightCount?: number;
    flightTypes?: FrenchAircraftType[];
}

/** Thresholds for surge detection */
const SURGE_THRESHOLDS = {
    // Min flights in 50km radius to trigger concentration alert
    CONCENTRATION_MIN: 5,
    CONCENTRATION_RADIUS_KM: 50,
    // High-value assets (AWACS, tankers) count
    HIGH_VALUE_MIN: 2,
    // Fighter concentration (possible exercise or response)
    FIGHTER_CONCENTRATION_MIN: 3,
};

/**
 * Detect military activity surges from current flight data
 */
export function detectMilitarySurges(flights: Array<{
    latitude: number;
    longitude: number;
    aircraftType?: FrenchAircraftType;
    squawkAlert?: { severity: string };
}>): MilitarySurge[] {
    const surges: MilitarySurge[] = [];
    if (flights.length < 3) return surges;

    // 1. Check for emergency squawks
    const emergencies = flights.filter(f => f.squawkAlert?.severity === 'critical');
    if (emergencies.length > 0) {
        surges.push({
            type: 'emergency',
            severity: 'alert',
            description: `${emergencies.length} avion(s) en situation d'urgence (squawk 7500/7700)`,
            flightCount: emergencies.length,
        });
    }

    // 2. Check for high-value asset concentration (AWACS, tankers)
    const highValue = flights.filter(f =>
        f.aircraftType === 'awacs' || f.aircraftType === 'tanker'
    );
    if (highValue.length >= SURGE_THRESHOLDS.HIGH_VALUE_MIN) {
        surges.push({
            type: 'high_value',
            severity: 'warning',
            description: `${highValue.length} assets haute valeur actifs (AWACS/ravitailleurs)`,
            flightCount: highValue.length,
            flightTypes: ['awacs', 'tanker'],
        });
    }

    // 3. Check for fighter concentration
    const fighters = flights.filter(f => f.aircraftType === 'fighter');
    if (fighters.length >= SURGE_THRESHOLDS.FIGHTER_CONCENTRATION_MIN) {
        // Find centroid of fighters
        const centroid = {
            lat: fighters.reduce((s, f) => s + f.latitude, 0) / fighters.length,
            lon: fighters.reduce((s, f) => s + f.longitude, 0) / fighters.length,
        };
        surges.push({
            type: 'concentration',
            severity: 'warning',
            description: `${fighters.length} chasseurs concentrés`,
            location: centroid,
            radius: SURGE_THRESHOLDS.CONCENTRATION_RADIUS_KM,
            flightCount: fighters.length,
            flightTypes: ['fighter'],
        });
    }

    // 4. Check for general concentration (any type)
    // Simple grid-based clustering
    const gridSize = 1; // 1 degree ≈ 111km
    const grid = new Map<string, typeof flights>();
    for (const f of flights) {
        const key = `${Math.floor(f.latitude / gridSize)},${Math.floor(f.longitude / gridSize)}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key)!.push(f);
    }

    for (const [key, cellFlights] of grid) {
        if (cellFlights.length >= SURGE_THRESHOLDS.CONCENTRATION_MIN) {
            const [latIdx, lonIdx] = key.split(',').map(Number);
            const centerLat = (latIdx + 0.5) * gridSize;
            const centerLon = (lonIdx + 0.5) * gridSize;

            // Avoid duplicating fighter concentration
            const nonFighters = cellFlights.filter(f => f.aircraftType !== 'fighter');
            if (nonFighters.length >= 3 || cellFlights.length >= SURGE_THRESHOLDS.CONCENTRATION_MIN + 2) {
                surges.push({
                    type: 'concentration',
                    severity: 'info',
                    description: `${cellFlights.length} aéronefs militaires dans la zone`,
                    location: { lat: centerLat, lon: centerLon },
                    radius: gridSize * 111 / 2,
                    flightCount: cellFlights.length,
                });
            }
        }
    }

    return surges;
}

export const MILITARY_BASES: MilitaryBase[] = [
    // Bases aériennes (Armée de l'Air et de l'Espace)
    {
        id: 'BA-105',
        name: 'BA 105 Évreux-Fauville',
        type: 'air',
        coordinates: [1.2197, 49.0286], // LFOE
        description: 'Escadre de transport, opérations spéciales.'
    },
    {
        id: 'BA-125',
        name: 'BA 125 Istres-Le Tubé',
        type: 'air',
        coordinates: [4.9242, 43.5233], // LFMI
        description: 'Hub logistique principal, essais en vol, dissuasion.'
    },
    {
        id: 'BA-118',
        name: 'BA 118 Mont-de-Marsan',
        type: 'air',
        coordinates: [-0.5058, 43.9131], // LFBM
        description: 'Chasseurs Rafale, centre d\'expérimentations.'
    },
    {
        id: 'BA-702',
        name: 'BA 702 Avord',
        type: 'air',
        coordinates: [2.6333, 47.0500], // LFOA
        description: 'AWACS, transport nucléaire.'
    },
    {
        id: 'BA-113',
        name: 'BA 113 Saint-Dizier',
        type: 'air',
        coordinates: [4.8992, 48.6364], // LFSI
        description: 'Dissuasion nucléaire (Rafale).'
    },
    {
        id: 'BA-133',
        name: 'BA 133 Nancy-Ochey',
        type: 'air',
        coordinates: [5.9525, 48.5830], // LFSO
        description: 'Escadre de chasse (Mirage 2000D).'
    },

    // Bases Navales (Marine Nationale)
    {
        id: 'BN-TLN',
        name: 'Base navale de Toulon',
        type: 'navy',
        coordinates: [5.9189, 43.1190],
        description: 'Port d\'attache du Porte-Avions Charles-de-Gaulle, sous-marins nucléaires d\'attaque.'
    },
    {
        id: 'BN-BRE',
        name: 'Base navale de Brest',
        type: 'navy',
        coordinates: [-4.5000, 48.3758],
        description: 'Sous-marins nucléaires lanceurs d\'engins (Île Longue), frégates.'
    },
    {
        id: 'BN-CHE',
        name: 'Base navale de Cherbourg',
        type: 'navy',
        coordinates: [-1.6375, 49.6508],
        description: 'Base de la Manche, patrouilleurs.'
    },

    // Armée de Terre / Interarmées
    {
        id: 'BT-MML',
        name: 'Mourmelon-le-Grand',
        type: 'army',
        coordinates: [4.3644, 49.1367],
        description: 'Camp militaire de Mourmelon, entraînement blindés.'
    },
    {
        id: 'BT-CNS',
        name: 'Camp de Canjuers',
        type: 'army',
        coordinates: [6.3267, 43.7225],
        description: 'Plus grand camp d\'entraînement d\'Europe occidentale.'
    },
    {
        id: 'BA-103',
        name: 'BA 103 Cambrai',
        type: 'air',
        coordinates: [3.1522, 50.2211],
        description: 'Escadre de chasse (Mirage 2000-5).'
    },
    {
        id: 'BA-115',
        name: 'BA 115 Orange-Caritat',
        type: 'air',
        coordinates: [4.8672, 44.1403],
        description: 'Rafale Marine, escadre de chasse.'
    },
    {
        id: 'BA-120',
        name: 'BA 120 Cazaux',
        type: 'air',
        coordinates: [-1.1250, 44.5328],
        description: 'Centre d\'instruction des équipages de chasse, école de l\'aviation de chasse.'
    },
    {
        id: 'BN-LAN',
        name: 'Base aéronavale de Lann-Bihoué',
        type: 'navy',
        coordinates: [-3.4667, 47.7606],
        description: 'Patrouille maritime Atlantique 2, surveillance Atlantique.'
    },
    {
        id: 'BN-HYE',
        name: 'Base aéronavale de Hyères',
        type: 'navy',
        coordinates: [6.1467, 43.0967],
        description: 'Hélicoptères navals, flotille de Méditerranée.'
    },

    // ─── DROM — Antilles ───
    {
        id: 'DROM-MAR-971',
        name: 'Fort-de-France (Martinique)',
        type: 'joint',
        coordinates: [-61.0631, 14.6137],
        description: 'Forces Armées aux Antilles — Régiment du Service Militaire Adapté, marines.'
    },
    {
        id: 'DROM-GUA-971',
        name: 'Abymes – Pointe-à-Pitre (Guadeloupe)',
        type: 'joint',
        coordinates: [-61.5181, 16.2578],
        description: 'Forces Armées aux Antilles — détachement Guadeloupe.'
    },

    // ─── DROM — Guyane ───
    {
        id: 'DROM-GUF-CSG',
        name: 'Base de Cayenne (Guyane)',
        type: 'air',
        coordinates: [-52.3653, 4.8228],
        description: 'Forces Armées en Guyane — surveillance espace guyanais, CSG.'
    },

    // ─── DOM — La Réunion ───
    {
        id: 'DROM-REU-REU',
        name: 'FAZSOI – La Réunion',
        type: 'joint',
        coordinates: [55.5364, -20.9022],
        description: 'Forces Armées dans la Zone Sud de l\'Océan Indien — base navale La Réunion.'
    },

    // ─── COM — Mayotte ───
    {
        id: 'DROM-MYT-MYT',
        name: 'Dzaoudzi (Mayotte)',
        type: 'navy',
        coordinates: [45.2569, -12.7871],
        description: 'Détachement Marine Nationale Mayotte — patrouilleur, lutte contre l\'immigration.'
    },

    // ─── COM — Polynésie Française ───
    {
        id: 'DROM-PF-FAA',
        name: 'Faa\'a (Polynésie Française)',
        type: 'joint',
        coordinates: [-149.6067, -17.5536],
        description: 'Forces Armées Polynésie Française — base navale Papeete, patrouilleurs.'
    },

    // ─── COM — Nouvelle-Calédonie ───
    {
        id: 'DROM-NC-NOK',
        name: 'Nouméa (Nouvelle-Calédonie)',
        type: 'joint',
        coordinates: [166.4414, -22.2558],
        description: 'Forces Armées Nouvelle-Calédonie — base navale Nouméa, patrouilleurs.'
    },

    // ─── COM — Djibouti ───
    {
        id: 'DROM-DJI',
        name: 'Camp Lemonnier (Djibouti)',
        type: 'joint',
        coordinates: [43.1547, 11.5483],
        description: 'Forces Françaises à Djibouti — base permanente de projection.'
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
