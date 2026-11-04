// tests/anticipation-api.test.ts : routes /api/anticipation/now et /api/anticipation/feedback (04/11/2026).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
const post = (body: unknown, ip = '203.0.113.7', type = 'application/json') => ({ method: 'POST', headers: { 'cf-connecting-ip': ip, 'content-type': type }, body });
const scenarioOf = (id: string) => ({ id, ruleId: 'x', ruleVersion: 1, zone: { dept: [], communes: [] }, window: { from: iso(NOW), to: iso(NOW + 3_600_000) }, title: 't', chain: [], word: 'probable', why: '', unknowns: [], bascules: [], disconfirmers: [], verify: [], openedAt: iso(NOW), revisedAt: iso(NOW), status: 'ouvert', closedAt: null, outcomeNote: null, feedback: { utile: 0, deja_su: 0, faux: 0 } });

/** Scénarios connus posés dans le registre par des enregistrements directs, relus par le registre du processus. */
async function seed(ids: string[]) {
  await tickAnticipation(NOW, readers);
  // @ts-expect-error module JS sans déclaration
  const { openRegistry } = await import('../api/_lib/anticipation/registry.js');
  const reg = await openRegistry({ dir, now: NOW });
  for (const id of ids) await reg.record({ at: iso(NOW), type: 'ouverture', scenario: scenarioOf(id) });
  __resetAnticipationForTests();
  await tickAnticipation(NOW + 1000, readers);
}
async function journalLines() {
  const { readFile, readdir } = await import('node:fs/promises');
  const files = await readdir(path.join(dir, 'journal'));
  return (await Promise.all(files.map((n) => readFile(path.join(dir, 'journal', n), 'utf8')))).join('').trim().split('\n').map((l) => JSON.parse(l));
}

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
    const lines = await journalLines();
    expect(JSON.stringify(lines)).not.toMatch(/203\.0\.113/);
    // Lignes « retour » compactes : l'id et le vote, jamais le scénario entier.
    const votes = lines.filter((ev) => ev.type === 'retour');
    expect(votes.map((ev) => [ev.id, ev.vote, Object.keys(ev).sort().join(',')])).toEqual([
      [sc.id, 'utile', 'at,id,type,vote'], [sc.id, 'deja_su', 'at,id,type,vote'],
    ]);
    // Relecture du journal (redémarrage) : les deltas sont rejoués sur le scénario.
    const again = await openRegistry({ dir, now: NOW });
    expect(again.state().get(sc.id).feedback).toEqual({ utile: 1, deja_su: 1, faux: 0 });
  });

  it('feedback requires Content-Type application/json (415)', async () => {
    await seed(['x:national:1']);
    const a = mockRes();
    await feedbackHandler(post({ scenarioId: 'x:national:1', vote: 'utile' }, '203.0.113.20', 'text/plain'), a);
    expect(a.statusCode).toBe(415);
    const b = mockRes();
    await feedbackHandler({ method: 'POST', headers: { 'cf-connecting-ip': '203.0.113.21' }, body: { scenarioId: 'x:national:1', vote: 'utile' } }, b);
    expect(b.statusCode).toBe(415);
    const c = mockRes();
    await feedbackHandler(post(JSON.stringify({ scenarioId: 'x:national:1', vote: 'utile' }), '203.0.113.22', 'application/json; charset=utf-8'), c);
    expect(c.statusCode).toBe(204);
  });

  it('feedback caps 50 votes per fingerprint and per Paris day across scenarios (429)', async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `x:national:${i}`);
    await seed(ids);
    for (const id of ids.slice(0, 50)) {
      const r = mockRes();
      await feedbackHandler(post({ scenarioId: id, vote: 'utile' }, '203.0.113.30'), r);
      expect(r.statusCode).toBe(204);
    }
    const over = mockRes();
    await feedbackHandler(post({ scenarioId: ids[50], vote: 'utile' }, '203.0.113.30'), over);
    expect(over.statusCode).toBe(429);
    expect(over.headers['retry-after']).toBeUndefined();
    const other = mockRes();
    await feedbackHandler(post({ scenarioId: ids[50], vote: 'utile' }, '203.0.113.31'), other);
    expect(other.statusCode).toBe(204);
  });

  it('feedback caps 120 accepted votes per minute overall (429 with Retry-After)', async () => {
    await seed(['x:national:1']);
    const at = Date.parse('2026-11-04T10:00:05Z');
    const clock = vi.spyOn(Date, 'now').mockReturnValue(at);
    try {
      for (let i = 0; i < 120; i++) {
        const r = mockRes();
        await feedbackHandler(post({ scenarioId: 'x:national:1', vote: 'faux' }, `198.51.100.${i}`), r);
        expect(r.statusCode).toBe(204);
      }
      const over = mockRes();
      await feedbackHandler(post({ scenarioId: 'x:national:1', vote: 'faux' }, '198.51.100.200'), over);
      expect(over.statusCode).toBe(429);
      expect(over.headers['retry-after']).toBe('55');
      // Minute suivante : de nouveau accepté.
      clock.mockReturnValue(at + 60_000);
      const next = mockRes();
      await feedbackHandler(post({ scenarioId: 'x:national:1', vote: 'faux' }, '198.51.100.200'), next);
      expect(next.statusCode).toBe(204);
    } finally { clock.mockRestore(); }
  });

  it('replay keeps backward compatibility with old full-scenario retour lines', async () => {
    // @ts-expect-error module JS sans déclaration
    const { openRegistry } = await import('../api/_lib/anticipation/registry.js');
    const reg = await openRegistry({ dir, now: NOW });
    const sc = scenarioOf('x:national:9');
    await reg.record({ at: iso(NOW), type: 'ouverture', scenario: sc });
    await reg.record({ at: iso(NOW), type: 'retour', scenario: { ...sc, feedback: { utile: 2, deja_su: 0, faux: 1 } } });
    expect(await reg.recordVote('x:national:9', 'utile', NOW)).toBe(true);
    expect(await reg.recordVote('inconnu', 'utile', NOW)).toBe(false);
    const again = await openRegistry({ dir, now: NOW });
    expect(again.state().get('x:national:9').feedback).toEqual({ utile: 3, deja_su: 0, faux: 1 });
    expect(again.errors).toEqual([]);
  });
});
