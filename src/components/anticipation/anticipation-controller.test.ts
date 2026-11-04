// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ANTICIPATION_POLL_MS, AnticipationController, anticipationDeptFeatures } from './anticipation-controller.ts';
import { FIXTURE, LYON } from './fixture.test-data.ts';

const depts: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: ['69', '13'].map((code) => ({ type: 'Feature', properties: { code }, geometry: { type: 'Point', coordinates: [4.8, 45.7] } })),
};
const colorOf = (v: string): string => `hex(${v})`;

function setup() {
  const mapEl = document.createElement('div');
  const calls: unknown[] = [];
  const flights: number[][] = [];
  const timers: Array<{ ms: number; live: boolean }> = [];
  let reads = 0;
  const ctl = new AnticipationController<{ ms: number; live: boolean }>({
    mapEl,
    map: { setOutagesRoom: (s) => calls.push(s), flyTo: (lon, lat, zoom) => flights.push([lon, lat, zoom]), refitFrance: () => flights.push([]) },
    read: async () => { reads += 1; return FIXTURE; },
    loadDepts: async () => depts,
    colorOf,
    schedule: (_fn, ms) => { const t = { ms, live: true }; timers.push(t); return t; },
    unschedule: (t) => { if (t) t.live = false; },
  });
  return { mapEl, calls, flights, timers, ctl, reads: () => reads };
}

describe('pilote de l\u2019onglet Anticipation', () => {
  it('départements colorés par mot ; scénarios nationaux hors carte ; filtre par jour', () => {
    const fc = anticipationDeptFeatures(FIXTURE.scenarios, null, depts, colorOf);
    expect(fc.features.map((f) => f.properties)).toEqual([{ code: '69', word: 'probable', color: 'hex(--sev-orange)' }]);
    expect(anticipationDeptFeatures(FIXTURE.scenarios, new Set(['sc-carburant']), depts, colorOf).features).toEqual([]);
    const two = [LYON, { ...LYON, id: 'b', word: 'tres_probable' as const }];
    expect(anticipationDeptFeatures(two, null, depts, colorOf).features[0].properties?.word).toBe('tres_probable');
  });

  it('anticipation tab mounts room and polls only when active', async () => {
    const { mapEl, calls, timers, ctl, reads } = setup();
    expect(timers).toEqual([]);
    expect(reads()).toBe(0);
    await ctl.setActive(true);
    expect(mapEl.querySelector('.anr')).not.toBeNull();
    expect(reads()).toBe(1);
    expect(timers.filter((t) => t.live).map((t) => t.ms)).toEqual([ANTICIPATION_POLL_MS]);
    expect(ANTICIPATION_POLL_MS).toBe(60_000);
    expect(calls.at(-1)).toMatchObject({ depts: { features: [{ properties: { code: '69', word: 'probable' } }] } });
    await ctl.setActive(true);
    expect(timers.filter((t) => t.live)).toHaveLength(1);
    await ctl.setActive(false);
    expect(mapEl.querySelector('.anr')).toBeNull();
    expect(timers.filter((t) => t.live)).toHaveLength(0);
    expect(calls.at(-1)).toBeNull();
  });

  it('clic sur un scénario : vol vers le département ; scénario national : recadrage France ; jour : carte du jour', async () => {
    const { mapEl, calls, flights, ctl } = setup();
    await ctl.setActive(true);
    (mapEl.querySelector('.anr-agenda [data-scenario="sc-lyon"]') as HTMLElement).click();
    expect(flights.at(-1)?.slice(2)).toEqual([7]);
    (mapEl.querySelector('.anr-agenda [data-scenario="sc-carburant"]') as HTMLElement).click();
    expect(flights.at(-1)).toEqual([]);
    (mapEl.querySelector('[data-day="2026-11-05"]') as HTMLElement).click();
    expect(calls.at(-1)).toMatchObject({ depts: { features: [] } });
    ctl.destroy();
  });

  it('onglet quitté pendant le chargement des départements : rien ne reste monté', async () => {
    const { mapEl, timers, ctl } = setup();
    const pending = ctl.setActive(true);
    await ctl.setActive(false);
    await pending;
    expect(mapEl.querySelector('.anr')).toBeNull();
    expect(timers.filter((t) => t.live)).toHaveLength(0);
  });
});
