import assert from 'node:assert/strict';

import type { CyberState, ThreatEvent } from '../types/index.ts';
import { computeCyberPressureAssessment } from './cyber-threat-scoring.ts';

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function makeCyberState(overrides: Partial<CyberState> = {}): CyberState {
  return {
    meta: {
      globalScore: 0,
      trend: 'stable',
      sources: [],
      lastUpdate: new Date(),
    },
    alerts: {
      count30d: 0,
      latest: [],
    },
    ransomware: {
      total30d: 0,
      topSectors: [],
    },
    vulnerabilities: {
      criticalCount: 0,
      topCVEs: [],
    },
    ...overrides,
  };
}

function makeThreatEvent(
  id: string,
  type: ThreatEvent['type'],
  severity: ThreatEvent['severity'],
  date: string,
  overrides: Partial<ThreatEvent> = {},
): ThreatEvent {
  return {
    id,
    type,
    organizationName: 'France Org',
    countryCode: 'FR',
    countryName: 'France',
    sourceLabel: 'Test Source',
    location: {
      label: 'Paris',
      coordinates: [2.3522, 48.8566],
      precision: 'city',
    },
    severity,
    confidence: 'high',
    sector: 'Informatique',
    date,
    summary: 'Test event',
    sources: [{ name: 'Test Source', observedAt: new Date().toISOString() }],
    ...overrides,
  };
}

export async function runCyberThreatScoringTests(): Promise<void> {
  const noSignal = computeCyberPressureAssessment(null, []);
  assert.equal(noSignal.score, 0);

  const ransomwareOnly = computeCyberPressureAssessment(null, [
    makeThreatEvent('ran-1', 'ransomware', 'high', daysAgo(1)),
    makeThreatEvent('ran-2', 'ransomware', 'critical', daysAgo(5), { sector: 'Santé' }),
  ]);
  assert.ok(ransomwareOnly.score >= 15, `expected ransomware-only score to be visible, got ${ransomwareOnly.score}`);
  assert.ok(ransomwareOnly.score < 100, `ransomware-only score should not saturate, got ${ransomwareOnly.score}`);

  const exposureOnly = computeCyberPressureAssessment(null, [
    makeThreatEvent('exp-1', 'exposure', 'medium', daysAgo(1), {
      sourceLabel: 'Shodan InternetDB',
      metrics: { affectedAssets: 40, sources: 1 },
      compromisedData: ['CVE-2026-1111', 'CVE-2026-2222'],
    }),
    makeThreatEvent('exp-2', 'exposure', 'high', daysAgo(3), {
      sourceLabel: 'Censys Search API',
      metrics: { affectedAssets: 120, sources: 1 },
      sector: 'Collectivités',
    }),
  ]);
  assert.ok(exposureOnly.score >= 8, `expected exposure-only score to be visible, got ${exposureOnly.score}`);
  assert.ok(exposureOnly.score < ransomwareOnly.score + 25, `exposure-only score should stay bounded, got ${exposureOnly.score}`);
  assert.ok(exposureOnly.score < 100);

  const combinedPressure = computeCyberPressureAssessment(makeCyberState({
    alerts: {
      count30d: 2,
      latest: [
        { id: 'cert-1', title: 'CERT critical', severity: 'critical', url: '#', date: daysAgo(1), source: 'CERT-FR' },
      ],
    },
    vulnerabilities: {
      criticalCount: 4,
      topCVEs: [],
    },
  }), [
    makeThreatEvent('leak-1', 'leak', 'high', daysAgo(2), { sourceLabel: 'FrenchBreaches Map', sector: 'Collectivités' }),
    makeThreatEvent('leak-2', 'leak', 'medium', daysAgo(4), { sourceLabel: 'FrenchBreaches Map', sector: 'Santé' }),
    makeThreatEvent('ran-3', 'ransomware', 'critical', daysAgo(2), { sourceLabel: 'RansomwareLive', sector: 'Énergie' }),
    makeThreatEvent('vuln-1', 'vulnerability', 'critical', daysAgo(1), { sourceLabel: 'CERT-FR', sector: 'Transport' }),
  ], {
    telecomOutageCount: 2,
    cloudIncidentCount: 1,
  });
  assert.ok(combinedPressure.score >= 55, `expected combined score to be strong, got ${combinedPressure.score}`);
  assert.ok(combinedPressure.score < 100, `combined score should remain capped below instant saturation, got ${combinedPressure.score}`);
  assert.ok(combinedPressure.breakdown.some((item) => item.family === 'correlation' && item.score > 0));

  const staleSignals = computeCyberPressureAssessment(null, [
    makeThreatEvent('old-ran', 'ransomware', 'critical', daysAgo(65)),
    makeThreatEvent('fresh-ran', 'ransomware', 'critical', daysAgo(2)),
  ]);
  assert.ok(staleSignals.score > 0);
  const onlyOldSignals = computeCyberPressureAssessment(null, [
    makeThreatEvent('only-old-ran', 'ransomware', 'critical', daysAgo(65)),
  ]);
  assert.ok(onlyOldSignals.score < staleSignals.score, `expected stale-only score < mixed score (${onlyOldSignals.score} vs ${staleSignals.score})`);

  const legacyFallback = computeCyberPressureAssessment(makeCyberState({
    meta: { globalScore: 72, trend: 'rising', sources: [], lastUpdate: new Date() },
    alerts: {
      count30d: 4,
      latest: [{ id: 'cert-legacy', title: 'Critical advisory', severity: 'critical', url: '#', date: daysAgo(1), source: 'CERT-FR' }],
    },
    ransomware: { total30d: 9, topSectors: [] },
    vulnerabilities: { criticalCount: 3, topCVEs: [] },
  }), []);
  assert.ok(legacyFallback.score >= 25, `legacy-only fallback should stay active when new events are absent, got ${legacyFallback.score}`);

  console.log('ok - cyber threat scoring');
}
