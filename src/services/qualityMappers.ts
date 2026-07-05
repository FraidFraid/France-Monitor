import type { DataSourceStatus } from '../types/index.ts';
import type {
  ObservedMetrics,
  QualityFreshnessLabel,
  QualityMeta,
  QualitySourceRow,
  QualityStatus,
  SignalToReview,
  SourceQualityRegistryEntry,
} from './qualityMeta.ts';
import { formatQualityDate, sourceTypeLabel } from './qualityMeta.ts';

/** Socle de nature par défaut si l'entrée n'en déclare pas (proche d'un flux RSS). */
const DEFAULT_NATURE_BASELINE = 65;
/** Nombre minimal de mesures avant de considérer le score comme non provisoire. */
const MIN_OBSERVED_SAMPLES = 10;

export interface SourceQualityScore {
  score: number;               // score final 0-100 arrondi
  provisional: boolean;        // true si historique insuffisant (< 10 mesures)
  natureBaseline: number;      // socle de nature retenu
  observedScore: number | null; // composante observée 0-100 (null si provisoire)
}

/**
 * Combine le socle de nature (40 %) et le comportement observé (60 %).
 * Observé = 100 × (0.5·succès + 0.35·disponibilité + 0.15·(1 − fallback)).
 * Sans métriques suffisantes (< 10 mesures) : score = socle, provisoire.
 */
export function computeSourceQualityScore(
  natureBaseline: number,
  observed: ObservedMetrics | null,
  minSamples = MIN_OBSERVED_SAMPLES,
): SourceQualityScore {
  const baseline = clampScore(natureBaseline);
  if (!observed || observed.samples < minSamples) {
    return { score: baseline, provisional: true, natureBaseline: baseline, observedScore: null };
  }
  const observedScore = clampScore(
    100 * (0.5 * observed.successRate + 0.35 * observed.uptimeRate + 0.15 * (1 - observed.fallbackRate)),
  );
  const score = clampScore(baseline * 0.4 + observedScore * 0.6);
  return { score, provisional: false, natureBaseline: baseline, observedScore };
}

function clampScore(value: number): number {
  return Math.round(Math.min(100, Math.max(0, value)));
}

type StatusQuality = Pick<
  QualityMeta,
  'status' | 'statusMessage' | 'freshnessLabel' | 'freshnessScore' | 'collectedAt' | 'ageMinutes' | 'reasons'
>;

export function mapDataSourceStatus(status: DataSourceStatus | undefined): StatusQuality {
  if (!status) {
    return {
      status: 'unknown',
      statusMessage: 'Inconnu',
      freshnessLabel: 'unknown',
      reasons: ['Aucun statut live disponible pour cette session.'],
    };
  }

  const ageMinutes = status.cacheAgeMs != null ? Math.round(status.cacheAgeMs / 60_000) : undefined;
  const freshnessLabel = freshnessFromAge(ageMinutes);

  return {
    status: statusFromDataSource(status),
    statusMessage: status.error ?? status.detail ?? labelStatus(status.status),
    freshnessLabel,
    freshnessScore: freshnessScoreFromAge(ageMinutes),
    collectedAt: status.lastUpdate?.toISOString(),
    ageMinutes,
    reasons: buildStatusReasons(status, freshnessLabel),
  };
}

export function buildSourceQualityRow(
  entry: SourceQualityRegistryEntry,
  status: DataSourceStatus | undefined,
  observed: ObservedMetrics | null = null,
): QualitySourceRow {
  const mapped = mapDataSourceStatus(status);
  const scored = computeSourceQualityScore(entry.natureBaseline ?? DEFAULT_NATURE_BASELINE, observed);
  const reliabilityScore = scored.score;
  const quality: QualityMeta = {
    sourceName: entry.name,
    sourceType: entry.sourceType,
    sourceUrl: entry.sourceUrl,
    reliabilityScore,
    confidenceScore: reliabilityScore,
    confidenceLabel: confidenceLabel(reliabilityScore),
    qualityScore: scored.score,
    qualityProvisional: scored.provisional,
    natureBaseline: scored.natureBaseline,
    observed,
    limits: entry.limits,
    explanation: buildExplanation(entry, mapped),
    ...mapped,
  };

  return {
    id: entry.id,
    name: entry.name,
    domain: entry.domain,
    typeLabel: sourceTypeLabel(entry.sourceType),
    quality,
    lastCollectionLabel: formatQualityDate(status?.lastUpdate ?? null),
    limitsLabel: entry.limits.join(' · ') || 'Non renseigné',
  };
}

export function buildReviewSignalFromSource(
  entry: SourceQualityRegistryEntry,
  status: DataSourceStatus | undefined,
): SignalToReview | null {
  const mapped = mapDataSourceStatus(status);
  if (mapped.status !== 'cached' && mapped.status !== 'degraded' && mapped.status !== 'error') return null;

  return {
    id: `source-${entry.id}`,
    signal: entry.name,
    domain: entry.domain,
    source: entry.name,
    scoreLabel: mapped.freshnessScore != null ? `${mapped.freshnessScore}/100` : 'N/D',
    reason: mapped.reasons?.[0] ?? 'Source à vérifier.',
    action: mapped.status === 'error' ? 'Vérifier la source primaire ou le proxy.' : 'Contrôler la fraîcheur avant exploitation.',
  };
}

function statusFromDataSource(status: DataSourceStatus): QualityStatus {
  if (status.status === 'ok') return 'active';
  if (status.status === 'stale') return 'cached';
  if (status.status === 'error') return 'error';
  return 'unknown';
}

function labelStatus(status: DataSourceStatus['status']): string {
  if (status === 'ok') return 'Actif';
  if (status === 'stale') return 'Cache ou source vieillissante';
  if (status === 'error') return 'Erreur';
  return 'Chargement ou non initialisé';
}

function freshnessFromAge(ageMinutes: number | undefined): QualityFreshnessLabel {
  if (ageMinutes == null) return 'unknown';
  if (ageMinutes <= 15) return 'fresh';
  if (ageMinutes <= 180) return 'acceptable';
  return 'stale';
}

function freshnessScoreFromAge(ageMinutes: number | undefined): number | undefined {
  if (ageMinutes == null) return undefined;
  if (ageMinutes <= 15) return 100;
  if (ageMinutes <= 180) return Math.max(45, 100 - Math.round((ageMinutes - 15) / 2));
  return Math.max(0, 40 - Math.round((ageMinutes - 180) / 15));
}

function confidenceLabel(score: number | undefined): QualityMeta['confidenceLabel'] {
  if (score == null) return 'unknown';
  if (score >= 70) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

function buildStatusReasons(status: DataSourceStatus, freshnessLabel: QualityFreshnessLabel): string[] {
  const reasons: string[] = [];
  if (status.status === 'error') reasons.push(status.error ? `Erreur source : ${status.error}` : 'Source en erreur.');
  if (status.status === 'stale') reasons.push('Dernière donnée issue du cache ou d’une collecte vieillissante.');
  if (freshnessLabel === 'stale') reasons.push('Fraîcheur trop ancienne pour une lecture automatique.');
  if ((status.fallbackCount ?? 0) > 0) reasons.push(`${status.fallbackCount} fallback activé(s).`);
  return reasons;
}

function buildExplanation(entry: SourceQualityRegistryEntry, mapped: StatusQuality): string {
  const freshness = mapped.freshnessLabel === 'unknown' ? 'fraîcheur non disponible' : `fraîcheur ${mapped.freshnessLabel}`;
  return `${entry.name} · ${sourceTypeLabel(entry.sourceType)} · ${freshness}.`;
}
