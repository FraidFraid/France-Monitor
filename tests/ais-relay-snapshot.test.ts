import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAisTracker } from '../api/_lib/ais-snapshot.js';
import { __setKvClientForTests } from '../api/_lib/kv-history.js';
import { BOX_COVERAGE, getRelayHttpBaseUrl, startRelayServer, subscriptionChunks } from '../ais-relay.js';
import { fixtureText } from './helpers/traffic-fixtures.ts';

type Relay = { saveStatics(reason?: string): Promise<{ ok: boolean; persisted: boolean; error?: string; count: number; bytes: number }>; server: { address(): { port: number } | string | null; once(e: string, f: () => void): void; listening: boolean }; close(): void };
let relay: Relay | null = null;

afterEach(() => { relay?.close(); relay = null; __setKvClientForTests(null); vi.restoreAllMocks(); });

async function started(tracker = createAisTracker()): Promise<number> {
  relay = startRelayServer({ port: 0, aisApiKey: '', keepUpstream: false, tracker }) as Relay;
  if (!relay.server.listening) await new Promise<void>((resolve) => relay?.server.once('listening', resolve));
  const address = relay.server.address();
  if (!address || typeof address === 'string') throw new Error('adresse du relais inconnue');
  return address.port;
}

describe('abonnement aisstream', () => {
  it('Dunkerque-Calais et Gironde ajoutées, 5 boîtes au plus par lot, toujours 3 lots', () => {
    const chunks = subscriptionChunks('cle');
    expect(chunks.map((c) => c.BoundingBoxes.length)).toEqual([5, 5, 4]);
    expect(chunks[0].BoundingBoxes[4]).toEqual([[50.9, 1.0], [51.4, 2.6]]);
    expect(chunks[1].BoundingBoxes[0]).toEqual([[44.5, -1.3], [45.4, -0.4]]);
    expect(chunks.every((c) => c.APIKey === 'cle' && c.FilterMessageTypes.length === 3)).toBe(true);
  });
});

describe('GET /snapshot et /health (relais local, sans clé ni flux amont)', () => {
  it('instantané JSON, ouvert aux autres origines, cache court ; panne nommée', async () => {
    const tracker = createAisTracker();
    for (const l of fixtureText('ais-messages.jsonl').split('\n').filter(Boolean)) tracker.ingest(l);
    const port = await started(tracker);
    const r = await fetch(`http://127.0.0.1:${port}/snapshot`);
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    expect(r.headers.get('cache-control')).toBe('public, max-age=30');
    const body = await r.json() as { lastMessageAt: string; errors: string[] };
    expect(body.lastMessageAt).toBe('2026-10-03T13:19:48.822Z');
    expect(body.errors).toEqual(['AIS : clé aisstream absente (AISSTREAM_API_KEY)']);
  });
  it('/health inchangé ; /opensky retiré (404)', async () => {
    const port = await started();
    expect(await (await fetch(`http://127.0.0.1:${port}/health`)).json()).toMatchObject({ ok: true, ais: false });
    expect((await fetch(`http://127.0.0.1:${port}/opensky`)).status).toBe(404);
  });
});

describe('zones couvertes par chaque lot, panne amont nommée, mémoire MMSI', () => {
  it('une zone nommée par boîte, dans l’ordre de l’abonnement', () => {
    expect(BOX_COVERAGE).toHaveLength(subscriptionChunks('k').flatMap((c) => c.BoundingBoxes).length);
    expect(BOX_COVERAGE.map((c) => c.label).slice(0, 6)).toEqual(['Manche', 'Atlantique', 'golfe du Lion', 'Corse', 'Dunkerque-Calais', 'Gironde']);
  });
  it('amont injoignable avec clé : les lots métropolitains sont nommés, le lot d’outre-mer seul ne l’est pas', async () => {
    __setKvClientForTests({ get: async () => null, set: async () => {} });
    relay = startRelayServer({ port: 0, aisApiKey: 'cle', upstreamUrl: 'ws://127.0.0.1:1', keepUpstream: true, tracker: createAisTracker() }) as Relay;
    if (!relay.server.listening) await new Promise<void>((resolve) => relay?.server.once('listening', resolve));
    const address = relay.server.address();
    if (!address || typeof address === 'string') throw new Error('adresse du relais inconnue');
    const body = await (await fetch(`http://127.0.0.1:${address.port}/snapshot`)).json() as { errors: string[] };
    expect(body.errors).toEqual([
      'flux AIS interrompu : lot 1 sur 3 coupé (Manche, Atlantique, golfe du Lion, Corse, Dunkerque-Calais)',
      'flux AIS interrompu : lot 2 sur 3 coupé (Gironde, Antilles, Guyane, La Réunion, Mayotte)',
    ]);
  });
  it('sauvegarde de la mémoire MMSI : succès journalisé ; échec Redis journalisé, jamais avalé', async () => {
    const tracker = createAisTracker();
    for (const l of fixtureText('ais-messages.jsonl').split('\n').filter(Boolean)) tracker.ingest(l);
    const written: string[] = [];
    __setKvClientForTests({ get: async () => null, set: async () => {}, setStrict: async (_k: string, v: string) => { written.push(v); return true; } } as never);
    relay = startRelayServer({ port: 0, aisApiKey: '', keepUpstream: false, tracker }) as Relay;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ok = await relay.saveStatics('essai');
    expect([ok.ok, ok.persisted]).toEqual([true, true]);
    expect(JSON.parse(written[0]).length).toBe(ok.count);
    expect(ok.bytes).toBeLessThanOrEqual(900 * 1024);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Mémoire MMSI sauvée (essai)'));
    __setKvClientForTests({ get: async () => null, set: async () => {}, setStrict: async () => { throw new Error('quota dépassé'); } } as never);
    const ko = await relay.saveStatics('essai');
    expect(ko.ok).toBe(false);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('échouée'));
    expect(err).toHaveBeenCalledWith(expect.stringContaining('quota dépassé'));
  });
  it('après close() : plus aucune reconnexion ni minuteur en attente (keepUpstream, amont injoignable)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
    try {
      __setKvClientForTests({ get: async () => null, set: async () => {} });
      relay = startRelayServer({ port: 0, aisApiKey: 'cle', upstreamUrl: 'ws://127.0.0.1:1', keepUpstream: true, tracker: createAisTracker() }) as Relay;
      await vi.advanceTimersByTimeAsync(50);
      relay.close();
      relay = null;
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(40_000); // laisse expirer le minuteur interne du serveur HTTP
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
  it('l’URL HTTP du relais ne dépend plus de AIR_RELAY_URL', () => {
    vi.stubEnv('AIR_RELAY_URL', 'https://autre.example');
    vi.stubEnv('RELAY_PORT', '8090');
    expect(getRelayHttpBaseUrl()).toBe('http://127.0.0.1:8090');
    vi.unstubAllEnvs();
  });
});
