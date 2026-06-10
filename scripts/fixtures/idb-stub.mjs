/**
 * Stub du package `idb` pour les bundles serveur (api/_lib/server-geocoder.js).
 * IndexedDB est browser-only ; côté serveur le geocoder utilise un cache Map.
 * `getDB()` dans src/services/geocoder.ts garde `typeof window === 'undefined'`
 * → openDB n'est jamais appelé côté serveur. Ce stub n'existe que pour
 * satisfaire l'import statique lors du bundling esbuild.
 */
export function openDB() {
  return Promise.reject(new Error('idb is not available server-side'));
}
