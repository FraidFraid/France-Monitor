import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetKvForTests, __setKvClientForTests } from '../api/_lib/kv-history.js';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import { ARCEP_DATASET_URL, __resetTelecomForTests, arcepFileUrl } from '../api/_lib/outages-telecom.js';
import { IIP_PRODUCTION_URL, IIP_TRANSMISSION_URL, __resetPowerForTests } from '../api/_lib/outages-power.js';
import telecomHandler from '../api/_handlers/outages/telecom.js';
import powerHandler from '../api/_handlers/outages/power.js';
import { resetSovereigntySourceCache } from '../src/services/sovereignty-source.ts';
import { TELECOM_URL, arcepStatus, fetchTelecom, isTelecomOutagesResponse, telecomResponseProblems } from '../src/services/outages-telecom.ts';
import { POWER_URL, edfStatus, fetchPower, iipStatus, isPowerOutagesResponse, powerResponseProblems } from '../src/services/outages-power.ts';
import { callHandler, respond, stubFetch } from './helpers/traffic-fixtures.ts';
import type { PowerOutagesResponse, TelecomOutagesResponse } from '../src/types/index.ts';

const fx = (name: string): string => readFileSync(new URL(`./fixtures/outages/${name}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-08T20:00:00Z');
const wire = (b: unknown): unknown => JSON.parse(JSON.stringify(b)) as unknown;
function upstream(url: string) {
  if (url === ARCEP_DATASET_URL) return respond({ resources: [
    { title: '2026-10-08.geojson', format: 'geojson', url: arcepFileUrl('2026-10-08'), last_modified: '2026-10-08T09:02:20+00:00' },
    { title: '2026-10-07.geojson', format: 'geojson', url: arcepFileUrl('2026-10-07'), last_modified: '2026-10-07T09:02:12+00:00' },
  ] });
  if (url === arcepFileUrl('2026-10-08')) return respond(fx('arcep-2026-10-08.geojson'), 200, { 'last-modified': 'Thu, 08 Oct 2026 09:02:20 GMT' });
  if (url === arcepFileUrl('2026-10-07')) return respond(fx('arcep-2026-10-07.geojson'), 200, { 'last-modified': 'Wed, 07 Oct 2026 09:02:12 GMT' });
  if (url.startsWith('https://opendata.edf.fr/data-fair/api/v1/datasets/indisponibilites-des-moyens-de-production-edf-sa/lines')) return respond(fx('edf-indispo-2026-10-08.json'));
  if (url === 'https://opendata.edf.fr/data-fair/api/v1/datasets/indisponibilites-des-moyens-de-production-edf-sa') return respond({ dataUpdatedAt: '2026-10-08T10:00:17.798Z' });
  if (url === IIP_PRODUCTION_URL) return respond(fx('iip-production-2026-10-08.xml'), 200, { 'content-type': 'application/xml' });
  if (url === IIP_TRANSMISSION_URL) return respond(fx('iip-transmission-2026-10-08.xml'), 200, { 'content-type': 'application/xml' });
  if (url.includes('/datasets/meteo-reseau-reunion/lines')) return respond(fx('sei-meteo-reseau-reunion-2026-10-08.json'));
  if (url.includes('/datasets/ecorsicawatt/lines')) return respond(fx('sei-ecorsicawatt-2026-10-08.json'));
  return respond('introuvable', 404);
}
function serveToClient(routes: Record<string, { status: number; body: unknown }>): void {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const r = routes[url];
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => wire(r.body) };
  }));
}
beforeEach(() => {
  __resetSwrCacheForTests(); __resetKvForTests(); __resetTelecomForTests(); __resetPowerForTests(); resetSovereigntySourceCache();
  const store = new Map<string, string>();
  __setKvClientForTests({ get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: string) => { store.set(k, v); } });
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
});
afterEach(() => { __setKvClientForTests(null); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('contrat Télécoms', () => {
  it('réponse du serveur acceptée telle quelle ; ligne « ARCEP sites mobiles » datée par la publication', async () => {
    stubFetch(upstream);
    const { status, body } = await callHandler<TelecomOutagesResponse>(telecomHandler);
    expect(isTelecomOutagesResponse(wire(body))).toBe(true);
    serveToClient({ [TELECOM_URL]: { status, body } });
    const st = arcepStatus(await fetchTelecom(null, NOW), NOW);
    expect(st.status).toBe('ok');
    expect(st.lastUpdate?.toISOString()).toBe('2026-10-08T09:02:20.000Z');
  });
  it('retard ARCEP par isArcepFileLate (R30) : fichier du jour jamais en retard, fichier de la veille en retard après 15 h seulement', async () => {
    stubFetch(upstream);
    const { status, body } = await callHandler<TelecomOutagesResponse>(telecomHandler);
    serveToClient({ [TELECOM_URL]: { status, body } });
    const state = await fetchTelecom(null, NOW);
    expect(arcepStatus(state, NOW).period).not.toMatch(/\(en retard\)/);
    expect(arcepStatus(state, Date.parse('2026-10-09T09:00:00Z')).status).toBe('ok');      // 11 h à Paris, fichier de la veille
    const late = arcepStatus(state, Date.parse('2026-10-09T14:00:00Z'));                   // 16 h à Paris, fichier du jour manquant
    expect(late.status).toBe('stale');
    expect(late.period).toMatch(/\(en retard\)$/);
  });
  it('un champ en trop ou manquant est refusé et nommé par son chemin', async () => {
    stubFetch(upstream);
    const { body } = await callHandler<TelecomOutagesResponse>(telecomHandler);
    const bad = wire(body) as Record<string, unknown> & { sites: Array<Record<string, unknown>> };
    bad.sites[0] = { ...bad.sites[0], station: 'x' };
    expect(telecomResponseProblems(bad)[0]).toMatch(/^sites\[0\]\.station/);
  });
  it('502 du serveur : panne nommée « ARCEP : … », jamais « HTTP 502 » ni « aucune panne »', async () => {
    stubFetch(() => respond('panne', 503));
    const { status, body } = await callHandler<TelecomOutagesResponse>(telecomHandler);
    serveToClient({ [TELECOM_URL]: { status, body } });
    const state = await fetchTelecom(null, NOW);
    expect(state.telecom.data).toBeNull();
    expect(state.telecom.error).toMatch(/^ARCEP/);
  });
});

describe('contrat Électricité', () => {
  it('réponse acceptée ; lignes EDF et IIP datées par leurs sources, retard EDF mesuré sur la dernière lecture (R20)', async () => {
    stubFetch(upstream);
    const { status, body } = await callHandler<PowerOutagesResponse>(powerHandler);
    expect(isPowerOutagesResponse(wire(body))).toBe(true);
    expect(body.edfReadAt).toBe('2026-10-08T20:00:00.000Z');
    serveToClient({ [POWER_URL]: { status, body } });
    const state = await fetchPower(null, NOW);
    expect(edfStatus(state, NOW).lastUpdate?.toISOString()).toBe('2026-10-08T10:00:17.798Z');
    // Le jeu date de 10:00 UTC mais le serveur l'a lu à 20:00 : la donnée n'est pas en retard, elle est simplement ancienne.
    expect(edfStatus(state, NOW).period).not.toMatch(/\(en retard\)/);
    expect(edfStatus(state, NOW + 2 * 3_600_000 + 60_000).period).toMatch(/\(en retard\)$/);   // lecture vieille de plus de 2 h
    expect(iipStatus(state, NOW).status).toBe('ok');
  });
  it('I1 : contrat iipReadAt, retard IIP mesuré sur la dernière lecture réussie, date du flux affichée', async () => {
    stubFetch(upstream);
    const { status, body } = await callHandler<PowerOutagesResponse>(powerHandler);
    expect(body.iipReadAt).toBe('2026-10-08T20:00:00.000Z');
    expect(body.iipPublishedAt).toMatch(/^2026-10-08T19:24:37/);
    serveToClient({ [POWER_URL]: { status, body } });
    const state = await fetchPower(null, NOW);
    expect(iipStatus(state, NOW).lastUpdate?.toISOString()).toBe(body.iipPublishedAt);
    // Le flux est publié depuis plus d'une heure, mais le serveur l'a lu il y a 30 min : pas en retard.
    expect(iipStatus(state, NOW + 30 * 60_000).period).not.toMatch(/\(en retard\)/);
    expect(iipStatus(state, NOW + 61 * 60_000).period).toMatch(/\(en retard\)$/);
  });
  it('un champ en trop ou manquant est refusé et nommé par son chemin', async () => {
    stubFetch(upstream);
    const { body } = await callHandler<PowerOutagesResponse>(powerHandler);
    const bad = wire(body) as Record<string, unknown> & { unplanned: Array<Record<string, unknown>> };
    bad.unplanned[0] = { ...bad.unplanned[0], operator: 'x' };
    expect(powerResponseProblems(bad)[0]).toMatch(/^unplanned\[.*\]\.operator \(en trop\)/);
    const { edfReadAt: _omitted, ...missing } = wire(body) as Record<string, unknown>;
    expect(powerResponseProblems(missing)).toEqual(['edfReadAt (absent)']);
    const { iipReadAt: _omittedIip, ...missingIip } = wire(body) as Record<string, unknown>;
    expect(powerResponseProblems(missingIip)).toEqual(['iipReadAt (absent)']);
  });
  it('502 du serveur : panne nommée par le serveur, jamais « HTTP 502 » ni « aucun arrêt »', async () => {
    stubFetch(() => respond('panne', 503));
    const { status, body } = await callHandler<PowerOutagesResponse>(powerHandler);
    expect(status).toBe(502);
    serveToClient({ [POWER_URL]: { status, body } });
    const state = await fetchPower(null, NOW);
    expect(state.power.data).toBeNull();
    expect(state.power.error).toMatch(/^(EDF OpenData|RTE IIP)/);
  });
});
