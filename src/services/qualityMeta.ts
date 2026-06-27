import type { DataSourceStatus } from '../types/index.ts';

export type QualitySourceType = 'official' | 'media' | 'open_data' | 'technical' | 'internal' | 'unknown';
export type QualityFreshnessLabel = 'fresh' | 'acceptable' | 'stale' | 'unknown';
export type QualityConfidenceLabel = 'high' | 'medium' | 'low' | 'unknown';
export type QualitySeverity = 'low' | 'medium' | 'high' | 'critical' | 'unknown';
export type QualityStatus = 'active' | 'cached' | 'degraded' | 'error' | 'unknown';
export type ModuleHarmonizationStatus = 'mappé' | 'partiel' | 'à harmoniser';

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
};

export interface SourceQualityRegistryEntry {
  id: string;
  name: string;
  domain: string;
  sourceType: QualitySourceType;
  sourceUrl?: string;
  expectedFreshness?: string;
  reliabilityScore?: number;
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
