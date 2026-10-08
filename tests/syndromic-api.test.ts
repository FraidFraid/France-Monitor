import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import handler, { SYNDROMES, buildDepartments, previousSeasonWeeks, rateToPct, weekEnd } from '../api/_handlers/health/syndromic.js';
import { type FakeResponse, fakeRes, fixtureJson, fixtureText, maxLimitSent, respond, stubFetch } from './helpers/health-fixtures.ts';

type Rows = Record<string, Array<Record<string, unknown>>>;
type Cfg = { key: string; france: string; departement: string };
const FRANCE = fixtureJson<Rows>('odisse-syndromic-france.json');
const DEPS = fixtureJson<Rows>('odisse-syndromic-departements.json');
const CFG = SYNDROMES as readonly Cfg[];

/** Sert les fixtures réelles selon le jeu demandé ; `override(url)` peut remplacer une réponse. */
function stubOdisse(override: (url: string) => FakeResponse | null = () => null) {
  return stubFetch((url) => {
    const forced = override(url);
    if (forced) return forced;
    const path = new URL(url).pathname;
    for (const cfg of CFG) {
      if (path.endsWith(`/${cfg.france}/exports/json`)) return respond(FRANCE[cfg.key] ?? []);
      if (path.endsWith(`/${cfg.departement}/exports/json`)) return respond(DEPS[cfg.key] ?? []);
    }
    if (path.endsWith(`/${CFG[0].france}`)) return respond(fixtureText('odisse-meta-ira-france.json'));
    return respond('introuvable', 404);
  });
}

type Body = {
  week: { id: string; start: string; end: string } | null;
  publishedAt: string | null;
  syndromes: Array<{ key: string; label: string; ageClass: string; france: Array<{ week: string; er: number | null; hosp: number | null; sos: number | null }>; ages: Record<string, Array<{ week: string; er: number | null }>> }>;
  departments: Array<{ code: string; name: string; values: Record<string, { er: number | null; hosp: number | null; sos: number | null; refEr: number[] }> }>;
  errors: string[];
};

async function call(): Promise<{ status: number; body: Body; cache: string }> {
  const res = fakeRes();
  await handler({ method: 'GET' }, res);
  return { status: res.statusCode, body: res.body as Body, cache: res.headers['Cache-Control'] };
}

beforeEach(() => { __resetSwrCacheForTests(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('fonctions pures', () => {
  it('taux pour 100 000 → part en % ; null reste null', () => {
    expect(rateToPct(2108.220115)).toBe(2.108);
    expect(rateToPct(11059.608885)).toBe(11.06);
    expect(rateToPct(null)).toBeNull();
    expect(rateToPct(Number.NaN)).toBeNull();
  });
  it('semaines de référence et dimanche', () => {
    expect(previousSeasonWeeks('2026-S39')).toEqual([['2025-S39'], ['2024-S39'], ['2023-S39']]);
    expect(previousSeasonWeeks('2026-S53')[0]).toEqual(['2025-S53', '2025-S52']);
    expect(previousSeasonWeeks('S39')).toEqual([]);
    expect(weekEnd('2026-09-21')).toBe('2026-09-27');
    expect(weekEnd('2026-12-28')).toBe('2027-01-03');
  });
  it('départements : seulement ceux de la dernière semaine (975, 977, 978 des anciennes saisons écartés)', () => {
    const rows = { ira: [
      { semaine: '2026-S39', dep: '75', libgeo: 'Paris', taux_passages_ira_sau: 1000, taux_hospit_ira_sau: null, taux_actes_ira_sos: null },
      { semaine: '2023-S39', dep: '975', libgeo: 'Miquelon-Langlade et Saint Pierre', taux_passages_ira_sau: 500 },
    ] };
    expect(buildDepartments('2026-S39', rows)).toEqual([{ code: '75', name: 'Paris', values: { ira: { er: 1, hosp: null, sos: null, refEr: [] } } }]);
  });
});

describe('/api/health/syndromic sur réponses réelles (Odissé, livraison du 30/09/2026)', () => {
  it('15 requêtes : 7 exports France, 7 exports départementaux, 1 métadonnée ; aucun limit', async () => {
    const { urls } = stubOdisse();
    const { status, cache } = await call();
    expect(status).toBe(200);
    expect(cache).toBe('s-maxage=21600, stale-while-revalidate=86400');
    expect(urls).toHaveLength(15);
    expect(maxLimitSent(urls)).toBe(0);
    const ira = new URL(urls.find((u) => u.includes(`/${CFG[0].france}/exports/json`)) ?? '');
    expect(ira.searchParams.get('where')).toBe("date_complet>=date'2022-07-04' and sursaud_cl_age_gene in ('Tous âges','00-04 ans','05-14 ans','15-64 ans','65 ans ou plus')");
    const dep = new URL(urls.find((u) => u.includes(`/${CFG[1].departement}/exports/json`)) ?? '');
    expect(dep.searchParams.get('where')).toBe("semaine in ('2026-S39','2025-S39','2024-S39','2023-S39') and sursaud_cl_age_gene in ('0 an')");
  });
  it('semaine S39, date de publication, sept syndromes dans l’ordre du contrat', async () => {
    stubOdisse();
    const { body } = await call();
    expect(body.week).toEqual({ id: '2026-S39', start: '2026-09-21', end: '2026-09-27' });
    expect(body.publishedAt).toBe('2026-09-30T10:00:20+00:00');
    expect(body.errors).toEqual([]);
    expect(body.syndromes.map((s) => [s.key, s.label, s.ageClass])).toEqual([
      ['ira', 'IRA', 'Tous âges'], ['bronchio', 'Bronchiolite', '0 an'], ['gastro', 'Gastro-entérite', 'Tous âges'],
      ['asthme', 'Asthme', 'Tous âges'], ['allergie', 'Allergie', 'Tous âges'], ['grippe', 'Grippe', 'Tous âges'], ['covid', 'COVID-19', 'Tous âges'],
    ]);
  });
  it('valeurs nationales réelles en parts : IRA 2,108 % (S38 1,898 %), SOS 11,06 % ; bronchiolite 0 an 6,598 %', async () => {
    stubOdisse();
    const { body } = await call();
    const ira = body.syndromes[0];
    expect(ira.france).toHaveLength(17);
    expect(ira.france.at(-1)).toEqual({ week: '2026-S39', start: '2026-09-21', er: 2.108, hosp: 4.726, sos: 11.06 });
    expect(ira.france.at(-2)?.er).toBe(1.898);
    expect(ira.france[0]).toMatchObject({ week: '2023-S39', er: 3.292 });
    expect(body.syndromes[1].france.at(-1)).toMatchObject({ er: 6.598, hosp: 12.375, sos: 4.017 });
    expect(body.syndromes[2].france.at(-1)).toMatchObject({ er: 1.097 });
  });
  it('classes d’âge sur 14 semaines : IRA quatre classes, COVID-19 65 ans ou plus, autres aucune', async () => {
    stubOdisse();
    const { body } = await call();
    const ages = body.syndromes[0].ages;
    expect(Object.keys(ages)).toEqual(['00-04 ans', '05-14 ans', '15-64 ans', '65 ans ou plus']);
    expect(ages['00-04 ans']).toHaveLength(14);
    expect(ages['00-04 ans'][0].week).toBe('2026-S26');
    expect(ages['00-04 ans'].at(-1)?.er).toBe(4.143);
    expect(body.syndromes[6].ages['65 ans ou plus'].at(-1)?.er).toBe(0.374);
    expect(body.syndromes[1].ages).toEqual({});
  });
  it('départements réels : Paris, SOS Médecins absent à La Réunion (null, pas 0), références des trois saisons', async () => {
    stubOdisse();
    const { body } = await call();
    expect(body.departments.map((d) => d.code)).toEqual(['13', '2A', '48', '75', '974', '976']);
    const paris = body.departments.find((d) => d.code === '75');
    expect(paris?.name).toBe('Paris');
    expect(paris?.values.ira).toEqual({ er: 1.757, hosp: 3.376, sos: 13.405, refEr: [1.94, 2.172, 2.901] });
    const reunion = body.departments.find((d) => d.code === '974');
    expect(reunion?.values.ira).toEqual({ er: 5.679, hosp: 5.98, sos: null, refEr: [4.175, 4.995, 4.845] });
    expect(reunion?.values.grippe?.er).toBe(3.85);
    expect(body.departments.find((d) => d.code === '48')?.values.bronchio).toEqual({ er: 0, hosp: 0, sos: null, refEr: [0, 0, 0] });
    expect(Object.keys(paris?.values ?? {})).toEqual(['ira', 'bronchio', 'gastro', 'asthme', 'allergie', 'grippe', 'covid']);
  });
  it('IRA France en HTTP 429 : erreur nommée, série vide, les autres syndromes et la semaine restent', async () => {
    stubOdisse((url) => (url.includes(`/${CFG[0].france}/exports`) ? respond('Too Many Requests', 429) : null));
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.errors).toEqual(['Odissé, IRA France : HTTP 429']);
    expect(body.syndromes[0].france).toEqual([]);
    expect(body.week?.id).toBe('2026-S39');
    expect(body.syndromes[1].france.at(-1)?.er).toBe(6.598);
  });
  it('page de captcha à la place d’un export départemental, export vide : erreurs nommées, départements des autres syndromes gardés', async () => {
    stubOdisse((url) => {
      if (url.includes(`/${CFG[2].departement}/exports`)) return respond(fixtureText('dgs-captcha.html'));
      if (url.includes(`/${CFG[3].departement}/exports`)) return respond([]);
      return null;
    });
    const { body } = await call();
    expect(body.errors).toEqual(['Odissé, Asthme départements : aucune ligne', 'Odissé, Gastro-entérite départements : page de contrôle anti-robot']);
    const paris = body.departments.find((d) => d.code === '75');
    expect(paris?.values.gastro).toBeUndefined();
    expect(paris?.values.ira?.er).toBe(1.757);
  });
  it('Odissé en HTTP 500 partout : 502 non mis en cache, huit erreurs, aucun appel départemental', async () => {
    const { urls } = stubOdisse(() => respond('erreur', 500));
    const { status, body, cache } = await call();
    expect(status).toBe(502);
    expect(cache).toBe('no-store');
    expect(body.week).toBeNull();
    expect(body.errors).toHaveLength(8);
    expect(urls.some((u) => u.includes('departement') || u.includes('-dep/'))).toBe(false);
  });
  it('deuxième appel servi par le cache serveur (aucune nouvelle requête)', async () => {
    const { urls } = stubOdisse();
    await call();
    await call();
    expect(urls).toHaveLength(15);
  });
});
