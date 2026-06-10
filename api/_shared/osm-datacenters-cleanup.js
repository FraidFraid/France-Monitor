export function isFranceMetroCoordinate(coordinates) {
  const [lng, lat] = Array.isArray(coordinates) ? coordinates : [];
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  const mainland = lng >= -5.5 && lng <= 8.35 && lat >= 42.2 && lat <= 51.7;
  const corsica = lng >= 8.4 && lng <= 9.7 && lat >= 41.2 && lat <= 43.2;
  return mainland || corsica;
}

export function isLowQualityOsmDatacenter(row = {}) {
  const name = String(row.name ?? '').trim();
  const provider = String(row.provider ?? '').trim();
  const address = String(row.address ?? '').trim();
  const city = String(row.city ?? '').trim();

  if (/^building \d+$/i.test(name)) return true;
  if (/^(data ?center|datacenter)$/i.test(name)) {
    const genericProvider = !provider || /^(osm|datacenter|data ?center)$/i.test(provider);
    if (genericProvider && !address && !city) return true;
  }

  return false;
}
