// tests/anticipation-registry.test.ts : registre sur disque de l'anticipation (04/11/2026).
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile, writeFile } from 'node:fs/promises';
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
});
