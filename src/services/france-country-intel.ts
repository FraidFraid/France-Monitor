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
  StructuredBrief,
  SituationSeverity,
  DetectedSituation,
  FranceScoreBreakdown,
  FranceScorePillarBreakdown,
  LocatedFireIncident,
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
  /** Incidents clusterisés et géo-résolus, fournis par App.ts (Task 10). */
  fireIncidents?: LocatedFireIncident[];
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
  const cyberScore = computeCyberPressureAssessment(raw.cyberData, raw.threatEvents ?? [], {
    powerOutageCount: raw.powerOutages.length,
    telecomOutageCount: raw.telecomOutages.length,
  }).score;

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

// ─── Score v3 : baseline − déductions progressives (spec §4) ─────────────────

const SCORE_BASELINE = 95;
const SCORE_WEIGHTS = { continuity: 0.35, security: 0.30, signal: 0.20, defense: 0.15 } as const;
const NOISE_CEILING = 15;        // sous ce niveau : bruit ambiant (×0,25)
const ESCALATION_FLOOR = 40;     // au-delà : aggravation sur-linéaire (×1,2)
const NOISE_FACTOR = 0.25;
const ESCALATION_FACTOR = 1.2;
const SHOCK_FLOOR = 50;
const SHOCK_FACTOR = 0.25;
const SMOOTHING_ALPHA = 0.5;
const SMOOTHING_BREAK_DELTA = 15;
const CAP_ONE_CRITICAL = 55;
const CAP_TWO_HIGH = 65;
const CAP_ONE_HIGH = 78;

/** Réponse progressive par morceaux : le bruit pèse peu, la vraie pression pèse plein pot. */
export function pillarResponse(value: number): number {
  const v = Math.max(0, value);
  const noise = Math.min(v, NOISE_CEILING) * NOISE_FACTOR;
  const linear = Math.max(0, Math.min(v, ESCALATION_FLOOR) - NOISE_CEILING);
  const escalation = Math.max(0, v - ESCALATION_FLOOR) * ESCALATION_FACTOR;
  return noise + linear + escalation;
}

export interface FranceScoreResult {
  score: number;
  deductions: Record<'continuity' | 'security' | 'signal' | 'defense', number>;
  shockExtra: number;
  situationCap: number | null;
}

export function scoreFromPillars(
  pillars: { continuity: number; security: number; signal: number; defense: number; shock: number },
  situations: ReadonlyArray<{ severity: SituationSeverity }> = [],
  previousScore: number | null = null,
): FranceScoreResult {
  const deductions = {
    continuity: SCORE_WEIGHTS.continuity * pillarResponse(pillars.continuity),
    security: SCORE_WEIGHTS.security * pillarResponse(pillars.security),
    signal: SCORE_WEIGHTS.signal * pillarResponse(pillars.signal),
    defense: SCORE_WEIGHTS.defense * pillarResponse(pillars.defense),
  };
  const shockExtra = Math.max(0, pillars.shock - SHOCK_FLOOR) * SHOCK_FACTOR;
  const total = deductions.continuity + deductions.security + deductions.signal
    + deductions.defense + shockExtra;
  let score = clamp(Math.round(SCORE_BASELINE - total));

  // Lissage EMA — débrayé sur vraie rupture pour ne jamais masquer un choc
  if (previousScore != null && Math.abs(score - previousScore) <= SMOOTHING_BREAK_DELTA) {
    score = Math.round(SMOOTHING_ALPHA * score + (1 - SMOOTHING_ALPHA) * previousScore);
  }

  // Cohérence inter-blocs : le score ne peut pas dire « stable » avec une situation grave affichée
  const criticalCount = situations.filter((s) => s.severity === 'critical').length;
  const highCount = situations.filter((s) => s.severity === 'high').length;
  const situationCap = criticalCount >= 1 ? CAP_ONE_CRITICAL
    : highCount >= 2 ? CAP_TWO_HIGH
    : highCount >= 1 ? CAP_ONE_HIGH
    : null;
  if (situationCap != null && score > situationCap) score = situationCap;

  return { score, deductions, shockExtra, situationCap };
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
  const cyberPressure = computeCyberPressureAssessment(raw.cyberData, raw.threatEvents ?? [], {
    powerOutageCount: raw.powerOutages.length,
    telecomOutageCount: raw.telecomOutages.length,
  });

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

  const cyberScore = computeCyberPressureAssessment(raw.cyberData, raw.threatEvents ?? [], {
    powerOutageCount: raw.powerOutages.length,
    telecomOutageCount: raw.telecomOutages.length,
  }).score;

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
 * Indice de stabilité v3 (0–100). Baseline 95 − déductions progressives par pilier.
 * Voir docs/superpowers/specs/2026-07-05-refonte-country-intelligence-design.md §4.
 */
export function computeFranceRiskScore(
  axes: FranceCountryAxes,
  raw?: FranceRawData,
  signals?: FranceCountrySignals,
  isnr?: ISNRData | null,
  situations: ReadonlyArray<{ severity: SituationSeverity }> = [],
  previousScore: number | null = null,
): number {
  const pillars = raw && signals
    ? computeFranceRiskPillars(raw, signals, isnr ?? null)
    : { continuity: axes.continuity, defense: axes.defense, security: axes.security, signal: axes.signal, shock: 0 };
  return scoreFromPillars(pillars, situations, previousScore).score;
}

/** Détail explicable du score : déductions par pilier + composantes nommées (top 3). */
export function computeFranceScoreBreakdown(
  raw: FranceRawData,
  signals: FranceCountrySignals,
  isnr: ISNRData | null,
  situations: ReadonlyArray<{ severity: SituationSeverity }> = [],
  previousScore: number | null = null,
): FranceScoreBreakdown {
  const pillars = computeFranceRiskPillars(raw, signals, isnr);
  const result = scoreFromPillars(pillars, situations, previousScore);

  const scores = isnr?.scores ?? [];
  const isnrSocial = avgDim(scores, 'social');
  const isnrInfra = avgDim(scores, 'infra');
  const cyberScore = computeCyberPressureAssessment(raw.cyberData, raw.threatEvents ?? [], {
    powerOutageCount: raw.powerOutages.length,
    telecomOutageCount: raw.telecomOutages.length,
  }).score;

  const componentsByPillar: Record<FranceScorePillarBreakdown['key'], Array<{ label: string; value: number }>> = {
    continuity: [
      { label: 'Pression électrique', value: Math.max(powerPressure(signals), ecowattPressure(raw)) },
      { label: 'Carburants & pétrole', value: fuelPressure(raw) },
      { label: 'Transport', value: transportPressure(signals) },
      { label: 'Télécom', value: telecomPressure(signals) },
      { label: 'Météo / infra', value: Math.max(weatherPressure(signals), isnrInfra) },
    ],
    security: [
      { label: 'Pression cyber', value: cyberScore },
      { label: 'Report défense', value: pillars.defense },
      { label: 'Titres critiques', value: headlinePressure(signals) },
    ],
    signal: [
      { label: 'Tension sociale (ISNR)', value: isnrSocial },
      { label: 'Pression informationnelle', value: signalPressure(signals) },
      { label: 'Stress marchés', value: clamp(scaleCount(signals.marketStress, 5, 60)) },
      { label: 'Feux actifs', value: clamp(scaleCount(signals.fireDetections, 15, 50)) },
    ],
    defense: [
      {
        label: 'Câbles sous-marins',
        value: clamp(scaleCount(signals.defenseHigh, 4, 35)
          + scaleCount(Math.max(0, signals.defenseAlerts - signals.defenseHigh), 6, 15)),
      },
      { label: 'Brouillage GPS', value: clamp(scaleCount(signals.jammingSignals, 4, 30)) },
      { label: 'Vols militaires', value: clamp(scaleCount(Math.max(0, signals.militaryFlights - 10), 30, 20)) },
    ],
  };

  const pillarBreakdowns: FranceScorePillarBreakdown[] = (
    ['continuity', 'security', 'signal', 'defense'] as const
  ).map((key) => ({
    key,
    value: pillars[key],
    deduction: Math.round(result.deductions[key] * 10) / 10,
    components: componentsByPillar[key]
      .filter((c) => c.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 3),
  }));

  return {
    score: result.score,
    baseline: SCORE_BASELINE,
    pillars: pillarBreakdowns,
    shockValue: pillars.shock,
    shockExtra: Math.round(result.shockExtra * 10) / 10,
    situationCap: result.situationCap,
  };
}

/**
 * Full pipeline: assemble a FranceCountrySnapshot from raw data.
 *
 * Steps:
 * 1. buildFranceSignals
 * 2. computeFranceAxes
 * 3. detectSituations — calculées avant le score, elles alimentent son plafond
 * 4. computeFranceScoreBreakdown — breakdown complet (piliers, déductions) embarqué dans le snapshot
 * 5. buildFranceBriefContext
 * 6. Assemble FranceCountrySnapshot
 */
export function buildFranceCountrySnapshot(
  raw: FranceRawData,
  options?: {
    brief?: StructuredBrief | null;
    briefFreshness?: 'fresh' | 'cached';
    previousScore?: number | null;
  },
): FranceCountrySnapshot {
  const signals = buildFranceSignals(raw);
  const axes = computeFranceAxes(signals, raw.isnrData, raw);
  const situations: DetectedSituation[] = detectSituations(raw);
  const scoreBreakdown = computeFranceScoreBreakdown(
    raw, signals, raw.isnrData ?? null, situations, options?.previousScore ?? null,
  );
  const score = scoreBreakdown.score;
  const partialCtx = buildFranceBriefContext(signals, axes, raw);
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
    scoreBreakdown,
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
