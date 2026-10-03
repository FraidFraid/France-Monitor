// Contrat serveur / client des Trafics : chaque réponse construite par le code du serveur (réponses réelles du 03/10/2026, mêmes
// doublures que les tests des routes) doit passer la garde stricte du client ; une panne partielle (errors[] non vide) aussi, pour
// que les vues puissent la nommer au lieu de la lire comme « réponse mal formée ». L'aperçu aérien aura son test avec la tâche 6.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { INDEX_URL, SNAPSHOT_URL, __resetDatexStateForTests } from '../api/_lib/datex-dir.js';
import { CNIR_URL, QTV_URL, REFDIR_URL, TRAFICOLOR_BASE } from '../api/_lib/dir-measures.js';
import { __resetKvForTests, __setKvClientForTests } from '../api/_lib/kv-history.js';
import { __resetSncfStateForTests, tripUrl } from '../api/_lib/sncf-rail.js';
import { SIRI_SX_URL } from '../api/_lib/siri-sx.js';
import { createAisTracker, snapshotResponse } from '../api/_lib/ais-snapshot.js';
import roadNationalHandler from '../api/_handlers/traffic/road-national.js';
import roadUrbanHandler from '../api/_handlers/traffic/road-urban.js';
import railOverviewHandler from '../api/_handlers/transport/rail-overview.js';
import railSituationsHandler from '../api/_handlers/transport/rail-situations.js';
import type { RailOverviewResponse, RailSituationsResponse, RoadNationalResponse, RoadUrbanResponse } from '../src/types/index.ts';
import { isRoadNationalResponse, isRoadUrbanResponse } from '../src/services/traffic-road.ts';
import { isRailOverviewResponse, isRailSituationsResponse } from '../src/services/traffic-rail.ts';
import { isMaritimeSnapshot } from '../src/services/traffic-maritime.ts';
import { type FakeResponse, callHandler, fixtureJson, fixtureText, respond, stubFetch } from './helpers/traffic-fixtures.ts';

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

/** Ce que le navigateur reçoit : le corps après sérialisation JSON (champs `undefined` perdus). */
const wire = (body: unknown): unknown => JSON.parse(JSON.stringify(body)) as unknown;

function freeze(iso: string): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.parse(iso));
}

// ─── Route : réseau national ───

describe('contrat road-national', () => {
  beforeEach(() => { __resetSwrCacheForTests(); __resetDatexStateForTests(); freeze('2026-10-03T15:10:00+02:00'); });
  const sources = (override: (url: string) => FakeResponse | null = () => null): void => {
    stubFetch((url) => {
      const forced = override(url);
      if (forced) return forced;
      if (url === SNAPSHOT_URL) return respond(fixtureText('datex-content.xml'));
      if (url === INDEX_URL) return respond('3566873');
      const inc = /\/RRN\/(\d+)\.xml$/.exec(url);
      if (inc) return respond(fixtureText(`datex-inc-${inc[1]}.xml`));
      if (url === QTV_URL) return respond(fixtureText('qtv-dir.xml'));
      if (url === REFDIR_URL) return respond(fixtureText('refdir.csv'));
      if (url === CNIR_URL) return respond(fixtureText('cnir-bouchons.html'));
      if (url === `${TRAFICOLOR_BASE}/`) return respond(fixtureText('traficolor-index.html'));
      const listing = /TRAFICOLOR-DIR\/(\w+)\/\?C=M;O=D$/.exec(url);
      if (listing) return respond(fixtureText(`traficolor-listing-${listing[1]}.html`));
      const file = /TRAFICOLOR-DIR\/(\w+)\/[^/]+\.xml$/.exec(url);
      if (file) return respond(fixtureText(`traficolor-${file[1]}.xml`));
      return respond('introuvable', 404);
    });
  };
  it('réponse complète acceptée', async () => {
    sources();
    const { status, body } = await callHandler<RoadNationalResponse>(roadNationalHandler);
    expect([status, body.errors]).toEqual([200, []]);
    expect(isRoadNationalResponse(wire(body))).toBe(true);
  });
  it('panne partielle (Traficolor Lille en HTTP 403, CNIR en page de défi) : acceptée, erreurs nommées', async () => {
    sources((url) => (url.includes('/TraficLille/') ? respond('interdit', 403) : url === CNIR_URL ? respond(fixtureText('challenge-captcha.html')) : null));
    const { status, body } = await callHandler<RoadNationalResponse>(roadNationalHandler);
    expect(status).toBe(200);
    expect(body.errors.length).toBeGreaterThan(0);
    expect(isRoadNationalResponse(wire(body))).toBe(true);
  });
  it('flux DATEX et QTV en panne : acceptée', async () => {
    sources((url) => (url === SNAPSHOT_URL || url === QTV_URL ? respond('erreur', 500) : null));
    const { body } = await callHandler<RoadNationalResponse>(roadNationalHandler);
    expect(body.errors.length).toBeGreaterThan(0);
    expect(isRoadNationalResponse(wire(body))).toBe(true);
  });
});

// ─── Route : agglomérations ───

describe('contrat road-urban', () => {
  beforeEach(() => {
    __resetKvForTests();
    __setKvClientForTests({ get: async () => null, set: async () => {} });
    vi.stubEnv('VITE_TOMTOM_API_KEY', '');
    vi.stubEnv('TOMTOM_API_KEY', 'cle-de-test');
    freeze('2026-10-03T14:00:00+02:00');
  });
  afterEach(() => { __setKvClientForTests(null); __resetKvForTests(); });
  const LYON = fixtureJson<object>('tomtom-lyon-ouest-cat6.json');
  it('réponse complète acceptée', async () => {
    stubFetch((url) => (url.includes('bbox=4.7') || url.includes('bbox=4.86') ? respond(LYON) : respond({ incidents: [] })));
    const { status, body } = await callHandler<RoadUrbanResponse>(roadUrbanHandler);
    expect(status).toBe(200);
    expect(isRoadUrbanResponse(wire(body))).toBe(true);
  });
  it('panne partielle (une agglomération refusée) : acceptée, erreur nommée', async () => {
    stubFetch((url) => (url.includes('bbox=4.7') || url.includes('bbox=4.86') ? respond(LYON) : url.includes('bbox=2.') ? respond('refusé', 403) : respond({ incidents: [] })));
    const { status, body } = await callHandler<RoadUrbanResponse>(roadUrbanHandler);
    expect(status).toBe(200);
    expect(body.errors.length).toBeGreaterThan(0);
    expect(isRoadUrbanResponse(wire(body))).toBe(true);
  });
  it('aucune collecte réussie (corps du 502) : forme valide, erreurs nommées', async () => {
    stubFetch(() => respond(fixtureText('tomtom-401.json'), 401));
    const { status, body } = await callHandler<RoadUrbanResponse>(roadUrbanHandler);
    expect(status).toBe(502);
    expect(isRoadUrbanResponse(wire(body))).toBe(true);
  });
});

// ─── Rail ───

describe('contrat rail-overview et rail-situations', () => {
  beforeEach(() => {
    __resetSwrCacheForTests();
    __resetSncfStateForTests();
    vi.stubEnv('SNCF_API_KEY', 'cle-de-test');
    freeze('2026-10-03T15:10:00+02:00');
  });
  const sncf = (disruptions: unknown): void => {
    stubFetch((url) => {
      if (url.includes('/disruptions?')) return respond(disruptions as object);
      if (url === tripUrl('SNCF:2026-10-03:4762:1187:LongDistanceTrain')) return respond(fixtureText('sncf-trip-4762.json'));
      return respond('{"error":"absent"}', 404);
    });
  };
  it('sept axes (réponse réelle du jour) : acceptée, itinéraire non lu nommé', async () => {
    sncf(fixtureJson('sncf-disruptions.json'));
    const { status, body } = await callHandler<RailOverviewResponse>(railOverviewHandler);
    expect([status, body.axes.length]).toEqual([200, 7]);
    expect(body.errors.length).toBeGreaterThan(0);
    expect(isRailOverviewResponse(wire(body))).toBe(true);
  });
  it('huit axes (une grande ligne supprimée sans arrêt) : « Non rattaché » accepté', async () => {
    const real = fixtureJson<{ disruptions: unknown[] }>('sncf-disruptions.json');
    const orphan = {
      id: 'orphan', status: 'active', updated_at: '20261003T150000', severity: { effect: 'NO_SERVICE' },
      impacted_objects: [{ pt_object: { id: 'SNCF:2026-10-03:5001:1187:LongDistanceTrain', trip: { name: '5001' }, embedded_type: 'trip' }, impacted_stops: [] }],
    };
    sncf({ ...real, disruptions: [...real.disruptions, orphan] });
    const { body } = await callHandler<RailOverviewResponse>(railOverviewHandler);
    expect(body.axes).toHaveLength(8);
    expect(body.axes[7]).toMatchObject({ key: 'non-rattache' });
    expect(isRailOverviewResponse(wire(body))).toBe(true);
  });
  it('panne amont (corps du 502) et jour sans train : formes valides', async () => {
    stubFetch(() => respond('Too Many Requests', 429));
    const down = await callHandler<RailOverviewResponse>(railOverviewHandler);
    expect(down.status).toBe(502);
    expect(isRailOverviewResponse(wire(down.body))).toBe(true);
    __resetSwrCacheForTests();
    sncf({ disruptions: [], pagination: { total_result: 0 } });
    const calm = await callHandler<RailOverviewResponse>(railOverviewHandler);
    expect([calm.status, calm.body.trains, calm.body.errors]).toEqual([200, [], []]);
    expect(isRailOverviewResponse(wire(calm.body))).toBe(true);
  });
  it('situations SIRI SX : réponse complète et panne (corps du 502) acceptées', async () => {
    freeze('2026-10-03T13:10:28Z');
    stubFetch((url) => (url === SIRI_SX_URL ? respond(fixtureText('siri-sx.xml')) : respond('', 404)));
    const ok = await callHandler<RailSituationsResponse>(railSituationsHandler);
    expect(ok.status).toBe(200);
    expect(isRailSituationsResponse(wire(ok.body))).toBe(true);
    __resetSwrCacheForTests();
    stubFetch(() => respond('erreur', 500));
    const ko = await callHandler<RailSituationsResponse>(railSituationsHandler);
    expect([ko.status, ko.body.errors.length]).toEqual([502, 1]);
    expect(isRailSituationsResponse(wire(ko.body))).toBe(true);
  });
});

// ─── Maritime : instantané du relais (le relais sert `snapshotResponse` tel quel) ───

describe('contrat de l’instantané maritime', () => {
  const LAST = Date.parse('2026-10-03T13:19:48.822Z');
  const populated = () => {
    const tracker = createAisTracker();
    for (const l of fixtureText('ais-messages.jsonl').split('\n').filter(Boolean)) tracker.ingest(l);
    return tracker;
  };
  it('suivi alimenté, flux ouvert : accepté, sans erreur', () => {
    const body = snapshotResponse(populated(), LAST + 1000, { hasKey: true, upstreamOpen: true });
    expect(body.errors).toEqual([]);
    expect(isMaritimeSnapshot(wire(body))).toBe(true);
  });
  it('flux aisstream déconnecté, puis clé absente, suivi vide ou non : acceptés avec leur erreur nommée', () => {
    const cases = [
      snapshotResponse(populated(), LAST + 11 * 60_000, { hasKey: true, upstreamOpen: false }),
      snapshotResponse(populated(), LAST, { hasKey: false, upstreamOpen: false }),
      snapshotResponse(createAisTracker(), LAST, { hasKey: false, upstreamOpen: false }),
      snapshotResponse(createAisTracker(), LAST, { hasKey: true, upstreamOpen: false }),
    ];
    for (const body of cases) {
      expect(body.errors.length).toBe(1);
      expect(isMaritimeSnapshot(wire(body))).toBe(true);
    }
  });
  it('panne partielle ou connexion muette : acceptées avec leur lot nommé ; zones de port avec lastSeenAt', () => {
    const lots = [
      { index: 0, open: true, lastAt: LAST, labels: ['Manche'], metro: true },
      { index: 1, open: false, lastAt: null, labels: ['Gironde'], metro: true },
      { index: 2, open: true, lastAt: LAST - 8 * 60_000, labels: ['Corse'], metro: true },
    ];
    const body = snapshotResponse(populated(), LAST + 1000, { hasKey: true, upstreamOpen: true, upstreams: lots });
    expect(body.errors).toEqual(['flux AIS partiel : lot 2 sur 3 coupé (Gironde)', 'flux AIS partiel : lot 3 sur 3 muet depuis 8 min (Corse)']);
    expect(isMaritimeSnapshot(wire(body))).toBe(true);
    expect(body.ports.every((p: { lastSeenAt: string | null }) => p.lastSeenAt === null || /Z$/.test(p.lastSeenAt))).toBe(true);
    expect(body.ports.find((p: { port: string }) => p.port === 'Bordeaux')?.lastSeenAt).toBeNull();
    const broken = wire(body) as { ports: Array<Record<string, unknown>> };
    delete broken.ports[0].lastSeenAt;
    expect(isMaritimeSnapshot(broken)).toBe(false);
  });
});
