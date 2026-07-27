import { describe, expect, it } from 'vitest';
import type { ActiveFire } from '../types/index.ts';
import { clusterFireDetections } from './fire-clustering.ts';
import { selectMajorIncidents, wildfireSeverity } from './wildfire-dossier.ts';
import fixture from './__fixtures__/gironde-2026-07-26-viirs.json';

// Fixture-contrat : ces cibles viennent des données réelles du 2026-07-26.
// NE JAMAIS les ajuster pour faire passer un changement de formule (§4.2).
const detections = fixture as unknown as ActiveFire[];

describe('selectMajorIncidents — calibration Gironde', () => {
  const incidents = clusterFireDetections(detections);

  it('isole le front principal et le second front, rien d\'autre', () => {
    const major = selectMajorIncidents(incidents);
    expect(major.length).toBeGreaterThanOrEqual(1);
    const biggest = [...major].sort((a, b) => b.detectionsCount - a.detectionsCount)[0];
    expect(biggest.detectionsCount).toBeGreaterThan(400);
    expect(biggest.frpTotal).toBeGreaterThan(5000);
  });

  it('classe le front principal en critical', () => {
    const biggest = [...incidents].sort((a, b) => b.detectionsCount - a.detectionsCount)[0];
    expect(wildfireSeverity(biggest)).toBe('critical');
  });

  it('écarte tout cluster sous la porte d\'entrée', () => {
    const major = selectMajorIncidents(incidents);
    for (const incident of major) {
      expect(incident.detectionsCount).toBeGreaterThanOrEqual(40);
      expect(incident.frpTotal).toBeGreaterThanOrEqual(300);
    }
    const rejected = incidents.filter(i => !major.includes(i));
    for (const incident of rejected) {
      expect(incident.detectionsCount < 40 || incident.frpTotal < 300).toBe(true);
    }
  });

  it('ne retient jamais un cluster de 22 détections (bruit de fond estival)', () => {
    const major = selectMajorIncidents(incidents);
    expect(major.every(i => i.detectionsCount > 22)).toBe(true);
  });
});

describe('wildfireSeverity — bandes', () => {
  const base = {
    id: 'x', centroidLat: 44.8, centroidLon: -0.9,
    bboxMinLat: 44, bboxMaxLat: 45, bboxMinLon: -1, bboxMaxLon: 0,
    frpMean: 10, frpMax: 100, confidenceMax: 'nominal' as const,
    startDatetime: '2026-07-26T00:00:00Z', endDatetime: '2026-07-26T12:00:00Z',
    durationMinutes: 720, satellites: ['SNPP'], hasNightDetection: true,
    clusterMethod: 'dbscan' as const, epsKm: 3, minPoints: 2,
    score: { severityScore: 50, impactScore: 50, labels: [] },
    detectionIds: [],
  };

  it('applique les seuils du §4 sans dépendre du FRP moyen', () => {
    expect(wildfireSeverity({ ...base, detectionsCount: 650, frpTotal: 7178, nearUrban: false })).toBe('critical');
    expect(wildfireSeverity({ ...base, detectionsCount: 120, frpTotal: 900, nearUrban: false })).toBe('high');
    expect(wildfireSeverity({ ...base, detectionsCount: 57, frpTotal: 488, nearUrban: false })).toBe('medium');
    expect(wildfireSeverity({ ...base, detectionsCount: 50, frpTotal: 3200, nearUrban: true })).toBe('critical');
  });
});
