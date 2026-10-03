import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import handler, { ANSM_PAGE_URL, MITM_LIST_URL, ansmDate, buildDrugShortages, parseAnsmRows, shortageStatus } from '../api/_handlers/health/drug-shortages.js';
import { fakeRes, fixtureText, respond, stubFetch } from './helpers/health-fixtures.ts';

type Item = { name: string; status: string; updatedAt: string | null; startedAt: string | null; availableAgainAt: string | null; domains: string[]; url: string | null };
type Body = {
  items: Item[]; counts: Record<string, number>; latestUpdate: string | null; mitmListUrl: string; errors: string[];
  shortages: Array<{ drug_name: string; dci: string | null; status: string; start_date: string | null; expected_end_date: string | null; detail_url: string | null }>;
  last_update: string | null; metadata: { source: string };
};
const PAGE = fixtureText('ansm-disponibilites.html');

beforeEach(() => { __resetSwrCacheForTests(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('page ANSM des disponibilités (extrait réel du 03/10/2026, 22 lignes)', () => {
  const rows = parseAnsmRows(PAGE);
  const built = buildDrugShortages(rows) as Omit<Body, 'errors' | 'metadata'>;
  it('quatre statuts comptés, arrêts de commercialisation compris (« unknown » avant)', () => {
    expect(built.counts).toEqual({ rupture: 6, tension: 6, remise: 6, arret: 4 });
    expect(built.latestUpdate).toBe('2026-10-02');
    expect(built.mitmListUrl).toBe(MITM_LIST_URL);
  });
  it('nom sans la substance, date de mise à jour, domaines, lien ; date de remise lue dans <b> (vide : null, pas la date du jour)', () => {
    expect(built.items[0]).toEqual({
      name: 'Plerixafor Arrow 20 mg/mL, solution injectable', status: 'rupture', updatedAt: '2026-10-02', startedAt: null, availableAgainAt: null,
      domains: ['Hématologie'],
      url: 'https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments/plerixafor-arrow-20-mg-ml-solution-injectable-plerixafor',
    });
    expect(built.items[2]).toMatchObject({ name: 'Concerta LP, comprimé à libération prolongée', status: 'remise', availableAgainAt: '2026-10-02' });
    expect(built.items.find((i) => i.name.startsWith('Dectancyl'))?.domains).toEqual(['Dermatologie', 'Endocrinologie', 'Hématologie']);
    expect(built.items.find((i) => i.name.startsWith('Ancotil'))).toMatchObject({ status: 'arret', updatedAt: '2026-09-22' });
  });
  it('champs historiques inchangés pour src/services/health.ts (remise → normalisation, arrêt → unknown)', () => {
    expect(built.shortages[0]).toEqual({
      drug_name: 'Plerixafor Arrow 20 mg/mL, solution injectable', dci: 'PLERIXAFOR', status: 'rupture', start_date: '2026-10-02',
      expected_end_date: null, reason: 'Rupture de stock', alternatives: null, detail_url: built.items[0].url,
    });
    expect(built.shortages.map((s) => s.status).filter((s) => s === 'normalisation')).toHaveLength(6);
    expect(built.shortages.map((s) => s.status).filter((s) => s === 'unknown')).toHaveLength(4);
    expect(built.last_update).toBe('2026-10-02');
  });
  it('statut inconnu : écarté des items, journalisé une fois, gardé « unknown » dans l’historique', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(shortageStatus('Statut nouveau')).toBeNull();
    expect(shortageStatus('Statut nouveau')).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(ansmDate('02/10/2026')).toBe('2026-10-02');
    expect(ansmDate('2026/10/02')).toBe('2026-10-02');
    expect(ansmDate('')).toBeNull();
  });
});

describe('/api/health/drug-shortages', () => {
  it('une seule requête (la page ; l’export XLS n’est plus sondé), cache 30 min', async () => {
    const { urls } = stubFetch(() => respond(PAGE));
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    expect(urls).toEqual([ANSM_PAGE_URL]);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('s-maxage=1800, stale-while-revalidate=300');
    const body = res.body as Body;
    expect([body.items.length, body.shortages.length, body.errors, body.metadata.source]).toEqual([22, 22, [], ANSM_PAGE_URL]);
  });
  it.each([[500, 'HTTP 500'], [429, 'HTTP 429']])('HTTP %i : 502 non mis en cache, erreur nommée (plus de repli curl)', async (status, message) => {
    stubFetch(() => respond('erreur', status));
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    expect([res.statusCode, res.headers['Cache-Control']]).toEqual([502, 'no-store']);
    expect(res.body).toMatchObject({ items: [], shortages: [], last_update: null, errors: [`ANSM, disponibilités des médicaments : ${message}`] });
  });
  it('page sans tableau (format changé) : erreur, pas de liste vide silencieuse', async () => {
    stubFetch(() => respond('<!DOCTYPE html><html><body><table></table></body></html>'));
    const res = fakeRes();
    await handler({ method: 'GET' }, res);
    expect(res.statusCode).toBe(502);
    expect((res.body as Body).errors).toEqual(['ANSM, disponibilités des médicaments : aucune ligne lue dans la page']);
  });
});
