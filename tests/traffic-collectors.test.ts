import { afterEach, describe, expect, it, vi } from 'vitest';
import { COLLECTORS, COLLECTOR_TICK_MS, startTrafficCollectors } from '../server/prod/traffic-collectors.mjs';

afterEach(() => { vi.useRealTimers(); });

describe('relève serveur des collectes à quota', () => {
  it('collecteurs enregistrés et relève d’une minute', () => {
    expect(COLLECTORS.map((c) => c.name)).toEqual(['tomtom', 'opensky']);
    expect(COLLECTOR_TICK_MS).toBe(60_000);
  });
  it('lance chaque collecteur tout de suite puis à chaque minute ; une erreur n’arrête pas les autres', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const errors: string[] = [];
    const stop = startTrafficCollectors({
      collectors: [
        { name: 'a', run: async () => { calls.push('a'); throw new Error('HTTP 429'); } },
        { name: 'b', run: async () => { calls.push('b'); } },
      ],
      log: { error: (msg: string) => { errors.push(msg); } },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(['a', 'b']);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toEqual(['a', 'b', 'a', 'b']);
    expect(errors[0]).toBe('[collecte a] HTTP 429');
    stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toHaveLength(4);
  });
});
