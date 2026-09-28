import { describe, it, expect, vi } from 'vitest';
import {
  BATCH_SYSTEM_PROMPT, buildBatchUserPrompt, parseBatchResponse, qualifyJudgment, selectCandidates,
  classifyBatch, classifierLlmConfig, LLM_BATCH_SIZE,
  // @ts-expect-error — module JS sans déclaration de types
} from '../api/_lib/llm-classifier.js';

const item = (i: number, extra: Record<string, unknown> = {}) => ({ i, category: 'security', severity: 2, in_france: true, ongoing: true, ...extra });
const reply = (content: string, status = 200) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status, headers: { 'Content-Type': 'application/json' } });
const LLM = { url: 'https://llm.test/v1/chat/completions', model: 'm', apiKey: 'k', version: 'groq-2' };
const titleQ = (over: Record<string, unknown> = {}) => ({ maxSeverity: 'critical', temporality: 'en_cours', zone: 'france', reasons: [], ...over });

describe('classifierLlmConfig', () => {
  it('Groq par défaut, désactivé sans clé', () => {
    expect(classifierLlmConfig({})).toBeNull();
    expect(classifierLlmConfig({ GROQ_API_KEY: 'g' })).toEqual({
      url: 'https://api.groq.com/openai/v1/chat/completions', model: 'openai/gpt-oss-20b', apiKey: 'g', version: 'groq-2',
    });
  });
  it('autre point d’accès : modèle obligatoire, clé facultative, version llm-2', () => {
    expect(classifierLlmConfig({ CLASSIFIER_LLM_URL: 'http://localhost:11434/v1/chat/completions' })).toBeNull();
    expect(classifierLlmConfig({ CLASSIFIER_LLM_URL: 'http://localhost:11434/v1/chat/completions', CLASSIFIER_LLM_MODEL: 'mistral' }))
      .toEqual({ url: 'http://localhost:11434/v1/chat/completions', model: 'mistral', apiKey: '', version: 'llm-2' });
  });
});

describe('invite', () => {
  it('contient la grille à 5 niveaux et les définitions', () => {
    for (const marker of ['0 :', '1 :', '2 :', '3 :', '4 :', 'in_france', 'ongoing', '"items"']) {
      expect(BATCH_SYSTEM_PROMPT).toContain(marker);
    }
    expect(LLM_BATCH_SIZE).toBe(10);
  });
  it('compte la menace terroriste au niveau 3 même sans victime (décision du 28/09)', () => {
    expect(BATCH_SYSTEM_PROMPT).toContain('projet terroriste déjoué');
    expect(BATCH_SYSTEM_PROMPT).toContain('vaut 3, même sans victime');
  });
  it('numérote les articles et tronque la description à 200 caractères', () => {
    const prompt = buildBatchUserPrompt([{ title: 'Titre A', description: 'x'.repeat(300) }, { title: 'Titre\nB', description: null }]);
    expect(prompt).toContain('1. Titre : Titre A');
    expect(prompt).toContain('2. Titre : Titre B');
    expect(prompt).toContain(`Description : ${'x'.repeat(200)}\n`);
    expect(prompt).not.toContain('x'.repeat(201));
  });
});

describe('parseBatchResponse', () => {
  it('apparie par numéro i, même dans le désordre ; article omis → null', () => {
    expect(parseBatchResponse(JSON.stringify({ items: [item(3, { severity: 4 }), item(1)] }), 3)).toEqual([
      { category: 'security', severity: 2, inFrance: true, ongoing: true },
      null,
      { category: 'security', severity: 4, inFrance: true, ongoing: true },
    ]);
  });
  it('rejette gravité en chaîne ou décimale, catégorie inconnue, booléens absents ; premier i gagne', () => {
    const out = parseBatchResponse(JSON.stringify({ items: [
      item(1, { severity: '3' }), item(2, { severity: 2.5 }), item(3, { category: 'defense' }),
      item(4, { in_france: 'oui' }), item(5, { severity: 1 }), item(5, { severity: 4 }), item(9),
    ] }), 5);
    expect(out).toEqual([null, null, null, null, { category: 'security', severity: 1, inFrance: true, ongoing: true }]);
  });
  it('JSON illisible ou sans items → null', () => {
    expect(parseBatchResponse('pas du json', 2)).toBeNull();
    expect(parseBatchResponse('{"result":[]}', 2)).toBeNull();
  });
});

describe('qualifyJudgment', () => {
  const j = (severity: number, inFrance = true, ongoing = true) => ({ category: 'security', severity, inFrance, ongoing });
  it('en France, en cours : gravité du modèle, sans motif', () => {
    expect(qualifyJudgment(j(4), titleQ())).toEqual({ severity: 'critical', reportedSeverity: 'critical', temporality: 'en_cours', zone: 'france', reasons: [] });
  });
  it('hors de France selon le modèle : retenue medium, motif étranger', () => {
    expect(qualifyJudgment(j(4, false), titleQ())).toMatchObject({ severity: 'medium', reportedSeverity: 'critical', zone: 'etranger', reasons: ['etranger'] });
  });
  it('pas en cours : retenue low, passé', () => {
    expect(qualifyJudgment(j(3, true, false), titleQ())).toMatchObject({ severity: 'low', temporality: 'passe', reasons: ['passe'] });
  });
  it('le titre l’emporte : étranger ou hypothèse même si le modèle dit l’inverse', () => {
    expect(qualifyJudgment(j(4), titleQ({ maxSeverity: 'medium', zone: 'etranger', reasons: ['etranger'] })))
      .toMatchObject({ severity: 'medium', zone: 'etranger', reasons: ['etranger'] });
    expect(qualifyJudgment(j(3), titleQ({ maxSeverity: 'low', temporality: 'a_venir', reasons: ['hypothetique'] })))
      .toMatchObject({ severity: 'low', temporality: 'a_venir', reasons: ['hypothetique'] });
  });
  it('un motif n’apparaît que s’il abaisse', () => {
    expect(qualifyJudgment(j(1, false, false), titleQ())).toMatchObject({ severity: 'low', reasons: [] });
  });
});

describe('selectCandidates', () => {
  const c = (id: number, severity: string, tier: number | null, publishedAt: number | null) =>
    ({ id, title: `T${id}`, description: null, severity, confidence: 0.2, tier, publishedAt });
  it('graves d’abord, puis meilleur rang, puis plus récent ; borne le nombre', () => {
    const rows = [c(1, 'info', 3, 100), c(2, 'critical', 3, 50), c(3, 'info', 1, 10), c(4, 'info', 1, 20), c(5, 'info', null, 999)];
    expect(selectCandidates(rows, 10).map((r: { id: number }) => r.id)).toEqual([2, 4, 3, 1, 5]);
    expect(selectCandidates(rows, 2).map((r: { id: number }) => r.id)).toEqual([2, 4]);
  });
});

describe('classifyBatch', () => {
  const articles = [{ title: 'A', description: null }, { title: 'B', description: 'desc' }];
  it('envoie un lot JSON au point d’accès configuré', async () => {
    const fetchImpl = vi.fn(async () => reply(JSON.stringify({ items: [item(1), item(2, { severity: 0 })] })));
    const out = await classifyBatch(LLM, articles, { fetchImpl });
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ severity: 0 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, { body: string; headers: Record<string, string> }];
    expect(url).toBe(LLM.url);
    expect(init.headers.Authorization).toBe('Bearer k');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('m');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[1].content).toContain('1. Titre : A');
  });
  it('sans clé : pas d’en-tête Authorization (Ollama local)', async () => {
    const fetchImpl = vi.fn(async () => reply(JSON.stringify({ items: [item(1), item(2)] })));
    await classifyBatch({ ...LLM, apiKey: '' }, articles, { fetchImpl });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(init.headers.Authorization).toBeUndefined();
  });
  it('HTTP 429 → lève une erreur avec status', async () => {
    const fetchImpl = vi.fn(async () => new Response('quota', { status: 429 }));
    await expect(classifyBatch(LLM, articles, { fetchImpl })).rejects.toMatchObject({ status: 429 });
  });
  it('erreur réseau ou réponse illisible → null ; lot vide → aucun appel', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await classifyBatch(LLM, articles, { fetchImpl: vi.fn(async () => { throw new Error('timeout'); }) })).toBeNull();
    expect(await classifyBatch(LLM, articles, { fetchImpl: vi.fn(async () => reply('pas du json')) })).toBeNull();
    const fetchImpl = vi.fn();
    expect(await classifyBatch(LLM, [], { fetchImpl })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
