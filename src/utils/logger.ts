/**
 * logger.ts — Wrapper console conditionnel.
 * En production (import.meta.env.PROD), seuls warn et error sont émis.
 * En dev, tous les niveaux sont actifs.
 *
 * Usage : import { logger } from '@/utils/logger';
 *         logger.log('[MyService] data fetched');
 *         logger.warn('[MyService] degraded mode');
 *         logger.error('[MyService] fetch failed', err);
 */

const IS_DEV = import.meta.env.DEV;

export const logger = {
  log: IS_DEV ? console.log.bind(console) : () => {},
  info: IS_DEV ? console.info.bind(console) : () => {},
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: IS_DEV ? console.debug.bind(console) : () => {},
} as const;
