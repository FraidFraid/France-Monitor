// src/services/health-offer.ts : offre de soins, fichiers statiques annuels (spec 2026-10-03 § 2.7, § 2.8) : APL DREES 2024 et
// sites d'urgences SAE 2025 + FINESS. Données annuelles servies par le CDN : lues une fois par session, relues après un échec.
import type { AplDataset, DataSourceStatus, HospitalsDataset } from '../types/index.ts';
import { dataDateMs, isRecord, isStringArray, readHealthJson, type SourceSlot } from './health-surveillance.ts';

export const APL_URL = '/data/apl-2024.json';
export const HOSPITALS_URL = '/data/hospitals-urgences.json';

export interface HealthOfferState { apl: SourceSlot<AplDataset>; hospitals: SourceSlot<HospitalsDataset> }

export function isAplDataset(v: unknown): v is AplDataset {
  if (!isRecord(v) || typeof v.vintage !== 'number' || typeof v.publishedAt !== 'string' || !isStringArray(v.missing) || !Array.isArray(v.departments)) return false;
  const france = v.france;
  return isRecord(france) && isRecord(france.apl) && isRecord(france.apl2023) && Array.isArray(france.byYear)
    && v.departments.every((d: unknown) => isRecord(d) && typeof d.code === 'string' && typeof d.name === 'string' && isRecord(d.apl)
      && isRecord(d.apl2023) && typeof d.shareUnder25 === 'number');
}

export function isHospitalsDataset(v: unknown): v is HospitalsDataset {
  return isRecord(v) && typeof v.vintage === 'number' && typeof v.finessDate === 'string' && isRecord(v.totals)
    && Array.isArray(v.establishments) && isStringArray(v.unmatched) && Array.isArray(v.sites)
    && v.sites.every((s: unknown) => isRecord(s) && typeof s.finess === 'string' && typeof s.lat === 'number' && typeof s.lon === 'number'
      && typeof s.category === 'string');
}

interface SessionCache<T> { value: T | null; at: number | null }
const aplCache: SessionCache<AplDataset> = { value: null, at: null };
const hospitalsCache: SessionCache<HospitalsDataset> = { value: null, at: null };

async function loadStatic<T>(
  url: string, cache: SessionCache<T>, guard: (v: unknown) => v is T, previous: SourceSlot<T> | undefined, now: number,
): Promise<SourceSlot<T>> {
  if (cache.value !== null) return { data: cache.value, error: null, fetchedAt: cache.at };
  try {
    const json = await readHealthJson(url);
    if (!guard(json)) throw new Error('réponse inattendue');
    cache.value = json;
    cache.at = now;
    return { data: json, error: null, fetchedAt: now };
  } catch (err) {
    return { data: previous?.data ?? null, error: err instanceof Error ? err.message : 'erreur inconnue', fetchedAt: previous?.fetchedAt ?? null };
  }
}

/** Ne rejette jamais : un fichier en échec porte `error`, garde les données précédentes et sera relu à l'appel suivant. */
export async function fetchHealthOffer(previous: HealthOfferState | null, now: number = Date.now()): Promise<HealthOfferState> {
  const [apl, hospitals] = await Promise.all([
    loadStatic(APL_URL, aplCache, isAplDataset, previous?.apl, now),
    loadStatic(HOSPITALS_URL, hospitalsCache, isHospitalsDataset, previous?.hospitals, now),
  ]);
  return { apl, hospitals };
}

/** Tests seulement : vide le cache de session. */
export function resetHealthOfferCache(): void {
  aplCache.value = null;
  aplCache.at = null;
  hospitalsCache.value = null;
  hospitalsCache.at = null;
}

/** Panneau des sources : date de publication DREES (APL) ou date de l'extraction FINESS (hôpitaux), jamais l'heure de lecture. */
export function offerStatus(offer: HealthOfferState, key: 'apl' | 'hospitals'): Pick<DataSourceStatus, 'status' | 'lastUpdate' | 'error'> {
  const slot = offer[key];
  if (slot.data === null) return { status: slot.error !== null ? 'error' : 'loading', lastUpdate: null, error: slot.error ?? undefined };
  const ms = dataDateMs(key === 'apl' ? offer.apl.data?.publishedAt : offer.hospitals.data?.finessDate);
  return { status: slot.error !== null ? 'stale' : 'ok', lastUpdate: ms === null ? null : new Date(ms), error: slot.error ?? undefined };
}
