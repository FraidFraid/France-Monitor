/**
 * summarization.ts — The summarization fallback chain for FranceMonitor.
 * 1. Ollama local (mistral:instruct) -> max privacy, local
 * 2. Groq cloud (llama3) -> if Groq key exists and Ollama is down
 * 3. Browser T5 (@xenova/transformers) -> ultimate local fallback
 */

const worker = new Worker(new URL('./summarization-worker.ts', import.meta.url), { type: 'module' });

let messageId = 0;
type SummarizationPending = { resolve: (val: string) => void; reject: (err: Error) => void };
const pendingRequests = new Map<number, SummarizationPending>();

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

function summarizeT5(text: string): Promise<string> {
    const id = messageId++;
    const promise = new Promise<string>((resolve, reject) => {
        pendingRequests.set(id, { resolve, reject });
    });
    worker.postMessage({ id, text });
    return promise;
}

const OLLAMA_URL = import.meta.env.VITE_OLLAMA_URL ?? 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = 'mistral:instruct';

// Set VITE_USE_OLLAMA=true in .env.local to enable Ollama calls (disabled by default in prod)
const USE_OLLAMA = import.meta.env.VITE_USE_OLLAMA === 'true';

export async function summarizeWithFallback(text: string): Promise<string | undefined> {
    if (!text || text.trim().length === 0) return undefined;

    // 1. Ollama local
    if (USE_OLLAMA) {
        try {
            const ollamaRes = await fetch(OLLAMA_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: OLLAMA_MODEL,
                    prompt: `Fais un résumé ultra-court (max 1 phrase) de cet événement français en gardant seulement les faits.\n\nTexte: ${text}\nRésumé:`,
                    stream: false
                }),
                signal: AbortSignal.timeout(5000)
            });

            if (ollamaRes.ok) {
                const data = await ollamaRes.json() as { response?: string };
                if (data.response) {
                    return data.response.trim();
                }
            }
        } catch (err) {
            console.warn('[Summarization] Ollama error, fallback to Groq proxy:', err instanceof Error ? err.message : err);
        }
    }

    // 2. Groq via proxy serveur (clé jamais exposée côté client)
    try {
        const proxyRes = await fetch('/api/intelligence/v1/summarize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
            signal: AbortSignal.timeout(10000),
        });
        if (proxyRes.ok) {
            const data = await proxyRes.json() as { summary?: string };
            if (data.summary) {
                return data.summary;
            }
        }
    } catch (err) {
        console.warn('[Summarization] Groq proxy error, fallback to T5:', err instanceof Error ? err.message : err);
    }

    // 3. Browser T5
    try {
        const summary = await summarizeT5(text);
        return summary;
    } catch (err) {
        console.error('[Summarization] T5 Worker failed', err);
        return undefined;
    }
}
