import { describe, it, expect } from 'vitest';
import { renderDomainsBlock, renderEnergyBlock, renderTimelineBlock } from './france-intel-blocks.ts';
import type { FranceCountrySignals, FranceIntelEnergySummary } from '../types/index.ts';

function signals(over: Partial<FranceCountrySignals> = {}): FranceCountrySignals {
  return {
    criticalNews: 0, highNews: 0, topNewsCount: 0, meteoAlerts: 0, floodAlerts: 0, fireDetections: 0,
    railDisruptions: 0, railSevere: 0, roadIncidents: 0, powerOutages: 0, telecomOutages: 0,
    cyberAlerts: 0, cyberCritical: 0, militaryFlights: 0, maritimeTrafficFrance: 0,
    defenseAlerts: 0, defenseHigh: 0, jammingSignals: 0, marketStress: 0, ...over,
  };
}

function energy(over: Partial<FranceIntelEnergySummary> = {}): FranceIntelEnergySummary {
  return {
    ecowattSignal: 'red', totalMw: 53600, shares: { nuclear: 70, gas: 5, hydro: 10, wind: 8, solar: 4, other: 3 },
    nuclearStress: null, windGw: 4.2, windLoadFactor: 18, oilStocksDays: 46, oilVigilanceStatus: 'tense',
    fuelTensionLevel: 'HIGH', fuelTensionAnomalyShare: 9.2, fuelPriceHistory: null, ...over,
  };
}

describe('blocs du tiroir en rendus purs (refonte UI étape 2)', () => {
  it('domaines : tuiles en casse normale et risques météo actifs', () => {
    const html = renderDomainsBlock({
      signals: signals({ cyberAlerts: 7, meteoAlerts: 2 }),
      meteo: [{ department: 'Var', departmentCode: '83', level: 'red', risks: ['heat'] }],
    }, 'fr');
    expect(html).toContain('>Domaines<');
    expect(html).toContain('Cyber');
    expect(html).toContain('Canicule · Rouge');
  });

  it('énergie : signal Écowatt en mot L1, carburants en pastille, statut inconnu jamais vert', () => {
    const html = renderEnergyBlock(energy(), 'fr');
    expect(html).toContain('Écowatt : signal rouge');
    expect(html).toContain('<span class="fm-vig fm-vig--orange">Orange</span>');
    expect(renderEnergyBlock(energy({ oilVigilanceStatus: 'unknown' }), 'fr')).toContain('color:var(--text-secondary);">46j');
    expect(renderEnergyBlock(null, 'fr')).toContain('Aucun profil énergie disponible.');
  });

  it('chronologie : jours et libellés échappés', () => {
    const html = renderTimelineBlock({
      days: ['<b>1 sept.</b>'],
      lanes: [{ key: 'social', label: '<i>Social</i>', color: '#ef4444', counts: [2] }],
    }, 'fr');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('<i>');
    expect(html).toContain('&lt;i&gt;Social&lt;/i&gt;');
  });
});
