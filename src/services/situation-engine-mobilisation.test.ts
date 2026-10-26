// src/services/situation-engine-mobilisation.test.ts : situations SOCIAL_MOBILISATION et SECURITY_UNREST (26/10/2026, rejeu du 17/10 :
// docs/rejeu/constats-2026-10-26.md). Comptages d'événements distincts sur 24 h ; seuils 90/110/160 et 25/40/70 ; absence de comptage :
// aucune situation ; plafonds de la note comme toute situation élevée ou critique.
import { describe, expect, it } from 'vitest';
import type { EventPressureResponse } from '../types/index.ts';
import { buildFranceCountrySnapshot, type FranceRawData } from './france-country-intel.ts';
import { SECURITY_UNREST_THRESHOLDS, SOCIAL_MOBILISATION_THRESHOLDS, detectSituations } from './situation-engine.ts';

const NOW = Date.parse('2026-10-17T18:09:00Z');
function raw(over: Partial<FranceRawData> = {}): FranceRawData {
  return {
    newsItems: [], isnrData: null, cyber: null, meteoAlerts: [], floodSegments: [], railTrains: [], roadEvents: [], urbanJamCount: 0,
    telecomOutages: null, cableAlerts: [], gnssDegraded: null, militaryFlightsCount: 0, maritimeCount: 0, activeFires: [],
    marketData: [], ecowattResponse: null, gasState: null, nuclearState: null, eolienLive: null, aisAnomalies: [], timeline: { days: [], lanes: [] },
    briefLang: 'fr', oilDashboard: null, fuelTensionDashboard: null, ...over,
  };
}
const pressure = (social: number, security: number): EventPressureResponse =>
  ({ readAt: '2026-10-17T18:00:00.000Z', since: '2026-10-16T18:00:00.000Z', socialEvents24h: social, securityHighEvents24h: security });
const sit = (r: FranceRawData, id: string) => detectSituations(r, NOW).find((s) => s.id === id);

describe('mobilisation sociale étendue (événements sociaux distincts en 24 h)', () => {
  it('seuils 90 / 110 / 160 ; en dessous, rien', () => {
    expect(SOCIAL_MOBILISATION_THRESHOLDS).toEqual({ medium: 90, high: 110, critical: 160 });
    expect(sit(raw({ eventPressure: pressure(89, 0) }), 'social-mobilisation')).toBeUndefined();
    expect(sit(raw({ eventPressure: pressure(90, 0) }), 'social-mobilisation')?.severity).toBe('medium');
    expect(sit(raw({ eventPressure: pressure(110, 0) }), 'social-mobilisation')?.severity).toBe('high');
    expect(sit(raw({ eventPressure: pressure(160, 0) }), 'social-mobilisation')?.severity).toBe('critical');
  });
  it('texte : comptage, repère d’avant le mouvement, couche Manifestations ouverte', () => {
    const s = sit(raw({ eventPressure: pressure(111, 0) }), 'social-mobilisation');
    expect(s?.type).toBe('SOCIAL_MOBILISATION');
    expect(s?.title).toBe('Mobilisation sociale étendue');
    expect(s?.summary).toBe('111 événements sociaux distincts rapportés par la presse en 24 h (avant le mouvement d\'octobre 2026 : 43 à 61 par jour).');
    expect(s?.activateLayers).toEqual(['protests']);
  });
});

describe('violences et troubles étendus (événements de sécurité élevés distincts en 24 h)', () => {
  it('seuils 25 / 40 / 70 ; en dessous, rien', () => {
    expect(SECURITY_UNREST_THRESHOLDS).toEqual({ medium: 25, high: 40, critical: 70 });
    expect(sit(raw({ eventPressure: pressure(0, 24) }), 'security-unrest')).toBeUndefined();
    expect(sit(raw({ eventPressure: pressure(0, 25) }), 'security-unrest')?.severity).toBe('medium');
    expect(sit(raw({ eventPressure: pressure(0, 40) }), 'security-unrest')?.severity).toBe('high');
    expect(sit(raw({ eventPressure: pressure(0, 76) }), 'security-unrest')?.severity).toBe('critical');
    expect(sit(raw({ eventPressure: pressure(0, 76) }), 'security-unrest')?.type).toBe('SECURITY_UNREST');
  });
});

describe('absence de comptage et effet sur la note', () => {
  it('comptage absent ou null : aucune des deux situations (jamais un comptage inventé)', () => {
    for (const r of [raw(), raw({ eventPressure: null })]) {
      const ids = detectSituations(r, NOW).map((s) => s.id);
      expect(ids).not.toContain('social-mobilisation');
      expect(ids).not.toContain('security-unrest');
    }
  });
  it('journées du rejeu : calme sans effet ; 17/10 plafonnée à 78 (une élevée) ; 19/10 à 65 (deux élevées) ; 18/10 à 55 (une critique)', () => {
    const score = (social: number, security: number) => buildFranceCountrySnapshot(raw({ eventPressure: pressure(social, security) }), { now: NOW }).score;
    const calm = buildFranceCountrySnapshot(raw(), { now: NOW }).score;
    expect(score(43, 15)).toBe(calm);
    expect(score(111, 24)).toBe(Math.min(calm, 78));
    expect(score(117, 51)).toBe(Math.min(calm, 65));
    expect(score(96, 76)).toBe(Math.min(calm, 55));
  });
});

describe('« Escalade sociale » sans effet sur la note (décision du 26/10/2026)', () => {
  it('affichée mais jamais comptée dans le plafond', async () => {
    const { SCORE_NEUTRAL_SITUATIONS, situationsForScore } = await import('./france-country-intel.ts');
    expect(SCORE_NEUTRAL_SITUATIONS.has('SOCIAL_ESCALATION')).toBe(true);
    const s = [{ type: 'SOCIAL_ESCALATION' as const, severity: 'high' }, { type: 'SOCIAL_MOBILISATION' as const, severity: 'high' }];
    expect(situationsForScore(s).map((x) => x.type)).toEqual(['SOCIAL_MOBILISATION']);
  });
});
