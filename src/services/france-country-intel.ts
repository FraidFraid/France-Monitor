// src/services/france-country-intel.ts
// Central country-intel engine for FranceMonitor.
// Inspired by WorldMonitor's country-intel.ts pattern.
// App.ts assembles FranceRawData and calls buildFranceCountrySnapshot().
// FranceIntelPanel and france-intel-brief consume the resulting FranceCountrySnapshot.
//
// Pipeline:
//   FranceRawData ──→ buildFranceCountrySnapshot() ──→ FranceCountrySnapshot
//                └──→ detectSituations()            ──→ DetectedSituation[]

import type {
  AisAnomaly,
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
  GasNetworkState,
  NuclearState,
  FranceCountrySignals,
  FranceCountryAxes,
  FranceBriefContext,
  FranceCountrySnapshot,
  FranceIntelEnergySummary,
  FranceIntelTimelineLane,
  EcowattSignal,
  GpsJammingSignal,
  OilDashboard,
  FuelTensionDashboard,
  ThreatEvent,
} from '@/types/index.ts';
import type { DefenseAlert } from '@/services/cable-threats.ts';
import type { EolienLive } from '@/services/eolien/types.ts';
import type { TrafficIncident } from '@/services/traffic.ts';
import { detectSituations } from './situation-engine.ts';
import { computeCyberPressureAssessment } from './cyber-threat-scoring.ts';

/**
 * All raw data App.ts passes to the engine.
 * Exported so App.ts can type its local variable.
 */
export interface FranceRawData {
  newsItems: NewsItem[];
  isnrData: ISNRData | null;
  cyberData: CyberState | null;
  threatEvents?: ThreatEvent[];
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
  gasState: GasNetworkState | null;
  nuclearState: NuclearState | null;
  eolienLive: EolienLive | null;
  aisAnomalies: AisAnomaly[];
  timeline: { days: string[]; lanes: FranceIntelTimelineLane[] };
  briefLang: 'fr' | 'en';
  // Souveraineté pétrolière
  oilDashboard: OilDashboard | null;
  fuelTensionDashboard: FuelTensionDashboard | null;
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
 * Convert a raw national count into a bounded contribution.
 * Uses log scaling so very large totals do not instantly saturate the axis.
 */
function scaleCount(count: number, cap: number, maxContribution: number): number {
  if (count <= 0 || cap <= 0 || maxContribution <= 0) return 0;
  const bounded = Math.min(count, cap);
  const ratio = Math.log1p(bounded) / Math.log1p(cap);
  return Math.round(ratio * maxContribution);
}

function fuelTensionPressure(
  fuelLevel: FuelTensionDashboard['national']['topDepartments'][number]['tensionLevel'] | null,
  anomalyShare: number | null,
): number {
  const levelBase = fuelLevel === 'CRITICAL'
    ? 28
    : fuelLevel === 'HIGH'
      ? 20
      : fuelLevel === 'MEDIUM'
        ? 12
        : fuelLevel === 'LOW'
          ? 4
          : 0;

  const anomalyBoost = anomalyShare == null
    ? 0
    : anomalyShare >= 18
      ? 12
      : anomalyShare >= 12
        ? 8
        : anomalyShare >= 7
          ? 5
          : anomalyShare >= 3
            ? 2
            : 0;

  return levelBase + anomalyBoost;
}

function oilPressure(status: OilDashboard['meta']['status'] | null, stocksDays: number | null): number {
  const statusBase = status === 'critical'
    ? 18
    : status === 'tense'
      ? 10
      : 0;

  const stockBoost = stocksDays == null
    ? 0
    : stocksDays < 55
      ? 10
      : stocksDays < 75
        ? 5
        : 0;

  return statusBase + stockBoost;
}

function energyStressPressure(raw: FranceRawData): number {
  return fuelTensionPressure(
    raw.fuelTensionDashboard?.national.topDepartments?.[0]?.tensionLevel ?? null,
    raw.fuelTensionDashboard?.national.anomalyShare ?? null,
  ) + oilPressure(
    raw.oilDashboard?.meta.status ?? null,
    raw.oilDashboard?.stocks.nationalStocksDays ?? null,
  );
}

function averageWeighted(parts: Array<{ value: number; weight: number }>): number {
  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  if (totalWeight <= 0) return 0;
  const weighted = parts.reduce((sum, part) => sum + (part.value * part.weight), 0);
  return clamp(Math.round(weighted / totalWeight));
}

function ecowattPressure(raw: FranceRawData): number {
  const signalValues = Object.values(raw.ecowattResponse?.signals ?? {});
  if (signalValues.includes('red')) return 75;
  if (signalValues.includes('orange')) return 45;
  return 0;
}

function transportPressure(signals: FranceCountrySignals): number {
  return clamp(
    scaleCount(signals.railDisruptions, 20, 75)
      + scaleCount(signals.roadIncidents, 120, 25),
  );
}

function telecomPressure(signals: FranceCountrySignals): number {
  return clamp(scaleCount(signals.telecomOutages, 50_000, 75));
}

function powerPressure(signals: FranceCountrySignals): number {
  return clamp(scaleCount(signals.powerOutages, 50_000, 75));
}

function weatherPressure(signals: FranceCountrySignals): number {
  return clamp(
    scaleCount(signals.meteoAlerts, 10, 65)
      + scaleCount(signals.floodAlerts, 10, 35),
  );
}

function fuelPressure(raw: FranceRawData): number {
  return clamp(Math.round(energyStressPressure(raw) * 2.6));
}

function defensePressure(signals: FranceCountrySignals): number {
  return clamp(
    scaleCount(signals.defenseHigh, 4, 35)
      + scaleCount(Math.max(0, signals.defenseAlerts - signals.defenseHigh), 6, 15)
      + scaleCount(signals.jammingSignals, 4, 30)
      + scaleCount(Math.max(0, signals.militaryFlights - 10), 30, 20),
  );
}

function headlinePressure(signals: FranceCountrySignals): number {
  return clamp(
    scaleCount(signals.criticalNews, 8, 65)
      + scaleCount(signals.highNews, 20, 35),
  );
}

function signalPressure(signals: FranceCountrySignals): number {
  return clamp(
    scaleCount(signals.criticalNews + signals.highNews, 15, 40)
      + scaleCount(signals.meteoAlerts + signals.floodAlerts, 30, 22)
      + scaleCount(signals.marketStress, 5, 10)
      + scaleCount(signals.cyberAlerts, 40, 12),
  );
}

function computeFranceRiskPillars(
  raw: FranceRawData,
  signals: FranceCountrySignals,
  isnr: ISNRData | null,
): { continuity: number; defense: number; security: number; signal: number; shock: number } {
  const scores = isnr?.scores ?? [];
  const isnrSocial = avgDim(scores, 'social');
  const isnrInfra = avgDim(scores, 'infra');
  const cyberScore = computeCyberPressureAssessment(raw.cyberData, raw.threatEvents ?? []).score;

  // Continuité : énergie + transport + télécom + pannes + météo
  // (transport n'apparaît PLUS dans social pour éviter le double-comptage)
  const continuity = averageWeighted([
    { value: Math.max(powerPressure(signals), ecowattPressure(raw)), weight: 25 },
    { value: fuelPressure(raw), weight: 20 },
    { value: telecomPressure(signals), weight: 15 },
    { value: transportPressure(signals), weight: 25 },
    { value: Math.max(weatherPressure(signals), isnrInfra), weight: 15 },
  ]);

  // Défense : militaire, câbles sous-marins, brouillage GPS
  const defense = defensePressure(signals);

  // Sécurité : cyber + headlines critiques + bleed défense
  const security = averageWeighted([
    { value: cyberScore, weight: 45 },
    { value: defense, weight: 30 },
    { value: headlinePressure(signals), weight: 25 },
  ]);

  // Signal : pression informationnelle multi-source
  // (remplace l'ancien "social" déconnecté + ancien "information")
  const signal = averageWeighted([
    { value: isnrSocial, weight: 30 },
    { value: signalPressure(signals), weight: 40 },
    { value: clamp(scaleCount(signals.marketStress, 5, 60)), weight: 15 },
    { value: clamp(scaleCount(signals.fireDetections, 15, 50)), weight: 15 },
  ]);

  // Choc : pic soudain (poids réduit dans le score final : 15% au lieu de 25%)
  const shock = clamp(Math.max(
    headlinePressure(signals),
    scaleCount(signals.meteoAlerts + signals.floodAlerts, 8, 55)
      + scaleCount(signals.jammingSignals, 3, 20),
    Math.max(ecowattPressure(raw), fuelPressure(raw) >= 70 ? 50 : fuelPressure(raw) >= 45 ? 28 : 0),
  ));

  return { continuity, defense, security, signal, shock };
}

function selectDiverseNews(items: NewsItem[], maxItems: number, maxPerSource = 2): NewsItem[] {
  if (maxItems <= 0) return [];

  const selected: NewsItem[] = [];
  const perSource = new Map<string, number>();
  const overflow: NewsItem[] = [];

  for (const item of items) {
    const source = item.source || 'unknown';
    const current = perSource.get(source) ?? 0;
    if (current < maxPerSource) {
      selected.push(item);
      perSource.set(source, current + 1);
      if (selected.length >= maxItems) return selected;
    } else {
      overflow.push(item);
    }
  }

  for (const item of overflow) {
    selected.push(item);
    if (selected.length >= maxItems) break;
  }

  return selected;
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
    // Souveraineté pétrolière
    oilStocksDays: raw.oilDashboard?.stocks.nationalStocksDays ?? null,
    oilVigilanceStatus: raw.oilDashboard?.meta.status ?? null,
    // Tension carburants
    fuelTensionLevel: raw.fuelTensionDashboard?.national.tensionLevel ?? null,
    fuelTensionAnomalyShare: raw.fuelTensionDashboard?.national.anomalyShare ?? null,
    fuelPriceHistory: raw.oilDashboard?.fuelPriceHistory ?? null,
  };
}

// ─── Exported pipeline functions ──────────────────────────────────────────────

/**
 * Build the flat FranceCountrySignals from raw data arrays.
 * Each field counts relevant items at the appropriate severity threshold.
 */
export function buildFranceSignals(raw: FranceRawData): FranceCountrySignals {
  const cyberPressure = computeCyberPressureAssessment(raw.cyberData, raw.threatEvents ?? []);

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
    cyberAlerts: Math.max(raw.cyberData?.alerts.count30d ?? 0, cyberPressure.summary.france30d),
    cyberCritical: Math.max(raw.cyberData?.vulnerabilities.criticalCount ?? 0, cyberPressure.summary.critical30d),
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
 * V2 normalized formulas: preserve domain intent while avoiding saturation
 * from raw national totals (outages, fires, headlines, etc.).
 */
export function computeFranceAxes(
  signals: FranceCountrySignals,
  isnr: ISNRData | null,
  raw?: FranceRawData,
): FranceCountryAxes {
  if (!raw) {
    return { continuity: 0, defense: 0, security: 0, signal: 0 };
  }

  const pillars = computeFranceRiskPillars(raw, signals, isnr);
  return {
    continuity: pillars.continuity,
    defense: pillars.defense,
    security: pillars.security,
    signal: pillars.signal,
  };
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

  const cyberScore = computeCyberPressureAssessment(raw.cyberData, raw.threatEvents ?? []).score;

  // Determine the max level among meteo alerts (violet > red > orange > yellow > green > null)
  const meteoLevelOrder = ['violet', 'red', 'orange', 'yellow', 'green'];
  let meteoMaxLevel: string | null = null;
  for (const level of meteoLevelOrder) {
    if (raw.meteoAlerts.some((a) => a.level === level)) {
      meteoMaxLevel = level;
      break;
    }
  }

  const diverseTopNews = selectDiverseNews(raw.newsItems, 20, 2);

  const topHeadlines = diverseTopNews
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
 * Compute the top-level stability index (0–100).
 *
 * WorldMonitor-style approach:
 * - start from a country baseline (France is usually a high-stability country)
 * - subtract only the dynamic pressure that exceeds the ambient "normal" range
 * - apply extra deductions only for genuinely high / critical shocks
 *
 * Calibration target for France:
 * - stable                  => ~80–100
 * - under pressure          => ~65–79
 * - degraded                => ~50–64
 * - critical                => <50
 */
export function computeFranceRiskScore(
  axes: FranceCountryAxes,
  raw?: FranceRawData,
  signals?: FranceCountrySignals,
  isnr?: ISNRData | null,
): number {
  if (!raw || !signals) {
    const fallbackRisk = averageWeighted([
      { value: axes.continuity, weight: 35 },
      { value: axes.defense, weight: 15 },
      { value: axes.security, weight: 30 },
      { value: axes.signal, weight: 20 },
    ]);
    return clamp((100 - fallbackRisk) * 2);
  }

  const pillars = computeFranceRiskPillars(raw, signals, isnr ?? null);
  const structuralRisk = averageWeighted([
    { value: pillars.continuity, weight: 35 },
    { value: pillars.security, weight: 30 },
    { value: pillars.signal, weight: 20 },
    { value: pillars.defense, weight: 15 },
  ]);
  // Shock poids réduit : 15% au lieu de 25% pour éviter les sauts sur un seul headline
  const totalRisk = clamp(Math.round((structuralRisk * 0.85) + (pillars.shock * 0.15)));

  // Multi-pressure floor: si ≥3 piliers sont actifs (≥20), le score ne peut pas excéder 85
  const activePillars = [pillars.continuity, pillars.defense, pillars.security, pillars.signal]
    .filter((v) => v >= 20).length;
  const rawScore = clamp((100 - totalRisk) * 2);
  if (activePillars >= 3 && rawScore > 85) return 85;
  return rawScore;
}

/**
 * Full pipeline: assemble a FranceCountrySnapshot from raw data.
 *
 * Steps:
 * 1. buildFranceSignals
 * 2. computeFranceAxes
 * 3. buildFranceBriefContext
 * 4. computeFranceRiskScore
 * 5. Assemble FranceCountrySnapshot
 */
export function buildFranceCountrySnapshot(
  raw: FranceRawData,
  options?: { brief?: string | null; briefFreshness?: 'fresh' | 'cached' },
): FranceCountrySnapshot {
  const signals = buildFranceSignals(raw);
  const axes = computeFranceAxes(signals, raw.isnrData, raw);
  const partialCtx = buildFranceBriefContext(signals, axes, raw);
  const score = computeFranceRiskScore(axes, raw, signals, raw.isnrData);
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

  const situations = detectSituations(raw);

  return {
    signals,
    axes,
    score,
    briefContext,
    situations,
    stability,
    cyber,
    meteo: raw.meteoAlerts,
    topNews: selectDiverseNews(raw.newsItems, 20, 2),
    energy: buildEnergySnapshot(raw),
    timeline: raw.timeline,
    brief: options?.brief,
    briefLang: raw.briefLang,
    briefFreshness: options?.briefFreshness,
  };
}
