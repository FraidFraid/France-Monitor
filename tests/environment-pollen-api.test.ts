// tests/environment-pollen-api.test.ts
// /api/environment/pollen (Atmo France, couche ind_pol:ind_national_pol, 20/10/2026) : une requête WFS par jour, TOUJOURS filtrée en CQL
// par date et réduite par propertyName (sans géométrie) ; garde « réponse non filtrée » ; agrégation par département de J à J+2.
// Fixture : extrait réel du 20/10 dont quatre communes ont des codes édités à la main (tout vaut 1 hors saison), voir son champ _note.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import {
  POLLEN_BASE, POLLEN_MAX_BYTES, POLLEN_PROPERTIES, aggregatePollenDay, buildPollenResponse, pollenTtlSec, pollenUrl,
} from '../api/_lib/pollen.js';
import handler, { CACHE_CONTROL } from '../api/_handlers/environment/pollen.js';
import type { PollenResponse } from '../src/types/index.ts';
import { type FakeResponse, callHandler, respond, stubFetch } from './helpers/traffic-fixtures.ts';

interface Fc { type: string; numberMatched: number; features: Array<{ type: string; geometry: null; properties: Record<string, unknown> }> }
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/environment/atmo-pollen-extrait.json', import.meta.url), 'utf8')) as Fc;
const NOW = Date.parse('2026-10-20T14:00:00Z');
const J = '2026-10-20';
const J1 = '2026-10-21';
const J2 = '2026-10-22';

/** Extrait de J recopié pour un autre jour d'échéance. */
function dayFc(date: string): Fc {
  const fc = structuredClone(FIXTURE);
  for (const f of fc.features) f.properties['date_ech'] = date;
  return fc;
}
const EMPTY: Fc = { type: 'FeatureCollection', numberMatched: 0, features: [] };

beforeEach(() => { __resetSwrCacheForTests(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function sources(over: Partial<Record<string, FakeResponse>> = {}) {
  return stubFetch((url) => {
    if (!url.startsWith(POLLEN_BASE)) return respond('introuvable', 404);
    const date = new URL(url).searchParams.get('cql_filter')?.match(/'(\d{4}-\d{2}-\d{2})'/)?.[1] ?? '';
    return over[date] ?? respond(date === J2 ? EMPTY : dayFc(date));
  });
}

describe('requête WFS : filtrée par date, sans géométrie', () => {
  it('une requête par jour : CQL sur date_ech, propertyName réduit, relève de 2 h', () => {
    const q = new URL(pollenUrl(J)).searchParams;
    expect(Object.fromEntries(q)).toEqual({
      service: 'WFS', version: '2.0.0', request: 'GetFeature', typeName: 'ind_pol:ind_national_pol', outputFormat: 'application/json',
      propertyName: POLLEN_PROPERTIES, cql_filter: `date_ech='${J}'`,
    });
    expect(POLLEN_PROPERTIES).not.toContain('geom');
    expect(pollenTtlSec()).toBe(7_200);
  });
});

describe('agrégation par département', () => {
  const day = aggregatePollenDay(FIXTURE, J);
  it('extrait du 20/10 : communes, plus haut code, communes élevées, alerte, taxons triés par code décroissant', () => {
    expect(day.date).toBe(J);
    expect(day.communes).toBe(7);
    expect(day.sources).toEqual(['Airparif', 'Atmo Auvergne-Rhône-Alpes', 'AtmoSud', 'Qualitair Corse']);
    expect(day.departments.map((d) => [d.dept, d.communes, d.maxCode, d.high, d.alerte])).toEqual([
      ['13', 2, 4, 1, true], ['2A', 1, 1, 0, false], ['69', 3, 5, 2, false], ['75', 1, 1, 0, false],
    ]);
    const rhone = day.departments.find((d) => d.dept === '69');
    expect(rhone?.taxa).toEqual([
      { taxon: 'ambroisie', code: 5 }, { taxon: 'graminees', code: 4 }, { taxon: 'armoise', code: 2 },
      { taxon: 'aulne', code: 1 }, { taxon: 'bouleau', code: 1 }, { taxon: 'olivier', code: 1 },
    ]);
    expect(day.departments.find((d) => d.dept === '13')?.taxa.slice(0, 2)).toEqual([{ taxon: 'olivier', code: 4 }, { taxon: 'armoise', code: 3 }]);
  });
  it('code 0, absent ou hors échelle : commune non comptée ; zone intercommunale écartée ; doublon gardé au plus haut ; DROM sur trois caractères', () => {
    const feat = (code_zone: string, props: Record<string, unknown>) => ({ type: 'Feature', geometry: null, properties: { code_zone, date_ech: J, ...props } });
    const fc = {
      features: [
        feat('97105', { code_qual: 0 }), feat('97106', { code_qual: 2, code_ambr: 0, code_gram: null }), feat('97106', { code_qual: 3, code_ambr: 2 }),
        feat('249730045', { code_qual: 6 }), feat('33063', { code_qual: 7 }), feat('33063', {}), feat('33064', { code_qual: 6, alerte: true }),
      ],
    };
    const out = aggregatePollenDay(fc, J);
    expect(out.communes).toBe(2);
    expect(out.departments).toEqual([
      { dept: '33', date: J, maxCode: 6, communes: 1, high: 1, alerte: true, taxa: [] },
      { dept: '971', date: J, maxCode: 3, communes: 1, high: 0, alerte: false, taxa: [{ taxon: 'ambroisie', code: 2 }] },
    ]);
  });
  it('aucune commune lisible : jour non publié (date null)', () => {
    expect(aggregatePollenDay(EMPTY, J)).toMatchObject({ date: null, communes: 0, departments: [], updatedAt: null });
  });
  it('réponse : jours publiés seulement, départements triés (Corse après 19), mise à jour la plus récente, noms', () => {
    const body = buildPollenResponse([aggregatePollenDay(dayFc(J2), J2), aggregatePollenDay(FIXTURE, J), aggregatePollenDay(EMPTY, J1)], 'x', []);
    expect(body.days).toEqual([J, J2]);
    expect(body.departments.map((d) => [d.code, d.name, d.days.map((x) => x.date)])).toEqual([
      ['13', 'Bouches-du-Rhône', [J, J2]], ['2A', 'Corse-du-Sud', [J, J2]], ['69', 'Rhône', [J, J2]], ['75', 'Paris', [J, J2]],
    ]);
    expect(body.updatedAt).toBe(day.updatedAt);
  });
});

describe('/api/environment/pollen', () => {
  it('200, cache 30 min ; J et J+1 publiés, J+2 absent ; trois requêtes filtrées par date', async () => {
    const log = sources();
    const { status, body, cache } = await callHandler<PollenResponse>(handler);
    expect([status, cache]).toEqual([200, CACHE_CONTROL]);
    expect(body.days).toEqual([J, J1]);
    expect(body.errors).toEqual([]);
    expect(body.readAt).toBe('2026-10-20T14:00:00.000Z');
    expect(body.departments).toHaveLength(4);
    expect(body.departments.find((d) => d.code === '69')?.days[0]).toMatchObject({ date: J, maxCode: 5, communes: 3, high: 2, alerte: false });
    expect(body.sources).toContain('AtmoSud');
    expect(log.urls).toHaveLength(3);
    for (const u of log.urls) {
      const q = new URL(u).searchParams;
      expect(q.get('cql_filter')).toMatch(/^date_ech='\d{4}-\d{2}-\d{2}'$/);
      expect(q.get('propertyName')).toBe(POLLEN_PROPERTIES);
    }
  });
  it('garde « réponse non filtrée » : trop d’entités annoncées, date hors du filtre, corps de plus de 30 Mo', async () => {
    sources({ [J]: respond({ type: 'FeatureCollection', numberMatched: 104_418, features: [] }) });
    const many = await callHandler<PollenResponse>(handler);
    expect([many.status, many.body.days, many.body.errors]).toEqual([200, [J1], [`Atmo France, pollens ${J} : réponse WFS non filtrée (104418 entités)`]]);
    __resetSwrCacheForTests();
    sources({ [J]: respond(dayFc(J1)) });
    expect((await callHandler<PollenResponse>(handler)).body.errors).toEqual([`Atmo France, pollens ${J} : réponse WFS non filtrée (date ${J1} hors du filtre)`]);
    __resetSwrCacheForTests();
    sources({ [J]: respond(`${' '.repeat(POLLEN_MAX_BYTES + 1)}{"type":"FeatureCollection","features":[]}`) });
    const big = (await callHandler<PollenResponse>(handler)).body.errors;
    expect(big).toHaveLength(1);
    expect(big[0]).toContain('réponse trop volumineuse');
  });
  it('panne d’un jour : les autres sont servis, la panne est nommée, cache CDN court', async () => {
    sources({ [J1]: respond('erreur', 500) });
    const { status, body, cache } = await callHandler<PollenResponse>(handler);
    expect([status, body.days, body.errors, cache]).toEqual([200, [J], [`Atmo France, pollens ${J1} : HTTP 500`], 's-maxage=300, stale-while-revalidate=600']);
  });
  it('rien de lu : 502 non mis en cache, erreurs nommées, page HTML nommée', async () => {
    sources({ [J]: respond('erreur', 500), [J1]: respond('<!DOCTYPE html><html><body>GeoServer</body></html>'), [J2]: respond('erreur', 503) });
    const { status, body, cache } = await callHandler<PollenResponse>(handler);
    expect([status, cache]).toEqual([502, 'no-store']);
    expect(body.errors).toEqual([
      `Atmo France, pollens ${J} : HTTP 500`, `Atmo France, pollens ${J1} : page HTML reçue au lieu de données`, `Atmo France, pollens ${J2} : HTTP 503`,
    ]);
    expect(body.readAt).toBeNull();
  });
  it('jours non encore publiés (aucune commune) : 200 sans jour, jamais « sans pollens »', async () => {
    sources({ [J]: respond(EMPTY), [J1]: respond(EMPTY) });
    const { status, body } = await callHandler<PollenResponse>(handler);
    expect([status, body.days, body.departments, body.errors]).toEqual([200, [], [], []]);
  });
});
