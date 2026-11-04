// tests/anticipation-room.test.ts : tick d'une minute de l'anticipation (api/_lib/anticipation/room.js, 04/11/2026) : lecteurs injectés,
// journal sur disque, tendance carburants (règle 5), instantané recalculé quand le tick est périmé, table des phénomènes miroir du client.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error module JS sans déclaration
import { __resetAnticipationForTests, anticipationSnapshot, recordFeedback, tickAnticipation } from '../api/_lib/anticipation/room.js';
// @ts-expect-error module JS sans déclaration
import { openRegistry } from '../api/_lib/anticipation/registry.js';
// @ts-expect-error module JS sans déclaration
import { PHENOMENON_WORD as SERVER_WORDS } from '../api/_shared/phenomenon-word.js';
import { PHENOMENON_WORD as CLIENT_WORDS } from '../src/services/environment-levels.ts';

const T0 = Date.parse('2026-11-04T12:00:00Z');
const iso = (t: number) => new Date(t).toISOString();

let dir = '';
let fuelShare = 20;
let fuelAt = iso(T0 - 5 * 60_000);
let throwing: string | null = null;
const strike = (id: number, title: string) => ({ id, eventId: id, title, link: `https://ex.fr/${id}`, publishedAt: iso(T0 - 3_600_000), severity: 'high', category: 'social', feedName: `Flux ${id}` });
const news = [strike(1, 'Grève et blocage de la raffinerie de Feyzin'), strike(2, 'Blocage du dépôt pétrolier de Fos : la raffinerie à l’arrêt')];

function readers() {
  const guard = <T>(name: string, value: T) => async () => { if (throwing === name) throw new Error(`${name} en panne`); return value; };
  return {
    readProtests: guard('protests', { readAt: iso(T0), items: [] }),
    readVigilance: guard('vigilance', null),
    readRail: guard('rail', { at: iso(T0), situations: [] }),
    readRoom: guard('room', { generatedAt: iso(T0), outages: [] }),
    readCyber: guard('cyber', null),
    readEcowatt: guard('ecowatt', null),
    readFuel: async () => { if (throwing === 'fuel') throw new Error('fuel en panne'); return { generatedAt: fuelAt, national: { anomalyShare: fuelShare }, summaries: [{ departmentCode: '13', anomalyShare: fuelShare }] }; },
    readNews: guard('news', news),
  };
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'antic-room-'));
  process.env.ANTICIPATION_DIR = dir;
  __resetAnticipationForTests();
  fuelShare = 20; fuelAt = iso(T0 - 5 * 60_000); throwing = null;
});
afterEach(async () => { delete process.env.ANTICIPATION_DIR; await rm(dir, { recursive: true, force: true }); });

async function journal() {
  const files = await readdir(path.join(dir, 'journal')).catch(() => [] as string[]);
  const lines = (await Promise.all(files.map((f) => readFile(path.join(dir, 'journal', f), 'utf8')))).join('').split('\n').filter(Boolean);
  return lines.map((l) => JSON.parse(l));
}

describe('tick de l’anticipation', () => {
  it('tick opens a scenario from injected readers and writes the journal', async () => {
    await tickAnticipation(T0, readers());
    expect(await journal()).toEqual([]); // première lecture : aucune tendance carburants, aucun scénario
    fuelShare = 30; fuelAt = iso(T0 + 30_000);
    await tickAnticipation(T0 + 60_000, readers());
    const events = await journal();
    expect(events.map((e) => e.type)).toEqual(['ouverture']);
    expect(events[0].scenario.ruleId).toBe('greve-carburant');
    const snap = await anticipationSnapshot(T0 + 61_000, readers());
    expect(snap.scenarios).toHaveLength(1);
    // Tendance carburants : la part précédente (20) est injectée dans le signal cité.
    const fuel = Object.values(snap.signals as Record<string, { kind: string; meta?: { previousValue?: number } }>).filter((s) => s.kind === 'tension_carburant');
    expect(fuel.map((s) => s.meta?.previousValue)).toEqual([20]);
    // Seuls les signaux cités par les scénarios servis sont rendus.
    const cited = new Set(snap.scenarios.flatMap((s: { chain: { signalIds: string[] }[] }) => s.chain.flatMap((c) => c.signalIds)));
    expect(Object.keys(snap.signals).every((id) => cited.has(id))).toBe(true);
  });

  it('keeps the fuel trend across a restart from the archived signals', async () => {
    await tickAnticipation(T0, readers());
    __resetAnticipationForTests(); // redémarrage : mémoire vidée, disque gardé
    fuelShare = 30; fuelAt = iso(T0 + 30_000);
    await tickAnticipation(T0 + 60_000, readers());
    expect((await journal()).map((e) => e.type)).toEqual(['ouverture']);
  });

  it('tick within 55 s does nothing', async () => {
    await tickAnticipation(T0, readers());
    fuelShare = 30; fuelAt = iso(T0 + 30_000);
    await tickAnticipation(T0 + 30_000, readers());
    expect(await journal()).toEqual([]);
    expect((await anticipationSnapshot(T0 + 31_000, readers())).generatedAt).toBe(iso(T0));
  });

  it('one reader throwing gives a null input, fills unknown and the tick completes', async () => {
    throwing = 'news';
    await tickAnticipation(T0, readers());
    const snap = await anticipationSnapshot(T0 + 1_000, readers());
    expect(snap.unknown).toContain('Presse non lue');
    expect(snap.beta).toBe(true);
    expect(snap.scenarios).toEqual([]);
  });

  it('football: not configured is named in the snapshot unknown; unrecognised stadium and collector errors surface', async () => {
    await tickAnticipation(T0, { ...readers(), readFootball: async () => ({ configured: false, readAt: iso(T0), matches: [], errors: [] }) });
    const a = await anticipationSnapshot(T0 + 1_000, readers());
    expect(a.unknown).toContain('Calendrier sportif non configuré');
    __resetAnticipationForTests();
    const match = { id: '1', competition: 'FL1', home: 'Club Inconnu', away: 'X', kickoff: iso(T0 + 3_600_000), venue: null, commune: null, dept: null };
    const monaco = { id: '2', competition: 'FL1', home: 'AS Monaco FC', away: 'Y', kickoff: iso(T0 + 3_600_000), venue: null, commune: null, dept: null, abroad: true };
    await tickAnticipation(T0, { ...readers(), readFootball: async () => ({ configured: true, readAt: iso(T0), matches: [match, monaco], errors: ['Calendrier sportif CL : HTTP 500'] }) });
    const b = await anticipationSnapshot(T0 + 1_000, readers());
    expect(b.unknown).toContain('Stade non reconnu : Club Inconnu');
    expect(b.unknown).toContain('Stade hors de France : AS Monaco FC');
    expect(b.unknown).not.toContain('Stade non reconnu : AS Monaco FC');
    expect(b.unknown).not.toContain('Calendrier sportif non configuré');
    expect(b.errors).toContain('Calendrier sportif CL : HTTP 500');
  });

  it('snapshot recomputes when tick is stale', async () => {
    await tickAnticipation(T0, readers());
    const later = T0 + 4 * 60_000;
    const snap = await anticipationSnapshot(later, readers());
    expect(snap.generatedAt).toBe(iso(later));
    const fresh = await anticipationSnapshot(later + 10_000, readers());
    expect(fresh.generatedAt).toBe(iso(later));
  });

  it('keeps the earlier previous value when the same relevé is read again after a restart', async () => {
    await tickAnticipation(T0, readers()); // relevé A : 20
    fuelShare = 30; fuelAt = iso(T0 + 30_000);
    await tickAnticipation(T0 + 60_000, readers()); // relevé B : 30, précédent 20
    __resetAnticipationForTests();
    await tickAnticipation(T0 + 120_000, readers()); // même relevé B après redémarrage
    const snap = await anticipationSnapshot(T0 + 121_000, readers());
    const fuel = Object.values(snap.signals as Record<string, { kind: string; meta?: { previousValue?: number } }>).filter((s) => s.kind === 'tension_carburant');
    expect(fuel.map((s) => s.meta?.previousValue)).toEqual([20]);
    expect((await journal()).map((e) => e.type)).toEqual(['ouverture']);
  });

  it('a second identical tick writes no revision line', async () => {
    await tickAnticipation(T0, readers());
    fuelShare = 30; fuelAt = iso(T0 + 30_000);
    await tickAnticipation(T0 + 60_000, readers());
    await tickAnticipation(T0 + 120_000, readers());
    expect((await journal()).map((e) => e.type)).toEqual(['ouverture']);
  });

  it('readFuel throwing gives unknown "Carburants non lus" and the tick completes', async () => {
    throwing = 'fuel';
    await tickAnticipation(T0, readers());
    const snap = await anticipationSnapshot(T0 + 1_000, readers());
    expect(snap.unknown).toContain('Carburants non lus');
    expect(snap.generatedAt).toBe(iso(T0));
  });

  it('a reader that never resolves times out: null input and a "délai dépassé" error', async () => {
    const hung = { ...readers(), readNews: () => new Promise(() => {}), budgetMs: 20 };
    await tickAnticipation(T0, hung);
    const snap = await anticipationSnapshot(T0 + 1_000, hung);
    expect(snap.errors).toContain('Presse : délai dépassé');
    expect(snap.unknown).toContain('Presse non lue');
  });

  it('records a bascule line when a revised scenario reaches a bascule', async () => {
    let reached = false;
    const rule = {
      id: 'test-regle', version: 1, title: 't', domains: [], arrivalTest: 'x',
      arrived: () => null,
      evaluate: () => [{
        ruleId: 'test-regle', ruleVersion: 1, zone: { dept: [], communes: [] }, window: { from: iso(T0), to: iso(T0 + 6 * 3_600_000) }, title: 't',
        chain: [], word: 'possibilite_reelle', unknowns: [], disconfirmers: [], verify: [],
        bascules: [{ id: 'b', label: 'b', state: reached ? 'atteint' : 'surveille', at: reached ? iso(T0 + 60_000) : null }],
        evidence: { origins: 2, hasOfficial: false, hasPublishedDeadline: false, officialLevel: null, basculeHit: reached, precedentDay: null },
      }],
    };
    await tickAnticipation(T0, { ...readers(), rules: [rule] });
    reached = true;
    await tickAnticipation(T0 + 60_000, { ...readers(), rules: [rule] });
    expect((await journal()).map((e) => e.type)).toEqual(['ouverture', 'bascule']);
  });

  it('server phenomenon words mirror src/services/environment-levels.ts', () => {
    expect(SERVER_WORDS).toEqual(CLIENT_WORDS);
  });
  it('a failing tick: registry opened once, on-demand recompute at most once per minute, last state or empty beta snapshot served', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      let opens = 0;
      let broken = true;
      const open = async (at: number) => {
        opens += 1;
        const reg = await openRegistry({ dir, now: at });
        return { ...reg, archiveSignals: async (...args: unknown[]) => { if (broken) throw new Error('disque en panne'); return reg.archiveSignals(...args); } };
      };
      const r = { ...readers(), openRegistry: open };
      const a = await anticipationSnapshot(T0, r);
      expect(a.beta).toBe(true);
      expect(a.scenarios).toEqual([]);
      expect(a.errors).toContain('Anticipation momentanément indisponible : nouvel essai dans une minute');
      expect(opens).toBe(1);
      // Requêtes suivantes dans la minute : aucun nouveau tick (le compteur de lectures ne bouge pas).
      let reads = 0;
      const counted = { ...r, readProtests: async () => { reads += 1; return { readAt: iso(T0), items: [] }; } };
      await anticipationSnapshot(T0 + 10_000, counted);
      await anticipationSnapshot(T0 + 59_000, counted);
      expect(reads).toBe(0);
      // Une minute après l'échec : un nouvel essai, toujours en échec, sans rouvrir le registre.
      await anticipationSnapshot(T0 + 61_000, counted);
      expect(reads).toBe(1);
      expect(opens).toBe(1);
      // Réparé : l'essai suivant réussit, l'erreur d'échec disparaît.
      broken = false;
      const ok = await anticipationSnapshot(T0 + 125_000, counted);
      expect(reads).toBe(2);
      expect(opens).toBe(1);
      expect(ok.errors).not.toContain('Anticipation momentanément indisponible : nouvel essai dans une minute');
      expect(ok.generatedAt).toBe(iso(T0 + 125_000));
      // Le détail interne part une fois dans le journal du service.
      expect(quiet.mock.calls.filter((c) => String(c[1]).includes('disque en panne'))).toHaveLength(1);
    } finally { quiet.mockRestore(); }
  });

  it('public errors carry no server path; the detail is logged once', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { writeFile } = await import('node:fs/promises');
      const blocker = path.join(dir, 'bloque');
      await writeFile(blocker, 'x');
      const bad = path.join(blocker, 'sous');
      const r = { ...readers(), openRegistry: (at: number) => openRegistry({ dir: bad, now: at }) };
      await tickAnticipation(T0, r);
      const snap = await anticipationSnapshot(T0 + 1_000, r);
      expect(snap.errors).toContain('Registre en mémoire seulement (dossier non inscriptible)');
      expect(JSON.stringify(snap.errors)).not.toContain(dir);
      expect(JSON.stringify(snap.errors)).not.toMatch(/\/(var|tmp|private|Users)\//);
      expect(quiet.mock.calls.some((c) => String(c[1]).includes(bad))).toBe(true);
      const before = quiet.mock.calls.length;
      await tickAnticipation(T0 + 60_000, r);
      expect(quiet.mock.calls.length).toBe(before); // même message : pas réécrit
    } finally { quiet.mockRestore(); }
  });

  it('daily compact prunes closed scenarios older than the previous Paris month from memory, like a restart', async () => {
    const reg = await openRegistry({ dir, now: T0 });
    const base = { ruleId: 'r', ruleVersion: 1, zone: { dept: ['75'], communes: [] }, title: 't', chain: [], word: 'probable', why: '', unknowns: [], bascules: [], disconfirmers: [], verify: [], revisedAt: iso(T0), outcomeNote: null, feedback: { utile: 0, deja_su: 0, faux: 0 } };
    const sc = (id: string, openedAt: string, status: string, closedAt: string | null) => ({ ...base, id, window: { from: openedAt, to: openedAt }, openedAt, status, closedAt });
    await reg.record({ at: iso(T0), type: 'cloture', scenario: sc('ancien', '2026-09-10T10:00:00.000Z', 'pas_arrive', '2026-09-12T10:00:00.000Z') });
    await reg.record({ at: iso(T0), type: 'manque', scenario: sc('manque-ancien', '2026-09-20T10:00:00.000Z', 'manque', '2026-09-20T10:00:00.000Z') });
    await reg.record({ at: iso(T0), type: 'cloture', scenario: sc('octobre', '2026-10-02T10:00:00.000Z', 'arrive', '2026-10-03T10:00:00.000Z') });
    await reg.record({ at: iso(T0), type: 'ouverture', scenario: sc('ouvert-ancien', '2026-09-01T10:00:00.000Z', 'ouvert', null) });
    expect(reg.state().size).toBe(4); // écrits dans le journal de novembre : relus tant que le processus vit
    expect(reg.prune(T0)).toBe(2);
    expect([...reg.state().keys()].sort()).toEqual(['octobre', 'ouvert-ancien']);
    // Redémarrage : même mémoire (l'élagage tourne aussi à l'ouverture).
    const again = await openRegistry({ dir, now: T0 });
    expect([...again.state().keys()].sort()).toEqual(['octobre', 'ouvert-ancien']);
    // Le tick élague à la compaction du jour.
    let seen: string[] = [];
    const spy = async (at: number) => {
      const r = await openRegistry({ dir, now: at });
      await r.record({ at: iso(at), type: 'cloture', scenario: sc('tard', '2026-08-01T10:00:00.000Z', 'pas_arrive', '2026-08-02T10:00:00.000Z') });
      return { ...r, compact: async (t: number) => { await r.compact(t); seen = [...r.state().keys()]; } };
    };
    __resetAnticipationForTests();
    await tickAnticipation(T0, { ...readers(), openRegistry: spy });
    expect(seen).toContain('tard'); // avant l'élagage
    const after = await recordFeedback('tard', 'utile', T0 + 1_000, readers());
    expect(after).toBe(false); // oublié en mémoire après la compaction du jour
  });
  it('publicError maps known errors to French labels and strips absolute paths from others', async () => {
    // @ts-expect-error module JS sans déclaration
    const { publicError, publicErrors } = await import('../api/_lib/anticipation/public-errors.js');
    expect(publicError("Registre d'anticipation non inscriptible dans /var/lib/francemonitor/data/anticipation : EACCES")).toBe('Registre en mémoire seulement (dossier non inscriptible)');
    expect(publicError('journal/2026-11.jsonl : lecture impossible dans /srv/x : EISDIR')).toBe('Journal des scénarios illisible');
    expect(publicError('signals/2020-01-01.jsonl : compaction impossible dans /srv/x : EISDIR')).toBe("Compaction de l'archive des signaux impossible");
    expect(publicError('Note de 7 h non écrite dans /srv/x/notes : EROFS')).toBe('Note de 7 h non écrite (dossier non inscriptible)');
    expect(publicError("Règle r1 : ENOENT: no such file or directory, open '/etc/secret/file.json'")).toBe("Règle r1 : ENOENT: no such file or directory, open '(dossier du serveur)'");
    expect(publicError('journal/2026-11.jsonl : 1 ligne illisible ignorée')).toBe('journal/2026-11.jsonl : 1 ligne illisible ignorée');
    expect(publicError('Presse : délai dépassé')).toBe('Presse : délai dépassé');
    expect(publicErrors(['a', 'a', null, 'b'])).toEqual(['a', 'b']);
  });
});
