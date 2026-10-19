// tests/flux-pietons.test.ts : couche Flux piétons (prévisions flux_osint) : garde du contrat, 404 = rien de publié, repli HTML
// refusé, nom de fichier sûr, niveaux de saturation, événement par défaut, objets de carte par phase (échappés), panneau toujours
// marqué ESTIMATIONS MODÉLISÉES, légende, câblage dans App.ts et ses déclarations, route Caddy de production.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { FluxEvent, FluxIndex } from '../src/types/index.ts';
import {
  EMPTY_FLUX_INDEX, FLUX_FLUIDE_HEX, FLUX_WARNING, defaultFluxEvent, fetchFluxEvent, fetchFluxIndex, parseFluxGeojson, parseFluxIndex,
  resetFluxCache, saturationBand,
} from '../src/services/flux-pietons.ts';
import { levelHex } from '../src/services/vigilance.ts';
import { FLUX_LAYERS, fluxFeatures } from '../src/components/deckgl/flux-pietons-map.ts';
import { buildFluxView, eventTiming } from '../src/components/layer-panel/flux-pietons.ts';
import { FLUX_LEGEND, fluxLegend } from '../src/components/layer-panel/flux-pietons-legend.ts';
import { ALL_PRESETABLE_LAYER_KEYS, THEME_LAYERS } from '../src/config/layer-presets.ts';

const EV: FluxEvent = {
  id: 'presse_43_650_0_583_2026_10_17', evenement: 'presse:43.650,0.583:2026-10-17', ville: 'Auch', codeInsee: '32013',
  debut: '2026-10-17T10:52:00.000Z', lieu: 'Place de la Libération, 32000 Auch', lieuSuppose: true, point: [0.5857, 43.6459],
  affluence: { p10: 5, p50: 243, p90: 2330, base: 'modèle d’affluence' }, meteo: 'beau', recale: false, cortege: false,
  calculeLe: '2026-10-18T17:01:26+00:00', fichier: 'presse_43_650_0_583_2026_10_17.geojson',
  resume: { troncons: 412, satures: 3, goulots: 0, topRues: [{ rue: 'Rue <Dessoles>', chargeP90: 812, densiteP90: 0.42, pSaturation: 0.3 }] },
};
const INDEX: FluxIndex = { version: 1, generatedAt: '2026-10-19T08:00:00+00:00', avertissement: FLUX_WARNING, methode: 'Monte-Carlo', evenements: [EV] };
const res = (body: string, status = 200, type = 'application/json'): Response => new Response(body, { status, headers: { 'content-type': type } });
const open = (_id: string, byDefault: boolean): boolean => byDefault;

describe('service', () => {
  it('garde : événement mal formé écarté, index mal formé rejeté', () => {
    expect(parseFluxIndex(INDEX)?.evenements).toHaveLength(1);
    expect(parseFluxIndex({ ...INDEX, evenements: [EV, { ...EV, fichier: '../../etc/passwd' }, { ...EV, point: [0] }] })?.evenements).toHaveLength(1);
    expect(parseFluxIndex({ ...INDEX, version: 2 })).toBeNull();
    expect(parseFluxIndex('x')).toBeNull();
    expect(parseFluxIndex({ ...INDEX, avertissement: '' })?.avertissement).toBe(FLUX_WARNING);
    expect(parseFluxIndex({ ...INDEX, evenements: [{ ...EV, codeInsee: null }] })?.evenements).toHaveLength(1);
  });
  it('404 = rien de publié ; page HTML du repli = erreur ; jamais de cache', async () => {
    const calls: RequestInit[] = [];
    const f404 = (async (_u: unknown, init?: RequestInit) => { calls.push(init ?? {}); return res('', 404); }) as typeof fetch;
    expect(await fetchFluxIndex(f404)).toEqual(EMPTY_FLUX_INDEX);
    expect(calls[0].cache).toBe('no-store');
    await expect(fetchFluxIndex((async () => res('<!doctype html>', 200, 'text/html')) as typeof fetch)).rejects.toThrow('non JSON');
    await expect(fetchFluxIndex((async () => res('{}')) as typeof fetch)).rejects.toThrow('mal formé');
    expect((await fetchFluxIndex((async () => res(JSON.stringify(INDEX))) as typeof fetch)).evenements[0].id).toBe(EV.id);
  });
  it('GeoJSON : nom de fichier sûr, objets inconnus écartés, échec non mémorisé', async () => {
    resetFluxCache();
    await expect(fetchFluxEvent({ fichier: '../x.geojson', calculeLe: 'a' })).rejects.toThrow('refusé');
    expect(parseFluxGeojson({ features: [
      { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { kind: 'troncon' } },
      { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { kind: 'autre' } },
    ] })).toHaveLength(1);
    let n = 0;
    const flaky = (async () => { n += 1; return n === 1 ? res('', 500) : res(JSON.stringify({ features: [] })); }) as typeof fetch;
    await expect(fetchFluxEvent(EV, flaky)).rejects.toThrow('500');
    expect(await fetchFluxEvent(EV, flaky)).toEqual([]);
  });
  it('saturation : cyan sous 10 %, puis L1', () => {
    expect([0, 0.09, 0.1, 0.25, 0.5, 1].map(saturationBand)).toEqual(['fluide', 'fluide', 'jaune', 'orange', 'rouge', 'rouge']);
  });
  it('événement par défaut : le prochain à venir, sinon le plus récent', () => {
    const now = Date.parse('2026-10-19T08:00:00Z');
    const past = { ...EV, id: 'a', debut: '2026-10-05T10:00:00Z' };
    const recent = { ...EV, id: 'b', debut: '2026-10-17T10:00:00Z' };
    const soon = { ...EV, id: 'c', debut: '2026-10-21T10:00:00Z' };
    const later = { ...EV, id: 'd', debut: '2026-11-01T10:00:00Z' };
    expect(defaultFluxEvent([past, later, soon, recent], now)?.id).toBe('c');
    expect(defaultFluxEvent([past, recent], now)?.id).toBe('b');
    expect(defaultFluxEvent([], now)).toBeNull();
    expect(eventTiming(soon, now)).toBe('à venir');
    expect(eventTiming(past, now)).toBe('passé');
  });
});

describe('carte', () => {
  const seg = (props: Record<string, unknown>) => ({ type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates: [[0, 0], [1, 1]] }, properties: { kind: 'troncon', ...props } });
  const list = [
    seg({ rue: '<b>Rue</b>', chargeP90: 50, pSaturation: 0.6, chargeDepartP90: 0, pSaturationDepart: 0, largeur: 6 }),
    seg({ rue: 'Rue B', chargeP90: 0.2, pSaturation: 0, chargeDepartP90: 30, pSaturationDepart: 0.05, largeur: 4 }),
    { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [0, 0] }, properties: { kind: 'rassemblement' } },
  ];
  it('phase arrivée / dispersion : rues sans passage retirées, couleur par saturation, infobulle échappée et marquée estimation', () => {
    const arr = fluxFeatures(list, 'arrivee').features;
    expect(arr).toHaveLength(2);
    expect(arr[0].properties?.['color']).toBe(levelHex('rouge'));
    expect(String(arr[0].properties?.['body'])).toContain('&lt;b&gt;Rue&lt;/b&gt;');
    expect(String(arr[0].properties?.['body'])).toContain('estimation modélisée');
    const dep = fluxFeatures(list, 'depart').features;
    expect(dep.map((f) => f.properties?.['color'])).toEqual([FLUX_FLUIDE_HEX, undefined]);
    expect(fluxFeatures(null, 'arrivee').features).toEqual([]);
  });
  it('couches masquées au départ', () => {
    expect(FLUX_LAYERS.every((l) => (l.layout as { visibility?: string } | undefined)?.visibility === 'none')).toBe(true);
  });
});

describe('panneau et légende', () => {
  const now = Date.parse('2026-10-19T08:00:00Z');
  const view = (over: Partial<Parameters<typeof buildFluxView>[0]>) => buildFluxView({ index: INDEX, error: null, selectedId: null, phase: 'arrivee', geo: 'ready', open, nowMs: now, ...over });
  const html = (v: ReturnType<typeof buildFluxView>): string => (v.bodyHtml ?? '') + v.sections.map((s) => s.html).join('');
  it('toujours ESTIMATIONS MODÉLISÉES ; affluence médiane, fourchette, lieu supposé dit', () => {
    const v = view({});
    expect(v.head.status).toContain('ESTIMATIONS MODÉLISÉES');
    expect(v.bodyHtml).toContain('ESTIMATIONS MODÉLISÉES');
    expect(v.head.figure?.value).toBe('≈ 243');
    expect(html(v)).toContain('lieu habituel supposé');
    expect(html(v)).toContain('5 à 2');
    expect(html(v)).toContain('Rue &lt;Dessoles&gt;');
    expect(html(v)).toContain('data-flux-event="presse_43_650_0_583_2026_10_17"');
    expect(v.tabs?.map((t) => t.id)).toEqual(['arrivee', 'depart']);
  });
  it('rien de publié, illisible, chargement', () => {
    const empty = view({ index: { ...INDEX, evenements: [] } });
    expect(html(empty)).toContain('Aucune prévision publiée');
    expect(empty.bodyHtml).toContain('ESTIMATIONS MODÉLISÉES');
    expect(view({ index: null, error: 'x' }).head.figure?.value).toBe('n.d.');
    expect(view({ index: null }).head.status).toEqual(['chargement…']);
    expect(html(view({ geo: 'error' }))).toContain('illisible');
  });
  it('légende datée, avertissement en note', () => {
    expect(FLUX_LEGEND.notes).toContain(FLUX_WARNING);
    expect(fluxLegend(INDEX).notes?.[0]).toContain('1 prévision');
    expect(fluxLegend({ ...INDEX, evenements: [] }).notes?.[0]).toBe('Aucune prévision publiée.');
  });
});

describe('câblage', () => {
  const read = (p: string): string => readFileSync(new URL(p, import.meta.url), 'utf8');
  const app = read('../src/App.ts');
  it('clé déclarée partout, thème Sécurité seulement, relève et panneau', () => {
    expect(read('../src/types/index.ts')).toContain('pedestrianFlows: boolean;');
    expect(app).toMatch(/const DEFAULT_LAYERS[^]*?pedestrianFlows: false,/);
    expect(read('../src/components/UnderMapNewsFeed.ts')).toContain('pedestrianFlows: false,');
    expect(read('../src/utils/urlState.ts')).toContain("'pedestrianFlows'");
    expect(read('../src/components/LayerPanel.ts')).toContain("key: 'pedestrianFlows'");
    expect(ALL_PRESETABLE_LAYER_KEYS).toContain('pedestrianFlows');
    const themes = Object.entries(THEME_LAYERS).filter(([, keys]) => keys.includes('pedestrianFlows')).map(([t]) => t);
    expect(themes).toEqual(['security']);
    expect(app).toContain("case 'pedestrianFlows': return [this.ensureFluxPanel()];");
    expect(app).toContain("case 'pedestrianFlows': return this.fluxPanel;");
    expect(app).toMatch(/if \(key === 'pedestrianFlows'\)[^]*?this\.syncFluxPolling\(\);/);
    expect(read('../src/components/DeckGLMap.ts')).toMatch(/FLUX_LAYER_IDS\) this\.setVis\(id, vis\(layers\.pedestrianFlows/);
    expect(read('../vite.config.ts')).toContain("'data/flux-pietons/**'");
  });
  it('production : route Caddy dédiée (404 vraie, sans cache), données jamais versionnées', () => {
    const caddy = read('../deploy/oracle/Caddyfile');
    expect(caddy).toMatch(/@fluxPietons path \/data\/flux-pietons\/\*[^]*?handle @fluxPietons \{[^]*?no-store[^]*?root \* \/var\/lib\/francemonitor/);
    expect(caddy.indexOf('handle @fluxPietons')).toBeLessThan(caddy.lastIndexOf('try_files {path} /index.html'));
    expect(read('../.gitignore')).toContain('public/data/flux-pietons/');
  });
});
