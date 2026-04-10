/**
 * classifier.ts — Classification des menaces par mots-clés.
 * Phase 2 : keyword-based. Phase 3 : ML (transformers.js).
 * Pattern WorldMonitor : confidence score + source tagging.
 *
 * Mitigation PQR : Exige 2 entités nommées (Lieu + Institution) pour valider
 * les faits divers et éviter le bruit excessif de la presse locale.
 */

import type { ThreatClassification, EventCategory, ThreatLevel } from '../types/index.ts';

// ─── Entités Nommées pour Mitigation Bruit PQR ───

/**
 * Institutions / Organisations / Infrastructure critique
 * Leur présence dans un titre renforce la pertinence stratégique.
 */
const INSTITUTIONS = [
    // Gouvernement & État
    'élysée', 'matignon', 'assemblée nationale', 'sénat', 'conseil d\'état',
    'préfecture', 'sous-préfecture', 'mairie', 'conseil régional', 'conseil départemental',
    'ministère', 'ministre', 'gouvernement', 'président', 'premier ministre',
    // Justice & Sécurité
    'police', 'gendarmerie', 'tribunal', 'cour d\'appel', 'parquet', 'procureur',
    'douane', 'dgsi', 'dgse', 'raid', 'gign', 'bri',
    // Infrastructure critique
    'centrale nucléaire', 'edf', 'rte', 'enedis', 'grdf', 'sncf', 'ratp',
    'aéroport', 'port', 'autoroute', 'hôpital', 'chu', 'aphp', 'samu',
    'école', 'lycée', 'collège', 'université', 'fac',
    // Grandes entreprises & industrie
    'total', 'totalenergies', 'airbus', 'safran', 'thales', 'dassault', 'naval group',
    'renault', 'stellantis', 'peugeot', 'citroën', 'michelin', 'arcelormittal',
    'carrefour', 'auchan', 'leclerc', 'amazon', 'la poste', 'orange',
    // Syndicats & mouvements
    'cgt', 'cfdt', 'fo', 'sud', 'unsa', 'gilets jaunes', 'black bloc',
    // Médias nationaux
    'france télévisions', 'tf1', 'bfm', 'cnews', 'france inter', 'rtl', 'europe 1',
];

/**
 * Lieux génériques qui renforcent le contexte (hors villes spécifiques)
 * Les villes sont gérées par le géocodeur, ici on cible les types de lieux.
 */
const LOCATION_TYPES = [
    // Voies majeures
    'autoroute', 'nationale', 'départementale', 'périphérique', 'rocade', 'boulevard',
    'gare', 'aéroport', 'port', 'quai',
    // Lieux publics
    'place', 'centre-ville', 'quartier', 'cité', 'banlieue', 'zone industrielle', 'zi',
    'centre commercial', 'stade', 'parc', 'jardin',
    // Régions / Territoires (génériques)
    'ile-de-france', 'paca', 'grand est', 'hauts-de-france', 'occitanie',
    'bretagne', 'normandie', 'nouvelle-aquitaine', 'auvergne-rhône-alpes',
    'bourgogne-franche-comté', 'pays de la loire', 'centre-val de loire', 'corse',
    // DOM-TOM
    'guadeloupe', 'martinique', 'guyane', 'réunion', 'mayotte',
    'nouvelle-calédonie', 'polynésie', 'wallis', 'futuna', 'saint-martin', 'saint-barthélemy',
];

/**
 * Mots-clés de faits divers locaux à filtrer sauf si contexte stratégique.
 * Ces termes seuls ne suffisent pas — il faut Lieu + Institution.
 */
const FAITS_DIVERS_KEYWORDS = [
    'cambriolage', 'vol', 'interpellation', 'garde à vue', 'délinquance',
    'trafic de drogue', 'stupéfiants', 'fait divers', 'dégradation', 'vandalisme',
    'bagarre', 'rixe', 'agression', 'vol à l\'arraché', 'vol à la tire',
    'rodéo', 'incivilité', 'tapage', 'ivresse', 'outrage',
];

export interface EntityDetectionResult {
    hasInstitution: boolean;
    hasLocation: boolean;
    institutionsFound: string[];
    locationsFound: string[];
    entityCount: number;
}

/**
 * Détecte les entités nommées (Institutions + Lieux) dans un texte.
 * Utilisé pour filtrer le bruit PQR.
 */
export function detectEntities(text: string): EntityDetectionResult {
    const normalizedText = text.toLowerCase();

    const institutionsFound: string[] = [];
    const locationsFound: string[] = [];

    // Chercher les institutions avec word boundaries
    for (const inst of INSTITUTIONS) {
        const regex = new RegExp(`\\b${inst}\\b`, 'i');
        if (regex.test(normalizedText)) {
            institutionsFound.push(inst);
        }
    }

    // Chercher les types de lieux
    for (const loc of LOCATION_TYPES) {
        const regex = new RegExp(`\\b${loc}\\b`, 'i');
        if (regex.test(normalizedText)) {
            locationsFound.push(loc);
        }
    }

    return {
        hasInstitution: institutionsFound.length > 0,
        hasLocation: locationsFound.length > 0,
        institutionsFound,
        locationsFound,
        entityCount: institutionsFound.length + locationsFound.length,
    };
}

/**
 * Vérifie si un texte est un "fait divers" sans contexte stratégique.
 * Retourne true si c'est du bruit à filtrer.
 *
 * Règles de filtrage :
 * - Institution présente → stratégique (préfecture, SNCF, EDF, etc.)
 * - Lieu seul (quartier, place) → pas stratégique → bruit
 * - Lieu + Institution → stratégique
 */
export function isFaitDiversNoise(text: string): boolean {
    const normalizedText = text.toLowerCase();

    // Vérifie si le texte contient des mots-clés de fait divers
    let hasFaitDiversKeyword = false;
    for (const kw of FAITS_DIVERS_KEYWORDS) {
        if (normalizedText.includes(kw)) {
            hasFaitDiversKeyword = true;
            break;
        }
    }

    if (!hasFaitDiversKeyword) {
        return false; // Pas un fait divers, pas de filtrage
    }

    // C'est un fait divers — vérifie s'il a du contexte stratégique
    const entities = detectEntities(normalizedText);

    // Une institution seule suffit à rendre l'événement stratégique
    // (ex: "cambriolage préfecture" ou "vol SNCF")
    if (entities.hasInstitution) {
        return false; // Pas du bruit, c'est stratégique
    }

    // Pas d'institution → c'est du bruit local
    // (ex: "vol quartier nord" ou "cambriolage centre-ville")
    return true;
}

// ─── Dictionnaires de mots-clés par catégorie ───

const KEYWORDS: Record<EventCategory, { high: string[]; medium: string[]; low: string[] }> = {
    social: {
        high: ['émeute', 'émeutes', 'affrontement', 'violences urbaines', 'barricade', 'insurrection', 'pillage'],
        medium: ['manifestation', 'grève générale', 'blocage', 'occupation', 'sit-in', 'cortège', 'mobilisation massive'],
        low: ['rassemblement', 'pétition', 'grève', 'préavis', 'mouvement social', 'syndicat', 'débrayage'],
    },
    security: {
        // Intentionnel + grande échelle uniquement en high — "explosion" seul retiré (trop large : accidents domestiques)
        high: ['attentat', 'fusillade', 'prise d\'otage', 'terrorisme', 'bombe', 'assaut', 'engin explosif', 'voiture piégée', 'colis piégé'],
        // "meurtre" déplacé en medium (fait divers ≠ menace systémique), "explosion" en medium (contexte ambivalent)
        medium: ['meurtre', 'homicide', 'agression', 'braquage', 'incendie criminel', 'évasion', 'alerte à la bombe', 'coups de feu', 'violence armée', 'rixe', 'explosion'],
        low: ['cambriolage', 'vol', 'interpellation', 'garde à vue', 'délinquance', 'trafic', 'stupéfiants', 'fait divers', 'dégradation', 'vandalisme'],
    },
    energy: {
        high: ['coupure d\'électricité', 'blackout', 'délestage', 'ecowatt rouge', 'pénurie'],
        medium: ['tension réseau', 'ecowatt orange', 'maintenance nucléaire', 'arrêt réacteur', 'baisse production'],
        low: ['consommation élevée', 'pic de demande', 'prix électricité', 'éolien', 'solaire', 'mix énergétique'],
    },
    weather: {
        high: ['vigilance rouge', 'tempête', 'ouragan', 'tornade', 'canicule extrême', 'inondation majeure', 'submersion'],
        medium: ['vigilance orange', 'orages violents', 'neige verglas', 'crues', 'vagues-submersion', 'avalanche'],
        low: ['vigilance jaune', 'pluie', 'vent fort', 'brouillard', 'chaleur', 'froid', 'gel'],
    },
    transport: {
        high: ['accident mortel', 'déraillement', 'crash', 'effondrement pont', 'fermeture autoroute', 'accident grave'],
        medium: ['perturbation', 'retard important', 'suppression train', 'trafic interrompu', 'bouchon géant', 'carambolage'],
        low: ['ralentissement', 'travaux', 'retard', 'déviation', 'circulation dense', 'accident', 'accrochage'],
    },
    infrastructure: {
        high: ['rupture barrage', 'effondrement', 'fuite nucléaire', 'contamination', 'explosion usine'],
        medium: ['fuite gaz', 'incendie industriel', 'pollution', 'coupure eau', 'incident seveso'],
        low: ['maintenance', 'travaux', 'rénovation', 'mise aux normes'],
    },
    health: {
        high: ['épidémie', 'pandémie', 'contamination', 'alerte sanitaire', 'urgence sanitaire'],
        medium: ['cluster', 'foyer', 'cas suspects', 'rappel produit', 'intoxication'],
        low: ['vaccination', 'grippe', 'gastro', 'canicule santé', 'hôpital saturé'],
    },
    general: {
        high: [],
        medium: [],
        low: [],
    },
    finance: {
        high: ['krach', 'faillite banque', 'bank run', 'effondrement bourse', 'crise financière'],
        medium: ['chute cac40', 'correction bourse', 'dette souveraine', 'spread', 'récession'],
        low: ['cac40', 'bourse', 'marché', 'euro', 'taux directeur', 'inflation'],
    },
    floods: {
        high: ['crue majeure', 'inondation catastrophique', 'submersion', 'vigicrues rouge', 'rupture digue'],
        medium: ['vigicrues orange', 'débordement', 'inondation', 'montée des eaux', 'crue'],
        low: ['vigicrues jaune', 'vigilance crues', 'niveau rivière', 'nappes phréatiques'],
    },
    fires: {
        high: ['feu de forêt majeur', 'incendie catastrophique', 'méga feu', 'evacuation incendie'],
        medium: ['feux de forêt', 'incendie forêt', 'départ de feu', 'incendie végétation'],
        low: ['risque incendie', 'vigilance feux', 'brûlage', 'sécheresse forêt'],
    },
    cyber: {
        high: ['cyberattaque majeure', 'ransomware hôpital', 'sabotage numérique', 'attaque état'],
        medium: ['cyberattaque', 'piratage', 'ransomware', 'fuite données', 'ddos', 'cert-fr alerte'],
        low: ['vulnérabilité', 'patch sécurité', 'phishing', 'arnaque', 'incident cyber'],
    },
};

// ─── Critical keywords (mots seuls, sans ambiguïté possible) ───
// Règle : ne mettre ici QUE des termes qui sont TOUJOURS critiques, sans contexte.
// "explosion" retiré → trop large (barbecue, gaz domestique, accident).
// "fusillade" retiré → déjà en security.high, et "fusillade verbale" existe.
// "effondrement" retiré → "effondrement boursier", "effondrement des ventes" → faux positifs.

const CRITICAL_KEYWORDS = [
    'attentat', 'terrorisme', 'prise d\'otage',
    'vigilance rouge', 'blackout', 'rupture barrage',
    'épidémie', 'pandémie', 'crash aérien', 'séisme', 'tsunami',
];

// ─── Expressions composées critiques (phrase entière requise) ───
// Ces expressions multi-mots éliminent les faux positifs sur les termes seuls.
const CRITICAL_COMPOUND_PHRASES: string[] = [
    'fusillade de masse', 'fusillade meurtrière', 'tirs de masse',
    'explosion bombe', 'attentat à la bombe', 'explosion attentat', 'explosion criminelle',
    'effondrement immeuble', 'effondrement bâtiment', 'effondrement pont', 'effondrement de pont',
    'fuite radioactive', 'accident nucléaire grave', 'nuage toxique',
    'coup d\'état', 'guerre civile', 'assaut terroriste',
    'alerte enlèvement',
];

// ─── Contextes d'accidents domestiques (désescalade) ───
// Un "explosion" dans ce contexte = accident, pas menace sécurité.
const DOMESTIC_ACCIDENT_KEYWORDS: string[] = [
    'barbecue', 'accident domestique', 'accident ménager',
    'fuite de gaz domestique', 'chaudière', 'tente d\'allumer', 'tentative d\'allumer',
    'accidentellement', 'par mégarde', 'brûlure accidentelle',
];

export function isDomesticAccident(text: string): boolean {
    const normalized = text.toLowerCase();
    return DOMESTIC_ACCIDENT_KEYWORDS.some((kw) => normalized.includes(kw));
}

/**
 * Classify a news item title + summary by keyword matching.
 * Returns null if no keywords match (= general/info).
 */
export function classifyByKeywords(
    title: string,
    summary?: string,
): ThreatClassification | undefined {
    const text = `${title} ${summary ?? ''}`.toLowerCase();

    let bestCategory: EventCategory = 'general';
    let bestLevel: ThreatLevel = 'info';
    let bestConfidence = 0;
    let matchCount = 0;

    // ── 1. Expressions composées critiques (priorité max, sans ambiguïté) ──
    for (const phrase of CRITICAL_COMPOUND_PHRASES) {
        if (text.includes(phrase)) {
            for (const [cat, levels] of Object.entries(KEYWORDS)) {
                if (levels.high.some((kw) => phrase.includes(kw))) {
                    return { level: 'critical', category: cat as EventCategory, confidence: 0.92, source: 'keyword' };
                }
            }
            return { level: 'critical', category: 'security', confidence: 0.88, source: 'keyword' };
        }
    }

    // ── 2. Mots-clés critiques sans ambiguïté (terme seul suffisant) ──
    for (const kw of CRITICAL_KEYWORDS) {
        if (text.includes(kw)) {
            for (const [cat, levels] of Object.entries(KEYWORDS)) {
                if (levels.high.includes(kw)) {
                    return { level: 'critical', category: cat as EventCategory, confidence: 0.9, source: 'keyword' };
                }
            }
            return { level: 'critical', category: 'security', confidence: 0.85, source: 'keyword' };
        }
    }

    // ── 3. Accidents transport/infra majeurs → high (pas critical) ──
    // "accident" seul + contexte majeur = high, pas critical. Nécessite "mortel" pour critical.
    if (text.includes('accident mortel')) {
        const isInfra = text.includes('centrale') || text.includes('nucléaire') || text.includes('usine');
        const isMajorTransport = text.includes('autoroute') || text.includes('tgv') || text.includes('train');
        if (isInfra || isMajorTransport) {
            return {
                level: 'critical',
                category: isInfra ? 'infrastructure' : 'transport',
                confidence: 0.85,
                source: 'keyword',
            };
        }
    }
    if (text.includes('accident') && !text.includes('accident mortel')) {
        const isInfra = text.includes('centrale') || text.includes('nucléaire') || text.includes('usine');
        const isMajorTransport = text.includes('autoroute') || text.includes('tgv') || text.includes('train');
        if (isInfra || isMajorTransport) {
            return {
                level: 'high',  // Était 'critical' — downgrade car sans confirmation de gravité
                category: isInfra ? 'infrastructure' : 'transport',
                confidence: 0.72,
                source: 'keyword',
            };
        }
    }

    // Score each category using word boundaries to avoid partial matches
    // (e.g. "forage" matching "orage", or "tourmente" matching "tour")
    for (const [cat, levels] of Object.entries(KEYWORDS)) {
        const category = cat as EventCategory;
        if (category === 'general') continue;

        for (const kw of levels.high) {
            const regex = new RegExp(`\\b${kw}\\b`, 'i');
            if (regex.test(text)) {
                matchCount++;
                const conf = 0.8;
                if (conf > bestConfidence || (conf === bestConfidence && levelRank('high') > levelRank(bestLevel))) {
                    bestCategory = category;
                    bestLevel = 'high';
                    bestConfidence = conf;
                }
            }
        }

        for (const kw of levels.medium) {
            const regex = new RegExp(`\\b${kw}\\b`, 'i');
            if (regex.test(text)) {
                matchCount++;
                const conf = 0.65;
                if (conf > bestConfidence) {
                    bestCategory = category;
                    bestLevel = 'medium';
                    bestConfidence = conf;
                }
            }
        }

        for (const kw of levels.low) {
            const regex = new RegExp(`\\b${kw}\\b`, 'i');
            if (regex.test(text)) {
                matchCount++;
                const conf = 0.5;
                if (conf > bestConfidence) {
                    bestCategory = category;
                    bestLevel = 'low';
                    bestConfidence = conf;
                }
            }
        }
    }

    if (matchCount === 0) return undefined;

    // Boost confidence if multiple keywords match
    if (matchCount >= 3) bestConfidence = Math.min(bestConfidence + 0.1, 0.95);

    // ─── Mitigation accidents domestiques ───
    // "explosion" dans un contexte barbecue/accident ménager ≠ menace sécurité.
    // Downgrade systématique en info/général.
    if (isDomesticAccident(text) && (bestCategory === 'security' || bestCategory === 'infrastructure')) {
        return { level: 'info', category: 'general', confidence: 0.2, source: 'keyword' };
    }

    // ─── Mitigation Bruit PQR ───
    // Pour les événements "security" de niveau "low" (faits divers),
    // on exige une institution pour valider.
    if (bestCategory === 'security' && bestLevel === 'low') {
        if (isFaitDiversNoise(text)) {
            return { level: 'info', category: 'general', confidence: 0.2, source: 'keyword' };
        }
    }

    // ─── Mitigation security/medium sans institution ───
    // "meurtre", "homicide" dans un fait divers local sans institution = bruit PQR élevé
    if (bestCategory === 'security' && bestLevel === 'medium') {
        if (isFaitDiversNoise(text)) {
            return { level: 'low', category: 'security', confidence: 0.3, source: 'keyword' };
        }
    }

    return {
        level: bestLevel,
        category: bestCategory,
        confidence: bestConfidence,
        source: 'keyword',
    };
}

function levelRank(level: ThreatLevel): number {
    switch (level) {
        case 'critical': return 4;
        case 'high': return 3;
        case 'medium': return 2;
        case 'low': return 1;
        default: return 0;
    }
}
