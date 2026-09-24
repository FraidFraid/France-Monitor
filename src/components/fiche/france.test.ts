import { describe, it, expect } from 'vitest';
import { buildFranceFiche, type FranceFicheInput, type FranceFicheSnapshot } from './france.ts';
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
    freshness: '33 sources sur 35 à jour', whyOpen: false, lang: 'fr', now: NOW, ...over,
  };
}

const visibleOf = (html: string): string => html.slice(0, html.indexOf('<details'));

describe('buildFranceFiche (spec §6.3, §14)', () => {
  it('essentiel = BLUF ; jugements en mots ; preuves cliquables ; indice chiffré seulement dans le volet', () => {
    const html = renderFiche(buildFranceFiche(input()), 'fr');
    const visible = visibleOf(html);
    expect(visible).toContain('France en vigilance rouge, en dégradation sur 24 h.');
    expect(visible).toContain('<span class="fm-vig fm-vig--rouge">Rouge</span>');
    expect(visible).toContain('tirée par l’énergie');
    expect(visible).toContain('confiance élevée');
    expect(visible).toContain('data-select="event:42"');
    expect(visible).toContain('data-select="situation:energy-stress"');
    expect(visible).toContain('6 h');
    expect(visible).not.toContain('/100');
    expect(visible).not.toContain('Indice de stabilité');
    expect(html).toContain('Indice de stabilité 43/100');
    for (const part of ['frintel-pillars', 'frintel-dom-grid', 'frintel-timeline', 'fiche-infra-slot', 'Événements consolidés ouverts (1)']) {
      expect(html).toContain(part);
    }
  });

  it('brief en attente : l’essentiel l’annonce, jamais « indisponible »', () => {
    const html = renderFiche(buildFranceFiche(input({ brief: null })), 'fr');
    expect(html).toContain('Synthèse nationale en cours de préparation…');
    expect(visibleOf(html)).not.toContain('indisponible');
  });

  it('S<n> désigne la situation figée au moment du brief, pas l’instantané courant', () => {
    const html = renderFiche(buildFranceFiche(input({ briefSituationIds: ['cyber-pressure'] })), 'fr');
    expect(html).toContain('data-select="situation:cyber-pressure">S1');
    expect(html).not.toContain('data-select="situation:energy-stress">S1');
  });

  it('ce qui a changé : badges, fil serveur, situations résolues dans les 24 h (§14)', () => {
    const digest: ChangeDigestItem[] = [{ event: event(), kinds: ['created'], latestAt: '2026-09-24T07:40:00Z', severityFrom: null, independentFrom: null }];
    const model = buildFranceFiche(input({
      events: eventsState({ digest }),
      resolved: [
        { id: 'flood-crisis', type: 'FLOOD_CRISIS', severity: 'high', title: 'Crise hydrologique active', affectedZones: [], since: NOW - 2 * H },
        { id: 'energy-stress', type: 'ENERGY_STRESS', severity: 'high', title: 'Tension énergétique nationale', affectedZones: [], since: NOW - H },
      ],
    }));
    expect(model.changesMeta).toContain('Depuis votre visite de');
    const rows = model.changes.map((c) => [c.text, c.select]);
    expect(rows).toContainEqual(['Nouveau : Explosion dans une usine chimique', 'event:42']);
    expect(rows).toContainEqual(['Nouveau : Tension énergétique nationale', 'situation:energy-stress']);
    expect(rows).toContainEqual(['Résolue : Crise hydrologique active', null]);
    expect(rows.filter(([text]) => text === 'Résolue : Tension énergétique nationale')).toHaveLength(0);
  });

  it('première visite, historique indisponible et chargement sont dits en clair', () => {
    expect(buildFranceFiche(input({ events: eventsState({ anchor: { since: NOW - 24 * H, kind: 'default' } }) })).changesMeta)
      .toBe('Première visite : dernières 24 h');
    expect(buildFranceFiche(input({ events: eventsState({ unavailable: true, events: [] }) })).changesMeta).toContain('Historique serveur indisponible');
    expect(buildFranceFiche(input({ events: null })).changesMeta).toBe('Chargement de l’historique…');
  });

  it('actions : voir sur la carte et note de situation ; bascule EN', () => {
    const model = buildFranceFiche(input({ lang: 'en' }));
    expect(model.actions.map((a) => a.id)).toEqual(['show-france', 'report']);
    expect(model.kind).toBe('Country');
    expect(model.driver).toBe('driven by energy');
  });
});
