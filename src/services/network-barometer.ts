/**
 * network-barometer.ts — Baromètre composite santé infrastructure réseau France
 *
 * Agrège les caches existants (sans nouveaux appels réseau) :
 *  - Ecowatt (électricité)          30%
 *  - BGP (visibilité RIPEstat)      25%
 *  - ARCEP (télécom)                15%
 *  - Cloud (zones françaises des pages d’état)  15%
 *  - Météo spatiale                 10%
 *  - Tension cyber                   5%
 */

import type { CloudOutagesResponse, CyberResponse, EcowattResponse, InternetOutagesResponse, TelecomOutagesResponse } from '../types/index.ts';
import type { SpaceWeatherData } from './space-weather.ts';
import type { EolienLive } from './eolien/types.ts';
import { fetchEcowatt } from './ecowatt.ts';
import { ecowattToday } from './ecowatt-official.ts';
import { fetchInternet } from './outages-internet.ts';
import { fetchCloud } from './outages-cloud.ts';
import { cloudLive, isDeducedZone, telecomIfFresh } from './outages-levels.ts';
import { fetchTelecom } from './outages-telecom.ts';
import { fetchSpaceWeather } from './space-weather.ts';
import { fetchCyber } from './sovereignty-cyber.ts';
import { servedCyber } from './sovereignty-inputs.ts';
import { isSovereigntyDataLate } from './sovereignty-levels.ts';
import { computeCyberPressureAssessment } from './cyber-threat-scoring.ts';

// ── Types exportés ────────────────────────────────────────────────────────────

export interface NetworkBarometerResult {
  score: number;                              // 0-100, 100 = fully nominal
  status: 'nominal' | 'degraded' | 'critical';
  details: Record<string, number | null>;    // score normalisé par source (null = indisponible)
  computedAt: Date;
  reliable: boolean;                         // false si activeWeights < 30% du total
}

export interface EolienBarometerInput {
  live: EolienLive | null;
}

// ── Pondérations ──────────────────────────────────────────────────────────────

const WEIGHTS = {
  elec:    30,
  bgp:     25,
  telecom: 15,
  cloud:   15,
  space:   10,
  cyber:    5,
  wind:     5,   // Éolien : alerte de production faible sur le réseau électrique
} as const;

type WeightKey = keyof typeof WEIGHTS;

// ── Cache interne ─────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60_000;
let _cache: { data: NetworkBarometerResult; ts: number } | null = null;
let _eolienLive: EolienLive | null = null;

/** Called from App.ts when eolien snapshot is updated */
export function setBarometerEolienLive(live: EolienLive | null): void {
  _eolienLive = live;
}

// ── Normalisations par source (→ health score 0-100, 100 = nominal) ───────────

/**
 * Écowatt est un signal NATIONAL (RTE) : green → santé pleine, orange/rouge → dégradée.
 * Niveau inconnu (signal officiel indisponible) → `null`, jamais un 100 « par défaut » : la
 * composante électricité est alors exclue et les poids restants renormalisés par
 * `calculateGlobalScore()`.
 */
export function normalizeElec(data: EcowattResponse, nowMs: number = Date.now()): number | null {
  const level = ecowattToday(data.official, nowMs);
  if (level === 'green') return 100;
  if (level === 'orange') return 60;
  if (level === 'red') return 20;
  return null;
}

/**
 * Santé télécom : 100 moins les pannes imprévues récentes (< 24 h) du fichier ARCEP, divisées par 50 (arbitrage 7 du plan 2026-10-08).
 * Fichier non lu : null (composante exclue), jamais un 100 « par défaut ».
 */
export function normalizeTelecom(r: TelecomOutagesResponse | null): number | null {
  if (r === null || r.summary === null) return null;
  return Math.max(0, Math.round(100 - r.summary.recent / 50));
}

/**
 * Entrées télécom du baromètre (P17) : le fichier ARCEP passe par telecomIfFresh, comme pour le score France. Fichier en retard, non lu ou
 * sans résumé : composante null et aucune panne versée au contexte cyber (`undefined`, jamais un 0 présenté comme mesuré).
 */
export function telecomInputs(r: TelecomOutagesResponse | null, now: number): { score: number | null; outageCount: number | undefined } {
  const fresh = telecomIfFresh(r, now);
  return { score: normalizeTelecom(fresh), outageCount: fresh?.summary?.recent ?? undefined };
}

/**
 * Santé BGP : visibilité minimale des grands réseaux français relevée par RIPEstat (spec § 3.1), arrondie. null si aucun relevé, aucun
 * réseau, ou instantané en retard (règle RIPEstat : query_time + 10 h, P15) : jamais un 100 « par défaut ».
 */
export function normalizeBgp(r: InternetOutagesResponse | null, now: number = Date.now()): number | null {
  const ripe = r?.ripe ?? null;
  if (ripe === null || ripe.networks.length === 0 || isSovereigntyDataLate('ripestat', ripe.snapshotAt, now)) return null;
  return Math.round(Math.min(...ripe.networks.map((n) => n.visibilityPct)));
}

/**
 * Santé Cloud : part des zones françaises saines (opérationnelles ou en maintenance) parmi toutes les zones suivies des fournisseurs à
 * jour (cloudLive, R41 : dernière lecture réussie de moins de 2 h ; un fournisseur en retard ou jamais lu est exclu), les zones de statut
 * inconnu comprises au dénominateur (spec § 3.2, P16), × 100 arrondi. Une zone sans état publié (GCP, AWS : « opérationnelle » par
 * absence d'incident, isDeducedZone) n'est comptée nulle part ; un incident publié l'y fait entrer, non saine (ruling B9, pas de vert
 * déduit). null sans zone : jamais un 100 « par défaut ».
 */
export function normalizeCloud(r: CloudOutagesResponse | null, now: number = Date.now()): number | null {
  if (r === null) return null;
  const fresh = cloudLive(r, now).freshProviders;
  const zones = r.providers
    .filter((p) => fresh.includes(p.provider))
    .flatMap((p) => p.zones.filter((z) => !isDeducedZone(p.provider, z)));
  if (zones.length === 0) return null;
  const healthy = zones.filter((z) => z.status === 'operational' || z.status === 'maintenance').length;
  return Math.round((100 * healthy) / zones.length);
}

/** Contexte cyber : incidents France en cours des fournisseurs à jour (cloudLive) ; undefined si aucun n'est à jour (source muette). */
export function cloudIncidentCount(r: CloudOutagesResponse | null, now: number = Date.now()): number | undefined {
  if (r === null) return undefined;
  const live = cloudLive(r, now);
  return live.freshProviders.length === 0 ? undefined : live.incidents.length;
}

/** Santé « météo spatiale » ; null si NOAA n'a jamais été lu : composante indisponible, jamais un 100 « calme » par défaut. */
export function normalizeSpace(data: SpaceWeatherData | null): number | null {
  if (data === null) return null;
  // kp=0 → 100 (calme), kp=5 → 40 (tempête G1), kp≥9 → 0 (extrême)
  return Math.max(0, 100 - Math.min(data.kpIndex * 12, 100));
}

/**
 * Santé cyber (5 %) : 100 moins la pression cyber consolidée, même fonction que le pilier Sécurité (arbitrage 11). Un compte `undefined`
 * (source muette ou en retard) ne pèse pas.
 */
export function normalizeCyber(
  cyber: CyberResponse,
  context: { telecomOutageCount?: number; cloudIncidentCount?: number },
  now: number = Date.now(),
): number {
  // Pression consolidée : 0 = calme, 100 = crise ; inversée pour obtenir un score de santé.
  return 100 - computeCyberPressureAssessment(cyber, {
    telecomOutageCount: context.telecomOutageCount,
    cloudIncidentCount: context.cloudIncidentCount,
  }, now).score;
}

function computeNationalCyberPressure(cyber: CyberResponse, now: number = Date.now()): number {
  return computeCyberPressureAssessment(cyber, {}, now).score;
}

function normalizeWind(live: EolienLive): number {
  // facteur_charge : 0–1 (ratio production/installé)
  // alerté si production_gw < alertLevel seuil ou facteur < 5%
  // On pénalise sur la qualité du signal, pas sur le volume absolu :
  //   - 'normal'         → 100 (pas de problème)
  //   - 'watch'          →  70 (vent modéré, production réduite)
  //   - 'low-production' →  40 (production faible, risque réseau)
  switch (live.alertLevel) {
    case 'normal': return 100;
    case 'watch':  return 70;
    default:       return 40;   // low-production
  }
}

// ── Score global ──────────────────────────────────────────────────────────────

function calculateGlobalScore(scores: Partial<Record<WeightKey, number | null>>): number {
  let totalScore = 0;
  let activeWeights = 0;

  for (const [key, weight] of Object.entries(WEIGHTS) as [WeightKey, number][]) {
    const s = scores[key];
    if (s !== null && s !== undefined) {
      totalScore += s * weight;
      activeWeights += weight;
    }
  }
  // cloud est null → activeWeights = 85 (pas 100).
  // La division renormalise automatiquement sur 100.
  return activeWeights > 0 ? Math.round(totalScore / activeWeights) : 0;
}

function toStatus(score: number): NetworkBarometerResult['status'] {
  if (score >= 85) return 'nominal';
  if (score >= 60) return 'degraded';
  return 'critical';
}

// ── Fonction principale ────────────────────────────────────────────────────────

export async function fetchNetworkBarometer(): Promise<NetworkBarometerResult> {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) return _cache.data;

  // Fetch toutes les sources en parallèle — échec partiel → null pour cette source
  const [ecowattRes, internetRes, telecomRes, spaceRes, cyberRes, cloudRes] = await Promise.allSettled([
    fetchEcowatt(),
    fetchInternet(null),
    fetchTelecom(null),
    fetchSpaceWeather(),
    fetchCyber(null),
    fetchCloud(null),
  ]);
  const now = Date.now();

  // Vigilance cyber : réponse de /api/sovereignty/cyber, CERT-FR lu et à l'heure (fetchCyber ne rejette jamais) ; sinon composante
  // indisponible, jamais une santé de 100 par défaut.
  const cyber = cyberRes.status === 'fulfilled' ? servedCyber(cyberRes.value.cyber.data, now) : null;
  // Les services rendent des états (créneau de lecture) : la réponse est `.data`, null si rien n'a été lu (P4).
  const telecom = telecomInputs(telecomRes.status === 'fulfilled' ? telecomRes.value.telecom.data : null, now);
  const internet = internetRes.status === 'fulfilled' ? internetRes.value.internet.data : null;
  const cloud = cloudRes.status === 'fulfilled' ? cloudRes.value.cloud.data : null;

  const scores: Partial<Record<WeightKey, number | null>> = {
    elec:    ecowattRes.status  === 'fulfilled' ? normalizeElec(ecowattRes.value)       : null,
    bgp:     normalizeBgp(internet, now),
    telecom: telecom.score,
    cloud:   normalizeCloud(cloud, now),
    space:   spaceRes.status    === 'fulfilled' ? normalizeSpace(spaceRes.value)        : null,
    cyber:   cyber !== null
      ? normalizeCyber(cyber, { telecomOutageCount: telecom.outageCount, cloudIncidentCount: cloudIncidentCount(cloud, now) }, now)
      : null,
    wind:    _eolienLive !== null ? normalizeWind(_eolienLive) : null,
  };

  const nationalCyberPressure = cyber !== null ? computeNationalCyberPressure(cyber) : null;

  const activeWeights = (Object.entries(WEIGHTS) as [WeightKey, number][])
    .filter(([k]) => scores[k] !== null && scores[k] !== undefined)
    .reduce((sum, [, w]) => sum + w, 0);

  const score = calculateGlobalScore(scores);

  // Fallback si tous les services sont tombés
  if (activeWeights === 0) {
    const fallback = _cache?.data ?? {
      score: 75,
      status: 'degraded' as const,
      details: { elec: null, bgp: null, telecom: null, cloud: null, space: null, cyber: null, cyberNational: null, wind: null },
      computedAt: new Date(),
      reliable: false,
    };
    return fallback;
  }

  const result: NetworkBarometerResult = {
    score,
    status: toStatus(score),
    details: {
      elec:    scores.elec    ?? null,
      bgp:     scores.bgp     ?? null,
      telecom: scores.telecom ?? null,
      cloud:   scores.cloud   ?? null,
      space:   scores.space   ?? null,
      cyber:   scores.cyber   ?? null,
      cyberNational: nationalCyberPressure,
      wind:    scores.wind    ?? null,
    },
    computedAt: new Date(),
    reliable: activeWeights >= 30,
  };

  _cache = { data: result, ts: Date.now() };
  return result;
}
