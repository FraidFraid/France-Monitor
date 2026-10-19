// src/services/flux-pietons.ts : lecture client de la couche Flux piétons : prévisions publiées par flux_osint (Python, hors de ce
// dépôt) dans data/flux-pietons/ (index.json + un GeoJSON par événement). Contrat : flux_osint/docs/francemonitor_flux_format.md.
// En local, le dossier est écrit dans public/ par le batch de flux_osint ; en production, dans /var/lib/francemonitor/data/flux-pietons
// (bloc Caddy dédié). ESTIMATIONS MODÉLISÉES : jamais présentées comme des mesures. Aucun effet sur l'indice de stabilité.
import type { FluxEvent, FluxIndex, FluxPhase, FluxTiming, FluxTopRue } from '../types/index.ts';
import { levelHex } from './vigilance.ts';

export const FLUX_BASE_URL = '/data/flux-pietons/';
export const FLUX_INDEX_URL = `${FLUX_BASE_URL}index.json`;
/** Le batch de flux_osint tourne toutes les 15 min. */
export const FLUX_POLL_MS = 15 * 60_000;
export const FLUX_WARNING = 'ESTIMATIONS MODÉLISÉES : ces valeurs ne sont pas des mesures.';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
/** Nom de fichier publié : slug simple, jamais de chemin (pas de « .. » ni de « / »). */
const SAFE_FILE = /^[a-z0-9_]+\.geojson$/;

function isTopRue(v: unknown): v is FluxTopRue {
  return isRecord(v) && isStr(v['rue']) && isNum(v['chargeP90']) && isNum(v['densiteP90']) && isNum(v['pSaturation']);
}

const isNumOrAbsent = (v: unknown): boolean => v === undefined || v === null || isNum(v);
const numOrNull = (v: unknown): number | null => (isNum(v) ? v : null);

/** Paramètres du rejeu valides (positifs), sinon null : le curseur est alors absent. */
export function parseFluxTiming(v: unknown): FluxTiming | null {
  if (!isRecord(v)) return null;
  const keys = ['arriveeMin', 'pointeArrivee', 'departMin', 'pointeDepart', 'dureeMin', 'vitesse'] as const;
  if (!keys.every((k) => isNum(v[k]) && v[k] > 0)) return null;
  return {
    arriveeMin: v['arriveeMin'] as number, pointeArrivee: v['pointeArrivee'] as number, departMin: v['departMin'] as number,
    pointeDepart: v['pointeDepart'] as number, dureeMin: v['dureeMin'] as number, vitesse: v['vitesse'] as number,
  };
}

export function isFluxEvent(v: unknown): v is FluxEvent {
  if (!isRecord(v)) return false;
  const pt = v['point'];
  const aff = v['affluence'];
  const res = v['resume'];
  return isStr(v['id']) && isStr(v['evenement']) && isStr(v['ville']) && (v['codeInsee'] === null || isStr(v['codeInsee']))
    && (v['debut'] === null || isStr(v['debut'])) && isStr(v['lieu']) && isBool(v['lieuSuppose'])
    && Array.isArray(pt) && pt.length === 2 && isNum(pt[0]) && isNum(pt[1]) && Math.abs(pt[0]) <= 180 && Math.abs(pt[1]) <= 90
    && isRecord(aff) && isNum(aff['p10']) && isNum(aff['p50']) && isNum(aff['p90']) && isStr(aff['base'])
    && isNumOrAbsent(aff['p25']) && isNumOrAbsent(aff['p75']) && isNumOrAbsent(aff['plafond']) && isNumOrAbsent(aff['partPlafonnee'])
    && (v['meteo'] === null || isStr(v['meteo'])) && isBool(v['recale']) && isBool(v['cortege']) && isStr(v['calculeLe'])
    && isStr(v['fichier']) && SAFE_FILE.test(v['fichier'])
    && isRecord(res) && isNum(res['troncons']) && isNum(res['satures']) && isNum(res['goulots'])
    && Array.isArray(res['topRues']) && res['topRues'].every(isTopRue);
}

/** Garde de l'index : un événement mal formé est écarté, pas tout le fichier ; un index mal formé est rejeté. */
export function parseFluxIndex(v: unknown): FluxIndex | null {
  if (!isRecord(v) || v['version'] !== 1 || !isStr(v['generatedAt']) || !Array.isArray(v['evenements'])) return null;
  return {
    version: 1,
    generatedAt: v['generatedAt'],
    avertissement: isStr(v['avertissement']) && v['avertissement'] ? v['avertissement'] : FLUX_WARNING,
    methode: isStr(v['methode']) ? v['methode'] : '',
    evenements: v['evenements'].filter(isFluxEvent).map(withAffluenceFields),
  };
}

/** Champs d'affluence ajoutés au contrat (fourchette probable, plafond) : absents d'une ancienne publication = null. */
function withAffluenceFields(e: FluxEvent): FluxEvent {
  const a = e.affluence as Partial<FluxEvent['affluence']> & Pick<FluxEvent['affluence'], 'p10' | 'p50' | 'p90' | 'base'>;
  return {
    ...e,
    temps: parseFluxTiming((e as { temps?: unknown }).temps),
    affluence: {
      p10: a.p10, p25: numOrNull(a.p25), p50: a.p50, p75: numOrNull(a.p75), p90: a.p90, base: a.base,
      plafond: numOrNull(a.plafond), partPlafonnee: numOrNull(a.partPlafonnee),
    },
  };
}

/** Index vide : aucune prévision publiée (dossier absent en production tant que flux_osint n'y tourne pas). */
export const EMPTY_FLUX_INDEX: Readonly<FluxIndex> = { version: 1, generatedAt: '', avertissement: FLUX_WARNING, methode: '', evenements: [] };

/** Relève de l'index : 404 = rien de publié (index vide), autre échec = erreur ; jamais de cache du navigateur. */
export async function fetchFluxIndex(fetchImpl: typeof fetch = fetch): Promise<FluxIndex> {
  const res = await fetchImpl(FLUX_INDEX_URL, { cache: 'no-store' });
  if (res.status === 404) return { ...EMPTY_FLUX_INDEX, evenements: [] };
  if (!res.ok) throw new Error(`Flux piétons : HTTP ${res.status}`);
  // Un repli de serveur qui rendrait la page de l'application (HTML) est une erreur, pas un index.
  if (!(res.headers.get('content-type') ?? '').includes('json')) throw new Error('Flux piétons : réponse non JSON');
  const index = parseFluxIndex(await res.json() as unknown);
  if (!index) throw new Error('Flux piétons : index mal formé');
  return index;
}

/** Propriétés d'un tronçon publié (contrat, `kind: "troncon"`). */
export interface FluxSegmentProps {
  kind: 'troncon';
  rue: string; largeur: number; chargeP50: number; chargeP90: number; densiteP90: number; pSaturation: number;
  chargeDepartP90: number; pSaturationDepart: number; pEmprise: number; parcours: boolean; pGoulot: number;
  /** Distance au point par le réseau (m) ; null : publication antérieure au rejeu. */
  distance: number | null;
}

export type FluxFeature = GeoJSON.Feature<GeoJSON.Geometry, Record<string, unknown>>;

const geometryOk = (g: unknown): g is GeoJSON.Geometry => isRecord(g) && isStr(g['type']) && Array.isArray(g['coordinates']);

/** Objets reconnus seulement (tronçon, isochrone, rassemblement) ; le reste est écarté. */
export function parseFluxGeojson(v: unknown): FluxFeature[] {
  if (!isRecord(v) || !Array.isArray(v['features'])) return [];
  return v['features'].filter((f): f is FluxFeature => isRecord(f) && geometryOk(f['geometry']) && isRecord(f['properties'])
    && ['troncon', 'isochrone', 'rassemblement'].includes(String(f['properties']['kind'])));
}

const geoCache = new Map<string, Promise<FluxFeature[]>>();

/** GeoJSON d'un événement, mémorisé par fichier et date de calcul (un recalcul change `calculeLe`) ; un échec n'est pas mémorisé. */
export function fetchFluxEvent(ev: Pick<FluxEvent, 'fichier' | 'calculeLe'>, fetchImpl: typeof fetch = fetch): Promise<FluxFeature[]> {
  if (!SAFE_FILE.test(ev.fichier)) return Promise.reject(new Error('Flux piétons : nom de fichier refusé'));
  const key = `${ev.fichier}|${ev.calculeLe}`;
  let p = geoCache.get(key);
  if (!p) {
    p = fetchImpl(`${FLUX_BASE_URL}${ev.fichier}`, { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error(`Flux piétons : HTTP ${res.status}`);
        return res.json() as Promise<unknown>;
      })
      .then(parseFluxGeojson)
      .catch((err: unknown) => {
        geoCache.delete(key);
        throw err instanceof Error ? err : new Error('Flux piétons : lecture impossible');
      });
    geoCache.set(key, p);
  }
  return p;
}

export function resetFluxCache(): void {
  geoCache.clear();
}

// ─── Lecture ───

/** Probabilité de saturation (part des tirages au-delà de la capacité de Weidmann) → niveau L1 ; sous 10 % : couleur de la couche. */
export type FluxBand = 'fluide' | 'jaune' | 'orange' | 'rouge';
export function saturationBand(p: number): FluxBand {
  if (p >= 0.5) return 'rouge';
  if (p >= 0.25) return 'orange';
  if (p >= 0.1) return 'jaune';
  return 'fluide';
}

/** Couleur franche de la couche (cyan) pour le fluide ; L1 pour l'anormal. */
export const FLUX_FLUIDE_HEX = '#22d3ee';
export function bandHex(b: FluxBand): string {
  return b === 'fluide' ? FLUX_FLUIDE_HEX : levelHex(b);
}

export const BAND_WORD: Readonly<Record<FluxBand, string>> = {
  fluide: 'saturation peu probable (< 10 %)',
  jaune: 'saturation possible (10 à 25 %)',
  orange: 'saturation probable (25 à 50 %)',
  rouge: 'saturation très probable (50 % et plus)',
};

/** Valeurs de la phase choisie : arrivée (charge, saturation) ou dispersion (départ). */
export function phaseValues(p: Pick<FluxSegmentProps, 'chargeP90' | 'pSaturation' | 'chargeDepartP90' | 'pSaturationDepart'>, phase: FluxPhase): { charge: number; pSat: number } {
  return phase === 'arrivee' ? { charge: p.chargeP90, pSat: p.pSaturation } : { charge: p.chargeDepartP90, pSat: p.pSaturationDepart };
}

/** Événement le plus utile à montrer : le prochain à venir, sinon le plus récent. */
/** Moment d'un rassemblement : en cours pendant les 3 h qui suivent le début annoncé ; sans date, dit à venir. */
export function fluxMoment(debut: string | null, nowMs: number): 'avenir' | 'encours' | 'passe' {
  const t = debut ? Date.parse(debut) : Number.NaN;
  if (!Number.isFinite(t) || t > nowMs) return 'avenir';
  return nowMs - t < 3 * 3_600_000 ? 'encours' : 'passe';
}

export function defaultFluxEvent(list: readonly FluxEvent[], nowMs: number): FluxEvent | null {
  const timed = list.map((e) => ({ e, t: e.debut ? Date.parse(e.debut) : Number.NaN }));
  const upcoming = timed.filter((x) => Number.isFinite(x.t) && x.t >= nowMs - 3 * 3_600_000).sort((a, b) => a.t - b.t)[0];
  if (upcoming) return upcoming.e;
  return [...timed].sort((a, b) => (Number.isFinite(b.t) ? b.t : 0) - (Number.isFinite(a.t) ? a.t : 0))[0]?.e ?? null;
}
