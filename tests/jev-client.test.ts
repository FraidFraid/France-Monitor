// tests/jev-client.test.ts
// Tests du client HTTP Jev (api/_lib/jev-client.js) — sans réseau réel,
// `fetchImpl` est injecté. Vérifie la forme de la requête POST et la
// classification des erreurs par code HTTP (cf. docs.typesafe.ai/api.md).

import { describe, it, expect, vi } from 'vitest';
// @ts-expect-error — module JS sans déclaration de types
import {
  scoreArticle,
  JEV_MODEL,
  JevAuthError,
  JevRateLimitError,
  JevValidationError,
  JevServerError,
  JevTimeoutError,
} from '../api/_lib/jev-client.js';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

const STATE = { source: { name: 'Le Monde', type: 'média national', region: 'nationale', tier: 1 }, article: { title: 't', summary: 's', published_at: null } };

describe('scoreArticle · requête', () => {
  it('POST vers /v1/systemone avec Authorization Bearer, le modèle épinglé et les 9 questions', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { model: JEV_MODEL, answers: {}, usage: { input_tokens: 10, output_tokens: 0 } }),
    );
    await scoreArticle(STATE, { apiKey: 'sk-test', fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer sk-test');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(JEV_MODEL);
    expect(body.state).toEqual(STATE);
    expect(Object.keys(body.questions)).toEqual(
      expect.arrayContaining([
        'relevance', 'category', 'severity', 'in_france', 'ongoing',
        'institution_involved', 'isolated_fait_divers', 'scope', 'infrastructure_type',
      ]),
    );
    expect(Object.keys(body.questions)).toHaveLength(9);
  });

  it('retourne le corps JSON tel quel en cas de succès', async () => {
    const payload = { model: JEV_MODEL, answers: { relevance: { type: 'score', score: 2, confidence: 0.8 } }, usage: { input_tokens: 250, output_tokens: 0 } };
    const fetchImpl = vi.fn(async () => jsonResponse(200, payload));
    const result = await scoreArticle(STATE, { apiKey: 'sk-test', fetchImpl });
    expect(result).toEqual(payload);
  });
});

describe('scoreArticle · classification des erreurs', () => {
  it('401 → JevAuthError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(401, { error: 'Missing or invalid API key' }));
    await expect(scoreArticle(STATE, { apiKey: 'bad', fetchImpl })).rejects.toBeInstanceOf(JevAuthError);
  });

  it('403 → JevAuthError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, {}));
    await expect(scoreArticle(STATE, { apiKey: 'bad', fetchImpl })).rejects.toBeInstanceOf(JevAuthError);
  });

  it('429 → JevRateLimitError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(429, { error: 'Rate limit exceeded' }));
    await expect(scoreArticle(STATE, { apiKey: 'k', fetchImpl })).rejects.toBeInstanceOf(JevRateLimitError);
  });

  it('422 → JevValidationError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(422, { error: 'validation failed' }));
    await expect(scoreArticle(STATE, { apiKey: 'k', fetchImpl })).rejects.toBeInstanceOf(JevValidationError);
  });

  it('500 → JevServerError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {}));
    await expect(scoreArticle(STATE, { apiKey: 'k', fetchImpl })).rejects.toBeInstanceOf(JevServerError);
  });

  it('529 (temporarily overloaded) → JevServerError', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(529, { error: 'Temporarily overloaded' }));
    await expect(scoreArticle(STATE, { apiKey: 'k', fetchImpl })).rejects.toBeInstanceOf(JevServerError);
  });

  it('erreur réseau / timeout → JevTimeoutError', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    await expect(scoreArticle(STATE, { apiKey: 'k', fetchImpl })).rejects.toBeInstanceOf(JevTimeoutError);
  });
});
