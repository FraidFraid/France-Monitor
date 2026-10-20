// src/services/exposure-assets.ts : enjeux croisés avec les phénomènes de l'onglet Environnement (spec 2026-10-20 § 3, lot 2).
// Centrales nucléaires (référentiel embarqué), sites Seveso (public/data/seveso.json, Géorisques, scripts/build-seveso.mjs),
// sites d'urgences (public/data/hospitals-urgences.json, SAE + FINESS) et EHPAD (public/data/ehpad.json, FINESS). Fichiers
// statiques lus une fois par session, à l'allumage de la pastille En bref ; un fichier en échec est dit et relu à l'appel suivant.
import { NUCLEAR_PLANTS } from '../config/infrastructure.ts';
import type { ExposureAsset, ExposureAssetKind } from './environment-exposure.ts';
import { isRecord, readHealthJsonShared } from './health-surveillance.ts';
import { HOSPITALS_URL } from './health-offer.ts';

export const SEVESO_URL = '/data/seveso.json';
export const EHPAD_URL = '/data/ehpad.json';

/** Département de chaque centrale (le référentiel n'en porte pas). Fessenheim, à l'arrêt définitif, n'est pas un enjeu. */
const NUCLEAR_DEPT: Readonly<Record<string, string>> = {
  'nuc-gravelines': '59', 'nuc-blayais': '33', 'nuc-bugey': '01', 'nuc-cattenom': '57', 'nuc-chinon': '37', 'nuc-chooz': '08',
  'nuc-civaux': '86', 'nuc-cruas': '07', 'nuc-dampierre': '45', 'nuc-flamanville': '50', 'nuc-golfech': '82', 'nuc-nogent': '10',
  'nuc-paluel': '76', 'nuc-penly': '76', 'nuc-saint-alban': '38', 'nuc-saint-laurent': '41', 'nuc-tricastin': '26', 'nuc-belleville': '18',
};

export function nuclearAssets(): ExposureAsset[] {
  return NUCLEAR_PLANTS.filter((p) => p.status !== 'shutdown' && NUCLEAR_DEPT[p.id] !== undefined).map((p) => ({
    id: p.id, kind: 'nucleaire' as const, name: `Centrale de ${p.name}`, commune: null, dept: NUCLEAR_DEPT[p.id],
    lon: p.coordinates[0], lat: p.coordinates[1], detail: null, url: null,
  }));
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string';

/** Sites Seveso du fichier Géorisques ; enregistrement invalide écarté. */
export function sevesoAssets(json: unknown): ExposureAsset[] {
  if (!isRecord(json) || !Array.isArray(json.sites)) throw new Error('réponse inattendue');
  const out: ExposureAsset[] = [];
  for (const s of json.sites) {
    if (!isRecord(s) || !str(s.id) || !str(s.name) || !str(s.dept) || !num(s.lon) || !num(s.lat)) continue;
    if (s.seuil !== 'haut' && s.seuil !== 'bas') continue;
    const kind: ExposureAssetKind = s.seuil === 'haut' ? 'seveso-haut' : 'seveso-bas';
    out.push({
      id: `seveso-${s.id}`, kind, name: s.name, commune: str(s.commune) ? s.commune : null, dept: s.dept, lon: s.lon, lat: s.lat,
      detail: s.seuil === 'haut' ? 'Seveso seuil haut' : 'Seveso seuil bas', url: str(s.url) ? s.url : null,
    });
  }
  return out;
}

/** Sites d'urgences (hors antennes saisonnières : présence non garantie). */
export function hospitalAssets(json: unknown): ExposureAsset[] {
  if (!isRecord(json) || !Array.isArray(json.sites)) throw new Error('réponse inattendue');
  const out: ExposureAsset[] = [];
  for (const s of json.sites) {
    if (!isRecord(s) || !str(s.finess) || !str(s.name) || !str(s.dept) || !num(s.lon) || !num(s.lat) || s.seasonal === true) continue;
    const urg = [s.general === true ? 'adultes' : null, s.pediatric === true ? 'pédiatriques' : null].filter((x): x is string => x !== null);
    out.push({
      id: `hop-${s.finess}`, kind: 'hopital', name: s.name, commune: str(s.commune) ? s.commune : null, dept: s.dept, lon: s.lon, lat: s.lat,
      detail: urg.length > 0 ? `urgences ${urg.join(' et ')}` : 'urgences', url: null,
    });
  }
  return out;
}

/** EHPAD, avec leur nombre de places. */
export function ehpadAssets(json: unknown): ExposureAsset[] {
  if (!isRecord(json) || !Array.isArray(json.sites)) throw new Error('réponse inattendue');
  const out: ExposureAsset[] = [];
  for (const s of json.sites) {
    if (!isRecord(s) || !str(s.finess) || !str(s.name) || !str(s.dept) || !num(s.lon) || !num(s.lat)) continue;
    out.push({
      id: `ehpad-${s.finess}`, kind: 'ehpad', name: s.name, commune: str(s.commune) ? s.commune : null, dept: s.dept, lon: s.lon, lat: s.lat,
      detail: num(s.places) ? `${s.places}\u00a0places` : null, url: null,
    });
  }
  return out;
}

/** Fichier Seveso pour la pastille « Sites Seveso » (20/10/2026) : sites et date du recensement Géorisques. */
export interface SevesoDataset { sites: ExposureAsset[]; readAt: string | null; source: string }

let sevesoCache: SevesoDataset | null = null;

/** Lecture unique par session (relue après un échec) ; rejette si le fichier est illisible. */
export async function fetchSevesoDataset(): Promise<SevesoDataset> {
  if (sevesoCache) return sevesoCache;
  const json = await readHealthJsonShared(SEVESO_URL);
  const sites = sevesoAssets(json);
  const readAt = isRecord(json) && str(json.readAt) ? json.readAt : null;
  const source = isRecord(json) && str(json.source) ? json.source : 'Géorisques';
  sevesoCache = { sites, readAt, source };
  return sevesoCache;
}

export interface ExposureAssetsState {
  assets: ExposureAsset[];
  /** Fichiers illisibles (« Seveso », « hôpitaux », « EHPAD ») : leurs enjeux manquent, c'est dit dans le panneau. */
  missing: string[];
  fetchedAt: number;
}

let cached: ExposureAssetsState | null = null;

/** Lit les trois fichiers (une fois par session s'ils ont tous été lus) ; ne rejette jamais. */
export async function fetchExposureAssets(now: number = Date.now()): Promise<ExposureAssetsState> {
  if (cached !== null && cached.missing.length === 0) return cached;
  const sources: Array<[string, string, (json: unknown) => ExposureAsset[]]> = [
    ['Seveso', SEVESO_URL, sevesoAssets], ['hôpitaux', HOSPITALS_URL, hospitalAssets], ['EHPAD', EHPAD_URL, ehpadAssets],
  ];
  const results = await Promise.all(sources.map(async ([label, url, parse]) => {
    try {
      return { label, assets: parse(await readHealthJsonShared(url)) };
    } catch {
      return { label, assets: null };
    }
  }));
  const assets = [...nuclearAssets(), ...results.flatMap((r) => r.assets ?? [])];
  cached = { assets, missing: results.filter((r) => r.assets === null).map((r) => r.label), fetchedAt: now };
  return cached;
}

/** Tests seulement. */
export function resetExposureAssetsCache(): void {
  cached = null;
}
