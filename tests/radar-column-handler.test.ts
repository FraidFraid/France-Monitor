// Route /api/fire-observations/radar-column (spec 2026-10-04 environnement § 2.3, contrat § 2.5) : la colonne est lue à côté
// du manifeste du worker (répertoire du manifeste + « volume/column »), en production (VM) comme en dev, où l'URL du manifeste
// pointe sur la production. Réponse réelle de la production enregistrée le 04/10/2026 (station de Nîmes, 53,6 km).
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import handler, { columnEndpoint } from '../api/_handlers/fire-observations/radar-column.js';

const fx = (name: string): string => readFileSync(new URL(`./fixtures/environment/${name}`, import.meta.url), 'utf8');
const PROD_MANIFEST = 'https://www.francemonitor.com/radar/manifest.json';
const VM_MANIFEST = 'http://localhost:8091/manifest.json';

interface Captured { status: number; headers: Record<string, string>; body: unknown }

/** Appelle le gestionnaire (il lit `req.url` et écrit par `res.end(texte)`, sans les aides de Vercel). */
async function call(url: string): Promise<Captured> {
  const out: Captured = { status: 0, headers: {}, body: undefined };
  const res = {
    statusCode: 0,
    setHeader(key: string, value: string) { out.headers[key] = value; },
    end(text?: string) { out.status = res.statusCode; out.body = text === undefined ? undefined : JSON.parse(text) as unknown; },
  };
  await handler({ method: 'GET', url }, res);
  return out;
}

function upstream(body: string, status = 200, contentType = 'application/json'): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => new Response(body, { status, headers: { 'Content-Type': contentType } }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('URL de la colonne, relative au manifeste', () => {
  it('VM : à la racine du worker ; production : sous /radar (l’origine seule servirait la page HTML de l’application)', () => {
    expect(columnEndpoint(VM_MANIFEST)?.href).toBe('http://localhost:8091/volume/column');
    expect(columnEndpoint(PROD_MANIFEST)?.href).toBe('https://www.francemonitor.com/radar/volume/column');
  });
  it('URL non sûre : null', () => {
    expect(columnEndpoint('http://worker.example.test/manifest.json')).toBeNull();
    expect(columnEndpoint('https://user:secret@worker.example.test/manifest.json')).toBeNull();
    expect(columnEndpoint('pas une url')).toBeNull();
  });
});

describe('GET /api/fire-observations/radar-column', () => {
  it('manifeste de production : colonne lue sous /radar, profil validé (Nîmes, 53,6 km, 5 niveaux)', async () => {
    vi.stubEnv('METEO_FRANCE_RADAR_MANIFEST_URL', PROD_MANIFEST);
    const fetchMock = upstream(fx('radar-column-prod.json'));
    const r = await call('/api/fire-observations/radar-column?lat=43.6&lon=3.9');
    expect(fetchMock).toHaveBeenCalledWith('https://www.francemonitor.com/radar/volume/column?lat=43.6000&lon=3.9000', expect.objectContaining({ redirect: 'error' }));
    expect(r.status).toBe(200);
    expect(r.headers['Cache-Control']).toBe('public, s-maxage=120');
    expect(r.body).toMatchObject({ station: { id: 49, name: 'NIMES' }, distanceKm: 53.6, observedAt: '2026-10-04T09:30:00Z' });
    expect((r.body as { levels: unknown[] }).levels).toHaveLength(5);
  });
  it('manifeste de la VM : colonne à la racine du worker', async () => {
    vi.stubEnv('METEO_FRANCE_RADAR_MANIFEST_URL', VM_MANIFEST);
    const fetchMock = upstream(fx('radar-column-prod.json'));
    await call('/api/fire-observations/radar-column?lat=44.88&lon=-1.12');
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:8091/volume/column?lat=44.8800&lon=-1.1200', expect.anything());
  });
  it('page HTML de l’application à la place du JSON : 502', async () => {
    vi.stubEnv('METEO_FRANCE_RADAR_MANIFEST_URL', PROD_MANIFEST);
    upstream('<!DOCTYPE html><html lang="fr"><head></head></html>', 200, 'text/html; charset=utf-8');
    expect((await call('/api/fire-observations/radar-column?lat=43.6&lon=3.9')).status).toBe(502);
  });
  it('hors couverture (réponse réelle du worker, HTTP 404) : 404 hors_couverture', async () => {
    vi.stubEnv('METEO_FRANCE_RADAR_MANIFEST_URL', PROD_MANIFEST);
    upstream('{"detail":{"error":"hors_couverture","nearestStationId":56,"nearestStationKm":343.3}}', 404);
    const r = await call('/api/fire-observations/radar-column?lat=51.4&lon=-5.9');
    expect([r.status, r.body]).toEqual([404, { error: 'hors_couverture' }]);
  });
  it('non configuré : 200 configured:false ; URL non sûre : 503 ; hors métropole : 400 ; aucun appel', async () => {
    const fetchMock = upstream('{}');
    vi.stubEnv('METEO_FRANCE_RADAR_MANIFEST_URL', '');
    expect((await call('/api/fire-observations/radar-column?lat=43.6&lon=3.9')).body).toEqual({ configured: false });
    vi.stubEnv('METEO_FRANCE_RADAR_MANIFEST_URL', 'http://worker.example.test/manifest.json');
    expect((await call('/api/fire-observations/radar-column?lat=43.6&lon=3.9')).status).toBe(503);
    vi.stubEnv('METEO_FRANCE_RADAR_MANIFEST_URL', PROD_MANIFEST);
    expect((await call('/api/fire-observations/radar-column?lat=55&lon=3.9')).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
