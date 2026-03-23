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

        const category = LABEL_TO_CATEGORY[topLabel];

        // Basic threat level heuristic based on confidence
        let level: ThreatLevel = 'info';
        if (topScore > 0.8) level = 'high';
        else if (topScore > 0.5) level = 'medium';
        else level = 'low';

        // Critical override for security/weather with extreme confidence
        if ((category === 'security' || category === 'weather') && topScore > 0.95) {
            level = 'critical';
        }

        // ─── Mitigation Bruit PQR ───
        // Pour les événements "security" de niveau "low" ou "medium" avec un score modéré,
        // on exige 2 entités nommées (Lieu + Institution) pour valider si c'est un fait divers.
        if (category === 'security' && (level === 'low' || level === 'medium')) {
            if (isFaitDiversNoise(text)) {
                return undefined; // Bruit PQR = on ignore (général)
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
