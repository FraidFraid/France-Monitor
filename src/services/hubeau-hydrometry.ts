import { HYDRO_STATION_BINDINGS, type HydroStationBinding } from '../config/hydro-station-map.ts';
import type {
  CircuitBreakerState,
  HydraulicBackboneAsset,
  HydraulicDataFreshness,
  HydraulicMeasuredSupportLevel,
  HydraulicObservationTrend,
  HydraulicSignalSource,
} from '../types/index.ts';
import { resilientFetch } from '../utils/resilientFetch.ts';

const HUBEAU_STATIONS_URL = 'https://hubeau.eaufrance.fr/api/v2/hydrometrie/referentiel/stations';
const HUBEAU_OBSERVATIONS_URL = 'https://hubeau.eaufrance.fr/api/v2/hydrometrie/observations_tr';

const SNAPSHOT_TTL_MS = 7 * 60_000;
const STALE_TTL_MS = 30 * 60_000;
const STATION_RESOLUTION_TTL_MS = 12 * 60 * 60_000;
const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 5 * 60_000;

type HubeauGrandeur = 'H' | 'Q';
type HydrometrySourceStatus = 'ok' | 'stale' | 'error';
type StationMatchQuality = 'preferred' | 'river' | 'nearest';

interface HubeauListResponse<T> {
  data?: T[];
}

interface HubeauStationRecord {
  code_station: string;
  libelle_station?: string | null;
  libelle_cours_eau?: string | null;
  longitude_station?: number | null;
  latitude_station?: number | null;
  en_service?: boolean | null;
}

interface HubeauObservationRecord {
  code_station: string;
  grandeur_hydro?: HubeauGrandeur | null;
  libelle_station?: string | null;
  date_obs: string;
  resultat_obs: number;
}

interface ResolvedStation {
  codeStation: string;
  stationName: string | null;
  riverName: string | null;
  latitude: number | null;
  longitude: number | null;
  matchQuality: StationMatchQuality;
  distanceKm: number | null;
}

interface ResolvedAssetStations {
  assetId: string;
  note: string | null;
  stations: ResolvedStation[];
  usedRiverMatch: boolean;
}

interface EvaluatedStationMeasurement {
  stationCode: string;
  stationName: string | null;
  riverName: string | null;
  quantity: HubeauGrandeur;
  observedAt: string;
  latestValue: number;
  baselineValue: number | null;
  deltaRatio: number | null;
  trend: HydraulicObservationTrend;
  ageMinutes: number | null;
  matchQuality: StationMatchQuality;
}

export interface AssetHydrometrySupport {
  assetId: string;
  stationCodes: string[];
  resolvedStationCount: number;
  observedStationCount: number;
  signalSource: HydraulicSignalSource;
  dataFreshness: HydraulicDataFreshness;
  measuredSupportLevel: HydraulicMeasuredSupportLevel;
  hydroTrend: HydraulicObservationTrend;
  observationTimestamp: string | null;
  observationAgeMinutes: number | null;
  confidence: number;
  measuredStressAdjustment: number;
  detail: string | null;
  note: string | null;
}

export interface HydraulicHydrometrySnapshot {
  source: 'HubEau hydrometrie';
  sourceStatus: HydrometrySourceStatus;
  fetchedAt: string;
  lastUpdated: string | null;
  maxObservationAgeMinutes: number | null;
  detail: string;
  disclaimer: string;
  assets: Record<string, AssetHydrometrySupport>;
}

let snapshotCache: { data: HydraulicHydrometrySnapshot; fetchedAt: number } | null = null;
let inFlightSnapshot: Promise<HydraulicHydrometrySnapshot> | null = null;

const circuitBreaker: CircuitBreakerState = {
  failureCount: 0,
  cooldownUntil: 0,
  isOpen: false,
};

const stationResolutionCache = new Map<string, { data: ResolvedAssetStations; fetchedAt: number }>();

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalize(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (value: number): number => (value * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function buildFallbackSnapshot(
  assets: HydraulicBackboneAsset[],
  sourceStatus: HydrometrySourceStatus,
  detail: string,
  base?: HydraulicHydrometrySnapshot | null,
): HydraulicHydrometrySnapshot {
  const nowIso = new Date().toISOString();
  const fallbackAssets: Record<string, AssetHydrometrySupport> = {};

  for (const asset of assets) {
    fallbackAssets[asset.id] = base?.assets[asset.id] ?? {
      assetId: asset.id,
      stationCodes: [],
      resolvedStationCount: 0,
      observedStationCount: 0,
      signalSource: 'DERIVED_CONTEXT_ONLY',
      dataFreshness: 'unavailable',
      measuredSupportLevel: 'none',
      hydroTrend: 'unavailable',
      observationTimestamp: null,
      observationAgeMinutes: null,
      confidence: 0.25,
      measuredStressAdjustment: 0,
      detail: null,
      note: null,
    };
  }

  return {
    source: 'HubEau hydrometrie',
    sourceStatus,
    fetchedAt: base?.fetchedAt ?? nowIso,
    lastUpdated: base?.lastUpdated ?? null,
    maxObservationAgeMinutes: base?.maxObservationAgeMinutes ?? null,
    detail,
    disclaimer: 'Observations hydrométriques Hub’Eau en appui OSINT, pas de télémesure EDF barrage par barrage.',
    assets: fallbackAssets,
  };
}

function classifyFreshness(ageMinutes: number | null): HydraulicDataFreshness {
  if (ageMinutes == null) return 'unavailable';
  if (ageMinutes <= 90) return 'fresh';
  if (ageMinutes <= 360) return 'aging';
  return 'stale';
}

function classifyTrend(deltaRatio: number | null): HydraulicObservationTrend {
  if (deltaRatio == null) return 'unavailable';
  if (deltaRatio >= 0.08) return 'rising';
  if (deltaRatio <= -0.08) return 'falling';
  return 'stable';
}

function computeMeasuredStressAdjustment(
  trend: HydraulicObservationTrend,
  intensity: number,
  freshness: HydraulicDataFreshness,
): number {
  if (freshness === 'unavailable') return 0;

  const freshPenalty = freshness === 'stale' ? 0.4 : freshness === 'aging' ? 0.75 : 1;
  const magnitude = intensity >= 0.45
    ? 2.6
    : intensity >= 0.22
      ? 1.6
      : intensity >= 0.10
        ? 0.8
        : 0;

  if (trend === 'rising' || trend === 'falling' || trend === 'mixed') {
    return magnitude * freshPenalty;
  }

  if (trend === 'stable') {
    return freshness === 'fresh' ? -0.5 : -0.2;
  }

  return 0;
}

function pickObservationSeries(
  rowsByStationAndQuantity: Map<string, HubeauObservationRecord[]>,
  station: ResolvedStation,
): EvaluatedStationMeasurement | null {
  const qSeries = rowsByStationAndQuantity.get(`${station.codeStation}:Q`) ?? [];
  const hSeries = rowsByStationAndQuantity.get(`${station.codeStation}:H`) ?? [];
  const series = qSeries.length >= 2 ? qSeries : hSeries.length >= 2 ? hSeries : qSeries.length > 0 ? qSeries : hSeries;

  if (series.length === 0) return null;

  const latest = series[0];
  const baseline = series[Math.min(series.length - 1, 4)] ?? null;
  const quantity = (latest.grandeur_hydro ?? (qSeries.length > 0 ? 'Q' : 'H')) as HubeauGrandeur;
  const scaleFloor = quantity === 'Q' ? 5000 : 200;
  const scale = Math.max(scaleFloor, ...series.map((entry) => Math.abs(entry.resultat_obs)));
  const deltaRatio = baseline ? (latest.resultat_obs - baseline.resultat_obs) / scale : null;
  const observedAt = latest.date_obs;
  const observedDate = new Date(observedAt);
  const ageMinutes = Number.isNaN(observedDate.getTime())
    ? null
    : Math.max(0, Math.round((Date.now() - observedDate.getTime()) / 60_000));

  return {
    stationCode: station.codeStation,
    stationName: latest.libelle_station ?? station.stationName,
    riverName: station.riverName,
    quantity,
    observedAt,
    latestValue: latest.resultat_obs,
    baselineValue: baseline?.resultat_obs ?? null,
    deltaRatio,
    trend: classifyTrend(deltaRatio),
    ageMinutes,
    matchQuality: station.matchQuality,
  };
}

function evaluateAssetSupport(
  asset: HydraulicBackboneAsset,
  resolution: ResolvedAssetStations,
  rowsByStationAndQuantity: Map<string, HubeauObservationRecord[]>,
): AssetHydrometrySupport {
  const measurements = resolution.stations
    .map((station) => pickObservationSeries(rowsByStationAndQuantity, station))
    .filter((measurement): measurement is EvaluatedStationMeasurement => measurement != null);

  if (measurements.length === 0) {
    return {
      assetId: asset.id,
      stationCodes: resolution.stations.map((station) => station.codeStation),
      resolvedStationCount: resolution.stations.length,
      observedStationCount: 0,
      signalSource: 'DERIVED_CONTEXT_ONLY',
      dataFreshness: 'unavailable',
      measuredSupportLevel: 'none',
      hydroTrend: 'unavailable',
      observationTimestamp: null,
      observationAgeMinutes: null,
      confidence: resolution.stations.length > 0 ? 0.35 : 0.25,
      measuredStressAdjustment: 0,
      detail: resolution.stations.length > 0 ? 'Stations Hub’Eau résolues mais sans mesure exploitable récente.' : null,
      note: resolution.note,
    };
  }

  const latestMeasurement = measurements.reduce((best, current) => {
    if (!best) return current;
    return new Date(current.observedAt) > new Date(best.observedAt) ? current : best;
  }, null as EvaluatedStationMeasurement | null);

  const observationAgeMinutes = latestMeasurement?.ageMinutes ?? null;
  const dataFreshness = classifyFreshness(observationAgeMinutes);
  const weightedDelta = measurements.reduce((sum, measurement) => {
    const baseWeight = measurement.matchQuality === 'preferred'
      ? 1
      : measurement.matchQuality === 'river'
        ? 0.9
        : 0.65;
    return sum + (measurement.deltaRatio ?? 0) * baseWeight;
  }, 0);
  const totalWeight = measurements.reduce((sum, measurement) => {
    return sum + (measurement.matchQuality === 'preferred'
      ? 1
      : measurement.matchQuality === 'river'
        ? 0.9
        : 0.65);
  }, 0);
  const aggregatedDelta = totalWeight > 0 ? weightedDelta / totalWeight : 0;
  const maxAbsDelta = measurements.reduce((max, measurement) => {
    return Math.max(max, Math.abs(measurement.deltaRatio ?? 0));
  }, 0);
  const positiveCount = measurements.filter((measurement) => (measurement.deltaRatio ?? 0) >= 0.08).length;
  const negativeCount = measurements.filter((measurement) => (measurement.deltaRatio ?? 0) <= -0.08).length;
  const hydroTrend: HydraulicObservationTrend =
    positiveCount > 0 && negativeCount > 0
      ? 'mixed'
      : classifyTrend(aggregatedDelta);

  const measuredSupportLevel: HydraulicMeasuredSupportLevel =
    measurements.length >= 2 && dataFreshness === 'fresh'
      ? 'strong'
      : resolution.stations.length > 0
        ? 'partial'
        : 'none';
  const measuredStressAdjustment = computeMeasuredStressAdjustment(hydroTrend, maxAbsDelta, dataFreshness);
  let confidence = 0.28;
  confidence += resolution.usedRiverMatch ? 0.18 : 0.08;
  confidence += measurements.length >= 2 ? 0.18 : 0.10;
  confidence += dataFreshness === 'fresh' ? 0.18 : dataFreshness === 'aging' ? 0.10 : 0.02;
  if (hydroTrend === 'mixed') confidence -= 0.08;
  confidence = clamp(confidence, 0.25, 0.92);

  const stationList = measurements
    .map((measurement) => measurement.stationName ?? measurement.stationCode)
    .slice(0, 2)
    .join(' · ');
  const detail = stationList
    ? `${measurements.length} station${measurements.length > 1 ? 's' : ''} Hub’Eau (${stationList})`
    : `${measurements.length} station${measurements.length > 1 ? 's' : ''} Hub’Eau`;

  return {
    assetId: asset.id,
    stationCodes: resolution.stations.map((station) => station.codeStation),
    resolvedStationCount: resolution.stations.length,
    observedStationCount: measurements.length,
    signalSource: 'DERIVED_REAL_MEASURE_SUPPORT',
    dataFreshness,
    measuredSupportLevel,
    hydroTrend,
    observationTimestamp: latestMeasurement?.observedAt ?? null,
    observationAgeMinutes,
    confidence,
    measuredStressAdjustment,
    detail,
    note: resolution.note,
  };
}

async function resolveStationsForAsset(
  asset: HydraulicBackboneAsset,
  binding: HydroStationBinding,
): Promise<ResolvedAssetStations> {
  const cached = stationResolutionCache.get(asset.id);
  if (cached && Date.now() - cached.fetchedAt < STATION_RESOLUTION_TTL_MS) {
    return cached.data;
  }

  if ((binding.preferredStationCodes?.length ?? 0) > 0) {
    const preferred = {
      assetId: asset.id,
      note: binding.note ?? null,
      usedRiverMatch: true,
      stations: (binding.preferredStationCodes ?? []).slice(0, binding.maxStations ?? 3).map((codeStation) => ({
        codeStation,
        stationName: null,
        riverName: asset.river ?? null,
        latitude: null,
        longitude: null,
        matchQuality: 'preferred' as const,
        distanceKm: null,
      })),
    };
    stationResolutionCache.set(asset.id, { data: preferred, fetchedAt: Date.now() });
    return preferred;
  }

  const params = new URLSearchParams({
    longitude: String(asset.location.lon),
    latitude: String(asset.location.lat),
    distance: String(binding.distanceKm),
    size: String(Math.max(12, (binding.maxStations ?? 2) * 8)),
    fields: 'code_station,libelle_station,libelle_cours_eau,longitude_station,latitude_station,en_service',
  });
  const response = await resilientFetch<HubeauListResponse<HubeauStationRecord>>(
    `${HUBEAU_STATIONS_URL}?${params.toString()}`,
    { timeout: 8000, retries: 1, retryDelay: 600 },
  );

  const rows = response.ok && response.data?.data ? response.data.data : [];
  const normalizedRivers = (binding.riverNames ?? [asset.river ?? ''])
    .map((name) => normalize(name))
    .filter(Boolean);

  const candidates = rows
    .filter((row) => row.code_station && row.en_service !== false)
    .map((row) => {
      const latitude = typeof row.latitude_station === 'number' ? row.latitude_station : null;
      const longitude = typeof row.longitude_station === 'number' ? row.longitude_station : null;
      const distanceKm = latitude != null && longitude != null
        ? haversineKm(asset.location.lat, asset.location.lon, latitude, longitude)
        : null;
      const riverMatch = normalizedRivers.some((river) => {
        const stationRiver = normalize(row.libelle_cours_eau);
        return stationRiver.includes(river) || river.includes(stationRiver);
      });

      return {
        codeStation: row.code_station,
        stationName: row.libelle_station ?? null,
        riverName: row.libelle_cours_eau ?? null,
        latitude,
        longitude,
        distanceKm,
        riverMatch,
      };
    })
    .sort((a, b) => {
      if (a.riverMatch !== b.riverMatch) return a.riverMatch ? -1 : 1;
      return (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY);
    });

  const maxStations = binding.maxStations ?? 2;
  const riverMatches = candidates.filter((candidate) => candidate.riverMatch).slice(0, maxStations);
  const chosen = (riverMatches.length > 0 ? riverMatches : candidates.slice(0, maxStations)).map((candidate) => ({
    codeStation: candidate.codeStation,
    stationName: candidate.stationName,
    riverName: candidate.riverName,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    matchQuality: candidate.riverMatch ? 'river' as const : 'nearest' as const,
    distanceKm: candidate.distanceKm,
  }));

  const resolved: ResolvedAssetStations = {
    assetId: asset.id,
    note: binding.note ?? null,
    usedRiverMatch: riverMatches.length > 0,
    stations: chosen,
  };

  stationResolutionCache.set(asset.id, { data: resolved, fetchedAt: Date.now() });
  return resolved;
}

async function fetchObservations(
  stationCodes: string[],
  quantity: HubeauGrandeur,
): Promise<HubeauObservationRecord[]> {
  if (stationCodes.length === 0) return [];

  const params = new URLSearchParams({
    code_entite: stationCodes.join(','),
    grandeur_hydro: quantity,
    sort: 'desc',
    size: String(Math.min(600, Math.max(40, stationCodes.length * 8))),
    fields: 'code_station,libelle_station,date_obs,resultat_obs,grandeur_hydro',
  });

  const response = await resilientFetch<HubeauListResponse<HubeauObservationRecord>>(
    `${HUBEAU_OBSERVATIONS_URL}?${params.toString()}`,
    { timeout: 9000, retries: 1, retryDelay: 700 },
  );

  return response.ok && response.data?.data ? response.data.data : [];
}

async function loadHydrometrySnapshot(assets: HydraulicBackboneAsset[]): Promise<HydraulicHydrometrySnapshot> {
  const mappedAssets = assets.filter((asset) => HYDRO_STATION_BINDINGS[asset.id]);
  if (mappedAssets.length === 0) {
    return buildFallbackSnapshot(assets, 'stale', 'Aucun mapping Hub’Eau configuré pour la sélection hydraulique.');
  }

  const resolutions = await Promise.all(
    mappedAssets.map((asset) => resolveStationsForAsset(asset, HYDRO_STATION_BINDINGS[asset.id])),
  );
  const stationCodes = [...new Set(resolutions.flatMap((resolution) => resolution.stations.map((station) => station.codeStation)))];

  if (stationCodes.length === 0) {
    return buildFallbackSnapshot(assets, 'stale', 'Aucune station Hub’Eau résolue pour les actifs configurés.');
  }

  const [hRows, qRows] = await Promise.all([
    fetchObservations(stationCodes, 'H'),
    fetchObservations(stationCodes, 'Q'),
  ]);
  const rowsByStationAndQuantity = new Map<string, HubeauObservationRecord[]>();

  for (const row of [...hRows, ...qRows]) {
    const quantity = row.grandeur_hydro ?? 'H';
    const key = `${row.code_station}:${quantity}`;
    const bucket = rowsByStationAndQuantity.get(key) ?? [];
    bucket.push(row);
    rowsByStationAndQuantity.set(key, bucket);
  }

  for (const bucket of rowsByStationAndQuantity.values()) {
    bucket.sort((a, b) => new Date(b.date_obs).getTime() - new Date(a.date_obs).getTime());
  }

  const supports: Record<string, AssetHydrometrySupport> = {};
  for (const asset of assets) {
    const resolution = resolutions.find((item) => item.assetId === asset.id);
    supports[asset.id] = resolution
      ? evaluateAssetSupport(asset, resolution, rowsByStationAndQuantity)
      : {
          assetId: asset.id,
          stationCodes: [],
          resolvedStationCount: 0,
          observedStationCount: 0,
          signalSource: 'DERIVED_CONTEXT_ONLY',
          dataFreshness: 'unavailable',
          measuredSupportLevel: 'none',
          hydroTrend: 'unavailable',
          observationTimestamp: null,
          observationAgeMinutes: null,
          confidence: 0.25,
          measuredStressAdjustment: 0,
          detail: null,
          note: null,
        };
  }

  const timestamps = Object.values(supports)
    .map((support) => support.observationTimestamp)
    .filter((timestamp): timestamp is string => Boolean(timestamp))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  const ageValues = Object.values(supports)
    .map((support) => support.observationAgeMinutes)
    .filter((age): age is number => age != null);
  const observedAssets = Object.values(supports).filter((support) => support.observedStationCount > 0).length;
  const detail = `${observedAssets}/${assets.length} actifs avec appui hydrométrique exploitable`;

  return {
    source: 'HubEau hydrometrie',
    sourceStatus: observedAssets > 0 ? 'ok' : 'stale',
    fetchedAt: new Date().toISOString(),
    lastUpdated: timestamps[0] ?? null,
    maxObservationAgeMinutes: ageValues.length > 0 ? Math.max(...ageValues) : null,
    detail,
    disclaimer: 'Observations hydrométriques Hub’Eau en appui OSINT, pas de télémesure EDF barrage par barrage.',
    assets: supports,
  };
}

function recordFailure(): void {
  circuitBreaker.failureCount += 1;
  if (circuitBreaker.failureCount >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitBreaker.isOpen = true;
    circuitBreaker.cooldownUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
  }
}

function resetCircuitBreaker(): void {
  circuitBreaker.failureCount = 0;
  circuitBreaker.cooldownUntil = 0;
  circuitBreaker.isOpen = false;
}

export async function fetchHydraulicHydrometrySnapshot(
  assets: HydraulicBackboneAsset[],
): Promise<HydraulicHydrometrySnapshot> {
  const now = Date.now();
  if (snapshotCache && now - snapshotCache.fetchedAt < SNAPSHOT_TTL_MS) {
    return snapshotCache.data;
  }

  if (circuitBreaker.isOpen && now < circuitBreaker.cooldownUntil) {
    console.warn('[HubEau/Hydrometrie] Circuit breaker open, using cached/fallback snapshot');
    return buildFallbackSnapshot(
      assets,
      snapshotCache && now - snapshotCache.fetchedAt < STALE_TTL_MS ? 'stale' : 'error',
      'Hub’Eau en cooldown temporaire ; maintien du signal dérivé local.',
      snapshotCache?.data ?? null,
    );
  }

  if (inFlightSnapshot) return inFlightSnapshot;

  inFlightSnapshot = (async () => {
    try {
      const snapshot = await loadHydrometrySnapshot(assets);
      snapshotCache = { data: snapshot, fetchedAt: Date.now() };
      resetCircuitBreaker();
      console.info(`[HubEau/Hydrometrie] ${snapshot.detail}`);
      return snapshot;
    } catch (error) {
      recordFailure();
      console.warn('[HubEau/Hydrometrie] Snapshot fetch failed:', error);
      const staleStatus = snapshotCache && now - snapshotCache.fetchedAt < STALE_TTL_MS ? 'stale' : 'error';
      return buildFallbackSnapshot(
        assets,
        staleStatus,
        'Hub’Eau indisponible ; maintien de la logique hydraulique dérivée.',
        snapshotCache?.data ?? null,
      );
    } finally {
      inFlightSnapshot = null;
    }
  })();

  return inFlightSnapshot;
}
