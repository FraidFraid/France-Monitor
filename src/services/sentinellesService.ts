/**
 * Service de haut niveau pour le calcul et l'exposition 
 * des données Sentinelles dans FranceMonitor.
 */
import { fetchIncidence, type SentinellesIncidenceRecord } from '../api/sentinellesApiClient.ts';

// Les IDs des indicateurs les plus communs sur Sentiweb.
// On peut les retrouver via /indicators
export const SENTINELLES_INDICATORS = {
    INFLUENZA_ID: 3,          // Syndromes grippaux
    ACUTE_DIARRHEA_ID: 6,     // Diarrhées aiguës
    CHICKENPOX_ID: 7,         // Varicelle
    IRA_ID: 25,               // Infections respiratoires aiguës (IRA)[web:7]
    ASTHMA_ID: 10,            // Crises d'asthme[web:54]
} as const;

/**
 * Récupère l'incidence au niveau national
 */
export async function getNationalIncidence(
    indicatorId: number,
    span: 'last' | 'short' = 'last'
): Promise<SentinellesIncidenceRecord[]> {
    return await fetchIncidence(indicatorId, 'PAY', span);
}

/**
 * Récupère l'incidence au niveau régional (ou RDD si dispo)
 */
export async function getRegionalIncidence(
    indicatorId: number,
    span: 'last' | 'short' = 'last'
): Promise<SentinellesIncidenceRecord[]> {
    // RDD (départemental) n'est pas toujours riche, REG est plus sûr.
    // On utilise REG par défaut pour l'agrégation.
    return await fetchIncidence(indicatorId, 'REG', span);
}

// ─── Calcul du Baromètre Sentinelles ───────────────────────────────────────

export interface SentinellesBarometerInput {
    influenza: SentinellesIncidenceRecord[];   // geo=PAY, span=last
    diarrhea: SentinellesIncidenceRecord[];
    chickenpox: SentinellesIncidenceRecord[];
    ira?: SentinellesIncidenceRecord[];       // optionnels pour rester compatible
    asthma?: SentinellesIncidenceRecord[];
}

export interface SentinellesBarometerScore {
    score: number; // 0–100
    details: {
        influenzaInc100: number;
        diarrheaInc100: number;
        chickenpoxInc100: number;
        iraInc100?: number;
        asthmaInc100?: number;
    };
}

export interface SentinellesNationalIndicatorSnapshot {
    code: string;
    label: string;
    nationalIncidence: number;
    trend?: number;
}

/**
 * Valeurs de référence "hautes" pour normaliser sur 0-100.
 * Si l'incidence atteint ce niveau, le score pour cet indicateur vaudra ~100.
 * Ces références sont empiriques.
 */
const THRESHOLDS = {
    influenza: 400,
    diarrhea: 350,
    chickenpox: 50,
    ira: 400,    // à ajuster selon ton feeling / les bulletins IRA[web:6][web:15]
    asthma: 80,  // idem, seuil indicatif[web:54]
};

function clamp(v: number, min = 0, max = 100): number {
    return Math.max(min, Math.min(max, v));
}

/**
 * Calcule un sous-indice Réseau Sentinelles (0-100)
 */
export function computeSentinellesBarometer(
    input: SentinellesBarometerInput
): SentinellesBarometerScore {
    // On prend la première valeur disponible (en principe la plus récente si span="last")
    const flu = input.influenza.length > 0 ? input.influenza[0].inc100 : 0;
    const dia = input.diarrhea.length > 0 ? input.diarrhea[0].inc100 : 0;
    const chi = input.chickenpox.length > 0 ? input.chickenpox[0].inc100 : 0;
    const ira = input.ira && input.ira.length > 0 ? input.ira[0].inc100 : 0;
    const ast = input.asthma && input.asthma.length > 0 ? input.asthma[0].inc100 : 0;

    // Normalisation sur 0-100 par rapport aux seuils empiriques d'épidémie
    const normFlu = clamp((flu / THRESHOLDS.influenza) * 100);
    const normDia = clamp((dia / THRESHOLDS.diarrhea) * 100);
    const normChi = clamp((chi / THRESHOLDS.chickenpox) * 100);
    const normIra = clamp((ira / THRESHOLDS.ira) * 100);
    const normAst = clamp((ast / THRESHOLDS.asthma) * 100);

    // Pondération (somme ≈ 1)
    // Grippe 40%, Diarrhées 25%, IRA 20%, Asthme 10%, Varicelle 5%
    let score =
        normFlu * 0.4 +
        normDia * 0.25 +
        normIra * 0.2 +
        normAst * 0.1 +
        normChi * 0.05;

    return {
        score: Math.round(score * 10) / 10,
        details: {
            influenzaInc100: Math.round(flu * 10) / 10,
            diarrheaInc100: Math.round(dia * 10) / 10,
            chickenpoxInc100: Math.round(chi * 10) / 10,
            iraInc100: Math.round(ira * 10) / 10,
            asthmaInc100: Math.round(ast * 10) / 10,
        },
    };
}

/**
 * Variante légère qui réutilise les indicateurs nationaux déjà agrégés
 * par le backend pour éviter des appels Sentiweb supplémentaires.
 */
export function computeSentinellesBarometerFromIndicators(
    indicators: SentinellesNationalIndicatorSnapshot[]
): SentinellesBarometerScore {
    const byCode = new Map(indicators.map((indicator) => [indicator.code, indicator]));

    const flu = byCode.get('grippe')?.nationalIncidence ?? 0;
    const dia = byCode.get('diarrhee')?.nationalIncidence ?? 0;
    const chi = byCode.get('varicelle')?.nationalIncidence ?? 0;
    const ira = byCode.get('ira')?.nationalIncidence ?? 0;
    const ast = byCode.get('asthme')?.nationalIncidence ?? 0;

    const normFlu = clamp((flu / THRESHOLDS.influenza) * 100);
    const normDia = clamp((dia / THRESHOLDS.diarrhea) * 100);
    const normChi = clamp((chi / THRESHOLDS.chickenpox) * 100);
    const normIra = clamp((ira / THRESHOLDS.ira) * 100);
    const normAst = clamp((ast / THRESHOLDS.asthma) * 100);

    const score =
        normFlu * 0.4 +
        normDia * 0.25 +
        normIra * 0.2 +
        normAst * 0.1 +
        normChi * 0.05;

    return {
        score: Math.round(score * 10) / 10,
        details: {
            influenzaInc100: Math.round(flu * 10) / 10,
            diarrheaInc100: Math.round(dia * 10) / 10,
            chickenpoxInc100: Math.round(chi * 10) / 10,
            iraInc100: Math.round(ira * 10) / 10,
            asthmaInc100: Math.round(ast * 10) / 10,
        },
    };
}
