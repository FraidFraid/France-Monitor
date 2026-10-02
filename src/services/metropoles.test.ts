// src/services/metropoles.test.ts : le J-1 est calé sur l'heure de la donnée, jamais sur « maintenant ».
import { describe, expect, it, vi } from 'vitest';
import { buildJ1Url, j1Instant, loadMetropoles } from './metropoles.ts';

const where = (url: string | null): string => decodeURIComponent(new URL(decodeURIComponent((url ?? '').split('url=')[1]!)).searchParams.get('where') ?? '');

describe('J-1 des métropoles', () => {
  it('instant J-1 = heure de la donnée − 24 h exactement', () => {
    expect(j1Instant('2026-10-02T00:00:00+00:00')).toBe('2026-10-01T00:00:00Z');
    expect(j1Instant('n/a')).toBeNull();
  });
  it('requête J-1 centrée sur dataTime − 24 h, jamais sur now − 24 h', () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-10-02T09:49:00Z'));
    const w = where(buildJ1Url(['2026-10-02T00:00:00+00:00']));
    vi.useRealTimers();
    expect(w).toContain("date'2026-10-01T00:00:00Z'");
    expect(w).not.toContain('2026-10-01T09');
  });
  it('heures de donnée distinctes : un instant par heure, doublons fusionnés', () => {
    const w = where(buildJ1Url(['2026-10-02T00:00:00+00:00', '2026-10-01T21:45:00+00:00', '2026-10-02T00:00:00+00:00']));
    expect(w.match(/date_heure = /g)).toHaveLength(2);
    expect(w).toContain('2026-10-01T21:45:00Z'.replace('10-01T21', '09-30T21'));
  });
  it('loadMetropoles compare chaque métropole à SA propre heure − 24 h (fetch injecté)', async () => {
    const latest = {
      results: [
        { code_insee_epci: '200054781', libelle_metropole: 'GP', date_heure: '2026-10-02T00:00:00+00:00', consommation: 2000 },
        { code_insee_epci: '200046977', libelle_metropole: 'Ly', date_heure: '2026-10-01T22:30:00+00:00', consommation: 900 },
      ],
    };
    const j1 = {
      results: [
        { code_insee_epci: '200054781', date_heure: '2026-10-01T00:00:00+00:00', consommation: 4000 },
        { code_insee_epci: '200046977', date_heure: '2026-09-30T22:30:00+00:00', consommation: 1000 },
        { code_insee_epci: '200046977', date_heure: '2026-10-01T00:00:00+00:00', consommation: 1 }, // mauvaise heure : ignorée
      ],
    };
    const calls: string[] = [];
    const fetchFn = async (url: string): Promise<Response> => {
      calls.push(url);
      const upstream = decodeURIComponent(url.split('url=')[1] ?? '');
      const body = upstream.includes('date_heure%20%3D') || upstream.includes('date_heure =') ? j1 : (upstream.includes('offset=0') ? latest : { results: [] });
      return { ok: true, json: async () => body } as Response;
    };
    const res = await loadMetropoles(fetchFn);
    const gp = res.find((m) => m.code === '200054781');
    const ly = res.find((m) => m.code === '200046977');
    expect(gp?.deltaVsJ1Pct).toBe(-50);
    expect(ly?.deltaVsJ1Pct).toBe(-10);
    const j1Call = where(calls.find((c) => where(c).includes('date_heure = ')) ?? null);
    expect(j1Call).toContain('2026-10-01T00:00:00Z');
    expect(j1Call).toContain('2026-09-30T22:30:00Z');
  });
  it('J-1 en échec : écart absent, jamais 0', async () => {
    const fetchFn = async (url: string): Promise<Response> => {
      if (decodeURIComponent(url).includes('date_heure = ')) throw new Error('net');
      return { ok: true, json: async () => ({ results: [{ code_insee_epci: '200054781', libelle_metropole: 'GP', date_heure: '2026-10-02T00:00:00+00:00', consommation: 2000 }] }) } as Response;
    };
    const res = await loadMetropoles(fetchFn);
    expect(res[0]?.deltaVsJ1Pct).toBeUndefined();
  });
});
