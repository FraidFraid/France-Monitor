import { describe, expect, it } from 'vitest';
import {
  OUTAGES_ALWAYS_POLLED, OUTAGES_LAYER_KEYS, OUTAGES_LAYER_SOURCES, OUTAGES_POLL_MS, OUTAGES_SOURCE_DETAILS, OUTAGES_SOURCE_NAMES, OUTAGES_STATUS_SOURCES,
  hasActiveOutages, outagesSourceDetail,
} from './outages-sources.ts';

describe('couches et sources Pannes réseau', () => {
  it('quatre couches dans l’ordre du tiroir ; le maître est actif dès qu’une couche l’est', () => {
    expect(OUTAGES_LAYER_KEYS).toEqual(['outagesElec', 'outagesTelecom', 'outagesInternet', 'outagesCloud']);
    expect(hasActiveOutages({})).toBe(false);
    expect(hasActiveOutages({ outagesCloud: true })).toBe(true);
  });
  it('relève : Électricité 10 min, Télécoms 30 min, Internet 10 min, Cloud 30 min', () => {
    expect(Object.fromEntries(Object.entries(OUTAGES_POLL_MS).map(([k, v]) => [k, v / 60_000]))).toEqual({ outagesElec: 10, outagesTelecom: 30, outagesInternet: 10, outagesCloud: 30 });
  });
  it('Télécoms seul est relevé couche éteinte : il nourrit le score (R16)', () => {
    expect([...OUTAGES_ALWAYS_POLLED]).toEqual(['outagesTelecom']);
  });
  it('lignes du panneau des sources, chacune avec un lien et un détail, jamais « temps réel »', () => {
    expect(OUTAGES_STATUS_SOURCES.map(([k]) => k)).toEqual(['arcep', 'edf', 'iip', 'sei']);
    for (const name of OUTAGES_SOURCE_NAMES) {
      const d = outagesSourceDetail(name);
      expect(d?.link).toMatch(/^https:\/\//);
      expect(d?.detail).not.toMatch(/temps r[ée]el|live/i);
    }
    expect(outagesSourceDetail('Vigicrues')).toBeNull();
    expect(Object.keys(OUTAGES_SOURCE_DETAILS)).toEqual([...OUTAGES_SOURCE_NAMES]);
    expect(OUTAGES_LAYER_SOURCES.outagesElec).toEqual(['EDF indisponibilités', 'RTE IIP', 'EDF SEI (îles)']);
    expect(OUTAGES_LAYER_SOURCES.outagesTelecom).toEqual(['ARCEP sites mobiles']);
  });
});
