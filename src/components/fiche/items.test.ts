import { describe, it, expect } from 'vitest';
import {
  buildEventFiche,
  buildMarketFiche,
  buildOfficialFiche,
  buildSituationFiche,
  buildThemeFiche,
  type ThemeFicheInput,
} from './items.ts';
import { renderFiche } from './parts.ts';
import { buildWorkQueue, officialAlertGroups, type WorkQueueInput } from '../../services/work-queue.ts';
import type {
  DetectedSituation,
  EcowattResponse,
  FranceCountrySignals,
  FranceIntelEnergySummary,
  NewsEvent,
  NewsEventDetail,
} from '../../types/index.ts';

const NOW = Date.parse('2026-09-24T08:00:00Z');
const visibleOf = (html: string): string => html.slice(0, html.indexOf('<details'));

function signals(over: Partial<FranceCountrySignals> = {}): FranceCountrySignals {
  return {
    criticalNews: 0, highNews: 0, topNewsCount: 0, meteoAlerts: 0, floodAlerts: 0, fireDetections: 0,
    railDisruptions: 0, railSevere: 0, roadIncidents: 0, powerOutages: 0, telecomOutages: 0,
    cyberAlerts: 0, cyberCritical: 0, militaryFlights: 0, maritimeTrafficFrance: 0,
    defenseAlerts: 0, defenseHigh: 0, jammingSignals: 0, marketStress: 0, ...over,
  };
}

function situation(over: Partial<DetectedSituation> = {}): DetectedSituation {
  return {
    id: 'energy-stress', type: 'ENERGY_STRESS', severity: 'high', confidence: 0.8, title: 'Tension énergétique nationale',
    summary: 'Signal Écowatt orange confirmé.', affectedZones: ['Bretagne'], drivers: [], recommendedActions: [],
    sourceRefs: ['Ecowatt RTE'], updatedAt: new Date(NOW), ...over,
  };
}

function event(over: Partial<NewsEvent> = {}): NewsEvent {
  return {
    id: 42, evidenceId: 'E42', title: 'Explosion dans une usine chimique', category: 'security', severity: 'critical',
    status: 'active', firstSeen: '2026-09-24T07:30:00Z', lastSeen: '2026-09-24T07:50:00Z', articleCount: 3,
    sourceCount: 3, independentCount: 3, sourceNames: ['France Info'], lat: 49.4, lon: 1.1, ...over,
  };
}

function ecowatt(signalsByRegion: EcowattResponse['signals']): EcowattResponse {
  const mix = { timestamp: new Date(0), nuclear: 0, wind: 0, solar: 0, hydro: 0, gas: 0, other: 0, total: 0 };
  return { signals: signalsByRegion, mixes: {}, national: mix, interconnections: [] };
}

function energy(): FranceIntelEnergySummary {
  return {
    ecowattSignal: 'green', totalMw: 53600, shares: { nuclear: 70, gas: 5, hydro: 10, wind: 8, solar: 4, other: 3 },
    nuclearStress: null, windGw: 4.2, windLoadFactor: 18, oilStocksDays: 46, oilVigilanceStatus: 'normal',
    fuelTensionLevel: 'LOW', fuelTensionAnomalyShare: 1, fuelPriceHistory: null,
  };
}

function queue(over: Partial<WorkQueueInput> = {}): ReturnType<typeof buildWorkQueue> {
  return buildWorkQueue({
    situations: [], alerts: [], events: null, ecowatt: null, meteo: [], floods: [], markets: [],
    baseline: null, firstSeen: new Map(), lang: 'fr', ...over,
  });
}

function themeInput(over: Partial<ThemeFicheInput> = {}): ThemeFicheInput {
  return {
    theme: 'energy', queue: queue(), snapshot: { signals: signals(), energy: null }, events: null,
    changeTimes: new Map(), freshness: '33 sources sur 35 à jour', whyOpen: false, lang: 'fr', ...over,
  };
}

describe('fiche thème', () => {
  it('rien à traiter : fiche verte et éléments suivis au vert (§7.4)', () => {
    const model = buildThemeFiche(themeInput({ queue: queue({ ecowatt: ecowatt({ '53': 'green' }) }) }));
    expect(model.kind).toBe('Thème');
    expect(model.name).toBe('Énergie');
    expect(model.level).toBe('vert');
    expect(model.essentiel).toEqual(['Rien à traiter. 1 élément suivi est au vert.']);
  });

  it('niveau et signaux officiels du thème, chiffres clés, éléments dans le volet', () => {
    const model = buildThemeFiche(themeInput({
      theme: 'environment',
      queue: queue({
        meteo: [{ department: 'Var', departmentCode: '83', level: 'yellow', risks: [] }],
        situations: [situation({ id: 'flood-crisis', type: 'FLOOD_CRISIS', severity: 'critical', title: 'Crise hydrologique active' })],
      }),
      snapshot: { signals: signals({ meteoAlerts: 3, floodAlerts: 2, fireDetections: 14 }), energy: null },
    }));
    expect(model.level).toBe('rouge');
    expect(model.driver).toBe('Crise hydrologique active');
    expect(model.figures.map((f) => f.value)).toEqual(['3', '2', '14']);
    expect(model.essentiel).toContain('Vigilance météo jaune.');
    const html = renderFiche(model, 'fr');
    expect(html).toContain('Météo-France');
    expect(visibleOf(html)).toContain('1 élément à traiter, dont 1 rouge.');
  });

  it('énergie : production, stocks et éolien en chiffres clés, bloc énergie dans le volet', () => {
    const model = buildThemeFiche(themeInput({ snapshot: { signals: signals(), energy: energy() } }));
    expect(model.figures.map((f) => f.label)).toEqual(['Production nationale', 'Stocks de carburant', 'Production éolienne']);
    expect(model.figures[1].value).toBe('46 j');
    expect(model.why).toContain('frintel-energy-stack');
  });
});

describe('fiche événement', () => {
  const detail = (over: Partial<NewsEventDetail> = {}): NewsEventDetail => ({
    event: event(),
    articles: [
      { id: 1, title: '<b>Explosion</b> près de Rouen', link: 'javascript:alert(1)', feedName: 'France Info', publishedAt: '2026-09-24T07:30:00Z' },
      { id: 2, title: 'Le PPI déclenché', link: 'https://example.org/ppi', feedName: 'Paris-Normandie', publishedAt: null },
    ],
    log: [
      { at: '2026-09-24T07:40:00Z', kind: 'escalated', from: 'medium', to: 'high' },
      { at: '2026-09-24T07:30:00Z', kind: 'created', from: null, to: 'medium' },
    ],
    ...over,
  });

  it('articles échappés, seuls les liens http(s) cliquables, journal en mots L1 (revue)', () => {
    const html = renderFiche(buildEventFiche({ event: event(), detail: detail(), whyOpen: false, lang: 'fr', now: NOW }), 'fr');
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('href="https://example.org/ppi"');
    expect(html).toContain('aggravé jaune → orange');
    expect(html).toContain('créé · jaune');
  });

  it('journal en chargement ou indisponible : dit en clair', () => {
    expect(buildEventFiche({ event: event(), detail: 'loading', whyOpen: false, lang: 'fr', now: NOW }).changesMeta).toBe('Chargement du journal…');
    expect(buildEventFiche({ event: event(), detail: 'error', whyOpen: false, lang: 'fr', now: NOW }).changesMeta).toBe('Journal indisponible pour le moment.');
  });

  it('aucun code de catégorie du moteur ; « Voir sur la carte » seulement pour un événement localisé', () => {
    const model = buildEventFiche({ event: event({ category: 'weather' }), detail: undefined, whyOpen: false, lang: 'fr', now: NOW });
    expect(model.kind).toBe('Événement · Environnement et transports');
    expect(renderFiche(model, 'fr')).not.toContain('weather');
    expect(model.actions.map((a) => a.id)).toEqual(['map']);
    expect(buildEventFiche({ event: event({ lat: null, lon: null }), detail: undefined, whyOpen: false, lang: 'fr', now: NOW }).actions).toEqual([]);
  });
});

describe('fiches situation et alerte (arbitrage A1)', () => {
  const cyber = situation({
    id: 'cyber-pressure', type: 'CYBER_PRESSURE', severity: 'high', confidence: 0.82, title: 'Pression cyber multi-source',
    summary: 'Baromètre cyber consolidé à 63/100, dominé par ransomware.',
    drivers: ['Score cyber consolidé : 63/100 (tendance stable)', 'Ransomware : 25/25', '2 alerte(s) critique(s) CERT-FR'],
    recommendedActions: [{ label: 'Consulter les bulletins CERT-FR', ownerHint: 'Analyste cyber', actionType: 'investigate', automatable: true }],
    sourceRefs: ['CERT-FR'],
  });

  // Fixture réaliste, au format exact de detectSocialEscalation (situation-engine.ts) : zones
  // « Nom (score/100) », phrase et facteur chiffrés (relecture finale I4).
  const social = situation({
    id: 'social-escalation', type: 'SOCIAL_ESCALATION', severity: 'high', confidence: 0.78, title: 'Escalade sociale localisée',
    summary: '5 département(s) avec tensions sociales ou sécuritaires élevées. Score national ISNR : 41/100.',
    affectedZones: ['Seine-Saint-Denis (72/100)', 'Bouches-du-Rhône (66/100)', 'Rhône (58/100)'],
    drivers: [
      '5 dept(s) avec dimension sociale/sécurité ≥ 40',
      'Score national ISNR : 41/100',
      '2 dept(s) en situation critique (score ≥ 65)',
    ],
    recommendedActions: [
      { label: 'Surveiller les flux RSS des PQR locales sur les départements actifs', ownerHint: 'Analyste OSINT', actionType: 'monitor', automatable: true },
    ],
    sourceRefs: ['ISNR (PQR + alertes)', 'Vigicrues', 'Vigilance météo'],
  });

  it('les sous-scores du moteur ne sont visibles que dans « Pourquoi ce niveau ? » (A7)', () => {
    for (const fixture of [cyber, social]) {
      const model = buildSituationFiche({
        situation: fixture, kind: 'situation', badge: null, changeAt: null, hasDossier: false, whyOpen: false, lang: 'fr',
      });
      expect(visibleOf(renderFiche(model, 'fr')), fixture.type).not.toMatch(/\d+\s*\/\s*\d+/);
    }
    const html = renderFiche(buildSituationFiche({
      situation: cyber, kind: 'situation', badge: null, changeAt: null, hasDossier: false, whyOpen: false, lang: 'fr',
    }), 'fr');
    const visible = visibleOf(html);
    expect(visible).toContain('2 alerte(s) critique(s) CERT-FR');
    expect(visible).toContain('Pression cyber multi-source : vigilance orange.');
    expect(visible).toContain('Consulter les bulletins CERT-FR');
    expect(visible).toContain('IA possible');
    expect(html).toContain('Score cyber consolidé : 63/100 (tendance stable)');
    expect(html).toContain('Ransomware : 25/25');
    expect(html).toContain('Confiance élevée (82 %)');
  });

  it('zones « Nom (n/m) » : le nom seul dans « Zones », les scores dans le volet (relecture finale I4)', () => {
    const model = buildSituationFiche({
      situation: social, kind: 'situation', badge: null, changeAt: null, hasDossier: false, whyOpen: false, lang: 'fr',
    });
    expect(model.sections.find((s) => s.title === 'Zones')?.html).toBe('<p>Seine-Saint-Denis · Bouches-du-Rhône · Rhône</p>');
    expect(model.why).toContain('<li>Seine-Saint-Denis : 72/100</li>');
    expect(model.why).toContain('<li>Rhône : 58/100</li>');
    expect(model.why).toContain('<li>Score national ISNR : 41/100</li>');
  });

  it('alerte : lien source http(s) seulement, dossier et carte quand ils existent', () => {
    const alert = situation({
      id: 'news-alert-1', type: 'NEWS_ALERT', linkUrl: 'https://example.org/a', linkLabel: 'Ouvrir l’article', lat: 49.4, lon: 1.1,
    });
    const model = buildSituationFiche({ situation: alert, kind: 'alert', badge: 'nouveau', changeAt: null, hasDossier: false, whyOpen: false, lang: 'fr' });
    expect(model.kind).toBe('Alerte');
    expect(model.sources[0]).toEqual({ label: 'Ouvrir l’article', href: 'https://example.org/a', select: null });
    expect(model.changes[0].text).toBe('Nouveau depuis votre visite');
    expect(model.actions.map((a) => a.id)).toEqual(['map']);
    const unsafe = buildSituationFiche({
      situation: { ...alert, linkUrl: 'javascript:alert(1)' }, kind: 'alert', badge: null, changeAt: null, hasDossier: false, whyOpen: false, lang: 'fr',
    });
    expect(unsafe.sources.some((s) => s.label === 'Ouvrir l’article')).toBe(false);
    const fire = buildSituationFiche({
      situation: situation({ id: 'wildfire-7', type: 'WILDFIRE_ESCALATION' }), kind: 'situation', badge: null, changeAt: null, hasDossier: true, whyOpen: false, lang: 'fr',
    });
    expect(fire.actions).toContainEqual({ id: 'dossier', label: 'Ouvrir le dossier d’incident' });
  });
});

describe('fiches alerte officielle et marché', () => {
  it('alerte officielle : détail par lieu échappé, violet compté rouge et dit dans le volet', () => {
    const [group] = officialAlertGroups(null, [{ department: '<Var>', departmentCode: '83', level: 'violet', risks: ['heat'] }], []);
    const html = renderFiche(buildOfficialFiche(group, { freshness: '', whyOpen: false, lang: 'fr' }), 'fr');
    expect(html).toContain('&lt;Var&gt; : Canicule');
    expect(html).toContain('<span class="fm-vig fm-vig--rouge">Rouge</span>');
    expect(html).toContain('Le violet de Météo-France compte comme rouge.');
    expect(html).toContain('data-action="show-layer"');
  });

  it('marché : jaune, seuil dit en clair', () => {
    const model = buildMarketFiche({ symbol: 'CAC40', name: 'CAC 40', price: 7212.5, changePercent: -3.42, kind: 'index' }, { whyOpen: false, lang: 'fr' });
    expect(model.level).toBe('jaune');
    expect(model.essentiel[0]).toBe('CAC 40 varie de −3,42 % sur la journée, au-delà du seuil de ±3 %.');
  });
});
