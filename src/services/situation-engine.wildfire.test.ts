import { describe, expect, it, vi } from 'vitest';
import type { LocatedFireIncident } from '../types/index.ts';
import type { FranceRawData } from './france-country-intel.ts';
import { detectSituations, detectWildfireIncidents } from './situation-engine.ts';

function incident(over: Partial<LocatedFireIncident> & { id: string }): LocatedFireIncident {
  return {
    centroidLat: 44.78, centroidLon: -0.93,
    bboxMinLat: 44.7, bboxMaxLat: 44.9, bboxMinLon: -1.0, bboxMaxLon: -0.8,
    detectionsCount: 650, frpMean: 11, frpMax: 222, frpTotal: 7178,
    confidenceMax: 'high', startDatetime: '2026-07-26T01:32:00Z',
    endDatetime: '2026-07-26T12:55:00Z', durationMinutes: 683,
    satellites: ['SNPP'], hasNightDetection: true, nearUrban: true,
    clusterMethod: 'dbscan', epsKm: 3, minPoints: 2,
    score: { severityScore: 90, impactScore: 80, labels: [] },
    detectionIds: [],
    deptCodes: ['33'],
    communes: ['Lanton'],
    ...over,
  } as LocatedFireIncident;
}

function raw(incidents: LocatedFireIncident[]): FranceRawData {
  return { activeFires: [], fireIncidents: incidents, meteoAlerts: [] } as unknown as FranceRawData;
}

describe('detectWildfireIncidents', () => {
  it('émet UNE situation par incident majeur, localisée', () => {
    const situations = detectWildfireIncidents(raw([
      incident({ id: 'front-principal' }),
      incident({ id: 'second-front', detectionsCount: 57, frpTotal: 488 }),
    ]));
    expect(situations).toHaveLength(2);
    expect(situations.map(s => s.severity)).toEqual(['critical', 'medium']);
    for (const situation of situations) {
      expect(situation.type).toBe('WILDFIRE_ESCALATION');
      // Le défaut corrigé : plus jamais ['France'] (§1.3)
      expect(situation.affectedZones).not.toEqual(['France']);
      expect(situation.affectedZones.length).toBeGreaterThan(0);
      expect(situation.id).toContain('wildfire');
    }
  });

  it('n\'émet rien sous la porte d\'entrée, même avec beaucoup de petits foyers', () => {
    const petits = Array.from({ length: 30 }, (_, i) =>
      incident({ id: `petit-${i}`, detectionsCount: 22, frpTotal: 361 }));
    expect(detectWildfireIncidents(raw(petits))).toEqual([]);
  });

  it('donne des identifiants stables et distincts', () => {
    const situations = detectWildfireIncidents(raw([
      incident({ id: 'a' }), incident({ id: 'b', detectionsCount: 120, frpTotal: 900 }),
    ]));
    expect(new Set(situations.map(s => s.id)).size).toBe(2);
    const again = detectWildfireIncidents(raw([incident({ id: 'a' })]));
    expect(again[0].id).toBe(situations[0].id);
  });

  it('n\'invente aucun chiffre d\'impact dans le résumé', () => {
    const [situation] = detectWildfireIncidents(raw([incident({ id: 'a' })]));
    expect(situation.summary).not.toMatch(/hectare/i);
    expect(situation.summary).not.toMatch(/[ée]vacu/i);
  });

  it('n\'applique elle-même aucun plafond (le plafond vit dans detectSituations)', () => {
    const incidents = Array.from({ length: 14 }, (_, i) =>
      incident({ id: `front-${i}`, detectionsCount: 650, frpTotal: 7178 }));
    const situations = detectWildfireIncidents(raw(incidents));
    expect(situations).toHaveLength(14);
    expect(situations.every(s => s.severity === 'critical')).toBe(true);
  });

  it('journalise la troncature du plafond de 10 au lieu de la taire', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const incidents = Array.from({ length: 14 }, (_, i) =>
      incident({ id: `front-${i}`, detectionsCount: 650, frpTotal: 7178 }));
    const situations = detectSituations(raw(incidents));
    expect(situations).toHaveLength(10);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('tronqu'));
    warn.mockRestore();
  });
});
