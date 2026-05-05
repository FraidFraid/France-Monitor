/**
 * network-barometer.ts — Baromètre composite santé infrastructure réseau France
 *
 * Agrège les caches existants (sans nouveaux appels réseau) :
 *  - Ecowatt (électricité)   30%
 *  - IODA/BGP (internet)     25%
 *  - ARCEP (télécom)         15%
 *  - Cloud/Web               15%  ← statuts datacenters (infra-network.ts)
 *  - Météo spatiale          10%
 *  - Tension cyber            5%
 */

import type { EcowattResponse, TelecomOutage, ThreatEvent } from '../types/index.ts';
import type { SpaceWeatherData } from './space-weather.ts';
import type { CyberState } from '../types/index.ts';
import type { InfraNetworkState } from '../types/index.ts';
import type { EolienLive } from './eolien/types.ts';
import { fetchEcowatt } from './ecowatt.ts';
import { fetchNetworkOutages } from './internet-outages.ts';
import { fetchTelecomOutages } from './outages.ts';
import { fetchSpaceWeather } from './space-weather.ts';
import { fetchCyberDashboard } from './cyber.ts';
import { fetchInfraNetwork } from './infra-network.ts';
import { fetchThreatMapEvents } from './threat-map.ts';
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

function normalizeElec(data: EcowattResponse): number {
  const signalValues = Object.values(data.signals);
  if (signalValues.length === 0) return 100;
  const mapped = signalValues.map(s => s === 'green' ? 100 : s === 'orange' ? 60 : 20);
  return Math.round(mapped.reduce((a, b) => a + b, 0) / mapped.length);
}

function normalizeTelecom(outages: TelecomOutage[]): number {
  if (outages.length === 0) return 100;
  // ARCEP dataset contains only outage/degraded sites, NOT the full network (~50 000 antennes FR).
  // Thresholds: 0 HS → 100, 500 HS (routine) → 90, 2500 HS → 50, 5000 HS (10% réseau) → 0.
  // Divisor 50: 5000 / 50 = 100 points de pénalité maximum.
  const hsSites = outages.filter(o => o.voiceStatus === 'HS' || o.dataStatus === 'HS').length;
  return Math.max(0, Math.round(100 - (hsSites / 50)));
}

function normalizeSpace(data: SpaceWeatherData): number {
  // kp=0 → 100 (calme), kp=5 → 40 (tempête G1), kp≥9 → 0 (extrême)
  return Math.max(0, 100 - Math.min(data.kpIndex * 12, 100));
}

function normalizeCloud(state: InfraNetworkState): number {
  if (state.datacenters.length === 0) return 100;
  const scoreMap: Record<string, number> = {
    operational: 100, unknown: 100, maintenance: 90,
    degraded: 60, partial: 40, outage: 0,
  };
  const scores = state.datacenters.map(dc => scoreMap[dc.status] ?? 100);
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

function normalizeCyber(
  state: CyberState,
  threatEvents: ThreatEvent[],
  context: { telecomOutageCount: number; cloudIncidentCount: number },
): number {
  // Consolidated pressure: 0=calme, 100=crise → inverser pour obtenir un score de santé.
  return 100 - computeCyberPressureAssessment(state, threatEvents, {
    telecomOutageCount: context.telecomOutageCount,
    cloudIncidentCount: context.cloudIncidentCount,
  }).score;
}

function computeNationalCyberPressure(state: CyberState, threatEvents: ThreatEvent[]): number {
  return computeCyberPressureAssessment(state, threatEvents).score;
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
  const [ecowattRes, bgpRes, telecomRes, spaceRes, cyberRes, infraRes, threatRes] = await Promise.allSettled([
    fetchEcowatt(),
    fetchNetworkOutages(),
    fetchTelecomOutages(),
    fetchSpaceWeather(),
    fetchCyberDashboard(),
    fetchInfraNetwork(),
    fetchThreatMapEvents(),
  ]);

  const threatEvents = threatRes.status === 'fulfilled' ? threatRes.value.events : [];
  const telecomOutageCount = telecomRes.status === 'fulfilled' ? telecomRes.value.length : 0;
  const cloudIncidentCount = infraRes.status === 'fulfilled' && infraRes.value !== null
    ? infraRes.value.datacenters.filter((dc) => dc.status !== 'operational' && dc.status !== 'unknown').length
    : 0;

  const scores: Partial<Record<WeightKey, number | null>> = {
    elec:    ecowattRes.status  === 'fulfilled' ? normalizeElec(ecowattRes.value)       : null,
    bgp:     bgpRes.status      === 'fulfilled' ? bgpRes.value.nationalScore            : null,
    telecom: telecomRes.status  === 'fulfilled' ? normalizeTelecom(telecomRes.value)    : null,
    cloud:   infraRes.status === 'fulfilled' && infraRes.value !== null ? normalizeCloud(infraRes.value) : null,
    space:   spaceRes.status    === 'fulfilled' ? normalizeSpace(spaceRes.value)        : null,
    cyber:   cyberRes.status    === 'fulfilled'
      ? normalizeCyber(cyberRes.value, threatEvents, { telecomOutageCount, cloudIncidentCount })
      : null,
    wind:    _eolienLive !== null ? normalizeWind(_eolienLive) : null,
  };

  const nationalCyberPressure = cyberRes.status === 'fulfilled'
    ? computeNationalCyberPressure(cyberRes.value, threatEvents)
    : null;

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
