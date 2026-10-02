// src/services/metropoles.test.ts : le J-1 est calé sur l'heure de la donnée, jamais sur « maintenant ».
import { describe, expect, it, vi } from 'vitest';
import { buildJ1Url, j1Instant, loadMetropoles } from './metropoles.ts';

/** Clause `where` de la requête ODRÉ amont, extraite de l'URL du proxy. */
const where = (url: string | null): string => {
  const upstream = new URLSearchParams((url ?? '').split('?')[1] ?? '').get('url') ?? '';
  return upstream ? new URL(upstream).searchParams.get('where') ?? '' : '';
};
const isJ1 = (url: string): boolean => where(url).includes('date_heure = ');
const at = (code: string, dateHeure: string): { code: string; dateHeure: string } => ({ code, dateHeure });

describe('J-1 des métropoles', () => {
  it('instant J-1 = heure de la donnée − 24 h exactement', () => {
    expect(j1Instant('2026-10-02T00:00:00+00:00')).toBe('2026-10-01T00:00:00Z');
    expect(j1Instant('n/a')).toBeNull();
  });
  it('requête J-1 centrée sur dataTime − 24 h, jamais sur now − 24 h', () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-10-02T09:49:00Z'));
    const w = where(buildJ1Url([at('200054781', '2026-10-02T00:00:00+00:00')]));
    vi.useRealTimers();
    expect(w).toContain("date'2026-10-01T00:00:00Z'");
    expect(w).not.toContain('2026-10-01T09');
  });
  it('heures de donnée distinctes : un instant par heure, chaque métropole sous sa propre heure', () => {
    const w = where(buildJ1Url([at('200054781', '2026-10-02T00:00:00+00:00'), at('200046977', '2026-10-01T21:45:00+00:00'), at('200040715', '2026-10-02T00:00:00+00:00')]));
    expect(w.match(/date_heure = /g)).toHaveLength(2);
    expect(w).toContain("(date_heure = date'2026-10-01T00:00:00Z' AND code_insee_epci in ('200054781','200040715'))");
    expect(w).toContain("(date_heure = date'2026-09-30T21:45:00Z' AND code_insee_epci in ('200046977'))");
  });
  it('volume réel (21 métropoles, 9 heures distinctes) : au plus une ligne par métropole, sous la limite de 100', () => {
    const times = ['21:45', '22:15', '22:30', '22:45', '23:00', '23:15', '23:30', '23:45'].map((h) => `2026-10-01T${h}:00+00:00`).concat('2026-10-02T00:00:00+00:00');
    const latest = Array.from({ length: 21 }, (_, i) => at(String(200000000 + i), times[i % times.length]!));
    const w = where(buildJ1Url(latest));
    expect(w.match(/date_heure = /g)).toHaveLength(9);
    // Chaque métropole n'est demandée qu'à un seul instant : 21 lignes au plus.
    for (const { code } of latest) expect(w.split(`'${code}'`)).toHaveLength(2);
  });
  it('code non numérique écarté de la requête', () => {
    expect(buildJ1Url([at("x' OR 1=1", '2026-10-02T00:00:00+00:00')])).toBeNull();
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
      const body = isJ1(url) ? j1 : (decodeURIComponent(url).includes('offset=0') ? latest : { results: [] });
      return { ok: true, json: async () => body } as Response;
    };
    const res = await loadMetropoles(fetchFn);
    const gp = res.find((m) => m.code === '200054781');
    const ly = res.find((m) => m.code === '200046977');
    expect(gp?.deltaVsJ1Pct).toBe(-50);
    expect(ly?.deltaVsJ1Pct).toBe(-10);
    const j1Call = where(calls.find(isJ1) ?? null);
    expect(j1Call).toContain('2026-10-01T00:00:00Z');
    expect(j1Call).toContain('2026-09-30T22:30:00Z');
  });
  it('J-1 en échec : écart absent, jamais 0', async () => {
    const fetchFn = async (url: string): Promise<Response> => {
      if (isJ1(url)) throw new Error('net');
      return { ok: true, json: async () => ({ results: [{ code_insee_epci: '200054781', libelle_metropole: 'GP', date_heure: '2026-10-02T00:00:00+00:00', consommation: 2000 }] }) } as Response;
    };
    const res = await loadMetropoles(fetchFn);
    expect(res[0]?.deltaVsJ1Pct).toBeUndefined();
  });
  it('seconde page en échec : les métropoles de la première page restent affichées', async () => {
    const fetchFn = async (url: string): Promise<Response> => {
      if (isJ1(url)) return { ok: true, json: async () => ({ results: [] }) } as Response;
      if (decodeURIComponent(url).includes('offset=100')) return { ok: false, status: 503, json: async () => ({}) } as Response;
      return { ok: true, json: async () => ({ results: [{ code_insee_epci: '200054781', libelle_metropole: 'GP', date_heure: '2026-10-02T00:00:00+00:00', consommation: 2000 }] }) } as Response;
    };
    const res = await loadMetropoles(fetchFn);
    expect(res.map((m) => m.code)).toEqual(['200054781']);
  });
});
