/**
 * persistentCache.ts — Cache localStorage générique avec TTL, pour peindre
 * l'état connu avant le réseau au rechargement.
 *
 * Généralise le pattern déjà éprouvé de `newsCache.ts` (seul cache
 * persistant du dépôt avant cette extraction) aux autres services critiques
 * — ecowatt, vigilance, vigicrues, nucléaire — qui aujourd'hui ne gardent
 * qu'une variable de module perdue à chaque rechargement (docs/audit-2026-09-
 * annexes/A-client-chargement.md §3, §6 item 6).
 *
 * Clé versionnée : `fm:pc:v{VERSION}:{key}`. Un changement de forme des
 * données stockées se traduit par un bump de `VERSION` : les anciennes
 * entrées ne sont simplement plus lues (elles expirent du quota navigateur
 * naturellement, pas besoin de migration).
 */

const VERSION = 1;
const PREFIX = `fm:pc:v${VERSION}:`;

/** Garde-fou : ne jamais stocker un payload volumineux (GeoJSON, etc.). */
const MAX_VALUE_CHARS = 300_000;

interface PersistedEnvelope<T> {
  v: number;
  savedAt: number;
  value: T;
}

function storageKey(key: string): string {
  return `${PREFIX}${key}`;
}

/**
 * Lit une valeur persistée si elle existe et est encore fraîche
 * (< `maxAgeMs`). `validate`, si fourni, est un type guard : une valeur qui
 * ne le satisfait pas est traitée comme absente et l'entrée corrompue est
 * supprimée.
 *
 * Ne lève jamais : `localStorage` indisponible (SSR, mode privé, désactivé),
 * JSON invalide, quota — tout retourne `null` silencieusement.
 */
export function readPersisted<T>(
  key: string,
  maxAgeMs: number,
  validate?: (value: unknown) => value is T,
): T | null {
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return null;

    const envelope = JSON.parse(raw) as PersistedEnvelope<unknown> | null;
    if (!envelope || envelope.v !== VERSION || typeof envelope.savedAt !== 'number') {
      localStorage.removeItem(storageKey(key));
      return null;
    }

    if (Date.now() - envelope.savedAt > maxAgeMs) {
      localStorage.removeItem(storageKey(key));
      return null;
    }

    if (validate && !validate(envelope.value)) {
      localStorage.removeItem(storageKey(key));
      return null;
    }

    return envelope.value as T;
  } catch {
    return null;
  }
}

/**
 * Écrit une valeur persistée. Ignore silencieusement :
 *  - les valeurs trop volumineuses (> 300 Ko sérialisés) pour ne jamais
 *    saturer le quota localStorage partagé avec le reste de l'app ;
 *  - tout échec d'écriture (quota dépassé, mode privé Safari, localStorage
 *    désactivé ou absent).
 */
export function writePersisted<T>(key: string, value: T): void {
  try {
    const envelope: PersistedEnvelope<T> = { v: VERSION, savedAt: Date.now(), value };
    const serialized = JSON.stringify(envelope);
    if (serialized.length > MAX_VALUE_CHARS) {
      console.warn(`[persistentCache] "${key}" ignoré : ${serialized.length} car. > ${MAX_VALUE_CHARS}`);
      return;
    }
    localStorage.setItem(storageKey(key), serialized);
  } catch {
    // quota dépassé, mode privé, localStorage indisponible — on ignore
  }
}

/** Supprime une entrée persistée (ex: après une invalidation manuelle). */
export function clearPersisted(key: string): void {
  try {
    localStorage.removeItem(storageKey(key));
  } catch {
    // ignore
  }
}
