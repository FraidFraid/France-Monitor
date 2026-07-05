import { pipeline, env } from '@huggingface/transformers';

// Config: Eviter la recherche locale si ce n'est pas configuré
env.allowLocalModels = false;

// Le pipeline zero-shot de transformers.js n'expose pas de signature d'appel précise :
// on décrit uniquement la forme réellement utilisée ici.
type ZeroShotClassifier = (
    text: string,
    labels: string[],
    options?: { multi_label?: boolean }
) => Promise<unknown>;

let classifierPromise: Promise<ZeroShotClassifier> | null = null;

async function getClassifier(): Promise<ZeroShotClassifier> {
    if (!classifierPromise) {
        console.log('[ML Worker] Loading zero-shot classifier model...');
        classifierPromise = pipeline(
            'zero-shot-classification',
            'Xenova/mobilebert-uncased-mnli' // VERY small model (~100MB)
        ) as unknown as Promise<ZeroShotClassifier>;
    }
    return classifierPromise!;
}

self.addEventListener('message', async (event) => {
    const { id, text, labels } = event.data;
    try {
        const classifier = await getClassifier();
        const result = await classifier(text, labels, {
            multi_label: false,
        });
        self.postMessage({ id, result });
    } catch (error) {
        self.postMessage({ id, error: (error as Error).message });
    }
});
