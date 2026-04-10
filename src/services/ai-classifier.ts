/**
 * ai-classifier.ts — Service de classification ML encapsulé dans un Web Worker.
 * Cela permet à Transformers.js de télécharger et d'exécuter le modèle d'IA 
 * sans bloquer le thread principal (UI freeze).
 */

import type { ThreatClassification, EventCategory, ThreatLevel } from '../types/index.ts';
import { isFaitDiversNoise } from './classifier.ts';

// Initialisation du Worker via Vite
const worker = new Worker(new URL('./ai-worker.ts', import.meta.url), { type: 'module' });

let messageId = 0;
interface AiClassifierResult {
    labels: string[];
    scores: number[];
}
type AiClassifierPending = { resolve: (val: AiClassifierResult) => void; reject: (err: Error) => void };
const pendingRequests = new Map<number, AiClassifierPending>();

worker.addEventListener('message', (event) => {
    const { id, result, error } = event.data;
    const pending = pendingRequests.get(id);
    if (!pending) return;
    pendingRequests.delete(id);

    if (error) {
        pending.reject(new Error(error));
    } else {
        pending.resolve(result);
    }
});

// Categories for zero-shot classification (in French for better results)
const CANDIDATE_LABELS = [
    'social', // manifestation, grève, émeute
    'sécurité', // crime, attentat, accident
    'énergie', // électricité, RTE, nucléaire
    'météo', // tempête, inondation, chaleur
    'transport', // train, sncf, route, retard
    'infrastructure', // barrage, pont, coupure
    'santé', // maladie, épidémie, hôpital
    'politique', // élection, partis, débat, polémique
    'général', // sport, culture, business, fait divers mineur
];

// Map French labels back to our internal EventCategory type
const LABEL_TO_CATEGORY: Record<string, EventCategory> = {
    'social': 'social',
    'sécurité': 'security',
    'énergie': 'energy',
    'météo': 'weather',
    'transport': 'transport',
    'infrastructure': 'infrastructure',
    'santé': 'health',
    'politique': 'general',
    'général': 'general',
};

/**
 * Classify a news item using Transformers.js via Web Worker.
 */
export async function classifyWithAI(title: string, summary?: string): Promise<ThreatClassification | undefined> {
    try {
        const text = summary ? `${title}. ${summary}` : title;

        const id = messageId++;
        const promise = new Promise<AiClassifierResult>((resolve, reject) => {
            pendingRequests.set(id, { resolve, reject: (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))) });
        });

        worker.postMessage({ id, text, labels: CANDIDATE_LABELS });

        const result = await promise;

        const topLabel = result.labels[0];
        const topScore = result.scores[0];

        // If 'general' or 'politique' is the best match, or confidence is very low, bail out
        if (topLabel === 'général' || topLabel === 'politique' || topScore < 0.3) {
            return undefined; // Meaning it's a general article with no specific threat
        }

        let category = LABEL_TO_CATEGORY[topLabel];

        // Basic threat level heuristic based on confidence
        let level: ThreatLevel = 'info';
        if (topScore > 0.8) level = 'high';
        else if (topScore > 0.5) level = 'medium';
        else level = 'low';

        // L'IA ne peut PAS assigner "critical" — seul le keyword classifier le fait.
        // L'IA manque de contexte factuel pour garantir cette sévérité.
        // (critical reste réservé aux mots-clés sans ambiguïté : attentat, séisme, blackout…)

        // ─── Correction catégorie "social" pour événements militaires/criminels ───
        // Le modèle zero-shot confond parfois "social" avec des événements géopolitiques
        // (général tué, coup d'état, assassinat…) car il associe "politique/militaire" à "social".
        // Si le label AI est "social" mais le texte contient des termes létaux/militaires → security.
        if (category === 'social') {
            const lowerText = text.toLowerCase();
            const LETHAL_OR_MILITARY = [
                'tué', 'tués', 'tuer', 'assassiné', 'assassinat', 'mort', 'décédé', 'décès',
                'blessé grave', 'blessés graves', 'victime', 'victimes',
                'coup d\'état', 'général', 'militaire', 'armée', 'soldats', 'guerre', 'conflit armé',
                'exécuté', 'massacre', 'atrocités',
            ];
            if (LETHAL_OR_MILITARY.some((term) => lowerText.includes(term))) {
                category = 'security';
                level = 'low'; // événement étranger/contexte incertain → low par défaut
            }
        }

        // ─── Mitigation Bruit PQR ───
        if (category === 'security' && (level === 'low' || level === 'medium')) {
            if (isFaitDiversNoise(text)) {
                return undefined;
            }
        }

        return {
            category,
            level,
            confidence: topScore,
            source: 'ml',
        };

    } catch (err) {
        console.error('[ML Worker] Classification error:', err);
        return undefined; // Fallback par défaut si l'IA crashe
    }
}
