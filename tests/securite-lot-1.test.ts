// tests/securite-lot-1.test.ts
// Audit de sécurité du 13/11/2026, lot 1 : limite de débit non contournable par X-Forwarded-For, rafraîchissement carburants
// fermé sans jeton, proxys qui ne servent jamais de document actif sous notre origine, /api/rss sans redirection libre,
// relais AIS fermé aux sites tiers, liens d'articles http(s) seulement.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getClientIp } from '../api/_utils/rate-limit.js';
import { inertContentType } from '../api/_utils/safe-fetch.js';
import oilProxy from '../api/_handlers/oil-proxy.js';
import rssHandler from '../api/_handlers/rss.js';
import refresh from '../api/fuel-price-series-refresh.js';
import { isRelayOriginAllowed } from '../ais-relay.js';
import { httpLink, mapJsonProxyItem } from '../src/services/rss.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const req = (headers: Record<string, string>) => new Request('https://francemonitor.test/api/x', { headers });

describe('adresse du client pour la limite de débit', () => {
  it('cf-connecting-ip passe avant un X-Forwarded-For fourni par le client', () => {
    expect(getClientIp(req({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9', 'cf-connecting-ip': '203.0.113.9' }))).toBe('203.0.113.9');
  });
  it('hors Cloudflare : premier élément de X-Forwarded-For', () => {
    expect(getClientIp(req({ 'x-forwarded-for': '198.51.100.7, 10.0.0.1' }))).toBe('198.51.100.7');
  });
  it('un texte libre ne devient pas une clé', () => {
    expect(getClientIp(req({ 'x-forwarded-for': 'n-importe-quoi:{}' }))).toBe('unknown');
  });
});

describe('type MIME relayé par les proxys', () => {
  it('HTML, XHTML, SVG, XML et JavaScript deviennent du texte brut', () => {
    for (const type of ['text/html', 'application/xhtml+xml', 'image/svg+xml', 'application/xml; charset=iso-8859-1', 'text/javascript']) {
      expect(inertContentType(type)).toMatch(/^text\/plain; charset=/);
    }
    expect(inertContentType('application/xml; charset=iso-8859-1')).toBe('text/plain; charset=iso-8859-1');
  });
  it('JSON, CSV, zip passent tels quels', () => {
    for (const type of ['application/json', 'text/csv; charset=utf-8', 'application/zip']) expect(inertContentType(type)).toBe(type);
  });
  it('proxy pétrole : une page HTML amont sort en texte brut, sous bac à sable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<script>alert(1)</script>', { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })));
    const r = await oilProxy(new Request(`https://francemonitor.test/api/oil-proxy?url=${encodeURIComponent('https://www.insee.fr/fr/statistiques/2119697')}`));
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('content-security-policy')).toContain('sandbox');
  });
});

describe('/api/rss', () => {
  const call = (target: string) => rssHandler(new Request(`https://francemonitor.test/api/rss?url=${encodeURIComponent(target)}`));
  it('une redirection vers une adresse interne est refusée, jamais suivie', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/opc/v1/instance/' } }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await call('https://www.lemonde.fr/rss/une.xml');
    expect(r.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('un flux autorisé est lu', async () => {
    const xml = '<rss><channel><item><title>Titre</title><link>https://www.lemonde.fr/a</link></item></channel></rss>';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(xml, { status: 200, headers: { 'content-type': 'application/rss+xml' } })));
    const r = await call('https://www.lemonde.fr/rss/une.xml');
    expect(r.status).toBe(200);
    expect(((await r.json()) as { items: unknown[] }).items).toHaveLength(1);
  });
});

describe('/api/fuel-price-series-refresh', () => {
  const run = async (headers: Record<string, string>, url = '/api/fuel-price-series-refresh') => {
    let status = 0;
    const res = { status(code: number) { status = code; return res; }, json() { return res; }, setHeader() {} };
    await refresh({ method: 'GET', url, headers }, res);
    return status;
  };
  it("l'en-tête x-vercel-cron seul n'ouvre plus la route", async () => {
    vi.stubEnv('CRON_SECRET', 'secret-de-test');
    expect(await run({ 'x-vercel-cron': '1' })).toBe(401);
  });
  it("le secret en paramètre d'URL n'est plus accepté", async () => {
    vi.stubEnv('CRON_SECRET', 'secret-de-test');
    expect(await run({ host: 'francemonitor.test' }, '/api/fuel-price-series-refresh?secret=secret-de-test')).toBe(401);
  });
  it('mauvais jeton refusé', async () => {
    vi.stubEnv('CRON_SECRET', 'secret-de-test');
    expect(await run({ authorization: 'Bearer autre-chose-xx' })).toBe(401);
  });
});

describe('relais AIS : origine du WebSocket', () => {
  it('le site et le poste de développement passent, un site tiers non', () => {
    expect(isRelayOriginAllowed('https://www.francemonitor.com')).toBe(true);
    expect(isRelayOriginAllowed('http://localhost:3001')).toBe(true);
    expect(isRelayOriginAllowed(undefined)).toBe(true);
    expect(isRelayOriginAllowed('https://exemple-tiers.test')).toBe(false);
    expect(isRelayOriginAllowed('https://www.francemonitor.com.exemple-tiers.test')).toBe(false);
  });
});

describe("liens d'articles", () => {
  it('http(s) seulement', () => {
    expect(httpLink(' https://www.lemonde.fr/a ')).toBe('https://www.lemonde.fr/a');
    expect(httpLink('javascript:alert(1)')).toBe('');
    expect(httpLink('data:text/html,x')).toBe('');
  });
  it('un article au lien javascript: est écarté', () => {
    const feed = { name: 'Test', url: 'https://www.lemonde.fr/rss', region: 'national' } as Parameters<typeof mapJsonProxyItem>[1];
    expect(mapJsonProxyItem({ title: 'Titre', link: 'javascript:alert(1)' }, feed)).toBeNull();
  });
});
