// tests/outages-room.test.ts : tick de la control room des pannes (api/_lib/outages-room.js, 21/10/2026) : état chaque minute,
// journal persisté seulement quand il change, relu après redémarrage, servi à la demande sur le serveur de dev.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetKvForTests, __setKvClientForTests } from '../api/_lib/kv-history.js';
import { __resetRoomForTests, roomJournal, roomSnapshot, tickOutagesRoom } from '../api/_lib/outages-room.js';

const T0 = Date.parse('2026-10-21T12:00:00Z');
const press = (operator: string) => ({ operator, severity: 'high', articles: 3, sources: 2, firstAt: '2026-10-21T11:00:00Z', lastAt: '2026-10-21T11:30:00Z', title: `${operator} en panne`, link: 'https://ex.fr', national: false });
let pressList: ReturnType<typeof press>[] = [];
const readers = {
  readTelecom: async () => ({ file: null, summary: null, byDept: [], press: pressList, errors: [] }),
  readInternet: async () => ({ iodaReadAt: null, events: [], radar: { configured: false, readAt: null, items: [] }, errors: ['IODA : HTTP 503'] }),
  readPower: async () => ({ edfReadAt: '2026-10-21T11:55:00Z', iipReadAt: '2026-10-21T11:55:00Z', unplanned: [], transmission: { unplanned: [], planned: [] }, errors: [] }),
  readCloud: async () => ({ readAt: '2026-10-21T11:50:00Z', providers: [], incidents: [], errors: [] }),
  readPress: async () => null,
  readSocial: async () => [],
  readAtlas: async () => [],
  readStatus: async () => [],
  readServices: () => [],
};
let writes = 0;
const store = new Map<string, string>();

beforeEach(() => {
  __resetKvForTests(); __resetRoomForTests(); store.clear(); writes = 0; pressList = [press('Orange')];
  __setKvClientForTests({ get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: string) => { writes += 1; store.set(k, v); } });
});
afterEach(() => { __setKvClientForTests(null); });

describe('control room : tick et journal', () => {
  it('tick puis instantané : pannes, sources, erreurs ; second tick sans changement : aucune écriture', async () => {
    await tickOutagesRoom(T0, readers);
    pressList = [press('Orange'), press('SFR')];
    await tickOutagesRoom(T0 + 60_000, readers);
    const snap = await roomSnapshot(T0 + 61_000, readers);
    expect(snap.outages.map((o) => o.id).sort()).toEqual(['mobile|op:Orange', 'mobile|op:SFR']);
    expect(snap.journal).toEqual([expect.objectContaining({ kind: 'nouvelle', id: 'mobile|op:SFR', at: '2026-10-21T12:01:00.000Z' })]);
    expect(snap.errors).toEqual(['IODA : HTTP 503']);
    expect(snap.sources.map((s) => s.source)).toEqual(['presse', 'usagers', 'arcep', 'ioda', 'radar', 'atlas', 'rte', 'edf', 'statut']);
    const before = writes;
    await tickOutagesRoom(T0 + 120_000, readers);
    expect(writes).toBe(before);
  });
  it('tick trop rapproché (moins de 55 s) : ignoré', async () => {
    await tickOutagesRoom(T0, readers);
    pressList = [];
    await tickOutagesRoom(T0 + 30_000, readers);
    expect((await roomSnapshot(T0 + 31_000, readers)).outages).toHaveLength(1);
  });
  it('redémarrage (mémoire vidée, clé-valeur gardé) : aucune « nouvelle » pour une panne déjà connue', async () => {
    await tickOutagesRoom(T0, readers);
    __resetKvForTests(); __resetRoomForTests();
    await tickOutagesRoom(T0 + 60_000, readers);
    expect((await roomSnapshot(T0 + 61_000, readers)).journal).toEqual([]);
  });
  it('redémarrage pendant une panne de Redis : aucune écriture (le journal de 7 jours n’est pas écrasé), relu au tick suivant', async () => {
    await tickOutagesRoom(T0, readers);
    pressList = [press('Orange'), press('SFR')];
    await tickOutagesRoom(T0 + 60_000, readers);
    const saved = store.get('out:room:v1');
    __resetKvForTests(); __resetRoomForTests();
    __setKvClientForTests({ get: async () => { throw new Error('Upstash'); }, set: async (k: string, v: string) => { writes += 1; store.set(k, v); } });
    await tickOutagesRoom(T0 + 120_000, readers);
    expect(store.get('out:room:v1')).toBe(saved);
    __setKvClientForTests({ get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: string) => { writes += 1; store.set(k, v); } });
    await tickOutagesRoom(T0 + 180_000, readers);
    const snap = await roomSnapshot(T0 + 181_000, readers);
    expect(snap.journal.map((e) => [e.kind, e.id])).toEqual([['nouvelle', 'mobile|op:SFR']]);
  });
  it('journal : plus récent d’abord, purgé au-delà de 7 jours, filtré par roomJournal(since)', async () => {
    await tickOutagesRoom(T0, readers);
    pressList = [];
    await tickOutagesRoom(T0 + 60_000, readers);
    await tickOutagesRoom(T0 + 120_000, readers);
    expect((await roomJournal(T0, T0 + 121_000, readers)).map((e) => e.kind)).toEqual(['retablie']);
    pressList = [press('Free')];
    await tickOutagesRoom(T0 + 8 * 86_400_000, readers);
    expect((await roomJournal(0, T0 + 8 * 86_400_000, readers)).map((e) => e.id)).toEqual(['mobile|op:Free']);
  });
  it('instantané sans tick depuis plus de 3 min (serveur de dev sans collecteurs) : calculé à la demande', async () => {
    const snap = await roomSnapshot(T0, readers);
    expect(snap.outages).toHaveLength(1);
    expect(snap.generatedAt).toBe('2026-10-21T12:00:00.000Z');
  });
});

describe('presse de tous les réseaux', () => {
  it('signalements lus par le tick : panne d’électricité signalée par la presse', async () => {
    const withPress = { ...readers, readPress: async () => [{
      network: 'electricite', operator: 'Enedis', severity: 'high', level: 'orange', articles: 2, sources: 2,
      firstAt: '2026-10-21T11:00:00Z', lastAt: '2026-10-21T11:30:00Z', title: 'Panne de courant', link: 'https://ex.fr', national: false,
    }] };
    const snap = await roomSnapshot(T0, withPress);
    expect(snap.outages.map((o) => o.id)).toEqual(['electricite|op:Enedis']);
  });
});

describe('services publics exposés', () => {
  it('chaque panne porte ses services exposés (communes des antennes coupées de l’opérateur)', async () => {
    const withSites = {
      ...readers,
      readTelecom: async () => ({ file: null, summary: null, byDept: [], press: pressList, errors: [], sites: [{ insee: '32013', operator: 'Orange', lon: 0.59, lat: 43.645, cls: 'recente' }] }),
      readServices: () => [{ t: 'police', n: 'Commissariat de police - Auch', c: '32013', d: '32', x: 0.585, y: 43.646 }],
    };
    const snap = await roomSnapshot(T0, withSites);
    expect(snap.outages[0]).toMatchObject({ id: 'mobile|op:Orange', exposed: { basis: 'communes', total: 1, byType: { police: 1 } } });
  });
});

describe('route du journal', () => {
  it('since : ISO, millisecondes, absent (24 h), borné à 7 jours', async () => {
    const { sinceOf } = await import('../api/_handlers/outages/journal.js');
    expect(sinceOf('2026-10-21T10:00:00Z', T0)).toBe(Date.parse('2026-10-21T10:00:00Z'));
    expect(sinceOf(String(T0 - 1000), T0)).toBe(T0 - 1000);
    expect(sinceOf(null, T0)).toBe(T0 - 86_400_000);
    expect(sinceOf('2026-01-01', T0)).toBe(T0 - 7 * 86_400_000);
  });
});
