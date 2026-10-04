// tests/environment-contract.test.ts : contrat serveur / client de l'Environnement (spec 2026-10-04 environnement § 5). Chaque
// réponse construite par le code du serveur à partir des réponses réelles du 04/10/2026 (mêmes doublures que les tests des routes)
// doit passer la garde stricte du client, réponses partielles et 502 comprises : les vues nomment alors la panne au lieu de lire
// « réponse mal formée ». Les adaptateurs du score (vigilance, tronçons, détections nettoyées) sont vérifiés sur ces réponses.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { __resetKvForTests, __setKvClientForTests, kvSetJson } from '../api/_lib/kv-history.js';
import { CARTE_URL, TEXTES_URL, __resetVigilanceStateForTests } from '../api/_lib/meteo-vigilance.js';
import { CONSTITUTION_ERROR, DAILY_KEY, __resetVigilanceArchiveForTests } from '../api/_lib/vigilance-archive.js';
import { HUBEAU_OBSERVATIONS_URL } from '../api/_lib/hubeau-stations.js';
import { INFOVIGICRU_URL, TERRITORIES_URL, loadFloods, sectionStationsUrl } from '../api/_lib/vigicrues.js';
import { __resetForestDangerForTests, mdfUrl } from '../api/_lib/forest-danger.js';
import { FIRMS_PENDING_ERROR, TOO_OLD_ERROR } from '../api/_lib/fires-collect.js';
import vigilanceHandler from '../api/_handlers/environment/vigilance.js';
import floodsHandler from '../api/_handlers/environment/floods.js';
import firesHandler from '../api/_handlers/environment/fires.js';
import impactsHandler from '../api/_handlers/fires/impacts.js';
import type { FireImpactsResponse, FiresResponse, FloodsResponse, VigilanceResponse } from '../src/types/index.ts';
import { isVigilanceResponse, vigilanceStatus, vigilanceToMeteoAlerts } from '../src/services/environment-vigilance.ts';
import { floodsStatus, floodsToSectionRefs, isFloodsResponse } from '../src/services/environment-floods.ts';
import { firesStatus, isFireImpactsResponse, isFiresResponse, scoreFireDetections, toActiveFire } from '../src/services/environment-fires.ts';
import { FIRMS_PENDING_NOTE, FIRMS_TOO_OLD_ERROR, isProgressNote } from '../src/services/environment-source.ts';
import { type FakeResponse, callHandler, respond, stubFetch } from './helpers/traffic-fixtures.ts';

const fx = (name: string): string => readFileSync(new URL(`./fixtures/environment/${name}`, import.meta.url), 'utf8');
const fxJson = <T>(name: string): T => JSON.parse(fx(name)) as T;
const NOW = Date.parse('2026-10-04T10:10:00+02:00');

/** Ce que le navigateur reçoit : le corps après sérialisation JSON (champs `undefined` perdus). */
const wire = (body: unknown): unknown => JSON.parse(JSON.stringify(body)) as unknown;

beforeEach(() => {
  __resetSwrCacheForTests();
  __resetKvForTests();
  __setKvClientForTests({ get: async () => null, set: async () => undefined });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { __setKvClientForTests(null); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

// ─── Vigilance ───

interface RawTextes { meta: unknown; product: Record<string, unknown> & { text_bloc_items: unknown[] } }

/** Textes du 04/10 : national et Pyrénées-Orientales (fixture réduite) et les 7 blocs zonaux réels, dans l'ordre publié. */
function textesDuJour(): RawTextes {
  const t = fxJson<RawTextes>('vigilance-textes-reduit.json');
  const zonal = fxJson<{ text_bloc_items: unknown[] }>('vigilance-textes-zonal.json').text_bloc_items;
  const [national, ...departemental] = t.product.text_bloc_items;
  return { ...t, product: { ...t.product, text_bloc_items: [national, ...zonal, ...departemental] } };
}

describe('contrat vigilance', () => {
  beforeEach(async () => {
    __resetVigilanceStateForTests();
    __resetVigilanceArchiveForTests();
    vi.stubEnv('METEO_FRANCE_API_KEY', 'cle-test');
    // Archive déjà relue aujourd'hui : la route ne lit que la carte et les textes.
    await kvSetJson(DAILY_KEY, { days: [], checkedDay: '2026-10-04', error: null }, 3_600, NOW);
  });
  const sources = (override: (url: string) => FakeResponse | null = () => null): void => {
    stubFetch((url) => override(url) ?? (url === CARTE_URL ? respond(fx('vigilance-encours-reduit.json')) : url === TEXTES_URL ? respond(textesDuJour()) : respond('introuvable', 404)));
  };
  it('réponse complète acceptée ; adaptateur du score : 66 et 11 orange, 30 jaune', async () => {
    sources();
    const { status, body } = await callHandler<VigilanceResponse>(vigilanceHandler);
    expect([status, body.errors]).toEqual([200, []]);
    expect(isVigilanceResponse(wire(body))).toBe(true);
    expect(vigilanceToMeteoAlerts(body).map((a) => [a.departmentCode, a.level])).toEqual([['11', 'orange'], ['66', 'orange'], ['30', 'yellow']]);
  });
  it('textes en panne (HTTP 401) : 200 partiel accepté, panne nommée', async () => {
    sources((url) => (url === TEXTES_URL ? respond('{"code":"900901"}', 401) : null));
    const { status, body } = await callHandler<VigilanceResponse>(vigilanceHandler);
    expect(status).toBe(200);
    expect(body.errors).toContain('Météo-France, textes : HTTP 401');
    expect(isVigilanceResponse(wire(body))).toBe(true);
  });
  it('jour courant partiel et note « en cours de constitution » : réponse acceptée, statut ok', async () => {
    sources();
    const { status, body } = await callHandler<VigilanceResponse>(vigilanceHandler);
    expect(status).toBe(200);
    expect(body.history.days.some((d) => d.partial === true)).toBe(true);
    expect(isVigilanceResponse(wire(body))).toBe(true);
    // L'amorçage de l'archive (note nommée par api/_lib/vigilance-archive.js, CONSTITUTION_ERROR) ajoute cette seule chaîne.
    const booting = wire({ ...body, errors: [...body.errors.filter((e) => !e.startsWith('archive vigilance')), CONSTITUTION_ERROR] }) as VigilanceResponse;
    expect(isVigilanceResponse(booting)).toBe(true);
    expect(vigilanceStatus({ vigilance: { data: booting, error: null, fetchedAt: NOW } }, NOW).status).toBe('ok');
  });
  it('clé absente : 502 de même forme, acceptée par la garde (la vue nomme la panne)', async () => {
    vi.stubEnv('METEO_FRANCE_API_KEY', '');
    vi.stubEnv('VITE_METEOFRANCE_API_KEY', '');
    sources();
    const { status, body } = await callHandler<VigilanceResponse>(vigilanceHandler);
    expect([status, body.updateTime, body.periods]).toEqual([502, null, []]);
    expect(isVigilanceResponse(wire(body))).toBe(true);
  });
});

// ─── Crues ───

describe('contrat crues', () => {
  const HUBEAU = fxJson<{ H: object; Q: object }>('hubeau-observations-code-entite.json');
  const sources = (override: (url: string) => FakeResponse | null = () => null): void => {
    stubFetch((url) => {
      const forced = override(url);
      if (forced) return forced;
      if (url === INFOVIGICRU_URL) return respond(fx('vigicrues-infovigicru-reduit.geojson'));
      if (url === TERRITORIES_URL) return respond(fx('vigicrues-terent.json'));
      if (url === sectionStationsUrl('MO12')) return respond(fx('vigicrues-tronent-MO12.json'));
      if (url === sectionStationsUrl('MO11')) return respond(fx('vigicrues-tronent-MO11.json'));
      if (url.startsWith(HUBEAU_OBSERVATIONS_URL)) return respond(url.includes('grandeur_hydro=Q') ? HUBEAU.Q : HUBEAU.H);
      return respond('introuvable', 404);
    });
  };
  it('réponse complète acceptée ; références des tronçons pour le score (Têt, Agly en jaune, tracé publié)', async () => {
    sources();
    const { status, body } = await callHandler<FloodsResponse>(floodsHandler);
    expect([status, body.errors]).toEqual([200, []]);
    expect(isFloodsResponse(wire(body))).toBe(true);
    const refs = floodsToSectionRefs(body);
    expect(refs.map((r) => [r.id, r.name, r.level, r.geometry.type])).toEqual([['MO12', 'Têt', 'yellow', 'MultiLineString'], ['MO11', 'Agly', 'yellow', 'MultiLineString']]);
  });
  it('Hub’Eau en panne : 200 partiel accepté (sections gardées, stations sans mesure)', async () => {
    sources((url) => (url.startsWith(HUBEAU_OBSERVATIONS_URL) ? respond('Service Unavailable', 503) : null));
    const { status, body } = await callHandler<FloodsResponse>(floodsHandler);
    expect(status).toBe(200);
    expect(body.errors.length).toBeGreaterThan(0);
    expect(isFloodsResponse(wire(body))).toBe(true);
  });
  it('Hub’Eau lent : réponse « lecture en cours » acceptée, ligne Vigicrues non dégradée', async () => {
    sources((url) => (url.startsWith(HUBEAU_OBSERVATIONS_URL) ? ({ ...respond('{}'), json: () => new Promise(() => undefined), text: () => new Promise(() => undefined) } as FakeResponse) : null));
    const body = await loadFloods(NOW, { hubeauWaitMs: 5 });
    expect(body.errors).toContain("Hub'Eau : lecture en cours, hauteurs à la prochaine relève");
    expect(isFloodsResponse(wire(body))).toBe(true);
    expect(floodsStatus({ floods: { data: wire(body) as FloodsResponse, error: null, fetchedAt: NOW } }, NOW).status).toBe('ok');
  });
  it('InfoVigiCru jamais lu : 502 de même forme, accepté', async () => {
    sources((url) => (url === INFOVIGICRU_URL ? respond('<!DOCTYPE html><html><body>Maintenance</body></html>') : null));
    const { status, body } = await callHandler<FloodsResponse>(floodsHandler);
    expect([status, body.readAt]).toEqual([502, null]);
    expect(isFloodsResponse(wire(body))).toBe(true);
  });
});

// ─── Feux ───

describe('contrat feux', () => {
  const FRANCE = fx('firms-france-extrait.csv');
  const MODIS = fx('firms-modis-nrt-extrait.csv');
  const viirs = (sat: string): string => {
    const [header, ...lines] = FRANCE.trim().split('\n');
    return `${[header, ...lines.filter((l) => l.split(',')[7] === sat)].join('\n')}\n`;
  };
  const binary = (body: Buffer | string, status = 200): FakeResponse => {
    const buf = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
    return { ...respond('', status), arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) } as FakeResponse;
  };
  const sources = ({ firmsDown = false, mdfDown = false } = {}): void => {
    stubFetch((url) => {
      if (url === mdfUrl(2026)) return mdfDown ? binary('indisponible', 503) : binary(gzipSync(fx('meteo-des-forets-2026-extrait.csv')));
      if (firmsDown) return respond('Invalid MAP_KEY.', 400);
      if (/\/5\/\d{4}-\d{2}-\d{2}$/.test(url)) return respond(`${(url.includes('/MODIS_NRT/') ? MODIS : FRANCE).split('\n')[0]}\n`);
      if (url.endsWith('/VIIRS_SNPP_NRT/-6,41,10,52/2')) return respond(viirs('N'));
      if (url.endsWith('/VIIRS_NOAA20_NRT/-6,41,10,52/2')) return respond(viirs('N20'));
      if (url.endsWith('/VIIRS_NOAA21_NRT/-6,41,10,52/2')) return respond(viirs('N21'));
      if (url.endsWith('/MODIS_NRT/-6,41,10,52/2')) return respond(MODIS);
      return respond('introuvable', 404);
    });
  };
  beforeEach(() => { __resetForestDangerForTests(); vi.stubEnv('NASA_FIRMS_API_KEY', 'CLE-SECRETE'); });

  it('réponse complète acceptée ; entrée du score : détections en France non récurrentes, converties pour le regroupement', async () => {
    sources();
    const { status, body } = await callHandler<FiresResponse>(firesHandler);
    expect([status, body.errors]).toEqual([200, []]);
    expect(isFiresResponse(wire(body))).toBe(true);
    const scored = scoreFireDetections(body);
    expect(scored.every((d) => !d.recurrent)).toBe(true);
    expect(scored.length).toBe(body.detections.filter((d) => !d.recurrent).length);
    const active = scored.map(toActiveFire);
    expect(active.every((a) => /^\d{4}$/.test(a.acq_time) && ['low', 'nominal', 'high'].includes(a.confidence))).toBe(true);
  });
  it('phrases FIRMS du serveur reprises à l’identique par le client ; cycle en cours : réponse acceptée, ligne FIRMS à l’heure', async () => {
    expect([FIRMS_PENDING_NOTE, FIRMS_TOO_OLD_ERROR]).toEqual([FIRMS_PENDING_ERROR, TOO_OLD_ERROR]);
    expect([isProgressNote(FIRMS_PENDING_ERROR), isProgressNote(TOO_OLD_ERROR)]).toEqual([true, false]);
    sources();
    const { body } = await callHandler<FiresResponse>(firesHandler);
    // Échéance de la route atteinte pendant un cycle : collecte servie avec sa date et cette seule note (api/_lib/fires-collect.js).
    const pending = wire({ ...body, errors: [FIRMS_PENDING_ERROR] }) as FiresResponse;
    expect(isFiresResponse(pending)).toBe(true);
    expect(firesStatus({ fires: { data: pending, error: null, fetchedAt: NOW } }, 'firms', NOW)).toMatchObject({ status: 'ok', error: undefined });
  });
  it('lignes FIRMS illisibles : nommées dans errors, réponse acceptée, ligne FIRMS dégradée', async () => {
    const bad = (sat: string): string => `${viirs(sat)}2026-10-04,ligne,tronquée\n`;
    stubFetch((url) => {
      if (url === mdfUrl(2026)) return binary(gzipSync(fx('meteo-des-forets-2026-extrait.csv')));
      if (/\/5\/\d{4}-\d{2}-\d{2}$/.test(url)) return respond(`${(url.includes('/MODIS_NRT/') ? MODIS : FRANCE).split('\n')[0]}\n`);
      if (url.endsWith('/VIIRS_SNPP_NRT/-6,41,10,52/2')) return respond(bad('N'));
      if (url.endsWith('/VIIRS_NOAA20_NRT/-6,41,10,52/2')) return respond(viirs('N20'));
      if (url.endsWith('/VIIRS_NOAA21_NRT/-6,41,10,52/2')) return respond(viirs('N21'));
      if (url.endsWith('/MODIS_NRT/-6,41,10,52/2')) return respond(MODIS);
      return respond('introuvable', 404);
    });
    const { status, body } = await callHandler<FiresResponse>(firesHandler);
    expect(status).toBe(200);
    expect(body.errors.some((e) => /^FIRMS, .* : 1 ligne illisible$/.test(e))).toBe(true);
    expect(isFiresResponse(wire(body))).toBe(true);
    expect(firesStatus({ fires: { data: wire(body) as FiresResponse, error: null, fetchedAt: NOW } }, 'firms', NOW).status).toBe('stale');
  });
  it('météo des forêts en panne : 200 partiel accepté ; FIRMS en panne mais météo des forêts lue : 200 accepté', async () => {
    sources({ mdfDown: true });
    const partial = await callHandler<FiresResponse>(firesHandler);
    expect([partial.status, partial.body.forestDanger]).toEqual([200, null]);
    expect(isFiresResponse(wire(partial.body))).toBe(true);
    __resetSwrCacheForTests();
    __resetKvForTests();
    __resetForestDangerForTests();
    sources({ firmsDown: true });
    const firmsDown = await callHandler<FiresResponse>(firesHandler);
    expect([firmsDown.status, firmsDown.body.readAt]).toEqual([200, null]);
    expect(isFiresResponse(wire(firmsDown.body))).toBe(true);
  });
  it('les deux en panne : 502 de même forme, accepté', async () => {
    sources({ firmsDown: true, mdfDown: true });
    const { status, body } = await callHandler<FiresResponse>(firesHandler);
    expect([status, body.readAt, body.forestDanger]).toEqual([502, null, null]);
    expect(isFiresResponse(wire(body))).toBe(true);
  });
});

// ─── Communes autour d'un foyer ───

describe('contrat communes autour d’un foyer', () => {
  it('Le Porge (Gironde) : réponse acceptée, commune la plus proche nommée', async () => {
    stubFetch((url) => (url.includes('codeDepartement=33') ? respond(fx('geo-communes-dept-33.json')) : respond('[]')));
    const { status, body } = await callHandler<FireImpactsResponse>(impactsHandler, { lat: '44.88', lon: '-1.12' });
    expect(status).toBe(200);
    expect(isFireImpactsResponse(wire(body))).toBe(true);
    expect(body.nearest?.name).toBe('Le Porge');
  });
});
