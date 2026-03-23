import { fetchText, fetchJson, setCors, parseCsv, toIsoDate } from '../_shared/health-utils.js';
import { DEPT_NAMES, normalizeDepartmentCode } from '../_shared/departments.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * OSCOUR / SOS Médecins — Passages aux urgences par département
 *
 * Source : data.gouv.fr — dataset SPF
 * "Données des urgences hospitalières et de SOS médecins relatives à l'épidémie de COVID-19"
 * (contient les données SURSAUD quotidiennes dept + SOS Médecins — COVID et syndromiques)
 *
 * Dataset ID (stable) : 5e74ecf52eb7514f2d3b8845
 * Resource quot-dep   : eceb9fb4-3ebc-4da3-828d-f5939712600a
 *   → sursaud-covid-quot-dep-YYYY-MM-DD-HHhMM.csv
 *
 * Colonnes :
 *   dep | date_de_passage | sursaud_cl_age_corona
 *   nbre_pass_tot | nbre_acte_tot | nbre_pass_corona | nbre_acte_corona
 *
 * Cache fichier JSON (TTL 6h) pour éviter de re-parser 500k lignes à chaque requête.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Config ─────────────────────────────────────────────────────────────────
const DATASET_ID = '5e74ecf52eb7514f2d3b8845';
const DATAGOUV_DATASET_API = `https://www.data.gouv.fr/api/1/datasets/${DATASET_ID}/`;

// Resources connues à prioriser (mise à jour automatique par SPF)
const KNOWN_RESOURCE_IDS = [
  'eceb9fb4-3ebc-4da3-828d-f5939712600a', // sursaud-covid-quot-dep (dept quotidien)
];

// Cache fichier local (évite 500k lignes à re-parser à chaque requête)
const CACHE_PATH = path.join(__dirname, '../../.cache/oscour-dep.json');
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 heures

// ─── Helpers ────────────────────────────────────────────────────────────────
function pickString(row, keys) {
  for (const key of keys) {
    const v = row?.[key];
    if (v == null) continue;
    const txt = String(v).trim();
    if (txt) return txt;
  }
  return '';
}

function pickNumber(row, keys) {
  for (const key of keys) {
    const v = Number.parseFloat(String(row?.[key] ?? '').replace(',', '.'));
    if (Number.isFinite(v) && v >= 0) return v;
  }
  return null;
}

// ─── Discover most recent dep CSV from dataset API ──────────────────────────
async function discoverDepCsvUrl() {
  try {
    const meta = await fetchJson(DATAGOUV_DATASET_API, { timeoutMs: 10000 });
    const resources = Array.isArray(meta?.resources) ? meta.resources : [];

    // Chercher les ressources département quotidiennes (titre contient 'quot-dep' ou 'dep')
    const depCsvs = resources
      .filter(r => {
        const title = String(r?.title ?? '').toLowerCase();
        const url = String(r?.url ?? '').toLowerCase();
        const isCsv = r?.format === 'csv' || url.endsWith('.csv');
        const isDep = title.includes('quot-dep') || title.includes('dep') && title.includes('sursaud');
        return isCsv && isDep;
      })
      .sort((a, b) => {
        // Trier par date dans le titre (format YYYY-MM-DD)
        const dateA = String(a.title ?? '').match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? '';
        const dateB = String(b.title ?? '').match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? '';
        return dateB.localeCompare(dateA);
      });

    if (depCsvs.length > 0) {
      console.log(`[oscour-sos] Discovered resource: ${depCsvs[0].title}`);
      return depCsvs[0].url;
    }
  } catch (e) {
    console.warn('[oscour-sos] Dataset API discovery failed:', e.message);
  }

  // Fallback: resources connues via URL directe data.gouv.fr
  return `https://www.data.gouv.fr/fr/datasets/r/${KNOWN_RESOURCE_IDS[0]}`;
}

// ─── Parse & compute top motifs ─────────────────────────────────────────────
function trendLabel(pct) {
  const p = Math.round(pct * 100);
  return `${p >= 0 ? '+' : ''}${p}%`;
}

function computeTopMotifs(rows) {
  /**
   * On dispose de passages urgences + actes SOS par département et par date.
   * On agrège par dep (toutes classes d'âge sursaud_cl_age_corona = 0),
   * puis on calcule la tendance : 7 derniers jours vs 28 jours précédents.
   *
   * Les "motifs" ici sont simplifiés (OSCOUR = passages hospit, SOS = actes SOS)
   * car le CSV ne segmente pas par pathologie — juste global.
   */
  const byDepDate = new Map();
  let latestDate = null;

  for (const row of rows) {
    const dep = normalizeDepartmentCode(pickString(row, ['dep']));
    if (!dep) continue;

    // Seulement la classe d'âge "toutes" (0) pour éviter double-compte
    const age = pickString(row, ['sursaud_cl_age_corona']);
    if (age !== '0' && age !== '') continue;

    const isoDate = toIsoDate(pickString(row, ['date_de_passage', 'date']));
    if (!isoDate) continue;
    if (!latestDate || isoDate > latestDate) latestDate = isoDate;

    const passHosp = pickNumber(row, ['nbre_pass_tot']) ?? 0;
    const actesSos = pickNumber(row, ['nbre_acte_tot']) ?? 0;

    const key = `${dep}|${isoDate}`;
    const prev = byDepDate.get(key) ?? { dep, isoDate, passHosp: 0, actesSos: 0 };
    prev.passHosp += passHosp;
    prev.actesSos += actesSos;
    byDepDate.set(key, prev);
  }

  if (!latestDate) return [];

  const latestTime = new Date(`${latestDate}T00:00:00Z`).getTime();
  const W7 = 7 * 86400000;
  const W35 = 35 * 86400000;

  // Par département, calculer la tendance urgences et SOS sur 7j vs 28j précédents
  const byDep = new Map();
  for (const entry of byDepDate.values()) {
    const t = new Date(`${entry.isoDate}T00:00:00Z`).getTime();
    const age = latestTime - t;
    if (age < 0 || age > W35) continue;

    const cur = byDep.get(entry.dep) ?? { current: { hosp: [], sos: [] }, baseline: { hosp: [], sos: [] } };
    if (age <= W7) {
      cur.current.hosp.push(entry.passHosp);
      cur.current.sos.push(entry.actesSos);
    } else {
      cur.baseline.hosp.push(entry.passHosp);
      cur.baseline.sos.push(entry.actesSos);
    }
    byDep.set(entry.dep, cur);
  }

  const result = [];
  for (const [dep, data] of byDep.entries()) {
    const motifs = [];

    const avg = (arr) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
    const trend = (cur, base) => base > 0 ? (cur - base) / base : 0;

    const hospCur = avg(data.current.hosp);
    const hospBase = avg(data.baseline.hosp);
    const hospTrend = trend(hospCur, hospBase);

    const sosCur = avg(data.current.sos);
    const sosBase = avg(data.baseline.sos);
    const sosTrend = trend(sosCur, sosBase);

    if (hospTrend > 0.05) {
      motifs.push({
        code: 'PASS_URG',
        label: 'Passages urgences',
        trend_pct: Math.round(hospTrend * 1000) / 1000,
        trend: trendLabel(hospTrend),
        network: 'OSCOUR',
      });
    }
    if (sosTrend > 0.05) {
      motifs.push({
        code: 'ACTES_SOS',
        label: 'Actes SOS Médecins',
        trend_pct: Math.round(sosTrend * 1000) / 1000,
        trend: trendLabel(sosTrend),
        network: 'SOS_MED',
      });
    }

    if (motifs.length > 0) {
      result.push({
        code_insee: dep,
        name: DEPT_NAMES[dep] || `Département ${dep}`,
        top_motifs: motifs.sort((a, b) => b.trend_pct - a.trend_pct),
      });
    }
  }

  return result.sort((a, b) => a.code_insee.localeCompare(b.code_insee));
}

// ─── Cache file helpers ──────────────────────────────────────────────────────
function readCache() {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    const raw = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
    if (!raw?.cachedAt || Date.now() - raw.cachedAt > CACHE_TTL_MS) return null;
    return raw;
  } catch {
    return null;
  }
}

function writeCache(payload, meta) {
  try {
    const dir = path.dirname(CACHE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify({ cachedAt: Date.now(), payload, meta }, null, 2));
  } catch (e) {
    console.warn('[oscour-sos] Cache write failed:', e.message);
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (setCors(req, res)) return;

  try {
    // 1. Try cache first
    const cached = readCache();
    if (cached) {
      console.log('[oscour-sos] Serving from cache (age:', Math.round((Date.now() - cached.cachedAt) / 60000), 'min)');
      res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=600');
      res.setHeader('X-Cache', 'HIT');
      return res.status(200).json({ departements: cached.payload, metadata: { ...cached.meta, cache: 'hit' } });
    }

    // 2. Discover URL dynamically
    const csvUrl = await discoverDepCsvUrl();
    console.log(`[oscour-sos] Fetching: ${csvUrl}`);

    const text = await fetchText(csvUrl, { timeoutMs: 30000 });
    const rows = parseCsv(text);
    console.log(`[oscour-sos] Parsed ${rows.length} rows`);

    const departements = computeTopMotifs(rows);
    console.log(`[oscour-sos] Found ${departements.length} departments with trends`);

    const meta = {
      generated_at: new Date().toISOString(),
      source: csvUrl,
      dataset_id: DATASET_ID,
      rows: rows.length,
      departments_found: departements.length,
      methodology: 'current_7d_vs_previous_28d_threshold_5pct',
      cache: 'miss',
    };

    // 3. Write cache
    writeCache(departements, meta);

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=600');
    res.setHeader('X-Cache', 'MISS');
    return res.status(200).json({ departements, metadata: meta });

  } catch (err) {
    console.error('[api/health/oscour-sos]', err);

    // Try serving stale cache on error
    const stale = readCache();
    if (stale) {
      console.warn('[oscour-sos] Serving stale cache due to error');
      res.setHeader('Cache-Control', 's-maxage=300');
      res.setHeader('X-Cache', 'STALE');
      return res.status(200).json({
        departements: stale.payload,
        metadata: { ...stale.meta, cache: 'stale', error: err.message }
      });
    }

    return res.status(502).json({
      error: 'Failed to fetch OSCOUR/SOS data',
      departements: [],
      details: err instanceof Error ? err.message : String(err),
    });
  }
}
