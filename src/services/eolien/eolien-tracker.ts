import type { Feature, Geometry, GeoJsonProperties } from 'geojson';
import type {
  EolienLive,
  EolienLiveApiResponse,
  EolienParkKind,
  EolienParkStatus,
  EolienParkSummary,
  EolienParcsGeoJSON,
  EolienTerreMerSplit,
  EolienTrackerSnapshot,
} from './types.ts';

const DEFAULT_LIVE_ENDPOINT = '/api/energy/eolien';
const DEFAULT_PARKS_ENDPOINT = '/api/energy/eolien?parks=1';
const DEFAULT_FALLBACK_PARKS_ENDPOINT = '/data/eolien-france.geojson';
const DEFAULT_ALERT_THRESHOLD_GW = 5;
const DEFAULT_CACHE_TTL_MS = 60 * 60_000;
// Source : France Renouvelables / SDES — puissance raccordée fin 2025
// 24,1 GW terrestre + 2,0 GW offshore = 26,1 GW total
const DEFAULT_INSTALLED_GW = 26.1;

const ACTIVE_STATUSES = new Set<EolienParkStatus>(['operating', 'construction', 'authorized']);

interface EolienTrackerOptions {
  liveEndpoint?: string;
  parksEndpoint?: string;
  cacheTtlMs?: number;
  fallbackInstalledGw?: number;
  alertThresholdGw?: number;
  fetchImpl?: typeof fetch;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function emptyGeoJSON(): EolienParcsGeoJSON {
  return { type: 'FeatureCollection', features: [] };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickString(props: GeoJsonProperties | null | undefined, keys: string[]): string | null {
  if (!props) return null;
  for (const key of keys) {
    const value = props[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

function pickNumber(props: GeoJsonProperties | null | undefined, keys: string[]): number | null {
  if (!props) return null;
  for (const key of keys) {
    const value = props[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const normalized = value.replace(/\s/g, '').replace(',', '.');
      const parsed = Number.parseFloat(normalized);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function normalizeStatus(rawStatus: string | null, enService?: string | null): EolienParkStatus {
  // Priority: en_service field trumps etat_mat when explicit
  if (enService) {
    const es = enService.toLowerCase().trim();
    if (es === 'oui' || es === 'co') return 'operating';
  }
  if (!rawStatus) return 'unknown';
  const value = rawStatus.toLowerCase().trim();
  if (value === 'co') return 'operating';
  if (value === 'au') return 'authorized';
  if (value === 'dm') return 'inactive';
  if (value === 'nco' || value === 'nco_autre') return 'project';
  if (
    value.includes('exploit') ||
    value.includes('service') ||
    value.includes('actif') ||
    value.includes('operat') ||
    value === 'oui' ||
    value.includes('construite') ||
    value.includes('mise en service')
  ) return 'operating';
  if (value.includes('construct') || value.includes('chantier')) return 'construction';
  if (value.includes('autor') || value.includes('accord')) return 'authorized';
  if (value.includes('projet') || value.includes('instruction') || value.includes('etude')) return 'project';
  if (value.includes('arrêt') || value.includes('arret') || value.includes('démant') || value.includes('demant') || value.includes('inactive')) return 'inactive';
  return 'unknown';
}

function humanizeLayer(rawLayer: string | null): string | null {
  if (!rawLayer) return null;
  const cleaned = rawLayer
    .replace(/^eolien_/, '')
    .replace(/_/g, ' ')
    .trim();
  if (!cleaned) return null;
  return cleaned.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function humanizeRegion(rawRegion: string | null): string | null {
  if (!rawRegion) return null;
  const normalized = rawRegion.trim();
  const labels: Record<string, string> = {
    '11': 'Île-de-France',
    '24': 'Centre-Val de Loire',
    '27': 'Bourgogne-Franche-Comté',
    '28': 'Normandie',
    '32': 'Hauts-de-France',
    '44': 'Grand Est',
    '52': 'Pays de la Loire',
    '53': 'Bretagne',
    '75': 'Nouvelle-Aquitaine',
    '76': 'Occitanie',
    '84': 'Auvergne-Rhône-Alpes',
    '93': 'Provence-Alpes-Côte d’Azur',
    '94': 'Corse',
  };
  return labels[normalized] ?? normalized;
}

function normalizeName(rawName: string | null, groupId: string, layer: string | null): string {
  const trimmed = rawName?.trim();
  if (trimmed) return trimmed;
  const layerLabel = humanizeLayer(layer);
  if (groupId) return `Parc éolien ${groupId}${layerLabel ? ` (${layerLabel})` : ''}`;
  if (layerLabel) return `Parc éolien ${layerLabel}`;
  return 'Parc éolien';
}

function mergeStatus(current: EolienParkStatus, next: EolienParkStatus): EolienParkStatus {
  const rank: Record<EolienParkStatus, number> = {
    operating: 6,
    construction: 5,
    authorized: 4,
    project: 3,
    inactive: 2,
    unknown: 1,
  };
  return rank[next] > rank[current] ? next : current;
}

function normalizeKind(props: GeoJsonProperties | null | undefined): EolienParkKind {
  const marker = [
    pickString(props, ['kind', 'type_implantation', 'implantation', 'nature', 'type_parc']),
    String(props?.['en_mer'] ?? ''),
    String(props?.['offshore'] ?? ''),
    String(props?.['layer'] ?? ''),
    String(props?.['id_aerogenerateur'] ?? ''),
    String(props?.['id_parc'] ?? ''),
  ].join(' ').toLowerCase();

  if (marker.includes('mer') || marker.includes('offshore') || marker.includes('marin')) return 'offshore';
  if (props?.['id_aerogenerateur'] != null || props?.['puissance_mw'] != null || props?.['statut_parc'] != null) return 'onshore';
  if (marker.includes('eolien_')) return 'onshore';
  if (marker.includes('terre') || marker.includes('onshore') || marker.includes('terrestre')) return 'onshore';
  return 'unknown';
}

function isParkLikeFeature(feature: Feature<Geometry, GeoJsonProperties>): boolean {
  const props = feature.properties;
  const layer = pickString(props, ['layer']) ?? '';

  // Any feature from an eolien_ layer is a valid wind asset
  if (layer.startsWith('eolien_')) return true;

  const haystack = [
    pickString(props, ['type', 'nature', 'categorie', 'category']),
    pickString(props, ['nom_parc', 'name', 'nom', 'libelle']),
    pickString(props, ['type_objet', 'objet']),
  ].filter(Boolean).join(' ').toLowerCase();

  const hasParkKey = Boolean(
    props &&
    (
      props['id'] != null ||
      props['id_parc'] != null ||
      (typeof props['nom_parc'] === 'string' && props['nom_parc'].trim()) ||
      props['code_parc'] != null ||
      props['parc_id'] != null ||
      props['capacityMw'] != null ||
      props['capacity_mw'] != null ||
      props['kind'] != null
    )
  );

  const looksLikeTurbineOnly =
    haystack.includes('éolienne') ||
    haystack.includes('eolienne') ||
    haystack.includes('turbine');
  const looksLikePoste =
    haystack.includes('poste') ||
    haystack.includes('livraison');
  const looksLikePark =
    hasParkKey ||
    haystack.includes('parc') ||
    haystack.includes('ferme');

  if (looksLikePoste) return false;
  if (looksLikeTurbineOnly && !looksLikePark) return false;
  if (looksLikePark) return true;

  return feature.geometry.type !== 'Point';
}

function centroidForGeometry(geometry: Geometry): [number, number] | null {
  switch (geometry.type) {
    case 'Point':
      return geometry.coordinates as [number, number];
    case 'MultiPoint':
      return geometry.coordinates[0] as [number, number] | undefined ?? null;
    case 'LineString': {
      const mid = geometry.coordinates[Math.floor(geometry.coordinates.length / 2)];
      return mid as [number, number] | undefined ?? null;
    }
    case 'MultiLineString': {
      const first = geometry.coordinates[0];
      if (!first?.length) return null;
      return first[Math.floor(first.length / 2)] as [number, number];
    }
    case 'Polygon': {
      const ring = geometry.coordinates[0];
      if (!ring?.length) return null;
      const [sumLng, sumLat] = ring.reduce<[number, number]>(
        (acc, [lng, lat]) => [acc[0] + lng, acc[1] + lat],
        [0, 0],
      );
      return [sumLng / ring.length, sumLat / ring.length];
    }
    case 'MultiPolygon': {
      const ring = geometry.coordinates[0]?.[0];
      if (!ring?.length) return null;
      const [sumLng, sumLat] = ring.reduce<[number, number]>(
        (acc, [lng, lat]) => [acc[0] + lng, acc[1] + lat],
        [0, 0],
      );
      return [sumLng / ring.length, sumLat / ring.length];
    }
    default:
      return null;
  }
}

function estimateSplitFromCapacity(parks: EolienParkSummary[], productionGw: number): EolienTerreMerSplit | undefined {
  const onshoreMw = parks
    .filter((park) => park.kind !== 'offshore' && ACTIVE_STATUSES.has(park.status))
    .reduce((sum, park) => sum + (park.capacityMw ?? 0), 0);
  const offshoreMw = parks
    .filter((park) => park.kind === 'offshore' && ACTIVE_STATUSES.has(park.status))
    .reduce((sum, park) => sum + (park.capacityMw ?? 0), 0);
  const totalMw = onshoreMw + offshoreMw;
  if (totalMw <= 0) return undefined;

  return {
    terre: Number(((productionGw * onshoreMw) / totalMw).toFixed(2)),
    mer: Number(((productionGw * offshoreMw) / totalMw).toFixed(2)),
  };
}

function computeSplitFactor(
  park: EolienParkSummary,
  baseFactor: number,
  split: EolienTerreMerSplit | undefined,
  parks: EolienParkSummary[],
): number {
  if (!split || !park.capacityMw || park.capacityMw <= 0) return baseFactor;

  const relevant = parks.filter((candidate) =>
    ACTIVE_STATUSES.has(candidate.status) &&
    candidate.kind === park.kind &&
    (candidate.capacityMw ?? 0) > 0,
  );
  const installedMw = relevant.reduce((sum, candidate) => sum + (candidate.capacityMw ?? 0), 0);
  if (installedMw <= 0) return baseFactor;

  const productionMw = park.kind === 'offshore' ? split.mer * 1000 : split.terre * 1000;
  return clamp(productionMw / installedMw, 0, 1);
}

function aggregateParks(points: EolienParkSummary[]): EolienParkSummary[] {
  const grouped = new Map<string, { park: EolienParkSummary; count: number; sumLng: number; sumLat: number }>();

  for (const point of points) {
    const existing = grouped.get(point.groupId);
    if (!existing) {
      grouped.set(point.groupId, {
        park: {
          ...point,
          id: point.groupId,
          sourceType: 'park',
          turbineCount: point.sourceType === 'turbine' ? 1 : point.turbineCount,
        },
        count: 1,
        sumLng: point.coordinates[0],
        sumLat: point.coordinates[1],
      });
      continue;
    }

    existing.count += 1;
    existing.sumLng += point.coordinates[0];
    existing.sumLat += point.coordinates[1];
    existing.park.status = mergeStatus(existing.park.status, point.status);

    if ((existing.park.capacityMw ?? null) != null || point.capacityMw != null) {
      existing.park.capacityMw = Number(((existing.park.capacityMw ?? 0) + (point.capacityMw ?? 0)).toFixed(2));
    }

    const existingTurbines = existing.park.turbineCount ?? 0;
    const nextTurbines = point.sourceType === 'turbine' ? 1 : (point.turbineCount ?? 0);
    existing.park.turbineCount = existingTurbines + nextTurbines;

    if ((existing.park.estimatedProductionMw ?? null) != null || point.estimatedProductionMw != null) {
      existing.park.estimatedProductionMw = Number(((existing.park.estimatedProductionMw ?? 0) + (point.estimatedProductionMw ?? 0)).toFixed(1));
    }

    if (!existing.park.operator && point.operator) existing.park.operator = point.operator;
    if (!existing.park.commune && point.commune) existing.park.commune = point.commune;
    if (!existing.park.department && point.department) existing.park.department = point.department;
    if (!existing.park.region && point.region) existing.park.region = point.region;
    if (!existing.park.commissioningYear && point.commissioningYear) existing.park.commissioningYear = point.commissioningYear;
  }

  return Array.from(grouped.values()).map(({ park, count, sumLng, sumLat }) => ({
    ...park,
    coordinates: [Number((sumLng / count).toFixed(5)), Number((sumLat / count).toFixed(5))],
  }));
}

export class EolienTracker {
  private readonly liveEndpoint: string;
  private readonly parksEndpoint: string;
  private readonly cacheTtlMs: number;
  private readonly fallbackInstalledGw: number;
  private readonly alertThresholdGw: number;
  private readonly fetchImpl: typeof fetch;
  private parksCache: { data: EolienParcsGeoJSON; fetchedAt: number } | null = null;

  constructor(options: EolienTrackerOptions = {}) {
    this.liveEndpoint = options.liveEndpoint ?? DEFAULT_LIVE_ENDPOINT;
    this.parksEndpoint = options.parksEndpoint ?? DEFAULT_PARKS_ENDPOINT;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.fallbackInstalledGw = options.fallbackInstalledGw ?? DEFAULT_INSTALLED_GW;
    this.alertThresholdGw = options.alertThresholdGw ?? DEFAULT_ALERT_THRESHOLD_GW;
    const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.fetchImpl = (input, init) => fetchImpl(input, init);
  }

  async fetchEco2mixLive(): Promise<{ production_gw: number; installed_gw?: number; terre_mer_split?: EolienTerreMerSplit; timestamp: string }> {
    const payload = await this.fetchJsonWithRetry<EolienLiveApiResponse | { live: EolienLiveApiResponse }>(this.liveEndpoint);
    const live = 'live' in payload ? payload.live : payload;
    if (typeof live.production_gw !== 'number' || typeof live.timestamp !== 'string') {
      throw new Error('Payload éolien live invalide');
    }

    return {
      production_gw: live.production_gw,
      installed_gw: live.installed_gw,
      terre_mer_split: live.terre_mer_split,
      timestamp: live.timestamp,
    };
  }

  async fetchParcsGeoJSON(): Promise<EolienParcsGeoJSON> {
    if (this.parksCache && Date.now() - this.parksCache.fetchedAt < this.cacheTtlMs) {
      return this.parksCache.data;
    }

    let geojson = emptyGeoJSON();

    try {
      const payload = await this.fetchJsonWithRetry<EolienParcsGeoJSON>(this.parksEndpoint);
      if (payload?.type === 'FeatureCollection' && Array.isArray(payload.features)) {
        geojson = payload;
      }
    } catch {
      // Fallback below
    }

    if (geojson.features.length === 0) {
      try {
        const fallback = await this.fetchJsonWithRetry<EolienParcsGeoJSON>(DEFAULT_FALLBACK_PARKS_ENDPOINT);
        if (fallback?.type === 'FeatureCollection' && Array.isArray(fallback.features)) {
          geojson = fallback;
        }
      } catch {
        geojson = emptyGeoJSON();
      }
    }

    this.parksCache = { data: geojson, fetchedAt: Date.now() };
    return geojson;
  }

  computeFacteurCharge(vent_moyen_kmh: number): number {
    if (!Number.isFinite(vent_moyen_kmh) || vent_moyen_kmh <= 0) return 0;
    if (vent_moyen_kmh < 12) return 0.03;
    if (vent_moyen_kmh < 22) return 0.12;
    if (vent_moyen_kmh < 32) return 0.22;
    if (vent_moyen_kmh < 42) return 0.36;
    if (vent_moyen_kmh < 55) return 0.51;
    if (vent_moyen_kmh < 70) return 0.68;
    if (vent_moyen_kmh < 85) return 0.82;
    if (vent_moyen_kmh < 100) return 0.72;
    return 0.38;
  }

  async fetchDashboardSnapshot(ventMoyenKmh = 30): Promise<EolienTrackerSnapshot> {
    const [livePayload, geojson] = await Promise.all([
      this.fetchEco2mixLive(),
      this.fetchParcsGeoJSON(),
    ]);

    const emptyLive: EolienLive = {
      production: 0,
      production_gw: 0,
      puissance_installee: this.fallbackInstalledGw,
      facteur_charge: this.computeFacteurCharge(ventMoyenKmh),
      parcs_actifs: 0,
      timestamp: new Date(livePayload.timestamp),
      alertLevel: 'low-production',
      terre_mer_split: livePayload.terre_mer_split,
    };

    const points = geojson.features
      .filter((feature) => isParkLikeFeature(feature))
      .map((feature) => this.toParkSummary(feature, emptyLive.facteur_charge))
      .filter((park): park is EolienParkSummary => park !== null);

    const parks = aggregateParks(points);
    const activeParks = parks.filter((park) => ACTIVE_STATUSES.has(park.status));
    // Prefer proxy-provided installed_gw (from ODRE regional dataset), fall back to GeoJSON sum
    const geojsonInstalledGw = activeParks.reduce((sum, park) => sum + (park.capacityMw ?? 0), 0) / 1000;
    const installedGw = (livePayload.installed_gw && livePayload.installed_gw > 10)
      ? livePayload.installed_gw
      : (geojsonInstalledGw > 10 ? geojsonInstalledGw : this.fallbackInstalledGw);
    const ratioFactor = installedGw > 0 ? clamp(livePayload.production_gw / installedGw, 0, 1) : null;
    const facteurCharge = ratioFactor ?? this.computeFacteurCharge(ventMoyenKmh);
    const terreMerSplit = livePayload.terre_mer_split ?? estimateSplitFromCapacity(activeParks, livePayload.production_gw);

    const live: EolienLive = {
      production: livePayload.production_gw,
      production_gw: livePayload.production_gw,
      puissance_installee: Number(installedGw.toFixed(2)),
      facteur_charge: Number(facteurCharge.toFixed(3)),
      parcs_actifs: activeParks.length,
      timestamp: new Date(livePayload.timestamp),
      alertLevel: livePayload.production_gw < this.alertThresholdGw
        ? 'low-production'
        : facteurCharge < 0.18
          ? 'watch'
          : 'normal',
      terre_mer_split: terreMerSplit,
    };

    const enrichedPoints = points.map((park) => {
      const factor = computeSplitFactor(park, live.facteur_charge, terreMerSplit, parks);
      return {
        ...park,
        estimatedProductionMw: ACTIVE_STATUSES.has(park.status) && park.capacityMw
          ? Number((park.capacityMw * factor).toFixed(1))
          : 0,
      };
    });

    const enrichedParks = aggregateParks(enrichedPoints)
      .sort((a, b) => (b.estimatedProductionMw ?? 0) - (a.estimatedProductionMw ?? 0) || (b.capacityMw ?? 0) - (a.capacityMw ?? 0));

    return { live, geojson, points: enrichedPoints, parks: enrichedParks };
  }

  openLiveEventSource(
    onMessage: (snapshot: EolienLiveApiResponse) => void,
    onError?: (error: Event) => void,
    streamUrl = `${this.liveEndpoint}${this.liveEndpoint.includes('?') ? '&' : '?'}stream=1`,
  ): EventSource {
    const source = new EventSource(streamUrl);
    source.onmessage = (event) => {
      try {
        onMessage(JSON.parse(event.data) as EolienLiveApiResponse);
      } catch {
        // Ignore malformed events from upstream
      }
    };
    if (onError) source.onerror = onError;
    return source;
  }

  private async fetchJsonWithRetry<T>(url: string, attempt = 0): Promise<T> {
    try {
      const response = await this.fetchImpl(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json() as T;
    } catch (error) {
      if (attempt >= 2) throw error;
      await delay(400 * (2 ** attempt));
      return this.fetchJsonWithRetry<T>(url, attempt + 1);
    }
  }

  private toParkSummary(feature: Feature<Geometry, GeoJsonProperties>, fallbackFactor: number): EolienParkSummary | null {
    const props = feature.properties;
    const coordinates = centroidForGeometry(feature.geometry);
    if (!coordinates) return null;

    const kind = normalizeKind(props);
    const layer = pickString(props, ['layer']);
    const groupId = pickString(props, ['id_parc', 'parc_id', 'code_parc']) ??
      pickString(props, ['name', 'nom_parc', 'nom', 'libelle']) ??
      `${kind}-${coordinates[0]}-${coordinates[1]}`;
    const rawCapacityMw = pickNumber(props, [
      'capacityMw', 'capacity_mw', 'puissance_mw', 'puissance', 'PUISSANCE', 'PU_NOMINAL', 'p_inst_mw', 'puis_max_mw', 'power_mw',
    ]);
    const capacityMw = rawCapacityMw ?? (kind === 'onshore' && pickString(props, ['numero']) ? 3 : null);
    const rawEtatMat = pickString(props, [
      'etat_mat', 'status', 'etat', 'cycle_vie', 'etat_parc', 'statut',
      'statut_parc', 'statut_admin', 'etat_icpe', 'TYPE_ETAT', 'STATUT', 'e_adm_mat',
    ]);
    const enService = pickString(props, ['en_service']);
    let status = normalizeStatus(rawEtatMat, enService);
    // If status is unresolved but the feature comes from an éolien layer,
    // treat it as operating — the registry includes only built/registered wind assets.
    if (status === 'unknown' && layer?.startsWith('eolien_')) {
      status = 'operating';
    }
  const park: EolienParkSummary = {
      id: pickString(props, ['id', 'id_aerogenerateur', 'id_mat', 'idMat', 'ID_EOL', 'gid', 'numero', 'id_parc', 'code_parc', 'parc_id']) ?? `eolien-${coordinates[0]}-${coordinates[1]}`,
      groupId,
      name: normalizeName(pickString(props, ['name', 'nom_usuel', 'nom_parc', 'nom', 'libelle']), groupId, layer),
      status,
      kind,
      capacityMw,
      turbineCount: pickNumber(props, ['turbineCount', 'nb_eoliennes', 'nombre_eoliennes', 'nb_mats']),
      operator: pickString(props, ['operator', 'exploitant', 'operateur', 'raison_sociale']),
      commune: pickString(props, ['commune', 'nom_commune', 'commune_principale', 'NOM_COM', 'libCom', 'n_commune', 'communes']),
      department: pickString(props, ['department', 'departement', 'code_departement', 'codeDep', 'DEPT', 'departemen', 'code_dept']),
      region: humanizeRegion(pickString(props, ['region', 'nom_region', 'lib_region', 'code_reg'])) ?? humanizeLayer(layer),
      commissioningYear: pickNumber(props, ['commissioningYear', 'annee_mise_en_service', 'annee_service', 'annee', 'date_mise_en_service']) ?? null,
      estimatedProductionMw: capacityMw != null ? Number((capacityMw * fallbackFactor).toFixed(1)) : null,
      coordinates,
      sourceType: pickString(props, ['numero', 'id_aerogenerateur', 'nom_eolienne']) ? 'turbine' : 'park',
    };

    return park;
  }
}
