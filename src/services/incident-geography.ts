import type { FireIncident, LocatedFireIncident } from '../types/index.ts';

/**
 * Résolution géographique des incidents feux : rattache département(s) et
 * commune(s) aux coordonnées d'un `FireIncident` via `geo.api.gouv.fr`
 * (point-dans-polygone). Vérifié le 2026-07-27 : la BAN (`api-adresse.data.gouv.fr`)
 * renvoie zéro adresse sur un foyer en forêt non adressée — c'est
 * `geo.api.gouv.fr/communes?lat=&lon=` qu'il faut interroger, jamais la BAN.
 */

/** Taille de maille (degrés) pour mutualiser les appels réseau entre points proches. */
const CELL_SIZE_DEG = 0.05;

/** Nombre d'appels réseau simultanés au maximum. */
const MAX_CONCURRENCY = 4;

/** Délai avant abandon d'un appel individuel à geo.api.gouv.fr. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Résultat de résolution pour une maille : un seul couple département/commune. */
interface CellGeo {
  deptCode: string;
  commune: string;
}

/**
 * Cache single-flight : la valeur stockée est la PROMESSE de résolution, pas
 * le résultat déjà résolu. Deux échantillons voisins qui tombent sur la même
 * maille pendant la même fenêtre de concurrence doivent partager le même appel
 * réseau plutôt que d'en déclencher chacun un.
 */
export interface ResolveGeographyDeps {
  fetchImpl?: typeof fetch;
  cache?: Map<string, Promise<CellGeo | null>>;
}

/**
 * Clé de maille de cache, arrondie à 0,05° : deux points voisins retombent sur
 * la même maille et partagent un seul appel réseau (734 détections réelles se
 * réduisaient à 35 mailles distinctes sur l'épisode Gironde).
 */
export function cellKey(lat: number, lon: number): string {
  const bucket = (v: number): string => (Math.floor(v / CELL_SIZE_DEG) * CELL_SIZE_DEG).toFixed(3);
  return `${bucket(lat)},${bucket(lon)}`;
}

/**
 * Interroge geo.api.gouv.fr pour un point donné. Best-effort : toute erreur
 * réseau ou réponse invalide renvoie `null` sans lever (§7 — une donnée
 * manquante s'affiche comme manquante, jamais comme « France »).
 */
async function lookupCommune(
  lat: number,
  lon: number,
  fetchImpl: typeof fetch,
): Promise<CellGeo | null> {
  try {
    const url = `https://geo.api.gouv.fr/communes?lat=${lat}&lon=${lon}&fields=nom,codeDepartement`;
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) return null;
    // clone() avant lecture : un mock de test peut renvoyer la même Response pour
    // plusieurs appels, et un corps ne se lit qu'une fois sans ce clonage.
    const body = (await response.clone().json()) as Array<{ nom?: string; codeDepartement?: string }>;
    const first = body[0];
    if (!first?.nom || !first?.codeDepartement) return null;
    return { commune: first.nom, deptCode: first.codeDepartement };
  } catch {
    return null;
  }
}

/**
 * Résout un point via le cache de mailles, en single-flight : la promesse est
 * posée dans le cache AVANT toute résolution (donc de façon synchrone, avant le
 * premier `await` de `lookupCommune`), pour que des recherches concurrentes sur
 * la même maille — cas d'un incident compact dont les 5 échantillons retombent
 * dans la même case de 0,05° — partagent le même appel réseau au lieu d'en
 * déclencher chacune un (constaté : 4 appels au lieu de 1 sans cette précaution).
 *
 * Un échec n'est jamais mis en cache durablement : l'entrée est retirée après
 * résolution en `null`, pour qu'un incident ultérieur retente plutôt que de
 * figer la maille en échec pour toute la durée de vie du cache (§7).
 */
function resolvePoint(
  lat: number,
  lon: number,
  fetchImpl: typeof fetch,
  cache: Map<string, Promise<CellGeo | null>>,
): Promise<CellGeo | null> {
  const key = cellKey(lat, lon);
  const inFlightOrResolved = cache.get(key);
  if (inFlightOrResolved) return inFlightOrResolved;

  const promise = lookupCommune(lat, lon, fetchImpl).then((result) => {
    if (!result) cache.delete(key);
    return result;
  });
  cache.set(key, promise);
  return promise;
}

/** Applique `fn` sur `items` par lots, pour borner la concurrence réseau. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    results.push(...(await Promise.all(batch.map(fn))));
  }
  return results;
}

/** Les cinq points échantillonnés pour un incident : centroïde + quatre coins de la bbox. */
function samplePoints(incident: FireIncident): Array<[lat: number, lon: number]> {
  return [
    [incident.centroidLat, incident.centroidLon],
    [incident.bboxMinLat, incident.bboxMinLon],
    [incident.bboxMinLat, incident.bboxMaxLon],
    [incident.bboxMaxLat, incident.bboxMinLon],
    [incident.bboxMaxLat, incident.bboxMaxLon],
  ];
}

/**
 * Résout département(s) et commune(s) pour chaque incident.
 *
 * Échantillonne le centroïde ET les quatre coins de la bbox : sur l'épisode
 * Gironde réel, le seul centroïde donnait « Lanton, Gironde », les coins ont
 * révélé un débordement sur les Landes (§3.5 — un incident peut chevaucher
 * plusieurs départements, le dossier doit tous les porter).
 *
 * Best-effort et jamais bloquant : tout échec réseau laisse `deptCodes`/`communes`
 * vides plutôt que de lever, pour que l'appelant retombe sur les coordonnées.
 */
export async function resolveIncidentGeography(
  incidents: FireIncident[],
  deps: ResolveGeographyDeps = {},
): Promise<LocatedFireIncident[]> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const cache = deps.cache ?? new Map<string, Promise<CellGeo | null>>();

  // Un seul pool de points pour tout le lot, pour que la concurrence bornée (4)
  // profite à l'ensemble des incidents plutôt qu'incident par incident.
  const perIncidentPoints = incidents.map(samplePoints);
  const flatPoints = perIncidentPoints.flat();
  const flatResults = await mapWithConcurrency(flatPoints, MAX_CONCURRENCY, ([lat, lon]) =>
    resolvePoint(lat, lon, fetchImpl, cache),
  );

  const pointsPerIncident = 5; // centroïde + 4 coins, cf. samplePoints()
  return incidents.map((incident, i) => {
    const start = i * pointsPerIncident;
    const results = flatResults.slice(start, start + pointsPerIncident);

    const deptCodes = new Set<string>();
    const communes = new Set<string>();
    for (const result of results) {
      if (!result) continue;
      deptCodes.add(result.deptCode);
      communes.add(result.commune);
    }
    return { ...incident, deptCodes: [...deptCodes], communes: [...communes] };
  });
}
