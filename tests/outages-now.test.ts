// tests/outages-now.test.ts : pannes de téléphone et d'internet en cours, toutes sources (api/_lib/outages-now.js, 21/10/2026).
import { describe, expect, it } from 'vitest';
import { outagesNow } from '../api/_lib/outages-now.js';
import { fleetLevel } from '../src/services/nuclear-fleet.ts';

const NOW = Date.parse('2026-10-21T12:00:00Z');
const press = (over: Record<string, unknown> = {}) => ({
  operator: 'Orange', severity: 'high', articles: 19, sources: 16, firstAt: '2026-10-21T10:00:00Z', lastAt: '2026-10-21T11:00:00Z',
  title: 'Orange : panne nationale', link: 'https://ex.fr/a', national: true, ...over,
});
const telecom = (over: Record<string, unknown> = {}) => ({
  file: { day: '2026-10-21', publishedAt: '2026-10-21T09:02:00Z' }, summary: { recent: 120 },
  byDept: [{ dept: '13', recent: 77 }, { dept: '32', recent: 25 }, { dept: '31', recent: 6 }], press: [press()], errors: [], ...over,
});
const internet = (over: Record<string, unknown> = {}) => ({
  iodaReadAt: '2026-10-21T11:50:00Z',
  events: [
    { scope: 'departement', dept: '32', asn: null, label: 'Gers', signal: 'bgp', start: '2026-10-21T10:30:00Z', ongoing: true, staleOpen: false },
    { scope: 'departement', dept: '60', asn: null, label: 'Oise', signal: 'bgp', start: '2026-10-14T10:30:00Z', ongoing: true, staleOpen: true },
    { scope: 'operateur', dept: null, asn: 3215, label: 'Orange (AS3215)', signal: 'ping-slash24', start: '2026-10-21T09:50:00Z', ongoing: true, staleOpen: false },
  ],
  radar: { configured: true, readAt: '2026-10-21T11:55:00Z', items: [] }, errors: [], ...over,
});

describe('pannes en cours : fusion des sources', () => {
  it('presse Orange et IODA AS3215 : deux pannes distinctes, mobile|op:Orange (signalee) et internet|op:Orange (mesuree)', () => {
    const all = outagesNow({ telecom: telecom(), internet: internet(), power: null, cloud: null, now: NOW });
    const orange = all.find((o) => o.id === 'mobile|op:Orange');
    expect(all.find((o) => o.id === 'internet|op:Orange')).toMatchObject({ network: 'internet', rung: 'mesuree', since: '2026-10-21T09:50:00Z' });
    expect(orange).toMatchObject({ id: 'mobile|op:Orange', network: 'mobile', level: 'orange', national: true, rung: 'signalee', measured: false });
  });
  it('départements : ARCEP (mobile) et IODA (internet) séparés ; sous le seuil ou recalage IODA écartés', () => {
    const all = outagesNow({ telecom: telecom(), internet: internet(), power: null, cloud: null, now: NOW });
    expect(all.find((o) => o.id === 'mobile|dept:13')).toMatchObject({ level: 'orange', rung: 'mesuree', network: 'mobile' });
    expect(all.find((o) => o.id === 'mobile|dept:32')).toMatchObject({ level: 'jaune', evidence: [{ source: 'arcep' }] });
    expect(all.find((o) => o.id === 'internet|dept:32')).toMatchObject({ level: 'jaune', label: 'Gers', evidence: [{ source: 'ioda' }] });
    expect(all.some((o) => o.id === 'internet|dept:60' || o.id === 'mobile|dept:31')).toBe(false);
  });
  it('sources en retard ignorées : ARCEP de plus de 30 h, IODA de plus d’une heure ; la presse reste', () => {
    const all = outagesNow({
      telecom: telecom({ file: { day: '2026-10-19', publishedAt: '2026-10-19T09:02:00Z' } }),
      internet: internet({ iodaReadAt: '2026-10-21T10:00:00Z' }), power: null, cloud: null, now: NOW,
    });
    expect(all).toEqual([expect.objectContaining({ id: 'mobile|op:Orange', measured: false })]);
  });
  it('pays entier : plus de 600 antennes récentes en rouge (mobile) ; anomalie Radar nationale en orange (internet)', () => {
    const all = outagesNow({
      telecom: telecom({ summary: { recent: 650 }, byDept: [], press: [] }),
      internet: internet({ events: [], radar: { configured: true, readAt: '2026-10-21T11:55:00Z', items: [{ id: 'r1', kind: 'anomalie', label: 'France', asn: null, start: '2026-10-21T11:00:00Z', end: null, cause: null, national: true }] } }),
      power: null, cloud: null, now: NOW,
    });
    expect(all.map((o) => o.id)).toEqual(['mobile|national', 'internet|national']);
    expect(all[0]).toMatchObject({ scope: 'national', level: 'rouge', evidence: [expect.objectContaining({ source: 'arcep' })] });
    expect(all[1]).toMatchObject({ level: 'orange', evidence: [expect.objectContaining({ source: 'radar' })] });
  });
});

const power = (over: Record<string, unknown> = {}) => ({
  iipReadAt: '2026-10-21T11:55:00Z', edfReadAt: '2026-10-21T11:55:00Z',
  unplanned: [{ id: 'u1', name: 'PALUEL 1', lostMw: 1300, start: '2026-10-21T08:00:00Z', end: null }, { id: 'u2', name: 'FLAMANVILLE 2', lostMw: 1700, start: '2026-10-21T09:00:00Z', end: null }],
  transmission: { unplanned: [
    { id: '1', asset: 'Mandarins-Sellindge 1', start: '2026-10-21T07:00:00Z', end: null, publishedAt: '2026-10-21T07:05:00Z', reason: 'Défaillance' },
    { id: '2', asset: 'Ligne terminée', start: '2026-10-20T07:00:00Z', end: '2026-10-21T08:00:00Z', publishedAt: '2026-10-20T07:05:00Z', reason: null },
  ], planned: [] },
  ...over,
});
const cloud = (over: Record<string, unknown> = {}) => ({
  providers: [{ provider: 'ovhcloud', label: 'OVHcloud', readAt: '2026-10-21T11:40:00Z' }, { provider: 'scaleway', label: 'Scaleway', readAt: '2026-10-21T08:00:00Z' }],
  incidents: [
    { id: 'i1', provider: 'ovhcloud', title: 'Incident <b>RBX</b>', zones: ['rbx'], state: 'en-cours', impact: 'critical', start: '2026-10-21T11:00:00Z', updatedAt: null, url: 'https://status.ovh/i1' },
    { id: 'i2', provider: 'scaleway', title: 'Incident PAR', zones: ['par'], state: 'en-cours', impact: 'major', start: '2026-10-21T07:00:00Z', updatedAt: null, url: null },
    { id: 'i3', provider: 'ovhcloud', title: 'Surveillé', zones: [], state: 'surveille', impact: 'minor', start: '2026-10-21T10:00:00Z', updatedAt: null, url: null },
  ],
  ...over,
});
const only = (o: { telecom?: unknown; internet?: unknown; power?: unknown; cloud?: unknown }) =>
  outagesNow({ telecom: o.telecom ?? null, internet: o.internet ?? null, power: o.power ?? null, cloud: o.cloud ?? null, now: NOW });

describe('pannes en cours : électricité, cloud et échelon', () => {
  it('RTE transport imprévu en cours : electricite|ouvrage, orange, rte, mesurée ; terminé : absent', () => {
    const all = only({ power: power() }).filter((o) => o.id.startsWith('electricite|ouvrage'));
    expect(all).toEqual([expect.objectContaining({ id: 'electricite|ouvrage:Mandarins-Sellindge 1', network: 'electricite', level: 'orange', rung: 'mesuree', evidence: [expect.objectContaining({ source: 'rte' })] })]);
  });
  it('arrêts imprévus de production : 3 000 MW orange, 6 000 MW rouge, 2 999 MW absent (aligné sur fleetLevel)', () => {
    const nat = (mw: number) => only({ power: power({ unplanned: [{ id: 'u', name: 'X', lostMw: mw, start: '2026-10-21T08:00:00Z', end: null }], transmission: null }) })
      .find((o) => o.id === 'electricite|national');
    expect(nat(3000)).toMatchObject({ level: 'orange', evidence: [expect.objectContaining({ source: 'edf' })] });
    expect(nat(6000)?.level).toBe('rouge');
    expect(nat(2999)).toBeUndefined();
    expect(fleetLevel(3000)).toBe('orange');
    expect(fleetLevel(6000)).toBe('rouge');
  });
  it('électricité : relève RTE ou EDF de plus d’une heure ignorée (une source en retard ne compte pas)', () => {
    expect(only({ power: power({ iipReadAt: '2026-10-21T10:30:00Z' }) }).some((o) => o.id.startsWith('electricite|ouvrage'))).toBe(false);
    const stale = power({ edfReadAt: '2026-10-21T10:30:00Z', unplanned: [{ id: 'u', name: 'X', lostMw: 7000, start: '2026-10-21T08:00:00Z', end: null }] });
    expect(only({ power: stale }).some((o) => o.id === 'electricite|national')).toBe(false);
  });
  it('cloud : incident en cours d’un fournisseur lu depuis moins de 2 h, niveau par impact, confirmée par la page d’état', () => {
    const all = only({ cloud: cloud() });
    expect(all).toEqual([expect.objectContaining({
      id: 'cloud|op:OVHcloud', network: 'cloud', level: 'rouge', rung: 'confirmee', measured: true,
      evidence: [expect.objectContaining({ source: 'statut', link: 'https://status.ovh/i1' })],
    })]);
    const fresh = only({ cloud: cloud({ providers: [{ provider: 'scaleway', label: 'Scaleway', readAt: '2026-10-21T11:00:00Z' }] }) });
    expect(fresh).toEqual([expect.objectContaining({ id: 'cloud|op:Scaleway', level: 'orange' })]);
  });
  it('échelon : presse seule signalée ; presse + ARCEP sur le même territoire mesurée', () => {
    const t = telecom({ press: [press({ operator: null, national: true })], summary: { recent: 650 }, byDept: [] });
    const nat = only({ telecom: t }).find((o) => o.id === 'mobile|national');
    expect(nat).toMatchObject({ rung: 'mesuree', evidence: [expect.objectContaining({ source: 'presse' }), expect.objectContaining({ source: 'arcep' })] });
    expect(only({ telecom: telecom({ summary: { recent: 10 }, byDept: [] }) })[0]).toMatchObject({ rung: 'signalee' });
  });
});

describe('pannes en cours : presse de tous les réseaux (21/10/2026)', () => {
  const report = (over: Record<string, unknown>) => ({
    network: 'electricite', operator: 'Enedis', severity: 'high', level: 'orange', articles: 4, sources: 3,
    firstAt: '2026-10-21T10:00:00Z', lastAt: '2026-10-21T11:00:00Z', title: 'Panne de courant', link: 'https://ex.fr', national: false, ...over,
  });
  it('signalements presse de tous les réseaux : réseau, opérateur, niveau du signalement, échelon signalé', () => {
    const all = outagesNow({
      telecom: telecom({ press: [] }), internet: null, power: null, cloud: null, now: NOW,
      press: [report({}), report({ network: 'urgence', operator: null, level: 'rouge', title: '112 injoignable' })],
    });
    expect(all.find((o) => o.id === 'electricite|op:Enedis')).toMatchObject({ network: 'electricite', level: 'orange', rung: 'signalee' });
    expect(all.find((o) => o.network === 'urgence')).toMatchObject({ level: 'rouge', label: 'signalement presse', scope: 'inconnu' });
  });
  it('sans signalements fournis : presse des télécoms reprise (réseau mobile)', () => {
    expect(outagesNow({ telecom: telecom(), internet: null, power: null, cloud: null, now: NOW }).some((o) => o.id === 'mobile|op:Orange')).toBe(true);
  });
});

describe('pannes en cours : signalements d’usagers (21/10/2026)', () => {
  it('pic d’usagers : panne signalée, rejoint la presse du même opérateur ; jamais mesurée', () => {
    const all = outagesNow({
      telecom: telecom({ summary: { recent: 10 }, byDept: [] }), internet: null, power: null, cloud: null, now: NOW,
      social: [
        { network: 'mobile', operator: 'Orange', level: 'orange', recent: 42, baseline: 1.5, since: '2026-10-21T09:45:00Z', link: 'https://bsky.app/search?q=panne+orange', queries: ['panne orange'] },
        { network: 'eau', operator: null, level: 'jaune', recent: 11, baseline: 0.2, since: '2026-10-21T11:40:00Z', link: 'https://bsky.app/search?q=x', queries: ['x'] },
      ],
    });
    const orange = all.find((o) => o.id === 'mobile|op:Orange');
    expect(orange).toMatchObject({ rung: 'signalee', since: '2026-10-21T09:45:00Z' });
    expect(orange?.evidence.map((e) => e.source)).toEqual(['presse', 'usagers']);
    expect(orange?.evidence[1]?.text).toContain('42 messages en 15 min');
    expect(all.find((o) => o.network === 'eau')).toMatchObject({ level: 'jaune', rung: 'signalee', label: 'signalement d’usagers' });
  });
});

describe('pannes en cours : sondes RIPE Atlas (21/10/2026)', () => {
  it('sondes décrochées : panne d’internet fixe mesurée par opérateur, et nationale', () => {
    const all = outagesNow({
      telecom: null, internet: null, power: null, cloud: null, now: NOW,
      atlas: [
        { asn: 12322, operator: 'Free', down: 9, active: 60, level: 'orange', since: '2026-10-21T11:50:00Z' },
        { asn: null, operator: null, down: 25, active: 200, level: 'orange', since: '2026-10-21T11:48:00Z' },
      ],
    });
    expect(all.find((o) => o.id === 'internet|op:Free')).toMatchObject({ level: 'orange', rung: 'mesuree', evidence: [expect.objectContaining({ source: 'atlas' })] });
    expect(all.find((o) => o.id === 'internet|op:Free')?.evidence[0]?.text).toContain('9 sondes RIPE Atlas décrochées sur 60 (15 %)');
    expect(all.find((o) => o.id === 'internet|national')).toMatchObject({ national: true, rung: 'mesuree' });
  });
});

describe('pannes en cours : pages d’état élargies (21/10/2026)', () => {
  it('incident Google Workspace ou GitHub : panne cloud confirmée, dite mondiale', () => {
    const all = outagesNow({
      telecom: null, internet: null, power: null, cloud: null, now: NOW,
      status: [{ operator: 'Google Workspace', level: 'rouge', title: 'Gmail : coupure de service', since: '2026-10-21T10:00:00Z', link: 'https://www.google.com/appsstatus/dashboard/incidents/a' }],
    });
    expect(all).toEqual([expect.objectContaining({ id: 'cloud|op:Google Workspace', level: 'rouge', rung: 'confirmee' })]);
    expect(all[0]?.evidence[0]?.text).toBe('Gmail : coupure de service (incident mondial)');
  });
});
