// api/_lib/firms.js : lecture des CSV NASA FIRMS (VIIRS et MODIS), spec 2026-10-04 environnement § 2.4 et E3.
// Fonctions pures, sans réseau : la collecte (api/_lib/fires-collect.js) lit les fichiers et passe le texte ici.
// Chaque détection garde son satellite exact, son capteur, sa confiance telle que publiée (lettres VIIRS, 0 à 100
// MODIS) et ramenée à trois classes, sa puissance radiative (FRP, MW) et son heure d'acquisition en UTC.
// Une ligne illisible (coordonnées, heure, confiance, FRP ou jour/nuit) est écartée : jamais de valeur inventée.
import { detectionTimestamp } from './firms-window.js';

export const FIRMS_AREA_BASE = 'https://firms.modaps.eosdis.nasa.gov/api/area/csv';
/** Boîte interrogée (ouest, sud, est, nord) : métropole, Corse et marges ; la France est retenue par département. */
export const FIRMS_BBOX = '-6,41,10,52';
/** Les quatre produits NRT lus avec la clé. */
export const FIRMS_SOURCES = ['VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT', 'MODIS_NRT'];
/** Repli sans clé : CSV public Europe 24 h, Suomi NPP seul. */
export const FIRMS_PUBLIC_CSV_URL = 'https://firms.modaps.eosdis.nasa.gov/data/active_fire/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Europe_24h.csv';
export const FIRMS_PUBLIC_SOURCE = 'VIIRS_SNPP_PUBLIC_24H';

/** Libellé d'une source pour `errors[]` (jamais l'URL : la clé FIRMS est dans le chemin). */
export const FIRMS_SOURCE_LABEL = {
  VIIRS_SNPP_NRT: 'Suomi NPP',
  VIIRS_NOAA20_NRT: 'NOAA-20',
  VIIRS_NOAA21_NRT: 'NOAA-21',
  MODIS_NRT: 'MODIS',
  VIIRS_SNPP_PUBLIC_24H: 'Suomi NPP (CSV public)',
};

const SATELLITE_OF_ROW = { N: 'Suomi NPP', N20: 'NOAA-20', N21: 'NOAA-21', T: 'Terra', A: 'Aqua', Terra: 'Terra', Aqua: 'Aqua' };
const SATELLITE_OF_SOURCE = { VIIRS_SNPP_NRT: 'Suomi NPP', VIIRS_NOAA20_NRT: 'NOAA-20', VIIRS_NOAA21_NRT: 'NOAA-21', VIIRS_SNPP_PUBLIC_24H: 'Suomi NPP' };
const VIIRS_CONFIDENCE = { l: 'faible', low: 'faible', n: 'nominale', nominal: 'nominale', h: 'haute', high: 'haute' };
const REQUIRED_COLUMNS = ['latitude', 'longitude', 'acq_date', 'acq_time', 'confidence', 'frp'];

/**
 * URL de l'API « area » (clé dans le chemin). Sans `date` : les `days` derniers jours (aujourd'hui compris, depuis minuit UTC) ;
 * avec `date` (AAAA-MM-JJ) : de cette date à date + days - 1 (documentation FIRMS, DAY_RANGE de 1 à 5).
 * @param {string} key
 * @param {string} sourceId
 * @param {{ days?: number, date?: string }} [options]
 */
export function firmsAreaUrl(key, sourceId, { days = 2, date } = {}) {
  return `${FIRMS_AREA_BASE}/${key}/${sourceId}/${FIRMS_BBOX}/${days}${date ? `/${date}` : ''}`;
}

/**
 * Lignes d'un CSV FIRMS, valeurs en texte brut. Lève si l'en-tête n'est pas celui de FIRMS (message d'erreur servi à la place
 * du CSV, page HTML) ; un CSV réduit à son en-tête est une vraie absence de détection, rendue comme une liste vide.
 * @param {string} text
 * @returns {Array<Record<string, string>>}
 */
export function parseFirmsCsv(text) {
  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) throw new Error('CSV FIRMS vide');
  const header = lines[0].split(',').map((h) => h.trim());
  if (!REQUIRED_COLUMNS.every((c) => header.includes(c))) throw new Error('CSV FIRMS illisible (en-tête inattendu)');
  const rows = [];
  for (const line of lines.slice(1)) {
    const values = line.split(',');
    if (values.length !== header.length) continue;
    const row = {};
    header.forEach((h, i) => { row[h] = values[i].trim(); });
    rows.push(row);
  }
  return rows;
}

/** Classe de confiance : lettres VIIRS (l, n, h) ; MODIS de 0 à 29 faible, 30 à 79 nominale, 80 à 100 haute. */
export function confidenceClass(raw, sensor) {
  const value = String(raw ?? '').trim();
  if (sensor === 'MODIS') {
    if (!/^\d{1,3}$/.test(value)) return null;
    const n = Number(value);
    if (n > 100) return null;
    return n >= 80 ? 'haute' : n >= 30 ? 'nominale' : 'faible';
  }
  return VIIRS_CONFIDENCE[value.toLowerCase()] ?? null;
}

function roundTo(v, digits) {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

/**
 * Détection normalisée (contrat FireDetection sans `dept`, `recurrent` ni `foyerId`), ou null si la ligne est illisible.
 * Identifiant : `${lat.toFixed(4)}_${lon.toFixed(4)}_${acq_date}_${HHMM}_${satellite}` (heure complétée à 4 chiffres).
 * @param {Record<string, string>} row
 * @param {string} sourceId
 */
export function normalizeDetection(row, sourceId) {
  const lat = Number.parseFloat(row?.latitude ?? '');
  const lon = Number.parseFloat(row?.longitude ?? '');
  const frp = Number.parseFloat(row?.frp ?? '');
  const ts = detectionTimestamp(row);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(frp) || frp < 0 || ts === null) return null;
  const sensor = sourceId === 'MODIS_NRT' || String(row.instrument ?? '').toUpperCase() === 'MODIS' ? 'MODIS' : 'VIIRS';
  const satellite = SATELLITE_OF_ROW[String(row.satellite ?? '').trim()] ?? SATELLITE_OF_SOURCE[sourceId] ?? null;
  const confidenceRaw = String(row.confidence ?? '').trim();
  const confidence = confidenceClass(confidenceRaw, sensor);
  const daynight = String(row.daynight ?? '').trim();
  if (satellite === null || confidence === null || (daynight !== 'D' && daynight !== 'N')) return null;
  const hhmm = String(row.acq_time).padStart(4, '0');
  return {
    id: `${lat.toFixed(4)}_${lon.toFixed(4)}_${row.acq_date}_${hhmm}_${satellite}`,
    lat: roundTo(lat, 5),
    lon: roundTo(lon, 5),
    acquiredAt: new Date(ts).toISOString(),
    satellite,
    sensor,
    confidence,
    confidenceRaw,
    frpMw: roundTo(frp, 2),
    daynight,
  };
}

/** Vrai si le point est dans la boîte interrogée (le CSV public couvre toute l'Europe). */
export function inFirmsBox(lat, lon) {
  return lat >= 41 && lat <= 52 && lon >= -6 && lon <= 10;
}

/**
 * Détections normalisées d'un ensemble de lignes (une source), dans la boîte, sans doublon d'identifiant.
 * @param {Array<Record<string, string>>} rows
 * @param {string} sourceId
 */
export function normalizeRows(rows, sourceId) {
  const seen = new Map();
  for (const row of rows) {
    const d = normalizeDetection(row, sourceId);
    if (d && inFirmsBox(d.lat, d.lon) && !seen.has(d.id)) seen.set(d.id, d);
  }
  return [...seen.values()];
}
