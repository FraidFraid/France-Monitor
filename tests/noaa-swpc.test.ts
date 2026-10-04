// tests/noaa-swpc.test.ts : météo spatiale NOAA SWPC (spec 2026-10-04 souveraineté § 3.1 ; contrats § 2.5 ; faits § 5.11) sur les
// réponses réelles du 04/10/2026 : échelles en chaînes, prévisions R et S non publiées gardées nulles, Kp au tiers, dernière alerte
// (casse « Noaa Scale » variable), panne nommée par produit, en-tête FranceMonitor.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSwrCacheForTests } from '../api/_utils/swr-cache.js';
import {
  KP_WINDOW_MS, NOAA_ALERTS_URL, NOAA_KP_URL, NOAA_SCALES_URL, NOAA_TTL_SEC, emptySpaceWeather, loadSpaceWeather, parseAlerts, parseKp,
  parseScales,
} from '../api/_lib/noaa-swpc.js';
import { type FakeResponse, respond, sentHeader, stubFetch } from './helpers/traffic-fixtures.ts';

const fx = (name: string): string => readFileSync(new URL(`./fixtures/sovereignty/${name}`, import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-04T16:48:30+02:00');

function sources(override: (url: string) => FakeResponse | null = () => null) {
  return stubFetch((url) => override(url)
    ?? (url === NOAA_SCALES_URL ? respond(fx('noaa-scales.json')) : url === NOAA_KP_URL ? respond(fx('noaa-planetary-k-index.json'))
      : url === NOAA_ALERTS_URL ? respond(fx('noaa-alerts-reduit.json')) : respond('introuvable', 404)));
}

beforeEach(() => { __resetSwrCacheForTests(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('analyse des produits NOAA', () => {
  it('adresses, cadence de 15 min, fenêtre de 7 jours', () => {
    expect([NOAA_SCALES_URL, NOAA_KP_URL, NOAA_ALERTS_URL]).toEqual([
      'https://services.swpc.noaa.gov/products/noaa-scales.json', 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
      'https://services.swpc.noaa.gov/products/alerts.json',
    ]);
    expect([NOAA_TTL_SEC, KP_WINDOW_MS]).toEqual([900, 7 * 86_400_000]);
  });
  it('échelles : observé du jour (R0 S0 G0 à 14:46 UTC), prévisions datées (la clé « 1 » est le jour même), R et S prévus nuls', () => {
    const s = parseScales(JSON.parse(fx('noaa-scales.json')));
    expect(s.scalesAt).toBe('2026-10-04T14:46:00.000Z');
    expect(s.today).toEqual({ date: '2026-10-04', observed: true, r: 0, s: 0, g: 0, rMinorProb: null, rMajorProb: null, sProb: null });
    expect(s.forecast).toEqual([
      { date: '2026-10-04', observed: false, r: null, s: null, g: 1, rMinorProb: 5, rMajorProb: 1, sProb: 1 },
      { date: '2026-10-05', observed: false, r: null, s: null, g: 0, rMinorProb: 5, rMajorProb: 1, sProb: 1 },
      { date: '2026-10-06', observed: false, r: null, s: null, g: 0, rMinorProb: 5, rMajorProb: 1, sProb: 1 },
    ]);
    expect(() => parseScales({})).toThrow('échelles illisibles (clé « 0 » absente)');
  });
  it('Kp : 60 tranches de 3 h, plus ancienne d’abord, au tiers', () => {
    const kp = parseKp(JSON.parse(fx('noaa-planetary-k-index.json')));
    expect(kp).toHaveLength(60);
    expect([kp[0], kp[59]]).toEqual([{ at: '2026-09-27T00:00:00.000Z', kp: 4 }, { at: '2026-10-04T09:00:00.000Z', kp: 5 }]);
    expect(() => parseKp({ time_tag: 'x' })).toThrow('indice Kp illisible (liste attendue)');
    expect(() => parseKp([])).toThrow('indice Kp illisible (aucune tranche)');
  });
  it('dernière alerte : K05A du 04/10 14:03 UTC, G1, titre de la ligne ALERT', () => {
    expect(parseAlerts(JSON.parse(fx('noaa-alerts-reduit.json'))))
      .toEqual({ productId: 'K05A', issuedAt: '2026-10-04T14:03:28.167Z', title: 'ALERT: Geomagnetic K-index of 5', gScale: 1 });
    expect(parseAlerts([])).toBeNull();
    expect(parseAlerts([{ product_id: 'EF3A', issue_datetime: '2026-10-01 14:30:29.700', message: 'CONTINUED ALERT: Electron 2MeV Integral Flux' }]))
      .toEqual({ productId: 'EF3A', issuedAt: '2026-10-01T14:30:29.700Z', title: 'CONTINUED ALERT: Electron 2MeV Integral Flux', gScale: null });
    expect(() => parseAlerts({ product_id: 'K05A' })).toThrow('alertes illisibles (liste attendue)');
  });
  it('météo spatiale vide : jamais lue, aucune valeur inventée', () => {
    expect(emptySpaceWeather()).toEqual({ readAt: null, scalesAt: null, today: null, forecast: [], kp: [], lastAlert: null });
  });
});

describe('lecture (loadSpaceWeather)', () => {
  it('trois produits lus, chacun avec l’en-tête FranceMonitor ; Kp gardé sur 7 jours (56 tranches à 16:48)', async () => {
    const log = sources();
    const { spaceWeather: sw, errors } = await loadSpaceWeather(NOW);
    expect(errors).toEqual([]);
    expect([sw.readAt, sw.scalesAt, sw.today?.g, sw.forecast.map((d) => d.g), sw.kp.length, sw.lastAlert?.productId])
      .toEqual(['2026-10-04T14:48:30.000Z', '2026-10-04T14:46:00.000Z', 0, [1, 0, 0], 56, 'K05A']);
    expect(sw.kp[0]).toEqual({ at: '2026-09-27T12:00:00.000Z', kp: 1.33 });
    expect(log.urls.sort()).toEqual([NOAA_ALERTS_URL, NOAA_SCALES_URL, NOAA_KP_URL].sort());
    for (const init of log.inits) expect(sentHeader(init, 'User-Agent')).toBe('FranceMonitor/1.0 (+https://www.francemonitor.com)');
  });
  it('échelles en panne : panne nommée, Kp et alerte servis ; Kp en page HTML : panne nommée', async () => {
    sources((url) => (url === NOAA_SCALES_URL ? respond('indisponible', 503) : url === NOAA_KP_URL ? respond('<!doctype html><html><body>maintenance</body></html>') : null));
    const { spaceWeather: sw, errors } = await loadSpaceWeather(NOW);
    expect(errors).toEqual(['NOAA SWPC, échelles : HTTP 503', 'NOAA SWPC, indice Kp : page HTML reçue au lieu de données']);
    expect([sw.today, sw.scalesAt, sw.forecast, sw.kp, sw.lastAlert?.gScale]).toEqual([null, null, [], [], 1]);
    expect(sw.readAt).toBe('2026-10-04T14:48:30.000Z');
  });
  it('les trois produits en panne : météo spatiale vide, trois pannes nommées, jamais une exception', async () => {
    sources(() => respond('indisponible', 503));
    const { spaceWeather: sw, errors } = await loadSpaceWeather(NOW);
    expect(sw).toEqual(emptySpaceWeather());
    expect(errors).toEqual(['NOAA SWPC, échelles : HTTP 503', 'NOAA SWPC, indice Kp : HTTP 503', 'NOAA SWPC, alertes : HTTP 503']);
  });
});
