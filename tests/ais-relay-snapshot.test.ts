import { afterEach, describe, expect, it } from 'vitest';
import { createAisTracker } from '../api/_lib/ais-snapshot.js';
import { startRelayServer, subscriptionChunks } from '../ais-relay.js';
import { fixtureText } from './helpers/traffic-fixtures.ts';

type Relay = { server: { address(): { port: number } | string | null; once(e: string, f: () => void): void; listening: boolean }; close(): void };
let relay: Relay | null = null;

afterEach(() => { relay?.close(); relay = null; });

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
