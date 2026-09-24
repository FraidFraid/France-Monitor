// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';

vi.mock('../../services/news-events.ts', () => ({
  fetchEventDetail: vi.fn(async () => null),
}));

import { fetchEventDetail } from '../../services/news-events.ts';
import { PosteSituation, layoutFor, type PosteCallbacks, type PosteData, type PosteRoots } from './PosteSituation.ts';
import type {
  DetectedSituation,
  FranceCountrySignals,
  FranceScoreBreakdown,
  IntelEventsState,
  NewsEvent,
  StructuredBrief,
} from '../../types/index.ts';

const NOW = Date.parse('2026-09-24T08:00:00Z');

function breakdown(): FranceScoreBreakdown {
  return {
    score: 43, baseline: 95,
    pillars: [
      { key: 'continuity', value: 61, deduction: 18.9, components: [] },
      { key: 'security', value: 57, deduction: 14.7, components: [] },
      { key: 'signal', value: 28, deduction: 3.4, components: [] },
      { key: 'defense', value: 65, deduction: 8.8, components: [] },
    ],
    shockValue: 55, shockExtra: 1.3, situationCap: 55,
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

function event(): NewsEvent {
  return {
    id: 42, evidenceId: 'E42', title: 'Explosion dans une usine chimique', category: 'security', severity: 'critical',
    status: 'active', firstSeen: '2026-09-24T07:30:00Z', lastSeen: '2026-09-24T07:50:00Z', articleCount: 3,
    sourceCount: 3, independentCount: 3, sourceNames: [], lat: 49.4, lon: 1.1,
  };
}

function eventsState(): IntelEventsState {
  return { events: [event()], digest: [], totals: {}, anchor: { since: NOW - 3_600_000, kind: 'last-visit' }, fetchedAt: NOW, unavailable: false };
}

const BRIEF: StructuredBrief = {
  bluf: 'France en vigilance rouge.',
  judgments: [{ priority: 1, text: 'Tension durable.', confidence: 'high', sources: [], evidence: ['E42'], unsupported: false }],
  watch: [],
  origin: 'deterministic',
};

function data(over: Partial<PosteData> = {}): PosteData {
  return {
    snapshot: {
      score: 43, scoreBreakdown: breakdown(), situations: [situation()], signals: signals(), meteo: [], energy: null,
      timeline: { days: [], lanes: [] },
    },
    alerts: [], ecowatt: null, meteo: [], floods: [], markets: [], commodities: [],
    sources: [{ name: 'Écowatt RTE', lastUpdate: null, status: 'ok' }],
    score: { delta24h: -4, pillarDeltas: null, series: [] },
    ready: true, lang: 'fr', now: NOW, ...over,
  };
}

function setup(width = 1440) {
  const app = document.createElement('div');
  const make = (): HTMLElement => {
    const el = document.createElement('div');
    app.appendChild(el);
    return el;
  };
  const roots: PosteRoots = { app, status: make(), themes: make(), list: make(), fiche: make(), tabs: make() };
  document.body.appendChild(app);
  const cb = {
    onThemeChange: vi.fn(), onFlyTo: vi.fn(), onActivateLayers: vi.fn(), onOpenDossier: vi.fn(() => true),
    onOpenReport: vi.fn(), onShowFrance: vi.fn(), onFicheRendered: vi.fn(),
  } satisfies PosteCallbacks;
  const poste = new PosteSituation(roots, cb, { viewportWidth: () => width });
  poste.setEvents(eventsState());
  poste.update(data());
  return { roots, cb, poste };
}

const ficheKey = (roots: PosteRoots): string | undefined => roots.fiche.querySelector<HTMLElement>('[data-fiche]')?.dataset.fiche;
const activeKey = (): string | undefined => (document.activeElement instanceof HTMLElement ? document.activeElement.dataset.key : undefined);

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe('layoutFor (spec §9)', () => {
  it('mobile sous 700 px, tablette jusqu’à 1 100 px, ordinateur au-delà', () => {
    expect(layoutFor(699)).toBe('mobile');
    expect(layoutFor(700)).toBe('tablet');
    expect(layoutFor(1100)).toBe('tablet');
    expect(layoutFor(1101)).toBe('desktop');
  });
});

describe('PosteSituation', () => {
  it('rendu initial : niveau national, liste, fiche France par défaut', () => {
    const { roots } = setup();
    expect(roots.status.textContent).toContain('Rouge');
    expect(roots.list.textContent).toContain('À traiter · Vue générale · 2');
    expect(ficheKey(roots)).toBe('france');
    expect(roots.app.dataset.v2Fiche).toBe('default');
  });

  it('un clic ouvre la fiche de la ligne ; Échap la referme et rend le focus à la ligne (§9)', () => {
    const { roots } = setup();
    const row = [...roots.list.querySelectorAll<HTMLButtonElement>('.wl-item')].find((b) => b.dataset.key === 'situation:energy-stress');
    row?.focus();
    row?.click();
    expect(ficheKey(roots)).toBe('situation:energy-stress');
    expect(roots.app.dataset.v2Fiche).toBe('open');
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(ficheKey(roots)).toBe('france');
    expect(activeKey()).toBe('situation:energy-stress');
  });

  it('un thème filtre la liste, affiche sa fiche et demande sa vue de carte (A5)', () => {
    const { roots, cb } = setup();
    roots.themes.querySelector<HTMLButtonElement>('[data-theme="energy"]')?.click();
    expect(cb.onThemeChange).toHaveBeenCalledWith('energy');
    expect(roots.list.textContent).toContain('À traiter · Énergie · 1');
    expect(ficheKey(roots)).toBe('theme:energy');
    expect(roots.list.querySelector('.wl-guard')?.textContent).toContain('Hors de ce thème : 1 rouge');
  });

  it('élément disparu : fiche par défaut, sélection effacée, focus sur le titre de la fiche (revue)', () => {
    const { roots, poste } = setup();
    poste.select('situation:energy-stress');
    roots.fiche.querySelector<HTMLButtonElement>('.fiche-close')?.focus();
    poste.update(data({ snapshot: { ...data().snapshot, situations: [] } }));
    expect(ficheKey(roots)).toBe('france');
    expect(roots.app.dataset.v2Fiche).toBe('default');
    expect(document.activeElement?.classList.contains('fiche-name')).toBe(true);
  });

  it('le volet « Pourquoi ce niveau ? » ouvert le reste après vingt mises à jour', () => {
    const { roots, poste } = setup();
    const details = roots.fiche.querySelector('details.fiche-why');
    expect(details).not.toBeNull();
    details?.setAttribute('open', '');
    details?.dispatchEvent(new Event('toggle'));
    for (let i = 1; i <= 20; i += 1) {
      poste.update(data({ now: NOW + i * 60_000, score: { delta24h: -i, pillarDeltas: null, series: [] } }));
    }
    expect(roots.fiche.querySelector('details.fiche-why')?.hasAttribute('open')).toBe(true);
  });

  it('une preuve E42 ouvre la fiche événement et ne charge ses articles qu’une fois', async () => {
    const { roots, poste } = setup();
    poste.setBrief(BRIEF, 'fresh', ['energy-stress']);
    roots.fiche.querySelector<HTMLButtonElement>('.fiche-judgment [data-select="event:42"]')?.click();
    expect(ficheKey(roots)).toBe('event:42');
    await vi.waitFor(() => expect(roots.fiche.textContent).toContain('Journal indisponible pour le moment.'));
    poste.update(data({ now: NOW + 60_000 }));
    expect(vi.mocked(fetchEventDetail)).toHaveBeenCalledTimes(1);
  });

  it('mobile : onglets ; une sélection ouvre la fiche en volet ; l’onglet « France » montre la fiche du pays', () => {
    const { roots, poste } = setup(390);
    expect(roots.tabs.textContent).toContain('À traiter');
    expect(roots.app.dataset.v2Tab).toBe('list');
    poste.select('situation:energy-stress');
    expect(roots.app.dataset.v2Fiche).toBe('open');
    roots.tabs.querySelector<HTMLButtonElement>('[data-tab="map"]')?.click();
    expect(roots.app.dataset.v2Tab).toBe('map');
    roots.tabs.querySelector<HTMLButtonElement>('[data-tab="fiche"]')?.click();
    expect(roots.app.dataset.v2Tab).toBe('fiche');
    expect(ficheKey(roots)).toBe('france');
  });

  it('ligne de base : les niveaux affichés, sans les événements', () => {
    const { poste } = setup();
    expect(poste.currentLevels()).toEqual({ 'situation:energy-stress': 'orange' });
  });

  it('avant les couches critiques : aucun niveau affiché, jamais un vert par défaut (revue)', () => {
    const { roots, poste } = setup();
    poste.update(data({ ready: false, snapshot: { ...data().snapshot, score: 95, situations: [] } }));
    expect(roots.status.textContent).toContain('Calcul du niveau national…');
    expect(roots.themes.querySelector('.fm-vig')).toBeNull();
    expect(roots.fiche.querySelector('.fiche-head .fm-vig')).toBeNull();
    expect(roots.fiche.textContent).toContain('niveau en cours de calcul');
  });
});
