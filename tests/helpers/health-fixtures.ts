// tests/helpers/health-fixtures.ts : réponses réelles des sources de santé (enregistrées le 03/10/2026,
// tests/fixtures/health/) et doublures de fetch et de réponse HTTP pour les gestionnaires api/_handlers/health/*.
import { readFileSync } from 'node:fs';
import { vi } from 'vitest';

export function fixtureText(name: string): string {
  return readFileSync(new URL(`../fixtures/health/${name}`, import.meta.url), 'utf8');
}

export function fixtureJson<T>(name: string): T {
  return JSON.parse(fixtureText(name)) as T;
}

export interface FakeResponse { ok: boolean; status: number; text(): Promise<string> }

/** Réponse simulée : corps texte (ou objet sérialisé en JSON) et statut HTTP. */
export function respond(body: string | object, status = 200): FakeResponse {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text };
}

/** Remplace fetch : `route(url)` donne la réponse ; URL et options de chaque appel sont gardées. */
export function stubFetch(route: (url: string) => FakeResponse | Promise<FakeResponse>): { urls: string[]; inits: Array<RequestInit | undefined> } {
  const urls: string[] = [];
  const inits: Array<RequestInit | undefined> = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    urls.push(String(url));
    inits.push(init);
    return route(String(url));
  }));
  return { urls, inits };
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

/** Plus grand `limit` envoyé (0 si aucun) : la règle Opendatasoft interdit plus de 100. */
export function maxLimitSent(urls: readonly string[]): number {
  return Math.max(0, ...urls.map((u) => Number(new URL(u).searchParams.get('limit') ?? 0)));
}
