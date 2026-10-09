import { describe, expect, it } from 'vitest';
import {
  OUTAGES_LATE_AFTER_MIN, TELECOM_DISRUPTION_THRESHOLDS, internetLevel, internetLive, isArcepFileLate, isOutagesDataLate, powerLevel, powerUnplannedMw,
  telecomIfFresh, telecomLevel,
} from './outages-levels.ts';
import { outagesSlotStatus } from './outages-source.ts';
import type { InternetEvent, InternetOutagesResponse, PowerOutagesResponse, PowerUnitOutage, RadarItem, TelecomOutagesResponse } from '../types/index.ts';

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
  return { readAt: 'x', edfUpdatedAt: null, edfReadAt: null, iipPublishedAt: null, iipReadAt: null, unplanned: units, planned: [], upcoming: [], transmission: null, islands: [], history: [], errors: [] };
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
  it('I6 : telecomIfFresh rend le fichier tel quel s’il n’est pas en retard, null sinon (et null pour une source muette)', () => {
    const t = telecom(264, [['59', 30]]);   // fichier du 08/10
    expect(telecomIfFresh(t, paris('2026-10-08T22:00:00+02:00'))).toBe(t);
    expect(telecomIfFresh(t, paris('2026-10-09T09:00:00+02:00'))).toBe(t);       // fichier de la veille avant 15 h : normal
    expect(telecomIfFresh(t, paris('2026-10-09T15:01:00+02:00'))).toBeNull();     // le fichier du jour manque encore après 15 h
    expect(telecomIfFresh(t, paris('2026-10-12T09:00:00+02:00'))).toBeNull();     // plusieurs jours : jamais « récent »
    expect(telecomIfFresh({ ...t, file: null }, paris('2026-10-12T09:00:00+02:00'))).toEqual({ ...t, file: null });
    expect(telecomIfFresh(null, paris('2026-10-08T22:00:00+02:00'))).toBeNull();
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

// ─── Internet (B1) ───
const NOW = Date.parse('2026-10-08T20:30:00Z');

function event(over: Partial<InternetEvent>): InternetEvent {
  return {
    id: `e${Math.random()}`, scope: 'departement', dept: '23', asn: null, label: 'Creuse', signal: 'bgp', start: '2026-10-08T19:00:00.000Z', end: null,
    durationSec: 5400, ongoing: true, staleOpen: false, score: 10, ...over,
  };
}

function radarItem(over: Partial<RadarItem>): RadarItem {
  return { id: `r${Math.random()}`, kind: 'anomalie', label: 'Free (AS12322)', asn: 12322, start: '2026-10-08T18:30:00.000Z', end: null, verified: false, cause: null, outageType: null, ...over };
}

function internet(events: InternetEvent[], items: RadarItem[] = [], over: Partial<InternetOutagesResponse> = {}): InternetOutagesResponse {
  return {
    readAt: '2026-10-08T20:25:00.000Z', iodaReadAt: '2026-10-08T20:25:00.000Z',
    radar: { configured: true, readAt: '2026-10-08T20:20:00.000Z', items }, events, ripe: null, errors: [], ...over,
  };
}

const scaleway = (): InternetEvent => event({ scope: 'operateur', dept: null, asn: 12876, label: 'Scaleway (AS12876)', durationSec: 631_292, staleOpen: true, start: '2026-10-01T13:05:00.000Z' });

describe('Internet : lieux en cours et pastille', () => {
  it('seul l’événement Scaleway « ouvert depuis plus de 7 jours » : vert, aucun lieu en cours', () => {
    const r = internet([scaleway()]);
    expect(internetLive(r, NOW)).toEqual([]);
    expect(internetLevel(r, NOW)).toBe('vert');
  });
  it('un département en cours : jaune ; trois : orange ; un opérateur non périmé : orange ; national : rouge', () => {
    expect(internetLevel(internet([event({})]), NOW)).toBe('jaune');
    expect(internetLevel(internet([event({ dept: '23' }), event({ dept: '09', label: 'Ariège' }), event({ dept: '87', label: 'Haute-Vienne' })]), NOW)).toBe('orange');
    expect(internetLevel(internet([event({ dept: '23' }), event({ dept: '09', label: 'Ariège' })]), NOW)).toBe('jaune');
    expect(internetLevel(internet([event({ scope: 'operateur', dept: null, asn: 3215, label: 'Orange (AS3215)' })]), NOW)).toBe('orange');
    expect(internetLevel(internet([event({ scope: 'national', dept: null, label: 'France' })]), NOW)).toBe('rouge');
  });
  it('événement terminé : ne compte pas ; région inconnue en cours : pas de lieu', () => {
    const r = internet([event({ ongoing: false, end: '2026-10-08T19:10:00.000Z' }), event({ scope: 'inconnu', dept: null, label: 'région non identifiée' })]);
    expect(internetLive(r, NOW)).toEqual([]);
    expect(internetLevel(r, NOW)).toBe('vert');
  });
  it('iodaReadAt null : null, jamais vert', () => {
    expect(internetLevel(internet([], [], { iodaReadAt: null }), NOW)).toBeNull();
  });
  it('R40 : lecture IODA en retard (plus d’une heure) : null, jamais la couleur d’événements figés', () => {
    const live = [event({ scope: 'national', dept: null, label: 'France' })];
    expect(internetLevel(internet(live), NOW)).toBe('rouge');
    expect(internetLevel(internet(live, [], { iodaReadAt: '2026-10-08T19:29:00.000Z' }), NOW)).toBeNull();
    expect(internetLevel(internet(live, [], { iodaReadAt: '2026-10-08T19:31:00.000Z' }), NOW)).toBe('rouge');
  });
  it('R40 : coupure Radar « nationale » sur plusieurs pays : orange (lieu propre), jamais rouge pour la France', () => {
    const multi = radarItem({ kind: 'panne', label: 'non localisé', asn: null, outageType: 'nationale, plusieurs pays' });
    expect(internetLevel(internet([], [multi]), NOW)).toBe('orange');
  });
  it('P13 : deux événements (bgp et ping-slash24) sur la Creuse comptent un seul lieu', () => {
    const r = internet([event({ signal: 'bgp' }), event({ signal: 'ping-slash24' })]);
    expect(internetLive(r, NOW)).toEqual([{ key: 'dept:23', scope: 'departement', label: 'Creuse', dept: '23', asn: null, source: 'ioda' }]);
  });
  it('P13 : une anomalie Radar d’un ASN déjà en cours chez IODA n’ajoute rien ; un ASN absent d’IODA s’ajoute', () => {
    const orange = event({ scope: 'operateur', dept: null, asn: 3215, label: 'Orange (AS3215)' });
    const r = internet([orange], [radarItem({ asn: 3215, label: 'Orange (AS3215)' }), radarItem({ asn: 12322, label: 'Free (AS12322)' })]);
    expect(internetLive(r, NOW).map((p) => [p.key, p.source])).toEqual([['asn:3215', 'ioda'], ['asn:12322', 'radar']]);
  });
  it('Radar : élément terminé ignoré ; panne régionale en cours = lieu propre (orange) ; panne nationale = rouge', () => {
    expect(internetLevel(internet([], [radarItem({ end: '2026-10-08T19:00:00.000Z' })]), NOW)).toBe('vert');
    const regional = radarItem({ kind: 'panne', label: 'Corse', asn: null, outageType: 'régionale' });
    expect(internetLevel(internet([], [regional]), NOW)).toBe('orange');
    expect(internetLive(internet([], [regional]), NOW)).toHaveLength(1);
    expect(internetLevel(internet([], [radarItem({ kind: 'panne', label: 'France entière', asn: null, outageType: 'nationale' })]), NOW)).toBe('rouge');
  });
  it('P29 : « national » vient de la portée, jamais du libellé « France »', () => {
    // Une anomalie Radar d’un opérateur dont le libellé contiendrait « France » reste un opérateur.
    expect(internetLevel(internet([], [radarItem({ label: 'France Télécom (AS5511)', asn: 5511 })]), NOW)).toBe('orange');
    // Un événement IODA départemental nommé « France » ne rend pas rouge.
    expect(internetLevel(internet([event({ label: 'France' })]), NOW)).toBe('jaune');
    // Anomalie Radar sans ASN (portée pays) : national, quel que soit son libellé.
    expect(internetLevel(internet([], [radarItem({ asn: null, label: 'Pays' })]), NOW)).toBe('rouge');
  });
  it('P14 : Radar en retard (lecture de plus d’une heure) ou jamais lu est ignoré', () => {
    const items = [radarItem({ asn: null, label: 'France' })];
    expect(internetLevel(internet([], items), NOW)).toBe('rouge');
    expect(internetLevel(internet([], items, { radar: { configured: true, readAt: '2026-10-08T19:29:00.000Z', items } }), NOW)).toBe('vert');
    expect(internetLevel(internet([], items, { radar: { configured: true, readAt: null, items } }), NOW)).toBe('vert');
    expect(internetLive(internet([], items, { radar: { configured: true, readAt: '2026-10-08T19:29:00.000Z', items } }), NOW)).toEqual([]);
  });
});
