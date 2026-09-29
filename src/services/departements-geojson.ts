// src/services/departements-geojson.ts — chargeur mémorisé de /data/departements.geojson (3,3 Mo),
// partagé par la carte (couches météo, santé…) et l'index des départements du fil : un seul
// téléchargement, une seule analyse. L'objet rendu est partagé : le copier avant de le modifier.

let cached: Promise<GeoJSON.FeatureCollection | null> | null = null;

export function loadDepartementsGeojson(fetchImpl: typeof fetch = fetch): Promise<GeoJSON.FeatureCollection | null> {
  cached ??= fetchImpl('/data/departements.geojson')
    .then((res) => (res.ok ? (res.json() as Promise<GeoJSON.FeatureCollection>) : null))
    .catch((error: unknown) => {
      console.warn('[departements] chargement impossible', error);
      return null;
    })
    .then((body) => {
      // Un échec n'est pas mémorisé : le prochain appel réessaie.
      if (body === null) cached = null;
      return body;
    });
  return cached;
}

/** Tests : repart d'un cache vide. */
export function resetDepartementsGeojsonCache(): void {
  cached = null;
}
