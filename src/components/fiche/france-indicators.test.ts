import { describe, it, expect } from 'vitest';
import { domainsSection, energySection, fuelSection, infraSection, timelineSection } from './france-indicators.ts';
import { formatFuelDeltaCents } from '../../utils/fuelPriceChart.ts';
import type { FranceCountrySignals, FranceIntelEnergySummary } from '../../types/index.ts';
import type { NetworkBarometerResult } from '../../services/network-barometer.ts';

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
    ecowattSignal: 'green', totalMw: 49305, shares: { nuclear: 62, gas: 5, hydro: 7, wind: 5, solar: 18, other: 2 },
    nuclearStress: null, windGw: 2.6, windLoadFactor: 13, oilStocksDays: 46, oilVigilanceStatus: 'tense',
    fuelTensionLevel: 'CRITICAL', fuelTensionAnomalyShare: 87.6, fuelPriceHistory: null, ...over,
  };
}

const barometer = (details: Record<string, number | null>): NetworkBarometerResult =>
  ({ score: 96, status: 'nominal', details, computedAt: new Date(0), reliable: true });

describe('Infrastructures (spec 2026-10-01 § 3.2)', () => {
  it('résumé : score et lignes sous 85 ; une ligne par source, note, bouton cyber national', () => {
    const s = infraSection({ result: barometer({ bgp: 100, elec: 100, telecom: 93, cloud: 99, space: 100, cyber: 43, wind: 40, cyberNational: 51 }), nuclear: null, eolien: null }, 'fr');
    expect(s.id).toBe('infra');
    expect(s.title).toBe('Infrastructures');
    expect(s.summary).toContain('fmk-dot--vert');
    expect(s.summary).toContain('<span class="fmk-num">96</span>/100 · 2 à surveiller');
    expect(s.html.match(/class="fmk-meter"/g)).toHaveLength(8);
    expect(s.html).toContain('Score de continuité borné.');
    expect(s.html).toContain('data-action="open-cyber"');
    expect(s.html).toContain('National 51/100');
  });

  it('nucléaire avec note : « 84 / 100 · écart REMIT »', () => {
    const s = infraSection({
      result: barometer({}), eolien: null,
      nuclear: {
        unavailabilities: [], remitSignals: [], unconfirmedSignals: [{ remitSignal: { id: 'x', plantName: 'Test', unitName: null, classifiedAs: 'OTHER', capacityMW: null, publishedAt: new Date(0), title: 't', link: '', confirmedByRTE: false, matchConfidence: 0.5 }, reason: 'test', confidence: 0.5 }], rteAvailable: true, remitAvailable: true,
        remitStatus: 'ok', fetchedAt: new Date(0),
        stress: { installedCapacityMW: 100, availableCapacityMW: 84, stressRatio: 0.16, level: 'TENSION', gridTensionRisk: false, updatedAt: new Date(0), freshness: 'quasi-realtime' },
      },
    }, 'fr');
    expect(s.html).toContain('>84 / 100 · écart REMIT</span>');
  });

  it('baromètre pas encore reçu : « en attente », jamais « indisponible »', () => {
    const s = infraSection({ result: null, nuclear: null, eolien: null }, 'fr');
    expect(s.summary).toBe('en attente');
    expect(s.html).toContain('Chargement du baromètre des infrastructures…');
    expect(s.html + s.summary).not.toContain('indisponible');
    expect(infraSection(null, 'fr').summary).toBe('en attente');
  });
});

describe('Domaines', () => {
  it('résumé par niveau, grille de 8 domaines, étiquettes', () => {
    const s = domainsSection({
      signals: signals({ cyberAlerts: 24, cyberCritical: 20, railDisruptions: 215, railSevere: 159, militaryFlights: 36 }),
      meteo: [{ department: 'Var', departmentCode: '83', level: 'yellow', risks: ['thunderstorm'] }],
    }, 'fr');
    expect(s.summary).toContain('fmk-dot--orange');
    expect(s.summary).toContain('fmk-dot--jaune');
    expect(s.summary).toContain('fmk-dot--vert');
    expect(s.html.match(/class="fmk-domain"/g)).toHaveLength(8);
    expect(s.html).toContain('alertes 30j · 20 CVE');
    expect(s.html).toContain('<span class="fmk-tag fmk-tag--warn">Orages · Jaune</span>');
    expect(s.html).toContain('<span class="fmk-tag fmk-tag--warn">159 SNCF fortes</span>');
  });
});

describe('Énergie', () => {
  it('résumé Écowatt et production ; mix, légende française, production, éolien', () => {
    const s = energySection(energy(), 'fr');
    expect(s.summary).toBe('Écowatt vert · 49\u202f305 MW');
    expect(s.html).toContain('class="fmk-mix"');
    expect(s.html).toContain('Nucléaire 62 % · Gaz 5 % · Hydraulique 7 % · Éolien 5 % · Solaire 18 % · Autre 2 %');
    expect(s.html).toContain('Production totale');
    expect(s.html).toContain('2,6 GW · charge 13 %');
  });

  it('sans profil : « données partielles », message sobre', () => {
    const s = energySection(null, 'fr');
    expect(s.summary).toBe('données partielles');
    expect(s.html).toContain('Aucun profil énergie disponible.');
  });

  it('données manquantes : « — »', () => {
    expect(energySection(energy({ totalMw: null, windGw: null, windLoadFactor: null, ecowattSignal: null }), 'fr').summary).toBe('données partielles');
    expect(energySection(energy({ windGw: null }), 'fr').html).toContain('—');
  });
});

describe('Carburants', () => {
  it('résumé : tension et stocks ; stocks colorés, tension, anomalies', () => {
    const s = fuelSection(energy(), 'fr');
    expect(s).not.toBeNull();
    expect(s?.summary).toContain('fm-vig--rouge');
    expect(s?.summary).toContain('stocks 46 j');
    expect(s?.html).toContain('46 j · Sous tension');
    expect(s?.html).toContain('87,6 % d’anomalies');
  });

  it('prix et courbe 30 jours quand l’historique existe', () => {
    const s = fuelSection(energy({
      fuelPriceHistory: {
        provider: 'carbu', generatedAt: '2026-10-01T00:00:00Z', sourceLabel: 'test', rangeStart: '2026-09-01T00:00:00Z', rangeEnd: '2026-10-01T00:00:00Z',
        series: [{
          fuelType: 'gazole', label: 'Gazole (B7)', color: '#f59e0b', latestPrice: 2.337, delta7dCents: -6.3, delta30dCents: -1,
          points: [{ timestamp: '2026-09-20T00:00:00Z', price: 2.4 }, { timestamp: '2026-10-01T00:00:00Z', price: 2.337 }],
        }],
      },
    }), 'fr');
    expect(s?.html).toContain('Gazole (B7)');
    expect(s?.html).toContain('2,337 €/L');
    expect(s?.html).toContain(`7 j ${formatFuelDeltaCents(-6.3)}`);
    expect(s?.html).toContain('<svg');
    expect(s?.html).toContain('Prix moyens · 30 jours');
  });

  it('aucune donnée carburant : pas de section', () => {
    expect(fuelSection(energy({ oilStocksDays: null, fuelTensionLevel: null, fuelPriceHistory: null }), 'fr')).toBeNull();
    expect(fuelSection(null, 'fr')).toBeNull();
  });
});

describe('Chronologie 7 jours', () => {
  it('résumé : pic du domaine et du jour ; cases avec valeur', () => {
    const s = timelineSection({
      days: ['30 sept.', '1 oct.'],
      lanes: [
        { key: 'weather', label: 'Météo', color: '#eab308', counts: [0, 10] },
        { key: 'transport', label: 'Transport', color: '#3b82f6', counts: [3, 215] },
      ],
    }, 'fr');
    expect(s.summary).toBe('pic transport le 1 oct.');
    expect(s.html).toContain('class="fmk-heat"');
    expect(s.html).toContain('>215<');
  });

  it('rien sur 7 jours : « calme » et message', () => {
    const s = timelineSection({ days: [], lanes: [] }, 'fr');
    expect(s.summary).toBe('calme');
    expect(s.html).toContain('Aucun signal sur 7 jours.');
  });
});
