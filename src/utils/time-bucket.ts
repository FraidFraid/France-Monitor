// src/utils/time-bucket.ts — bornes temporelles arrondies pour les requêtes /api/*.
// Une borne calculée à la milliseconde donne une URL unique par visiteur :
// le cache Cloudflare ne sert jamais la réponse et chaque appel relit Neon.

export const HOUR_MS = 60 * 60_000;

/** Arrondit `ms` au début de sa tranche de `bucketMs`. */
export function floorToBucket(ms: number, bucketMs: number): number {
  return Math.floor(ms / bucketMs) * bucketMs;
}
