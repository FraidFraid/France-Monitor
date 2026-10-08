import { describe, expect, it } from 'vitest';
import {
  OUTAGES_LATE_AFTER_MIN, TELECOM_DISRUPTION_THRESHOLDS, isArcepFileLate, isOutagesDataLate, powerLevel, powerUnplannedMw, telecomLevel,
} from './outages-levels.ts';
import { outagesSlotStatus } from './outages-source.ts';
import type { PowerOutagesResponse, PowerUnitOutage, TelecomOutagesResponse } from '../types/index.ts';

const paris = (iso: string): number => Date.parse(iso);   // ISO avec fuseau explicite

function telecom(recent: number, byDept: Array<[string | null, number]>): TelecomOutagesResponse {
  return {
    readAt: '2026-10-08T09:10:00Z', file: { day: '2026-10-08', publishedAt: '2026-10-08T09:02:20Z' }, previousFile: null,
    summary: { total: recent, recent, long: 0, maintenance: 0, undated: 0, bands: { '1-3j': 0, '3-7j': 0, '7-30j': 0, '30j+': 0 }, newSincePrevious: null, resolvedSincePrevious: null },
    byOperator: [], byDept: byDept.map(([dept, n]) => ({ dept, recent: n })), sites: [], history: [], errors: [],
  };
}

function unit(lostMw: number, kind: PowerUnitOutage['kind'] = 'imprevue'): PowerUnitOutage {
  return { id: `u${lostMw}`, name: 'X', sector: 'Nucléaire', nuclear: true, kind, lostMw, maxMw: null, start: '2026-10-01T00:00:00Z', end: null, publishedAt: null, cause: null, source: 'edf' };
}

function power(units: PowerUnitOutage[]): PowerOutagesResponse {
  return { readAt: 'x', edfUpdatedAt: null, edfReadAt: null, iipPublishedAt: null, unplanned: units, planned: [], upcoming: [], transmission: null, islands: [], history: [], errors: [] };
}

describe('niveaux et retards des pannes réseau', () => {
  it('seuils partagés avec la situation « Perturbation télécom »', () => {
    expect(TELECOM_DISRUPTION_THRESHOLDS).toEqual({ deptMedium: 20, deptHigh: 50, deptCritical: 100, nationalHigh: 300, nationalCritical: 600 });
  });
  it('télécom : vert sous 20 dans un département, jaune dès 20, orange dès 50 ou 300 au national, rouge dès 100 ou 600', () => {
    expect(telecomLevel(telecom(264, [['2B', 28], ['13', 19]]))).toBe('jaune');
    expect(telecomLevel(telecom(18, [['02', 6]]))).toBe('vert');
    expect(telecomLevel(telecom(60, [['75', 50]]))).toBe('orange');
    expect(telecomLevel(telecom(300, [['75', 10]]))).toBe('orange');
    expect(telecomLevel(telecom(120, [['75', 100]]))).toBe('rouge');
    expect(telecomLevel(telecom(600, []))).toBe('rouge');
    // Le département non renseigné ne compte pas comme un département (il ne colore que par le total national).
    expect(telecomLevel(telecom(25, [[null, 25]]))).toBe('vert');
    expect(telecomLevel({ ...telecom(0, []), summary: null })).toBeNull();
  });
  it('électricité : paliers du parc nucléaire sur les MW perdus en arrêts imprévus, relevés par Écowatt', () => {
    expect(powerUnplannedMw(power([unit(1330), unit(915), unit(427), unit(162)]))).toBe(2834);
    expect(powerLevel(power([unit(1330), unit(915), unit(427), unit(162)]), 'green')).toBe('jaune');
    expect(powerLevel(power([unit(900)]), null)).toBe('vert');
    expect(powerLevel(power([unit(3000)]), 'green')).toBe('orange');
    expect(powerLevel(power([unit(6000)]), 'green')).toBe('rouge');
    expect(powerLevel(power([unit(500)]), 'orange')).toBe('orange');
    expect(powerLevel(power([unit(500)]), 'red')).toBe('rouge');
  });
  it('retards par source (spec § 1)', () => {
    expect(OUTAGES_LATE_AFTER_MIN).toEqual({ arcep: 0, edf: 120, iip: 60, sei: 26 * 60, ioda: 60, radar: 60, cloud: 120 });
    const now = Date.parse('2026-10-08T20:00:00Z');
    expect(isOutagesDataLate('edf', '2026-10-08T18:00:00Z', now)).toBe(false);
    expect(isOutagesDataLate('edf', '2026-10-08T17:59:00Z', now)).toBe(true);
    expect(isOutagesDataLate('iip', null, now)).toBe(true);
  });
  it('ARCEP : fichier de la veille en retard seulement après 15 h à Paris', () => {
    expect(isArcepFileLate('2026-10-08', paris('2026-10-08T22:00:00+02:00'))).toBe(false);
    expect(isArcepFileLate('2026-10-07', paris('2026-10-08T09:00:00+02:00'))).toBe(false);
    expect(isArcepFileLate('2026-10-07', paris('2026-10-08T14:59:00+02:00'))).toBe(false);
    expect(isArcepFileLate('2026-10-07', paris('2026-10-08T15:01:00+02:00'))).toBe(true);
    expect(isArcepFileLate('2026-10-06', paris('2026-10-08T09:00:00+02:00'))).toBe(true);
    expect(isArcepFileLate(null, paris('2026-10-08T09:00:00+02:00'))).toBe(true);
  });
  it('statut d’une source : date de la donnée, « (en retard) », erreur nommée, jamais l’heure de lecture', () => {
    const now = Date.parse('2026-10-08T20:00:00Z');
    const data = { errors: [] as string[] };
    expect(outagesSlotStatus({ data: null, error: null, fetchedAt: null }, 'edf', null, now).status).toBe('loading');
    expect(outagesSlotStatus({ data: null, error: 'HTTP 502', fetchedAt: null }, 'edf', null, now))
      .toMatchObject({ status: 'error', error: 'HTTP 502' });
    const ok = outagesSlotStatus({ data, error: null, fetchedAt: now }, 'edf', '2026-10-08T19:30:00Z', now);
    expect(ok.status).toBe('ok');
    expect(ok.lastUpdate?.toISOString()).toBe('2026-10-08T19:30:00.000Z');
    const late = outagesSlotStatus({ data, error: null, fetchedAt: now }, 'edf', '2026-10-08T15:00:00Z', now);
    expect(late.status).toBe('stale');
    expect(late.period).toMatch(/\(en retard\)$/);
    // EDF (R20) : le retard se mesure sur la dernière lecture réussie, la date de la donnée reste affichée.
    const read = outagesSlotStatus({ data, error: null, fetchedAt: now }, 'edf', '2026-10-08T10:00:00Z', now, '2026-10-08T19:30:00Z');
    expect(read.status).toBe('ok');
    expect(read.lastUpdate?.toISOString()).toBe('2026-10-08T10:00:00.000Z');
    expect(outagesSlotStatus({ data, error: null, fetchedAt: now }, 'edf', '2026-10-08T19:30:00Z', now, '2026-10-08T15:00:00Z').status).toBe('stale');
    const partial = outagesSlotStatus({ data: { errors: ['RTE IIP : HTTP 503'] }, error: null, fetchedAt: now }, 'edf', '2026-10-08T19:30:00Z', now);
    expect(partial).toMatchObject({ status: 'stale', error: 'RTE IIP : HTTP 503' });
  });
});
