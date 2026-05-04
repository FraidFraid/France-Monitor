import type { CyberState, ThreatEvent } from '../types/index.ts';

const DAY_MS = 24 * 60 * 60 * 1000;

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

export interface CyberPressureAssessment {
  score: number;
  summary: CyberThreatSummary;
  certCritical: number;
  criticalCVEs: number;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function isRecentThreatEvent(event: ThreatEvent, days = 30): boolean {
  const ts = new Date(event.date).getTime();
  return Number.isFinite(ts) && Date.now() - ts <= days * DAY_MS;
}

export function isFranceThreatEvent(event: ThreatEvent): boolean {
  const countryCode = (event.countryCode || '').toUpperCase();
  const countryName = (event.countryName || '').toLowerCase();
  const domain = (event.domain || '').toLowerCase();
  const label = (event.location?.label || '').toLowerCase();

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

export function computeCyberPressureAssessment(
  cyber: CyberState | null | undefined,
  threatEvents: ThreatEvent[] = [],
): CyberPressureAssessment {
  const summary = summarizeCyberThreatEvents(threatEvents);
  const certCritical = cyber?.alerts.latest.filter((alert) => alert.severity === 'critical').length ?? 0;
  const criticalCVEs = cyber?.vulnerabilities.criticalCount ?? 0;
  const legacyScore = cyber?.meta.globalScore ?? 0;
  const legacyRansomware = cyber?.ransomware.total30d ?? 0;

  const sourcePressure =
    Math.min(certCritical * 8, 24)
    + Math.min(criticalCVEs * 2.5, 18)
    + Math.min(Math.max(summary.ransomware30d, legacyRansomware) * 3, 30)
    + Math.min(summary.leaks30d * 1.2, 18)
    + Math.min(summary.exposure30d * 3, 18)
    + Math.min(summary.vulnerability30d * 2, 10)
    + Math.min(summary.critical30d * 5 + summary.high30d * 1.5, 20);

  const breadthBonus = summary.france30d >= 40 ? 8 : summary.france30d >= 20 ? 5 : summary.france30d >= 10 ? 3 : 0;

  return {
    score: clamp(Math.max(legacyScore * 0.55, sourcePressure) + breadthBonus),
    summary,
    certCritical,
    criticalCVEs,
  };
}
