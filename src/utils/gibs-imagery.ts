const GIBS_VIIRS_BASE_URL =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/'
  + 'VIIRS_SNPP_CorrectedReflectance_TrueColor/default';

/**
 * NASA's processing delay varies. The undated WMTS resource always resolves to
 * the most recent image GIBS has actually published, avoiding 404s on J-2 gaps.
 */
export function buildLatestGibsViirsTileUrl(): string {
  return `${GIBS_VIIRS_BASE_URL}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpeg`;
}
