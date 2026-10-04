import { afterEach, describe, expect, it, vi } from 'vitest';
import { UPSTREAM_SILENT_MS, createAisTracker, relayZones, slowVesselsResponse } from '../api/_lib/ais-snapshot.js';
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
    const slow = await (await fetch(`http://127.0.0.1:${address.port}/slow-vessels`)).json() as { errors: string[]; zones: Array<{ label: string; box: unknown; muted: boolean }> };
    expect(slow.errors).toEqual(body.errors);
    expect(slow.zones.map((z) => [z.label, z.muted])).toEqual([
      ['Manche', true], ['Atlantique', true], ['golfe du Lion', true], ['Corse', true], ['Dunkerque-Calais', true], ['Gironde', true],
    ]);
    expect(slow.zones[2].box).toEqual([[41.0, 1.8], [44.8, 8.2]]);
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
  it('après close() : plus aucune reconnexion programmée (keepUpstream, amont injoignable)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] });
    try {
      __setKvClientForTests({ get: async () => null, set: async () => {} });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});
      relay = startRelayServer({ port: 0, aisApiKey: 'cle', upstreamUrl: 'ws://127.0.0.1:1', keepUpstream: true, tracker: createAisTracker() }) as Relay;
      await vi.advanceTimersByTimeAsync(50);
      relay.close();
      relay = null;
      // Les fermetures tardives des sockets que close() vient de fermer ont lieu ici ; elles ne doivent rien reprogrammer.
      await vi.advanceTimersByTimeAsync(40_000);
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
      const logged = warn.mock.calls.length + error.mock.calls.length;
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      // Seuls les minuteurs du relais sont comptés (ses appels à setTimeout, setInterval et ses journaux), pas ceux de Node.
      expect(setTimeoutSpy).not.toHaveBeenCalled();
      expect(setIntervalSpy).not.toHaveBeenCalled();
      expect(warn.mock.calls.length + error.mock.calls.length).toBe(logged);
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

describe('navires lents pour la veille des câbles (souveraineté § 2.2, arbitrage 8)', () => {
  const NOW = Date.parse('2026-10-03T13:20:00Z');
  const loaded = () => {
    const tracker = createAisTracker();
    for (const l of fixtureText('ais-messages.jsonl').split('\n').filter(Boolean)) tracker.ingest(l);
    return tracker;
  };
  it('eaux françaises, vus depuis moins de 10 min, vitesse connue sous 2 nœuds', () => {
    const slow = loaded().slowVessels(NOW);
    expect(slow).toHaveLength(20);
    expect(slow.every((v) => typeof v.sog === 'number' && v.sog < 2)).toBe(true);
    expect(slow[0]).toMatchObject({ mmsi: '224016730', type: null, typeCode: null, status: 3, sog: 1.7, lastAt: '2026-10-03T13:19:44.977Z' });
    expect(loaded().slowVessels(NOW + 11 * 60_000)).toEqual([]);
  });
  it('position sans vitesse : jamais retenue (une absence n’est pas un arrêt)', () => {
    const tracker = createAisTracker();
    tracker.ingest(JSON.stringify({
      MessageType: 'PositionReport',
      MetaData: { MMSI: 229000009, ShipName: 'SANS VITESSE', latitude: 42.85, longitude: 4.8558, time_utc: '2026-10-03 13:19:00.000 +0000 UTC' },
      Message: { PositionReport: { Latitude: 42.85, Longitude: 4.8558, NavigationalStatus: 1 } },
    }));
    expect(tracker.slowVessels(NOW)).toEqual([]);
  });
  it('corps de /slow-vessels : date, dernier message en eaux françaises, pannes nommées comme /snapshot', () => {
    const body = slowVesselsResponse(loaded(), NOW, { hasKey: false, upstreamOpen: false });
    expect([body.at, body.lastMessageAt, body.vessels.length, body.errors, body.zones]).toEqual([
      '2026-10-03T13:20:00.000Z', '2026-10-03T13:19:48.822Z', 20, ['AIS : clé aisstream absente (AISSTREAM_API_KEY)'], [],
    ]);
  });
  it('zones des lots amont (veille des câbles) : boîtes métropolitaines seulement, muettes si le lot est coupé ou muet depuis plus de 5 min', () => {
    const box = (s: number, w: number, n: number, e: number): [[number, number], [number, number]] => [[s, w], [n, e]];
    const lots = [
      { index: 0, open: true, lastAt: NOW - 60_000, labels: ['golfe du Lion'], metro: true, boxes: [{ label: 'golfe du Lion', metro: true, box: box(41, 1.8, 44.8, 8.2) }] },
      { index: 1, open: true, lastAt: NOW - UPSTREAM_SILENT_MS - 1, labels: ['Gironde', 'Antilles'], metro: true, boxes: [
        { label: 'Gironde', metro: true, box: box(44.5, -1.3, 45.4, -0.4) }, { label: 'Antilles', metro: false, box: box(14, -62.5, 19.5, -58) },
      ] },
      { index: 2, open: false, lastAt: null, labels: ['Manche'], metro: true, boxes: [{ label: 'Manche', metro: true, box: box(48.2, -6, 50.9, 2.4) }] },
    ];
    expect(relayZones(lots, NOW)).toEqual([
      { label: 'golfe du Lion', box: box(41, 1.8, 44.8, 8.2), muted: false },
      { label: 'Gironde', box: box(44.5, -1.3, 45.4, -0.4), muted: true },
      { label: 'Manche', box: box(48.2, -6, 50.9, 2.4), muted: true },
    ]);
  });
  it('GET /slow-vessels : JSON, cache de 30 s, ouvert aux autres origines ; /snapshot inchangé à côté (cache distinct)', async () => {
    const port = await started(loaded());
    const r = await fetch(`http://127.0.0.1:${port}/slow-vessels`);
    expect([r.status, r.headers.get('cache-control'), r.headers.get('access-control-allow-origin')]).toEqual([200, 'public, max-age=30', '*']);
    const body = await r.json() as { lastMessageAt: string; vessels: unknown[]; errors: string[] };
    expect([body.lastMessageAt, Array.isArray(body.vessels), body.errors]).toEqual(['2026-10-03T13:19:48.822Z', true, ['AIS : clé aisstream absente (AISSTREAM_API_KEY)']]);
    const snap = await (await fetch(`http://127.0.0.1:${port}/snapshot`)).json() as { vessels: unknown; zones: unknown[]; errors: string[] };
    expect([typeof snap.vessels, snap.zones.length, snap.errors]).toEqual(['number', 4, ['AIS : clé aisstream absente (AISSTREAM_API_KEY)']]);
  });
});
