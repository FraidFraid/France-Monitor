// tests/anticipation-registry.test.ts : registre sur disque de l'anticipation (04/11/2026).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, readdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error module JS sans déclaration
import { openRegistry } from '../api/_lib/anticipation/registry.js';

const NOW = Date.parse('2026-11-04T10:00:00Z');
const MIN = 60_000;

function scenario(id: string, word: string) {
  return {
    id, ruleId: 'r1', ruleVersion: 1, zone: { dept: ['75'], communes: [] }, window: { from: '2026-11-04T10:00:00Z', to: '2026-11-05T10:00:00Z' },
    title: 't', chain: [], word, why: 'w', unknowns: [], bascules: [], disconfirmers: [], verify: [],
    openedAt: '2026-11-04T10:00:00Z', revisedAt: '2026-11-04T10:00:00Z', status: 'ouvert', closedAt: null, outcomeNote: null,
    feedback: { utile: 0, deja_su: 0, faux: 0 },
  };
}
function sig(id: string, level = 'jaune', kind = 'vigilance', dept = '75') {
  return { id, domain: 'meteo', kind, source: 's', origin: 'o', official: true, dept: [dept], communes: [], level, value: 1, window: null, publishedAt: null, observedAt: null, checkedAt: null, ref: 'x' };
}

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'antic-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('registry', () => {
  it('record then reload restores open scenarios', async () => {
    const reg = await openRegistry({ dir, now: NOW });
    await reg.record({ at: '2026-11-04T10:00:00Z', type: 'ouverture', scenario: scenario('a', 'peu_probable') });
    await reg.record({ at: '2026-11-04T11:00:00Z', type: 'revision', scenario: scenario('a', 'probable') });
    const again = await openRegistry({ dir, now: NOW + 3600_000 });
    expect(again.state().size).toBe(1);
    expect(again.state().get('a').word).toBe('probable');
    expect(again.writable).toBe(true);
  });

  it('replays the previous month too', async () => {
    const reg = await openRegistry({ dir, now: Date.parse('2026-10-30T10:00:00Z') });
    await reg.record({ at: '2026-10-30T10:00:00Z', type: 'ouverture', scenario: scenario('b', 'probable') });
    const again = await openRegistry({ dir, now: Date.parse('2026-11-02T10:00:00Z') });
    expect(again.state().has('b')).toBe(true);
  });

  it('archive skips unchanged signals within 15 min', async () => {
    const reg = await openRegistry({ dir, now: NOW });
    const list = [sig('a'), sig('b')];
    await reg.archiveSignals(list, NOW);
    await reg.archiveSignals(list, NOW + 5 * MIN);
    const file = path.join(dir, 'signals', '2026-11-04.jsonl');
    expect((await readFile(file, 'utf8')).trim().split('\n')).toHaveLength(1);
    await reg.archiveSignals([sig('a'), sig('b', 'rouge')], NOW + 6 * MIN);
    expect((await readFile(file, 'utf8')).trim().split('\n')).toHaveLength(2);
    await reg.archiveSignals([sig('a'), sig('b', 'rouge')], NOW + 22 * MIN);
    expect((await readFile(file, 'utf8')).trim().split('\n')).toHaveLength(3);
  });

  it('unwritable dir → writable false, record still updates memory, errors names the dir', async () => {
    const blocker = path.join(dir, 'fichier');
    await writeFile(blocker, 'x');
    const bad = path.join(blocker, 'sous');
    const reg = await openRegistry({ dir: bad, now: NOW });
    await reg.record({ at: '2026-11-04T10:00:00Z', type: 'ouverture', scenario: scenario('a', 'probable') });
    await reg.archiveSignals([sig('a')], NOW);
    expect(reg.writable).toBe(false);
    expect(reg.state().get('a').word).toBe('probable');
    expect(reg.errors.some((e: string) => e.includes(bad))).toBe(true);
  });

  it('compact replaces files older than 13 months by a summary', async () => {
    const reg = await openRegistry({ dir, now: NOW });
    const old = Date.parse('2025-08-01T10:00:00Z');
    await reg.archiveSignals([sig('a'), sig('b'), sig('c', 'jaune', 'panne', '69')], old);
    await reg.archiveSignals([sig('a')], NOW);
    await reg.compact(NOW);
    await reg.compact(NOW);
    const files = (await readdir(path.join(dir, 'signals'))).sort();
    expect(files).toEqual(['2025-08-01.summary.json', '2026-11-04.jsonl']);
    const summary = JSON.parse(await readFile(path.join(dir, 'signals', '2025-08-01.summary.json'), 'utf8'));
    expect(summary.counts['vigilance|75']).toBe(2);
    expect(summary.counts['panne|69']).toBe(1);
  });

  it('truncated last line does not corrupt the next event', async () => {
    const reg = await openRegistry({ dir, now: NOW });
    await reg.record({ at: '2026-11-04T10:00:00Z', type: 'ouverture', scenario: scenario('a', 'peu_probable') });
    const file = path.join(dir, 'journal', '2026-11.jsonl');
    await appendFile(file, '{"at":"2026-11-04T10:30:00Z","type":"revi');
    const second = await openRegistry({ dir, now: NOW });
    await second.record({ at: '2026-11-04T11:00:00Z', type: 'ouverture', scenario: scenario('b', 'probable') });
    const third = await openRegistry({ dir, now: NOW });
    expect(third.state().get('b').word).toBe('probable');
    expect(third.state().get('a').word).toBe('peu_probable');
    expect(third.errors.some((e: string) => e.includes('journal/2026-11.jsonl') && e.includes('1 ligne illisible ignorée'))).toBe(true);
  });

  it('unreadable journal is reported, not swallowed', async () => {
    await mkdir(path.join(dir, 'journal', '2026-11.jsonl'), { recursive: true });
    const reg = await openRegistry({ dir, now: NOW });
    expect(reg.errors.some((e: string) => e.includes('journal/2026-11.jsonl'))).toBe(true);
  });

  it('non awaited records keep call order on disk', async () => {
    const reg = await openRegistry({ dir, now: NOW });
    const jobs = [];
    for (let i = 0; i < 20; i++) jobs.push(reg.record({ at: '2026-11-04T10:00:00Z', type: 'revision', scenario: scenario('a', `mot${i}`) }));
    jobs.push(reg.archiveSignals([sig('a')], NOW));
    await Promise.all(jobs);
    const again = await openRegistry({ dir, now: NOW });
    expect(again.state().get('a').word).toBe(reg.state().get('a').word);
    expect(again.state().get('a').word).toBe('mot19');
  });

  it('writable recovers after a later successful append', async () => {
    const reg = await openRegistry({ dir, now: NOW });
    await rm(dir, { recursive: true, force: true });
    await writeFile(dir, 'x');
    await reg.record({ at: '2026-11-04T10:00:00Z', type: 'ouverture', scenario: scenario('a', 'probable') });
    expect(reg.writable).toBe(false);
    await rm(dir, { force: true });
    await reg.record({ at: '2026-11-04T10:00:00Z', type: 'revision', scenario: scenario('a', 'tres_probable') });
    expect(reg.writable).toBe(true);
  });

  it('compaction errors do not flip writable', async () => {
    const reg = await openRegistry({ dir, now: NOW });
    await mkdir(path.join(dir, 'signals', '2020-01-01.jsonl'), { recursive: true });
    await reg.compact(NOW);
    expect(reg.writable).toBe(true);
    expect(reg.errors.some((e: string) => e.includes('compaction'))).toBe(true);
  });

  it('reads ANTICIPATION_DIR when no dir option is given', async () => {
    const prev = process.env.ANTICIPATION_DIR;
    process.env.ANTICIPATION_DIR = dir;
    try {
      const reg = await openRegistry({ now: NOW });
      await reg.record({ at: '2026-11-04T10:00:00Z', type: 'ouverture', scenario: scenario('a', 'probable') });
      expect(await readdir(path.join(dir, 'journal'))).toEqual(['2026-11.jsonl']);
    } finally {
      if (prev === undefined) delete process.env.ANTICIPATION_DIR; else process.env.ANTICIPATION_DIR = prev;
    }
  });
});
