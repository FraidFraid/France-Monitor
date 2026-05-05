import type { CyberState, ThreatEvent } from '../types/index.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

const FAMILY_CAPS = {
  leaks: 20,
  ransomware: 25,
  vulnerabilities: 20,
  exposure: 20,
  correlation: 15,
} as const;

const FAMILY_BASE_WEIGHTS = {
  leaks: 7,
  ransomware: 9,
  vulnerabilities: 8,
  exposure: 6,
} as const;

const FAMILY_WINDOWS_DAYS = {
  leaks: 45,
  ransomware: 30,
  vulnerabilities: 21,
  exposure: 14,
} as const;

const SEVERITY_FACTORS: Record<ThreatEvent['severity'], number> = {
  critical: 1.35,
  high: 1,
  medium: 0.72,
  low: 0.45,
};

const CRITICAL_SECTOR_KEYWORDS = [
  'sante',
  'health',
  'hopital',
  'chu',
  'transport',
  'sncf',
  'ratp',
  'energie',
  'energy',
  'edf',
  'enedis',
  'rte',
  'collectivite',
  'mairie',
  'prefecture',
  'gouvernement',
  'government',
];

export interface CyberThreatSummary {
  total30d: number;
  france30d: number;
  leaks30d: number;
  ransomware30d: number;
  exposure30d: number;
  vulnerability30d: number;
  critical30d: number;
  high30d: number;
}

export type CyberSignalFamily = 'leaks' | 'ransomware' | 'vulnerabilities' | 'exposure' | 'correlation';

export interface CyberPressureBreakdownItem {
  family: CyberSignalFamily;
  label: string;
  score: number;
  cap: number;
  eventCount: number;
  explanation: string;
}

export interface CyberPressureContext {
  powerOutageCount?: number;
  telecomOutageCount?: number;
  cloudIncidentCount?: number;
}

export interface CyberPressureAssessment {
  score: number;
  summary: CyberThreatSummary;
  certCritical: number;
  criticalCVEs: number;
  dominantFamily: CyberSignalFamily | null;
  breakdown: CyberPressureBreakdownItem[];
}

type ScoredThreatFamily = Exclude<CyberSignalFamily, 'correlation'>;

interface FamilyAccumulator {
  raw: number;
  count: number;
}

interface ThreatFamilyEvent {
  event: ThreatEvent;
  family: ScoredThreatFamily;
  daysOld: number;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scaleCount(count: number, cap: number, maxContribution: number): number {
  if (count <= 0 || cap <= 0 || maxContribution <= 0) return 0;
  const bounded = Math.min(count, cap);
  const ratio = Math.log1p(bounded) / Math.log1p(cap);
  return ratio * maxContribution;
}

function normalizeText(value: string | undefined): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function labelForFamily(family: CyberSignalFamily): string {
  switch (family) {
    case 'leaks': return 'Leaks';
    case 'ransomware': return 'Ransomware';
    case 'vulnerabilities': return 'CERT/NVD';
    case 'exposure': return 'Shodan/Censys';
    case 'correlation': return 'Corrélations';
  }
}

function familyFromType(type: ThreatEvent['type']): ScoredThreatFamily {
  switch (type) {
    case 'leak': return 'leaks';
    case 'ransomware': return 'ransomware';
    case 'vulnerability': return 'vulnerabilities';
    case 'exposure': return 'exposure';
  }
}

function getDaysOld(date: string): number | null {
  const ts = new Date(date).getTime();
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, (Date.now() - ts) / DAY_MS);
}

function freshnessWeight(daysOld: number, family: ScoredThreatFamily): number {
  const windowDays = FAMILY_WINDOWS_DAYS[family];
  if (daysOld <= 2) return 1;
  if (daysOld >= windowDays * 4) return 0;

  const progress = Math.min(daysOld / windowDays, 4);
  if (progress <= 1) return 1 - progress * 0.45;
  if (progress <= 2) return 0.55 - (progress - 1) * 0.22;
  return Math.max(0.08, 0.33 - (progress - 2) * 0.12);
}

function assetWeight(event: ThreatEvent, family: ScoredThreatFamily): number {
  const assets = event.metrics?.affectedAssets ?? event.metrics?.records ?? 0;
  if (family === 'exposure') {
    return 1 + scaleCount(assets, 500, 0.55);
  }
  if (family === 'leaks') {
    return 1 + scaleCount(assets, 100_000, 0.4);
  }
  return 1;
}

function sourceWeight(event: ThreatEvent, family: ScoredThreatFamily): number {
  const source = normalizeText(event.sourceLabel || event.sources[0]?.name);
  if (family === 'ransomware' && source.includes('frenchbreaches')) return 1.15;
  if (family === 'vulnerabilities' && source.includes('cert')) return 1.1;
  if (family === 'exposure' && (source.includes('censys') || source.includes('shodan'))) return 1.08;
  return 1;
}

function isCriticalSector(sector: string | undefined): boolean {
  const normalized = normalizeText(sector);
  return CRITICAL_SECTOR_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function zoneKey(event: ThreatEvent): string {
  const label = normalizeText(event.location?.label);
  if (label) return label;
  const [lon, lat] = event.location.coordinates;
  return `${lon.toFixed(1)},${lat.toFixed(1)}`;
}

function computeThreatContribution(event: ThreatEvent, family: ScoredThreatFamily, daysOld: number): number {
  const base = FAMILY_BASE_WEIGHTS[family];
  const severity = SEVERITY_FACTORS[event.severity];
  const freshness = freshnessWeight(daysOld, family);
  const criticalSectorBoost = isCriticalSector(event.sector) ? 1.1 : 1;
  return base
    * severity
    * freshness
    * assetWeight(event, family)
    * sourceWeight(event, family)
    * criticalSectorBoost;
}

function computeLegacyFallbackScore(cyber: CyberState | null | undefined): number {
  if (!cyber) return 0;

  const certCritical = cyber.alerts.latest.filter((alert) => alert.severity === 'critical').length;
  const criticalCVEs = cyber.vulnerabilities.criticalCount;
  const ransomware30d = cyber.ransomware.total30d;
  const alertCount = cyber.alerts.count30d;

  return clamp(
    Math.min(certCritical * 8, 22)
      + Math.min(criticalCVEs * 2.2, 22)
      + Math.min(ransomware30d * 2.4, 24)
      + Math.min(alertCount * 1.4, 12),
  );
}

export function isRecentThreatEvent(event: ThreatEvent, days = 30): boolean {
  const ts = new Date(event.date).getTime();
  return Number.isFinite(ts) && Date.now() - ts <= days * DAY_MS;
}

export function isFranceThreatEvent(event: ThreatEvent): boolean {
  const countryCode = (event.countryCode || '').toUpperCase();
  const countryName = normalizeText(event.countryName);
  const domain = normalizeText(event.domain);
  const label = normalizeText(event.location?.label);

  return countryCode === 'FR'
    || countryName === 'france'
    || domain.endsWith('.fr')
    || label.includes('france')
    || label.includes('paris');
}

export function summarizeCyberThreatEvents(events: ThreatEvent[] = []): CyberThreatSummary {
  const recent = events.filter((event) => isRecentThreatEvent(event));
  const france = recent.filter(isFranceThreatEvent);

  return {
    total30d: recent.length,
    france30d: france.length,
    leaks30d: france.filter((event) => event.type === 'leak').length,
    ransomware30d: france.filter((event) => event.type === 'ransomware').length,
    exposure30d: france.filter((event) => event.type === 'exposure').length,
    vulnerability30d: france.filter((event) => event.type === 'vulnerability').length,
    critical30d: france.filter((event) => event.severity === 'critical').length,
    high30d: france.filter((event) => event.severity === 'high').length,
  };
}

function buildBreakdown(
  cyber: CyberState | null | undefined,
  threatEvents: ThreatEvent[],
  context: CyberPressureContext,
): {
  breakdown: CyberPressureBreakdownItem[];
  certCritical: number;
  criticalCVEs: number;
  dominantFamily: CyberSignalFamily | null;
} {
  const certCritical = cyber?.alerts.latest.filter((alert) => alert.severity === 'critical').length ?? 0;
  const criticalCVEs = cyber?.vulnerabilities.criticalCount ?? 0;

  const recentFranceEvents: ThreatFamilyEvent[] = threatEvents
    .filter(isFranceThreatEvent)
    .map((event) => {
      const daysOld = getDaysOld(event.date);
      return daysOld == null ? null : {
        event,
        family: familyFromType(event.type),
        daysOld,
      };
    })
    .filter((item): item is ThreatFamilyEvent => item !== null)
    .filter((item) => item.daysOld <= 180);

  const families: Record<ScoredThreatFamily, FamilyAccumulator> = {
    leaks: { raw: 0, count: 0 },
    ransomware: { raw: 0, count: 0 },
    vulnerabilities: { raw: 0, count: 0 },
    exposure: { raw: 0, count: 0 },
  };

  const zoneFamilies = new Map<string, Set<ScoredThreatFamily>>();
  let criticalSectorEvents = 0;
  let vulnerabilityCriticalEvents = 0;
  let ransomwareEvents30d = 0;

  for (const item of recentFranceEvents) {
    const contribution = computeThreatContribution(item.event, item.family, item.daysOld);
    families[item.family].raw += contribution;
    families[item.family].count += 1;

    const zone = zoneKey(item.event);
    const zoneFamilySet = zoneFamilies.get(zone) ?? new Set<ScoredThreatFamily>();
    zoneFamilySet.add(item.family);
    zoneFamilies.set(zone, zoneFamilySet);

    if (isCriticalSector(item.event.sector)) criticalSectorEvents += 1;
    if (item.family === 'vulnerabilities' && item.event.severity === 'critical') vulnerabilityCriticalEvents += 1;
    if (item.family === 'ransomware' && item.daysOld <= 30) ransomwareEvents30d += 1;
  }

  const legacyRansomwareGap = Math.max(0, (cyber?.ransomware.total30d ?? 0) - ransomwareEvents30d);
  const legacyCriticalCveGap = Math.max(0, criticalCVEs - vulnerabilityCriticalEvents);
  const legacyCertGap = Math.max(0, certCritical - vulnerabilityCriticalEvents);

  families.ransomware.raw += scaleCount(legacyRansomwareGap, 10, 6);
  families.vulnerabilities.raw += scaleCount(legacyCriticalCveGap, 8, 10);
  families.vulnerabilities.raw += scaleCount(legacyCertGap, 6, 6);

  const outagesObserved = (context.powerOutageCount ?? 0) + (context.telecomOutageCount ?? 0) + (context.cloudIncidentCount ?? 0);
  const stackedZones = Array.from(zoneFamilies.values()).filter((set) => set.size >= 2).length;

  const correlationRaw =
    scaleCount(stackedZones, 4, 7)
    + scaleCount(criticalSectorEvents, 8, 5)
    + (outagesObserved > 0 && criticalSectorEvents > 0 ? Math.min(3 + outagesObserved, 6) : 0);

  const breakdown: CyberPressureBreakdownItem[] = [
    {
      family: 'leaks',
      label: labelForFamily('leaks'),
      score: clamp(Math.min(FAMILY_CAPS.leaks, families.leaks.raw)),
      cap: FAMILY_CAPS.leaks,
      eventCount: families.leaks.count,
      explanation: `${families.leaks.count} fuite(s) récentes FrenchBreaches/HIBP, impact borné à ${FAMILY_CAPS.leaks} points.`,
    },
    {
      family: 'ransomware',
      label: labelForFamily('ransomware'),
      score: clamp(Math.min(FAMILY_CAPS.ransomware, families.ransomware.raw)),
      cap: FAMILY_CAPS.ransomware,
      eventCount: families.ransomware.count + legacyRansomwareGap,
      explanation: `${families.ransomware.count} événement(s) ransomware observés, complétés si besoin par le compteur 30j legacy, cap ${FAMILY_CAPS.ransomware}.`,
    },
    {
      family: 'vulnerabilities',
      label: labelForFamily('vulnerabilities'),
      score: clamp(Math.min(FAMILY_CAPS.vulnerabilities, families.vulnerabilities.raw)),
      cap: FAMILY_CAPS.vulnerabilities,
      eventCount: families.vulnerabilities.count + legacyCriticalCveGap + legacyCertGap,
      explanation: `${families.vulnerabilities.count} signal(aux) CERT/NVD pondérés par sévérité et fraîcheur, cap ${FAMILY_CAPS.vulnerabilities}.`,
    },
    {
      family: 'exposure',
      label: labelForFamily('exposure'),
      score: clamp(Math.min(FAMILY_CAPS.exposure, families.exposure.raw)),
      cap: FAMILY_CAPS.exposure,
      eventCount: families.exposure.count,
      explanation: `${families.exposure.count} exposition(s) Shodan/Censys, pondérées par actifs/CVE puis plafonnées à ${FAMILY_CAPS.exposure}.`,
    },
    {
      family: 'correlation',
      label: labelForFamily('correlation'),
      score: clamp(Math.min(FAMILY_CAPS.correlation, correlationRaw)),
      cap: FAMILY_CAPS.correlation,
      eventCount: stackedZones + criticalSectorEvents,
      explanation: `Bonus borné pour multi-signaux sur une même zone, secteurs critiques et corrélations avec pannes réseau/cloud.`,
    },
  ];

  const dominantFamily = [...breakdown]
    .sort((a, b) => b.score - a.score)[0]?.score
    ? [...breakdown].sort((a, b) => b.score - a.score)[0].family
    : null;

  return { breakdown, certCritical, criticalCVEs, dominantFamily };
}

export function computeCyberPressureAssessment(
  cyber: CyberState | null | undefined,
  threatEvents: ThreatEvent[] = [],
  context: CyberPressureContext = {},
): CyberPressureAssessment {
  const summary = summarizeCyberThreatEvents(threatEvents);
  const eventBackedSignals = summary.france30d > 0;
  const fallbackScore = computeLegacyFallbackScore(cyber);
  const { breakdown, certCritical, criticalCVEs, dominantFamily } = buildBreakdown(cyber, threatEvents, context);

  const eventScore = clamp(breakdown.reduce((sum, item) => sum + item.score, 0));
  const score = eventBackedSignals
    ? eventScore
    : clamp(Math.max(eventScore, fallbackScore));

  return {
    score,
    summary,
    certCritical,
    criticalCVEs,
    dominantFamily,
    breakdown,
  };
}
