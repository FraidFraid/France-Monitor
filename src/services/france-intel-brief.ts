// src/services/france-intel-brief.ts
import type {
  BriefJudgment,
  BriefWatchItem,
  DetectedSituation,
  FranceCountrySnapshot,
  FranceBriefContext,
  StructuredBrief,
} from '../types/index.ts';

interface BriefCacheEntry {
  brief: string | null;
  freshness: 'fresh' | 'cached';
  expiresAt: number;
}

const PROMPT_VERSION = 'v11';
const _cache = new Map<string, BriefCacheEntry>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 h

function hashCacheSeed(seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function buildClientCacheKey(ctx: FranceBriefContext, lang: 'fr' | 'en'): string {
  return `${PROMPT_VERSION}:${lang}:${hashCacheSeed(JSON.stringify({
    score: ctx.score,
    axes: ctx.axes,
    isnrComponents: ctx.isnrComponents,
    cyberScore: ctx.cyberScore,
    signals: ctx.signals,
    topHeadlines: ctx.topHeadlines,
    energySummary: ctx.energySummary,
  }))}`;
}

export interface FranceBriefResult {
  brief: string | null;
  freshness: 'fresh' | 'cached';
}

export async function fetchFranceIntelBrief(
  ctx: FranceBriefContext,
  lang: 'fr' | 'en' = 'fr',
): Promise<FranceBriefResult> {
  const cacheKey = buildClientCacheKey(ctx, lang);
  // Check client-side cache
  const cached = _cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return { brief: cached.brief, freshness: 'cached' };
  }

  const countryScore   = ctx.score;
  const axes = ctx.axes;
  const isnrComponents = ctx.isnrComponents;
  const cyberScore     = ctx.cyberScore;
  const meteoAlertCount = ctx.signals.meteoAlerts;
  const topHeadlines   = ctx.topHeadlines;
  const energy = ctx.energySummary ? {
    ecowattSignal: ctx.energySummary.ecowattSignal,
    nuclearShare:  ctx.energySummary.shares.nuclear,
    gasShare:      ctx.energySummary.shares.gas,
    hydroShare:    ctx.energySummary.shares.hydro,
    windShare:     ctx.energySummary.shares.wind,
    solarShare:    ctx.energySummary.shares.solar,
    totalMw:       ctx.energySummary.totalMw,
    oilStocksDays: ctx.energySummary.oilStocksDays,
    oilVigilanceStatus: ctx.energySummary.oilVigilanceStatus,
    fuelTensionLevel: ctx.energySummary.fuelTensionLevel,
    fuelTensionAnomalyShare: ctx.energySummary.fuelTensionAnomalyShare,
    fuelPriceDelta7dCents: ctx.energySummary.fuelPriceHistory?.series.reduce<number | null>((max, series) => {
      const delta = series.delta7dCents;
      if (delta == null || delta <= 0) return max;
      return max == null ? delta : Math.max(max, delta);
    }, null) ?? null,
    fuelPriceDelta30dCents: ctx.energySummary.fuelPriceHistory?.series.reduce<number | null>((max, series) => {
      const delta = series.delta30dCents;
      if (delta == null || delta <= 0) return max;
      return max == null ? delta : Math.max(max, delta);
    }, null) ?? null,
  } : null;

  try {
    const res = await fetch('/api/intelligence/v1/france-intel-brief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        countryScore,
        axes,
        isnrComponents,
        cyberScore,
        meteoAlertCount,
        topHeadlines,
        signalCounts: {
          criticalNews:          ctx.signals.criticalNews,
          highNews:              ctx.signals.highNews,
          weatherAlerts:         ctx.signals.meteoAlerts,   // API contract uses "weatherAlerts"
          floodAlerts:           ctx.signals.floodAlerts,
          fireDetections:        ctx.signals.fireDetections,
          railDisruptions:       ctx.signals.railDisruptions,
          roadIncidents:         ctx.signals.roadIncidents,
          powerOutages:          ctx.signals.powerOutages,
          telecomOutages:        ctx.signals.telecomOutages,
          cyberAlerts:           ctx.signals.cyberAlerts,
          militaryFlights:       ctx.signals.militaryFlights,
          maritimeTrafficFrance: ctx.signals.maritimeTrafficFrance,
          defenseAlerts:         ctx.signals.defenseAlerts,
          jammingSignals:        ctx.signals.jammingSignals,
          marketStress:          ctx.signals.marketStress,
        },
        energy,
        lang,
      }),
    });

    if (!res.ok) return { brief: null, freshness: 'fresh' };

    const payload = await res.json() as { brief: string | null; fromCache: boolean };
    const result: FranceBriefResult = {
      brief: payload.brief ?? null,
      freshness: payload.fromCache ? 'cached' : 'fresh',
    };

    // Only cache successful (non-null) briefs — a null result should not block for 2h
    if (result.brief !== null) {
      _cache.set(cacheKey, { brief: result.brief, freshness: result.freshness, expiresAt: Date.now() + CACHE_TTL_MS });
    }
    return result;
  } catch {
    return { brief: null, freshness: 'fresh' };
  }
}

/** Clear client-side brief cache (e.g. on lang toggle to force refetch). */
export function clearFranceBriefCache(lang?: 'fr' | 'en'): void {
  if (lang) {
    for (const key of _cache.keys()) {
      if (key.includes(`:${lang}:`)) _cache.delete(key);
    }
  } else {
    _cache.clear();
  }
}

// ─── Brief structuré : validation + fallback déterministe (spec §6) ──────────

const BLUF_MAX = 400;
const JUDGMENT_TEXT_MAX = 280;
const MAX_JUDGMENTS = 4;
const MAX_WATCH = 4;
const MAX_SOURCES = 5;

/** Valide et borne un brief JSON (LLM ou cache). Retourne null si structurellement invalide. */
export function parseStructuredBrief(
  value: unknown,
  origin: 'llm' | 'deterministic',
): StructuredBrief | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.bluf !== 'string' || raw.bluf.trim().length < 20) return null;
  if (!Array.isArray(raw.judgments) || raw.judgments.length === 0) return null;

  const judgments: BriefJudgment[] = [];
  for (const item of raw.judgments.slice(0, MAX_JUDGMENTS)) {
    if (typeof item !== 'object' || item === null) return null;
    const j = item as Record<string, unknown>;
    const priority = j.priority === 1 || j.priority === 2 || j.priority === 3 || j.priority === 4
      ? j.priority : null;
    const confidence = j.confidence === 'high' || j.confidence === 'moderate' || j.confidence === 'low'
      ? j.confidence : null;
    if (priority === null || confidence === null || typeof j.text !== 'string' || j.text.trim().length === 0) {
      return null;
    }
    const sources = Array.isArray(j.sources)
      ? j.sources.filter((s): s is string => typeof s === 'string').slice(0, MAX_SOURCES)
      : [];
    judgments.push({ priority, text: j.text.trim().slice(0, JUDGMENT_TEXT_MAX), confidence, sources });
  }
  judgments.sort((a, b) => a.priority - b.priority);

  const watch: BriefWatchItem[] = [];
  if (Array.isArray(raw.watch)) {
    for (const item of raw.watch.slice(0, MAX_WATCH)) {
      if (typeof item !== 'object' || item === null) continue;
      const w = item as Record<string, unknown>;
      if (typeof w.text !== 'string' || w.text.trim().length === 0) continue;
      const horizon = w.horizon === '6h' || w.horizon === '24h' || w.horizon === '48h' ? w.horizon : '24h';
      watch.push({ text: w.text.trim().slice(0, JUDGMENT_TEXT_MAX), horizon });
    }
  }

  return { bluf: raw.bluf.trim().slice(0, BLUF_MAX), judgments, watch, origin };
}

function bandLabel(score: number, lang: 'fr' | 'en'): string {
  if (score >= 85) return 'stable';
  if (score >= 70) return lang === 'fr' ? 'en vigilance' : 'under watch';
  if (score >= 55) return lang === 'fr' ? 'sous tension' : 'under pressure';
  if (score >= 40) return lang === 'fr' ? 'dégradée' : 'degraded';
  return lang === 'fr' ? 'critique' : 'critical';
}

const PILLAR_LABELS: Record<string, { fr: string; en: string }> = {
  continuity: { fr: 'continuité', en: 'continuity' },
  security: { fr: 'sécurité', en: 'security' },
  signal: { fr: 'signal', en: 'signal' },
  defense: { fr: 'défense', en: 'defense' },
};

const SEVERITY_PRIORITY: Record<DetectedSituation['severity'], 1 | 2 | 3 | 4> = {
  critical: 1,
  high: 2,
  medium: 3,
  watch: 4,
};

/**
 * Brief de secours 100 % moteur : toujours disponible, zéro hallucination.
 * Utilisé si le LLM est indisponible, invalide ou hors ligne.
 */
export function buildDeterministicBrief(
  snapshot: Pick<FranceCountrySnapshot, 'score' | 'scoreBreakdown' | 'situations'>,
  lang: 'fr' | 'en',
  delta24h: number | null = null,
): StructuredBrief {
  const { score, scoreBreakdown, situations } = snapshot;
  const dominant = [...scoreBreakdown.pillars].sort((a, b) => b.deduction - a.deduction)[0];
  const pillarLabel = dominant
    ? (lang === 'fr' ? PILLAR_LABELS[dominant.key].fr : PILLAR_LABELS[dominant.key].en)
    : (lang === 'fr' ? 'aucune' : 'none');
  const deltaText = delta24h == null
    ? ''
    : lang === 'fr'
      ? `, ${delta24h >= 0 ? '+' : '−'}${Math.abs(delta24h)} sur 24 h`
      : `, ${delta24h >= 0 ? '+' : '−'}${Math.abs(delta24h)} over 24h`;

  const bluf = lang === 'fr'
    ? `Situation nationale ${bandLabel(score, lang)} (${score}/100${deltaText}). Pression dominante : ${pillarLabel}. ${situations.length} situation(s) corrélée(s) active(s).`
    : `National situation ${bandLabel(score, lang)} (${score}/100${deltaText}). Dominant pressure: ${pillarLabel}. ${situations.length} active correlated situation(s).`;

  const judgments: BriefJudgment[] = situations.slice(0, 3).map((s) => ({
    priority: SEVERITY_PRIORITY[s.severity],
    text: `${s.title} — ${s.summary}`.slice(0, JUDGMENT_TEXT_MAX),
    confidence: s.confidence >= 0.75 ? 'high' : s.confidence >= 0.55 ? 'moderate' : 'low',
    sources: s.sourceRefs.slice(0, MAX_SOURCES),
  }));
  if (judgments.length === 0) {
    judgments.push({
      priority: 4,
      text: lang === 'fr'
        ? 'Aucune corrélation multi-source active — pression diffuse de fond sans point de convergence dominant.'
        : 'No active multi-source correlation — diffuse background pressure without a dominant convergence point.',
      confidence: 'high',
      sources: [lang === 'fr' ? 'Moteur de situations' : 'Situation engine'],
    });
  }
  // Tri par priorité croissante — contrat StructuredBrief (« triés par priorité »)
  judgments.sort((a, b) => a.priority - b.priority);

  const watch: BriefWatchItem[] = situations
    .flatMap((s) => s.recommendedActions
      .filter((a) => a.actionType === 'monitor')
      .map((a): BriefWatchItem => ({
        text: a.label,
        horizon: s.severity === 'critical' ? '6h' : '24h',
      })))
    .slice(0, MAX_WATCH);
  if (watch.length === 0) {
    watch.push({
      text: lang === 'fr'
        ? `Convergence éventuelle de signaux faibles vers un schéma d'instabilité`
        : 'Potential convergence of weak signals into an instability pattern',
      horizon: '24h',
    });
  }

  return { bluf, judgments, watch, origin: 'deterministic' };
}

// ─── Forme compacte des situations pour le payload API ──────────────────────

export interface CompactSituation {
  type: string;
  severity: DetectedSituation['severity'];
  confidence: number;
  title: string;
  summary: string;
  drivers: string[];
  sourceRefs: string[];
  affectedZones: string[];
}

export function compactSituations(situations: DetectedSituation[]): CompactSituation[] {
  return situations.slice(0, 5).map((s) => ({
    type: String(s.type).slice(0, 40),
    severity: s.severity,
    confidence: Math.round(s.confidence * 100) / 100,
    title: s.title.replace(/[\r\n]+/g, ' ').slice(0, 120),
    summary: s.summary.replace(/[\r\n]+/g, ' ').slice(0, 240),
    drivers: s.drivers.slice(0, 5).map((d) => d.replace(/[\r\n]+/g, ' ').slice(0, 160)),
    sourceRefs: s.sourceRefs.slice(0, 5).map((r) => r.slice(0, 60)),
    affectedZones: s.affectedZones.slice(0, 4).map((z) => z.slice(0, 60)),
  }));
}
