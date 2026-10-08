// Météo spatiale du panneau Énergie et du baromètre (revue finale I5, partie V1) : une panne de NOAA n'est jamais un Kp 0 « Calme ».
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeSpace } from './network-barometer.ts';

type Mod = typeof import('./space-weather.ts');

/** Module neuf (cache vide) à chaque test. */
async function fresh(): Promise<Mod> {
  vi.resetModules();
  return import('./space-weather.ts');
}

function noaa(body: unknown, status = 200): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse('2026-10-05T10:00:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('fetchSpaceWeather : jamais « Calme » en panne', () => {
  it('réseau en panne, HTTP 503, liste vide, Kp absent : null (jamais lu)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect(await (await fresh()).fetchSpaceWeather()).toBeNull();
    noaa('indisponible', 503);
    expect(await (await fresh()).fetchSpaceWeather()).toBeNull();
    noaa([]);
    expect(await (await fresh()).fetchSpaceWeather()).toBeNull();
    noaa([{ time_tag: '2026-10-05T09:59:00', kp_index: null }]);
    expect(await (await fresh()).fetchSpaceWeather()).toBeNull();
  });

  it('Kp lu : niveau ; panne ensuite : la lecture réussie, avec son heure de lecture', async () => {
    const mod = await fresh();
    noaa([{ time_tag: '2026-10-05T09:58:00', kp_index: 1.67 }, { time_tag: '2026-10-05T09:59:00', kp_index: 5.33 }]);
    const ok = await mod.fetchSpaceWeather();
    expect([ok?.kpIndex, ok?.levelLabel, ok?.fetchedAt.toISOString()]).toEqual([5, 'Tempête G1', '2026-10-05T10:00:00.000Z']);
    vi.setSystemTime(Date.parse('2026-10-05T10:20:00Z'));
    noaa('indisponible', 503);
    const kept = await mod.fetchSpaceWeather();
    expect([kept?.kpIndex, kept?.fetchedAt.toISOString()]).toEqual([5, '2026-10-05T10:00:00.000Z']);
  });
});

describe('baromètre : composante météo spatiale', () => {
  it('jamais lue : null (n.d., sans couleur), pas un 100 de calme', () => {
    expect(normalizeSpace(null)).toBeNull();
    expect(normalizeSpace({ kpIndex: 0, level: 'quiet', levelLabel: 'Calme', riskFrance: '', color: '', fetchedAt: new Date() })).toBe(100);
  });
});
