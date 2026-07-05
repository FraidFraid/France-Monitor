/**
 * summarization-worker.ts — Web Worker pour générer un résumé via Transformers.js (fallback).
 */

import { pipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;

// Le pipeline summarization de transformers.js n'expose pas de signature d'appel précise :
// on décrit uniquement la forme réellement utilisée ici.
type Summarizer = (
    text: string,
    options?: { max_new_tokens?: number; min_length?: number }
) => Promise<Array<{ summary_text: string }>>;

let summarizerPromise: Promise<Summarizer> | null = null;

async function getSummarizer(): Promise<Summarizer> {
    if (!summarizerPromise) {
        console.log('[ML Worker] Loading summarization model (T5)...');
        summarizerPromise = pipeline(
            'summarization',
            'Xenova/t5-small'
        ) as unknown as Promise<Summarizer>;
    }
    return summarizerPromise!;
}

self.addEventListener('message', async (event) => {
    const { id, text } = event.data;
    try {
        const summarizer = await getSummarizer();
        // T5-small works best with English, so might produce weird results for FR,
        // but it's our ultimate local fallback for the NLP pipeline.
        const result = await summarizer(`summarize: ${text}`, {
            max_new_tokens: 50,
            min_length: 10
        });
        self.postMessage({ id, result: result[0].summary_text });
    } catch (error) {
        self.postMessage({ id, error: (error as Error).message });
    }
});
