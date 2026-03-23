/**
 * summarization-worker.ts — Web Worker pour générer un résumé via Transformers.js (fallback).
 */

import { pipeline, env } from '@xenova/transformers';

env.allowLocalModels = false;

let summarizerPromise: Promise<any> | null = null;

async function getSummarizer() {
    if (!summarizerPromise) {
        console.log('[ML Worker] Loading summarization model (T5)...');
        summarizerPromise = pipeline(
            'summarization',
            'Xenova/t5-small',
            { quantized: true }
        );
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
    } catch (error: any) {
        self.postMessage({ id, error: error.message });
    }
});
