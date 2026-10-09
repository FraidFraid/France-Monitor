import { describe, expect, it } from 'vitest';
import {
  CLOUD_NO_INCIDENT_TEXT, CLOUD_PROVIDER_LABEL, CLOUD_STATUS_WORD, OUTAGES_LATE_AFTER_MIN, TELECOM_DISRUPTION_THRESHOLDS, cloudLevel, cloudLive, internetLevel, internetLive, internetPlaceLevel, internetSignalWord, isArcepFileLate, isDeducedZone, isOutagesDataLate, powerLevel, powerUnplannedMw,
  telecomIfFresh, telecomLevel,
} from './outages-levels.ts';
import { outagesSlotStatus } from './outages-source.ts';
import type {
  CloudIncident, CloudOutagesResponse, CloudProvider, CloudProviderState, CloudStatus, CloudZone, InternetEvent, InternetOutagesResponse, PowerOutagesResponse, PowerUnitOutage, RadarItem, TelecomOutagesResponse,
} from '../types/index.ts';

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
  return { id: `r${Math.random()}`, kind: 'anomalie', label: 'Free (AS12322)', asn: 12322, start: '2026-10-08T18:30:00.000Z', end: null, verified: false, cause: null, outageType: null, national: false, ...over };
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
  it('P29 : la portée vient du champ `national`, jamais du texte du type : un type « nationale » sans portée nationale reste un lieu propre', () => {
    const textOnly = radarItem({ kind: 'panne', label: 'non localisé', asn: null, outageType: 'nationale', national: false });
    expect(internetLevel(internet([], [textOnly]), NOW)).toBe('orange');
    expect(internetLive(internet([], [textOnly]), NOW).map((p) => p.scope)).toEqual(['inconnu']);
  });
  it('P13 : deux événements (bgp et ping-slash24) sur la Creuse comptent un seul lieu', () => {
    const r = internet([event({ signal: 'bgp' }), event({ signal: 'ping-slash24' })]);
    expect(internetLive(r, NOW)).toEqual([{ key: 'dept:23', scope: 'departement', label: 'Creuse', dept: '23', asn: null, source: 'ioda', radarKind: null }]);
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
    expect(internetLevel(internet([], [radarItem({ kind: 'panne', label: 'France entière', asn: null, outageType: 'nationale', national: true })]), NOW)).toBe('rouge');
  });
  it('P29 : « national » vient de la portée, jamais du libellé « France »', () => {
    // Une anomalie Radar d’un opérateur dont le libellé contiendrait « France » reste un opérateur.
    expect(internetLevel(internet([], [radarItem({ label: 'France Télécom (AS5511)', asn: 5511 })]), NOW)).toBe('orange');
    // Un événement IODA départemental nommé « France » ne rend pas rouge.
    expect(internetLevel(internet([event({ label: 'France' })]), NOW)).toBe('jaune');
    // Anomalie Radar sans ASN (portée pays) : lieu national quel que soit son libellé, mais orange (règle Radar ci-dessous).
    expect(internetLive(internet([], [radarItem({ asn: null, label: 'Pays', national: true })]), NOW).map((p) => p.scope)).toEqual(['national']);
  });
  it('règle Radar (spec § 3.1) : une anomalie de trafic nationale n’est jamais rouge (orange au plus) ; seule une panne NATIONWIDE de la France seule est rouge', () => {
    const anomaly = radarItem({ kind: 'anomalie', asn: null, label: 'France', national: true, verified: true });
    expect(internetLevel(internet([], [anomaly]), NOW)).toBe('orange');
    expect(internetLevel(internet([], [{ ...anomaly, verified: false }]), NOW)).toBe('orange');
    const [place] = internetLive(internet([], [anomaly]), NOW);
    expect(internetPlaceLevel(place)).toBe('orange');
    const outage = radarItem({ kind: 'panne', label: 'France', asn: null, outageType: 'nationale', national: true });
    expect(internetLevel(internet([], [outage]), NOW)).toBe('rouge');
    expect(internetPlaceLevel(internetLive(internet([], [outage]), NOW)[0])).toBe('rouge');
    // Un événement IODA national reste rouge, même si Radar voit aussi une anomalie nationale (IODA prime au dédoublonnage).
    expect(internetLevel(internet([event({ scope: 'national', dept: null, label: 'France' })], [anomaly]), NOW)).toBe('rouge');
    // Portées : opérateur orange, département jaune, lieu non localisé orange.
    expect(internetPlaceLevel(internetLive(internet([event({})]), NOW)[0])).toBe('jaune');
    expect(internetPlaceLevel(internetLive(internet([], [radarItem({})]), NOW)[0])).toBe('orange');
  });
  it('règle Radar : anomalie nationale et panne NATIONWIDE (France seule) en même temps : la panne l’emporte (rouge) dans les deux ordres', () => {
    const anomaly = radarItem({ kind: 'anomalie', asn: null, label: 'France', national: true, start: '2026-10-08T19:00:00.000Z' });
    const outage = radarItem({ kind: 'panne', asn: null, label: 'France', outageType: 'nationale', national: true, start: '2026-10-08T18:30:00.000Z' });
    for (const items of [[anomaly, outage], [outage, anomaly]]) {
      const r = internet([], items);
      expect(internetLevel(r, NOW)).toBe('rouge');
      const live = internetLive(r, NOW);
      expect(live.map((p) => [p.key, p.radarKind])).toEqual([['national', 'panne']]);
      expect(internetPlaceLevel(live[0])).toBe('rouge');
    }
    // Un événement IODA national reste prioritaire (source IODA), rouge.
    const withIoda = internetLive(internet([event({ scope: 'national', dept: null, label: 'France' })], [anomaly, outage]), NOW);
    expect(withIoda.map((p) => [p.key, p.source])).toEqual([['national', 'ioda']]);
  });
  it('P14 : Radar en retard (lecture de plus d’une heure) ou jamais lu est ignoré', () => {
    const items = [radarItem({ kind: 'panne', asn: null, label: 'France', outageType: 'nationale', national: true })];
    expect(internetLevel(internet([], items), NOW)).toBe('rouge');
    expect(internetLevel(internet([], items, { radar: { configured: true, readAt: '2026-10-08T19:29:00.000Z', items } }), NOW)).toBe('vert');
    expect(internetLevel(internet([], items, { radar: { configured: true, readAt: null, items } }), NOW)).toBe('vert');
    expect(internetLive(internet([], items, { radar: { configured: true, readAt: '2026-10-08T19:29:00.000Z', items } }), NOW)).toEqual([]);
  });
});

function cloudZone(status: CloudStatus, id = 'GRA'): CloudZone {
  return { id, label: id, status, updatedAt: '2026-10-08T19:00:00.000Z', lat: 50.99, lon: 2.13 };
}

function cloudProvider(provider: CloudProvider, zones: CloudZone[], readAt: string | null = '2026-10-08T19:50:00.000Z'): CloudProviderState {
  return { provider, label: CLOUD_PROVIDER_LABEL[provider], readAt, zones, note: null, error: null };
}

function cloudIncident(over: Partial<CloudIncident>): CloudIncident {
  return { id: `c${Math.random()}`, provider: 'ovhcloud', title: '[RBX4] incident', zones: ['RBX4'], state: 'en-cours', impact: 'minor', start: '2026-10-08T18:00:00.000Z', updatedAt: null, url: null, ...over };
}

function cloud(providers: CloudProviderState[], incidents: CloudIncident[] = [], over: Partial<CloudOutagesResponse> = {}): CloudOutagesResponse {
  return { readAt: '2026-10-08T19:50:00.000Z', providers, incidents, maintenances: [], elsewhere: [], reference: { generatedAt: null, datacenters: [], exchanges: [] }, errors: [], ...over };
}

describe('Cloud : pastille', () => {
  it('noms des sept fournisseurs', () => {
    expect(Object.values(CLOUD_PROVIDER_LABEL)).toEqual(['OVHcloud', 'Scaleway', 'Cloudflare', 'Google Cloud', 'AWS', 'Outscale', 'Azure']);
  });
  it('aucun fournisseur lu (ni lecture ni zone) : null, jamais vert', () => {
    expect(cloudLevel(cloud([cloudProvider('ovhcloud', [], null), cloudProvider('azure', [], null)]), NOW)).toBeNull();
  });
  it('un fournisseur lu, rien à signaler : vert', () => {
    expect(cloudLevel(cloud([cloudProvider('scaleway', [cloudZone('operational', 'fr-par-1')])]), NOW)).toBe('vert');
  });
  it('incident « surveillé » seul : vert (listé, non compté)', () => {
    expect(cloudLevel(cloud([cloudProvider('ovhcloud', [cloudZone('operational')])], [cloudIncident({ state: 'surveille', impact: 'critical' })]), NOW)).toBe('vert');
  });
  it('incident en cours : jaune (minor), orange (major), rouge (critical)', () => {
    const providers = [cloudProvider('ovhcloud', [cloudZone('operational')])];
    expect(cloudLevel(cloud(providers, [cloudIncident({ impact: 'minor' })]), NOW)).toBe('jaune');
    expect(cloudLevel(cloud(providers, [cloudIncident({ impact: 'major' })]), NOW)).toBe('orange');
    expect(cloudLevel(cloud(providers, [cloudIncident({ impact: 'critical' })]), NOW)).toBe('rouge');
  });
  it('zone dégradée : jaune ; panne partielle : orange ; panne majeure : rouge ; le plus grave l’emporte', () => {
    expect(cloudLevel(cloud([cloudProvider('ovhcloud', [cloudZone('degraded')])]), NOW)).toBe('jaune');
    expect(cloudLevel(cloud([cloudProvider('ovhcloud', [cloudZone('partial')])]), NOW)).toBe('orange');
    expect(cloudLevel(cloud([cloudProvider('ovhcloud', [cloudZone('partial')]), cloudProvider('aws', [cloudZone('major', 'eu-west-3')])]), NOW)).toBe('rouge');
  });
  it('maintenance ou zone inconnue : vert (ni panne ni état connu)', () => {
    expect(cloudLevel(cloud([cloudProvider('scaleway', [cloudZone('maintenance', 'DC1'), cloudZone('unknown', 'fr-par-2')])]), NOW)).toBe('vert');
  });
  it('P2 : un incident « ailleurs » (hors France) ne colore pas', () => {
    expect(cloudLevel(cloud([cloudProvider('ovhcloud', [cloudZone('operational')])], [], { elsewhere: [cloudIncident({ impact: 'critical', zones: [] })] }), NOW)).toBe('vert');
  });
  it('P14 : fournisseur en retard (lecture de plus de 2 h) écarté : OVHcloud en panne partielle périmée, Scaleway frais : vert', () => {
    const late = '2026-10-08T18:29:00.000Z';
    const r = cloud([cloudProvider('ovhcloud', [cloudZone('partial')], late), cloudProvider('scaleway', [cloudZone('operational', 'fr-par-1')])]);
    expect(cloudLevel(r, NOW)).toBe('vert');
    // Juste sous la limite (lecture + 2 h), la couleur est gardée.
    expect(cloudLevel(cloud([cloudProvider('ovhcloud', [cloudZone('partial')], '2026-10-08T18:31:00.000Z'), cloudProvider('scaleway', [])]), NOW)).toBe('orange');
  });
  it('P14 : incident en cours d’un fournisseur en retard : ni compté ni coloré ; celui d’un fournisseur à jour reste', () => {
    const late = '2026-10-08T18:00:00.000Z';
    const stale = cloudIncident({ provider: 'ovhcloud', impact: 'critical' });
    const fresh = cloudIncident({ provider: 'scaleway', impact: 'major', zones: ['fr-par-1'] });
    const r = cloud([cloudProvider('ovhcloud', [cloudZone('operational')], late), cloudProvider('scaleway', [cloudZone('operational', 'fr-par-1')])], [stale, fresh]);
    expect(cloudLive(r, NOW).incidents).toEqual([fresh]);
    expect(cloudLive(r, NOW).freshProviders).toEqual(['scaleway']);
    expect(cloudLevel(r, NOW)).toBe('orange');
  });
  it('P14 : tous les fournisseurs en retard : null, jamais vert ni la couleur de données figées', () => {
    const late = '2026-10-08T17:00:00.000Z';
    const r = cloud([cloudProvider('ovhcloud', [cloudZone('major')], late), cloudProvider('aws', [cloudZone('major', 'eu-west-3')], late)], [cloudIncident({ impact: 'critical' })]);
    expect(cloudLive(r, NOW)).toEqual({ freshProviders: [], incidents: [], zones: [] });
    expect(cloudLevel(r, NOW)).toBeNull();
  });
  it('cloudLive : « surveillé » et « ailleurs » ne sont jamais en cours ; les maintenances ne comptent pas', () => {
    const r = cloud([cloudProvider('ovhcloud', [cloudZone('maintenance')])], [cloudIncident({ state: 'surveille' })], { elsewhere: [cloudIncident({})] });
    expect(cloudLive(r, NOW).incidents).toEqual([]);
  });
});

describe('vocabulaire partagé par la carte et les panneaux (R25)', () => {
  it('isDeducedZone : seul « opérationnel » sans date chez Google Cloud ou AWS est déduit de l’absence d’incident', () => {
    expect(isDeducedZone('gcp', { status: 'operational', updatedAt: null })).toBe(true);
    expect(isDeducedZone('aws', { status: 'operational', updatedAt: null })).toBe(true);
    expect(isDeducedZone('gcp', { status: 'degraded', updatedAt: null })).toBe(false);
    expect(isDeducedZone('gcp', { status: 'operational', updatedAt: '2026-10-08T10:00:00Z' })).toBe(false);
    expect(isDeducedZone('cloudflare', { status: 'operational', updatedAt: null })).toBe(false);
    expect(isDeducedZone('ovhcloud', { status: 'operational', updatedAt: null })).toBe(false);
    expect(CLOUD_NO_INCIDENT_TEXT).toBe('aucun incident publié');
  });
  it('CLOUD_STATUS_WORD couvre les six statuts ; internetSignalWord dit les quatre sources d’IODA et reprend un nom inconnu tel quel', () => {
    expect(Object.keys(CLOUD_STATUS_WORD).sort()).toEqual(['degraded', 'maintenance', 'major', 'operational', 'partial', 'unknown']);
    expect(['bgp', 'ping-slash24', 'merit-nt', 'gtr'].map(internetSignalWord)).toEqual(['signal BGP', 'sonde ping', 'télescope réseau', 'trafic Google']);
    expect(internetSignalWord('nouveau')).toBe('nouveau');
  });
});
