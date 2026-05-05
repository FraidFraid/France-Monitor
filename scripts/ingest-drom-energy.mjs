import { access, mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'public/data/drom-energy');
const GEO_DIR = path.join(DATA_DIR, 'geo');
const TABLES_DIR = path.join(DATA_DIR, 'tables');
const RAW_DIR = path.join(DATA_DIR, 'raw');

const TERRITORIES_PATH = path.join(DATA_DIR, 'territories.json');
const SOURCES_PATH = path.join(DATA_DIR, 'sources.json');
const SUBSTATIONS_PATH = path.join(GEO_DIR, 'substations.geojson');
const PYLONS_PATH = path.join(GEO_DIR, 'pylons.geojson');
const PRODUCTION_SITES_PATH = path.join(GEO_DIR, 'production-sites.geojson');
const LINES_HTA_REUNION_PATH = path.join(GEO_DIR, 'lines-hta-reunion.geojson');
const COMMUNE_CONSUMPTION_PATH = path.join(TABLES_DIR, 'commune-consumption.json');
const CO2_EMISSIONS_PATH = path.join(TABLES_DIR, 'co2-emissions.json');
const PRODUCTION_LIMITATIONS_PATH = path.join(TABLES_DIR, 'production-limitations.json');
const EFFICIENCY_ACTIONS_PATH = path.join(TABLES_DIR, 'efficiency-actions.json');
const INGEST_TIMEOUT_MS = 20_000;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const FORCE_LOCAL_FALLBACK = process.env.DROM_ENERGY_FORCE_LOCAL === '1';

const FIELD_MAPPINGS = {
  territory: [
    'territory_code',
    'territoire_code',
    'territory',
    'territoire',
    'region',
    'region_name',
    'region_code',
    'code_region',
    'departement',
    'code_departement',
    'dep',
    'code_dep',
    'code_insee_region',
  ],
  id: ['id', 'objectid', 'fid', 'gid', 'code'],
  substationId: ['id', 'objectid', 'fid', 'gid', 'code', 'code_ps', 'code_poste'],
  pylonId: ['id', 'objectid', 'fid', 'gid', 'code', 'code_pylone'],
  productionSiteId: ['id', 'code', 'code_installation', 'identifiant', 'nom_installation'],
  name: ['nom', 'name', 'libelle', 'label'],
  substationName: ['nom', 'name', 'libelle', 'label', 'poste', 'poste_source', 'nom_poste', 'ouvrage'],
  pylonName: ['nom', 'name', 'libelle', 'label', 'ouvrage'],
  productionSiteName: ['nom', 'name', 'libelle', 'nom_installation', 'installation'],
  operator: ['operateur', 'operator', 'exploitant'],
  communeCode: ['code_commune', 'code_insee_commune', 'insee_com', 'commune_code'],
  communeName: ['commune', 'nom_commune', 'libelle_commune'],
  coordinates: {
    lon: ['longitude', 'lon', 'x', 'lng'],
    lat: ['latitude', 'lat', 'y'],
  },
  voltageKv: ['tension', 'tension_kv', 'voltage_kv', 'voltage'],
  capacityMw: ['capacity_mw', 'puissance_mw', 'pmax', 'capacite_mw', 'capacite'],
  availableCapacityMw: ['capacite_accueil_mw', 'capacite_disponible_mw'],
  productionType: ['filiere', 'type_production', 'type_installation', 'nature'],
  year: ['annee', 'year', 'millesime'],
  consumptionMwh: ['consommation_annuelle_mwh', 'consommation_mwh', 'consommation'],
  co2Tons: ['emissions_co2_tonnes', 'emissions_co2_kt', 'co2', 'emissions'],
  efficiencyActionsCount: ['nb_actions', 'nombre_actions', 'actions', 'nombre'],
  limitationId: ['id', 'code', 'annee_mois', 'periode'],
  limitationSite: ['site', 'poste', 'zone', 'nom_installation'],
  limitationReason: ['motif', 'raison', 'description'],
  limitationStart: ['date_debut', 'start_date', 'periode'],
  limitationEnd: ['date_fin', 'end_date'],
  limitedPowerMw: ['puissance_limitee_mw', 'limitation_mw', 'puissance_mw'],
};

const STATIC_TABLE_OUTPUT_BY_DATASET = {
  consommation_commune: 'communeConsumption',
  emissions_co2: 'co2Emissions',
  efficiency_actions: 'efficiencyActions',
};

function log(message) {
  console.log(`[ingest-drom-energy] ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function readJson(filePath) {
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

function emptyFeatureCollection() {
  return {
    type: 'FeatureCollection',
    features: [],
  };
}

function pickString(props, keys) {
  for (const key of keys) {
    const value = props?.[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

function pickNumber(props, keys) {
  for (const key of keys) {
    const value = props?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const normalized = value.replace(',', '.');
      const parsed = Number(normalized);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function normalizeText(value) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function toTerritoryCodeFromText(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = normalizeText(value.trim());
  if (normalized.includes('guadeloupe') || normalized === 'gp' || normalized === '01' || normalized === '971') return 'GP';
  if (normalized.includes('martinique') || normalized === 'mq' || normalized === '02' || normalized === '972') return 'MQ';
  if (normalized.includes('guyane') || normalized === 'gf' || normalized === '03' || normalized === '973') return 'GF';
  if (normalized.includes('reunion') || normalized.includes('la reunion') || normalized === 're' || normalized === '04' || normalized === '974') return 'RE';
  if (normalized.includes('mayotte') || normalized === 'yt' || normalized === '06' || normalized === '976') return 'YT';
  return null;
}

function resolveTerritoryCode(props, fallbackCodes) {
  const direct = pickString(props, FIELD_MAPPINGS.territory);
  const fromText = toTerritoryCodeFromText(direct);
  if (fromText) return fromText;
  return fallbackCodes.length === 1 ? fallbackCodes[0] : null;
}

function isFeatureCollection(payload) {
  return payload?.type === 'FeatureCollection' && Array.isArray(payload.features);
}

function resolveRecords(payload) {
  if (Array.isArray(payload)) {
    return payload.filter((row) => row && typeof row === 'object');
  }
  if (payload && typeof payload === 'object' && Array.isArray(payload.results)) {
    return payload.results.filter((row) => row && typeof row === 'object');
  }
  return [];
}

function toSourceUrls(source) {
  return [...new Set([
    ...(Array.isArray(source.urls) ? source.urls : []),
    ...(source.url ? [source.url] : []),
  ])];
}

function resolveExpectedFormat(source) {
  if (source.expectedFormat === 'geojson' || source.expectedFormat === 'json' || source.expectedFormat === 'csv') {
    return source.expectedFormat;
  }
  return source.geometry === 'none' ? 'json' : 'geojson';
}

function contentTypeIncludes(contentType, tokens) {
  const normalized = contentType.toLowerCase();
  return tokens.some((token) => normalized.includes(token));
}

function bodyLooksLikeHtml(text) {
  const trimmed = text.trimStart().slice(0, 120).toLowerCase();
  return trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html') || trimmed.includes('<head');
}

function bodyLooksLikeJson(text) {
  const trimmed = text.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function toPointGeometry(value) {
  if (Array.isArray(value) && value.length >= 2) {
    const [lat, lon] = value;
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      return { type: 'Point', coordinates: [lon, lat] };
    }
  }

  if (value && typeof value === 'object') {
    const lon = Number(value.lon ?? value.lng ?? value.longitude);
    const lat = Number(value.lat ?? value.latitude);
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      return { type: 'Point', coordinates: [lon, lat] };
    }
  }

  return null;
}

function resolveRecordGeometry(record) {
  if (record?.geometry?.type) return record.geometry;
  if (record?.geo_shape?.type) return record.geo_shape;
  if (record?.fields?.geo_shape?.type) return record.fields.geo_shape;
  return toPointGeometry(record?.geo_point_2d ?? record?.fields?.geo_point_2d);
}

function coerceFeatureCollection(payload) {
  if (isFeatureCollection(payload)) return payload;

  const rows = resolveRecords(payload);
  const features = rows
    .map((row) => {
      const geometry = resolveRecordGeometry(row);
      if (!geometry) return null;
      const properties = row.properties ?? row.fields ?? row;
      return {
        type: 'Feature',
        geometry,
        properties: { ...properties },
      };
    })
    .filter(Boolean);

  if (features.length === 0) return payload;
  return {
    type: 'FeatureCollection',
    features,
  };
}

function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const separator = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(separator).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(separator);
    return headers.reduce((row, header, index) => {
      row[header] = values[index]?.trim() ?? '';
      return row;
    }, {});
  });
}

function validatePayload(source, payload, expectedFormat) {
  if (expectedFormat === 'geojson' && !isFeatureCollection(payload)) {
    throw new Error('expected GeoJSON FeatureCollection');
  }
  if (expectedFormat === 'json' && (payload == null || typeof payload !== 'object')) {
    throw new Error('expected JSON object or array');
  }
  if (expectedFormat === 'csv' && !Array.isArray(payload)) {
    throw new Error('expected parsed CSV rows');
  }

  if (expectedFormat === 'geojson' && payload.features.length === 0) {
    throw new Error('empty GeoJSON FeatureCollection');
  }
  if (expectedFormat !== 'geojson' && resolveRecords(payload).length === 0) {
    throw new Error('empty records payload');
  }

  return source;
}

function parseResponsePayload(text, contentType, expectedFormat) {
  if (bodyLooksLikeHtml(text)) {
    throw new Error('expected data payload, got HTML');
  }

  if (expectedFormat === 'csv') {
    const csvLike = contentTypeIncludes(contentType, ['csv', 'text/plain', 'octet-stream']) && !bodyLooksLikeJson(text);
    if (!csvLike) {
      throw new Error(`expected CSV, got content-type ${contentType || 'unknown'}`);
    }
    return parseCsv(text);
  }

  const jsonLike = contentTypeIncludes(contentType, ['json', 'geo+json', 'octet-stream']) || bodyLooksLikeJson(text);
  if (!jsonLike) {
    throw new Error(`expected JSON/GeoJSON, got content-type ${contentType || 'unknown'}`);
  }

  try {
    const payload = JSON.parse(text);
    return expectedFormat === 'geojson' ? coerceFeatureCollection(payload) : payload;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`invalid JSON payload: ${message}`);
  }
}

function buildAttempt(url, statusCode, contentType, error) {
  return {
    url,
    ...(statusCode ? { statusCode } : {}),
    ...(contentType ? { contentType } : {}),
    ...(error ? { error } : {}),
  };
}

function buildFetchError(message, statusCode, contentType) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.contentType = contentType;
  return error;
}

async function fetchResource(source, url, expectedFormat) {
  const response = await fetch(url, {
    headers: {
      Accept: expectedFormat === 'csv'
        ? 'text/csv, text/plain;q=0.9, */*;q=0.1'
        : 'application/geo+json, application/json, */*;q=0.1',
    },
    signal: AbortSignal.timeout(INGEST_TIMEOUT_MS),
  });
  const statusCode = response.status;
  const contentType = response.headers.get('content-type') ?? '';
  log(`probe ${source.id}: status=${statusCode} content-type=${contentType || 'unknown'} url=${url}`);

  const text = await response.text();
  if (!response.ok) {
    throw buildFetchError(`upstream responded ${statusCode}`, statusCode, contentType);
  }

  let payload;
  try {
    payload = parseResponsePayload(text, contentType, expectedFormat);
    validatePayload(source, payload, expectedFormat);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw buildFetchError(message, statusCode, contentType);
  }
  const lastModified = response.headers.get('last-modified');
  return {
    payload,
    fetchedAt: lastModified ? new Date(lastModified).toISOString() : new Date().toISOString(),
    statusCode,
    contentType,
  };
}

async function fetchAnyResource(source, urls) {
  const expectedFormat = resolveExpectedFormat(source);
  let lastError = null;
  const attempts = [];

  for (const url of urls) {
    try {
      const result = await fetchResource(source, url, expectedFormat);
      return { ...result, url, attempts, expectedFormat };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      attempts.push(buildAttempt(url, lastError.statusCode, lastError.contentType, lastError.message));
      log(`source failed ${source.id}: ${url} (${lastError.message})`);
      if (RETRYABLE_STATUS_CODES.has(Number(lastError.message.match(/\d{3}/)?.[0]))) {
        await sleep(1500);
      }
    }
  }

  const finalError = lastError ?? new Error('all candidate URLs failed');
  finalError.attempts = attempts;
  throw finalError;
}

function resolveLocalFallbackPath(source) {
  if (typeof source.localFallbackPath !== 'string' || !source.localFallbackPath.trim()) return null;
  return path.isAbsolute(source.localFallbackPath)
    ? source.localFallbackPath
    : path.join(ROOT_DIR, source.localFallbackPath);
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function inferLocalContentType(filePath, expectedFormat) {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.csv') return 'text/csv';
  if (extension === '.geojson') return 'application/geo+json';
  if (extension === '.json') return 'application/json';
  return expectedFormat === 'csv' ? 'text/csv' : 'application/json';
}

async function readLocalFallbackResource(source, expectedFormat, attempts, sourceType = 'local_fallback') {
  const localPath = resolveLocalFallbackPath(source);
  if (!localPath || !(await fileExists(localPath))) return null;

  const contentType = inferLocalContentType(localPath, expectedFormat);
  const text = await readFile(localPath, 'utf-8');
  const payload = parseResponsePayload(text, contentType, expectedFormat);
  validatePayload(source, payload, expectedFormat);

  return {
    payload,
    fetchedAt: new Date().toISOString(),
    url: source.localFallbackPath,
    sourceType,
    contentType,
    attempts,
    expectedFormat,
  };
}

async function loadSourceResource(source, urls) {
  const expectedFormat = resolveExpectedFormat(source);
  let remoteError = null;
  const forceLocal = FORCE_LOCAL_FALLBACK && Array.isArray(source.territoryCodes) && source.territoryCodes.includes('RE');

  if (forceLocal) {
    try {
      const fallback = await readLocalFallbackResource(source, expectedFormat, [], 'local_fallback_forced');
      if (fallback) {
        log(`loaded ${source.id}: source=local_fallback_forced path=${source.localFallbackPath}`);
        return fallback;
      }
    } catch (error) {
      const fallbackError = error instanceof Error ? error : new Error(String(error));
      const finalError = new Error('forced_local_fallback_missing_or_invalid');
      finalError.attempts = [
        buildAttempt(source.localFallbackPath, undefined, undefined, fallbackError.message),
      ];
      finalError.reason = 'forced_local_fallback_missing_or_invalid';
      finalError.lastAttemptedUrl = source.localFallbackPath;
      throw finalError;
    }
    const finalError = new Error('forced_local_fallback_missing_or_invalid');
    finalError.attempts = source.localFallbackPath
      ? [buildAttempt(source.localFallbackPath, undefined, undefined, 'local fallback missing or invalid')]
      : [];
    finalError.reason = source.localFallbackPath
      ? 'forced_local_fallback_missing_or_invalid'
      : 'forced_local_fallback_not_configured';
    finalError.lastAttemptedUrl = source.localFallbackPath;
    throw finalError;
  }

  if (urls.length > 0) {
    try {
      const result = await fetchAnyResource(source, urls);
      return { ...result, sourceType: 'remote' };
    } catch (error) {
      remoteError = error instanceof Error ? error : new Error(String(error));
    }
  }

  const attempts = remoteError?.attempts ?? [];
  try {
    const fallback = await readLocalFallbackResource(source, expectedFormat, attempts);
    if (fallback) {
      log(`loaded ${source.id} from local fallback ${source.localFallbackPath}`);
      return fallback;
    }
  } catch (error) {
    const fallbackError = error instanceof Error ? error : new Error(String(error));
    attempts.push(buildAttempt(source.localFallbackPath, undefined, undefined, fallbackError.message));
    remoteError = fallbackError;
  }

  const finalError = new Error(
    urls.length === 0
      ? 'no_remote_urls_and_no_local_fallback'
      : 'all_remote_failed_and_no_local_fallback',
  );
  finalError.attempts = attempts;
  finalError.reason = finalError.message;
  finalError.lastAttemptedUrl = attempts.at(-1)?.url ?? urls.at(-1);
  finalError.contentType = attempts.at(-1)?.contentType ?? remoteError?.contentType;
  finalError.statusCode = attempts.at(-1)?.statusCode ?? remoteError?.statusCode;
  throw finalError;
}

function buildFallbackAssetId(prefix, coordinates, index) {
  return `${prefix}-${index}-${coordinates[0]}-${coordinates[1]}`;
}

function normalizeSubstationFeature(feature, datasetId, territoryCode, index) {
  if (feature?.geometry?.type !== 'Point' || !Array.isArray(feature.geometry.coordinates)) return null;
  const [lon, lat] = feature.geometry.coordinates;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const properties = feature.properties ?? {};
  const id = (typeof feature.id === 'string' || typeof feature.id === 'number')
    ? String(feature.id)
    : pickString(properties, FIELD_MAPPINGS.substationId)
      ?? buildFallbackAssetId(datasetId, [lon, lat], index);
  const name = pickString(properties, FIELD_MAPPINGS.substationName) ?? id;

  const asset = {
    id,
    territoryCode,
    type: 'source_substation',
    name,
    sourceDatasetId: datasetId,
    operator: pickString(properties, FIELD_MAPPINGS.operator) ?? undefined,
    communeCode: pickString(properties, FIELD_MAPPINGS.communeCode) ?? undefined,
    communeName: pickString(properties, FIELD_MAPPINGS.communeName) ?? undefined,
    voltageKv: pickNumber(properties, FIELD_MAPPINGS.voltageKv) ?? undefined,
    rawProperties: { ...properties },
  };

  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [lon, lat],
    },
    properties: asset,
  };
}

function normalizePylonFeature(feature, dataset, index) {
  const geometryType = feature?.geometry?.type;
  if (geometryType !== 'Point' && geometryType !== 'LineString' && geometryType !== 'MultiLineString') return null;

  const properties = feature.properties ?? {};
  const territoryCode = resolveTerritoryCode(properties, dataset.territoryCodes);
  if (!territoryCode) return null;

  const id = (typeof feature.id === 'string' || typeof feature.id === 'number')
    ? String(feature.id)
    : pickString(properties, FIELD_MAPPINGS.pylonId) ?? `${dataset.id}-${index}`;
  const name = pickString(properties, FIELD_MAPPINGS.pylonName) ?? id;

  return {
    type: 'Feature',
    geometry: feature.geometry,
    properties: {
      id,
      territoryCode,
      type: 'htb_pylon',
      name,
      sourceDatasetId: dataset.id,
      coordinates: geometryType === 'Point' ? feature.geometry.coordinates : undefined,
      operator: pickString(properties, FIELD_MAPPINGS.operator) ?? undefined,
      communeCode: pickString(properties, FIELD_MAPPINGS.communeCode) ?? undefined,
      communeName: pickString(properties, FIELD_MAPPINGS.communeName) ?? undefined,
      voltageKv: pickNumber(properties, FIELD_MAPPINGS.voltageKv) ?? undefined,
      rawProperties: { ...properties },
    },
  };
}

function guessAssetType(row, datasetId) {
  if (datasetId === 'capacites_accueil') return 'hosting_capacity_point';
  const productionType = pickString(row, FIELD_MAPPINGS.productionType);
  const normalized = productionType ? normalizeText(productionType) : '';
  if (normalized.includes('stock')) return 'storage_site';
  return 'production_site';
}

function normalizeProductionSiteRecord(row, dataset, index) {
  const lon = pickNumber(row, FIELD_MAPPINGS.coordinates.lon);
  const lat = pickNumber(row, FIELD_MAPPINGS.coordinates.lat);
  if (lon == null || lat == null || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const territoryCode = resolveTerritoryCode(row, dataset.territoryCodes);
  if (!territoryCode) return null;

  const id = pickString(row, FIELD_MAPPINGS.productionSiteId) ?? `${dataset.id}-${index}`;
  const name = pickString(row, FIELD_MAPPINGS.productionSiteName) ?? id;
  const asset = {
    id,
    territoryCode,
    type: guessAssetType(row, dataset.id),
    name,
    sourceDatasetId: dataset.id,
    operator: pickString(row, FIELD_MAPPINGS.operator) ?? undefined,
    communeCode: pickString(row, FIELD_MAPPINGS.communeCode) ?? undefined,
    communeName: pickString(row, FIELD_MAPPINGS.communeName) ?? undefined,
    productionType: pickString(row, FIELD_MAPPINGS.productionType) ?? undefined,
    capacityMw: pickNumber(row, FIELD_MAPPINGS.capacityMw) ?? undefined,
    availableCapacityMw: pickNumber(row, FIELD_MAPPINGS.availableCapacityMw) ?? undefined,
    rawProperties: { ...row },
  };

  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [lon, lat],
    },
    properties: asset,
  };
}

function normalizeProductionSiteFeature(feature, dataset, index) {
  if (feature?.geometry?.type !== 'Point' || !Array.isArray(feature.geometry.coordinates)) return null;
  const [lon, lat] = feature.geometry.coordinates;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  const properties = feature.properties ?? {};
  const row = {
    ...properties,
    longitude: lon,
    latitude: lat,
  };

  return normalizeProductionSiteRecord(row, dataset, index);
}

function isLineGeometry(geometry) {
  return geometry?.type === 'LineString' || geometry?.type === 'MultiLineString';
}

function normalizeHtaLineFeature(feature, dataset, index) {
  if (!isLineGeometry(feature?.geometry)) return null;

  const properties = feature.properties ?? {};
  const id = (typeof feature.id === 'string' || typeof feature.id === 'number')
    ? String(feature.id)
    : pickString(properties, FIELD_MAPPINGS.id) ?? `${dataset.id}-${index}`;
  const name = pickString(properties, FIELD_MAPPINGS.name) ?? id;

  return {
    type: 'Feature',
    geometry: feature.geometry,
    properties: {
      ...properties,
      id,
      name,
      territoryCode: resolveTerritoryCode(properties, dataset.territoryCodes) ?? 'RE',
      sourceDatasetId: dataset.id,
      communeCode: pickString(properties, FIELD_MAPPINGS.communeCode) ?? undefined,
      communeName: pickString(properties, FIELD_MAPPINGS.communeName) ?? undefined,
      voltageKv: pickNumber(properties, FIELD_MAPPINGS.voltageKv) ?? undefined,
    },
  };
}

function normalizeCommuneMetricRecord(row, datasetId, territoryCodes) {
  const territoryCode = resolveTerritoryCode(row, territoryCodes);
  if (!territoryCode) return null;

  const metric = {
    territoryCode,
    communeCode: pickString(row, FIELD_MAPPINGS.communeCode) ?? 'unknown',
    communeName: pickString(row, FIELD_MAPPINGS.communeName) ?? 'Commune inconnue',
    year: Math.round(pickNumber(row, FIELD_MAPPINGS.year) ?? new Date().getFullYear()),
    sourceDatasetId: datasetId,
    rawProperties: { ...row },
  };

  if (datasetId === 'consommation_commune') {
    metric.consumptionMwh = pickNumber(row, FIELD_MAPPINGS.consumptionMwh) ?? undefined;
  }
  if (datasetId === 'emissions_co2') {
    metric.co2Tons = pickNumber(row, FIELD_MAPPINGS.co2Tons) ?? undefined;
  }
  if (datasetId === 'efficiency_actions') {
    metric.efficiencyActionsCount = pickNumber(row, FIELD_MAPPINGS.efficiencyActionsCount) ?? undefined;
  }

  if (metric.consumptionMwh == null && metric.co2Tons == null && metric.efficiencyActionsCount == null) {
    return null;
  }

  return metric;
}

function normalizeProductionLimitationRecord(row, dataset, index) {
  const territoryCode = resolveTerritoryCode(row, dataset.territoryCodes);
  if (!territoryCode) return null;

  const limitation = {
    id: pickString(row, FIELD_MAPPINGS.limitationId) ?? `${dataset.id}-${territoryCode}-${index}`,
    territoryCode,
    sourceDatasetId: dataset.id,
    siteName: pickString(row, FIELD_MAPPINGS.limitationSite) ?? undefined,
    productionType: pickString(row, FIELD_MAPPINGS.productionType) ?? undefined,
    limitationReason: pickString(row, FIELD_MAPPINGS.limitationReason) ?? undefined,
    startDate: pickString(row, FIELD_MAPPINGS.limitationStart) ?? undefined,
    endDate: pickString(row, FIELD_MAPPINGS.limitationEnd) ?? undefined,
    limitedPowerMw: pickNumber(row, FIELD_MAPPINGS.limitedPowerMw) ?? undefined,
    rawProperties: { ...row },
  };

  if (!limitation.siteName && !limitation.productionType && !limitation.limitationReason && limitation.limitedPowerMw == null) {
    return null;
  }

  return limitation;
}

async function main() {
  log('loading catalog and territories');
  const [territories, sourceCatalog] = await Promise.all([
    readJson(TERRITORIES_PATH),
    readJson(SOURCES_PATH),
  ]);

  const outputs = {
    substations: emptyFeatureCollection(),
    pylons: emptyFeatureCollection(),
    productionSites: emptyFeatureCollection(),
    reunionHtaLines: emptyFeatureCollection(),
    communeConsumption: [],
    co2Emissions: [],
    productionLimitations: [],
    efficiencyActions: [],
  };

  const fetchedAtById = new Map();
  const ingestionById = new Map();
  await mkdir(RAW_DIR, { recursive: true });

  for (const source of sourceCatalog) {
    const urls = toSourceUrls(source);
    const lastRun = new Date().toISOString();

    log(`fetching ${source.id}`);

    try {
      const { payload, fetchedAt, url, statusCode, contentType, attempts, sourceType } = await loadSourceResource(source, urls);
      fetchedAtById.set(source.id, fetchedAt);
      log(`loaded ${source.id}: source=${sourceType} url=${url}`);
      let normalizedCount = 0;

      if (source.id === 'postes_sources_reunion' || source.id === 'postes_sources') {
        if (!isFeatureCollection(payload)) throw new Error('invalid GeoJSON payload');
        const features = payload.features
          .map((feature, index) => normalizeSubstationFeature(feature, source.id, 'RE', index))
          .filter(Boolean);
        outputs.substations.features.push(...features);
        normalizedCount = features.length;
        if (normalizedCount === 0) throw new Error('no usable substation feature after normalization');
        ingestionById.set(source.id, {
          status: 'success',
          lastRun,
          testedAt: lastRun,
          source: sourceType,
          selectedUrl: url,
          statusCode,
          contentType,
          featureCount: normalizedCount,
          attempts,
        });
        continue;
      }

      if (source.id === 'postes_sources_guyane') {
        if (!isFeatureCollection(payload)) throw new Error('invalid GeoJSON payload');
        const features = payload.features
          .map((feature, index) => normalizeSubstationFeature(feature, source.id, 'GF', index))
          .filter(Boolean);
        outputs.substations.features.push(...features);
        normalizedCount = features.length;
        if (normalizedCount === 0) throw new Error('no usable substation feature after normalization');
        ingestionById.set(source.id, {
          status: 'success',
          lastRun,
          testedAt: lastRun,
          source: sourceType,
          selectedUrl: url,
          statusCode,
          contentType,
          featureCount: normalizedCount,
          attempts,
        });
        continue;
      }

      if (source.id === 'pylones_htb_martinique' || source.id === 'pylones_htb_reunion') {
        if (!isFeatureCollection(payload)) throw new Error('invalid GeoJSON payload');
        const features = payload.features
          .map((feature, index) => normalizePylonFeature(feature, source, index))
          .filter(Boolean);
        outputs.pylons.features.push(...features);
        normalizedCount = features.length;
        if (normalizedCount === 0) throw new Error('no usable pylon feature after normalization');
        ingestionById.set(source.id, {
          status: 'success',
          lastRun,
          testedAt: lastRun,
          source: sourceType,
          selectedUrl: url,
          statusCode,
          contentType,
          featureCount: normalizedCount,
          attempts,
        });
        continue;
      }

      if (source.id === 'production_sites_reunion') {
        if (!isFeatureCollection(payload)) throw new Error('invalid GeoJSON payload');
        const features = payload.features
          .map((feature, index) => normalizeProductionSiteFeature(feature, source, index))
          .filter(Boolean);
        outputs.productionSites.features.push(...features);
        normalizedCount = features.length;
        if (normalizedCount === 0) throw new Error('no usable production site feature after normalization');
        ingestionById.set(source.id, {
          status: 'success',
          lastRun,
          testedAt: lastRun,
          source: sourceType,
          selectedUrl: url,
          statusCode,
          contentType,
          featureCount: normalizedCount,
          attempts,
        });
        continue;
      }

      if (source.id === 'lines_hta_reunion') {
        if (!isFeatureCollection(payload)) throw new Error('invalid GeoJSON payload');
        const features = payload.features
          .map((feature, index) => normalizeHtaLineFeature(feature, source, index))
          .filter(Boolean);
        outputs.reunionHtaLines.features.push(...features);
        normalizedCount = features.length;
        if (normalizedCount === 0) throw new Error('no usable HTA line feature after normalization');
        ingestionById.set(source.id, {
          status: 'success',
          lastRun,
          testedAt: lastRun,
          source: sourceType,
          selectedUrl: url,
          statusCode,
          contentType,
          featureCount: normalizedCount,
          attempts,
        });
        continue;
      }

      const rows = resolveRecords(payload);
      if (rows.length === 0) {
        throw new Error('empty records payload');
      }

      for (const [index, row] of rows.entries()) {
        const tableOutputKey = STATIC_TABLE_OUTPUT_BY_DATASET[source.id];
        if (tableOutputKey) {
          const metric = normalizeCommuneMetricRecord(row, source.id, source.territoryCodes);
          if (metric) {
            outputs[tableOutputKey].push(metric);
            normalizedCount += 1;
          }
          continue;
        }
        if (source.id === 'production_limitations') {
          const limitation = normalizeProductionLimitationRecord(row, source, index);
          if (limitation) {
            outputs.productionLimitations.push(limitation);
            normalizedCount += 1;
          }
          continue;
        }
        if (source.id === 'production_stockage_registry' || source.id === 'capacites_accueil') {
          const feature = normalizeProductionSiteRecord(row, source, index);
          if (feature) {
            outputs.productionSites.features.push(feature);
            normalizedCount += 1;
          }
        }
      }
      if (normalizedCount === 0) throw new Error('no usable record after normalization');
      ingestionById.set(source.id, {
        status: 'success',
        lastRun,
        testedAt: lastRun,
        source: sourceType,
        selectedUrl: url,
        statusCode,
        contentType,
        recordCount: normalizedCount,
        attempts,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      fetchedAtById.delete(source.id);
      const attempts = error?.attempts ?? [];
      const lastAttempt = attempts.at(-1);
      const lastAttemptedUrl = error?.lastAttemptedUrl ?? lastAttempt?.url;
      const statusCode = error?.statusCode ?? lastAttempt?.statusCode;
      const contentType = error?.contentType ?? lastAttempt?.contentType;
      log(
        `dataset unavailable ${source.id}: reason=${error?.reason ?? message}`
          + ` status=${statusCode ?? 'unknown'}`
          + ` content-type=${contentType ?? 'unknown'}`
          + ` lastAttemptedUrl=${lastAttemptedUrl ?? 'none'}`,
      );
      ingestionById.set(source.id, {
        status: 'failure',
        lastRun,
        testedAt: lastRun,
        source: 'none',
        reason: error?.reason ?? message,
        lastAttemptedUrl,
        statusCode,
        contentType,
        error: message,
        attempts,
      });
    }
  }

  const generatedSources = sourceCatalog.map((source) => {
    const fetchedAt = fetchedAtById.get(source.id);
    const ingestion = ingestionById.get(source.id);
    if (fetchedAt) return { ...source, fetchedAt, ingestion };
    const { fetchedAt: _oldFetchedAt, ...sourceWithoutFetchedAt } = source;
    return ingestion ? { ...sourceWithoutFetchedAt, ingestion } : sourceWithoutFetchedAt;
  });

  log('writing normalized files');
  await Promise.all([
    writeJson(TERRITORIES_PATH, territories),
    writeJson(SOURCES_PATH, generatedSources),
    writeJson(SUBSTATIONS_PATH, outputs.substations),
    writeJson(PYLONS_PATH, outputs.pylons),
    writeJson(PRODUCTION_SITES_PATH, outputs.productionSites),
    writeJson(LINES_HTA_REUNION_PATH, outputs.reunionHtaLines),
    writeJson(COMMUNE_CONSUMPTION_PATH, outputs.communeConsumption),
    writeJson(CO2_EMISSIONS_PATH, outputs.co2Emissions),
    writeJson(PRODUCTION_LIMITATIONS_PATH, outputs.productionLimitations),
    writeJson(EFFICIENCY_ACTIONS_PATH, outputs.efficiencyActions),
  ]);

  log(`territories: ${territories.length}`);
  log(`sources with fetchedAt: ${generatedSources.filter((source) => typeof source.fetchedAt === 'string').length}`);
  log(`substations: ${outputs.substations.features.length}`);
  log(`pylons: ${outputs.pylons.features.length}`);
  log(`production-sites: ${outputs.productionSites.features.length}`);
  log(`lines-hta-reunion: ${outputs.reunionHtaLines.features.length}`);
  log(`commune-consumption rows: ${outputs.communeConsumption.length}`);
  log(`co2-emissions rows: ${outputs.co2Emissions.length}`);
  log(`production-limitations rows: ${outputs.productionLimitations.length}`);
  log(`efficiency-actions rows: ${outputs.efficiencyActions.length}`);
}

main().catch((error) => {
  console.error('[ingest-drom-energy] fatal error:', error);
  process.exitCode = 1;
});
