import type { DataSourceStatus } from '../types/index.ts';

export type QualitySourceType = 'official' | 'media' | 'open_data' | 'technical' | 'internal' | 'unknown';
export type QualityFreshnessLabel = 'fresh' | 'acceptable' | 'stale' | 'unknown';
export type QualityConfidenceLabel = 'high' | 'medium' | 'low' | 'unknown';
export type QualitySeverity = 'low' | 'medium' | 'high' | 'critical' | 'unknown';
export type QualityStatus = 'active' | 'cached' | 'degraded' | 'error' | 'unknown';
export type ModuleHarmonizationStatus = 'mappé' | 'partiel' | 'à harmoniser';

/**
 * Métriques observées d'une source, agrégées depuis le comportement réel
 * (fetches, échecs, fallbacks, disponibilité) sur la fenêtre d'historique.
 * Taux exprimés en fraction 0..1. Renseignées par source-quality-history.ts.
 */
export interface ObservedMetrics {
  successRate: number;      // (fetches - échecs) / fetches
  uptimeRate: number;       // part des mesures en statut « ok »
  fallbackRate: number;     // fallbacks / fetches
  avgResponseMs: number | null;
  samples: number;          // nombre de mesures de statut prises
  observationDays: number;  // nombre de jours distincts observés
}

export type QualityMeta = {
  sourceName?: string;
  sourceType?: QualitySourceType;
  sourceUrl?: string;
  freshnessScore?: number;
  freshnessLabel?: QualityFreshnessLabel;
  collectedAt?: string;
  publishedAt?: string;
  observedAt?: string;
  ageMinutes?: number;
  reliabilityScore?: number;
  confidenceScore?: number;
  confidenceLabel?: QualityConfidenceLabel;
  severity?: QualitySeverity;
  domainScore?: number;
  status?: QualityStatus;
  statusMessage?: string;
  explanation?: string;
  limits?: string[];
  reasons?: string[];
  // ── Score calculé (40 % nature / 60 % observé) ──
  qualityScore?: number;        // score final 0-100 (aussi reflété dans reliabilityScore)
  qualityProvisional?: boolean; // true tant que < 10 mesures ou aucun historique
  natureBaseline?: number;      // socle de nature 0-100 (grille par type de source)
  observed?: ObservedMetrics | null; // métriques réelles ayant servi au calcul
};

export interface SourceQualityRegistryEntry {
  id: string;
  name: string;
  domain: string;
  sourceType: QualitySourceType;
  sourceUrl?: string;
  expectedFreshness?: string;
  /** Socle de confiance lié à la nature de la source (grille : ~90 API officielle, ~80 API publique, ~65 RSS, ~50 scraping). */
  natureBaseline?: number;
  mappedIndicators: string[];
  limits: string[];
  watchdogNames: string[];
}

export interface QualitySummaryMetric {
  id:
    | 'sourcesTracked'
    | 'sourcesActive'
    | 'sourcesDegraded'
    | 'averageFreshness'
    | 'qualifiedSignals'
    | 'signalsToReview'
    | 'lastUpdated';
  label: string;
  value: string;
  detail: string;
  tone: 'neutral' | 'good' | 'warning' | 'danger';
}

export interface QualitySourceRow {
  id: string;
  name: string;
  domain: string;
  typeLabel: string;
  quality: QualityMeta;
  lastCollectionLabel: string;
  limitsLabel: string;
}

export interface ModuleQualityRow {
  module: string;
  availableIndicators: string[];
  mappedFields: string[];
  harmonizationStatus: ModuleHarmonizationStatus;
  comment: string;
}

export interface SignalToReview {
  id: string;
  signal: string;
  domain: string;
  source: string;
  scoreLabel: string;
  reason: string;
  action: string;
}

export interface MethodScaleRow {
  range: string;
  label: string;
  description: string;
}

export interface SourcesQualityDashboardData {
  generatedAt: Date;
  summary: Record<QualitySummaryMetric['id'], QualitySummaryMetric>;
  sources: QualitySourceRow[];
  moduleMatrix: ModuleQualityRow[];
  signalsToReview: SignalToReview[];
  methodScale: MethodScaleRow[];
  limits: string[];
}

export interface SourcesQualityDashboardOptions {
  now?: Date;
  statuses?: DataSourceStatus[];
  /** Résolveur de métriques observées injectable (tests) ; par défaut lecture du store local. */
  getObserved?: (sourceName: string) => ObservedMetrics | null;
}

export function formatQualityDate(date: Date | string | null | undefined): string {
  if (!date) return 'N/D';
  const parsed = typeof date === 'string' ? new Date(date) : date;
  if (!Number.isFinite(parsed.getTime())) return 'N/D';
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

export function sourceTypeLabel(type: QualitySourceType): string {
  const labels: Record<QualitySourceType, string> = {
    official: 'Officielle',
    media: 'Média',
    open_data: 'Open data',
    technical: 'Technique',
    internal: 'Interne',
    unknown: 'Inconnue',
  };
  return labels[type];
}
