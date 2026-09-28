// api/_lib/classification-columns.js — colonnes de qualification des articles (spec 2026-09-28 § 4.4).
// Idempotent (ADD COLUMN IF NOT EXISTS) : appelé au début du passage d'ingestion (une fois par
// processus) et par ensureEventTables. Les motifs sont stockés en texte « a,b » ('' si aucun).

/** @param {(strings: TemplateStringsArray, ...params: unknown[]) => Promise<unknown>} sql */
export async function ensureClassificationColumns(sql) {
  await sql`ALTER TABLE news_items ADD COLUMN IF NOT EXISTS reported_severity text`;
  await sql`ALTER TABLE news_items ADD COLUMN IF NOT EXISTS temporality text`;
  await sql`ALTER TABLE news_items ADD COLUMN IF NOT EXISTS zone text`;
  await sql`ALTER TABLE news_items ADD COLUMN IF NOT EXISTS reasons text`;
}

/** @param {readonly string[]} reasons */
export function encodeReasons(reasons) {
  return [...new Set(reasons)].join(',');
}

/** @param {unknown} value */
export function decodeReasons(value) {
  return typeof value === 'string' && value.length > 0 ? value.split(',') : [];
}
