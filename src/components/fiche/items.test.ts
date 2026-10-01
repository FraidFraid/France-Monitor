import { describe, it, expect } from 'vitest';
import {
  buildEventFiche,
  buildMarketFiche,
  buildOfficialFiche,
  buildSituationFiche,
  buildThemeFiche,
  type EventFicheInput,
  type ThemeFicheInput,
} from './items.ts';
import { renderFiche, type FicheModel } from './parts.ts';
import { buildWorkQueue, officialAlertGroups, type WorkQueueInput } from '../../services/work-queue.ts';
import type {
  DetectedSituation,
  EcowattHourValue,
  EcowattResponse,
  EcowattSignal,
  FranceCountrySignals,
  FranceIntelEnergySummary,
  NewsEvent,
  NewsEventDetail,
} from '../../types/index.ts';
import { parisDate } from '../../services/ecowatt-official.ts';

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

// Écowatt est un signal NATIONAL (RTE) : le jour est ancré sur l'horloge réelle (Europe/Paris),
// comme dans work-queue.ts (officialEntries → ecowattToday(ecowatt?.official, Date.now())).
function ecowatt(level: EcowattSignal): EcowattResponse {
  const mix = { timestamp: new Date(0), nuclear: 0, wind: 0, solar: 0, hydro: 0, gas: 0, other: 0, total: 0 };
  const hourValue: EcowattHourValue = level === 'green' ? 1 : level === 'orange' ? 2 : 3;
  return {
    official: {
      source: 'rte',
      generatedAt: new Date(NOW).toISOString(),
      days: [{ date: parisDate(Date.now()), level, message: '', hours: Array(24).fill(hourValue) as EcowattHourValue[] }],
    },
    mixes: {}, national: mix, interconnections: [],
  };
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
    changeTimes: new Map(), freshness: '33 sources sur 35 à jour', whyOpen: false, ready: true, lang: 'fr', ...over,
  };
}

describe('fiche thème', () => {
  it('rien à traiter : fiche verte et éléments suivis au vert (§7.4)', () => {
    const model = buildThemeFiche(themeInput({ queue: queue({ ecowatt: ecowatt('green') }) }));
    expect(model.kind).toBe('Thème');
    expect(model.name).toBe('Énergie');
    expect(model.level).toBe('vert');
    expect(model.essentiel).toEqual(['Rien à traiter. 1 élément suivi est au vert.']);
  });

  it('avant les couches critiques : « Chargement des données… », jamais « Rien à traiter » (relecture finale m1)', () => {
    const model = buildThemeFiche(themeInput({ ready: false, queue: queue({ ecowatt: ecowatt('green') }) }));
    expect(model.essentiel).toEqual(['Chargement des données…']);
    expect(renderFiche(model, 'fr')).not.toContain('Rien à traiter');
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

describe('fiche événement (spec 2026-10-01 fiches § 4.1)', () => {
  const NOW = Date.parse('2026-10-01T08:30:00Z');
  const ev = (over: Partial<NewsEvent> = {}): NewsEvent => ({
    id: 13516, evidenceId: 'E13516', title: 'Haut-Rhin : menace d’attentat contre un lycée', category: 'security', severity: 'medium',
    status: 'cooling', firstSeen: '2026-09-30T17:11:00Z', lastSeen: '2026-10-01T06:44:00Z', articleCount: 11, sourceCount: 8,
    independentCount: 5, sourceNames: ['Le Dauphiné', 'Le Progrès', 'DNA'], lat: 47.6, lon: 7.5, peakSeverity: 'medium',
    zone: 'france', temporality: 'en_cours', reasons: [], ...over,
  });
  const detail: NewsEventDetail = {
    event: ev(),
    articles: [
      { id: 1, title: 'Article ancien', link: 'https://exemple.fr/a', feedName: 'DNA', publishedAt: '2026-09-30T17:11:00Z' },
      { id: 2, title: 'Article récent <b>', link: 'https://exemple.fr/b', feedName: 'Le Figaro', publishedAt: '2026-10-01T04:44:00Z' },
    ],
    log: [
      { at: '2026-10-01T06:30:00Z', kind: 'cooling', from: null, to: null },
      { at: '2026-09-30T21:00:00Z', kind: 'corroborated', from: '1', to: '2' },
      { at: '2026-10-01T08:30:00Z', kind: 'corroborated', from: '4', to: '5' },
      { at: '2026-10-01T05:00:00Z', kind: 'corroborated', from: '2', to: '3' },
      { at: '2026-10-01T07:00:00Z', kind: 'corroborated', from: '3', to: '4' },
    ],
  };
  const build = (over: Partial<EventFicheInput> = {}): FicheModel => buildEventFiche({
    event: ev(), detail, place: { code: '68', nom: 'Haut-Rhin' }, sectionOpen: new Map(), lang: 'fr', now: NOW, ...over,
  });
  const byId = (m: FicheModel) => new Map(m.sections.map((s) => [s.id, s]));

  it('en-tête : lieu avec numéro, depuis en heure absolue, statut daté, synthèse', () => {
    const m = build();
    expect(m.kind).toBe('Événement · Sécurité et défense');
    expect(m.context).toEqual(['Haut-Rhin (68)', 'depuis 30/09 19:11', 'en refroidissement depuis 08:30']);
    expect(m.lead).toBe('Repris par 8 sources (Le Dauphiné, Le Progrès, DNA). Dernier article à 08:44.');
  });

  it('sections : indicateurs et évolution ouverts, articles repliés au ton référence', () => {
    const s = byId(build());
    expect(s.get('indicators')).toMatchObject({ collapsible: true, open: true, summary: '5 groupes indépendants · 11 articles' });
    expect(s.get('evolution')).toMatchObject({ collapsible: true, open: true, summary: '5 changements' });
    expect(s.get('articles')).toMatchObject({ collapsible: true, open: false, tone: 'reference', summary: '11 articles · 8 flux' });
    expect(byId(build({ sectionOpen: new Map([['articles', true], ['indicators', false]]) })).get('articles')?.open).toBe(true);
  });

  it('indicateurs : courbe de corroboration 1 → 5, confirmation, gravité, volume, lieu, preuve', () => {
    const html = byId(build()).get('indicators')?.html ?? '';
    expect(html).toContain('class="fmk-curve"');
    expect(html).toContain('<text x="12" y="12" text-anchor="end">5</text>');
    expect(html).toContain('confirmé par 5 groupes de presse indépendants');
    expect(html).toContain('fm-vig--jaune');
    expect(html).toContain('11 articles · 8 flux');
    expect(html).toContain('Haut-Rhin (68)');
    expect(html).toContain('E13516');
  });

  it('à confirmer : contexte et gravité signalée au-dessus de la retenue ; motifs en mots', () => {
    const m = build({ event: ev({ severity: 'medium', peakSeverity: 'high', independentCount: 1, sourceCount: 1, reasons: ['non_confirme'] }) });
    expect(m.context).toContain('à confirmer, signalé orange');
    const html = byId(m).get('indicators')?.html ?? '';
    expect(html).toContain('source unique');
    expect(html).toContain('niveau le plus grave signalé par une seule source indépendante');
  });

  it('évolution : heures absolues, la plus récente en tête', () => {
    const html = byId(build()).get('evolution')?.html ?? '';
    expect(html.indexOf('10:30')).toBeLessThan(html.indexOf('09:00'));
    expect(html).toContain('<li class="fiche-change is-latest"><span class="fiche-time">10:30</span>');
    expect(html).toContain('30/09 23:00');
  });

  it('articles : lignes simples, du plus récent au plus ancien, échappés, date absolue', () => {
    const html = byId(build()).get('articles')?.html ?? '';
    expect(html.indexOf('Article récent')).toBeLessThan(html.indexOf('Article ancien'));
    expect(html).toContain('Article récent &lt;b&gt;');
    expect(html).toContain('<small>Le Figaro · 06:44</small>');
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).not.toContain('fiche-source');
  });

  it('détail absent, en cours ou en erreur : messages, pas de courbe, jamais d’exception', () => {
    for (const d of [undefined, 'loading', 'error'] as const) {
      const s = byId(build({ detail: d }));
      expect(s.get('indicators')?.html).not.toContain('fmk-curve');
      expect(s.get('evolution')?.html).toContain(d === 'error' ? 'Journal indisponible pour le moment.' : 'Chargement du journal…');
      expect(s.get('articles')?.html).toContain(d === 'error' ? 'Articles indisponibles pour le moment.' : 'Chargement des articles…');
    }
  });

  it('articles hostiles : lien non http en span, titre, flux et source échappés', () => {
    const hostile: NewsEventDetail = {
      ...detail,
      articles: [{ id: 9, title: '<img src=x onerror=alert(1)>', link: 'javascript:alert(1)', feedName: '<i>flux</i>', publishedAt: '2026-10-01T04:44:00Z' }],
    };
    const m = build({ event: ev({ sourceNames: ['<b>X</b>'] }), detail: hostile });
    const html = byId(m).get('articles')?.html ?? '';
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('<span>&lt;img');
    expect(html).toContain('&lt;i&gt;flux&lt;/i&gt;');
    const all = renderFiche(m, 'fr');
    expect(all).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(all).not.toContain('<b>X</b>');
  });

  it('courbe : première étape sans valeur de départ, la courbe part de 1', () => {
    const d: NewsEventDetail = { ...detail, log: [{ at: '2026-10-01T05:00:00Z', kind: 'corroborated', from: null, to: '3' }] };
    const html = byId(build({ detail: d })).get('indicators')?.html ?? '';
    expect(html).toContain('<text x="12" y="63" text-anchor="end">1</text>');
  });

  it('un seul groupe de presse ; journal en mots L1', () => {
    const one = byId(build({ event: ev({ independentCount: 1, sourceCount: 3 }) })).get('indicators')?.html ?? '';
    expect(one).toContain('un seul groupe de presse (3 titres)');
    const d: NewsEventDetail = { ...detail, log: [{ at: '2026-10-01T07:00:00Z', kind: 'escalated', from: 'medium', to: 'high' }] };
    expect(byId(build({ detail: d })).get('evolution')?.html).toContain('aggravé jaune → orange');
  });

  it('référence copiable et actions', () => {
    const m = build();
    expect(m.reference).toBe('E13516 · Haut-Rhin : menace d’attentat contre un lycée · Jaune · première apparition 30/09 19:11');
    expect(m.actions.map((a) => a.id)).toEqual(['map', 'copy-ref']);
    expect(build({ event: ev({ lat: null, lon: null }) }).actions.map((a) => a.id)).toEqual(['copy-ref']);
  });

  it('étranger : lieu « à l’étranger » ; aucun tiret cadratin nulle part', () => {
    const m = build({ event: ev({ zone: 'etranger' }), place: null });
    expect(m.context?.[0]).toBe('à l’étranger');
    expect(JSON.stringify(m)).not.toContain('—');
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
