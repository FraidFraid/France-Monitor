import type { FuelStation, FuelStationFuelStatus, FuelType } from '../types/index.ts';

const FUEL_PRICES_PROXY_ENDPOINT = '/api/fuel-prices-proxy';
const FUEL_PRICES_CACHE_TTL_MS = 10 * 60_000;
const PAGE_SIZE = 100;
const PAGE_BATCH_SIZE = 6;
const REQUEST_TIMEOUT_MS = 15_000;
const RETRY_DELAYS_MS = [350, 900];

const MONITORED_FUELS: FuelType[] = ['gazole', 'sp95', 'sp98', 'e10'];

const FUEL_LABELS: Record<FuelType, string> = {
  gazole: 'Gazole',
  sp95: 'SP95',
  sp98: 'SP98',
  e10: 'E10',
};

export const NATIONAL_FUEL_DEPARTMENT_CODES = [
  ...Array.from({ length: 95 }, (_, index) => String(index + 1).padStart(2, '0')).filter((code) => code !== '20'),
  '2A',
  '2B',
] as const;

interface FuelPricesCacheEntry {
  data: FuelStation[];
  fetchedAt: number;
}

interface FuelApiRecord {
  id: string | number;
  code_departement?: string | null;
  departement?: string | null;
  ville?: string | null;
  adresse?: string | null;
  geom?: { lon?: number; lat?: number } | null;
  carburants_disponibles?: unknown;
  carburants_indisponibles?: unknown;
  carburants_rupture_temporaire?: unknown;
  carburants_rupture_definitive?: unknown;
  gazole_prix?: number | null;
  gazole_maj?: string | null;
  gazole_rupture_type?: string | null;
  sp95_prix?: number | null;
  sp95_maj?: string | null;
  sp95_rupture_type?: string | null;
  sp98_prix?: number | null;
  sp98_maj?: string | null;
  sp98_rupture_type?: string | null;
  e10_prix?: number | null;
  e10_maj?: string | null;
  e10_rupture_type?: string | null;
}

interface FuelApiResponse {
  total_count?: number;
  results?: FuelApiRecord[];
}

const cache = new Map<string, FuelPricesCacheEntry>();
const inflightRequests = new Map<string, Promise<FuelStation[]>>();

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function normalizeDepartmentCode(code: string): string {
  const trimmed = code.trim().toUpperCase();
  if (/^\d$/.test(trimmed)) return `0${trimmed}`;
  return trimmed;
}

function isNationalDepartmentCode(code: string): boolean {
  const normalized = normalizeDepartmentCode(code);
  if (normalized === '2A' || normalized === '2B') return true;
  if (!/^\d{2}$/.test(normalized) || normalized === '20') return false;
  const value = Number.parseInt(normalized, 10);
  return value >= 1 && value <= 95;
}

function compareDepartmentCodes(a: string, b: string): number {
  if (a === b) return 0;
  if (a === '2A') return b === '2B' ? -1 : -1;
  if (a === '2B') return b === '2A' ? 1 : -1;
  if (b === '2A' || b === '2B') return 1;
  return a.localeCompare(b, 'fr-FR', { numeric: true });
}

function buildCacheKey(departmentCodes?: string[]): string {
  if (!departmentCodes || departmentCodes.length === 0) return 'national';
  return Array.from(new Set(departmentCodes.map(normalizeDepartmentCode))).sort(compareDepartmentCodes).join(',');
}

function buildUpstreamUrl(offset: number, departmentCodes?: string[]): string {
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(offset),
    select: [
      'id',
      'code_departement',
      'departement',
      'ville',
      'adresse',
      'geom',
      'gazole_prix',
      'gazole_maj',
      'gazole_rupture_type',
      'sp95_prix',
      'sp95_maj',
      'sp95_rupture_type',
      'sp98_prix',
      'sp98_maj',
      'sp98_rupture_type',
      'e10_prix',
      'e10_maj',
      'e10_rupture_type',
      'carburants_disponibles',
      'carburants_indisponibles',
      'carburants_rupture_temporaire',
      'carburants_rupture_definitive',
    ].join(','),
    order_by: 'id',
  });

  if (departmentCodes && departmentCodes.length > 0) {
    const normalizedCodes = Array.from(new Set(departmentCodes.map(normalizeDepartmentCode).filter(Boolean))).join('","');
    params.set('where', `code_departement in ("${normalizedCodes}")`);
  }

  return `https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/prix-des-carburants-en-france-flux-instantane-v2/records?${params.toString()}`;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => typeof entry === 'string' ? entry.trim() : '')
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];

    if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
      try {
        return asStringArray(JSON.parse(trimmed));
      } catch {
        return trimmed.split(',').map((entry) => entry.trim()).filter(Boolean);
      }
    }

    return trimmed.split(',').map((entry) => entry.trim()).filter(Boolean);
  }

  return [];
}

function normalizeRuptureType(value: string | null | undefined): 'temporaire' | 'definitive' | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized.startsWith('temp')) return 'temporaire';
  if (normalized.startsWith('def')) return 'definitive';
  return null;
}

function computeAgeMinutes(updatedAt: string | null): number | null {
  if (!updatedAt) return null;
  const timestamp = new Date(updatedAt).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
}

function hasFuelLabel(labels: Iterable<string>, fuelType: FuelType): boolean {
  const expected = FUEL_LABELS[fuelType].toLowerCase();
  for (const label of labels) {
    if (label.trim().toLowerCase() === expected) return true;
  }
  return false;
}

function buildFuelStatus(record: FuelApiRecord, fuelType: FuelType): FuelStationFuelStatus | null {
  const availableLabels = new Set(asStringArray(record.carburants_disponibles));
  const unavailableLabels = new Set(asStringArray(record.carburants_indisponibles));
  const temporaryRuptures = new Set(asStringArray(record.carburants_rupture_temporaire));
  const definitiveRuptures = new Set(asStringArray(record.carburants_rupture_definitive));

  const rawPrice = record[`${fuelType}_prix` as keyof FuelApiRecord];
  const price = typeof rawPrice === 'number' && Number.isFinite(rawPrice) ? rawPrice : null;

  const rawUpdatedAt = record[`${fuelType}_maj` as keyof FuelApiRecord];
  const updatedAt = typeof rawUpdatedAt === 'string' && rawUpdatedAt ? rawUpdatedAt : null;

  const directRupture = normalizeRuptureType(record[`${fuelType}_rupture_type` as keyof FuelApiRecord] as string | null | undefined);
  const ruptureType = directRupture
    ?? (hasFuelLabel(temporaryRuptures, fuelType) ? 'temporaire' : null)
    ?? (hasFuelLabel(definitiveRuptures, fuelType) ? 'definitive' : null);

  const isReferenced =
    price !== null ||
    updatedAt !== null ||
    ruptureType !== null ||
    hasFuelLabel(availableLabels, fuelType) ||
    hasFuelLabel(unavailableLabels, fuelType) ||
    hasFuelLabel(temporaryRuptures, fuelType) ||
    hasFuelLabel(definitiveRuptures, fuelType);

  if (!isReferenced) return null;

  return {
    fuelType,
    label: FUEL_LABELS[fuelType],
    price,
    updatedAt,
    updateAgeMinutes: computeAgeMinutes(updatedAt),
    ruptureType,
    available: ruptureType === null && (price !== null || hasFuelLabel(availableLabels, fuelType)),
  };
}

function normalizeStation(record: FuelApiRecord, fetchedAt: string): FuelStation | null {
  const departmentCode = typeof record.code_departement === 'string' ? normalizeDepartmentCode(record.code_departement) : '';
  if (!departmentCode || !isNationalDepartmentCode(departmentCode)) return null;

  const fuels = MONITORED_FUELS.reduce<Partial<Record<FuelType, FuelStationFuelStatus>>>((acc, fuelType) => {
    const status = buildFuelStatus(record, fuelType);
    if (status) acc[fuelType] = status;
    return acc;
  }, {});

  if (Object.keys(fuels).length === 0) return null;

  const lon = typeof record.geom?.lon === 'number' ? record.geom.lon : null;
  const lat = typeof record.geom?.lat === 'number' ? record.geom.lat : null;

  return {
    id: String(record.id),
    departmentCode,
    departmentName: typeof record.departement === 'string' && record.departement ? record.departement : departmentCode,
    city: typeof record.ville === 'string' ? record.ville : '',
    address: typeof record.adresse === 'string' ? record.adresse : undefined,
    location: lon !== null && lat !== null ? [lon, lat] : null,
    fetchedAt,
    fuels,
  };
}

async function fetchFuelApiPage(url: string, attempt = 0): Promise<FuelApiResponse> {
  const response = await fetch(`${FUEL_PRICES_PROXY_ENDPOINT}?url=${encodeURIComponent(url)}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    if (attempt < RETRY_DELAYS_MS.length && response.status >= 500) {
      await delay(RETRY_DELAYS_MS[attempt]);
      return fetchFuelApiPage(url, attempt + 1);
    }
    throw new Error(`Fuel prices upstream returned HTTP ${response.status}`);
  }

  try {
    return await response.json() as FuelApiResponse;
  } catch (error) {
    if (attempt < RETRY_DELAYS_MS.length) {
      await delay(RETRY_DELAYS_MS[attempt]);
      return fetchFuelApiPage(url, attempt + 1);
    }
    throw error instanceof Error ? error : new Error('Invalid fuel prices payload');
  }
}

async function fetchAllFuelPages(departmentCodes?: string[]): Promise<FuelApiRecord[]> {
  const firstPage = await fetchFuelApiPage(buildUpstreamUrl(0, departmentCodes));
  const totalCount = typeof firstPage.total_count === 'number' ? firstPage.total_count : (firstPage.results?.length ?? 0);
  const pages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const results = [...(firstPage.results ?? [])];

  if (pages === 1) return results;

  const offsets = Array.from({ length: pages - 1 }, (_, index) => (index + 1) * PAGE_SIZE);
  for (let index = 0; index < offsets.length; index += PAGE_BATCH_SIZE) {
    const batch = offsets.slice(index, index + PAGE_BATCH_SIZE);
    const pageResults = await Promise.all(batch.map((offset) => fetchFuelApiPage(buildUpstreamUrl(offset, departmentCodes))));
    for (const page of pageResults) {
      results.push(...(page.results ?? []));
    }
  }

  return results;
}

async function fetchFuelStationsUncached(departmentCodes?: string[]): Promise<FuelStation[]> {
  const fetchedAt = new Date().toISOString();
  const rawRecords = await fetchAllFuelPages(departmentCodes);
  const stationMap = new Map<string, FuelStation>();

  for (const record of rawRecords) {
    const station = normalizeStation(record, fetchedAt);
    if (!station) continue;
    stationMap.set(station.id, station);
  }

  return Array.from(stationMap.values()).sort((a, b) => {
    const byDept = compareDepartmentCodes(a.departmentCode, b.departmentCode);
    if (byDept !== 0) return byDept;
    return a.id.localeCompare(b.id, 'fr-FR');
  });
}

export async function fetchFuelStations(departmentCodes?: string[]): Promise<FuelStation[]> {
  const normalizedCodes = departmentCodes?.map(normalizeDepartmentCode).filter(isNationalDepartmentCode);
  const cacheKey = buildCacheKey(normalizedCodes);
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < FUEL_PRICES_CACHE_TTL_MS) {
    return cached.data;
  }

  const inflight = inflightRequests.get(cacheKey);
  if (inflight) return inflight;

  const request = fetchFuelStationsUncached(normalizedCodes)
    .then((stations) => {
      cache.set(cacheKey, { data: stations, fetchedAt: Date.now() });
      inflightRequests.delete(cacheKey);
      return stations;
    })
    .catch((error) => {
      inflightRequests.delete(cacheKey);
      throw error;
    });

  inflightRequests.set(cacheKey, request);
  return request;
}

export function clearFuelPricesCache(): void {
  cache.clear();
  inflightRequests.clear();
}
