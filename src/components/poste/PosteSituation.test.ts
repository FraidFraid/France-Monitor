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
  vi.restoreAllMocks();
});

const activeTab = (): string | undefined => (document.activeElement instanceof HTMLElement ? document.activeElement.dataset.tab : undefined);

/**
 * happy-dom n'a pas de mise en page : simule main.css (§9) en donnant zéro boîte aux éléments de
 * la liste ou de la fiche quand la disposition les masque (onglets du mobile, volet de la tablette).
 */
function simulateLayoutCss(roots: PosteRoots, layout: 'mobile' | 'tablet'): void {
  const original = Element.prototype.getClientRects;
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element): DOMRectList {
    const { v2Tab, v2Fiche } = roots.app.dataset;
    const listHidden = layout === 'mobile' && v2Tab !== 'list';
    const ficheHidden = layout === 'mobile' ? v2Tab !== 'fiche' && v2Fiche !== 'open' : v2Fiche !== 'open';
    if ((listHidden && roots.list.contains(this)) || (ficheHidden && roots.fiche.contains(this))) {
      return [] as unknown as DOMRectList;
    }
    return original.call(this);
  });
}

/** Situation localisée, avec couche : la fiche porte « Voir sur la carte ». */
function locatedData(): PosteData {
  return data({ snapshot: { ...data().snapshot, situations: [situation({ lon: 2.35, lat: 48.85, activateLayers: ['powerGrid'] })] } });
}

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
    // Ordinateur : la fiche du thème est la fiche par défaut, pas un volet (comportement conservé).
    expect(roots.app.dataset.v2Fiche).toBe('default');
  });

  for (const [label, width] of [['tablette', 820], ['mobile', 390]] as const) {
    it(`${label} : choisir un thème filtre la liste ET ouvre sa fiche en volet ; le même thème la rouvre (relecture finale I3)`, () => {
      const { roots, cb, poste } = setup(width);
      const energy = (): HTMLButtonElement | null => roots.themes.querySelector<HTMLButtonElement>('[data-theme="energy"]');
      energy()?.click();
      expect(cb.onThemeChange).toHaveBeenCalledWith('energy');
      expect(roots.list.textContent).toContain('À traiter · Énergie · 1');
      expect(ficheKey(roots)).toBe('theme:energy');
      expect(roots.app.dataset.v2Fiche).toBe('open');
      poste.close();
      expect(roots.app.dataset.v2Fiche).toBe('default');
      energy()?.click();
      expect(ficheKey(roots)).toBe('theme:energy');
      expect(roots.app.dataset.v2Fiche).toBe('open');
    });
  }

  it('tablette : « Vue générale » filtre sans ouvrir de volet ; une clé theme:<id> ouvre la fiche du thème (I3)', () => {
    const { roots, poste } = setup(820);
    poste.select('theme:security');
    expect(ficheKey(roots)).toBe('theme:security');
    expect(roots.app.dataset.v2Fiche).toBe('open');
    roots.themes.querySelector<HTMLButtonElement>('[data-theme="general"]')?.click();
    roots.themes.querySelector<HTMLButtonElement>('[data-theme="energy"]')?.click();
    roots.themes.querySelector<HTMLButtonElement>('[data-theme="general"]')?.click();
    expect(roots.app.dataset.v2Fiche).toBe('default');
    expect(roots.list.textContent).toContain('À traiter · Vue générale');
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

  it('une citation ouvre une autre fiche : le focus va au titre de la nouvelle fiche, jamais à <body> (correction)', () => {
    const { roots, poste } = setup();
    poste.setBrief(BRIEF, 'fresh', ['energy-stress']);
    const ref = roots.fiche.querySelector<HTMLButtonElement>('.fiche-judgment [data-select="event:42"]');
    ref?.focus();
    ref?.click();
    expect(ficheKey(roots)).toBe('event:42');
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement instanceof HTMLElement && document.activeElement.classList.contains('fiche-name')).toBe(true);
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

  it('tablette : « Voir sur la carte » ferme d’abord le volet, puis active et vole ; focus rendu à la ligne (relecture finale I2)', () => {
    const { roots, cb, poste } = setup(820);
    poste.update(locatedData());
    simulateLayoutCss(roots, 'tablet');
    poste.select('situation:energy-stress');
    const seen: Array<string | undefined> = [];
    cb.onActivateLayers.mockImplementation(() => { seen.push(roots.app.dataset.v2Fiche); });
    cb.onFlyTo.mockImplementation(() => { seen.push(roots.app.dataset.v2Fiche); });
    const action = roots.fiche.querySelector<HTMLButtonElement>('[data-action="map"]');
    action?.focus();
    action?.click();
    expect(cb.onActivateLayers).toHaveBeenCalledWith(['powerGrid']);
    expect(cb.onFlyTo).toHaveBeenCalledWith(2.35, 48.85, 10);
    expect(seen).toEqual(['default', 'default']);
    expect(roots.app.dataset.v2Fiche).toBe('default');
    expect(activeKey()).toBe('situation:energy-stress');
  });

  it('mobile : « Voir sur la carte » ferme le volet et passe à l’onglet Carte AVANT le flyTo ; focus sur l’onglet (I2)', () => {
    const { roots, cb, poste } = setup(390);
    poste.update(locatedData());
    simulateLayoutCss(roots, 'mobile');
    poste.select('situation:energy-stress');
    let atFly: [string | undefined, string | undefined] | null = null;
    cb.onFlyTo.mockImplementation(() => { atFly = [roots.app.dataset.v2Tab, roots.app.dataset.v2Fiche]; });
    const action = roots.fiche.querySelector<HTMLButtonElement>('[data-action="map"]');
    action?.focus();
    action?.click();
    expect(atFly).toEqual(['map', 'default']);
    expect(document.activeElement).not.toBe(document.body);
    expect(activeTab()).toBe('map');
  });

  it('mobile : « Afficher la couche » d’une alerte officielle ferme aussi le volet avant d’activer (I2)', () => {
    const { roots, cb, poste } = setup(390);
    const mix = { timestamp: new Date(0), nuclear: 0, wind: 0, solar: 0, hydro: 0, gas: 0, other: 0, total: 0 };
    poste.update(data({ ecowatt: { signals: { '53': 'red' }, mixes: {}, national: mix, interconnections: [] } }));
    simulateLayoutCss(roots, 'mobile');
    poste.select('official:ecowatt:rouge');
    let atActivate: [string | undefined, string | undefined] | null = null;
    cb.onActivateLayers.mockImplementation(() => { atActivate = [roots.app.dataset.v2Tab, roots.app.dataset.v2Fiche]; });
    roots.fiche.querySelector<HTMLButtonElement>('[data-action="show-layer"]')?.click();
    expect(cb.onActivateLayers).toHaveBeenCalledWith(['powerGrid']);
    expect(atActivate).toEqual(['map', 'default']);
  });

  it('mobile : même règle pour « Voir sur la carte » de la fiche France et « Voir l’aéronef » (I2, extension)', () => {
    const { roots, cb, poste } = setup(390);
    const surge = situation({
      id: 'military-surge-concentration-alert', type: 'MILITARY_SURGE_ALERT', severity: 'critical', title: 'Concentration de vols militaires',
      lat: 47.1, lon: 2.4, activateLayers: ['military'],
    });
    poste.update(data({ alerts: [surge] }));
    const states: Array<[string | undefined, string | undefined]> = [];
    const record = (): void => { states.push([roots.app.dataset.v2Tab, roots.app.dataset.v2Fiche]); };
    cb.onShowFrance.mockImplementation(record);
    cb.onOpenDossier.mockImplementation(() => { record(); return true; });
    poste.select('france');
    roots.fiche.querySelector<HTMLButtonElement>('[data-action="show-france"]')?.click();
    roots.tabs.querySelector<HTMLButtonElement>('[data-tab="list"]')?.click();
    poste.select('alert:military-surge-concentration-alert');
    roots.fiche.querySelector<HTMLButtonElement>('[data-action="dossier"]')?.click();
    expect(states).toEqual([['map', 'default'], ['map', 'default']]);
  });

  it('mobile : fermer le volet depuis l’onglet Carte met le focus sur l’onglet actif, jamais sur <body> (I2)', () => {
    const { roots, poste } = setup(390);
    simulateLayoutCss(roots, 'mobile');
    poste.select('situation:energy-stress');
    roots.tabs.querySelector<HTMLButtonElement>('[data-tab="map"]')?.click();
    expect(roots.app.dataset.v2Fiche).toBe('open');
    const close = roots.fiche.querySelector<HTMLButtonElement>('.fiche-close');
    close?.focus();
    close?.click();
    expect(roots.app.dataset.v2Fiche).toBe('default');
    expect(document.activeElement).not.toBe(document.body);
    expect(activeTab()).toBe('map');
  });

  it('tablette : fermer une fiche sans ligne (thème) met le focus sur le titre de la liste, jamais sur <body> (I2)', () => {
    const { roots } = setup(820);
    simulateLayoutCss(roots, 'tablet');
    roots.themes.querySelector<HTMLButtonElement>('[data-theme="energy"]')?.click();
    expect(roots.app.dataset.v2Fiche).toBe('open');
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(roots.app.dataset.v2Fiche).toBe('default');
    expect(document.activeElement instanceof HTMLElement && document.activeElement.classList.contains('wl-title')).toBe(true);
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
    // Relecture finale m1 : ni indice, ni jauge, ni piliers calculés sur des données absentes.
    expect(roots.fiche.textContent).toContain('Calcul du niveau national…');
    expect(roots.fiche.textContent).not.toContain('Indice de stabilité');
    expect(roots.fiche.querySelector('.frintel-gauge, .frintel-pillars')).toBeNull();
    // La fiche thème dit le chargement, jamais « Rien à traiter ».
    roots.themes.querySelector<HTMLButtonElement>('[data-theme="energy"]')?.click();
    expect(ficheKey(roots)).toBe('theme:energy');
    expect(roots.fiche.textContent).toContain('Chargement des données…');
    expect(roots.fiche.textContent).not.toContain('Rien à traiter');
  });
});
