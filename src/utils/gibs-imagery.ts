const GIBS_VIIRS_BASE_URL =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/'
  + 'VIIRS_SNPP_CorrectedReflectance_TrueColor/default';

// Tuile témoin couvrant la France à z5 : sert à sonder la disponibilité d'une date.
const PROBE_TILE = { z: 5, y: 11, x: 16 };

// Le WMTS REST de GIBS exige le segment {Time} : sans date → 404 systématique.
const CANDIDATE_OFFSETS_DAYS = [1, 2, 3];
const DEFAULT_OFFSET_DAYS = 2; // latence de traitement VIIRS ~24-48 h

export function buildGibsViirsTileUrl(date: string): string {
  return `${GIBS_VIIRS_BASE_URL}/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpeg`;
}

export function listGibsViirsCandidateDates(now: number = Date.now()): readonly string[] {
  return CANDIDATE_OFFSETS_DAYS.map((offset) => utcDateMinusDays(now, offset));
}

export function buildDefaultGibsViirsTileUrl(now: number = Date.now()): string {
  return buildGibsViirsTileUrl(utcDateMinusDays(now, DEFAULT_OFFSET_DAYS));
}

export async function resolveLatestGibsViirsTileUrl(options?: {
  fetchFn?: (url: string, init?: { method?: string }) => Promise<{ ok: boolean }>;
  now?: number;
}): Promise<string> {
  const fetchFn = options?.fetchFn
    ?? ((url: string, init?: { method?: string }) => fetch(url, init));
  const now = options?.now ?? Date.now();

  for (const date of listGibsViirsCandidateDates(now)) {
    const probeUrl = buildGibsViirsTileUrl(date)
      .replace('{z}', String(PROBE_TILE.z))
      .replace('{y}', String(PROBE_TILE.y))
      .replace('{x}', String(PROBE_TILE.x));
    try {
      const response = await fetchFn(probeUrl, { method: 'HEAD' });
      if (response.ok) return buildGibsViirsTileUrl(date);
    } catch {
      // Erreur réseau sur cette date : on tente la suivante.
    }
  }

  return buildDefaultGibsViirsTileUrl(now);
}

function utcDateMinusDays(now: number, days: number): string {
  return new Date(now - days * 86_400_000).toISOString().slice(0, 10);
}
