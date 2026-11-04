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

  it('archive: snapshot first, then only changes, a new snapshot after 3 h', async () => {
    const reg = await openRegistry({ dir, now: NOW });
    const list = [sig('a'), sig('b')];
    await reg.archiveSignals(list, NOW);
    await reg.archiveSignals(list.map((s) => ({ ...s, checkedAt: '2026-11-04T10:05:00Z' })), NOW + 5 * MIN);
    const file = path.join(dir, 'signals', '2026-11-04.jsonl');
    const rows = async () => (await readFile(file, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    expect(await rows()).toHaveLength(1);
    await reg.archiveSignals([sig('b', 'rouge'), sig('c')], NOW + 6 * MIN);
    const [first, second] = await rows();
    expect(first.signals.map((x: { id: string }) => x.id)).toEqual(['a', 'b']);
    expect(second.signals).toBeUndefined();
    expect(second.add.map((x: { id: string; level: string }) => `${x.id}:${x.level}`)).toEqual(['b:rouge', 'c:jaune']);
    expect(second.drop).toEqual(['a']);
    await reg.archiveSignals([sig('b', 'rouge'), sig('c')], NOW + 22 * MIN);
    expect(await rows()).toHaveLength(2);
    await reg.archiveSignals([sig('b', 'rouge'), sig('c')], NOW + 3 * 60 * MIN);
    const third = (await rows())[2];
    expect(third.signals.map((x: { id: string }) => x.id)).toEqual(['b', 'c']);
  });

  it('signalsBetween rebuilds the state at the window start from snapshots and changes', async () => {
    const reg = await openRegistry({ dir, now: NOW });
    await reg.archiveSignals([sig('a'), sig('b')], NOW - 60 * MIN);
    await reg.archiveSignals([sig('b'), sig('c', 'orange')], NOW - 30 * MIN); // a disparaît avant la fenêtre
    await reg.archiveSignals([sig('b'), sig('c', 'rouge')], NOW + 30 * MIN);
    await reg.archiveSignals([sig('d')], NOW + 2 * 60 * MIN); // après la fenêtre
    const got = await reg.signalsBetween(new Date(NOW).toISOString(), new Date(NOW + 60 * MIN).toISOString());
    expect(got.map((s: { id: string; level: string }) => `${s.id}:${s.level}`)).toEqual(['b:jaune', 'c:orange', 'c:rouge']);
    // Aucune ligne dans la fenêtre : l'état de la dernière ligne (récente) est encore présent.
    const quiet = await reg.signalsBetween(new Date(NOW + 40 * MIN).toISOString(), new Date(NOW + 50 * MIN).toISOString());
    expect(quiet.map((s: { id: string }) => s.id)).toEqual(['b', 'c']);
  });

  it('signalsBetween does not carry a state older than 3 h 15 (service stopped)', async () => {
    const reg = await openRegistry({ dir, now: NOW });
    await reg.archiveSignals([sig('a')], Date.parse('2026-11-04T06:00:00Z'));
    const got = await reg.signalsBetween('2026-11-04T10:00:00Z', '2026-11-04T11:00:00Z');
    expect(got).toEqual([]);
  });

  it('a busy day of 1 000 announced gatherings stays far under the daily cap', async () => {
    const reg = await openRegistry({ dir, now: NOW });
    const base = Array.from({ length: 1000 }, (_, i) => sig(`r${i}`, 'jaune', 'rassemblement_annonce', String(10 + (i % 80))));
    for (let m = 0; m < 240; m++) {
      // Une annonce change de niveau chaque minute, les autres ne bougent que d'horodatage.
      const list = base.map((s, i) => (i === m % 1000 ? { ...s, level: m % 2 ? 'orange' : 'jaune' } : { ...s, checkedAt: new Date(NOW + m * MIN).toISOString() }));
      await reg.archiveSignals(list, NOW + m * MIN);
    }
    const size = (await readFile(path.join(dir, 'signals', '2026-11-04.jsonl'), 'utf8')).length;
    // Ancien format (un instantané par changement) : 240 lignes d'environ 150 Ko, soit plus de 30 Mo.
    expect(size).toBeLessThan(1024 * 1024);
  }, 30_000);

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

  it('compact replaces files older than 3 months by a summary', async () => {
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

describe('archive des signaux bornée (revue finale)', () => {
  const NEWS_NOW = Date.parse('2026-11-04T12:00:00Z');
  const cats = ['security', 'social', 'energy', 'weather', 'transport', 'finance', 'health'];
  const sevs = ['info', 'low', 'medium', 'high', 'critical'];
  const newsItems = (worst: boolean) => Array.from({ length: 1000 }, (_, i) => ({
    id: `n${i}`, eventId: 100000 + i,
    title: `Titre assez long de l'article numéro ${i} sur une grève SNCF à Lyon, avec des détails et encore des détails`,
    link: `https://www.example-presse.fr/actualite/2026/11/04/article-${i}-avec-un-chemin-long`,
    publishedAt: new Date(NEWS_NOW - (i % 20) * 3_600_000).toISOString(),
    severity: worst ? 'critical' : sevs[i % 5], category: worst ? 'security' : cats[i % 7], feedName: 'Le Progrès', lat: 45.76, lon: 4.83,
  }));

  it('1000 news items → archived line under 64 KB, without title nor link', async () => {
    // @ts-expect-error module JS sans déclaration
    const { toSignals } = await import('../api/_lib/anticipation/signals.js');
    for (const worst of [false, true]) {
      const sub = await mkdtemp(path.join(tmpdir(), 'antic-size-'));
      try {
        const reg = await openRegistry({ dir: sub, now: NEWS_NOW });
        const { signals } = toSignals({ news: newsItems(worst) }, NEWS_NOW);
        expect(signals.length).toBeGreaterThanOrEqual(1000);
        await reg.archiveSignals(signals, NEWS_NOW);
        const line = (await readFile(path.join(sub, 'signals', '2026-11-04.jsonl'), 'utf8')).trim();
        expect(Buffer.byteLength(line)).toBeLessThan(64 * 1024);
        expect(line).not.toContain('Titre assez long');
        expect(line).not.toContain('example-presse');
        const kept = JSON.parse(line).signals as Array<{ kind: string; meta?: { category?: string; severity?: string } }>;
        // Les plus utiles aux tests d'arrivée d'abord : aucun signal de presse gardé hors du filtre.
        expect(kept.every((s) => s.kind === 'mouvement_social_transport' || ['security', 'social'].includes(String(s.meta?.category)) || ['high', 'critical'].includes(String(s.meta?.severity)))).toBe(true);
      } finally { await rm(sub, { recursive: true, force: true }); }
    }
  });

  it('archivedCopy keeps non-press signals, drops unlocated or minor press, strips long fields', async () => {
    // @ts-expect-error module JS sans déclaration
    const { archivedCopy } = await import('../api/_lib/anticipation/registry.js');
    const press = (id: string, dept: string[], category: string, severity: string) => ({
      id, domain: 'press', kind: 'presse', source: 'Flux', origin: `presse:event:${id}`, official: false, dept, communes: [], level: null, value: null, window: null,
      publishedAt: '2026-11-04T09:00:00.000Z', observedAt: '2026-11-04T10:00:00.000Z', checkedAt: '2026-11-04T10:00:00.000Z', ref: 'https://x.fr/a',
      meta: { eventId: 1, category, severity, title: 'Un titre' },
    });
    const out = archivedCopy([
      sig('v1'), press('p1', ['69'], 'security', 'low'), press('p2', [], 'security', 'critical'), press('p3', ['69'], 'energy', 'medium'),
      press('p4', ['13'], 'energy', 'high'), { ...sig('fuel', 'jaune', 'tension_carburant'), meta: { national: true, previousValue: 12 } },
    ]);
    expect(out.map((s: { id: string }) => s.id)).toEqual(['v1', 'p1', 'p4', 'fuel']);
    expect(out.every((s: Record<string, unknown>) => !('ref' in s) && !('source' in s) && !('communes' in s))).toBe(true);
    expect(out[1].meta).toEqual({ eventId: 1, category: 'security', severity: 'low' });
    expect(out[3].meta).toEqual({ national: true, previousValue: 12 });
  });

  it('streaming read returns the same records as before (window filter, cut line ignored)', async () => {
    const reg = await openRegistry({ dir, now: NOW });
    await reg.archiveSignals([sig('a')], NOW - 60 * MIN);
    await reg.archiveSignals([sig('a', 'orange'), sig('b')], NOW);
    await appendFile(path.join(dir, 'signals', '2026-11-04.jsonl'), '{"at":"2026-11-04T10:30:00.000Z","signals":[{"id":"cou');
    const again = await openRegistry({ dir, now: NOW });
    await again.archiveSignals([sig('c', 'rouge')], NOW + 60 * MIN);
    const inWindow = await again.signalsBetween(new Date(NOW - MIN).toISOString(), new Date(NOW + 61 * MIN).toISOString());
    // a:jaune est l'état au début de la fenêtre ; le redémarrage écrit un instantané (c seul).
    expect(inWindow.map((s: { id: string; level: string }) => `${s.id}:${s.level}`)).toEqual(['a:jaune', 'a:orange', 'b:jaune', 'c:rouge']);
    const all = await again.signalsBetween(new Date(NOW - 2 * 60 * MIN).toISOString(), new Date(NOW + 2 * 60 * MIN).toISOString());
    expect(all.map((s: { id: string }) => s.id)).toEqual(['a', 'a', 'b', 'c']);
    // La ligne coupée a été close par un saut de ligne avant l'ajout suivant : quatre lignes, dont une illisible.
    const lines = (await readFile(path.join(dir, 'signals', '2026-11-04.jsonl'), 'utf8')).split('\n').filter(Boolean);
    expect(lines).toHaveLength(4);
  });

  it('last-byte check: only the trailing byte decides the newline', async () => {
    // @ts-expect-error module JS sans déclaration
    const { endsWithNewline } = await import('../api/_lib/anticipation/registry.js');
    const f = path.join(dir, 'f.jsonl');
    expect(await endsWithNewline(f)).toBe(true); // absent
    await writeFile(f, '');
    expect(await endsWithNewline(f)).toBe(true); // vide
    await writeFile(f, `${'x'.repeat(100_000)}\n`);
    expect(await endsWithNewline(f)).toBe(true);
    await appendFile(f, '{"coupé');
    expect(await endsWithNewline(f)).toBe(false);
  });

  it('size guard: a day file over the cap stops appending that day and names it once', async () => {
    const reg = await openRegistry({ dir, now: NOW, archiveMaxBytes: 200 });
    await reg.archiveSignals([sig('a')], NOW);
    await reg.archiveSignals([sig('a'), sig('b')], NOW + MIN);
    const file = path.join(dir, 'signals', '2026-11-04.jsonl');
    const before = (await readFile(file, 'utf8')).split('\n').filter(Boolean).length;
    await reg.archiveSignals([sig('a'), sig('b'), sig('c')], NOW + 2 * MIN);
    await reg.archiveSignals([sig('a'), sig('d')], NOW + 3 * MIN);
    expect((await readFile(file, 'utf8')).split('\n').filter(Boolean).length).toBe(before);
    expect(reg.errors.filter((e: string) => e === 'archive des signaux du 2026-11-04 : plafond de 50\u00a0Mo atteint')).toHaveLength(1);
    // Jour suivant : nouveau fichier, ajouts repris.
    await reg.archiveSignals([sig('e')], NOW + 24 * 60 * MIN);
    expect((await readFile(path.join(dir, 'signals', '2026-11-05.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(1);
  });
});
