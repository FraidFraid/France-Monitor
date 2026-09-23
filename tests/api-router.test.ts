import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
// @ts-expect-error — module JS sans déclaration de types
import { dispatch, resolveRoute, toQueryObject } from '../api/_utils/dispatch.js';
// @ts-expect-error — module JS sans déclaration de types
import { ROUTES, ALIASES } from '../api/_routes.js';
// @ts-expect-error — script .mjs sans déclaration de types
import { buildRoutesSource } from '../scripts/generate-api-routes.mjs';

const ROOT = join(__dirname, '..');

type Headers = Record<string, string | string[]>;
function mockRes() {
  const headers: Headers = {};
  const res = {
    statusCode: 200,
    headersSent: false,
    body: undefined as unknown,
    setHeader(k: string, v: string | string[]) { headers[k.toLowerCase()] = v; },
    getHeader(k: string) { return headers[k.toLowerCase()]; },
    end(b?: unknown) { res.body = b; res.headersSent = true; },
    status(code: number) { res.statusCode = code; return res; },
    json(obj: unknown) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); return res; },
    headers,
  };
  return res;
}

function listFunctionFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name.startsWith('_') || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) listFunctionFiles(p, out);
    else if (/\.(js|ts)$/.test(name)) out.push(relative(ROOT, p));
  }
  return out;
}

describe('table de routes API', () => {
  it('est à jour (npm run generate:api-routes)', () => {
    expect(readFileSync(join(ROOT, 'api/_routes.js'), 'utf8')).toBe(buildRoutesSource());
  });

  it('reste sous la limite de 12 fonctions du palier Hobby', () => {
    const functions = listFunctionFiles(join(ROOT, 'api'));
    expect(functions.sort()).toEqual(['api/fuel-price-series-refresh.js', 'api/index.js', 'api/ingest/news.ts', 'api/sentinel-ndwi.ts']);
    expect(functions.length).toBeLessThanOrEqual(12);
  });

  it('vercel.json ne référence que des fichiers de fonction existants', () => {
    const cfg = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8')) as {
      functions: Record<string, unknown>;
      crons: { path: string; schedule: string }[];
      rewrites: { source: string; destination: string }[];
    };
    for (const file of Object.keys(cfg.functions)) expect(existsSync(join(ROOT, file)), file).toBe(true);
    // Palier Hobby : une exécution par jour au plus (champs minute et heure fixes).
    for (const cron of cfg.crons) expect(cron.schedule, cron.path).toMatch(/^\d{1,2} \d{1,2} \* \* \*$/);
    // La réécriture API doit précéder le repli SPA.
    const apiIdx = cfg.rewrites.findIndex((r) => r.source === '/api/(.*)');
    const spaIdx = cfg.rewrites.findIndex((r) => r.source === '/(.*)');
    expect(apiIdx).toBeGreaterThanOrEqual(0);
    expect(apiIdx).toBeLessThan(spaIdx);
  });

  it('chaque route charge un module avec un handler par défaut', async () => {
    const entries = Object.entries(ROUTES as Record<string, () => Promise<{ default?: unknown }>>);
    expect(entries.length).toBeGreaterThan(40);
    for (const [route, load] of entries) {
      const mod = await load();
      expect(typeof mod.default, route).toBe('function');
    }
    for (const target of Object.values(ALIASES as Record<string, string>)) expect(ROUTES).toHaveProperty(target);
  }, 60_000);
});

describe('resolveRoute', () => {
  const routes = { '/api/news': async () => ({}), '/api/news/history': async () => ({}), '/api/citizen-outages': async () => ({}) };
  const aliases = { '/api/outages/citizen': '/api/citizen-outages' };

  it('accepte l’URL d’origine', () => {
    const r = resolveRoute('/api/news/history?bucket=day', routes, aliases);
    expect(r.canonical).toBe('/api/news/history');
    expect(r.search).toBe('?bucket=day');
    expect(r.load).not.toBeNull();
  });

  it('accepte la destination réécrite et retire le paramètre technique', () => {
    const r = resolveRoute('/api?__fmroute=news%2Fhistory&bucket=day', routes, aliases);
    expect(r.canonical).toBe('/api/news/history');
    expect(r.search).toBe('?bucket=day');
  });

  it('retire le paramètre technique même quand le chemin d’origine est conservé', () => {
    const r = resolveRoute('/api/news?since=x&__fmroute=news', routes, aliases);
    expect(r.canonical).toBe('/api/news');
    expect(r.search).toBe('?since=x');
  });

  it('résout les alias historiques', () => {
    expect(resolveRoute('/api/outages/citizen', routes, aliases).canonical).toBe('/api/citizen-outages');
  });

  it('renvoie load=null pour une route inconnue', () => {
    expect(resolveRoute('/api/ministers/agenda', routes, aliases).load).toBeNull();
  });

  it('reproduit la forme de req.query de Vercel', () => {
    expect(toQueryObject(new URLSearchParams('a=1&b=2&a=3'))).toEqual({ a: ['1', '3'], b: '2' });
  });
});

describe('dispatch', () => {
  it('répond 404 JSON sur une route inconnue', async () => {
    const res = mockRes();
    await dispatch({ url: '/api/inconnue', headers: {} }, res, { routes: {}, aliases: {} });
    expect(res.statusCode).toBe(404);
    expect(String(res.headers['content-type'])).toContain('application/json');
  });

  it('appelle un handler Node avec req.url et req.query normalisés', async () => {
    const handler = vi.fn(async (req: { url: string; query: unknown }, res: ReturnType<typeof mockRes>) => {
      res.status(200).json({ url: req.url, query: req.query });
    });
    const res = mockRes();
    const req = { url: '/api?__fmroute=news&since=2026&limit=5', headers: {}, query: { __fmroute: 'news', since: '2026' } };
    await dispatch(req, res, { routes: { '/api/news': async () => ({ default: handler }) }, aliases: {} });
    expect(handler).toHaveBeenCalledOnce();
    expect(JSON.parse(String(res.body))).toEqual({ url: '/api/news?since=2026&limit=5', query: { since: '2026', limit: '5' } });
  });

  it('adapte un handler « edge » Request → Response, corps POST compris', async () => {
    const handler = vi.fn(async (request: Request) => {
      const payload = await request.json() as { text: string };
      const url = new URL(request.url);
      return new Response(JSON.stringify({ echo: payload.text, lang: url.searchParams.get('lang'), host: url.host }), {
        status: 201,
        headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip', 'Cache-Control': 's-maxage=60' },
      });
    });
    const res = mockRes();
    const req = {
      url: '/api/intelligence/v1/summarize?lang=fr',
      method: 'POST',
      headers: { host: 'www.francemonitor.com', 'x-forwarded-proto': 'https', 'content-type': 'application/json', connection: 'keep-alive' },
      body: { text: 'bonjour' },
    };
    await dispatch(req, res, {
      routes: { '/api/intelligence/v1/summarize': async () => ({ default: handler, config: { runtime: 'edge' } }) },
      aliases: {},
    });
    expect(res.statusCode).toBe(201);
    expect(res.headers['cache-control']).toBe('s-maxage=60');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(JSON.parse(String(res.body))).toEqual({ echo: 'bonjour', lang: 'fr', host: 'www.francemonitor.com' });
  });

  it('transforme une exception du handler en 500 JSON', async () => {
    const res = mockRes();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await dispatch({ url: '/api/boom', headers: {} }, res, {
      routes: { '/api/boom': async () => ({ default: async () => { throw new Error('boom'); } }) },
      aliases: {},
    });
    spy.mockRestore();
    expect(res.statusCode).toBe(500);
  });
});
