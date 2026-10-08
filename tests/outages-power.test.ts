// tests/outages-power.test.ts : collecteur Électricité (spec 2026-10-08 § 2.2 ; faits § 2 à 4) sur les réponses réelles du 08/10.
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetKvForTests, __setKvClientForTests } from '../api/_lib/kv-history.js';
import {
  EDF_BELGIAN_UNITS, IIP_PRODUCTION_URL, IIP_TRANSMISSION_URL, SEI_DATASETS, __resetPowerForTests, buildPower, edfLinesUrl, ensurePowerFresh,
  historyFromEdf, iipTransmission, iipUnits, latestVersions, mergeUnits, normalizeEdfLine, parseIipFeed, seiSignal,
} from '../api/_lib/outages-power.js';
import { iipCa, iipDispatcher, iipIntermediatePem } from '../api/_lib/rte-iip-agent.js';
import { respond, sentHeader, stubFetch } from './helpers/traffic-fixtures.ts';

const fx = (name: string): string => readFileSync(new URL(`./fixtures/outages/${name}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-08T20:00:00Z');
const EDF = (): { results: unknown[] } => JSON.parse(fx('edf-indispo-2026-10-08.json')) as { results: unknown[] };

function route(url: string) {
  if (url.startsWith('https://opendata.edf.fr/data-fair/api/v1/datasets/indisponibilites-des-moyens-de-production-edf-sa/lines')) return respond(fx('edf-indispo-2026-10-08.json'));
  if (url === 'https://opendata.edf.fr/data-fair/api/v1/datasets/indisponibilites-des-moyens-de-production-edf-sa') return respond({ dataUpdatedAt: '2026-10-08T10:00:17.798Z' });
  if (url === IIP_PRODUCTION_URL) return respond(fx('iip-production-2026-10-08.xml'), 200, { 'content-type': 'application/xml' });
  if (url === IIP_TRANSMISSION_URL) return respond(fx('iip-transmission-2026-10-08.xml'), 200, { 'content-type': 'application/xml' });
  if (url.includes('/datasets/meteo-reseau-reunion/lines')) return respond(fx('sei-meteo-reseau-reunion-2026-10-08.json'));
  if (url.includes('/datasets/ecorsicawatt/lines')) return respond(fx('sei-ecorsicawatt-2026-10-08.json'));
  return respond('introuvable', 404);
}

beforeEach(() => {
  __resetKvForTests(); __resetPowerForTests();
  const store = new Map<string, string>();
  __setKvClientForTests({ get: async (k: string) => store.get(k) ?? null, set: async (k: string, v: string) => { store.set(k, v); } });
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW);
});
afterEach(() => { __setKvClientForTests(null); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('EDF OpenData', () => {
  it('URL : version en vigueur, fenêtre par filtres DataFair (jamais qs avec « > », qui répond 400)', () => {
    const url = edfLinesUrl({ from: '2026-10-08T20:00:00.000Z', to: '2026-10-15T20:00:00.000Z' });
    expect(url).toContain('status_eq=Active');
    expect(url).toContain('date_de_fin_gte=2026-10-08T20%3A00%3A00.000Z');
    expect(url).toContain('date_de_debut_lte=2026-10-15T20%3A00%3A00.000Z');
    expect(url).not.toContain('qs=');
  });
  it('lignes : chroniques de réserve et unités belges écartées, MW perdus = maximale − disponible', () => {
    const units = EDF().results.map((l) => normalizeEdfLine(l)).filter((u) => u !== null);
    expect(units.some((u) => /SERAING|Seraing/.test(u.name))).toBe(false);
    expect(units.some((u) => u.name === 'MONTEYNARD')).toBe(false);
    expect(EDF_BELGIAN_UNITS).toEqual(expect.arrayContaining(['SERAING TV', 'Seraing CCGT-GT', 'RINGVAART STEG', 'NOBELWIND', 'BESS Navagne']));
    expect(units.find((u) => u.name === 'PALUEL 1')).toMatchObject({ kind: 'imprevue', lostMw: 1330, sector: 'Nucléaire', nuclear: true, source: 'edf', cause: 'Défaillance' });
  });
});

describe('RTE IIP', () => {
  it('versions : la plus haute par message, annulés écartés', () => {
    const latest = latestVersions(parseIipFeed(fx('iip-production-2026-10-08.xml')));
    expect(latest.filter((m) => m.asset === 'ST ALBAN 1')).toHaveLength(1);
    expect(latest.find((m) => m.asset === 'ST ALBAN 1')?.version).toBe(8);
    expect(latest.some((m) => m.status === 'Dismissed')).toBe(false);
  });
  it('production : imprévue en cours (CRUAS 1, 915 MW), terminées et futures écartées des « en cours »', () => {
    const units = iipUnits(latestVersions(parseIipFeed(fx('iip-production-2026-10-08.xml'))), NOW);
    const unplanned = units.filter((u) => u.kind === 'imprevue' && Date.parse(u.start) <= NOW && (u.end === null || Date.parse(u.end) > NOW));
    expect(unplanned.map((u) => [u.name, u.lostMw])).toEqual([['CRUAS 1', 915]]);
  });
  it('transport : Mandarins-Sellindge 1 non planifiée, deux sens nommés, MW indisponibles à l’instant', () => {
    const t = iipTransmission(latestVersions(parseIipFeed(fx('iip-transmission-2026-10-08.xml'))), NOW);
    expect(t.unplanned).toHaveLength(1);
    expect(t.unplanned[0]).toMatchObject({ asset: 'Mandarins-Sellindge 1', kind: 'imprevue', reason: 'Défaillance', end: '2026-10-24T07:00:00.000Z' });
    expect(t.unplanned[0].directions).toEqual([
      { label: 'France → Royaume-Uni', unavailableMw: 0, installedMw: 2000 },
      { label: 'Royaume-Uni → France', unavailableMw: 1000, installedMw: 1000 },
    ]);
    expect(t.planned.map((x) => x.asset)).toEqual(['Villarodin-Venaus']);
  });
});

describe('fusion et réponse', () => {
  it('CRUAS 1 comptée une fois (EDF prime), gros chiffre 2 834 MW (faits § 2)', () => {
    const edf = EDF().results.map((l) => normalizeEdfLine(l)).filter((u) => u !== null);
    const iip = iipUnits(latestVersions(parseIipFeed(fx('iip-production-2026-10-08.xml'))), NOW);
    const merged = mergeUnits(edf, iip);
    expect(merged.filter((u) => u.name === 'CRUAS 1')).toHaveLength(1);
    const body = buildPower({ edf: merged, iip: null, sei: [], history: [] }, NOW);
    expect(body.unplanned.map((u) => u.name)).toEqual(['PALUEL 1', 'CRUAS 1', 'BLENOD 5', 'SUPER BISSORTE 5']);
    expect(Math.round(body.unplanned.reduce((s, u) => s + u.lostMw, 0))).toBe(2834);
    expect(body.planned.some((u) => /eraing/i.test(u.name))).toBe(false);
    expect(body.upcoming.map((u) => u.name)).toEqual(expect.arrayContaining(['REVIN 2', 'VILLARODIN']));
  });
  it('signal des îles : ligne de l’heure en cours, couleur et texte tels quels', () => {
    expect(seiSignal(JSON.parse(fx('sei-ecorsicawatt-2026-10-08.json')), 'corse', NOW)).toEqual({ zone: 'corse', at: '2026-10-08T20:00:00.000Z', color: 'vert', text: 'Optimal', cyclone: false });
    expect(seiSignal(JSON.parse(fx('sei-meteo-reseau-reunion-2026-10-08.json')), 'reunion', NOW)).toMatchObject({ zone: 'reunion', color: 'vert', text: 'Optimal' });
  });
  it('collecte complète : sources nommées, User-Agent FranceMonitor, dates des sources', async () => {
    const log = stubFetch(route);
    const body = await ensurePowerFresh(NOW);
    expect(body.errors).toEqual([]);
    expect(body.edfUpdatedAt).toBe('2026-10-08T10:00:17.798Z');
    expect(body.iipPublishedAt).toMatch(/^2026-10-08T/);
    expect(body.unplanned).toHaveLength(4);
    expect(body.transmission?.unplanned).toHaveLength(1);
    expect(body.islands.map((i) => i.zone)).toEqual(['reunion', 'corse']);
    expect(log.inits.every((i) => /^FranceMonitor\//.test(sentHeader(i, 'User-Agent') ?? ''))).toBe(true);
    expect(SEI_DATASETS.map((d) => d.zone)).toEqual(['reunion', 'corse']);
  });
  it('IIP : lue avec l’agent dédié (intermédiaire RTE de confiance) ; aucun autre hôte n’en reçoit', async () => {
    const log = stubFetch(route);
    await ensurePowerFresh(NOW);
    const calls = log.urls.map((u, i) => ({ u, init: log.inits[i] as (RequestInit & { dispatcher?: unknown }) | undefined }));
    const iip = calls.filter((c) => c.u.startsWith('https://iip.'));
    expect(iip).toHaveLength(2);
    expect(iip.every((c) => c.init?.dispatcher === iipDispatcher())).toBe(true);
    const others = calls.filter((c) => !c.u.startsWith('https://iip.'));
    expect(others.length).toBeGreaterThan(0);
    expect(others.every((c) => c.init?.dispatcher === undefined)).toBe(true);
  });
  it('agent IIP : racines de Node + intermédiaire GlobalSign R46 (certificat valide, émis par GlobalSign Root R46)', () => {
    const cert = new X509Certificate(iipIntermediatePem().slice(iipIntermediatePem().indexOf('-----BEGIN CERTIFICATE-----')));
    expect(cert.subject).toContain('CN=GlobalSign GCC R46 OV TLS CA 2025');
    expect(cert.issuer).toContain('CN=GlobalSign Root R46');
    expect(Date.parse(cert.validTo)).toBeGreaterThan(NOW);
    const root = rootCertificates.map((r) => new X509Certificate(r)).find((r) => r.subject === cert.issuer);
    expect(root && cert.verify(root.publicKey)).toBe(true);
    const ca = iipCa();
    expect(ca).toHaveLength(rootCertificates.length + 1);
    expect(ca.slice(0, rootCertificates.length)).toEqual(rootCertificates);
    expect(ca.at(-1)).toBe(iipIntermediatePem());
  });
  it('IIP en panne : EDF servi, transport null, erreur « RTE IIP : … »', async () => {
    stubFetch((url) => (url.startsWith('https://iip.') ? respond('panne', 503) : route(url)));
    const body = await ensurePowerFresh(NOW);
    expect(body.unplanned).toHaveLength(4);
    expect(body.transmission).toBeNull();
    expect(body.errors.some((e) => e.startsWith('RTE IIP'))).toBe(true);
  });
  it('EDF muet, IIP lue : l’arrêt imprévu de l’IIP est servi, readAt posé, EDF non daté, erreur nommée', async () => {
    stubFetch((url) => (url.startsWith('https://opendata.edf.fr') ? respond('panne', 503) : route(url)));
    const body = await ensurePowerFresh(NOW);
    expect(body.unplanned.map((u) => [u.name, u.source, u.lostMw])).toEqual([['CRUAS 1', 'rte', 915]]);
    expect(body.readAt).not.toBeNull();
    expect(body.edfUpdatedAt).toBeNull();
    expect(body.edfReadAt).toBeNull();
    expect(body.planned.every((u) => u.source === 'rte')).toBe(true);
    expect(body.errors.some((e) => e.startsWith('EDF OpenData'))).toBe(true);
  });
  it('tout muet et jamais lu : réponse vide sans date de lecture, jamais « aucun arrêt »', async () => {
    stubFetch(() => respond('panne', 503));
    const body = await ensurePowerFresh(NOW);
    expect(body.readAt).toBeNull();
    expect(body.edfReadAt).toBeNull();
    expect(body.unplanned).toEqual([]);
    expect(body.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('un arrêt compté une fois (P3)', () => {
  const edfUnits = (): ReturnType<typeof normalizeEdfLine>[] => EDF().results.map((l) => normalizeEdfLine(l)).filter((u) => u !== null);
  it('jeu d’essai : une seule ligne REVIN 2 (la plus perdante) et un seul COCHE POMPE (297 MW, pas 57 + 297)', () => {
    const body = buildPower({ edf: edfUnits(), iip: null, sei: [], history: [] }, NOW);
    expect(body.upcoming.filter((u) => u.name === 'REVIN 2')).toHaveLength(1);
    expect(body.planned.filter((u) => u.name === 'COCHE POMPE').map((u) => u.lostMw)).toEqual([297]);
  });
  it('fenêtres disjointes d’une même unité : deux arrêts distincts', () => {
    const base = { sector: 'Nucléaire', nuclear: true, kind: 'planifiee', maxMw: 900, publishedAt: null, cause: null, source: 'edf', lostMw: 900 };
    const units = [
      { ...base, id: 'a', name: 'X 1', start: '2026-10-09T00:00:00.000Z', end: '2026-10-09T05:00:00.000Z' },
      { ...base, id: 'b', name: 'X 1', start: '2026-10-10T00:00:00.000Z', end: '2026-10-10T05:00:00.000Z' },
    ];
    expect(buildPower({ edf: units as never, iip: null, sei: [], history: [] }, NOW).upcoming).toHaveLength(2);
  });
  it('courbe : un point par jour, deux lignes de la même unité le même jour comptées une fois', () => {
    const base = { sector: 'Gaz fossile', nuclear: false, kind: 'imprevue', maxMw: 500, publishedAt: null, cause: null, source: 'edf' };
    const units = [
      { ...base, id: 'a', name: 'Y 1', lostMw: 500, start: '2026-10-01T00:00:00.000Z', end: '2026-10-20T00:00:00.000Z' },
      { ...base, id: 'b', name: 'Y 1', lostMw: 200, start: '2026-10-05T00:00:00.000Z', end: '2026-10-20T00:00:00.000Z' },
    ];
    const history = historyFromEdf(units as never, NOW);
    expect(history).toHaveLength(30);
    expect(new Set(history.map((h) => h.day)).size).toBe(30);
    expect(history.find((h) => h.day === '2026-10-08')?.unplannedMw).toBe(500);
  });
});

describe('cadence et échecs par partie (R28)', () => {
  it('edfReadAt = dernière lecture réussie ; un échec le laisse inchangé, garde les données et retente après 5 min', async () => {
    const log = stubFetch(route);
    const first = await ensurePowerFresh(NOW);
    expect(first.edfReadAt).toBe(new Date(NOW).toISOString());
    const edfCalls = () => log.urls.filter((u) => u.includes('indisponibilites-des-moyens-de-production-edf-sa/lines')).length;
    const callsAfterFirst = edfCalls();
    // 5 min plus tard rien n'est dû : aucun nouvel appel.
    await ensurePowerFresh(NOW + 5 * 60_000);
    expect(edfCalls()).toBe(callsAfterFirst);
    // 16 min plus tard EDF est dû mais en panne : données de la lecture réussie gardées, edfReadAt inchangé, erreur nommée.
    stubFetch((url) => (url.startsWith('https://opendata.edf.fr/data-fair/api/v1/datasets/indisponibilites') ? respond('panne', 503) : route(url)));
    const failedAt = NOW + 16 * 60_000;
    const second = await ensurePowerFresh(failedAt);
    expect(second.edfReadAt).toBe(new Date(NOW).toISOString());
    expect(second.unplanned.map((u) => u.name)).toContain('PALUEL 1');
    expect(second.errors.some((e) => e.startsWith('EDF OpenData'))).toBe(true);
    // 3 min après l'échec : pas de nouvel essai ; 5 min après : nouvel essai, qui réussit.
    const quiet = stubFetch(route);
    await ensurePowerFresh(failedAt + 3 * 60_000);
    expect(quiet.urls.some((u) => u.includes('indisponibilites'))).toBe(false);
    const third = await ensurePowerFresh(failedAt + 5 * 60_000);
    expect(third.edfReadAt).toBe(new Date(failedAt + 5 * 60_000).toISOString());
    expect(third.errors).toEqual([]);
  });
  it('SEI : une île en panne garde son dernier signal et son erreur, sans écraser l’autre', async () => {
    stubFetch(route);
    await ensurePowerFresh(NOW);
    stubFetch((url) => (url.includes('/datasets/ecorsicawatt/') ? respond('panne', 503) : route(url)));
    const body = await ensurePowerFresh(NOW + 31 * 60_000);
    expect(body.islands.map((i) => i.zone).sort()).toEqual(['corse', 'reunion']);
    expect(body.errors.some((e) => e.startsWith('EDF SEI, Corse'))).toBe(true);
  });
  it('IIP en panne après une lecture réussie : production gardée, transport null, erreur nommée', async () => {
    stubFetch(route);
    await ensurePowerFresh(NOW);
    stubFetch((url) => (url.startsWith('https://iip.') ? respond('panne', 503) : route(url)));
    const body = await ensurePowerFresh(NOW + 11 * 60_000);
    expect(body.transmission).toBeNull();
    expect(body.unplanned.map((u) => u.name)).toContain('CRUAS 1');
    expect(body.iipPublishedAt).not.toBeNull();
    expect(body.errors.some((e) => e.startsWith('RTE IIP'))).toBe(true);
  });
});

