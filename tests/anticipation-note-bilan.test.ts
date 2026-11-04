// tests/anticipation-note-bilan.test.ts : note de 7 h figée et bilan mensuel avec règle d'arrêt (04/11/2026).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error module JS sans déclaration
import { buildNote } from '../api/_lib/anticipation/note.js';
// @ts-expect-error module JS sans déclaration
import { buildBilan, rulesInReview } from '../api/_lib/anticipation/bilan.js';
// @ts-expect-error module JS sans déclaration
import { capOpen } from '../api/_lib/anticipation/engine.js';
// @ts-expect-error module JS sans déclaration
import { RULES } from '../api/_lib/anticipation/rules/index.js';
// @ts-expect-error module JS sans déclaration
import { __resetAnticipationForTests, anticipationBilan, anticipationNote, anticipationSnapshot, tickAnticipation } from '../api/_lib/anticipation/room.js';
// @ts-expect-error module JS sans déclaration
import noteHandler from '../api/_handlers/anticipation/note.js';
// @ts-expect-error module JS sans déclaration
import bilanHandler from '../api/_handlers/anticipation/bilan.js';

const iso = (t: number) => new Date(t).toISOString();
const NOW = Date.parse('2026-11-04T06:05:00Z'); // 07:05 à Paris
const sc = (id: string, over: Record<string, unknown> = {}) => ({
  id, ruleId: 'r1', ruleVersion: 1, zone: { dept: [], communes: [] }, window: { from: '2026-11-04T08:00:00.000Z', to: '2026-11-04T16:00:00.000Z' },
  title: `Titre ${id}`, chain: [], word: 'probable', why: '', unknowns: [], bascules: [], disconfirmers: [], verify: [],
  openedAt: '2026-11-03T20:00:00.000Z', revisedAt: '2026-11-03T20:00:00.000Z', status: 'ouvert', closedAt: null, outcomeNote: null,
  feedback: { utile: 0, deja_su: 0, faux: 0 }, ...over,
});
const day = (d: string, ids: string[]) => ({ day: d, scenarioIds: ids, deadlines: [] });

describe('buildNote', () => {
  it('bluf picks highest word', () => {
    const a = sc('a', { word: 'possibilite_reelle', title: 'Perturbations ferroviaires' });
    const b = sc('b', { word: 'tres_probable', title: 'Mobilisation nationale' });
    const c = sc('c', { word: 'probable', title: 'Tension carburants' });
    const note = buildNote([a, b, c], [day('2026-11-04', ['a', 'b']), day('2026-11-05', ['c'])], [], NOW);
    expect(note.today.map((s: { id: string }) => s.id)).toEqual(['b', 'a']);
    expect(note.bluf).toContain('Mobilisation nationale (très probable)');
    expect(note.bluf).toContain('Cette semaine : Tension carburants (probable)');
    expect(note.week).toEqual([{ day: '2026-11-05', scenario: c }]);
    expect(note.day).toBe('2026-11-04');
  });
  it('empty day bluf', () => {
    const note = buildNote([], [day('2026-11-04', [])], [], NOW);
    expect(note.bluf).toBe('Aucun croisement détecté aujourd\'hui.');
    expect(note.today).toEqual([]);
  });
});

describe('buildBilan', () => {
  const rules = [{ id: 'r1', version: 1, title: 'Règle un', arrivalTest: 'test un' }, { id: 'r2', version: 1, title: 'Règle deux', arrivalTest: 'test deux' }];
  it('bilan counts per word and rule', () => {
    const list = [
      sc('a', { status: 'arrive' }), sc('b', { status: 'pas_arrive' }), sc('c', { status: 'indecidable' }), sc('d', { status: 'expire' }),
      sc('e', { ruleId: 'r2', word: 'peu_probable', status: 'arrive', feedback: { utile: 2, deja_su: 0, faux: 0 } }),
      sc('m', { status: 'manque', word: '' }), sc('o', { status: 'ouvert' }),
    ];
    const b = buildBilan('2026-11', list, rules);
    expect(b).toMatchObject({ month: '2026-11', emitted: 6, arrived: 2, notArrived: 1, undecided: 2, missed: 1 });
    expect(b.byWord).toEqual([{ word: 'peu_probable', closed: 1, arrived: 1, percent: null }, { word: 'probable', closed: 2, arrived: 1, percent: null }]);
    expect(b.byRule.find((r: { ruleId: string }) => r.ruleId === 'r2')).toMatchObject({ emitted: 1, arrived: 1, useful: 2, inReview: false, arrivalTest: 'test deux' });
  });
  it('gives a percentage from 30 closed per word, not at 29', () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => sc(`k${i}`, { status: i < 15 ? 'arrive' : 'pas_arrive' }));
    expect(buildBilan('2026-11', mk(29), rules).byWord[0].percent).toBeNull();
    expect(buildBilan('2026-11', mk(30), rules).byWord[0].percent).toBe(50);
  });
  it('rule with 6/10 probable not arrived goes in review and is dropped by capOpen', () => {
    const closed = Array.from({ length: 10 }, (_, i) => sc(`c${i}`, { status: i < 6 ? 'pas_arrive' : 'arrive' }));
    const b = buildBilan('2026-11', closed, rules);
    expect(b.byRule.find((r: { ruleId: string }) => r.ruleId === 'r1').inReview).toBe(true);
    const fine = buildBilan('2026-11', closed.map((s, i) => ({ ...s, status: i < 5 ? 'pas_arrive' : 'arrive' })), rules);
    expect(fine.byRule[0].inReview).toBe(false); // 5/10 : pas plus de la moitié
    const open = [sc('o1'), sc('o2', { ruleId: 'r2' })];
    const kept = capOpen(open, NOW, rulesInReview(closed, rules));
    expect(kept.map((s: { id: string }) => s.id)).toEqual(['o2']);
    expect(capOpen(open, NOW)).toHaveLength(2);
  });
});

describe('rulesInReview', () => {
  const rules = [{ id: 'r1', version: 2, title: 'R', arrivalTest: 't' }];
  const closedSet = (n: number, notArrived: number, over: Record<string, unknown> = {}) => Array.from({ length: n }, (_, i) => sc(`c${i}`, { ruleVersion: 2, status: i < notArrived ? 'pas_arrive' : 'arrive', ...over }));
  it('9 closed all not arrived is not in review', () => {
    expect(rulesInReview(closedSet(9, 9), rules).size).toBe(0);
    expect(rulesInReview(closedSet(10, 6), rules).has('r1')).toBe(true);
  });
  it('lower words are excluded from the ratio', () => {
    const list = [...closedSet(6, 6), ...closedSet(8, 8, { word: 'possibilite_reelle', id: 'low' })].map((s, i) => ({ ...s, id: `x${i}` }));
    expect(rulesInReview(list, rules).size).toBe(0); // 6 probables seulement
  });
  it('indecidable and expire are excluded', () => {
    const list = [...closedSet(9, 9), ...closedSet(5, 0, { status: 'indecidable' }), ...closedSet(5, 0, { status: 'expire' })].map((s, i) => ({ ...s, id: `x${i}` }));
    expect(rulesInReview(list, rules).size).toBe(0);
  });
  it('judges the peak word: a decayed scenario still counts', () => {
    const list = closedSet(10, 10, { word: 'peu_probable', peakWord: 'tres_probable' });
    expect(rulesInReview(list, rules).has('r1')).toBe(true);
  });
  it('bumping the rule version clears the review', () => {
    const list = closedSet(10, 10);
    expect(rulesInReview(list, rules).has('r1')).toBe(true);
    expect(rulesInReview(list, [{ ...rules[0], version: 3 }]).size).toBe(0);
  });
});

describe('note de 7 h figée', () => {
  let dir = '';
  const readers = () => ({
    readProtests: async () => ({ readAt: iso(NOW), items: [] }), readVigilance: async () => null, readRail: async () => ({ at: iso(NOW), situations: [] }),
    readRoom: async () => ({ generatedAt: iso(NOW), outages: [] }), readCyber: async () => null, readEcowatt: async () => null, readFuel: async () => null, readNews: async () => [],
  });
  const notes = () => readdir(path.join(dir, 'notes')).catch(() => [] as string[]);
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'antic-note-'));
    process.env.ANTICIPATION_DIR = dir;
    __resetAnticipationForTests();
  });
  afterEach(async () => { delete process.env.ANTICIPATION_DIR; await rm(dir, { recursive: true, force: true }); });

  it('note frozen once after 07:00 Paris', async () => {
    await tickAnticipation(Date.parse('2026-11-04T05:30:00Z'), readers()); // 06:30 à Paris
    expect(await notes()).toEqual([]);
    await tickAnticipation(NOW, readers()); // 07:05
    expect(await notes()).toEqual(['2026-11-04.json']);
    const first = await readFile(path.join(dir, 'notes', '2026-11-04.json'), 'utf8');
    await tickAnticipation(NOW + 10 * 60_000, readers());
    expect(await readFile(path.join(dir, 'notes', '2026-11-04.json'), 'utf8')).toBe(first);
    // redémarrage : le fichier existe, il n'est pas réécrit
    __resetAnticipationForTests();
    await tickAnticipation(NOW + 3_600_000, readers());
    expect(await readFile(path.join(dir, 'notes', '2026-11-04.json'), 'utf8')).toBe(first);
    expect(JSON.parse(first).bluf).toBe('Aucun croisement détecté aujourd\'hui.');
  });

  async function seedReview(version: number) {
    const rule = RULES[0];
    const lines = Array.from({ length: 10 }, (_, i) => sc(`${rule.id}:national:old${i}`, {
      ruleId: rule.id, ruleVersion: version, status: i < 6 ? 'pas_arrive' : 'arrive', closedAt: '2026-11-03T20:00:00.000Z',
      window: { from: '2026-11-02T08:00:00.000Z', to: '2026-11-02T16:00:00.000Z' }, openedAt: '2026-11-02T06:00:00.000Z',
    }));
    lines.push(sc(`${rule.id}:national:live`, { ruleId: rule.id, ruleVersion: version, window: { from: iso(NOW + 3_600_000), to: iso(NOW + 7_200_000) }, openedAt: iso(NOW - 3_600_000) }));
    await mkdir(path.join(dir, 'journal'), { recursive: true });
    await writeFile(path.join(dir, 'journal', '2026-11.jsonl'), lines.map((scenario) => JSON.stringify({ at: scenario.openedAt, type: 'ouverture', scenario })).join('\n') + '\n');
    return `${rule.id}:national:live`;
  }
  it('withholds the scenarios of a rule in review, and the bilan flag agrees', async () => {
    const liveId = await seedReview(RULES[0].version);
    const snap = await anticipationSnapshot(NOW, readers());
    expect(snap.scenarios.map((x: { id: string }) => x.id)).not.toContain(liveId);
    const bilan = await anticipationBilan('2026-11', NOW, readers());
    expect(bilan.byRule.find((r: { ruleId: string }) => r.ruleId === RULES[0].id).inReview).toBe(true);
  });
  it('serves the scenarios again when the stored version is older than the rule version', async () => {
    const liveId = await seedReview(RULES[0].version - 1);
    const snap = await anticipationSnapshot(NOW, readers());
    expect(snap.scenarios.map((x: { id: string }) => x.id)).toContain(liveId);
    const bilan = await anticipationBilan('2026-11', NOW, readers());
    expect(bilan.byRule.find((r: { ruleId: string }) => r.ruleId === RULES[0].id).inReview).toBe(false);
  });
  it('records degraded inputs in the frozen note and serves today or yesterday without a day', async () => {
    await tickAnticipation(NOW, { ...readers(), readCyber: async () => { throw new Error('x'); } });
    const note = JSON.parse(await readFile(path.join(dir, 'notes', '2026-11-04.json'), 'utf8'));
    expect(Array.isArray(note.degraded)).toBe(true);
    expect((await anticipationNote(null, NOW, readers())).day).toBe('2026-11-04');
    expect((await anticipationNote(null, NOW + 20 * 3_600_000, readers())).day).toBe('2026-11-04'); // 02:05 le lendemain : la veille
    expect(await anticipationNote(null, NOW + 3 * 86_400_000 - 4 * 3_600_000, readers())).toBeNull();
  });

  it('note and bilan handlers validate queries and serve files', async () => {
    const mk = () => { const h: Record<string, string> = {}; const r = { statusCode: 200, body: undefined as unknown, h, setHeader: (k: string, v: string) => { h[k.toLowerCase()] = v; }, status(c: number) { r.statusCode = c; return r; }, json(b: unknown) { r.body = b; return r; }, end() { return r; } }; return r; };
    const get = async (handler: (a: unknown, b: unknown) => Promise<void>, query: Record<string, string>) => { const res = mk(); await handler({ method: 'GET', headers: {}, query }, res); return res; };
    expect((await get(noteHandler, { day: '2026-13-45' })).statusCode).toBe(400);
    await tickAnticipation(Date.now(), readers()); // tick frais : les gestionnaires ne relancent pas les vrais relevés
    expect((await get(noteHandler, { day: '2020-01-02' })).statusCode).toBe(404);
    expect((await get(bilanHandler, { month: '2026-13' })).statusCode).toBe(400);
    expect((await get(bilanHandler, { month: '' })).statusCode).toBe(400);
    await mkdir(path.join(dir, 'notes'), { recursive: true });
    await writeFile(path.join(dir, 'notes', '2020-01-02.json'), JSON.stringify({ day: '2020-01-02', bluf: 'x' }));
    const served = await get(noteHandler, { day: '2020-01-02' });
    expect(served.statusCode).toBe(200);
    expect(served.body).toMatchObject({ bluf: 'x' });
    const dayNow = new Date().toISOString().slice(0, 10);
    await writeFile(path.join(dir, 'notes', `${dayNow}.json`), JSON.stringify({ day: dayNow, bluf: 'auj' }));
    expect((await get(noteHandler, {})).body).toMatchObject({ bluf: 'auj' }); // sans jour : aujourd'hui
    const bilan = await get(bilanHandler, {});
    expect(bilan.statusCode).toBe(200);
    expect(bilan.h['cache-control']).toBe('s-maxage=300, stale-while-revalidate=600');
    expect((await get(bilanHandler, { month: '2025-01' })).body).toMatchObject({ month: '2025-01', emitted: 0 });
  });
});
