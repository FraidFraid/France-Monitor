import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Ordre des effets observables : écriture Redis et envoi de la réponse.
const state = vi.hoisted(() => ({ order: [] as string[], dbFails: false }));

vi.mock('../api/_utils/redis.js', () => ({
  redisSet: vi.fn(async (key: string) => {
    state.order.push(`redisSet:${key}`);
  }),
}));

// Base simulée : aucune connexion réelle (DATABASE_URL local pointe sur la PRODUCTION).
vi.mock('../api/_lib/db.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    hasDatabaseUrl: () => true,
    getDb: () => {
      if (state.dbFails) throw new Error('base indisponible (test)');
      return async () => [];
    },
  };
});

import handler from '../api/ingest/news';

function mockRes() {
  const res = {
    statusCode: 0,
    body: '',
    setHeader: () => {},
    end: (body?: string) => {
      state.order.push('res.end');
      res.body = body ?? '';
    },
  };
  return res;
}

const ENV_KEYS = ['CRON_SECRET', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'GROQ_API_KEY'] as const;

describe('passage d’ingestion : bilan pour /api/health-check', () => {
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env.CRON_SECRET = 'secret-test';
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.GROQ_API_KEY;
    state.order.length = 0;
    state.dbFails = false;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    vi.restoreAllMocks();
  });

  // Fluid Compute ("fluid": true dans vercel.json) ne garantit pas le travail lancé après
  // la réponse : le bilan écrit après res.end() était perdu et le health-check restait figé.
  it('écrit le bilan AVANT de répondre quand le passage réussit', async () => {
    const res = mockRes();
    await handler({ method: 'GET', headers: { authorization: 'Bearer secret-test' } }, res);
    expect(res.statusCode).toBe(200);
    expect(state.order).toEqual(['redisSet:ingest:last-tick', 'res.end']);
  });

  it('écrit le bilan d’échec AVANT de répondre quand le passage échoue', async () => {
    state.dbFails = true;
    const res = mockRes();
    await handler({ method: 'GET', headers: { authorization: 'Bearer secret-test' } }, res);
    expect(res.statusCode).toBe(500);
    expect(state.order).toEqual(['redisSet:ingest:last-tick', 'res.end']);
  });
});
