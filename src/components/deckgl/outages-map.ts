// src/components/deckgl/outages-map.ts : entités et couches MapLibre des couches Pannes réseau Télécoms et Électricité (spec 2026-10-08
// § 2.1, § 2.2) ; parties pures. Télécoms : un point par site (récentes en rouge, plus anciennes en orange et plus petites, maintenances
// en gris clair, masquées par défaut) ; fichier ARCEP en retard : tout en gris. Électricité : unités en arrêt imprévu (rouge) et en
// maintenance (gris clair), placées par la liste d'emplacements ; une unité sans emplacement connu n'est pas dessinée (V5). EDF muet ou en
// retard (dernière lecture réussie, R20) : tout en gris. Internet : départements en anomalie IODA (en cours : remplissage et contour
// rouges ; terminée depuis moins de 7 jours : contour orange) ; un opérateur, la France entière ou un département d'outre-mer (absent du
// fichier des polygones) n'ont pas d'entité (V5). Cloud : un cercle par lieu, tous fournisseurs confondus (statut publié le plus grave ;
// une région sans état publié, GCP et AWS, reste neutre sauf incident) ; référentiel en teinte neutre, un inventaire n'est pas un état. MapLibre ne lit pas les variables CSS : teintes de
// outages-legend.ts. Couleur et corps d'infobulle calculés ici, dans les propriétés ; tout texte est échappé. Aucune vue importée.
import type { GeoJSONSourceSpecification, LayerSpecification } from 'maplibre-gl';
import type { OutagesLayerKey } from '../../config/outages-sources.ts';
import type {
  CloudOutagesResponse, CloudProvider, CloudStatus, CloudZone, InternetEvent, InternetOutagesResponse, PowerOutagesResponse, TelecomOutagesResponse,
} from '../../types/index.ts';
import { parisDayOf } from '../../services/environment-levels.ts';
import {
  CLOUD_NO_INCIDENT_TEXT, CLOUD_PROVIDER_LABEL, CLOUD_STATUS_WORD, CLOUD_ZONE_LEVEL, internetLive, internetSignalWord, isArcepFileLate, isDeducedZone, isOutagesDataLate,
} from '../../services/outages-levels.ts';
import { levelHex } from '../../services/vigilance.ts';
import { NBSP, formatMw } from '../layer-panel/format.ts';
import { countText, dayMonth, formatDuration, parisClock, placeOf, when } from '../layer-panel/outages-format.ts';
import { OUT_LATE_HEX, OUT_LONG_HEX, OUT_MAINT_HEX, OUT_RECENT_HEX, OUT_REF_HEX } from '../layer-panel/outages-legend.ts';
import {
  LYR_OUT_CLOUD_REF, LYR_OUT_CLOUD_ZONES, LYR_OUT_INTERNET_FILL, LYR_OUT_INTERNET_LINE, LYR_OUT_POWER_PLANNED, LYR_OUT_POWER_UNPLANNED, LYR_OUT_TELECOM_LONG,
  LYR_OUT_TELECOM_MAINT, LYR_OUT_TELECOM_RECENT, SRC_OUT_CLOUD_REF, SRC_OUT_CLOUD_ZONES, SRC_OUT_INTERNET, SRC_OUT_POWER, SRC_OUT_TELECOM,
} from './constants.ts';
import { escapeHtml } from './format-utils.ts';
import { resolveAssetCoords } from './iip-geocoding.ts';

type Fc = GeoJSON.FeatureCollection<GeoJSON.Point>;
type PointFeature = GeoJSON.Feature<GeoJSON.Point>;
type PolyGeometry = GeoJSON.Polygon | GeoJSON.MultiPolygon;
type PolyFc = GeoJSON.FeatureCollection<PolyGeometry>;

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

/** « 08/10 à 11 h 02 » (Paris) ; « date n.d. » sans date de début lisible. */
function sinceLabel(since: string | null): string {
  const t = since === null ? Number.NaN : Date.parse(since);
  return Number.isFinite(t) ? `${dayMonth(parisDayOf(t))} à ${parisClock(t)}` : 'date n.d.';
}

function telecomBody(s: TelecomOutagesResponse['sites'][number], late: boolean): string {
  const nature = s.cause === 'maintenance' ? 'maintenance' : s.cls === 'recente' ? `panne imprévue de moins de 24${NBSP}h` : 'panne imprévue';
  return head(`${s.commune ?? 'commune n.d.'} · ${s.operator}`, placeOf(s.dept))
    + row('Hors service', s.techs.join(', ') || 'technologies n.d.')
    + row('Nature', nature)
    + row('Depuis', sinceLabel(s.since))
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

// ─── Internet ───

const DAY_MS = 86_400_000;
const SEVEN_DAYS_MS = 7 * DAY_MS;

function isPolygon(g: GeoJSON.Geometry): g is PolyGeometry {
  return g.type === 'Polygon' || g.type === 'MultiPolygon';
}

function internetRow(e: InternetEvent): string {
  return row(internetSignalWord(e.signal), `${when(e.start)} · ${e.ongoing ? 'en cours' : formatDuration(e.durationSec)}`);
}

/**
 * Départements en anomalie IODA : en cours (remplissage et contour rouges), terminée depuis moins de 7 jours avant la lecture (contour
 * orange). Un opérateur, la France entière ou une région non identifiée n'ont pas de polygone (V5) ; un département absent du fichier
 * (outre-mer) n'est pas dessiné. IODA en retard : gris. Une entité par département (l'état en cours l'emporte), corps d'infobulle listant ses
 * événements ; la géométrie est copiée du fichier des départements, jamais modifiée. « En cours » suit internetLive (R41).
 */
export function internetFeatures(r: InternetOutagesResponse | null, departements: GeoJSON.FeatureCollection, now: number): PolyFc {
  const empty: PolyFc = { type: 'FeatureCollection', features: [] };
  if (r === null || r.iodaReadAt === null) return empty;
  const readAt = Date.parse(r.iodaReadAt);
  if (!Number.isFinite(readAt)) return empty;
  const late = isOutagesDataLate('ioda', r.iodaReadAt, now);
  const ongoing = new Set(internetLive(r, now).flatMap((p) => (p.scope === 'departement' && p.dept !== null ? [p.dept] : [])));
  const byDept = new Map<string, InternetEvent[]>();
  for (const e of r.events) {
    if (e.scope !== 'departement' || e.dept === null) continue;
    const finished = !e.ongoing && e.end !== null && readAt - Date.parse(e.end) < SEVEN_DAYS_MS;
    if (!finished && !(e.ongoing && !e.staleOpen)) continue;
    byDept.set(e.dept, [...(byDept.get(e.dept) ?? []), e]);
  }
  const features: GeoJSON.Feature<PolyGeometry>[] = [];
  for (const f of departements.features) {
    const code = String(f.properties?.['code'] ?? '');
    const events = byDept.get(code);
    if (!events || !isPolygon(f.geometry)) continue;
    const state = ongoing.has(code) ? 'encours' : 'recent';
    const sorted = [...events].sort((a, b) => Number(b.ongoing) - Number(a.ongoing) || Date.parse(b.start) - Date.parse(a.start));
    features.push({
      type: 'Feature', geometry: f.geometry,
      properties: {
        dept: code, state, color: late ? OUT_LATE_HEX : state === 'encours' ? levelHex('rouge') : OUT_LONG_HEX,
        body: head(placeOf(code), 'IODA') + sorted.map(internetRow).join('') + (late ? note('IODA en retard : couleur retirée.') : ''),
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

// ─── Cloud ───

/** Rang de gravité d'un statut : le plus grave colore le lieu ; « inconnu » ne l'emporte jamais sur un état publié. */
const STATUS_RANK: Readonly<Record<CloudStatus, number>> = { major: 5, partial: 4, degraded: 3, maintenance: 2, operational: 1, unknown: 0 };
/** Ordre de dessin (circle-sort-key) : le plus grave au-dessus ; le neutre et le gris dessous, un état publié au-dessus d'eux. */
const DRAW_RANK: Readonly<Record<CloudStatus | 'neutre' | 'retard', number>> = {
  neutre: 0, retard: 1, unknown: 1, operational: 2, maintenance: 3, degraded: 4, partial: 5, major: 6,
};
/** Couleur d'un statut publié : niveaux de la vue (CLOUD_ZONE_LEVEL), vert si opérationnel, maintenance et inconnu à part. */
function statusHex(status: CloudStatus): string {
  if (status === 'operational') return levelHex('vert');
  if (status === 'maintenance') return OUT_MAINT_HEX;
  const level = CLOUD_ZONE_LEVEL[status];
  return level === undefined ? OUT_LATE_HEX : levelHex(level);
}
const ZONE_ROWS = 8;

/** Zones d'un fournisseur en un lieu ; `late` : page en retard (lecture + 2 h) ; `error` : page en échec. */
interface ProviderZones { provider: CloudProvider; zones: CloudZone[]; late: boolean; error: boolean }
interface Place { lat: number; lon: number; providers: ProviderZones[] }

function hasPosition(z: CloudZone): z is CloudZone & { lat: number; lon: number } {
  return typeof z.lat === 'number' && typeof z.lon === 'number' && Number.isFinite(z.lat) && Number.isFinite(z.lon);
}
/** « Gravelines (GRA7) » devient « Gravelines » : le nom du lieu. */
const placeName = (z: CloudZone): string => z.label.replace(/\s*\([^)]*\)\s*$/, '') || z.label;
/** Statut le plus grave d'une liste de zones (null si vide). */
function worstStatus(zones: readonly CloudZone[]): CloudStatus | null {
  return zones.reduce<CloudStatus | null>((top, z) => (top === null || STATUS_RANK[z.status] > STATUS_RANK[top] ? z.status : top), null);
}

/** Corps d'infobulle d'un lieu : chaque fournisseur présent, son état, ses zones non opérationnelles et la date de son état. */
function placeBody(place: Place): string {
  const first = place.providers[0].zones.find((z) => !z.label.startsWith('Région')) ?? place.providers[0].zones[0];
  const sub = place.providers.map((p) => CLOUD_PROVIDER_LABEL[p.provider]).join(' · ');
  return head(placeName(first), sub) + place.providers.map((p) => {
    const name = CLOUD_PROVIDER_LABEL[p.provider];
    const deduced = p.zones.every((z) => isDeducedZone(p.provider, z));
    const troubled = p.zones.filter((z) => z.status !== 'operational');
    const newest = p.zones.map((z) => z.updatedAt).filter((d): d is string => d !== null).sort().at(-1) ?? null;
    return row(name, deduced ? CLOUD_NO_INCIDENT_TEXT : CLOUD_STATUS_WORD[worstStatus(p.zones) ?? 'unknown'])
      + row('Zones suivies', String(p.zones.length))
      + troubled.slice(0, ZONE_ROWS).map((z) => row(z.label, CLOUD_STATUS_WORD[z.status])).join('')
      + (troubled.length > ZONE_ROWS ? note(`et ${countText(troubled.length - ZONE_ROWS, 'autre', 'autres')}.`) : '')
      + row('Mis à jour', newest === null ? CLOUD_NO_INCIDENT_TEXT : when(newest))
      + (p.late ? note(`${name} : page d’état en retard, couleur retirée.`) : '')
      + (p.error ? note(`${name} : page d’état en erreur, couleur retirée.`) : '');
  }).join('') + (place.providers.some((p) => p.zones.some((z) => z.id.startsWith('fr-par-'))) ? note('Région fr-par : région parisienne.') : '');
}

/**
 * Un cercle par LIEU, tous fournisseurs confondus (OVHcloud, Cloudflare, Google Cloud, AWS et Scaleway partagent le point de Paris) : le
 * statut le plus grave des seules zones dont l'état est publié colore le lieu, et l'infobulle liste chaque fournisseur et ses zones. Une zone
 * déduite de l'absence d'incident (GCP, AWS : aucun état publié par région) ne colore que lorsqu'un incident est publié pour elle ; seule, elle
 * laisse le lieu en teinte neutre. Fournisseur en retard (lecture + 2 h) ou en échec : ses zones ne colorent plus (gris si rien d'autre ne
 * colore). Zone sans coordonnées : non dessinée (V5). Le plus grave est dessiné au-dessus (circle-sort-key `rank`).
 */
export function cloudZoneFeatures(r: CloudOutagesResponse | null, now: number): Fc {
  if (r === null) return fc([]);
  const places = new Map<string, Place>();
  for (const p of r.providers) {
    const late = isOutagesDataLate('cloud', p.readAt, now);
    for (const z of p.zones) {
      if (!hasPosition(z)) continue;
      const key = `${z.lat}:${z.lon}`;
      const place = places.get(key) ?? { lat: z.lat, lon: z.lon, providers: [] };
      let entry = place.providers.find((x) => x.provider === p.provider);
      if (!entry) {
        entry = { provider: p.provider, zones: [], late, error: p.error !== null };
        place.providers.push(entry);
      }
      entry.zones.push(z);
      places.set(key, place);
    }
  }
  return fc([...places.values()].map((place): PointFeature => {
    const published = place.providers.filter((p) => !p.late && !p.error)
      .flatMap((p) => p.zones.filter((z) => !isDeducedZone(p.provider, z)));
    const worst = worstStatus(published);
    const grey = place.providers.some((p) => p.late || p.error);
    const color = worst !== null ? statusHex(worst) : grey ? OUT_LATE_HEX : OUT_REF_HEX;
    const rank = worst !== null ? DRAW_RANK[worst] : grey ? DRAW_RANK.retard : DRAW_RANK.neutre;
    return {
      type: 'Feature', geometry: { type: 'Point', coordinates: [place.lon, place.lat] },
      properties: { providers: place.providers.map((p) => p.provider).join(','), status: worst ?? 'none', color, rank, body: placeBody(place) },
    };
  }));
}

/** Libellés de source du référentiel publiés en anglais par le serveur, dits en français ; tout autre libellé est repris tel quel. */
const SOURCE_FR: Readonly<Record<string, string>> = {
  'static backbone': 'inventaire embarqué',
  'OpenStreetMap France datacenters snapshot': 'OpenStreetMap, instantané des centres de données de France',
  'DataCenterMap live browser snapshot': 'DataCenterMap, instantané',
  'data.gouv.fr DRIEAT IDF WFS': 'data.gouv.fr, DRIEAT Île-de-France',
};

function referenceBody(d: CloudOutagesResponse['reference']['datacenters'][number]): string {
  return head(d.name, d.operator ?? 'opérateur n.d.')
    + row('Ville', d.city ?? 'n.d.')
    + (d.stage === null ? '' : row('Avancement', d.stage))
    + (d.power === null ? '' : row('Puissance', d.power))
    + note('Inventaire, pas un état.')
    + (d.source === '' ? '' : note(SOURCE_FR[d.source] ?? d.source));
}

/** Centres de données du référentiel : un inventaire en teinte neutre, jamais coloré par un statut (P5). Position illisible : non dessiné. */
export function cloudReferenceFeatures(r: CloudOutagesResponse | null): Fc {
  if (r === null) return fc([]);
  return fc(r.reference.datacenters.filter((d) => Number.isFinite(d.lat) && Number.isFinite(d.lon)).map((d): PointFeature => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [d.lon, d.lat] },
    properties: { id: d.id, color: OUT_REF_HEX, body: referenceBody(d) },
  })));
}

// ─── Sources, couches, survol ───

export const OUT_SOURCE_IDS: readonly string[] = [SRC_OUT_TELECOM, SRC_OUT_POWER, SRC_OUT_INTERNET, SRC_OUT_CLOUD_REF, SRC_OUT_CLOUD_ZONES];

export function outSourceSpec(): GeoJSONSourceSpecification {
  return { type: 'geojson', data: { type: 'FeatureCollection', features: [] } };
}

/** Couches nouvelles, toutes masquées jusqu'à setLayerVisibility ; couleur portée par chaque objet. */
export const OUT_LAYERS: readonly LayerSpecification[] = [
  // Surfaces d'abord (sous tous les points) : remplissage des départements en cours, contour de tous les départements en anomalie.
  {
    id: LYR_OUT_INTERNET_FILL, type: 'fill', source: SRC_OUT_INTERNET, filter: ['==', ['get', 'state'], 'encours'], layout: { visibility: 'none' },
    paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.35 },
  },
  {
    id: LYR_OUT_INTERNET_LINE, type: 'line', source: SRC_OUT_INTERNET, layout: { visibility: 'none' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 1.5 },
  },
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
  {
    id: LYR_OUT_CLOUD_REF, type: 'circle', source: SRC_OUT_CLOUD_REF, layout: { visibility: 'none' },
    paint: { 'circle-color': ['get', 'color'], 'circle-radius': 3.5, 'circle-opacity': 0.7 },
  },
  {
    id: LYR_OUT_CLOUD_ZONES, type: 'circle', source: SRC_OUT_CLOUD_ZONES, layout: { visibility: 'none', 'circle-sort-key': ['get', 'rank'] },
    paint: { 'circle-color': ['get', 'color'], 'circle-radius': 7, 'circle-stroke-width': 1, 'circle-stroke-color': '#0a0a0f' },
  },
];

/** Couches de chaque couche Pannes (visibilité) ; les maintenances télécoms ont leur option (setTelecomMaintenanceVisible). */
export const OUT_LAYER_KEYS: Readonly<Record<OutagesLayerKey, readonly string[]>> = {
  outagesTelecom: [LYR_OUT_TELECOM_LONG, LYR_OUT_TELECOM_RECENT],
  outagesElec: [LYR_OUT_POWER_PLANNED, LYR_OUT_POWER_UNPLANNED],
  outagesInternet: [LYR_OUT_INTERNET_FILL, LYR_OUT_INTERNET_LINE],
  outagesCloud: [LYR_OUT_CLOUD_REF, LYR_OUT_CLOUD_ZONES],
};
export const OUT_MAINTENANCE_LAYER = LYR_OUT_TELECOM_MAINT;

/** Couches survolées, de la plus haute à la plus basse : celle qu'on voit au-dessus répond. */
export const OUT_HOVER_LAYERS: readonly string[] = [
  LYR_OUT_CLOUD_ZONES, LYR_OUT_CLOUD_REF, LYR_OUT_POWER_UNPLANNED, LYR_OUT_POWER_PLANNED, LYR_OUT_TELECOM_RECENT, LYR_OUT_TELECOM_LONG, LYR_OUT_TELECOM_MAINT,
  LYR_OUT_INTERNET_LINE, LYR_OUT_INTERNET_FILL,
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
