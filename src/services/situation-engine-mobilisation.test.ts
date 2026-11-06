// src/services/situation-engine-mobilisation.test.ts : situations SOCIAL_MOBILISATION et SECURITY_UNREST (26/10/2026, rejeu du 17/10 :
// docs/rejeu/constats-2026-10-26.md). Comptages d'événements distincts sur 12 h (24 h jusqu'au 06/11/2026) ; seuils
// 60/80/95 et 20/30/50 ; absence de comptage :
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
  ({ readAt: '2026-10-17T18:00:00.000Z', since: '2026-10-17T06:00:00.000Z', socialEvents12h: social, securityHighEvents12h: security });
const sit = (r: FranceRawData, id: string) => detectSituations(r, NOW).find((s) => s.id === id);

describe('mobilisation sociale étendue (événements sociaux distincts en 12 h)', () => {
  it('seuils 60 / 80 / 95 ; en dessous, rien', () => {
    expect(SOCIAL_MOBILISATION_THRESHOLDS).toEqual({ medium: 60, high: 80, critical: 95 });
    expect(sit(raw({ eventPressure: pressure(59, 0) }), 'social-mobilisation')).toBeUndefined();
    expect(sit(raw({ eventPressure: pressure(60, 0) }), 'social-mobilisation')?.severity).toBe('medium');
    expect(sit(raw({ eventPressure: pressure(80, 0) }), 'social-mobilisation')?.severity).toBe('high');
    expect(sit(raw({ eventPressure: pressure(95, 0) }), 'social-mobilisation')?.severity).toBe('critical');
  });
  it('texte : comptage, repère d’avant le mouvement, couche Manifestations ouverte', () => {
    const s = sit(raw({ eventPressure: pressure(82, 0) }), 'social-mobilisation');
    expect(s?.type).toBe('SOCIAL_MOBILISATION');
    expect(s?.title).toBe('Mobilisation sociale étendue');
    expect(s?.summary).toBe('82 événements sociaux distincts rapportés par la presse en 12 h (en temps calme : 34 à 48 sur 12 h).');
    expect(s?.activateLayers).toEqual(['protests']);
  });
});

describe('violences et troubles étendus (événements de sécurité élevés distincts en 12 h)', () => {
  it('seuils 20 / 30 / 50 ; en dessous, rien', () => {
    expect(SECURITY_UNREST_THRESHOLDS).toEqual({ medium: 20, high: 30, critical: 50 });
    expect(sit(raw({ eventPressure: pressure(0, 19) }), 'security-unrest')).toBeUndefined();
    expect(sit(raw({ eventPressure: pressure(0, 20) }), 'security-unrest')?.severity).toBe('medium');
    expect(sit(raw({ eventPressure: pressure(0, 30) }), 'security-unrest')?.severity).toBe('high');
    expect(sit(raw({ eventPressure: pressure(0, 56) }), 'security-unrest')?.severity).toBe('critical');
    expect(sit(raw({ eventPressure: pressure(0, 56) }), 'security-unrest')?.type).toBe('SECURITY_UNREST');
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
  // Plus forte fenêtre de 12 h de chaque journée (presse archivée, rejeu du 06/11/2026).
  it('journées du rejeu : calme sans effet ; 13/10 à 78 (une élevée) ; 19/10 à 65 (deux élevées) ; 17/10, 18/10 et 05/11 à 55 (une critique)', () => {
    const score = (social: number, security: number) => buildFranceCountrySnapshot(raw({ eventPressure: pressure(social, security) }), { now: NOW }).score;
    const calm = buildFranceCountrySnapshot(raw(), { now: NOW }).score;
    expect(score(48, 14)).toBe(calm);
    expect(score(82, 11)).toBe(Math.min(calm, 78));
    expect(score(84, 39)).toBe(Math.min(calm, 65));
    expect(score(97, 19)).toBe(Math.min(calm, 55));
    expect(score(57, 56)).toBe(Math.min(calm, 55));
    expect(score(155, 15)).toBe(Math.min(calm, 55));
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
