import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthFetchError } from '../api/_lib/health-http.js';
import {
  ECONOMIE_BASE, ODISSE_BASE, exportUrl, fetchAllRecords, fetchDatasetInfo, fetchExport, fetchRecords, odsDate, odsList, recordsUrl,
} from '../api/_lib/odisse.js';
import { fixtureText, maxLimitSent, respond, stubFetch } from './helpers/health-fixtures.ts';

afterEach(() => { vi.unstubAllGlobals(); });

describe('URL Opendatasoft', () => {
  it('limit > 100 ou fenêtre > 10 000 : jamais envoyé (RangeError avant tout appel)', () => {
    expect(() => recordsUrl('jeu', { limit: 101 })).toThrow(RangeError);
    expect(() => recordsUrl('jeu', { limit: 400 })).toThrow(RangeError);
    expect(() => recordsUrl('jeu', { limit: 0 })).toThrow(RangeError);
    expect(() => recordsUrl('jeu', { limit: 100, offset: 9950 })).toThrow(RangeError);
    expect(recordsUrl('jeu', { limit: 100, offset: 9900 })).toContain('offset=9900');
  });
  it('records : filtres encodés ; export : ni limit ni offset', () => {
    const where = `date_complet>=${odsDate('2022-07-04')} and sursaud_cl_age_gene in ${odsList(['Tous âges', '0 an'])}`;
    const u = new URL(recordsUrl('jeu', { where, select: 'a,b', orderBy: 'date_complet desc', limit: 50 }));
    expect(u.origin + u.pathname).toBe(`${ODISSE_BASE}/jeu/records`);
    expect(u.searchParams.get('where')).toBe("date_complet>=date'2022-07-04' and sursaud_cl_age_gene in ('Tous âges','0 an')");
    expect([u.searchParams.get('limit'), u.searchParams.get('order_by')]).toEqual(['50', 'date_complet desc']);
    const e = new URL(exportUrl('jeu', { where: 'x=1', base: ECONOMIE_BASE }));
    expect(e.origin + e.pathname).toBe(`${ECONOMIE_BASE}/jeu/exports/json`);
    expect(e.searchParams.has('limit') || e.searchParams.has('offset')).toBe(false);
  });
  it('littéraux ODSQL', () => {
    expect(() => odsDate('21/09/2026')).toThrow(RangeError);
    expect(() => odsList(["l'an"])).toThrow(RangeError);
  });
});

describe('lecture', () => {
  it('pagination par 100 jusqu’au total, jamais plus de 100 par appel', async () => {
    const { urls } = stubFetch((url) => {
      const offset = Number(new URL(url).searchParams.get('offset'));
      const n = offset < 200 ? 100 : 37;
      return respond({ total_count: 237, results: Array.from({ length: n }, (_, i) => ({ i: offset + i })) });
    });
    const rows = await fetchAllRecords('jeu', { maxRows: 1000 });
    expect(rows).toHaveLength(237);
    expect(urls.map((u) => new URL(u).searchParams.get('offset'))).toEqual(['0', '100', '200']);
    expect(maxLimitSent(urls)).toBe(100);
  });
  it('maxRows borne la dernière page', async () => {
    const { urls } = stubFetch((url) => respond({ total_count: 500, results: Array.from({ length: Number(new URL(url).searchParams.get('limit')) }, () => ({})) }));
    expect(await fetchAllRecords('jeu', { maxRows: 150 })).toHaveLength(150);
    expect(urls.map((u) => new URL(u).searchParams.get('limit'))).toEqual(['100', '50']);
  });
  it('HTTP 400 réel d’Odissé : erreur, pas de liste vide', async () => {
    stubFetch(() => respond(fixtureText('odisse-400.json'), 400));
    await expect(fetchRecords('jeu', { limit: 100 })).rejects.toMatchObject({ status: 400, kind: 'http' });
  });
  it('réponse sans results, export qui n’est pas un tableau : erreur de forme', async () => {
    stubFetch(() => respond({ error: 'x' }));
    await expect(fetchRecords('jeu')).rejects.toBeInstanceOf(HealthFetchError);
    await expect(fetchExport('jeu')).rejects.toMatchObject({ kind: 'parse' });
  });
  it('export : lignes du jeu ; métadonnées : date de traitement réelle', async () => {
    stubFetch((url) => respond(url.includes('/exports/json') ? fixtureText('odisse-alertes.json') : fixtureText('odisse-meta-ira-france.json')));
    expect(await fetchExport('ma_region_epidemies_hivernales_alertes')).toHaveLength(80);
    const info = await fetchDatasetInfo('infections-respiratoires-aigues-ira-passages-aux-urgences-et-actes-sos-medecins-france');
    expect(info).toEqual({ dataProcessed: '2026-09-30T10:00:20+00:00', modified: expect.any(String) });
  });
});
