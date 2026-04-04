/**
 * urlState.ts — Encode/décode l'état de la vue dans l'URL.
 * Permet de partager un lien vers une vue précise de la carte.
 * Paramètres : ?lng=2.2&lat=46.6&z=6&layers=news,energy&time=24h&q=paris
 */

import type { MapLayers } from '../types/index.ts';

export interface UrlState {
    lng?: number;
    lat?: number;
    zoom?: number;
    layers?: Partial<MapLayers>;
    timeRange?: string;
    searchQuery?: string;
}

const LAYER_KEYS: (keyof MapLayers)[] = [
    'news',
    'stability',
    'energy',
    'hydraulic',
    'eolien',
    'health',
    'environmental',
    'fires',
    'infrastructure',
    'traffic',
    'trafficRoad',
    'trafficMaritime',
    'trafficAir',
    'metropoles',
    'military',
    'outages',
];

/**
 * Read the current URL search params and extract state.
 */
export function readUrlState(): UrlState {
    const params = new URLSearchParams(window.location.search);
    const state: UrlState = {};

    const lng = params.get('lng');
    const lat = params.get('lat');
    const z = params.get('z');

    if (lng) state.lng = parseFloat(lng);
    if (lat) state.lat = parseFloat(lat);
    if (z) state.zoom = parseFloat(z);

    const layersParam = params.get('layers');
    if (layersParam) {
        const activeSet = new Set(layersParam.split(','));
        const layers: Partial<MapLayers> = {};
        for (const key of LAYER_KEYS) {
            layers[key] = activeSet.has(key);
        }
        state.layers = layers;
    }

    const time = params.get('time');
    if (time) state.timeRange = time;

    const q = params.get('q');
    if (q) state.searchQuery = q;

    return state;
}

/**
 * Write app state into the URL (replaceState, no reload).
 */
export function writeUrlState(state: UrlState): void {
    const params = new URLSearchParams(window.location.search);

    if (state.lng != null) params.set('lng', state.lng.toFixed(4));
    else params.delete('lng');
    if (state.lat != null) params.set('lat', state.lat.toFixed(4));
    else params.delete('lat');
    if (state.zoom != null) params.set('z', state.zoom.toFixed(1));
    else params.delete('z');

    if (state.layers) {
        const active = LAYER_KEYS.filter((k) => state.layers![k]);
        if (active.length > 0 && active.length < LAYER_KEYS.length) {
            params.set('layers', active.join(','));
        } else {
            params.delete('layers');
        }
    } else {
        params.delete('layers');
    }

    if (state.timeRange) params.set('time', state.timeRange);
    else params.delete('time');
    if (state.searchQuery) params.set('q', state.searchQuery);
    else params.delete('q');

    const qs = params.toString();
    const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
    window.history.replaceState(null, '', newUrl);
}
