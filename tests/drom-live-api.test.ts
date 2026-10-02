import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import handler, { DROM_LIVE_TERRITORIES, SECTORS, buildTerritory, normalizeLine } from '../api/_handlers/energy/drom-live.js';

type Line = Record<string, unknown>;
type Cfg = { code: string; dataset: string };
const FILE: Record<string, string> = { RE: 'reunion', GP: 'guadeloupe', MQ: 'martinique', GF: 'guyane', COR: 'corse' };
const fixture = (code: string): Line[] =>
  (JSON.parse(readFileSync(new URL(`./fixtures/edf-sei/${FILE[code]}.json`, import.meta.url), 'utf8')) as { results: Line[] }).results;
const ELEMENTARY = new Set(['charbon', 'diesel', 'moteurs_diesels', 'moteur_diesel', 'turbines_combustion', 'tac', 'bioenergies',
  'geothermie', 'hydraulique', 'micro_hydro', 'photovoltaique', 'eolien', 'stockage', 'solde_stockage', 'liaisons']);
const cfg = (code: string): Cfg => (DROM_LIVE_TERRITORIES as Cfg[]).find((t) => t.code === code) ?? (DROM_LIVE_TERRITORIES as Cfg[])[0];
const sumMix = (mix: Record<string, number | null>): number => (SECTORS as string[]).reduce((s, k) => s + (mix[k] ?? 0), 0);

function fakeRes() {
  const res = { statusCode: 0, body: undefined as unknown, headers: {} as Record<string, unknown>,
    setHeader(k: string, v: unknown) { this.headers[k] = v; },
    status(c: number) { this.statusCode = c; return this; },
    json(b: unknown) { this.body = b; return this; },
    end() { return this; } };
  return res;
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('normalisation EDF SEI sur des lignes réelles enregistrées', () => {
  it.each(Object.keys(FILE))('%s : rien de perdu, aucun champ inconnu, total publié repris', (code) => {
    const warn = vi.fn();
    const lines = fixture(code);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      const r = normalizeLine(code, line, warn);
      const raw = Object.entries(line).filter(([k, v]) => ELEMENTARY.has(k) && typeof v === 'number')
        .reduce((s, [, v]) => s + (v as number), 0);
      expect(sumMix(r.mix)).toBeCloseTo(raw, 6);
      expect(r.mix.other).toBeNull();
      expect(r.totalMw).toBe(line.total);
      expect(r.at).toBe(Date.parse(String(line.date)));
    }
    expect(warn).not.toHaveBeenCalled();
  });
  it('mêmes filières malgré des noms de champs propres à chaque territoire', () => {
    const [re] = fixture('RE');
    expect(normalizeLine('RE', re, vi.fn()).mix).toMatchObject({ oil: re.diesel, coal: re.charbon, geothermal: null });
    const [gp] = fixture('GP');
    expect(normalizeLine('GP', gp, vi.fn()).mix.geothermal).toBe(gp.geothermie);
    const [mq] = fixture('MQ');
    expect(normalizeLine('MQ', mq, vi.fn()).mix).toMatchObject({ oil: mq.moteurs_diesels, turbine: mq.turbines_combustion, coal: null });
    const [gf] = fixture('GF');
    const g = normalizeLine('GF', gf, vi.fn());
    expect(g.mix).toMatchObject({ oil: gf.moteur_diesel, turbine: gf.tac });
    expect(g.status).toBeNull();
    const [co] = fixture('COR');
    const c = normalizeLine('COR', co, vi.fn());
    expect(c.mix).toMatchObject({ links: co.liaisons, storage: co.solde_stockage, oil: co.moteur_diesel, turbine: co.tac });
    expect(c.mix.hydro).toBeCloseTo((co.hydraulique as number) + (co.micro_hydro as number), 9);
  });
  it('champ inconnu : compté dans « autres », journalisé une seule fois par territoire et champ', () => {
    const warn = vi.fn();
    const line = { date: '2026-10-02T10:55:00+04:00', total: 13, diesel: 10, nouvelle_filiere: 3 };
    expect(normalizeLine('RE', line, warn).mix.other).toBe(3);
    expect(warn).toHaveBeenCalledWith('RE', 'nouvelle_filiere');
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    normalizeLine('RE', { ...line, autre_essai: 1 });
    normalizeLine('RE', { ...line, autre_essai: 1 });
    expect(spy.mock.calls.filter((c) => String(c[0]).includes('autre_essai'))).toHaveLength(1);
  });
  it('Corse : agrégats (filiere_*) et parts en % (part_*) ignorés, sinon compte double', () => {
    const r = normalizeLine('COR', { date: '2026-10-02T08:45:00+02:00', total: 100, moteur_diesel: 60, tac: 10, photovoltaique: 30,
      filiere_thermique: 70, part_thermique: 70, filiere_enr_distrib: 30 }, vi.fn());
    expect(sumMix(r.mix)).toBe(100);
    expect(r.mix.other).toBeNull();
  });
  it('total absent : somme des valeurs positives ; null jamais converti en 0', () => {
    const r = normalizeLine('GF', { date: '2026-10-02T04:00:00-03:00', moteur_diesel: 14, tac: null, photovoltaique: 0, stockage: -2 }, vi.fn());
    expect(r.totalMw).toBe(14);
    expect(r.mix.turbine).toBeNull();
    expect(r.mix.solar).toBe(0);
    expect(r.status).toBeNull();
  });
  it('part renouvelable : bioénergies, géothermie, hydraulique, photovoltaïque et éolien sur le total', () => {
    const t = buildTerritory(cfg('GP'), [{ date: '2026-10-02T02:56:00-04:00', total: 100, diesel: 60, geothermie: 10, bioenergies: 10,
      hydraulique: 5, eolien: 5, photovoltaique: 10, statut: 'Estimé' }], vi.fn());
    expect(t.renewableSharePct).toBe(40);
    expect(t.status).toBe('Estimé');
    expect(t.state).toBe('ok');
  });
  it('journée locale : la courbe ne garde que le jour local de la dernière donnée', () => {
    const gp = buildTerritory(cfg('GP'), [
      { date: '2026-10-03T00:03:00-04:00', total: 120 }, { date: '2026-10-02T23:58:00-04:00', total: 130 },
      { date: '2026-09-04T05:36:00-04:00', total: 90 },
    ], vi.fn());
    expect(gp.dataTime).toBe(Date.parse('2026-10-03T00:03:00-04:00'));
    expect(gp.day).toEqual([{ at: Date.parse('2026-10-03T00:03:00-04:00'), totalMw: 120 }]);
    // 00:05 à La Réunion = 22:05 à Paris le 02/10 : c'est le 03/10 local qui compte.
    const re = buildTerritory(cfg('RE'), [{ date: '2026-10-03T00:05:00+04:00', total: 250 }, { date: '2026-10-02T23:55:00+04:00', total: 260 }], vi.fn());
    expect(re.day.map((p: { totalMw: number | null }) => p.totalMw)).toEqual([250]);
  });
  it('lignes inexploitables : territoire en erreur, aucune valeur inventée', () => {
    const t = buildTerritory(cfg('MQ'), [{ total: 3 }], vi.fn());
    expect(t).toMatchObject({ state: 'error', totalMw: null, dataTime: null, day: [] });
  });
});

describe('/api/energy/drom-live', () => {
  function stub(failing: string[] = []): string[] {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(url);
      const t = (DROM_LIVE_TERRITORIES as Cfg[]).find((x) => url.includes(x.dataset));
      if (!t || failing.includes(t.code)) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ results: fixture(t.code) }) };
    }));
    return urls;
  }
  it('interroge les cinq jeux EDF (300 lignes au plus, plus récentes d’abord)', async () => {
    const urls = stub();
    await handler({ method: 'GET' }, fakeRes());
    expect(urls).toHaveLength(5);
    for (const u of urls) {
      expect(u).toMatch(/^https:\/\/opendata\.edf\.fr\/data-fair\/api\/v1\/datasets\/[\w-]+\/lines\?/);
      expect(u).toContain('size=300');
      expect(u).toContain('sort=-date');
    }
  });
  it('un territoire en erreur n’empêche pas les autres ; cache CDN 5 min', async () => {
    stub(['GF']);
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('s-maxage=300, stale-while-revalidate=60');
    const body = res.body as { territories: Array<{ code: string; state: string; totalMw: number | null }> };
    expect(body.territories.map((t) => [t.code, t.state])).toEqual([['RE', 'ok'], ['GP', 'ok'], ['MQ', 'ok'], ['GF', 'error'], ['COR', 'ok']]);
    expect(body.territories.find((t) => t.code === 'GF')?.totalMw).toBeNull();
  });
  it('un appel qui lève : territoire en erreur, pas de 500', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('njq-knwu0diqrdup6tya8qxi')) throw new Error('timeout');
      return { ok: true, status: 200, json: async () => ({ results: fixture('GP') }) };
    }));
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    expect(res.statusCode).toBe(200);
    expect((res.body as { territories: Array<{ code: string; state: string }> }).territories[0]).toMatchObject({ code: 'RE', state: 'error' });
  });
  it('tous en erreur : 502 non mis en cache', async () => {
    stub(['RE', 'GP', 'MQ', 'GF', 'COR']);
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    expect(res.statusCode).toBe(502);
    expect(res.headers['Cache-Control']).toBe('no-store');
  });
});
