// tests/adsb-lol.test.ts : client unique d'adsb.lol (spec 2026-10-04 souveraineté § 2.1 ; contrats, arbitrage 2) : une seule file
// par processus, 6 s entre deux appels, recul de 10 min sur 429 ou page de défi, « clé requise » et recul d'une heure sur 401 ou
// 403, réponse illisible nommée, User-Agent FranceMonitor sur chaque appel.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADSB_429_BACKOFF_MS, ADSB_AUTH_BACKOFF_MS, ADSB_LOL_BASE, ADSB_MIN_GAP_MS, __resetAdsbLolForTests, adsbLolBlockedUntil, adsbLolGet,
} from '../api/_lib/adsb-lol.js';
import { SOURCE_USER_AGENT } from '../api/_lib/source-http.js';
import { respond, sentHeader, stubFetch } from './helpers/traffic-fixtures.ts';

const MIL = JSON.parse(readFileSync(new URL('./fixtures/sovereignty/adsb-lol-mil.json', import.meta.url), 'utf8')) as { ac: object[]; now: number; total: number };
/** 4 octobre 2026, 16 h 48 min 24,501 s à Paris : `now` du relevé /v2/mil enregistré. */
const T0 = 1_791_125_304_501;

beforeEach(() => {
  __resetAdsbLolForTests();
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(T0);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

/** Doublure qui note l'heure de chaque appel. */
function timedStub(route: (url: string) => ReturnType<typeof respond>): { at: number[]; log: ReturnType<typeof stubFetch> } {
  const at: number[] = [];
  const log = stubFetch((url) => { at.push(Date.now()); return route(url); });
  return { at, log };
}

describe('lecture', () => {
  it('/v2/mil réel : 139 aéronefs, `now` en millisecondes, User-Agent FranceMonitor', async () => {
    const { log } = timedStub(() => respond(MIL));
    const read = await adsbLolGet('/v2/mil');
    expect([read.ac.length, read.now, read.total]).toEqual([139, T0, 139]);
    expect(log.urls).toEqual([`${ADSB_LOL_BASE}/v2/mil`]);
    expect(sentHeader(log.inits[0], 'User-Agent')).toBe(SOURCE_USER_AGENT);
    expect(SOURCE_USER_AGENT).toMatch(/^FranceMonitor\//);
  });
  it('`now` en secondes : converti en millisecondes', async () => {
    timedStub(() => respond({ ac: [], now: 1_791_125_314, total: 0 }));
    expect((await adsbLolGet('/v2/point/48.8/-1.5/200')).now).toBe(1_791_125_314_000);
  });
  it('forme sans tableau `ac` : « adsb.lol : réponse illisible » ; page HTML : nommée', async () => {
    timedStub(() => respond({ msg: 'No error', now: T0 }));
    await expect(adsbLolGet('/v2/mil')).rejects.toThrow('adsb.lol : réponse illisible');
    await vi.advanceTimersByTimeAsync(ADSB_MIN_GAP_MS);
    timedStub(() => respond('<!DOCTYPE html><html><body>maintenance</body></html>'));
    await expect(adsbLolGet('/v2/mil')).rejects.toThrow('adsb.lol : page HTML reçue au lieu de données');
  });
  it('HTTP 500 : panne nommée, aucun recul (relève suivante normale)', async () => {
    timedStub(() => respond('erreur', 500));
    await expect(adsbLolGet('/v2/mil')).rejects.toThrow('adsb.lol : HTTP 500');
    expect(adsbLolBlockedUntil()).toBeNull();
  });
});

describe('file unique : au moins 6 s entre deux appels', () => {
  it('deux appels lancés en même temps par deux routes : le second part 6 s après la fin du premier', async () => {
    const { at } = timedStub(() => respond(MIL));
    const a = adsbLolGet('/v2/mil');
    const b = adsbLolGet('/v2/point/48.8/-1.5/200');
    await a;
    await vi.advanceTimersByTimeAsync(ADSB_MIN_GAP_MS - 1);
    expect(at).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await b;
    expect(at).toEqual([T0, T0 + ADSB_MIN_GAP_MS]);
  });
  it('un échec ne bloque pas la file : l’appel suivant part quand même, 6 s plus tard', async () => {
    let n = 0;
    const { at } = timedStub(() => { n += 1; return n === 1 ? respond('erreur', 500) : respond(MIL); });
    const a = adsbLolGet('/v2/mil').catch((err: Error) => err.message);
    const b = adsbLolGet('/v2/mil');
    expect(await a).toBe('adsb.lol : HTTP 500');
    await vi.advanceTimersByTimeAsync(ADSB_MIN_GAP_MS);
    expect((await b).ac).toHaveLength(139);
    expect(at).toEqual([T0, T0 + ADSB_MIN_GAP_MS]);
  });
});

describe('reculs', () => {
  it('429 : « nouvelle tentative après 16:58 », aucun appel pendant 10 min, même par une autre route', async () => {
    const { log } = timedStub(() => respond('Too Many Requests', 429));
    await expect(adsbLolGet('/v2/point/44.0/4.5/200')).rejects.toThrow('adsb.lol : HTTP 429, nouvelle tentative après 16:58');
    expect(adsbLolBlockedUntil()).toBe(T0 + ADSB_429_BACKOFF_MS);
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    await expect(adsbLolGet('/v2/mil')).rejects.toThrow('adsb.lol : HTTP 429, nouvelle tentative après 16:58');
    expect(log.urls).toHaveLength(1);
    timedStub(() => respond(MIL));
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await adsbLolGet('/v2/mil')).ac).toHaveLength(139);
    expect(adsbLolBlockedUntil()).toBeNull();
  });
  it('401 ou 403 hors défi : « adsb.lol : clé requise », aucun nouvel appel pendant une heure', async () => {
    for (const status of [401, 403]) {
      __resetAdsbLolForTests();
      vi.setSystemTime(T0);
      const { log } = timedStub(() => respond('{"error":"API key required"}', status));
      await expect(adsbLolGet('/v2/mil')).rejects.toThrow('adsb.lol : clé requise');
      await vi.advanceTimersByTimeAsync(ADSB_AUTH_BACKOFF_MS - 1000);
      await expect(adsbLolGet('/v2/mil')).rejects.toThrow('adsb.lol : clé requise');
      expect(log.urls).toHaveLength(1);
      expect(adsbLolBlockedUntil()).toBe(T0 + ADSB_AUTH_BACKOFF_MS);
    }
  });
  it('page de défi anti-robot (403) : nommée, jamais contournée, recul de 10 min', async () => {
    const { log } = timedStub(() => respond('<html><head><title>Just a moment...</title></head><body>cf-chl-</body></html>', 403));
    await expect(adsbLolGet('/v2/mil')).rejects.toThrow('adsb.lol : page de contrôle anti-robot (HTTP 403), nouvelle tentative après 16:58');
    await expect(adsbLolGet('/v2/mil')).rejects.toThrow('nouvelle tentative après 16:58');
    expect(log.urls).toHaveLength(1);
    expect(sentHeader(log.inits[0], 'User-Agent')).toBe(SOURCE_USER_AGENT);
  });
  it('l’instant de référence passé par l’appelant compte pour le recul', async () => {
    timedStub(() => respond('Too Many Requests', 429));
    await expect(adsbLolGet('/v2/mil', T0)).rejects.toThrow('HTTP 429');
    timedStub(() => respond(MIL));
    await vi.advanceTimersByTimeAsync(ADSB_MIN_GAP_MS);
    expect((await adsbLolGet('/v2/mil', T0 + ADSB_429_BACKOFF_MS)).ac).toHaveLength(139);
  });
});
