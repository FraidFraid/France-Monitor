import { describe, expect, it } from 'vitest';
import type { ActiveFire, FireIncident, ImpactFact } from '../types/index.ts';
import { clusterFireDetections } from './fire-clustering.ts';
import { buildDossier, gradeCredibility, selectMajorIncidents, wildfireSeverity } from './wildfire-dossier.ts';
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

function fact(over: Partial<ImpactFact> = {}): ImpactFact {
  return {
    id: 1, kind: 'area_ha', value: 42000, unit: 'ha',
    quote: '42 000 hectares de forêt ont été détruits',
    sourceUrl: 'https://www.sudouest.fr/a/1', sourceName: 'Sud Ouest',
    sourceLevel: 'secondary', reliability: 'D',
    hedged: false, provisional: true,
    observedAt: '2026-07-26T08:00:00Z', communes: [],
    ...over,
  };
}

const INCIDENT = {
  id: 'gironde', centroidLat: 44.78, centroidLon: -0.93,
  bboxMinLat: 44.37, bboxMaxLat: 44.97, bboxMinLon: -1.22, bboxMaxLon: -0.61,
  detectionsCount: 650, frpMean: 11, frpMax: 222, frpTotal: 7178,
  confidenceMax: 'high' as const,
  startDatetime: '2026-07-26T01:32:00Z', endDatetime: '2026-07-26T12:55:00Z',
  durationMinutes: 683, satellites: ['SNPP', 'NOAA-20'], hasNightDetection: true,
  nearUrban: true, clusterMethod: 'dbscan' as const, epsKm: 3, minPoints: 2,
  score: { severityScore: 90, impactScore: 80, labels: [] }, detectionIds: [],
} satisfies FireIncident;

describe('gradeCredibility', () => {
  it('note 1 une source primaire corroborée, 3 une primaire isolée', () => {
    const official = fact({ sourceLevel: 'primary', reliability: 'A' });
    expect(gradeCredibility(official, ['Préfecture', 'Sud Ouest'])).toBe(1);
    expect(gradeCredibility(official, ['Préfecture'])).toBe(3);
  });

  it('note 2 une info corroborée sans source primaire, 4 une secondaire isolée', () => {
    expect(gradeCredibility(fact(), ['Sud Ouest', 'France Info'])).toBe(2);
    expect(gradeCredibility(fact(), ['Sud Ouest'])).toBe(4);
  });

  it('dégrade en 5 une formulation approximative isolée', () => {
    expect(gradeCredibility(fact({ hedged: true }), ['Sud Ouest'])).toBe(5);
  });

  it('note 6 un fait tertiaire isolé — ne peut être jugé', () => {
    expect(gradeCredibility(fact({ sourceLevel: 'tertiary' }), ['Wikipédia'])).toBe(6);
  });
});

describe('buildDossier', () => {
  it('conserve DEUX valeurs divergentes sans les réconcilier (§12.4)', () => {
    const dossier = buildDossier(INCIDENT, [
      fact({ id: 1, value: 32000, observedAt: '2026-07-25T12:00:00Z' }),
      fact({ id: 2, value: 42000, observedAt: '2026-07-26T08:00:00Z' }),
    ], ['33']);
    expect(dossier.series.area_ha).toHaveLength(2);
    expect(dossier.series.area_ha.map(f => f.value)).toEqual([32000, 42000]);
    // aucune propriété n'expose une valeur unique réconciliée
    expect(Object.keys(dossier)).not.toContain('currentAreaHa');
    expect(Object.keys(dossier)).not.toContain('latestAreaHa');
  });

  it('ordonne chaque série chronologiquement', () => {
    const dossier = buildDossier(INCIDENT, [
      fact({ id: 2, value: 42000, observedAt: '2026-07-26T08:00:00Z' }),
      fact({ id: 1, value: 32000, observedAt: '2026-07-25T12:00:00Z' }),
    ], ['33']);
    expect(dossier.series.area_ha.map(f => f.observedAt))
      .toEqual(['2026-07-25T12:00:00Z', '2026-07-26T08:00:00Z']);
  });

  it('ne compte qu\'une corroboration pour deux reprises de la même source', () => {
    const dossier = buildDossier(INCIDENT, [
      fact({ id: 1, sourceName: 'Sud Ouest', sourceUrl: 'https://www.sudouest.fr/a/1' }),
      fact({ id: 2, sourceName: 'Sud Ouest', sourceUrl: 'https://www.sudouest.fr/a/2' }),
    ], ['33']);
    expect(dossier.series.area_ha[0].corroboration).toEqual(['Sud Ouest']);
    expect(dossier.series.area_ha[0].credibility).toBe(4); // isolée, pas corroborée
  });

  it('rejette un fait sans provenance complète plutôt que de l\'afficher', () => {
    const dossier = buildDossier(INCIDENT, [
      fact({ id: 1 }),
      fact({ id: 2, quote: '' }),
      fact({ id: 3, sourceUrl: '' }),
      fact({ id: 4, observedAt: '' }),
    ], ['33']);
    expect(dossier.facts.map(f => f.id)).toEqual([1]);
  });

  it('rejette un fait dont l\'horodatage est illisible', () => {
    const dossier = buildDossier(INCIDENT, [
      fact({ id: 1 }),
      fact({ id: 2, observedAt: 'hier' }),
      fact({ id: 3, observedAt: '2026-13-45T99:99:99Z' }),
    ], ['33']);
    expect(dossier.facts.map(f => f.id)).toEqual([1]);
  });

  it('porte plusieurs départements et agrège les communes sans doublon', () => {
    const dossier = buildDossier(INCIDENT, [
      fact({ id: 1, communes: ['Le Porge', 'Lanton'] }),
      fact({ id: 2, value: 3500, communes: ['Lanton', 'Biscarrosse'] }),
    ], ['33', '40']);
    expect(dossier.deptCodes).toEqual(['33', '40']);
    expect(dossier.communes).toEqual(['Biscarrosse', 'Lanton', 'Le Porge']);
  });

  it('trie deptCodes après dédoublonnage, comme communes', () => {
    const dossier = buildDossier(INCIDENT, [fact({ id: 1 })], ['40', '33']);
    expect(dossier.deptCodes).toEqual(['33', '40']);
  });

  it('reporte la sévérité de l\'incident, indépendante des faits déclarés (§12.5)', () => {
    expect(buildDossier(INCIDENT, [], ['33']).severity).toBe('critical');
  });

  it('rejette un fait dont communes n\'est pas un tableau (absent, null, chaîne), sans faire tomber ses voisins', () => {
    const noCommunes = fact({ id: 1, communes: undefined as unknown as string[] });
    const nullCommunes = fact({ id: 2, value: 3500, communes: null as unknown as string[] });
    const stringCommunes = fact({ id: 3, value: 5000, communes: 'Le Porge' as unknown as string[] });
    const valid = fact({ id: 4, value: 6000, communes: ['Biscarrosse'] });

    let dossier: ReturnType<typeof buildDossier> | undefined;
    expect(() => {
      dossier = buildDossier(INCIDENT, [noCommunes, nullCommunes, stringCommunes, valid], ['33']);
    }).not.toThrow();

    expect(dossier?.facts.map(f => f.id)).toEqual([4]);
    expect(dossier?.communes).toEqual(['Biscarrosse']);
  });
});
