// tests/anticipation-room.test.ts : tick d'une minute de l'anticipation (api/_lib/anticipation/room.js, 04/11/2026) : lecteurs injectés,
// journal sur disque, tendance carburants (règle 5), instantané recalculé quand le tick est périmé, table des phénomènes miroir du client.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error module JS sans déclaration
import { __resetAnticipationForTests, anticipationSnapshot, tickAnticipation } from '../api/_lib/anticipation/room.js';
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
});
