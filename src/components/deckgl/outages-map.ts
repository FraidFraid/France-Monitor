// src/components/deckgl/outages-map.ts : entités et couches MapLibre des couches Pannes réseau Télécoms et Électricité (spec 2026-10-08
// § 2.1, § 2.2) ; parties pures. Télécoms : un point par site (récentes en rouge, plus anciennes en orange et plus petites, maintenances
// en gris clair, masquées par défaut) ; fichier ARCEP en retard : tout en gris. Électricité : unités en arrêt imprévu (rouge) et en
// maintenance (gris clair), placées par la liste d'emplacements ; une unité sans emplacement connu n'est pas dessinée (V5). EDF muet ou en
// retard (dernière lecture réussie, R20) : tout en gris. MapLibre ne lit pas les variables CSS : teintes de outages-legend.ts. Couleur et
// corps d'infobulle calculés ici, dans les propriétés ; tout texte est échappé. Aucune vue importée.
import type { GeoJSONSourceSpecification, LayerSpecification } from 'maplibre-gl';
import type { PowerOutagesResponse, TelecomOutagesResponse } from '../../types/index.ts';
import { isArcepFileLate, isOutagesDataLate } from '../../services/outages-levels.ts';
import { NBSP, formatMw } from '../layer-panel/format.ts';
import { placeOf } from '../layer-panel/outages-format.ts';
import { OUT_LATE_HEX, OUT_LONG_HEX, OUT_MAINT_HEX, OUT_RECENT_HEX } from '../layer-panel/outages-legend.ts';
import {
  LYR_OUT_POWER_PLANNED, LYR_OUT_POWER_UNPLANNED, LYR_OUT_TELECOM_LONG, LYR_OUT_TELECOM_MAINT, LYR_OUT_TELECOM_RECENT, SRC_OUT_POWER, SRC_OUT_TELECOM,
} from './constants.ts';
import { escapeHtml } from './format-utils.ts';
import { resolveAssetCoords } from './iip-geocoding.ts';

type Fc = GeoJSON.FeatureCollection<GeoJSON.Point>;
type PointFeature = GeoJSON.Feature<GeoJSON.Point>;

function fc(features: PointFeature[]): Fc {
  return { type: 'FeatureCollection', features };
}

// ─── Infobulles : gabarit .hm-tip de la santé, des Trafics, de l'Environnement et de la Souveraineté ; textes échappés ───

function head(title: string, sub: string): string {
  return `<b>${escapeHtml(title)}</b><div class="hm-sub">${escapeHtml(sub)}</div>`;
}
function row(label: string, value: string): string {
  return `<div class="hm-row"><span>${escapeHtml(label)}</span><span>${escapeHtml(value)}</span></div>`;
}
function note(text: string): string {
  return `<div class="hm-note">${escapeHtml(text)}</div>`;
}

// ─── Télécoms ───

const CLASS_HEX: Readonly<Record<'recente' | 'longue' | 'maintenance' | 'sans-date', string>> = {
  recente: OUT_RECENT_HEX, longue: OUT_LONG_HEX, 'sans-date': OUT_LONG_HEX, maintenance: OUT_MAINT_HEX,
};

function telecomBody(s: TelecomOutagesResponse['sites'][number], late: boolean): string {
  const nature = s.cause === 'maintenance' ? 'maintenance' : s.cls === 'recente' ? `panne imprévue de moins de 24${NBSP}h` : 'panne imprévue';
  return head(`${s.commune ?? 'commune n.d.'} · ${s.operator}`, placeOf(s.dept))
    + row('Hors service', s.techs.join(', ') || 'technologies n.d.')
    + row('Nature', nature)
    + (s.detail ? note(s.detail) : '')
    + (late ? note('Fichier en retard : couleur retirée.') : '');
}

/** Un point par site du fichier ARCEP, à sa position ; fichier en retard : gris ; jamais lu : rien ; position illisible : site non dessiné. */
export function telecomFeatures(t: TelecomOutagesResponse | null, now: number): Fc {
  if (t === null || t.file === null) return fc([]);
  const late = isArcepFileLate(t.file.day, now);
  return fc(t.sites.filter((s) => Number.isFinite(s.lon) && Number.isFinite(s.lat)).map((s): PointFeature => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
    properties: { id: s.id, cls: s.cls, color: late ? OUT_LATE_HEX : CLASS_HEX[s.cls], body: telecomBody(s, late) },
  })));
}

// ─── Électricité ───

function powerBody(u: PowerOutagesResponse['unplanned'][number], late: boolean): string {
  return head(u.name, u.sector)
    + row('Indisponible', formatMw(u.lostMw))
    + row('Nature', u.kind === 'imprevue' ? 'arrêt imprévu' : 'maintenance')
    + (late ? note('Donnée EDF en retard : couleur retirée.') : '');
}

/** Unités en arrêt imprévu et en maintenance, placées par la liste d'emplacements ; sans emplacement connu : non dessinées (V5). */
export function powerFeatures(p: PowerOutagesResponse | null, now: number): Fc {
  if (p === null) return fc([]);
  const late = isOutagesDataLate('edf', p.edfReadAt, now);
  const out: PointFeature[] = [];
  for (const u of [...p.unplanned, ...p.planned]) {
    const at = resolveAssetCoords(u.name);
    if (at === null) continue;
    out.push({
      type: 'Feature', geometry: { type: 'Point', coordinates: at },
      properties: { name: u.name, kind: u.kind, color: late ? OUT_LATE_HEX : u.kind === 'imprevue' ? OUT_RECENT_HEX : OUT_MAINT_HEX, body: powerBody(u, late) },
    });
  }
  return fc(out);
}

// ─── Sources, couches, survol ───

export const OUT_SOURCE_IDS: readonly string[] = [SRC_OUT_TELECOM, SRC_OUT_POWER];

export function outSourceSpec(): GeoJSONSourceSpecification {
  return { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
}

/** Couches nouvelles, toutes masquées jusqu'à setLayerVisibility ; couleur portée par chaque objet. */
export const OUT_LAYERS: readonly LayerSpecification[] = [
  {
    id: LYR_OUT_TELECOM_MAINT, type: 'circle', source: SRC_OUT_TELECOM, filter: ['==', ['get', 'cls'], 'maintenance'], layout: { visibility: 'none' },
    paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2, 10, 4], 'circle-opacity': 0.7 },
  },
  {
    id: LYR_OUT_TELECOM_LONG, type: 'circle', source: SRC_OUT_TELECOM, filter: ['in', ['get', 'cls'], ['literal', ['longue', 'sans-date']]], layout: { visibility: 'none' },
    paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2.5, 10, 4.5], 'circle-opacity': 0.8 },
  },
  {
    id: LYR_OUT_TELECOM_RECENT, type: 'circle', source: SRC_OUT_TELECOM, filter: ['==', ['get', 'cls'], 'recente'], layout: { visibility: 'none' },
    paint: {
      'circle-color': ['get', 'color'], 'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 4, 10, 7],
      'circle-stroke-width': 1, 'circle-stroke-color': '#0a0a0f',
    },
  },
  {
    id: LYR_OUT_POWER_PLANNED, type: 'circle', source: SRC_OUT_POWER, filter: ['==', ['get', 'kind'], 'planifiee'], layout: { visibility: 'none' },
    paint: { 'circle-color': ['get', 'color'], 'circle-radius': 5, 'circle-opacity': 0.8 },
  },
  {
    id: LYR_OUT_POWER_UNPLANNED, type: 'circle', source: SRC_OUT_POWER, filter: ['==', ['get', 'kind'], 'imprevue'], layout: { visibility: 'none' },
    paint: { 'circle-color': ['get', 'color'], 'circle-radius': 8, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#ffffff' },
  },
];

/** Couches de chaque couche Pannes (visibilité) ; les maintenances télécoms ont leur option (setTelecomMaintenanceVisible). */
export const OUT_LAYER_KEYS: Readonly<Record<'outagesTelecom' | 'outagesElec', readonly string[]>> = {
  outagesTelecom: [LYR_OUT_TELECOM_LONG, LYR_OUT_TELECOM_RECENT],
  outagesElec: [LYR_OUT_POWER_PLANNED, LYR_OUT_POWER_UNPLANNED],
};
export const OUT_MAINTENANCE_LAYER = LYR_OUT_TELECOM_MAINT;

/** Couches survolées, de la plus haute à la plus basse : celle qu'on voit au-dessus répond. */
export const OUT_HOVER_LAYERS: readonly string[] = [
  LYR_OUT_POWER_UNPLANNED, LYR_OUT_POWER_PLANNED, LYR_OUT_TELECOM_RECENT, LYR_OUT_TELECOM_LONG, LYR_OUT_TELECOM_MAINT,
];
const HOVERABLE: ReadonlySet<string> = new Set(OUT_HOVER_LAYERS);

export function topOutHit<T extends { layer: { id: string } }>(hits: readonly T[]): T | undefined {
  for (const id of OUT_HOVER_LAYERS) {
    const hit = hits.find((f) => f.layer.id === id);
    if (hit) return hit;
  }
  return undefined;
}

/** Infobulle préparée avec la donnée (propriété `body`, déjà échappée) ; null hors des couches survolables ou sans corps. */
export function outTooltipHtml(layerId: string, props: Readonly<Record<string, unknown>>): string | null {
  const body = props['body'];
  if (typeof body !== 'string' || body === '' || !HOVERABLE.has(layerId)) return null;
  return `<div class="hm-tip">${body}</div>`;
}
