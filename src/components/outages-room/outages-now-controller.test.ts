// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { OutagesNowResponse } from '../../types/index.ts';
import { OutagesNowController, ROOM_POLL_MS } from './outages-now-controller.ts';
import { OUTAGES_NOW_POLL_MS } from '../../services/outages-now.ts';

const body: OutagesNowResponse = {
  generatedAt: '2026-10-21T12:30:00Z',
  outages: [
    { id: 'mobile|op:Orange', network: 'mobile', scope: 'operateur', operator: 'Orange', dept: null, label: 'Orange', level: 'orange',
      since: '2026-10-21T10:00:00Z', national: true, measured: false, rung: 'signalee', evidence: [] },
    { id: 'mobile|dept:13', network: 'mobile', scope: 'departement', operator: null, dept: '13', label: null, level: 'rouge',
      since: '2026-10-21T09:00:00Z', national: false, measured: true, rung: 'mesuree', evidence: [] },
  ],
  journal: [], sources: [], errors: [],
};
const depts: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { code: '13' }, geometry: { type: 'Point', coordinates: [5, 43.5] } }] };

function setup(loadDepts: () => Promise<GeoJSON.FeatureCollection | null> = async () => depts) {
  const mapEl = document.createElement('div');
  const calls: Array<unknown> = [];
  const timers: number[] = [];
  const flights: number[][] = [];
  const ctl = new OutagesNowController({
    mapEl,
    map: { setOutagesRoom: (s) => calls.push(s), flyTo: (lon, lat, zoom) => flights.push([lon, lat, zoom]), refitFrance: () => flights.push([]) },
    read: async () => body,
    loadDepts,
    schedule: (_fn, ms) => { timers.push(ms); return ms; },
    unschedule: () => undefined,
  });
  return { mapEl, calls, timers, flights, ctl };
}

describe('pilote des pannes en cours', () => {
  it('hors de l’onglet : bandeau, relève toutes les 2 min, aucune salle ; niveau = panne la plus grave', async () => {
    const { mapEl, timers, ctl } = setup();
    await ctl.start();
    expect(timers).toEqual([OUTAGES_NOW_POLL_MS]);
    expect(mapEl.querySelector('.outages-now-banner')?.hasAttribute('hidden')).toBe(false);
    expect(mapEl.querySelector('.orm')).toBeNull();
    expect(ctl.level()).toBe('rouge');
  });
  it('dans l’onglet Pannes : salle montée, bandeau masqué, relève 60 s, carte nourrie ; sortie : tout retiré', async () => {
    const { mapEl, calls, timers, ctl } = setup();
    await ctl.start();
    await ctl.setRoomActive(true);
    expect(mapEl.querySelector('.orm')).not.toBeNull();
    expect(mapEl.querySelector('.outages-now-banner')?.hasAttribute('hidden')).toBe(true);
    expect(timers.at(-1)).toBe(ROOM_POLL_MS);
    expect(calls.at(-1)).toMatchObject({ nationalLevel: 'orange', depts: { features: [{ properties: { code: '13', level: 'rouge' } }] } });
    await ctl.setRoomActive(false);
    expect(mapEl.querySelector('.orm')).toBeNull();
    expect(calls.at(-1)).toBeNull();
    expect(timers.at(-1)).toBe(OUTAGES_NOW_POLL_MS);
  });
  it('clic sur une panne : département → centre du département ; nationale → recadrage France', async () => {
    const { mapEl, flights, ctl } = setup();
    await ctl.start();
    await ctl.setRoomActive(true);
    (mapEl.querySelector('.orm-nat [data-outage="mobile|op:Orange"]') as HTMLElement).click();
    expect(flights.at(-1)).toEqual([]);
    expect(ROOM_POLL_MS).toBe(60_000);
  });
  it('sortie de l’onglet pendant le chargement des départements : relève revenue à 2 min, calques retirés', async () => {
    let release: (v: GeoJSON.FeatureCollection) => void = () => undefined;
    const slow = new Promise<GeoJSON.FeatureCollection>((r) => { release = r; });
    const { mapEl, calls, timers, ctl } = setup(() => slow);
    await ctl.start();
    const entering = ctl.setRoomActive(true);
    await ctl.setRoomActive(false);
    release(depts);
    await entering;
    expect(timers.at(-1)).toBe(OUTAGES_NOW_POLL_MS);
    expect(calls.at(-1)).toBeNull();
    expect(mapEl.querySelector('.orm')).toBeNull();
  });
  it('niveau changé : App prévenue (voyant de l’onglet Pannes) ; inchangé : rien', async () => {
    const levels: Array<string | null> = [];
    const ctl = new OutagesNowController({
      mapEl: document.createElement('div'),
      map: { setOutagesRoom: () => undefined, flyTo: () => undefined, refitFrance: () => undefined },
      read: async () => body, loadDepts: async () => depts,
      schedule: (fn) => { fn(); return 0; }, unschedule: () => undefined,
      onLevelChange: (l) => levels.push(l),
    });
    await ctl.start();
    await new Promise((r) => setTimeout(r, 0));
    expect(levels).toEqual(['rouge']);
  });
});

