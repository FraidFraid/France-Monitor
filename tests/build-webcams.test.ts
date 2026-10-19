// tests/build-webcams.test.ts
// scripts/build-webcams.mjs : recensement des webcams sur des réponses simulées, sans réseau : reprise Overpass sur une autre
// instance, balises de vent écartées, points hors France écartés, dédoublonnage (même lien, même source à moins de 30 m, deux images
// distinctes au même point gardées), vivacité (mort → down, refus → unknown, page qui rend une image), règle countable, source en
// échec qui ne bloque pas les autres, et contrat de sortie.
import { describe, expect, it } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  YOUTUBE_LICENSE, fetchYoutube, isYoutubeEntry, youtubeCheckFromOembed, youtubeEmbedUrl,
  applyCheck, buildWebcams, checkLink, cleanUrl, dedupeWebcams, interleaveByHost, isCountable, parseOverpass, serializeDataset,
} from '../scripts/build-webcams.mjs';
import { isWebcamsDataset } from '../src/services/webcams.ts';

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const head = (status: number, type: string): Response => new Response(status === 204 ? null : 'x', { status, headers: { 'content-type': type } });

const OVERPASS = {
  elements: [
    { type: 'node', id: 1, lat: 45.0, lon: 6.0, tags: { 'contact:webcam': 'https://cams.example.org/col-a.jpg', name: 'Col A', man_made: 'surveillance' } },
    // Même lien, 10 m plus loin : doublon.
    { type: 'node', id: 2, lat: 45.00009, lon: 6.0, tags: { 'contact:webcam': 'http://www.cams.example.org/col-a.jpg', man_made: 'surveillance' } },
    // Balise de vent : pas une caméra.
    { type: 'node', id: 3, lat: 45.5, lon: 6.5, tags: { 'contact:webcam': 'https://pioupiou.com/fr/1', man_made: 'monitoring_station' } },
    { type: 'node', id: 4, lat: 46.0, lon: 5.0, tags: { 'contact:webcam': 'https://dead.example.org/cam', name: 'Lac B' } },
    // Autre lien, même source, 15 m de la précédente : doublon.
    { type: 'node', id: 5, lat: 46.000135, lon: 5.0, tags: { 'contact:webcam': 'https://other.example.org/cam' } },
    // Nouvelle-Calédonie : hors des emprises (métropole et DROM).
    { type: 'node', id: 6, lat: -22.3, lon: 166.45, tags: { 'contact:webcam': 'https://nc.example.org/cam' } },
    { type: 'way', id: 7, center: { lat: 44.0, lon: 4.0 }, tags: { 'contact:webcam': 'https://blocked.example.org/cam' } },
    // Point en Suisse (repli par emprise) : aucune commune française, écarté.
    { type: 'node', id: 8, lat: 46.2, lon: 6.15, tags: { 'contact:webcam': 'https://geneve.example.org/cam' } },
    // Texte libre à la place d'un lien : écarté.
    { type: 'node', id: 9, lat: 44.5, lon: 4.5, tags: { 'contact:webcam': 'voir la mairie' } },
    { type: 'node', id: 10, lat: 43.0, lon: 3.0, tags: { 'contact:webcam': 'https://page-image.example.org/live' } },
  ],
};
const LYON = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [4.85, 45.75] }, properties: { nom: 'Perrache', libellelong: 'Tunnel', numeromaintenance: 'C1', url: 'https://download.example.org/C1.JPG' } },
    // Deux images distinctes au même point : deux caméras.
    { type: 'Feature', geometry: { type: 'Point', coordinates: [4.85, 45.75] }, properties: { nom: 'Perrache', libellelong: 'Pont', numeromaintenance: 'C2', url: 'https://download.example.org/C2.JPG' } },
  ],
};

function fakeFetch(): { fetchImpl: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const routes: Array<[RegExp, Handler]> = [
    [/overpass-a\.test/, () => new Response('Bad Gateway', { status: 502 })],
    [/overpass-b\.test/, () => json(OVERPASS)],
    [/data\.gouv\.fr\/api\/1\/datasets\/56ebdc1788ee38517d89c52d/, () => json({
      license: 'lov2', organization: { name: 'Métropole de Lyon' }, resources: [{ format: 'geojson', title: 'cam', url: 'https://lyon.test/cams.geojson' }],
    })],
    [/lyon\.test\/cams\.geojson/, () => json(LYON)],
    [/data\.gouv\.fr\/api\/1\/datasets\//, () => json({ message: 'erreur' }, 500)],
    [/geo\.api\.gouv\.fr/, (url) => (url.includes('lat=46.2&lon=6.15') ? json([]) : json([{ nom: 'Commune test', codeDepartement: '38' }]))],
    [/cams\.example\.org\/col-a\.jpg/, () => head(206, 'image/jpeg')],
    [/dead\.example\.org/, () => head(404, 'text/html')],
    [/blocked\.example\.org/, () => head(403, 'text/html')],
    [/page-image\.example\.org/, () => head(200, 'image/png')],
    [/download\.example\.org\/C1/, () => head(200, 'image/jpeg')],
    [/download\.example\.org\/C2/, () => { throw new TypeError('fetch failed'); }],
  ];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const route = routes.find(([re]) => re.test(url));
    if (!route) throw new Error(`URL inattendue : ${url}`);
    return route[1](url, init);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

async function run() {
  const { fetchImpl, calls } = fakeFetch();
  const result = await buildWebcams({
    fetchImpl, overpassUrls: ['https://overpass-a.test/api/interpreter', 'https://overpass-b.test/api/interpreter'],
    sleep: async () => undefined, log: () => undefined, now: () => new Date('2026-10-18T17:00:00.000Z'), youtubeListUrl: null,
  });
  return { ...result, calls };
}

describe('recensement simulé', () => {
  it('reprise sur la seconde instance Overpass, sources en échec listées sans bloquer les autres', async () => {
    const { dataset, errors, calls } = await run();
    expect(calls.filter((u) => u.includes('overpass-a')).length).toBe(1);
    expect(dataset.sources.map((s: { id: string }) => s.id)).toEqual(['osm', 'grand-lyon']);
    expect(errors.map((e: string) => e.split(' :')[0]).sort()).toEqual(['anglet', 'loire-atlantique', 'orleans']);
    expect(dataset.sources.find((s: { id: string }) => s.id === 'grand-lyon')).toMatchObject({ license: 'Licence Ouverte 2.0', count: 2 });
  });

  it('dédoublonnage, exclusions et états', async () => {
    const { dataset } = await run();
    const ids = dataset.webcams.map((w: { id: string }) => w.id).sort();
    expect(ids).toEqual(['grand-lyon:C1', 'grand-lyon:C2', 'osm:node/1', 'osm:node/10', 'osm:node/4', 'osm:way/7']);
    const by = (id: string) => dataset.webcams.find((w: { id: string }) => w.id === id);
    expect(by('osm:node/1')).toMatchObject({ status: 'ok', httpStatus: 206, contentType: 'image/jpeg', imageUrl: 'https://cams.example.org/col-a.jpg', countable: false });
    expect(by('osm:node/4')).toMatchObject({ status: 'down', httpStatus: 404, name: 'Lac B' });
    expect(by('osm:way/7')).toMatchObject({ status: 'unknown', httpStatus: 403, name: 'Webcam · Commune test', dept: '38' });
    // Une page qui répond par une image devient l'image directe de la webcam.
    expect(by('osm:node/10')).toMatchObject({ imageUrl: 'https://page-image.example.org/live', pageUrl: null, status: 'ok' });
    expect(by('grand-lyon:C1')).toMatchObject({ status: 'ok', countable: true, dept: '69', checkedAt: '2026-10-18T17:00:00.000Z' });
    // Hôte injoignable : lien mort, jamais countable.
    expect(by('grand-lyon:C2')).toMatchObject({ status: 'down', httpStatus: null, countable: false });
  });

  it('sortie conforme au contrat partagé, sans champ interne', async () => {
    const { dataset } = await run();
    const parsed: unknown = JSON.parse(serializeDataset(dataset));
    expect(isWebcamsDataset(parsed)).toBe(true);
    expect(serializeDataset(dataset)).not.toContain('_needsFrance');
  });
});

describe('fonctions du recensement', () => {
  it('liens : texte libre écarté, balises de vent écartées', () => {
    expect(cleanUrl('voir la mairie')).toBeNull();
    expect(cleanUrl(' https://a.example.org/x ; https://b')).toBe('https://a.example.org/x');
    expect(parseOverpass(OVERPASS).map((w: { id: string }) => w.id)).not.toContain('osm:node/3');
  });

  it('countable : image directe vivante ET licence de réutilisation', () => {
    const base = { status: 'ok', imageUrl: 'https://x/a.jpg', contentType: 'image/jpeg', license: 'Licence Ouverte 2.0' };
    expect(isCountable(base)).toBe(true);
    expect(isCountable({ ...base, license: null })).toBe(false);
    expect(isCountable({ ...base, contentType: 'text/html' })).toBe(false);
    expect(isCountable({ ...base, status: 'down' })).toBe(false);
    expect(isCountable({ ...base, imageUrl: null })).toBe(false);
    expect(applyCheck({ ...base, pageUrl: null, status: 'unknown', countable: false }, { status: 'down', httpStatus: 404, contentType: 'text/html' }, 't'))
      .toMatchObject({ status: 'down', countable: false, checkedAt: 't' });
  });

  it('dédoublonnage : même lien générique loin = deux caméras', () => {
    const cam = (id: string, lat: number, url: string) => ({ id, source: 'osm', lat, lon: 2, pageUrl: url, imageUrl: null, name: id });
    const out = dedupeWebcams([cam('a', 45, 'https://site.example.org/'), cam('b', 46, 'https://site.example.org'), cam('c', 45.00001, 'https://site.example.org')]);
    expect(out.map((w: { id: string }) => w.id)).toEqual(['a', 'b']);
  });

  it('vérification : délai dépassé → unknown, en-tête Range, corps abandonné', async () => {
    let seen: RequestInit | undefined;
    const slow = ((_u: string, init?: RequestInit) => {
      seen = init;
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    }) as unknown as typeof fetch;
    await expect(checkLink('https://lent.example.org', slow, 20)).resolves.toEqual({ status: 'unknown', httpStatus: null, contentType: null });
    expect((seen?.headers as Record<string, string>)['Range']).toBe('bytes=0-1023');
  });

  it('hôtes entrelacés pour la vérification', () => {
    const w = (id: string, host: string) => ({ id, imageUrl: null, pageUrl: `https://${host}/${id}` });
    expect(interleaveByHost([w('1', 'a'), w('2', 'a'), w('3', 'b'), w('4', 'a'), w('5', 'b')]).map((x: { id: string }) => x.id)).toEqual(['1', '3', '2', '5', '4']);
  });
});

describe('directs YouTube (liste choisie)', () => {
  const entry = (videoId: string, name: string) => ({ videoId, name, commune: 'Cannes', dept: '06', lat: 43.55, lon: 7.01, position: 'commune' });
  async function list(streams: unknown[]): Promise<URL> {
    const dir = await mkdtemp(join(tmpdir(), 'fm-yt-'));
    const file = join(dir, 'list.json');
    await writeFile(file, JSON.stringify({ streams }));
    return new URL(`file://${file}`);
  }
  const ctxOf = (url: URL, fetchImpl: Handler, youtubeKey: string | null = null) => ({
    youtubeListUrl: url, youtubeKey, now: () => new Date('2026-10-19T08:00:00.000Z'), log: () => undefined,
    fetchImpl: async (u: string | URL | Request, init?: RequestInit) => fetchImpl(String(u), init),
  });

  it('entrées valides seulement, état selon l’oEmbed', () => {
    expect(isYoutubeEntry(entry('z6BNMoj9Pyo', 'Cannes'))).toBe(true);
    expect(isYoutubeEntry(entry('trop-court', 'x'))).toBe(false);
    expect(isYoutubeEntry({ ...entry('z6BNMoj9Pyo', 'x'), lat: Number.NaN })).toBe(false);
    expect([200, 401, 403, 404, 500].map(youtubeCheckFromOembed)).toEqual(['ok', 'down', 'down', 'down', 'unknown']);
    expect(youtubeEmbedUrl('z6BNMoj9Pyo')).toBe('https://www.youtube-nocookie.com/embed/z6BNMoj9Pyo');
  });

  it('webcam au contrat : lecteur youtube-nocookie, jamais countable, intégration refusée = down', async () => {
    const url = await list([entry('z6BNMoj9Pyo', 'Cannes · Boulevard du Midi'), entry('YkKGantlWH0', 'Refusée'), { bad: true }]);
    const out = await fetchYoutube(ctxOf(url, (u) => u.includes('YkKGantlWH0') ? head(401, 'text/html') : json({ author_name: 'Mairie' })));
    const ok = out.find((w: { id: string }) => w.id === 'youtube:z6BNMoj9Pyo');
    expect(out).toHaveLength(2);
    expect(ok).toMatchObject({
      source: 'youtube', status: 'ok', httpStatus: 200, imageUrl: null, countable: false, license: YOUTUBE_LICENSE,
      streamUrl: 'https://www.youtube-nocookie.com/embed/z6BNMoj9Pyo', pageUrl: 'https://www.youtube.com/watch?v=z6BNMoj9Pyo',
      attribution: '© Mairie (YouTube)', commune: 'Cannes', dept: '06',
    });
    expect(out.find((w: { id: string }) => w.id === 'youtube:YkKGantlWH0')).toMatchObject({ status: 'down', httpStatus: 401 });
  });

  it('avec clé : un direct terminé passe en down', async () => {
    const url = await list([entry('z6BNMoj9Pyo', 'En direct'), entry('xsUGUMAFc-I', 'Terminé')]);
    const out = await fetchYoutube(ctxOf(url, (u) => u.includes('googleapis.com')
      ? json({ items: [{ id: 'z6BNMoj9Pyo', snippet: { liveBroadcastContent: 'live' } }, { id: 'xsUGUMAFc-I', snippet: { liveBroadcastContent: 'none' } }] })
      : json({ author_name: 'X' }), 'cle'));
    expect(Object.fromEntries(out.map((w: { id: string; status: string }) => [w.id, w.status]))).toEqual({
      'youtube:z6BNMoj9Pyo': 'ok', 'youtube:xsUGUMAFc-I': 'down',
    });
  });
});
