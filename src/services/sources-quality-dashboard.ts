import type { DataSourceStatus } from '../types/index.ts';
import { Watchdog } from './watchdog.ts';
import { buildReviewSignalFromSource, buildSourceQualityRow } from './qualityMappers.ts';
import { getObservedMetrics } from './source-quality-history.ts';
import type {
  MethodScaleRow,
  ModuleQualityRow,
  ObservedMetrics,
  QualitySourceRow,
  QualitySummaryMetric,
  SignalToReview,
  SourceQualityRegistryEntry,
  SourcesQualityDashboardData,
  SourcesQualityDashboardOptions,
} from './qualityMeta.ts';
import { formatQualityDate } from './qualityMeta.ts';

// natureBaseline : socle de confiance lié à la NATURE de la source, snappé sur la
// grille {90 API officielle avec clé, 80 API publique, 65 RSS, 50 scraping/communautaire}
// au plus proche de l'ancien score codé en dur. Le score final combine ce socle (40 %)
// avec le comportement observé (60 %) — voir computeSourceQualityScore.
const SOURCE_REGISTRY: SourceQualityRegistryEntry[] = [
  {
    id: 'rss-pqr',
    name: 'Flux RSS actualités',
    domain: 'Actualités',
    sourceType: 'media',
    natureBaseline: 65,
    watchdogNames: ['RSS PQR', 'Flux RSS actualités'],
    mappedIndicators: ['source', 'date de publication', 'classification'],
    limits: ['Qualité variable selon les médias', 'Certaines sources peuvent bloquer les proxys'],
  },
  {
    id: 'meteo-france',
    name: 'Météo-France',
    domain: 'Météo',
    sourceType: 'official',
    natureBaseline: 90,
    watchdogNames: ['Météo-France'],
    mappedIndicators: ['source', 'vigilance', 'date', 'criticité'],
    limits: ['Dépendance à la disponibilité API'],
  },
  {
    id: 'vigicrues',
    name: 'Vigicrues',
    domain: 'Crues',
    sourceType: 'official',
    natureBaseline: 90,
    watchdogNames: ['Vigicrues'],
    mappedIndicators: ['source', 'niveau', 'date'],
    limits: ['Granularité dépendante des tronçons publiés'],
  },
  {
    id: 'hubeau',
    name: 'Hub’Eau hydrométrie',
    domain: 'Hydrométrie',
    sourceType: 'open_data',
    natureBaseline: 90,
    watchdogNames: ['Hub’Eau hydrométrie'],
    mappedIndicators: ['source', 'fraîcheur', 'âge observation', 'confiance', 'appui mesuré'],
    limits: ['Appui OSINT, pas télémesure EDF barrage par barrage'],
  },
  {
    id: 'ecowatt',
    name: 'Écowatt RTE',
    domain: 'Énergie',
    sourceType: 'official',
    natureBaseline: 90,
    watchdogNames: ['Écowatt RTE'],
    mappedIndicators: ['source', 'signal', 'statut', 'fraîcheur'],
    limits: ['Signal agrégé, pas diagnostic local exhaustif'],
  },
  {
    id: 'nuclear-rte',
    name: 'Nucléaire RTE',
    domain: 'Énergie',
    sourceType: 'official',
    natureBaseline: 90,
    watchdogNames: ['Nucléaire RTE'],
    mappedIndicators: ['source', 'indisponibilités', 'statut'],
    limits: ['Dépend de la disponibilité des flux RTE'],
  },
  {
    id: 'sncf',
    name: 'SNCF',
    domain: 'Transport',
    sourceType: 'official',
    natureBaseline: 80,
    watchdogNames: ['SNCF'],
    mappedIndicators: ['source', 'statut', 'cache', 'date'],
    limits: ['Couverture et fraîcheur variables selon endpoint'],
  },
  {
    id: 'cyber',
    name: 'Cyber',
    domain: 'Cyber',
    sourceType: 'technical',
    natureBaseline: 80,
    watchdogNames: ['Cyber'],
    mappedIndicators: ['source', 'catégorie', 'criticité', 'score global'],
    limits: ['Sources hétérogènes, recoupement humain recommandé'],
  },
  {
    id: 'finance',
    name: 'Finance',
    domain: 'Finance',
    sourceType: 'technical',
    natureBaseline: 80,
    watchdogNames: ['Finance'],
    mappedIndicators: ['source', 'date', 'valeurs marché'],
    limits: ['Données indicatives, pas conseil financier'],
  },
  {
    id: 'fires-nasa',
    name: 'NASA FIRMS',
    domain: 'Environnement',
    sourceType: 'official',
    natureBaseline: 80,
    watchdogNames: ['NASA FIRMS'],
    mappedIndicators: ['source', 'détection', 'confiance'],
    limits: ['Détections satellites à interpréter avec prudence'],
  },
  {
    id: 'military-flights',
    name: 'Vols militaires',
    domain: 'Défense',
    sourceType: 'technical',
    natureBaseline: 65,
    watchdogNames: ['Vols militaires'],
    mappedIndicators: ['source', 'fallback', 'positions'],
    limits: ['ADS-B incomplet par nature'],
  },
  {
    id: 'ais-maritime',
    name: 'AIS maritime',
    domain: 'Maritime',
    sourceType: 'technical',
    natureBaseline: 65,
    watchdogNames: ['AIS maritime'],
    mappedIndicators: ['source', 'statut', 'positions'],
    limits: ['AIS incomplet ou volontairement désactivé'],
  },
  {
    id: 'air-traffic',
    name: 'Trafic aérien',
    domain: 'Aviation',
    sourceType: 'technical',
    natureBaseline: 65,
    watchdogNames: ['Trafic aérien'],
    mappedIndicators: ['source', 'statut', 'positions'],
    limits: ['Couverture publique limitée'],
  },
  {
    id: 'arcep',
    name: 'Télécoms',
    domain: 'Infrastructures',
    sourceType: 'open_data',
    natureBaseline: 80,
    watchdogNames: ['Télécoms'],
    mappedIndicators: ['source', 'statut', 'pannes'],
    limits: ['Dataset de panne, pas inventaire complet réseau'],
  },
  {
    id: 'ioda',
    name: 'IODA Internet',
    domain: 'Infrastructures',
    sourceType: 'technical',
    natureBaseline: 65,
    watchdogNames: ['IODA Internet'],
    mappedIndicators: ['score', 'statut', 'fraîcheur'],
    limits: ['Signal réseau indirect'],
  },
  {
    id: 'health',
    name: 'SPF / DREES',
    domain: 'Santé',
    sourceType: 'official',
    natureBaseline: 90,
    watchdogNames: ['SPF / DREES'],
    mappedIndicators: ['source', 'date', 'indicateurs santé'],
    limits: ['Données agrégées, pas diagnostic médical'],
  },
  {
    id: 'eolien',
    name: 'Éolien France',
    domain: 'Énergie',
    sourceType: 'open_data',
    natureBaseline: 80,
    watchdogNames: ['Éolien France'],
    mappedIndicators: ['production', 'facteur de charge', 'alerte'],
    limits: ['Production estimée selon sources disponibles'],
  },
  {
    id: 'gas',
    name: 'Gaz',
    domain: 'Énergie',
    sourceType: 'official',
    natureBaseline: 80,
    watchdogNames: ['Gaz'],
    mappedIndicators: ['source', 'statut', 'stockage'],
    limits: ['Plusieurs opérateurs, disponibilité variable'],
  },
  {
    id: 'oil',
    name: 'Pétrole',
    domain: 'Énergie',
    sourceType: 'open_data',
    natureBaseline: 80,
    watchdogNames: ['Pétrole'],
    mappedIndicators: ['source', 'fraîcheur', 'tension carburant'],
    limits: ['Indicateur de tension, pas prévision'],
  },
];

const MODULE_MATRIX: ModuleQualityRow[] = [
  {
    module: 'Hub’Eau',
    availableIndicators: ['source', 'fraîcheur de mesure', 'âge observation', 'confiance', 'niveau mesuré'],
    mappedFields: ['sourceName', 'freshnessLabel', 'ageMinutes', 'confidenceScore'],
    harmonizationStatus: 'mappé',
    comment: 'Le module expose déjà une structure de qualification exploitable.',
  },
  {
    module: 'Météo',
    availableIndicators: ['source', 'vigilance', 'date', 'criticité'],
    mappedFields: ['sourceName', 'severity', 'publishedAt'],
    harmonizationStatus: 'partiel',
    comment: 'La criticité est lisible via les niveaux de vigilance.',
  },
  {
    module: 'Réseau',
    availableIndicators: ['sous-scores', 'score global', 'statut'],
    mappedFields: ['domainScore', 'status', 'reasons'],
    harmonizationStatus: 'partiel',
    comment: 'Le baromètre réseau agrège déjà plusieurs scores métier.',
  },
  {
    module: 'Transport',
    availableIndicators: ['source', 'statut', 'cache', 'date'],
    mappedFields: ['sourceName', 'status', 'collectedAt'],
    harmonizationStatus: 'partiel',
    comment: 'Les statuts sont surtout portés par le panneau sources et Watchdog.',
  },
  {
    module: 'Cyber',
    availableIndicators: ['source', 'catégorie', 'criticité', 'score global'],
    mappedFields: ['sourceName', 'severity', 'domainScore'],
    harmonizationStatus: 'partiel',
    comment: 'Le score cyber existe mais les événements restent hétérogènes.',
  },
  {
    module: 'Actualités',
    availableIndicators: ['source', 'date', 'classification'],
    mappedFields: ['sourceName', 'publishedAt', 'confidenceScore'],
    harmonizationStatus: 'partiel',
    comment: 'La classification existe, la fiabilité source reste à harmoniser.',
  },
  {
    module: 'Énergie',
    availableIndicators: ['source', 'fraîcheur', 'statut'],
    mappedFields: ['sourceName', 'freshnessLabel', 'status'],
    harmonizationStatus: 'partiel',
    comment: 'Plusieurs sous-domaines énergie exposent déjà des statuts.',
  },
];

const METHOD_SCALE: MethodScaleRow[] = [
  {
    range: '70-100',
    label: 'Exploitable',
    description: 'Signal suffisamment récent, sourcé ou fiable pour orienter la lecture.',
  },
  {
    range: '40-69',
    label: 'À vérifier',
    description: 'Signal utile mais incomplet, vieillissant ou partiellement qualifié.',
  },
  {
    range: '0-39',
    label: 'Faible confiance',
    description: 'Signal trop ancien, non recoupé ou porté par une source instable.',
  },
  {
    range: 'N/D',
    label: 'Non disponible',
    description: 'La donnée n’existe pas encore dans le module source.',
  },
];

const SYSTEM_LIMITS = [
  'France Monitor ne remplace pas les sources officielles.',
  'France Monitor ne remplace pas les services d’urgence.',
  'France Monitor ne remplace pas les journalistes.',
  'France Monitor ne remplace pas les analystes humains.',
  'Les scores servent à orienter la lecture, pas à produire une vérité automatique.',
];

export function getSourceQualityRegistry(): SourceQualityRegistryEntry[] {
  return SOURCE_REGISTRY.map((entry) => ({
    ...entry,
    mappedIndicators: [...entry.mappedIndicators],
    limits: [...entry.limits],
    watchdogNames: [...entry.watchdogNames],
  }));
}

export function getSourcesQualityDashboardData(options: SourcesQualityDashboardOptions = {}): SourcesQualityDashboardData {
  const now = options.now ?? new Date();
  const statuses = options.statuses ?? Watchdog.getSnapshot().map((snapshot) => snapshot.status);
  const resolveObserved = options.getObserved ?? getObservedMetrics;
  const statusByName = new Map<string, DataSourceStatus>();
  for (const status of statuses) statusByName.set(status.name, status);

  const sources = SOURCE_REGISTRY.map((entry) => {
    const status = findStatus(entry, statusByName);
    return buildSourceQualityRow(entry, status, findObserved(entry, resolveObserved));
  });

  const signalsToReview = SOURCE_REGISTRY
    .map((entry) => buildReviewSignalFromSource(entry, findStatus(entry, statusByName)))
    .filter((item): item is SignalToReview => item !== null);

  return {
    generatedAt: now,
    summary: buildSummary(now, sources, signalsToReview),
    sources,
    moduleMatrix: MODULE_MATRIX.map((row) => ({
      ...row,
      availableIndicators: [...row.availableIndicators],
      mappedFields: [...row.mappedFields],
    })),
    signalsToReview,
    methodScale: METHOD_SCALE.map((row) => ({ ...row })),
    limits: [...SYSTEM_LIMITS],
  };
}

function findStatus(
  entry: SourceQualityRegistryEntry,
  statusByName: Map<string, DataSourceStatus>,
): DataSourceStatus | undefined {
  return entry.watchdogNames.map((name) => statusByName.get(name)).find((status): status is DataSourceStatus => status !== undefined);
}

function findObserved(
  entry: SourceQualityRegistryEntry,
  resolve: (sourceName: string) => ObservedMetrics | null,
): ObservedMetrics | null {
  for (const name of entry.watchdogNames) {
    const metrics = resolve(name);
    if (metrics) return metrics;
  }
  return null;
}

function buildSummary(
  now: Date,
  sources: QualitySourceRow[],
  signalsToReview: SignalToReview[],
): SourcesQualityDashboardData['summary'] {
  const active = sources.filter((source) => source.quality.status === 'active').length;
  const degraded = sources.filter((source) =>
    source.quality.status === 'cached' ||
    source.quality.status === 'degraded' ||
    source.quality.status === 'error',
  ).length;
  const freshnessScores = sources
    .map((source) => source.quality.freshnessScore)
    .filter((value): value is number => typeof value === 'number');
  const avgFreshness = freshnessScores.length > 0
    ? `${Math.round(freshnessScores.reduce((sum, score) => sum + score, 0) / freshnessScores.length)}/100`
    : 'N/D';

  return {
    sourcesTracked: metric('sourcesTracked', 'Sources suivies', String(sources.length), 'Sources réellement présentes dans le projet.', 'neutral'),
    sourcesActive: metric('sourcesActive', 'Sources actives', String(active), 'Sources avec statut live actif dans cette session.', active > 0 ? 'good' : 'neutral'),
    sourcesDegraded: metric(
      'sourcesDegraded',
      'Sources en erreur ou dégradées',
      String(degraded),
      'Sources en cache, dégradées ou en erreur.',
      degraded > 0 ? 'warning' : 'good',
    ),
    averageFreshness: metric(
      'averageFreshness',
      'Fraîcheur moyenne',
      avgFreshness,
      'Calculée uniquement sur les sources avec âge connu.',
      avgFreshness === 'N/D' ? 'neutral' : 'good',
    ),
    qualifiedSignals: metric(
      'qualifiedSignals',
      'Signaux qualifiés',
      String(sources.filter((source) => source.quality.reliabilityScore != null || source.quality.freshnessScore != null).length),
      'Sources avec au moins un indicateur mappé.',
      'neutral',
    ),
    signalsToReview: metric(
      'signalsToReview',
      'Signaux à vérifier',
      String(signalsToReview.length),
      'Sources ou signaux nécessitant une lecture humaine.',
      signalsToReview.length > 0 ? 'warning' : 'good',
    ),
    lastUpdated: metric('lastUpdated', 'Dernière mise à jour', formatQualityDate(now), 'Date de génération de cette vue.', 'neutral'),
  };
}

function metric(
  id: QualitySummaryMetric['id'],
  label: string,
  value: string,
  detail: string,
  tone: QualitySummaryMetric['tone'],
): QualitySummaryMetric {
  return { id, label, value, detail, tone };
}
