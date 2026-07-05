/**
 * health-barometer.ts — Calcul des sous-indices nationaux de santé
 *
 * Synthetise les données APL, ISS, OSCOUR et ANSM en un baromètre
 * national avec un score global 0–100 et 4 sous-indices.
 *
 * PONDÉRATIONS CONFIGURABLES :
 *   Ajuster les poids dans BAROMETER_WEIGHTS ci-dessous.
 */

import type { HealthDepartmentMetric, HealthFeatures } from '../types/index.ts';
import type { SentinellesBarometerScore } from './sentinellesService.ts';
import type { IconName } from '../components/shared/icons.ts';

// ─── Config ─────────────────────────────────────────────────────────────────

/** Poids pour le score global (doit sommer à 1) */
export const BAROMETER_WEIGHTS = {
    stressHospitalier: 0.30,
    pressureUrgences: 0.25,
    fragiliteMedicale: 0.15,
    tensionMedicaments: 0.15,
    reseauSentinelles: 0.15,
} as const;

// Population approximative par département (INSEE 2023, ~milliers)
// Utilisée pour la pondération des sous-indices nationaux
const DEP_POPULATION: Record<string, number> = {
    '01': 660, '02': 520, '03': 335, '04': 167, '05': 142,
    '06': 1093, '07': 328, '08': 270, '09': 153, '10': 310,
    '11': 377, '12': 281, '13': 2055, '14': 697, '15': 145,
    '16': 350, '17': 641, '18': 302, '19': 236, '2A': 168,
    '2B': 185, '21': 535, '22': 604, '23': 112, '24': 412,
    '25': 543, '26': 512, '27': 597, '28': 438, '29': 911,
    '30': 745, '31': 1395, '32': 190, '33': 1611, '34': 1161,
    '35': 1049, '36': 220, '37': 611, '38': 1266, '39': 266,
    '40': 407, '41': 335, '42': 768, '43': 229, '44': 1430,
    '45': 675, '46': 174, '47': 332, '48': 77, '49': 796,
    '50': 494, '51': 576, '52': 173, '53': 307, '54': 742,
    '55': 182, '56': 749, '57': 1038, '58': 208, '59': 2607,
    '60': 828, '61': 275, '62': 1472, '63': 652, '64': 685,
    '65': 228, '66': 479, '67': 1121, '68': 777, '69': 1836,
    '70': 234, '71': 553, '72': 567, '73': 440, '74': 831,
    '75': 2161, '76': 1257, '77': 1421, '78': 1436, '79': 375,
    '80': 570, '81': 391, '82': 258, '83': 1084, '84': 553,
    '85': 680, '86': 437, '87': 369, '88': 371, '89': 333,
    '90': 161, '91': 1293, '92': 1614, '93': 1648, '94': 1368,
    '95': 1234, '971': 374, '972': 352, '973': 290, '974': 866, '976': 310,
};

// ─── Types publics ────────────────────────────────────────────────────────────

export interface HealthBarometerSubIndex {
    /** Valeur 0–100 */
    value: number;
    /** Libellé display */
    label: string;
    /** Icône Lucide (rendue via `fmIcon`) */
    icon: IconName;
    /** Description courte du calcul */
    description: string;
    /** Variation par rapport à la valeur précédente (si connue) */
    delta?: number;
}

export interface HealthBarometerMetrics {
    /** Score global 0–100 (somme pondérée des sous-indices) */
    globalScore: number;
    /** Niveau qualitatif */
    level: 'serenite' | 'vigilance' | 'alerte' | 'crise';
    /** Couleur hex correspondant au niveau */
    levelColor: string;
    /** Libellé niveau */
    levelLabel: string;

    subIndices: {
        stressHospitalier: HealthBarometerSubIndex;
        pressureUrgences: HealthBarometerSubIndex;
        fragiliteMedicale: HealthBarometerSubIndex;
        tensionMedicaments: HealthBarometerSubIndex;
        reseauSentinelles: HealthBarometerSubIndex;
    };

    /** Timestamp du calcul */
    computedAt: Date;
    /** Quantité de départements utilisés */
    departmentsUsed: number;
    /** Statut synthétique de fraîcheur / disponibilité des sources */
    dataTruthLabel: 'TEMPS RÉEL' | 'CACHE FIGÉ' | 'INDISPONIBLE';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, min = 0, max = 100): number {
    return Math.max(min, Math.min(max, v));
}

function scoreToLevel(score: number): HealthBarometerMetrics['level'] {
    if (score < 25) return 'serenite';
    if (score < 50) return 'vigilance';
    if (score < 75) return 'alerte';
    return 'crise';
}

const LEVEL_COLORS: Record<string, string> = {
    serenite: '#2ECC71',
    vigilance: '#F1C40F',
    alerte: '#E67E22',
    crise: '#E74C3C',
};

const LEVEL_LABELS: Record<string, string> = {
    serenite: 'Sérénité',
    vigilance: 'Vigilance',
    alerte: 'Alerte',
    crise: 'Crise',
};

// ─── Calcul des sous-indices ─────────────────────────────────────────────────

/**
 * Sous-indice 1 : Stress Hospitalier
 * Moyenne pondérée (par population) de l'ISS 0–100 par département.
 */
function computeStressHospitalier(departments: HealthDepartmentMetric[]): number {
    let weightedSum = 0;
    let totalPop = 0;
    for (const d of departments) {
        const pop = DEP_POPULATION[d.depCode] ?? 200;
        weightedSum += d.iss * pop;
        totalPop += pop;
    }
    return totalPop > 0 ? clamp(weightedSum / totalPop) : 0;
}

/**
 * Sous-indice 2 : Pression Urgences / Épidémies
 * Pour chaque département, on prend le max des hausses OSCOUR (trendPct).
 * Puis on fait la médiane pondérée par pop et on normalise [0, 100] :
 *   0 % hausse → 0, +100 % hausse → 100
 */
function computePressureUrgences(departments: HealthDepartmentMetric[]): number {
    let weightedSum = 0;
    let totalPop = 0;
    for (const d of departments) {
        if (d.topMotifs.length === 0) continue;
        const maxTrend = Math.max(...d.topMotifs.map(m => m.trendPct));
        const normalised = clamp(maxTrend * 100, 0, 100);
        const pop = DEP_POPULATION[d.depCode] ?? 200;
        weightedSum += normalised * pop;
        totalPop += pop;
    }
    return totalPop > 0 ? clamp(weightedSum / totalPop) : 0;
}

/**
 * Sous-indice 3 : Fragilité médicale (déserts médicaux)
 * Part de population dans des dpts APL 'fragile' ou 'desert', normalisée.
 * 100 % fragile/désert → 100 ; 0 % → 0.
 */
function computeFragiliteMedicale(departments: HealthDepartmentMetric[]): number {
    let fragPop = 0;
    let totalPop = 0;
    for (const d of departments) {
        const pop = DEP_POPULATION[d.depCode] ?? 200;
        totalPop += pop;
        if (d.aplCategory === 'fragile' || d.aplCategory === 'desert') {
            fragPop += pop;
        }
    }
    if (totalPop === 0) return 0;
    // Normaliser : 100 % → 100 (cas théorique impossible) ; réaliste max ~40 %
    // On amplifie pour que 30–40 % = ~75–100 sur l'échelle
    return clamp((fragPop / totalPop) * 250);
}

/**
 * Sous-indice 4 : Tension Médicaments
 * (ruptures + tensions) / (ruptures + tensions + normalisations + ε) × 100
 */
function computeTensionMedicaments(features: HealthFeatures): number {
    const { rupture, tension, normalisation } = features.drugShortagesByStatus;
    const critical = rupture + tension;
    const total = critical + normalisation;
    if (total === 0) return 0;
    return clamp((critical / total) * 100);
}

// ─── Calcul principal ─────────────────────────────────────────────────────────

export function computeHealthBarometer(
    departments: HealthDepartmentMetric[],
    healthFeatures: HealthFeatures,
    previousMetrics?: HealthBarometerMetrics,
    sentinellesScore?: SentinellesBarometerScore
): HealthBarometerMetrics {
    const sh = computeStressHospitalier(departments);
    const pu = computePressureUrgences(departments);
    const fm = computeFragiliteMedicale(departments);
    const tm = computeTensionMedicaments(healthFeatures);
    const rs = sentinellesScore?.score ?? 0;

    const w = BAROMETER_WEIGHTS;

    // On re-pondère si sentinellesScore n'est pas encore disponible
    // pour éviter de plomber le score avec un indice à 0.
    const usedSentinellesWeight = sentinellesScore ? w.reseauSentinelles : 0;
    const totalWeight = w.stressHospitalier + w.pressureUrgences + w.fragiliteMedicale + w.tensionMedicaments + usedSentinellesWeight;

    const gs = clamp(
        (w.stressHospitalier * sh +
            w.pressureUrgences * pu +
            w.fragiliteMedicale * fm +
            w.tensionMedicaments * tm +
            usedSentinellesWeight * rs) / totalWeight
    );

    const level = scoreToLevel(gs);
    const sourceStates = Object.values(healthFeatures.sourceStatus);
    const dataTruthLabel: HealthBarometerMetrics['dataTruthLabel'] = sourceStates.every((status) => status === 'ok')
        ? 'TEMPS RÉEL'
        : sourceStates.some((status) => status === 'ok' || status === 'stale')
            ? 'CACHE FIGÉ'
            : 'INDISPONIBLE';

    // Deltas vs calcul précédent
    const prevSubs = previousMetrics?.subIndices;
    const delta = (prev: HealthBarometerSubIndex | undefined, curr: number) =>
        prev != null ? Math.round((curr - prev.value) * 10) / 10 : undefined;

    return {
        globalScore: Math.round(gs * 10) / 10,
        level,
        levelColor: LEVEL_COLORS[level],
        levelLabel: LEVEL_LABELS[level],
        subIndices: {
            stressHospitalier: {
                value: Math.round(sh * 10) / 10,
                label: 'Stress hospitalier',
                icon: 'hospital',
                description: 'Moyenne pondérée pop. des ISS départementaux',
                delta: delta(prevSubs?.stressHospitalier, sh),
            },
            pressureUrgences: {
                value: Math.round(pu * 10) / 10,
                label: 'Pression urgences',
                icon: 'siren',
                description: 'Hausse max des motifs OSCOUR / SOS Médecins, par pop.',
                delta: delta(prevSubs?.pressureUrgences, pu),
            },
            fragiliteMedicale: {
                value: Math.round(fm * 10) / 10,
                label: 'Déserts médicaux',
                icon: 'stethoscope',
                description: 'Part pop. en zones APL fragile ou désert',
                delta: delta(prevSubs?.fragiliteMedicale, fm),
            },
            tensionMedicaments: {
                value: Math.round(tm * 10) / 10,
                label: 'Tension médicaments',
                icon: 'pill',
                description: 'Ratio ruptures+tensions / total ANSM',
                delta: delta(prevSubs?.tensionMedicaments, tm),
            },
            reseauSentinelles: {
                value: Math.round(rs * 10) / 10,
                label: 'Réseau Sentinelles',
                icon: 'dna',
                description: 'Incidences de grippe, diarrhées, varicelle',
                delta: delta(prevSubs?.reseauSentinelles, rs),
            },
        },
        computedAt: new Date(),
        departmentsUsed: departments.length,
        dataTruthLabel,
    };
}
