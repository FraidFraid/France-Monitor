// tests/france-intel-brief-oil.test.ts
// Pétrole (16/10/2026) : sans stocks stratégiques connus, l'indice pétrole est « unknown » ; la note ne doit jamais l'écrire.
import { describe, it, expect } from 'vitest';
import { buildPrompt } from '../api/_handlers/intelligence/v1/france-intel-brief.js';

const signals = { criticalNews: 0, highNews: 0, weatherAlerts: 0, floodAlerts: 0, fireDetections: 0, railDisruptions: 0, roadIncidents: 0, telecomOutages: 0, cyberAlerts: 0, militaryFlights: 0, maritimeTrafficFrance: 0, defenseAlerts: 0, jammingSignals: 0, financeLevel: null };
const axes = { continuity: 30, defense: 5, security: 20, signal: 10 };
const isnr = { social: 0, security: 0, infra: 0 };

describe('note de situation : indice pétrole inconnu', () => {
  it('une tension énergie réelle (Écowatt rouge) ne cite pas « pétrole unknown »', () => {
    for (const lang of ['fr', 'en'] as const) {
      const p = buildPrompt(72, axes, isnr, 0, 0, [], signals, { ecowattSignal: 'red', oilVigilanceStatus: 'unknown' }, [], [], lang);
      expect(p).toMatch(/Ecowatt (rouge|red)/);
      expect(p).not.toMatch(/unknown/);
    }
  });
  it('un indice pétrole sous tension reste cité', () => {
    const p = buildPrompt(72, axes, isnr, 0, 0, [], signals, { ecowattSignal: 'red', oilVigilanceStatus: 'critical' }, [], [], 'fr');
    expect(p).toContain('pétrole critical');
  });
});
