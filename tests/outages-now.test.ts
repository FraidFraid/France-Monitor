// tests/outages-now.test.ts : pannes de téléphone et d'internet en cours, toutes sources (api/_lib/outages-now.js, 21/10/2026).
import { describe, expect, it } from 'vitest';
import { outagesNow } from '../api/_lib/outages-now.js';
import { loadOutagesNow } from '../api/_handlers/outages/now.js';

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
  it('même opérateur vu par la presse et par IODA : une seule panne, mesurée, depuis la première preuve', () => {
    const [orange] = outagesNow({ telecom: telecom(), internet: internet(), now: NOW });
    expect(orange).toMatchObject({ id: 'op:Orange', level: 'orange', national: true, measured: true, since: '2026-10-21T09:50:00Z' });
    expect(orange?.evidence.map((e) => e.source).sort()).toEqual(['ioda', 'presse']);
  });
  it('département : ARCEP au-dessus du seuil et IODA réunis ; sous le seuil ou recalage IODA écartés', () => {
    const all = outagesNow({ telecom: telecom(), internet: internet(), now: NOW });
    expect(all.map((o) => o.id)).toEqual(['op:Orange', 'dept:13', 'dept:32']);
    expect(all.find((o) => o.id === 'dept:32')).toMatchObject({ level: 'jaune', label: 'Gers', evidence: [{ source: 'arcep' }, { source: 'ioda' }] });
  });
  it('sources en retard ignorées : ARCEP de plus de 30 h, IODA de plus d’une heure ; la presse reste', () => {
    const all = outagesNow({
      telecom: telecom({ file: { day: '2026-10-19', publishedAt: '2026-10-19T09:02:00Z' } }),
      internet: internet({ iodaReadAt: '2026-10-21T10:00:00Z' }), now: NOW,
    });
    expect(all).toEqual([expect.objectContaining({ id: 'op:Orange', measured: false })]);
  });
  it('pays entier : plus de 600 antennes récentes en rouge ; anomalie Radar nationale en orange', () => {
    const all = outagesNow({
      telecom: telecom({ summary: { recent: 650 }, byDept: [], press: [] }),
      internet: internet({ events: [], radar: { configured: true, readAt: '2026-10-21T11:55:00Z', items: [{ id: 'r1', kind: 'anomalie', label: 'France', asn: null, start: '2026-10-21T11:00:00Z', end: null, cause: null, national: true }] } }),
      now: NOW,
    });
    expect(all).toEqual([expect.objectContaining({ id: 'national', scope: 'national', level: 'rouge', evidence: [expect.objectContaining({ source: 'arcep' }), expect.objectContaining({ source: 'radar' })] })]);
  });
  it('route : sources datées, erreurs reprises, jamais d’exception', async () => {
    const body = await loadOutagesNow(NOW, { readTelecom: async () => telecom({ errors: ['Presse : Neon injoignable'] }), readInternet: async () => internet({ radar: { configured: false, readAt: null, items: [] } }) });
    expect(body.sources).toEqual([
      { source: 'presse', readAt: '2026-10-21T12:00:00.000Z', ok: true }, { source: 'arcep', readAt: '2026-10-21T09:02:00Z', ok: true },
      { source: 'ioda', readAt: '2026-10-21T11:50:00Z', ok: true }, { source: 'radar', readAt: null, ok: false },
    ]);
    expect(body.errors).toEqual(['Presse : Neon injoignable']);
    expect(body.outages.length).toBe(3);
  });
});
