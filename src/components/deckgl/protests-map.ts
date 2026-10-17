// src/components/deckgl/protests-map.ts : couche Manifestations (spec 2026-10-17 manifestations), parties pures : regroupement des
// points de même position, couleur (la plus forte du groupe), rayon, étiquette, infobulle .hm-tip échappée, source et couches MapLibre.
// Un signalé sans lieu précis (lat/lon null) est listé dans le panneau, jamais dessiné.
import type { LayerSpecification } from 'maplibre-gl';
import type { ProtestItem, ProtestsResponse } from '../../types/index.ts';
import { levelHex } from '../../services/vigilance.ts';
import { LYR_PROTESTS, LYR_PROTEST_LABEL, SRC_PROTESTS } from './constants.ts';
import { escapeHtml } from './format-utils.ts';

/** Annoncé seulement (agenda militant, non confirmé) : rose franc, distinct des autres couches de sécurité (cyber violet, défense, pannes). */
export const PROTEST_ANNOUNCED_HEX = '#ec4899';
/** Heurts signalés par la presse : rouge de l'échelle L1. */
export const PROTEST_CLASH_HEX = levelHex('rouge');
/** Signalé par la presse : orange de l'échelle L1. */
export const PROTEST_REPORTED_HEX = levelHex('orange');

export type ProtestGroupKind = 'heurts' | 'signale' | 'annonce';
const KIND_RANK: Readonly<Record<ProtestGroupKind, number>> = { annonce: 1, signale: 2, heurts: 3 };
const KIND_HEX: Readonly<Record<ProtestGroupKind, string>> = { heurts: PROTEST_CLASH_HEX, signale: PROTEST_REPORTED_HEX, annonce: PROTEST_ANNOUNCED_HEX };
const KIND_WORD: Readonly<Record<ProtestGroupKind, string>> = { heurts: 'Heurts signalés par la presse', signale: 'Signalé par la presse', annonce: 'Annoncé (agenda militant)' };

export interface ProtestGroup {
  /** Clé de position « lat,lon » : sert de lien entre le point de la carte et les lignes du panneau. */
  key: string;
  lat: number; lon: number;
  city: string | null;
  items: ProtestItem[];
  kind: ProtestGroupKind;
}

const kindOf = (x: ProtestItem): ProtestGroupKind => (x.status === 'signale' ? (x.violent ? 'heurts' : 'signale') : 'annonce');

/** Clé de position d'un item placé, null s'il n'a pas de coordonnées (jamais dessiné). */
export function protestPlaceKey(x: ProtestItem): string | null {
  return x.lat === null || x.lon === null ? null : `${x.lat},${x.lon}`;
}

/** Items placés regroupés par position identique ; couleur du groupe = statut le plus fort. */
export function groupProtests(items: readonly ProtestItem[]): ProtestGroup[] {
  const groups = new Map<string, ProtestGroup>();
  for (const x of items) {
    const key = protestPlaceKey(x);
    if (key === null || x.lat === null || x.lon === null) continue;
    const kind = kindOf(x);
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { key, lat: x.lat, lon: x.lon, city: x.city, items: [x], kind });
    } else {
      g.items.push(x);
      if (KIND_RANK[kind] > KIND_RANK[g.kind]) g.kind = kind;
      if (g.city === null) g.city = x.city;
    }
  }
  return [...groups.values()];
}

/** Rayon du rond : croît avec le nombre d'items, plafonné. */
export function protestRadius(count: number): number {
  return Math.min(16, 7 + 1.5 * Math.log2(Math.max(1, count)) * 2);
}

/** « Ville · n » quand plusieurs items partagent le point, sinon la ville seule. */
export function protestLabel(g: Pick<ProtestGroup, 'city' | 'items'>): string {
  const n = g.items.length;
  const city = g.city ?? 'Lieu n.d.';
  return n > 1 ? `${city} · ${n}` : city;
}

function body(g: ProtestGroup): string {
  const n = g.items.length;
  const signaled = g.items.filter((x) => x.status === 'signale').length;
  const announced = n - signaled;
  const press = g.items.filter((x) => x.source === 'presse');
  const articles = g.items.reduce((sum, x) => sum + (x.status === 'signale' ? Math.max(1, x.articleCount) : 0), 0);
  const people = press.reduce<number | null>((m, x) => (x.participants !== null && (m === null || x.participants > m) ? x.participants : m), null);
  const rows: Array<[string, string]> = [['Niveau', KIND_WORD[g.kind]]];
  if (signaled > 0) rows.push(['Articles (24\u00a0h)', String(articles)]);
  if (people !== null) rows.push(['Plus haut chiffre cité', `${people.toLocaleString('fr-FR')}\u00a0pers.`]);
  if (announced > 0) rows.push(['Annoncés', String(announced)]);
  // Presse française : le titre du dernier article dit ce qui se passe, mieux que le libellé générique.
  const lines = g.items.map((x) => (x.source === 'presse' ? x.articles[0]?.title ?? x.title : x.title));
  const titles = lines.slice(0, 3).map((t) => `<div class="hm-sub">${escapeHtml(t.length > 120 ? `${t.slice(0, 119)}…` : t)}</div>`).join('');
  return `<b>${escapeHtml(g.city ?? 'Lieu n.d.')}</b>${titles}`
    + rows.map(([k, v]) => `<div class="hm-row"><span>${escapeHtml(k)}</span><span>${escapeHtml(v)}</span></div>`).join('')
    + '<div class="hm-note">Un rendez-vous annoncé n’est pas une manifestation constatée.</div>';
}

export function protestFeatures(r: ProtestsResponse | null): GeoJSON.FeatureCollection<GeoJSON.Point> {
  if (!r) return { type: 'FeatureCollection', features: [] };
  return {
    type: 'FeatureCollection',
    features: groupProtests(r.items).map((g): GeoJSON.Feature<GeoJSON.Point> => ({
      type: 'Feature', geometry: { type: 'Point', coordinates: [g.lon, g.lat] },
      properties: {
        id: g.key, place: g.key, count: g.items.length, color: KIND_HEX[g.kind], radius: protestRadius(g.items.length),
        sortKey: KIND_RANK[g.kind] * 100 + Math.min(99, g.items.length), label: protestLabel(g), body: body(g),
      },
    })),
  };
}

export const PROTEST_LAYERS: readonly LayerSpecification[] = [
  {
    id: LYR_PROTESTS, type: 'circle', source: SRC_PROTESTS, layout: { 'circle-sort-key': ['get', 'sortKey'], visibility: 'none' },
    paint: {
      'circle-color': ['get', 'color'], 'circle-radius': ['get', 'radius'], 'circle-opacity': 0.9,
      'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff',
    },
  },
  {
    id: LYR_PROTEST_LABEL, type: 'symbol', source: SRC_PROTESTS,
    layout: { 'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, 1.6], 'text-anchor': 'top', 'text-font': ['Open Sans Semibold'], visibility: 'none' },
    paint: { 'text-color': '#ffffff', 'text-halo-color': '#0a0a0f', 'text-halo-width': 2 },
  },
];

export const PROTEST_LAYER_IDS: readonly string[] = [LYR_PROTESTS, LYR_PROTEST_LABEL];
