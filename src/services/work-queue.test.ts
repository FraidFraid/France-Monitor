import { describe, it, expect } from 'vitest';
import {
  buildWorkQueue,
  drivingThemes,
  levelsForBaseline,
  marketLines,
  officialAlertGroups,
  viewWorkQueue,
  visitCounts,
  type MarketLine,
  type WorkQueueInput,
} from './work-queue.ts';
import type { SpecificThemeId } from './themes.ts';
import type { VigilanceLevel } from './vigilance.ts';
import type {
  ChangeDigestItem,
  CommodityData,
  DetectedSituation,
  EcowattResponse,
  FloodSegment,
  IntelEventsState,
  MarketData,
  MeteoAlert,
  NewsEvent,
} from '../types/index.ts';

const NOW = Date.parse('2026-09-24T08:00:00Z');
const H = 3600_000;

function situation(over: Partial<DetectedSituation> = {}): DetectedSituation {
  return {
    id: 'energy-stress', type: 'ENERGY_STRESS', severity: 'high', confidence: 0.8, title: 'Tension énergétique nationale',
    summary: 'Signal Écowatt orange confirmé.', affectedZones: ['Bretagne'], drivers: [], recommendedActions: [],
    sourceRefs: ['Ecowatt RTE'], updatedAt: new Date(NOW), ...over,
  };
}

function event(over: Partial<NewsEvent> = {}): NewsEvent {
  const id = over.id ?? 42;
  return {
    id, evidenceId: `E${id}`, title: 'Explosion dans une usine chimique de Seine-Maritime', category: 'security',
    severity: 'critical', status: 'active', firstSeen: '2026-09-24T07:30:00Z', lastSeen: '2026-09-24T07:50:00Z',
    articleCount: 3, sourceCount: 3, independentCount: 3, sourceNames: ['France Info'], lat: 49.4, lon: 1.1, ...over,
  };
}

function eventsState(over: Partial<IntelEventsState> = {}): IntelEventsState {
  return { events: [], digest: [], totals: {}, anchor: { since: NOW - 3 * H, kind: 'last-visit' }, fetchedAt: NOW, unavailable: false, ...over };
}

function ecowatt(signals: EcowattResponse['signals']): EcowattResponse {
  const mix = { timestamp: new Date(0), nuclear: 0, wind: 0, solar: 0, hydro: 0, gas: 0, other: 0, total: 0 };
  return { signals, mixes: {}, national: mix, interconnections: [] };
}

function meteo(department: string, level: MeteoAlert['level'], risks: MeteoAlert['risks'] = []): MeteoAlert {
  return { department, departmentCode: department.slice(0, 2), level, risks };
}

function flood(name: string, level: FloodSegment['level']): FloodSegment {
  const line = { type: 'LineString' as const, coordinates: [] };
  return {
    id: name, name, level, dataSource: 'live', geometryFidelity: 'raw', matchConfidence: 1,
    rawVertexCount: 0, displayVertexCount: 0, geometry: line, rawGeometry: line, displayGeometry: line,
  };
}

function market(over: Partial<MarketLine> = {}): MarketLine {
  return { symbol: 'CAC40', name: 'CAC 40', price: 7500, changePercent: -0.4, kind: 'index', ...over };
}

function input(over: Partial<WorkQueueInput> = {}): WorkQueueInput {
  return {
    situations: [], alerts: [], events: eventsState(), ecowatt: null, meteo: [], floods: [], markets: [],
    baseline: null, firstSeen: new Map(), lang: 'fr', ...over,
  };
}

const keys = (q: ReturnType<typeof buildWorkQueue>): string[] => q.items.map((i) => i.key);

describe('buildWorkQueue — ce qui entre (spec §7.1)', () => {
  it('toutes les situations du moteur entrent, au niveau L1, sous le thème de leur type', () => {
    const q = buildWorkQueue(input({
      situations: [situation({ severity: 'watch' }), situation({ id: 'cyber-pressure', type: 'CYBER_PRESSURE', severity: 'critical' })],
    }));
    expect(q.items.map((i) => [i.key, i.level, i.theme])).toEqual([
      ['situation:cyber-pressure', 'rouge', 'security'],
      ['situation:energy-stress', 'jaune', 'energy'],
    ]);
  });

  it('alertes : météo couverte par la ligne officielle, incendie par la situation, presse dédoublonnée (A2, A3)', () => {
    const q = buildWorkQueue(input({
      situations: [situation({ id: 'wildfire-7', type: 'WILDFIRE_ESCALATION', severity: 'critical', title: 'Incendie majeur en cours' })],
      alerts: [
        situation({ id: 'weather-alert-83-red-heat', type: 'WEATHER_ALERT', severity: 'critical', title: 'Vigilance rouge Var' }),
        situation({ id: 'wildfire-7', type: 'WILDFIRE_ESCALATION', severity: 'critical' }),
        situation({ id: 'news-alert-1', type: 'NEWS_ALERT', severity: 'critical', title: 'Explosion dans une usine chimique de Seine-Mar...', category: 'security' }),
        situation({ id: 'news-alert-2', type: 'NEWS_ALERT', severity: 'high', title: 'Cyberattaque contre un hôpital', category: 'cyber' }),
        situation({ id: 'defense-alert-1', type: 'DEFENSE_ALERT', severity: 'high', title: 'Navire près du câble' }),
      ],
      events: eventsState({ events: [event()] }),
    }));
    expect(keys(q)).toEqual(['event:42', 'situation:wildfire-7', 'alert:defense-alert-1', 'alert:news-alert-2']);
    expect(q.items.find((i) => i.key === 'alert:news-alert-2')?.theme).toBe('security');
  });

  it('alertes officielles orange ou rouges regroupées par source et niveau, violet compté rouge', () => {
    const groups = officialAlertGroups(
      ecowatt({ '53': 'red', '11': 'orange', '84': 'green' }),
      [meteo('Var', 'violet', ['heat', 'thunderstorm']), meteo('Gard', 'red'), meteo('Isère', 'yellow')],
      [flood('Loire amont', 'orange')],
    );
    // Object.entries range les clés numériques par ordre croissant : '11' avant '53'.
    expect(groups.map((g) => [g.source, g.level, g.places])).toEqual([
      ['ecowatt', 'orange', ['Île-de-France']],
      ['ecowatt', 'rouge', ['Bretagne']],
      ['meteo', 'rouge', ['Var', 'Gard']],
      ['vigicrues', 'orange', ['Loire amont']],
    ]);
    expect(groups[2].details[0]).toBe('Var : Canicule, Orages');
  });

  it('le jaune officiel n’entre pas dans la liste mais colore son thème', () => {
    const q = buildWorkQueue(input({ ecowatt: ecowatt({ '53': 'red' }), meteo: [meteo('Isère', 'yellow')] }));
    expect(q.items.map((i) => i.title)).toEqual(['Écowatt : signal rouge sur 1 région']);
    expect(q.themeLevels.energy).toBe('rouge');
    expect(q.themeLevels.environment).toBe('jaune');
  });

  it('événements : au moins jaunes, corroborés par deux groupes ou orange/rouges ; jamais clos ni verts', () => {
    const q = buildWorkQueue(input({ events: eventsState({ events: [
      event({ id: 1, severity: 'medium', independentCount: 2 }),
      event({ id: 2, severity: 'medium', independentCount: 1 }),
      event({ id: 3, severity: 'high', independentCount: 1 }),
      event({ id: 4, severity: 'low', independentCount: 5 }),
      event({ id: 5, severity: 'critical', status: 'closed' }),
    ] }) }));
    expect(keys(q).sort()).toEqual(['event:1', 'event:3']);
  });

  it('marchés : jaune au-delà de ±3 % (indice) ou ±5 % (énergie), jamais sur une valeur manquante', () => {
    const q = buildWorkQueue(input({ markets: [
      market({ changePercent: -3.42 }),
      market({ symbol: 'BRENT', name: 'Brent', changePercent: 4.9, kind: 'energy' }),
      market({ symbol: 'NATGAS', name: 'Gaz naturel', changePercent: 6.1, kind: 'energy' }),
      market({ symbol: 'DAX', name: 'DAX', changePercent: Number.NaN }),
    ] }));
    expect(q.items.map((i) => [i.key, i.level, i.theme, i.title])).toEqual([
      ['market:CAC40', 'jaune', 'general', 'CAC 40 : −3,42 % sur la journée'],
      ['market:NATGAS', 'jaune', 'energy', 'Gaz naturel : +6,10 % sur la journée'],
    ]);
  });

  it('marketLines garde les indices boursiers et l’énergie, rien d’autre', () => {
    const markets = [
      { symbol: 'CAC40', name: 'CAC 40', price: 1, changePercent: 1, trend: 'up', lastUpdated: new Date(0), category: 'indices' },
      { symbol: 'EURUSD', name: 'EUR/USD', price: 1, changePercent: 1, trend: 'up', lastUpdated: new Date(0), category: 'devises' },
    ] satisfies MarketData[];
    const commodities = [
      { symbol: 'BRENT', name: 'Brent', price: 80, changePercent: 1, trend: 'up', lastUpdated: new Date(0), history: [], category: 'energy', unit: '$/bbl' },
      { symbol: 'GOLD', name: 'Or', price: 1, changePercent: 1, trend: 'up', lastUpdated: new Date(0), history: [], category: 'metals', unit: '$/oz' },
    ] satisfies CommodityData[];
    expect(marketLines(markets, commodities).map((l) => [l.symbol, l.kind])).toEqual([['CAC40', 'index'], ['BRENT', 'energy']]);
  });
});

describe('buildWorkQueue — aucun sous-score hors du volet (relecture finale I4, A7)', () => {
  it('lieu de la ligne : le nom de la zone, jamais son sous-score « (72/100) »', () => {
    const q = buildWorkQueue(input({
      situations: [situation({
        id: 'social-escalation', type: 'SOCIAL_ESCALATION', severity: 'high', title: 'Escalade sociale localisée',
        affectedZones: ['Seine-Saint-Denis (72/100)', 'Bouches-du-Rhône (66/100)', 'Rhône (58/100)'],
      })],
    }));
    expect(q.items[0].place).toBe('Seine-Saint-Denis');
  });
});

describe('buildWorkQueue — tri et badges (spec §7.2)', () => {
  it('rouge d’abord, puis nouveau ou aggravé, puis le plus récent', () => {
    const q = buildWorkQueue(input({
      situations: [situation({ id: 'a' }), situation({ id: 'b' }), situation({ id: 'c', severity: 'critical' })],
      baseline: { 'situation:a': 'orange', 'situation:c': 'rouge' },
      firstSeen: new Map([['situation:a', NOW - H]]),
    }));
    expect(keys(q)).toEqual(['situation:c', 'situation:b', 'situation:a']);
    expect(q.items.map((i) => i.badge)).toEqual([null, 'nouveau', null]);
    expect(q.items[2].since).toBe(NOW - H);
  });

  it('aggravé quand la couleur monte depuis la visite ; aucun badge sans ligne de base', () => {
    const escalated = buildWorkQueue(input({ situations: [situation({ severity: 'critical' })], baseline: { 'situation:energy-stress': 'orange' } }));
    expect(escalated.items[0].badge).toBe('aggrave');
    expect(buildWorkQueue(input({ situations: [situation()] })).items[0].badge).toBeNull();
  });

  it('événements : badge tiré du fil serveur (créé → nouveau ; aggravé ou rouvert → aggravé)', () => {
    const digest = (id: number, kinds: ChangeDigestItem['kinds']): ChangeDigestItem => ({
      event: event({ id }), kinds, latestAt: '2026-09-24T07:40:00Z', severityFrom: 'high', independentFrom: null,
    });
    const q = buildWorkQueue(input({ events: eventsState({
      events: [event({ id: 1 }), event({ id: 2 }), event({ id: 3 })],
      digest: [digest(1, ['created']), digest(2, ['escalated'])],
    }) }));
    expect(q.items.map((i) => [i.key, i.badge])).toEqual([['event:1', 'nouveau'], ['event:2', 'aggrave'], ['event:3', null]]);
  });
});

describe('buildWorkQueue — identité de ligne de base sans le niveau (relecture finale m2)', () => {
  const surge = (severity: DetectedSituation['severity'], suffix: string): DetectedSituation => situation({
    id: `military-surge-concentration-${suffix}`, type: 'MILITARY_SURGE_ALERT', severity, title: 'Concentration inhabituelle de vols militaires',
  });

  it('alerte officielle : même source, niveau plus haut → AGGRAVÉ, et non NOUVEAU ; clé d’affichage inchangée', () => {
    const q = buildWorkQueue(input({ meteo: [meteo('Var', 'red')], baseline: { 'official:meteo': 'orange' } }));
    expect(q.items.map((i) => [i.key, i.badge])).toEqual([['official:meteo:rouge', 'aggrave']]);
  });

  it('alerte officielle : même niveau ou plus bas → pas de badge ; source absente → NOUVEAU', () => {
    const q = buildWorkQueue(input({
      ecowatt: ecowatt({ '53': 'orange' }),
      meteo: [meteo('Var', 'orange')],
      floods: [flood('Loire amont', 'orange')],
      baseline: { 'official:meteo': 'rouge', 'official:ecowatt': 'orange' },
    }));
    expect(Object.fromEntries(q.items.map((i) => [i.key, i.badge]))).toEqual({
      'official:ecowatt:orange': null,
      'official:meteo:orange': null,
      'official:vigicrues:orange': 'nouveau',
    });
  });

  it('poussée militaire : la gravité dans l’identifiant ne fait pas un NOUVEAU ; clé d’affichage inchangée', () => {
    const q = buildWorkQueue(input({
      alerts: [surge('critical', 'alert')],
      baseline: { 'alert:military-surge-concentration': 'orange' },
    }));
    expect(q.items.map((i) => [i.key, i.badge])).toEqual([['alert:military-surge-concentration-alert', 'aggrave']]);
  });

  it('ligne de base enregistrée par identité, au niveau le plus élevé de la source', () => {
    const q = buildWorkQueue(input({
      meteo: [meteo('Var', 'red'), meteo('Gard', 'orange')],
      alerts: [surge('high', 'warning')],
      situations: [situation()],
    }));
    expect(levelsForBaseline(q)).toEqual({
      'official:meteo': 'rouge',
      'alert:military-surge-concentration': 'orange',
      'situation:energy-stress': 'orange',
    });
  });
});

describe('buildWorkQueue — états (spec §7.4)', () => {
  it('événements en chargement, indisponibles ou disponibles', () => {
    expect(buildWorkQueue(input({ events: null })).eventsStatus).toBe('loading');
    expect(buildWorkQueue(input({ events: eventsState({ unavailable: true }) })).eventsStatus).toBe('unavailable');
    expect(buildWorkQueue(input({ events: eventsState({ unavailable: true, events: [event()] }) })).eventsStatus).toBe('ok');
  });

  it('compte les éléments suivis restés au vert, par thème (A10)', () => {
    const q = buildWorkQueue(input({
      ecowatt: ecowatt({ '53': 'green' }),
      events: eventsState({ events: [event({ id: 1, severity: 'low', category: 'health' }), event({ id: 2, severity: 'info', category: 'finance' })] }),
      markets: [market()],
    }));
    expect(q.greenTracked).toEqual({ general: 4, energy: 1, security: 0, health: 1, environment: 0 });
  });

  it('ligne de base à enregistrer : niveaux des éléments, sans les événements', () => {
    const q = buildWorkQueue(input({ situations: [situation()], events: eventsState({ events: [event()] }) }));
    expect(levelsForBaseline(q)).toEqual({ 'situation:energy-stress': 'orange' });
  });
});

describe('viewWorkQueue (spec §7.2, §7.3)', () => {
  it('au plus 12 lignes, puis « voir les autres »', () => {
    const situations = Array.from({ length: 15 }, (_, i) => situation({ id: `s${i}` }));
    const q = buildWorkQueue(input({ situations }));
    const view = viewWorkQueue(q, 'general', false);
    expect(view.rows).toHaveLength(12);
    expect(view.total).toBe(15);
    expect(view.hiddenCount).toBe(3);
    expect(viewWorkQueue(q, 'general', true).rows).toHaveLength(15);
  });

  it('un thème ne garde que ses éléments ; la garde compte les rouges hors thème et vise le thème qui en a le plus', () => {
    const q = buildWorkQueue(input({
      situations: [
        situation({ id: 'e', severity: 'critical' }),
        situation({ id: 'c1', type: 'CYBER_PRESSURE', severity: 'critical' }),
        situation({ id: 'c2', type: 'MARITIME_ANOMALY', severity: 'critical' }),
      ],
      alerts: [situation({ id: 'n', type: 'NEWS_ALERT', severity: 'critical', title: 'Fait divers national', category: 'general' })],
    }));
    const health = viewWorkQueue(q, 'health', false);
    expect(health.total).toBe(0);
    expect(health.guard).toEqual({ reds: 4, themes: ['general', 'energy', 'security'], target: 'security' });
    const energy = viewWorkQueue(q, 'energy', false);
    expect(energy.rows.map((r) => r.key)).toEqual(['situation:e']);
    expect(energy.guard).toEqual({ reds: 3, themes: ['general', 'security'], target: 'security' });
    expect(viewWorkQueue(q, 'general', false).guard).toBeNull();
  });

  it('un rouge rattaché à « Vue générale » seulement déclenche la garde et y bascule (revue)', () => {
    const q = buildWorkQueue(input({
      alerts: [situation({ id: 'n', type: 'NEWS_ALERT', severity: 'critical', title: 'Fait divers national', category: 'general' })],
    }));
    expect(viewWorkQueue(q, 'energy', false).guard).toEqual({ reds: 1, themes: ['general'], target: 'general' });
  });

  it('rien à traiter : compte des éléments suivis au vert et état des événements', () => {
    const q = buildWorkQueue(input({ ecowatt: ecowatt({ '53': 'green' }), events: eventsState({ unavailable: true }) }));
    const view = viewWorkQueue(q, 'energy', false);
    expect(view.total).toBe(0);
    expect(view.greenTracked).toBe(1);
    expect(view.eventsStatus).toBe('unavailable');
  });
});

describe('drivingThemes (spec §5.2)', () => {
  const levels = (over: Partial<Record<SpecificThemeId, VigilanceLevel>>): Record<SpecificThemeId, VigilanceLevel> => ({
    energy: 'vert', security: 'vert', health: 'vert', environment: 'vert', ...over,
  });

  it('les thèmes au niveau national, deux au plus', () => {
    expect(drivingThemes(levels({ energy: 'rouge', security: 'rouge', environment: 'rouge' }), 'rouge')).toEqual(['energy', 'security']);
  });

  it('sinon le thème au niveau le plus élevé', () => {
    expect(drivingThemes(levels({ security: 'orange', health: 'jaune' }), 'rouge')).toEqual(['security']);
    expect(drivingThemes(levels({ health: 'jaune' }), 'vert')).toEqual(['health']);
  });

  it('aucun si tous les thèmes sont verts', () => {
    expect(drivingThemes(levels({}), 'jaune')).toEqual([]);
  });
});

describe('visitCounts', () => {
  it('compte nouveaux et aggravations sur toute la liste', () => {
    const q = buildWorkQueue(input({
      situations: [situation({ id: 'a', severity: 'critical' }), situation({ id: 'b' })],
      baseline: { 'situation:a': 'orange' },
    }));
    expect(visitCounts(q)).toEqual({ nouveaux: 1, aggravations: 1 });
  });
});
