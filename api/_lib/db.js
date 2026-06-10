/**
 * api/_lib/db.js — Helpers DB (Neon Postgres) + utilitaires d'ingestion.
 * Node runtime uniquement (node:crypto, @neondatabase/serverless).
 */

import { createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';

/** @type {ReturnType<typeof neon> | null} */
let _sql = null;

/**
 * Retourne le client SQL Neon (tagged-template + .query()).
 * Lève une erreur claire si DATABASE_URL est absent — à appeler
 * UNIQUEMENT dans le handler (jamais au chargement du module).
 * @returns {ReturnType<typeof neon>}
 */
export function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set — configure the Neon Postgres connection string');
  }
  if (!_sql) {
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}

/** @returns {boolean} */
export function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL);
}

/**
 * Hash de dédoublonnage d'un item news : sha256(feedId|link|title), hex.
 * @param {string} feedId
 * @param {string} link
 * @param {string} title
 * @returns {string}
 */
export function contentHash(feedId, link, title) {
  return createHash('sha256').update(`${feedId}|${link}|${title}`, 'utf8').digest('hex');
}

/** Backoff feed en échec : 2 min → 5 min → 10 min (plafonné). */
const BACKOFF_STEPS_MS = [2 * 60_000, 5 * 60_000, 10 * 60_000];

/**
 * Durée de cooldown (ms) après `consecutiveFailures` échecs consécutifs.
 * 0 échec → 0 ms ; 1 → 2 min ; 2 → 5 min ; ≥3 → 10 min (plafond).
 * Fonction pure (testée par scripts/test-ingest.mjs).
 * @param {number} consecutiveFailures
 * @returns {number}
 */
export function computeBackoffMs(consecutiveFailures) {
  if (!Number.isFinite(consecutiveFailures) || consecutiveFailures <= 0) return 0;
  const idx = Math.min(Math.floor(consecutiveFailures), BACKOFF_STEPS_MS.length) - 1;
  return BACKOFF_STEPS_MS[idx];
}

/**
 * Slug déterministe (kebab-case, sans accents) pour les ids de feeds.
 * "L'Obs" → "l-obs", "NC la 1ère" → "nc-la-1ere".
 * @param {string} name
 * @returns {string}
 */
export function slugifyFeedId(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
