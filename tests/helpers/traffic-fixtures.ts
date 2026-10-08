// tests/helpers/traffic-fixtures.ts : réponses réelles des sources de trafic (enregistrées le 03/10/2026,
// tests/fixtures/traffic/) et doublures de fetch (avec en-têtes de réponse) pour api/_handlers/traffic/* et transport/*.
import { readFileSync } from 'node:fs';
import { vi } from 'vitest';

export function fixtureText(name: string): string {
  return readFileSync(new URL(`../fixtures/traffic/${name}`, import.meta.url), 'utf8');
}

export function fixtureJson<T>(name: string): T {
  return JSON.parse(fixtureText(name)) as T;
}

export interface FakeResponse { ok: boolean; status: number; headers: { get(name: string): string | null }; text(): Promise<string>; json(): Promise<unknown> }

/** Réponse simulée : corps texte (ou objet sérialisé en JSON), statut HTTP et en-têtes de réponse. */
export function respond(body: string | object, status = 200, headers: Record<string, string> = {}): FakeResponse {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => lower.get(name.toLowerCase()) ?? null },
    text: async () => text,
    json: async () => JSON.parse(text) as unknown,
  };
}

export interface FetchLog { urls: string[]; inits: Array<RequestInit | undefined> }

/** Remplace fetch : `route(url, init)` donne la réponse ; URL et options de chaque appel sont gardées. */
export function stubFetch(route: (url: string, init?: RequestInit) => FakeResponse | Promise<FakeResponse>): FetchLog {
  const log: FetchLog = { urls: [], inits: [] };
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
    log.urls.push(String(url));
    log.inits.push(init);
    return route(String(url), init);
  }));
  return log;
}

/** En-tête envoyé lors d'un appel (insensible à la casse). */
export function sentHeader(init: RequestInit | undefined, name: string): string | undefined {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : undefined;
}

export interface FakeRes {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  setHeader(key: string, value: string): void;
  status(code: number): FakeRes;
  json(body: unknown): FakeRes;
  end(): FakeRes;
}

export function fakeRes(): FakeRes {
  const res: FakeRes = {
    statusCode: 0,
    body: undefined,
    headers: {},
    setHeader(key, value) { res.headers[key] = value; },
    status(code) { res.statusCode = code; return res; },
    json(body) { res.body = body; return res; },
    end() { return res; },
  };
  return res;
}

/** Appelle un gestionnaire Node (req, res) en GET avec `query` et rend statut, corps et Cache-Control. */
export async function callHandler<T>(
  handler: (req: { method: string; query: Record<string, string> }, res: FakeRes) => Promise<void>,
  query: Record<string, string> = {},
): Promise<{ status: number; body: T; cache: string | undefined }> {
  const res = fakeRes();
  await handler({ method: 'GET', query }, res);
  return { status: res.statusCode, body: res.body as T, cache: res.headers['Cache-Control'] };
}
