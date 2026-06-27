import type { DataSourceStatus } from '../types/index.ts';
import type {
  QualityFreshnessLabel,
  QualityMeta,
  QualitySourceRow,
  QualityStatus,
  SignalToReview,
  SourceQualityRegistryEntry,
} from './qualityMeta.ts';
import { formatQualityDate, sourceTypeLabel } from './qualityMeta.ts';

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
): QualitySourceRow {
  const mapped = mapDataSourceStatus(status);
  const reliabilityScore = entry.reliabilityScore;
  const quality: QualityMeta = {
    sourceName: entry.name,
    sourceType: entry.sourceType,
    sourceUrl: entry.sourceUrl,
    reliabilityScore,
    confidenceScore: reliabilityScore,
    confidenceLabel: confidenceLabel(reliabilityScore),
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
