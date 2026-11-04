// tests/anticipation-api.test.ts : routes /api/anticipation/now et /api/anticipation/feedback (04/11/2026).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error module JS sans déclaration
import nowHandler from '../api/_handlers/anticipation/now.js';
// @ts-expect-error module JS sans déclaration
import feedbackHandler, { __resetFeedbackForTests } from '../api/_handlers/anticipation/feedback.js';
// @ts-expect-error module JS sans déclaration
import { __resetAnticipationForTests, tickAnticipation } from '../api/_lib/anticipation/room.js';

const NOW = Date.now();
const iso = (t: number) => new Date(t).toISOString();
const readers = {
  readProtests: async () => ({ readAt: iso(NOW), items: [] }), readVigilance: async () => null, readRail: async () => ({ at: iso(NOW), situations: [] }),
  readRoom: async () => ({ generatedAt: iso(NOW), outages: [] }), readCyber: async () => null, readEcowatt: async () => null, readFuel: async () => null, readNews: async () => [],
};

function mockRes() {
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200, body: undefined as unknown, headers,
    setHeader(k: string, v: string) { headers[k.toLowerCase()] = v; },
    status(c: number) { res.statusCode = c; return res; },
    json(b: unknown) { res.body = b; return res; },
    end(b?: unknown) { if (b !== undefined) res.body = b; return res; },
  };
  return res;
}
const post = (body: unknown, ip = '203.0.113.7') => ({ method: 'POST', headers: { 'cf-connecting-ip': ip }, body });

let dir = '';
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'antic-api-'));
  process.env.ANTICIPATION_DIR = dir;
  __resetAnticipationForTests(); __resetFeedbackForTests();
});
afterEach(async () => { delete process.env.ANTICIPATION_DIR; await rm(dir, { recursive: true, force: true }); });

describe('API anticipation', () => {
  it('GET now always 200 with beta true', async () => {
    await tickAnticipation(NOW, readers);
    const res = mockRes();
    await nowHandler({ method: 'GET', headers: {} }, res);
    expect(res.statusCode).toBe(200);
    expect((res.body as { beta: boolean }).beta).toBe(true);
    expect(res.headers['cache-control']).toBe('s-maxage=30, stale-while-revalidate=60');
  });

  it('feedback rejects duplicates and bad bodies', async () => {
    // Scénario connu : posé dans le registre par un enregistrement direct.
    await tickAnticipation(NOW, readers);
    // @ts-expect-error module JS sans déclaration
    const { openRegistry } = await import('../api/_lib/anticipation/registry.js');
    const reg = await openRegistry({ dir, now: NOW });
    const sc = { id: 'x:national:1', ruleId: 'x', ruleVersion: 1, zone: { dept: [], communes: [] }, window: { from: iso(NOW), to: iso(NOW + 3_600_000) }, title: 't', chain: [], word: 'probable', why: '', unknowns: [], bascules: [], disconfirmers: [], verify: [], openedAt: iso(NOW), revisedAt: iso(NOW), status: 'ouvert', closedAt: null, outcomeNote: null, feedback: { utile: 0, deja_su: 0, faux: 0 } };
    await reg.record({ at: iso(NOW), type: 'ouverture', scenario: sc });
    __resetAnticipationForTests(); // le registre du processus relit le journal
    await tickAnticipation(NOW + 1000, readers);

    const a = mockRes();
    await feedbackHandler(post({ scenarioId: sc.id, vote: 'utile' }), a);
    expect(a.statusCode).toBe(204);
    const b = mockRes();
    await feedbackHandler(post({ scenarioId: sc.id, vote: 'faux' }), b);
    expect(b.statusCode).toBe(429);
    const c = mockRes();
    await feedbackHandler(post({ scenarioId: sc.id, vote: 'bof' }, '203.0.113.8'), c);
    expect(c.statusCode).toBe(400);
    const d = mockRes();
    await feedbackHandler(post({ scenarioId: 'inconnu', vote: 'utile' }, '203.0.113.9'), d);
    expect(d.statusCode).toBe(400);
    const e = mockRes();
    await feedbackHandler(post(undefined, '203.0.113.10'), e);
    expect(e.statusCode).toBe(400);
    // Autre adresse : autorisée. Le compteur et la ligne « retour » sont écrits, sans adresse.
    const f = mockRes();
    await feedbackHandler(post({ scenarioId: sc.id, vote: 'deja_su' }, '203.0.113.11'), f);
    expect(f.statusCode).toBe(204);
    const { readFile } = await import('node:fs/promises');
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(path.join(dir, 'journal'));
    const text = (await Promise.all(files.map((n) => readFile(path.join(dir, 'journal', n), 'utf8')))).join('');
    expect(text).not.toMatch(/203\.0\.113/);
    const last = text.trim().split('\n').map((l) => JSON.parse(l)).filter((ev) => ev.type === 'retour').pop();
    expect(last.scenario.feedback).toEqual({ utile: 1, deja_su: 1, faux: 0 });
  });
});
