/**
 * data-export.ts — Sérialisation CSV / GeoJSON des données affichées, par couche.
 *
 * Module PUR : aucune dépendance DOM, aucun fetch. Il transforme les objets
 * déjà en cache dans l'application (news, situations, météo, crues, feux,
 * pannes, incidents trafic) vers deux formats interopérables :
 *   - CSV (séparateur « ; », BOM UTF-8) pour Excel FR / tableurs ;
 *   - GeoJSON (FeatureCollection, coordonnées [lng, lat]) pour QGIS / SIG.
 *
 * Chaque export porte sa provenance : colonne `exporte_le` + `source_donnees`
 * en CSV, propriété racine `metadata` en GeoJSON.
 */

import type { LineString, MultiLineString } from 'geojson';

import {
  RISK_LABELS,
  type ActiveFire,
  type DetectedSituation,
  type FloodSegment,
  type MeteoAlert,
  type NewsItem,
  type PowerOutage,
  type RoadEvent,
  type RoadUrbanResponse,
  type TelecomOutage,
} from '../types/index.ts';
import { JAM_MAGNITUDE_WORD, ROAD_KIND_WORD, ROAD_SEVERITY_WORD } from '../components/layer-panel/traffic-format.ts';

// ─── Types de sérialisation ───────────────────────────────────────────────────

/** Valeur autorisée dans une cellule d'export. */
export type ExportCellValue = string | number | null | undefined;

/** Ligne tabulaire : dictionnaire clé de colonne → valeur. */
export type ExportRow = Record<string, ExportCellValue>;

/** Définition d'une colonne : clé technique + libellé affiché (en-tête CSV). */
export interface ExportColumn {
  key: string;
  label: string;
}

/** Entité géolocalisée destinée au GeoJSON (coordonnées séparées des propriétés). */
export interface ExportFeatureInput {
  lat: number;
  lon: number;
  properties: Record<string, ExportCellValue>;
}

/** Résultat de sérialisation d'une couche : lignes (CSV) + entités (GeoJSON). */
export interface SerializedLayer {
  rows: ExportRow[];
  columns: ExportColumn[];
  features: ExportFeatureInput[];
}

/** Clés stables des couches exportables. */
export type ExportLayerKey =
  | 'actualites'
  | 'situations'
  | 'meteo'
  | 'crues'
  | 'feux'
  | 'pannes'
  | 'trafic'
  | 'bouchons';

/** Couche exportable prête à l'affichage dans le menu (déjà sérialisée). */
export interface ExportableLayer {
  key: ExportLayerKey;
  label: string;
  count: number;
  serialized: SerializedLayer;
}

/** Instantané des caches courants nécessaires aux exports (fourni par App.ts). */
export interface ExportContext {
  news: NewsItem[];
  situations: DetectedSituation[];
  meteoAlerts: MeteoAlert[];
  floods: FloodSegment[];
  fires: ActiveFire[];
  powerOutages: PowerOutage[];
  telecomOutages: TelecomOutage[];
  roadEvents: RoadEvent[];
  /** Dernière collecte TomTom des agglomérations (bouchons, date du relevé) ; null tant qu'elle n'est pas chargée. */
  roadUrban: Pick<RoadUrbanResponse, 'collectedAt' | 'jams'> | null;
}

// ─── Provenance ───────────────────────────────────────────────────────────────

export const EXPORT_PROVENANCE = 'France Monitor : données issues de sources ouvertes';

// ─── CSV ──────────────────────────────────────────────────────────────────────

const BOM = '﻿';
const CSV_SEP = ';';
const CSV_EOL = '\r\n';

/** Échappe une cellule CSV (RFC 4180 adapté au séparateur « ; »). */
function csvCell(value: ExportCellValue): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/["\n\r;]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Sérialise des lignes en CSV. Séparateur « ; » (convention Excel FR),
 * préfixe BOM UTF-8 pour l'ouverture correcte des accents dans Excel.
 */
export function toCsv(rows: ExportRow[], columns: ExportColumn[]): string {
  const header = columns.map((c) => csvCell(c.label)).join(CSV_SEP);
  const body = rows.map((row) => columns.map((c) => csvCell(row[c.key])).join(CSV_SEP));
  return BOM + [header, ...body].join(CSV_EOL) + CSV_EOL;
}

// ─── GeoJSON ──────────────────────────────────────────────────────────────────

interface GeoJsonPointFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: Record<string, ExportCellValue>;
}

interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  metadata?: Record<string, string>;
  features: GeoJsonPointFeature[];
}

/**
 * Sérialise des entités ponctuelles en FeatureCollection GeoJSON valide.
 * Coordonnées au format [lng, lat] (convention projet). Les entités sans
 * coordonnées finies sont exclues. `metadata` est une propriété racine
 * (foreign member RFC 7946) portant la provenance.
 */
export function toGeoJson(features: ExportFeatureInput[], metadata?: Record<string, string>): string {
  const collection: GeoJsonFeatureCollection = {
    type: 'FeatureCollection',
    ...(metadata ? { metadata } : {}),
    features: features
      .filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lon))
      .map((f) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [f.lon, f.lat] },
        properties: f.properties,
      })),
  };
  return JSON.stringify(collection, null, 2);
}

// ─── Composition finale (provenance incluse) ──────────────────────────────────

/** Produit le CSV final d'une couche avec colonnes de provenance ajoutées. */
export function layerToCsv(layer: ExportableLayer, now: Date): string {
  const iso = now.toISOString();
  const columns: ExportColumn[] = [
    ...layer.serialized.columns,
    { key: '__exporte_le', label: 'exporte_le' },
    { key: '__source', label: 'source_donnees' },
  ];
  const rows: ExportRow[] = layer.serialized.rows.map((r) => ({
    ...r,
    __exporte_le: iso,
    __source: EXPORT_PROVENANCE,
  }));
  return toCsv(rows, columns);
}

/** Produit le GeoJSON final d'une couche avec metadata de provenance. */
export function layerToGeoJson(layer: ExportableLayer, now: Date): string {
  return toGeoJson(layer.serialized.features, {
    source: EXPORT_PROVENANCE,
    couche: layer.label,
    exporte_le: now.toISOString(),
  });
}

// ─── Nom de fichier ───────────────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** `france-monitor-<layer>-<YYYYMMDD-HHmm>.<ext>` (heure locale). */
export function buildExportFilename(layerKey: string, ext: string, now: Date): string {
  const stamp =
    `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}` +
    `-${pad2(now.getHours())}${pad2(now.getMinutes())}`;
  return `france-monitor-${layerKey}-${stamp}.${ext}`;
}

// ─── Helpers géométrie / dates ────────────────────────────────────────────────

/** Premier point [lon, lat] d'une géométrie linéaire (point représentatif). */
function firstCoordinate(geom: LineString | MultiLineString): [number, number] | null {
  if (geom.type === 'LineString') {
    const c = geom.coordinates[0];
    return c ? [c[0], c[1]] : null;
  }
  const c = geom.coordinates[0]?.[0];
  return c ? [c[0], c[1]] : null;
}

/** Combine date (YYYY-MM-DD) + heure FIRMS (HHMM, UTC) en ISO 8601. */
function fireDatetimeIso(acqDate: string, acqTime: string): string {
  const padded = acqTime.padStart(4, '0');
  return `${acqDate}T${padded.slice(0, 2)}:${padded.slice(2, 4)}:00Z`;
}

// ─── Sérialiseurs par couche ──────────────────────────────────────────────────

/** Actualités (fils RSS classifiés). */
export function serializeNews(items: NewsItem[]): SerializedLayer {
  const columns: ExportColumn[] = [
    { key: 'titre', label: 'titre' },
    { key: 'source', label: 'source' },
    { key: 'date', label: 'date_iso' },
    { key: 'gravite', label: 'gravité' },
    { key: 'categorie', label: 'catégorie' },
    { key: 'lieu', label: 'lieu' },
    { key: 'lien', label: 'lien' },
    { key: 'lat', label: 'latitude' },
    { key: 'lon', label: 'longitude' },
  ];
  const rows: ExportRow[] = [];
  const features: ExportFeatureInput[] = [];
  for (const n of items) {
    const lieu = n.locationName ?? n.feedRegion ?? null;
    const date = n.pubDate.toISOString();
    const gravite = n.threat?.level ?? null;
    const categorie = n.threat?.category ?? null;
    rows.push({
      titre: n.title,
      source: n.source,
      date,
      gravite,
      categorie,
      lieu,
      lien: n.link,
      lat: n.lat ?? null,
      lon: n.lon ?? null,
    });
    if (typeof n.lat === 'number' && typeof n.lon === 'number') {
      features.push({
        lat: n.lat,
        lon: n.lon,
        properties: { titre: n.title, source: n.source, date, gravite, categorie, lieu, lien: n.link },
      });
    }
  }
  return { rows, columns, features };
}

/** Situations détectées (moteur de corrélation). */
export function serializeSituations(items: DetectedSituation[]): SerializedLayer {
  const columns: ExportColumn[] = [
    { key: 'titre', label: 'titre' },
    { key: 'gravite', label: 'gravité' },
    { key: 'confiance', label: 'confiance' },
    { key: 'zones', label: 'zones' },
    { key: 'resume', label: 'résumé' },
    { key: 'facteurs', label: 'facteurs' },
    { key: 'date', label: 'date_iso' },
    { key: 'lien', label: 'lien' },
    { key: 'lat', label: 'latitude' },
    { key: 'lon', label: 'longitude' },
  ];
  const rows: ExportRow[] = [];
  const features: ExportFeatureInput[] = [];
  for (const s of items) {
    const zones = s.affectedZones.join(', ');
    const facteurs = s.drivers.join(', ');
    const date = s.updatedAt.toISOString();
    rows.push({
      titre: s.title,
      gravite: s.severity,
      confiance: s.confidence,
      zones,
      resume: s.summary,
      facteurs,
      date,
      lien: s.linkUrl ?? null,
      lat: s.lat ?? null,
      lon: s.lon ?? null,
    });
    if (typeof s.lat === 'number' && typeof s.lon === 'number') {
      features.push({
        lat: s.lat,
        lon: s.lon,
        properties: { titre: s.title, gravite: s.severity, confiance: s.confidence, zones, resume: s.summary, date },
      });
    }
  }
  return { rows, columns, features };
}

/** Vigilance météo (Météo-France) — départementale, sans coordonnées ponctuelles. */
export function serializeMeteoAlerts(items: MeteoAlert[]): SerializedLayer {
  const columns: ExportColumn[] = [
    { key: 'departement', label: 'département' },
    { key: 'code', label: 'code_département' },
    { key: 'niveau', label: 'niveau' },
    { key: 'risques', label: 'risques' },
    { key: 'debut', label: 'début_iso' },
    { key: 'fin', label: 'fin_iso' },
  ];
  const rows: ExportRow[] = items.map((a) => ({
    departement: a.department,
    code: a.departmentCode,
    niveau: a.level,
    risques: a.risks.map((r) => RISK_LABELS[r] ?? r).join(', '),
    debut: a.startDate ? a.startDate.toISOString() : null,
    fin: a.endDate ? a.endDate.toISOString() : null,
  }));
  // Aucune coordonnée ponctuelle disponible : couche CSV uniquement.
  return { rows, columns, features: [] };
}

/** Crues (Vigicrues) — point représentatif = premier sommet du tronçon. */
export function serializeFloods(items: FloodSegment[]): SerializedLayer {
  const columns: ExportColumn[] = [
    { key: 'nom', label: 'nom' },
    { key: 'niveau', label: 'niveau' },
    { key: 'sourceDonnee', label: 'source_donnée' },
    { key: 'fidelite', label: 'fidélité_géométrie' },
    { key: 'lat', label: 'latitude' },
    { key: 'lon', label: 'longitude' },
  ];
  const rows: ExportRow[] = [];
  const features: ExportFeatureInput[] = [];
  for (const s of items) {
    const point = firstCoordinate(s.displayGeometry ?? s.geometry);
    const lon = point ? point[0] : null;
    const lat = point ? point[1] : null;
    rows.push({
      nom: s.name,
      niveau: s.level,
      sourceDonnee: s.dataSource,
      fidelite: s.geometryFidelity,
      lat,
      lon,
    });
    if (point) {
      features.push({
        lat: point[1],
        lon: point[0],
        properties: { nom: s.name, niveau: s.level, sourceDonnee: s.dataSource, fidelite: s.geometryFidelity },
      });
    }
  }
  return { rows, columns, features };
}

/** Feux actifs (détections VIIRS / NASA FIRMS). */
export function serializeFires(items: ActiveFire[]): SerializedLayer {
  const columns: ExportColumn[] = [
    { key: 'date', label: 'date_iso' },
    { key: 'satellite', label: 'satellite' },
    { key: 'confiance', label: 'confiance' },
    { key: 'frp', label: 'puissance_radiative_mw' },
    { key: 'temperature', label: 'température_k' },
    { key: 'jourNuit', label: 'jour_nuit' },
    { key: 'lat', label: 'latitude' },
    { key: 'lon', label: 'longitude' },
  ];
  const rows: ExportRow[] = [];
  const features: ExportFeatureInput[] = [];
  for (const f of items) {
    const date = fireDatetimeIso(f.acq_date, f.acq_time);
    rows.push({
      date,
      satellite: f.satellite,
      confiance: f.confidence,
      frp: f.frp,
      temperature: f.bright_ti4,
      jourNuit: f.daynight,
      lat: f.latitude,
      lon: f.longitude,
    });
    if (Number.isFinite(f.latitude) && Number.isFinite(f.longitude)) {
      features.push({
        lat: f.latitude,
        lon: f.longitude,
        properties: {
          date,
          satellite: f.satellite,
          confiance: f.confidence,
          frp: f.frp,
          temperature: f.bright_ti4,
          jourNuit: f.daynight,
        },
      });
    }
  }
  return { rows, columns, features };
}

/** Pannes réseaux — électricité (départementale) + télécom (géolocalisée). */
export function serializeOutages(power: PowerOutage[], telecom: TelecomOutage[]): SerializedLayer {
  const columns: ExportColumn[] = [
    { key: 'type', label: 'type_panne' },
    { key: 'operateur', label: 'opérateur' },
    { key: 'departement', label: 'département' },
    { key: 'code', label: 'code_département' },
    { key: 'commune', label: 'commune' },
    { key: 'foyers', label: 'foyers_hors_réseau' },
    { key: 'cause', label: 'cause' },
    { key: 'statutVoix', label: 'statut_voix' },
    { key: 'statutData', label: 'statut_data' },
    { key: 'tendance', label: 'tendance' },
    { key: 'lat', label: 'latitude' },
    { key: 'lon', label: 'longitude' },
  ];
  const rows: ExportRow[] = [];
  const features: ExportFeatureInput[] = [];

  for (const p of power) {
    // Pannes électriques Enedis : granularité départementale, sans point.
    rows.push({
      type: 'Électricité',
      operateur: 'Enedis',
      departement: p.departmentName,
      code: p.departmentCode,
      commune: null,
      foyers: p.offGridCount,
      cause: p.eventCause,
      statutVoix: null,
      statutData: null,
      tendance: p.trend,
      lat: null,
      lon: null,
    });
  }

  for (const t of telecom) {
    const [lon, lat] = t.coordinates;
    rows.push({
      type: 'Télécom',
      operateur: t.operator,
      departement: t.department,
      code: null,
      commune: t.city,
      foyers: null,
      cause: t.reason,
      statutVoix: t.voiceStatus,
      statutData: t.dataStatus,
      tendance: null,
      lat,
      lon,
    });
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      features.push({
        lat,
        lon,
        properties: {
          type: 'Télécom',
          operateur: t.operator,
          departement: t.department,
          commune: t.city,
          statutVoix: t.voiceStatus,
          statutData: t.dataStatus,
          cause: t.reason,
        },
      });
    }
  }

  return { rows, columns, features };
}

/** Événements routiers en cours du réseau national (DIR, spec 2026-10-03 trafics § 2.1) ; nature et gravité en français. */
export function serializeRoadEvents(items: RoadEvent[]): SerializedLayer {
  const columns: ExportColumn[] = [
    { key: 'type', label: 'type' },
    { key: 'nature', label: 'nature' },
    { key: 'route', label: 'route' },
    { key: 'lieu', label: 'lieu' },
    { key: 'sens', label: 'sens' },
    { key: 'dir', label: 'DIR' },
    { key: 'debut', label: 'début' },
    { key: 'fin', label: 'fin' },
    { key: 'gravite', label: 'gravité' },
    { key: 'securite', label: 'message de sécurité' },
    { key: 'detail', label: 'détail' },
    { key: 'lat', label: 'latitude' },
    { key: 'lon', label: 'longitude' },
  ];
  const rows: ExportRow[] = [];
  const features: ExportFeatureInput[] = [];
  for (const e of items) {
    rows.push({
      type: e.label, nature: ROAD_KIND_WORD[e.kind], route: e.road, lieu: e.place, sens: e.direction, dir: e.dir, debut: e.start, fin: e.end,
      gravite: e.severity !== null ? ROAD_SEVERITY_WORD[e.severity] : null, securite: e.safety ? 'oui' : 'non', detail: e.detail, lat: e.lat, lon: e.lon,
    });
    if (e.lat !== null && e.lon !== null && Number.isFinite(e.lat) && Number.isFinite(e.lon)) {
      features.push({ lat: e.lat, lon: e.lon, properties: { type: e.label, route: e.road, lieu: e.place, dir: e.dir, debut: e.start } });
    }
  }
  return { rows, columns, features };
}

/** Bouchons des agglomérations (TomTom, collecte du serveur, spec 2026-10-03 trafics § 2.2) : retard et longueur, intensité en français. */
export function serializeUrbanJams(urban: Pick<RoadUrbanResponse, 'collectedAt' | 'jams'> | null): SerializedLayer {
  const columns: ExportColumn[] = [
    { key: 'route', label: 'route' },
    { key: 'de', label: 'de' },
    { key: 'vers', label: 'vers' },
    { key: 'retard', label: 'retard (min)' },
    { key: 'longueur', label: 'longueur (km)' },
    { key: 'intensite', label: 'intensité' },
    { key: 'debut', label: 'début' },
    { key: 'releve', label: 'relevé TomTom' },
    { key: 'lat', label: 'latitude' },
    { key: 'lon', label: 'longitude' },
  ];
  const rows: ExportRow[] = [];
  const features: ExportFeatureInput[] = [];
  for (const j of urban?.jams ?? []) {
    const intensite = JAM_MAGNITUDE_WORD[j.magnitude];
    rows.push({
      route: j.road, de: j.from, vers: j.to, retard: j.delayMin, longueur: j.lengthKm, intensite, debut: j.start, releve: urban?.collectedAt ?? null,
      lat: j.lat, lon: j.lon,
    });
    if (Number.isFinite(j.lat) && Number.isFinite(j.lon)) {
      features.push({ lat: j.lat, lon: j.lon, properties: { route: j.road, de: j.from, vers: j.to, retard: j.delayMin, longueur: j.lengthKm, intensite } });
    }
  }
  return { rows, columns, features };
}

// ─── Assemblage : couches exportables ayant des données ───────────────────────

interface LayerDef {
  key: ExportLayerKey;
  label: string;
  serialize: (ctx: ExportContext) => SerializedLayer;
}

const LAYER_DEFS: LayerDef[] = [
  { key: 'actualites', label: 'Actualités', serialize: (c) => serializeNews(c.news) },
  { key: 'situations', label: 'Situations actives', serialize: (c) => serializeSituations(c.situations) },
  { key: 'meteo', label: 'Vigilance météo', serialize: (c) => serializeMeteoAlerts(c.meteoAlerts) },
  { key: 'crues', label: 'Crues', serialize: (c) => serializeFloods(c.floods) },
  { key: 'feux', label: 'Feux actifs', serialize: (c) => serializeFires(c.fires) },
  { key: 'pannes', label: 'Pannes réseaux', serialize: (c) => serializeOutages(c.powerOutages, c.telecomOutages) },
  { key: 'trafic', label: 'Événements routiers (DIR)', serialize: (c) => serializeRoadEvents(c.roadEvents) },
  { key: 'bouchons', label: 'Bouchons des agglomérations (TomTom)', serialize: (c) => serializeUrbanJams(c.roadUrban) },
];

/**
 * Construit la liste des couches exportables AYANT des données en cache.
 * Les couches vides sont omises. Ordre stable (défini par LAYER_DEFS).
 */
export function collectExportableLayers(ctx: ExportContext): ExportableLayer[] {
  const layers: ExportableLayer[] = [];
  for (const def of LAYER_DEFS) {
    const serialized = def.serialize(ctx);
    if (serialized.rows.length === 0) continue;
    layers.push({ key: def.key, label: def.label, count: serialized.rows.length, serialized });
  }
  return layers;
}
