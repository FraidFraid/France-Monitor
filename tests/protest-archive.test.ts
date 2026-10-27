// tests/protest-archive.test.ts : archive horaire de la couche Manifestations tenue par la VM (27/10/2026) : fusion
// (api/_lib/protest-archive.js), route /api/social/protests-archive, script du minuteur (scripts/archive-protests.mjs) et recopie
// par le workflow GitHub.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { archiveRow, isArchiveDay, mergeArchive, parseArchive } from '../api/_lib/protest-archive.js';
import handler from '../api/_handlers/social/protests-archive.js';

const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id, source: 'giletsjaunes', status: 'annonce', title: `R ${id}`, startsAt: '2026-10-31T13:00:00.000Z', city: 'Toulouse', articles: [{}, {}], ...extra,
});

describe('fusion de l\'archive (api/_lib/protest-archive.js)', () => {
  it('ligne d\'archive : nombre d\'articles sans leur liste, champs absents à null, premier et dernier relevé', () => {
    const row = archiveRow(item('a'), '2026-10-31T10:00:00Z');
    expect(row).toMatchObject({ id: 'a', articleCount: 2, participants: null, firstSeenAt: '2026-10-31T10:00:00Z', lastSeenAt: '2026-10-31T10:00:00Z' });
    expect(row).not.toHaveProperty('articles');
    expect(archiveRow(item('b', { articleCount: 7 }), 'x').articleCount).toBe(7);
  });
  it('par id : dernier état gardé, premier relevé conservé ; tri par début puis id ; ordre d\'arrivée indifférent', () => {
    const r1 = archiveRow(item('b', { status: 'annonce' }), '2026-10-31T10:00:00Z');
    const r2 = archiveRow(item('b', { status: 'signale', participants: 800 }), '2026-10-31T14:00:00Z');
    const other = archiveRow(item('a', { startsAt: '2026-10-31T09:00:00.000Z' }), '2026-10-31T10:00:00Z');
    for (const merged of [mergeArchive([r1, other], [r2]), mergeArchive([r2], [r1, other])]) {
      expect(merged.map((r) => r.id)).toEqual(['a', 'b']);
      expect(merged[1]).toMatchObject({ status: 'signale', participants: 800, firstSeenAt: '2026-10-31T10:00:00Z', lastSeenAt: '2026-10-31T14:00:00Z' });
    }
  });
  it('lecture : lignes coupées ou sans id ignorées ; jour au format AAAA-MM-JJ seulement', () => {
    const ok = JSON.stringify(archiveRow(item('a'), '2026-10-31T10:00:00Z'));
    expect(parseArchive([ok, '{"id":"b","last', '{"title":"x"}', ''].join('\n')).map((r) => r.id)).toEqual(['a']);
    expect(isArchiveDay('2026-10-31')).toBe(true);
    for (const bad of ['2026-10-31.jsonl', '../etc', '2026-13-45', null]) expect(isArchiveDay(bad)).toBe(false);
  });
});

describe('route et script du minuteur', () => {
  let dir = '';
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'fm-protests-'));
    process.env.PROTEST_ARCHIVE_DIR = dir;
  });
  afterEach(async () => {
    delete process.env.PROTEST_ARCHIVE_DIR;
    await rm(dir, { recursive: true, force: true });
  });

  const call = async (url: string) => {
    let status = 0;
    let body: unknown = null;
    const res = { setHeader: () => undefined, status: (s: number) => { status = s; return res; }, json: (b: unknown) => { body = b; } };
    await handler({ method: 'GET', url }, res);
    return { status, body };
  };

  it('/api/social/protests-archive : jours du plus récent au plus ancien, un jour, 404 et 400', async () => {
    await writeFile(path.join(dir, '2026-10-30.jsonl'), '');
    await writeFile(path.join(dir, '2026-10-31.jsonl'), `${JSON.stringify(archiveRow(item('a'), '2026-10-31T10:00:00Z'))}\n`);
    expect(await call('/api/social/protests-archive')).toEqual({ status: 200, body: { days: ['2026-10-31', '2026-10-30'] } });
    const one = await call('/api/social/protests-archive?day=2026-10-31');
    expect(one.status).toBe(200);
    expect((one.body as { items: Array<{ id: string }> }).items.map((r) => r.id)).toEqual(['a']);
    expect((await call('/api/social/protests-archive?day=2026-11-01')).status).toBe(404);
    expect((await call('/api/social/protests-archive?day=../x')).status).toBe(400);
  });

  it('script : deux relevés fusionnés dans le fichier du jour (UTC), écrit d\'un bloc', async () => {
    let readAt = '2026-10-31T10:00:00.000Z';
    let items = [item('a')];
    const server = createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ readAt, items })); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/social/protests`;
    const run = () => promisify(execFile)(process.execPath, ['scripts/archive-protests.mjs'], { env: { ...process.env, PROTESTS_URL: url, PROTEST_ARCHIVE_DIR: dir } });
    try {
      expect((await run()).stdout).toContain('1 dans');
      readAt = '2026-10-31T11:00:00.000Z';
      items = [item('a', { status: 'signale' }), item('b')];
      await run();
    } finally {
      server.close();
    }
    const day = new Date().toISOString().slice(0, 10);
    const rows = parseArchive(await readFile(path.join(dir, `${day}.jsonl`), 'utf8'));
    expect(rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(rows[0]).toMatchObject({ status: 'signale', firstSeenAt: '2026-10-31T10:00:00.000Z', lastSeenAt: '2026-10-31T11:00:00.000Z' });
  });

  it('script : couche sans readAt → arrêt en erreur, aucun fichier écrit', async () => {
    const server = createServer((_req, res) => { res.end(JSON.stringify({ readAt: null, items: [], errors: ['x'] })); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    try {
      await expect(promisify(execFile)(process.execPath, ['scripts/archive-protests.mjs'], { env: { ...process.env, PROTESTS_URL: url, PROTEST_ARCHIVE_DIR: dir } })).rejects.toThrow(/ARRET/);
    } finally {
      server.close();
    }
    expect(await call('/api/social/protests-archive')).toEqual({ status: 200, body: { days: [] } });
  });
});

describe('minuteur de la VM et recopie hors VM', () => {
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  it('toutes les heures à :23, écrit seulement dans le dossier de données', () => {
    expect(read('deploy/oracle/systemd/fm-archive-protests.timer')).toContain('OnCalendar=*-*-* *:23:00');
    const svc = read('deploy/oracle/systemd/fm-archive-protests.service');
    expect(svc).toContain('ExecStart=/usr/bin/node scripts/archive-protests.mjs');
    expect(svc).toContain('ReadWritePaths=/var/lib/francemonitor/data');
  });
  it('le workflow recopie hier et aujourd\'hui depuis la VM, avec la même fusion', () => {
    const wf = read('.github/workflows/archive-protests.yml');
    expect(wf).toContain('/api/social/protests-archive?day=$d');
    expect(wf).toContain('date -u -d yesterday +%F');
    expect(wf.match(/group_by\(\.id\)/g)).toHaveLength(1);
  });
});
