// Cache Redis du brief v14 : un appel Groq par clé de 6 h (contrainte du plan), y compris
// quand la réponse du modèle est rejetée. Redis remplacé par une table en mémoire.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const store = vi.hoisted(() => new Map<string, string>());
vi.mock('../api/_utils/redis.js', () => ({
  redisGet: vi.fn(async (key: string) => store.get(key) ?? null),
  redisSet: vi.fn(async (key: string, value: string) => { store.set(key, value); }),
}));

// @ts-expect-error — module JS sans déclaration de types
import handler from '../api/_handlers/intelligence/v1/france-intel-brief.js';

const EVENT = { id: 'E42', title: 'Gironde : plan ORSEC déclenché après des inondations', category: 'weather', severity: 'high', sources: ['Sud Ouest', 'France Info'], sourceCount: 3, independentCount: 2, lastSeen: '2026-09-23T06:00:00Z', status: 'active' };
const BLUF = 'Pression concentrée sur la Gironde, sans convergence nationale à ce stade.';

function post(body: object): Request {
  return new Request('http://localhost/api/intelligence/v1/france-intel-brief', { method: 'POST', body: JSON.stringify(body) });
}

function groqReplying(reply: object) {
  return vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] })));
}

describe('brief v14 — appels Groq (relecture finale #14, #15)', () => {
  beforeEach(() => { store.clear(); vi.stubEnv('GROQ_API_KEY', 'test'); });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('met en cache un brief rejeté : pas de second appel Groq pour la même clé', async () => {
    const fetchMock = groqReplying({ bluf: BLUF, judgments: [{ priority: 1, text: 'Rien de cité.', confidence: 'moderate' }], watch: [] });
    vi.stubGlobal('fetch', fetchMock);
    const body = { countryScore: 72, events: [EVENT], lang: 'fr' };
    expect((await (await handler(post(body))).json()).brief).toBeNull();
    expect(await (await handler(post(body))).json()).toEqual({ brief: null, fromCache: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ignore lastSeen dans la clé de cache (absent de l’invite)', async () => {
    const fetchMock = groqReplying({ bluf: BLUF, judgments: [{ priority: 1, text: 'Crue durable en Gironde.', confidence: 'high', evidence: ['E42'] }], watch: [] });
    vi.stubGlobal('fetch', fetchMock);
    await handler(post({ countryScore: 72, events: [EVENT], lang: 'fr' }));
    const again = await (await handler(post({ countryScore: 72, events: [{ ...EVENT, lastSeen: '2026-09-23T07:30:00Z' }], lang: 'fr' }))).json();
    expect(again.fromCache).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
