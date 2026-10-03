// src/components/fiche/items-health.test.ts
import { describe, expect, it } from 'vitest';
import type { FranceCountrySignals } from '../../types/index.ts';
import { buildWorkQueue } from '../../services/work-queue.ts';
import { HEALTH_NOW, surveillanceFixture } from '../layer-panel/health.fixture.ts';
import { NBSP } from '../layer-panel/format.ts';
import { nationalSummary } from '../layer-panel/veille.ts';
import { buildThemeFiche, type ThemeFicheInput } from './items.ts';

function signals(): FranceCountrySignals {
  return {
    criticalNews: 0, highNews: 0, topNewsCount: 0, meteoAlerts: 0, floodAlerts: 0, fireDetections: 0,
    railDisruptions: 0, railSevere: 0, roadIncidents: 0, powerOutages: 0, telecomOutages: 0,
    cyberAlerts: 0, cyberCritical: 0, militaryFlights: 0, maritimeTrafficFrance: 0,
    defenseAlerts: 0, defenseHigh: 0, jammingSignals: 0, marketStress: 0,
  };
}

function input(over: Partial<ThemeFicheInput> = {}): ThemeFicheInput {
  return {
    theme: 'health',
    queue: buildWorkQueue({ situations: [], alerts: [], events: null, ecowatt: null, meteo: [], floods: [], markets: [], baseline: null, firstSeen: new Map(), lang: 'fr' }),
    snapshot: { signals: signals(), energy: null }, events: null, changeTimes: new Map(), freshness: '', sectionOpen: new Map(),
    now: HEALTH_NOW, ready: true, lang: 'fr', ...over,
  };
}

describe('fiche thème Santé (spec 2026-10-03 § 3.5)', () => {
  it('niveau national et ses quatre entrées datées, liens d’ouverture des quatre panneaux', () => {
    const html = buildThemeFiche(input({ health: nationalSummary(surveillanceFixture(), HEALTH_NOW) })).sections[0].html;
    expect(html).toContain('Niveau national de santé');
    expect(html).toMatch(/fm-vig--jaune[^]*eaux usées en forte hausse/);
    expect(html).toMatch(/fmk-dot--jaune[^]*Alertes épidémiques \(grippe, bronchiolite\) : hors saison · S39/);
    expect(html).toContain('Médecine générale (Sentinelles) : activité faible · S39');
    expect(html).toContain(`Urgences, gastro-entérite : 1,10${NBSP}% des passages · S39`);
    expect(html).toContain('Eaux usées, COVID-19 : ×2 en 2 semaines · S38');
    for (const key of ['health', 'healthOscour', 'healthApl', 'hospitals']) expect(html).toContain(`data-action="open-layer:${key}"`);
    expect(html).not.toMatch(/\u2014|&mdash;/);
  });
  it('veille pas encore chargée : chargement dit, liens présents ; les autres thèmes n’ont pas ces liens', () => {
    const html = buildThemeFiche(input()).sections[0].html;
    expect(html).toContain('Données de santé en chargement…');
    expect(html).toContain('data-action="open-layer:hospitals"');
    expect(buildThemeFiche(input({ theme: 'energy' })).sections[0].html).not.toContain('open-layer:');
  });
});
