import { pipeline, env } from '@huggingface/transformers';

// Config: Eviter la recherche locale si ce n'est pas configuré
env.allowLocalModels = false;

let classifierPromise: Promise<any> | null = null;

async function getClassifier() {
    if (!classifierPromise) {
        console.log('[ML Worker] Loading zero-shot classifier model...');
        classifierPromise = pipeline(
            'zero-shot-classification',
            'Xenova/mobilebert-uncased-mnli' // VERY small model (~100MB)
        );
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
    } catch (error: any) {
        self.postMessage({ id, error: error.message });
    }
});
