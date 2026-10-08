// Pannes partielles (S3) : les libellés lus par partFailed côté client (health-format.ts) sont ceux que les gestionnaires
// api/_handlers/health/* écrivent dans errors[] (sourceError). Chaque partie est mise en échec seule, les autres répondent.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { loadAlertLevels } from '../api/_handlers/health/alert-levels.js';
import { loadInternational } from '../api/_handlers/health/international.js';
import { SYNDROMES, loadSyndromic } from '../api/_handlers/health/syndromic.js';
import { loadRecalls } from '../api/_handlers/health/recalls.js';
import drugShortages from '../api/_handlers/health/drug-shortages.js';
import {
  HEALTH_PART, partFailed, spfPagePart, syndromeDepartmentsPart, syndromeFrancePart,
} from '../src/components/layer-panel/health-format.ts';
import type { SyndromeKey } from '../src/types/index.ts';
import { fakeRes, fixtureJson, fixtureText, respond, stubFetch } from './helpers/health-fixtures.ts';

const NOW = Date.parse('2026-10-03T08:00:00Z');

beforeEach(() => { __resetSwrCacheForTests(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function stubAlerts(failing: (url: string) => boolean) {
  stubFetch((url) => {
    if (failing(url)) return respond('erreur', 503);
    if (url.includes('odisse.santepubliquefrance.fr')) return respond(fixtureText('odisse-alertes.json'));
    if (url.endsWith('/regions-et-territoires/ocean-indien')) return respond(fixtureText('spf-ocean-indien.html'));
    if (url.endsWith('/regions-et-territoires/guyane')) return respond(fixtureText('spf-guyane.html'));
    if (url.endsWith('/regions-et-territoires/antilles')) return respond(fixtureText('spf-antilles.html'));
    if (url.includes('/bulletin-regional/')) return respond(fixtureText('spf-bulletin-reunion.html'));
    return respond('introuvable', 404);
  });
}

describe('libellés des parties en échec, alignés entre gestionnaires et panneaux', () => {
  it('niveaux d’alerte Odissé et page régionale d’un bassin', async () => {
    stubAlerts((url) => url.includes('odisse.santepubliquefrance.fr'));
    const odisse = await loadAlertLevels(NOW);
    expect(partFailed(odisse.errors, HEALTH_PART.alerts)).toBe(true);
    expect(partFailed(odisse.errors, spfPagePart('Océan Indien'))).toBe(false);
    __resetSwrCacheForTests();
    stubAlerts((url) => url.endsWith('/regions-et-territoires/ocean-indien'));
    const page = await loadAlertLevels(NOW);
    expect(partFailed(page.errors, spfPagePart('Océan Indien'))).toBe(true);
    expect(partFailed(page.errors, HEALTH_PART.alerts)).toBe(false);
  });
  it('OMS et ECDC', async () => {
    stubFetch((url) => (url.startsWith('https://www.who.int') ? respond('erreur', 500) : respond(fixtureText('ecdc-cdtr.xml'))));
    const who = await loadInternational();
    expect([partFailed(who.errors, HEALTH_PART.who), partFailed(who.errors, HEALTH_PART.ecdc)]).toEqual([true, false]);
    __resetSwrCacheForTests();
    stubFetch((url) => (url.startsWith('https://www.who.int') ? respond(fixtureText('who-don.json')) : respond('erreur', 500)));
    const ecdc = await loadInternational();
    expect([partFailed(ecdc.errors, HEALTH_PART.who), partFailed(ecdc.errors, HEALTH_PART.ecdc)]).toEqual([false, true]);
  });
  it('exports France et départementaux de chaque syndrome', async () => {
    type Rows = Record<string, Array<Record<string, unknown>>>;
    const FRANCE = fixtureJson<Rows>('odisse-syndromic-france.json');
    const DEPS = fixtureJson<Rows>('odisse-syndromic-departements.json');
    const cfgs = SYNDROMES as ReadonlyArray<{ key: SyndromeKey; france: string; departement: string }>;
    const ira = cfgs[0];
    stubFetch((url) => {
      const path = new URL(url).pathname;
      if (path.endsWith(`/${ira.france}/exports/json`)) return respond('erreur', 500);
      for (const cfg of cfgs) {
        if (path.endsWith(`/${cfg.france}/exports/json`)) return respond(FRANCE[cfg.key] ?? []);
        if (path.endsWith(`/${cfg.departement}/exports/json`)) return cfg.key === 'gastro' ? respond('erreur', 500) : respond(DEPS[cfg.key] ?? []);
      }
      if (path.endsWith(`/${ira.france}`)) return respond(fixtureText('odisse-meta-ira-france.json'));
      return respond('introuvable', 404);
    });
    const body = await loadSyndromic();
    expect(cfgs.map((c) => partFailed(body.errors, syndromeFrancePart(c.key)))).toEqual([true, false, false, false, false, false, false]);
    expect(cfgs.map((c) => partFailed(body.errors, syndromeDepartmentsPart(c.key)))).toEqual([false, false, true, false, false, false, false]);
  });
  it('ANSM et RappelConso', async () => {
    stubFetch(() => respond('erreur', 500));
    const res = fakeRes();
    await drugShortages({ method: 'GET' }, res);
    expect(partFailed((res.body as { errors: string[] }).errors, HEALTH_PART.drugs)).toBe(true);
    expect(partFailed((await loadRecalls(NOW)).errors, HEALTH_PART.recalls)).toBe(true);
  });
});
