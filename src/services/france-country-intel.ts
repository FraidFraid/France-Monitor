// src/services/france-country-intel.ts
// Central country-intel engine for FranceMonitor.
// Inspired by WorldMonitor's country-intel.ts pattern.
// App.ts assembles FranceRawData and calls buildFranceCountrySnapshot().
// FranceIntelPanel and france-intel-brief consume the resulting FranceCountrySnapshot.

import type {
  NewsItem,
  ISNRData,
  ISNRScore,
  ISNRDimensionScores,
  CyberState,
  MeteoAlert,
  FloodSegment,
  TransportDisruption,
  ActiveFire,
  MarketData,
  TelecomOutage,
  PowerOutage,
  EcowattResponse,
  NuclearState,
  FranceCountrySignals,
  FranceCountryAxes,
  FranceBriefContext,
  FranceCountrySnapshot,
  FranceIntelEnergySummary,
  FranceIntelTimelineLane,
  EcowattSignal,
  GpsJammingSignal,
} from '@/types/index.ts';
import type { DefenseAlert } from '@/services/cable-threats.ts';
import type { EolienLive } from '@/services/eolien/types.ts';
import type { TrafficIncident } from '@/services/traffic.ts';

/**
 * All raw data App.ts passes to the engine.
 * Exported so App.ts can type its local variable.
 */
export interface FranceRawData {
  newsItems: NewsItem[];
  isnrData: ISNRData | null;
  cyberData: CyberState | null;
  meteoAlerts: MeteoAlert[];
  floodSegments: FloodSegment[];
  sncfDisruptions: TransportDisruption[];
  trafficIncidents: TrafficIncident[];
  powerOutages: PowerOutage[];
  telecomOutages: TelecomOutage[];
  defenseAlerts: DefenseAlert[];
  jammingSignals: GpsJammingSignal[];
  militaryFlightsCount: number;
  maritimeCount: number;
  activeFires: ActiveFire[];
  marketData: MarketData[];
  ecowattResponse: EcowattResponse | null;
  nuclearState: NuclearState | null;
  eolienLive: EolienLive | null;
  timeline: { days: string[]; lanes: FranceIntelTimelineLane[] };
  briefLang: 'fr' | 'en';
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/**
 * Compute the average of a dimension key across active ISNR scores only.
 * Active = score > 0 || eventCount > 0. Result is rounded.
 * Ported verbatim from FranceIntelPanel.ts avgDim().
 */
function avgDim(scores: ISNRScore[], key: keyof ISNRDimensionScores): number {
  const activeScores = scores.filter((s) => s.score > 0 || s.eventCount > 0);
  if (activeScores.length === 0) return 0;
  const sum = activeScores.reduce((acc, s) => acc + s.dimensions[key], 0);
  return Math.round(sum / activeScores.length);
}

/** Clamp and round a raw axis value to the 0–100 range. */
function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Assembles the energy summary from ecowattResponse + nuclearState + eolienLive.
 * Exact same logic as App.ts buildFranceIntelData() lines ~4730–4783.
 */
function buildEnergySnapshot(raw: FranceRawData): FranceIntelEnergySummary | null {
  const nationalMix = raw.ecowattResponse?.national ?? null;
  if (!nationalMix) return null;

  const totalMw = nationalMix.total > 0 ? Math.round(nationalMix.total) : null;
  const share = (value: number): number => {
    if (!totalMw || totalMw <= 0) return 0;
    return Math.round((value / nationalMix.total) * 100);
  };

  const signals = raw.ecowattResponse?.signals ?? {};
  const signalValues = Object.values(signals);
  const ecowattSignal: EcowattSignal | null = signalValues.includes('red')
    ? 'red'
    : signalValues.includes('orange')
      ? 'orange'
      : signalValues.includes('green')
        ? 'green'
        : null;

  return {
    ecowattSignal,
    totalMw,
    shares: {
      nuclear: share(nationalMix.nuclear),
      gas: share(nationalMix.gas),
      hydro: share(nationalMix.hydro),
      wind: share(nationalMix.wind),
      solar: share(nationalMix.solar),
      other: share(nationalMix.other),
    },
    nuclearStress: raw.nuclearState?.stress
      ? Math.round(raw.nuclearState.stress.stressRatio * 100)
      : null,
    windGw: raw.eolienLive?.production_gw ?? null,
    windLoadFactor: raw.eolienLive
      ? Math.round(raw.eolienLive.facteur_charge * 100)
      : null,
  };
}

// ─── Exported pipeline functions ──────────────────────────────────────────────

/**
 * Build the flat FranceCountrySignals from raw data arrays.
 * Each field counts relevant items at the appropriate severity threshold.
 */
export function buildFranceSignals(raw: FranceRawData): FranceCountrySignals {
  return {
    // News
    criticalNews: raw.newsItems.filter((i) => i.threat?.level === 'critical').length,
    highNews: raw.newsItems.filter((i) => i.threat?.level === 'high').length,
    topNewsCount: Math.min(raw.newsItems.length, 20),
    // Météo / crues / feux (severe levels only)
    meteoAlerts: raw.meteoAlerts.filter((a) =>
      (a.level === 'orange' || a.level === 'red' || a.level === 'violet'),
    ).length,
    floodAlerts: raw.floodSegments.filter((s) =>
      (s.level === 'orange' || s.level === 'red'),
    ).length,
    fireDetections: raw.activeFires.length,
    // Transport
    railDisruptions: raw.sncfDisruptions.length,
    railSevere: raw.sncfDisruptions.filter((d) =>
      d.severity === 'critical' || d.severity === 'high',
    ).length,
    roadIncidents: raw.trafficIncidents.length,
    // Infrastructure
    powerOutages: raw.powerOutages.length,
    telecomOutages: raw.telecomOutages.length,
    // Cyber
    cyberAlerts: raw.cyberData?.alerts.count30d ?? 0,
    cyberCritical: raw.cyberData?.vulnerabilities.criticalCount ?? 0,
    // Defense / intelligence
    militaryFlights: raw.militaryFlightsCount,
    maritimeTrafficFrance: raw.maritimeCount,
    defenseAlerts: raw.defenseAlerts.length,
    defenseHigh: raw.defenseAlerts.filter((a) => a.severity === 'high').length,
    jammingSignals: raw.jammingSignals.length,
    // Finance (weak signal)
    marketStress: raw.marketData.filter((m) => m.changePercent <= -1).length,
  };
}

/**
 * Compute the four national posture axes from signals + ISNR data.
 * EXACT formulas from FranceIntelPanel.ts computeNationalPostureAxes().
 */
export function computeFranceAxes(
  signals: FranceCountrySignals,
  isnr: ISNRData | null,
): FranceCountryAxes {
  const scores = isnr?.scores ?? [];
  const isnrSocial = avgDim(scores, 'social');
  const isnrSecurity = avgDim(scores, 'security');

  const troubles = clamp(Math.max(
    isnrSocial,
    signals.highNews * 5
      + signals.railDisruptions * 2
      + signals.roadIncidents
      + (signals.powerOutages + signals.telecomOutages) * 3,
  ));

  const conflict = clamp(
    signals.defenseAlerts * 18
      + signals.jammingSignals * 16
      + Math.min(signals.militaryFlights, 20) * 2
      + Math.min(signals.maritimeTrafficFrance, 20),
  );

  const security = clamp(Math.max(
    isnrSecurity,
    signals.criticalNews * 18
      + signals.highNews * 8
      + signals.defenseHigh * 18
      + signals.jammingSignals * 10,
  ));

  const information = clamp(
    signals.topNewsCount
      + signals.highNews * 4
      + signals.criticalNews * 10
      + signals.marketStress * 5,
  );

  return { troubles, conflict, security, information };
}

/**
 * Build the brief context (all fields except score).
 * Returns Omit<FranceBriefContext, 'score'> — caller adds score separately.
 */
export function buildFranceBriefContext(
  signals: FranceCountrySignals,
  axes: FranceCountryAxes,
  raw: FranceRawData,
): Omit<FranceBriefContext, 'score'> {
  const scores = raw.isnrData?.scores ?? [];
  const isnrComponents = {
    social: avgDim(scores, 'social'),
    security: avgDim(scores, 'security'),
    infra: avgDim(scores, 'infra'),
  };

  const cyberScore = raw.cyberData?.meta.globalScore ?? 0;

  // Determine the max level among meteo alerts (violet > red > orange > yellow > green > null)
  const meteoLevelOrder = ['violet', 'red', 'orange', 'yellow', 'green'];
  let meteoMaxLevel: string | null = null;
  for (const level of meteoLevelOrder) {
    if (raw.meteoAlerts.some((a) => a.level === level)) {
      meteoMaxLevel = level;
      break;
    }
  }

  const topHeadlines = raw.newsItems
    .slice(0, 6)
    .map((n) => n.title.replace(/[\r\n]+/g, ' ').slice(0, 120));

  const signalValues = Object.values(raw.ecowattResponse?.signals ?? {});
  const ecowattSignal: string | null = signalValues.includes('red')
    ? 'red'
    : signalValues.includes('orange')
      ? 'orange'
      : signalValues.includes('green')
        ? 'green'
        : null;

  const energySummary = buildEnergySnapshot(raw);

  return {
    axes,
    signals,
    topHeadlines,
    ecowattSignal,
    meteoMaxLevel,
    cyberScore,
    isnrComponents,
    energySummary,
  };
}

/**
 * Compute the Composite Instability Index (CII, 0–100).
 * EXACT formula from FranceIntelPanel.ts computeCII():
 *   social×0.25 + security×0.30 + infra×0.20 + cyber×0.25
 */
export function computeFranceRiskScore(
  isnrComponents: { social: number; security: number; infra: number },
  cyberScore: number,
): number {
  return Math.round(
    isnrComponents.social * 0.25
      + isnrComponents.security * 0.30
      + isnrComponents.infra * 0.20
      + cyberScore * 0.25,
  );
}

/**
 * Full pipeline: assemble a FranceCountrySnapshot from raw data.
 *
 * Steps:
 * 1. buildFranceSignals
 * 2. computeFranceAxes
 * 3. buildFranceBriefContext (also computes isnrComponents + cyberScore)
 * 4. computeFranceRiskScore
 * 5. Assemble FranceCountrySnapshot
 */
export function buildFranceCountrySnapshot(
  raw: FranceRawData,
  options?: { brief?: string | null; briefFreshness?: 'fresh' | 'cached' },
): FranceCountrySnapshot {
  const signals = buildFranceSignals(raw);
  const axes = computeFranceAxes(signals, raw.isnrData);
  const partialCtx = buildFranceBriefContext(signals, axes, raw);
  const score = computeFranceRiskScore(partialCtx.isnrComponents, partialCtx.cyberScore);
  const briefContext: FranceBriefContext = { ...partialCtx, score };

  // Fallback stubs when raw data is unavailable
  const stability: ISNRData = raw.isnrData ?? {
    scores: [],
    nationalScore: 0,
    timestamp: new Date(),
  };

  const cyber: CyberState = raw.cyberData ?? {
    meta: { globalScore: 0, trend: 'stable' as const, sources: [], lastUpdate: new Date() },
    alerts: { count30d: 0, latest: [] },
    ransomware: { total30d: 0, topSectors: [] },
    vulnerabilities: { criticalCount: 0, topCVEs: [] },
  };

  return {
    signals,
    axes,
    score,
    briefContext,
    stability,
    cyber,
    meteo: raw.meteoAlerts,
    topNews: raw.newsItems.slice(0, 20),
    energy: buildEnergySnapshot(raw),
    timeline: raw.timeline,
    brief: options?.brief,
    briefLang: raw.briefLang,
    briefFreshness: options?.briefFreshness,
  };
}
