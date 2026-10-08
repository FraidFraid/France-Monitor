// api/_lib/odisse.js : lecture des API Opendatasoft Explore v2.1 (Odissé de Santé publique France ;
// data.economie.gouv.fr pour RappelConso). Règles vérifiées le 03/10/2026 : `limit` ≤ 100 et
// offset + limit ≤ 10 000 (sinon HTTP 400 InvalidRESTParameterError) ; les extractions volumineuses
// passent par exports/json (une requête, sans pagination, ni limit ni offset).
import { HealthFetchError, fetchStrictJson } from './health-http.js';

export const ODISSE_BASE = 'https://odisse.santepubliquefrance.fr/api/explore/v2.1/catalog/datasets';
export const ECONOMIE_BASE = 'https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets';
export const MAX_LIMIT = 100;
export const MAX_WINDOW = 10_000;

function queryString(params) {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') sp.set(key, String(value));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** Littéral de date ODSQL : date'AAAA-MM-JJ' (sans lui, Odissé répond « Incompatible types »). */
export function odsDate(isoDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new RangeError(`date ODSQL invalide : ${isoDate}`);
  return `date'${isoDate}'`;
}

/** Liste ODSQL de chaînes : ('a','b'). Les valeurs viennent du code, jamais de l'utilisateur. */
export function odsList(values) {
  for (const v of values) if (String(v).includes("'")) throw new RangeError(`apostrophe interdite dans ${v}`);
  return `(${values.map((v) => `'${v}'`).join(',')})`;
}

/** URL `records` ; lève RangeError si limit > 100 ou offset + limit > 10 000 (jamais envoyé). */
export function recordsUrl(dataset, { where, select, orderBy, limit = MAX_LIMIT, offset = 0, base = ODISSE_BASE } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new RangeError(`limit ${limit} hors de 1 à ${MAX_LIMIT}`);
  if (!Number.isInteger(offset) || offset < 0 || offset + limit > MAX_WINDOW) {
    throw new RangeError(`offset + limit = ${offset + limit} au-delà de ${MAX_WINDOW}`);
  }
  return `${base}/${dataset}/records${queryString({ select, where, order_by: orderBy, limit, offset })}`;
}

/** URL `exports/json` (toutes les lignes filtrées, sans limit). */
export function exportUrl(dataset, { where, select, orderBy, base = ODISSE_BASE } = {}) {
  return `${base}/${dataset}/exports/json${queryString({ select, where, order_by: orderBy })}`;
}

/** Une page de `records` : { totalCount, results }. */
export async function fetchRecords(dataset, options = {}) {
  const url = recordsUrl(dataset, options);
  const json = await fetchStrictJson(url, { timeoutMs: options.timeoutMs });
  if (!json || !Array.isArray(json.results)) throw new HealthFetchError('réponse Opendatasoft sans « results »', { url, kind: 'parse' });
  return { totalCount: Number.isFinite(json.total_count) ? json.total_count : json.results.length, results: json.results };
}

/** Toutes les lignes par pages de 100, au plus `maxRows`, sans jamais dépasser la fenêtre de 10 000. */
export async function fetchAllRecords(dataset, { maxRows = 1000, ...options } = {}) {
  const rows = [];
  const cap = Math.min(maxRows, MAX_WINDOW);
  for (let offset = 0; offset < cap; offset += MAX_LIMIT) {
    const limit = Math.min(MAX_LIMIT, cap - offset);
    const page = await fetchRecords(dataset, { ...options, limit, offset });
    rows.push(...page.results);
    if (page.results.length < limit || rows.length >= page.totalCount) break;
  }
  return rows;
}

/** Lignes d'un export JSON filtré (une requête). */
export async function fetchExport(dataset, options = {}) {
  const url = exportUrl(dataset, options);
  const json = await fetchStrictJson(url, { timeoutMs: options.timeoutMs ?? 30_000 });
  if (!Array.isArray(json)) throw new HealthFetchError('export Opendatasoft inattendu', { url, kind: 'parse' });
  return json;
}

/** Dates de traitement et de modification d'un jeu (métadonnées `metas.default`). */
export async function fetchDatasetInfo(dataset, { base = ODISSE_BASE, timeoutMs } = {}) {
  const json = await fetchStrictJson(`${base}/${dataset}`, { timeoutMs });
  const metas = json?.metas?.default ?? {};
  return {
    dataProcessed: typeof metas.data_processed === 'string' ? metas.data_processed : null,
    modified: typeof metas.modified === 'string' ? metas.modified : null,
  };
}
