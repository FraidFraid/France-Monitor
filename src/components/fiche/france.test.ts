import { describe, it, expect } from 'vitest';
import { buildFranceFiche, franceChangeDigest, type FranceFicheInput, type FranceFicheSnapshot } from './france.ts';
import { renderFiche } from './parts.ts';
import { buildWorkQueue } from '../../services/work-queue.ts';
import type {
  ChangeDigestItem,
  DetectedSituation,
  FranceCountrySignals,
  FranceScoreBreakdown,
  IntelEventsState,
  NewsEvent,
  StructuredBrief,
} from '../../types/index.ts';

const NOW = Date.parse('2026-09-24T08:00:00Z');
const H = 3600_000;

function breakdown(score = 43): FranceScoreBreakdown {
  return {
    score,
    baseline: 95,
    pillars: [
      { key: 'continuity', value: 61, deduction: 18.9, components: [{ label: 'Carburants & pétrole', value: 100 }] },
      { key: 'security', value: 57, deduction: 14.7, components: [] },
      { key: 'signal', value: 28, deduction: 3.4, components: [] },
      { key: 'defense', value: 65, deduction: 8.8, components: [] },
    ],
    shockValue: 55,
    shockExtra: 1.3,
    situationCap: 55,
  };
}

function signals(): FranceCountrySignals {
  return {
    criticalNews: 0, highNews: 0, topNewsCount: 0, meteoAlerts: 0, floodAlerts: 0, fireDetections: 0,
    railDisruptions: 0, railSevere: 0, roadIncidents: 0, powerOutages: 0, telecomOutages: 0,
    cyberAlerts: 0, cyberCritical: 0, militaryFlights: 0, maritimeTrafficFrance: 0,
    defenseAlerts: 0, defenseHigh: 0, jammingSignals: 0, marketStress: 0,
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

function eventsState(over: Partial<IntelEventsState> = {}): IntelEventsState {
  return { events: [event()], digest: [], totals: {}, anchor: { since: NOW - 3 * H, kind: 'last-visit' }, fetchedAt: NOW, unavailable: false, ...over };
}

const BRIEF: StructuredBrief = {
  bluf: 'France en vigilance rouge, en dégradation sur 24 h.',
  judgments: [{
    priority: 1, text: 'L’approvisionnement restera tendu 48 h.', confidence: 'high',
    sources: ['SDES'], evidence: ['E42', 'S1'], unsupported: false,
  }],
  watch: [{ text: 'Signal Écowatt de demain', horizon: '6h' }],
  origin: 'llm',
};

function snapshot(over: Partial<FranceFicheSnapshot> = {}): FranceFicheSnapshot {
  return {
    score: 43, scoreBreakdown: breakdown(43), situations: [situation()], signals: signals(), meteo: [], energy: null,
    timeline: { days: [], lanes: [] }, ...over,
  };
}

function input(over: Partial<FranceFicheInput> = {}): FranceFicheInput {
  const snap = over.snapshot ?? snapshot();
  const events = over.events === undefined ? eventsState() : over.events;
  const queue = buildWorkQueue({
    situations: snap.situations, alerts: [], events, ecowatt: null, meteo: [], floods: [], markets: [],
    baseline: {}, firstSeen: new Map(), lang: 'fr',
  });
  return {
    snapshot: snap, queue, drivers: ['energy'], brief: { brief: BRIEF, freshness: 'fresh' }, briefSituationIds: ['energy-stress'],
    events, resolved: [], changeTimes: new Map(), score: { delta24h: -4, pillarDeltas: null, series: [81, 70, 43] },
    briefMeta: { at: NOW - 30 * 60_000, level: 'orange' },
    freshness: '33 sources sur 35 à jour', whyOpen: false, ready: true, lang: 'fr', now: NOW, ...over,
  };
}

const sectionTitles = (html: string): string[] => [...html.matchAll(/<h3 class="fiche-part-title">([^<]*)<\/h3>/g)].map((m) => m[1]);

describe('onglet État de la France (spec 2026-09-29 § 7)', () => {
  it('Pourquoi replié en tête, puis Situations, Note, Depuis votre visite, Indicateurs', () => {
    const model = buildFranceFiche(input());
    expect(model.whyFirst).toBe(true);
    expect(sectionTitles(renderFiche(model, 'fr'))).toEqual(['Situations (1)', 'Note de situation', 'Depuis votre dernière visite', 'Indicateurs', 'Preuves et sources']);
  });

  it('preuves lisibles et sources nommées des jugements', () => {
    const html = renderFiche(buildFranceFiche(input()), 'fr');
    expect(html).toContain('E42 · Explosion dans une usine chimique');
    expect(html).toContain('SDES');
  });

  it('les graphiques sont visibles, plus cachés dans le volet ; ni événements consolidés, ni chiffres clés', () => {
    const model = buildFranceFiche(input());
    for (const part of ['frintel-dom-grid', 'frintel-timeline', 'fiche-infra-slot']) {
      expect(model.why).not.toContain(part);
      expect(model.sections.find((s) => s.title === 'Indicateurs')?.html).toContain(part);
    }
    expect(model.why).toContain('Indice de stabilité 43/100');
    expect(renderFiche(model, 'fr')).not.toContain('Événements consolidés ouverts');
    expect(model.figures).toEqual([]);
  });

  it('note : évaluation, jugements avec preuves cliquables, à surveiller, heure et niveau de rédaction', () => {
    const note = buildFranceFiche(input()).sections.find((s) => s.title === 'Note de situation')?.html ?? '';
    expect(note).toContain('France en vigilance rouge, en dégradation sur 24 h.');
    expect(note).toContain('data-select="event:42"');
    expect(note).toContain('6 h');
    expect(note).toContain('Rédigée à');
    expect(note).toContain('niveau orange');
  });

  it('note en attente : « en cours de préparation », jamais « indisponible »', () => {
    const note = buildFranceFiche(input({ brief: null, briefMeta: null })).sections.find((s) => s.title === 'Note de situation')?.html ?? '';
    expect(note).toContain('Synthèse nationale en cours de préparation…');
    expect(note).not.toContain('indisponible');
  });

  it('en-tête : situations actives, heure de mise à jour, sources', () => {
    expect(buildFranceFiche(input()).freshness).toMatch(/^1 situation active · MAJ \d{2}:\d{2} · 33 sources sur 35 à jour$/);
  });

  it('depuis la visite : totaux, puis 5 changements orange ou rouges au plus, résolues comprises', () => {
    const events = Array.from({ length: 7 }, (_, i) => event({ id: 100 + i, title: `Événement ${i}`, severity: 'high' }));
    const digest: ChangeDigestItem[] = events.map((e) => ({ event: e, kinds: ['created'], latestAt: '2026-09-24T07:40:00Z', severityFrom: null, independentFrom: null }));
    const low = event({ id: 200, title: 'Fait mineur', severity: 'low' });
    digest.push({ event: low, kinds: ['created'], latestAt: '2026-09-24T07:45:00Z', severityFrom: null, independentFrom: null });
    const { meta, rows } = franceChangeDigest(input({ events: eventsState({ events: [...events, low], digest }) }));
    expect(meta).toContain('Depuis votre visite de');
    expect(meta).toContain('9 nouveaux');
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.text)).not.toContain('Nouveau : Fait mineur');
  });

  it('S<n> désigne la situation figée au moment du brief, pas l’instantané courant', () => {
    const html = renderFiche(buildFranceFiche(input({ briefSituationIds: ['cyber-pressure'] })), 'fr');
    expect(html).toContain('data-select="situation:cyber-pressure">S1');
  });

  it('avant les couches critiques : ni indice ni piliers dans le volet', () => {
    const html = renderFiche(buildFranceFiche(input({ ready: false, snapshot: snapshot({ score: 95, scoreBreakdown: breakdown(95), situations: [] }) })), 'fr');
    expect(html).toContain('Calcul du niveau national…');
    for (const part of ['Indice de stabilité', 'frintel-pillars', '95/100']) expect(html).not.toContain(part);
  });

  it('note périmée (plus de 12 h) : grisée, avec sa date', () => {
    const note = buildFranceFiche(input({ briefMeta: { at: NOW - 13 * H, level: 'orange' } })).sections
      .find((s) => s.title === 'Note de situation')?.html ?? '';
    expect(note).toContain('fiche-stale');
    expect(note).toContain('données du');
  });

  it('actions : voir sur la carte et note de situation ; bascule EN', () => {
    const model = buildFranceFiche(input({ lang: 'en' }));
    expect(model.actions.map((a) => a.id)).toEqual(['show-france', 'report']);
    expect(model.kind).toBe('State of France');
    expect(model.driver).toBe('driven by energy');
  });
});
