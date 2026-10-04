// src/components/FiresPanel.test.ts : coquille du panneau Feux de forêt réécrit (spec 2026-10-04 environnement § 2.4). Remplace les
// tests de l'ancien panneau (observation multi-capteurs, interrupteur radar 2D) : MTG-FRP et GIBS restent des options, le radar 2D
// devient la couche Radar météo, la hauteur du panache est gardée dans chaque foyer.
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocatedFireIncident } from '../types/index.ts';
import { ENV_FIXTURE_NOW, FIRES_FIXTURE, FIRE_IMPACTS_FIXTURE, RADAR_COLUMN_FIXTURE } from './layer-panel/environment.fixture.ts';

const radar = vi.hoisted(() => ({ fetchRadarColumn: vi.fn() }));
const impacts = vi.hoisted(() => ({ fetchFireImpacts: vi.fn() }));
vi.mock('../services/radar-column.ts', () => radar);
vi.mock('../services/environment-fires.ts', async (original) => ({ ...(await original<object>()), ...impacts }));
vi.mock('../services/wildfire-enrich.ts', () => ({ enrichWithLlm: vi.fn(async <T>(d: T) => d) }));

const { FiresPanel } = await import('./FiresPanel.ts');
type Panel = InstanceType<typeof FiresPanel>;

/** Grand incident construit (aucun ne franchit la porte le 04/10) : 64 détections, 512 MW, Le Porge (Gironde). */
const INCIDENT: LocatedFireIncident = {
  id: 'inc-porge', centroidLat: 44.88, centroidLon: -1.12, bboxMinLat: 44.86, bboxMaxLat: 44.9, bboxMinLon: -1.15, bboxMaxLon: -1.09,
  detectionsCount: 64, frpMean: 8, frpMax: 41, frpTotal: 512, confidenceMax: 'nominal', startDatetime: '2026-10-04T01:20:00Z',
  endDatetime: '2026-10-04T03:00:00Z', durationMinutes: 100, satellites: ['Suomi NPP', 'NOAA-20'], hasNightDetection: true, nearUrban: false,
  clusterMethod: 'dbscan', epsKm: 3, minPoints: 2, score: { severityScore: 40, impactScore: 20, labels: [] }, detectionIds: [],
  deptCodes: ['33'], communes: ['Le Porge'],
};

const OPTIONS = { gibs: false, mtgFrp: false, echoTops: false, echoTopsAvailable: true, forestDangerFill: false };
const state = (incidents: LocatedFireIncident[] = []) => ({
  fires: { fires: { data: FIRES_FIXTURE(), error: null, fetchedAt: ENV_FIXTURE_NOW } }, incidents, mtgFrp: null, options: OPTIONS,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(ENV_FIXTURE_NOW);
  radar.fetchRadarColumn.mockResolvedValue(RADAR_COLUMN_FIXTURE());
  impacts.fetchFireImpacts.mockResolvedValue({ data: FIRE_IMPACTS_FIXTURE(), error: null });
});
afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); document.body.innerHTML = ''; localStorage.clear(); });

function mount(): { c: HTMLElement; p: Panel } {
  const c = document.createElement('div');
  document.body.appendChild(c);
  const p = new FiresPanel(c);
  p.mount();
  return { c, p };
}

const flush = async (): Promise<void> => { for (let i = 0; i < 5; i += 1) await Promise.resolve(); };

describe('FiresPanel', () => {
  it('panneau .lp de classe fires-panel-modal, onglets Veille et Dossier ; aucun « TEMPS RÉEL » ni « latence ~1h » ni radar 2D', () => {
    const { c, p } = mount();
    p.show(null);
    expect(c.querySelector('.lp.fires-panel-modal .lp-title')?.textContent).toBe('Feux de forêt');
    p.update(state());
    expect([...c.querySelectorAll('[data-tab]')].map((t) => t.getAttribute('data-tab'))).toEqual(['veille', 'dossier']);
    expect(c.textContent).not.toMatch(/temps réel|latence ~1h|Réflectivité radar 2D/i);
  });
  it('options de la carte : sommets d’écho, GIBS, MTG-FRP, météo des forêts, chacune rappelée avec l’état inverse', () => {
    const { c, p } = mount();
    const calls: string[] = [];
    p.setOnEchoTops((on) => calls.push(`echo:${on}`));
    p.setOnGibs((on) => calls.push(`gibs:${on}`));
    p.setOnMtgFrp((on) => calls.push(`mtg:${on}`));
    p.setOnForestDangerFill((on) => calls.push(`mdf:${on}`));
    p.show(state());
    for (const sel of ['[data-gibs]', '[data-mtg]', '[data-forest-fill]']) (c.querySelector(sel) as HTMLElement).click();
    (c.querySelector('details[data-plume-foyer] [data-echo-tops]') as HTMLElement).click();
    expect(calls).toEqual(['gibs:true', 'mtg:true', 'mdf:true', 'echo:true']);
  });
  it('« Hauteur du panache » : profil lu à la première ouverture du repli d’un foyer, daté, démonstration ; panne dite', async () => {
    const { c, p } = mount();
    p.show(state());
    const first = FIRES_FIXTURE().foyers[0];
    const details = c.querySelector(`details[data-plume-foyer="${first.id}"]`) as HTMLDetailsElement;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    expect(radar.fetchRadarColumn).toHaveBeenCalledWith(first.lat, first.lon);
    await flush();
    const opened = c.querySelector(`details[data-plume-foyer="${first.id}"]`) as HTMLDetailsElement;
    expect(opened.open).toBe(true);
    expect(opened.textContent).toContain('DÉMONSTRATION');
    expect(opened.textContent).toContain('NIMES');
    radar.fetchRadarColumn.mockResolvedValueOnce(null);
    const second = FIRES_FIXTURE().foyers[1];
    const other = c.querySelector(`details[data-plume-foyer="${second.id}"]`) as HTMLDetailsElement;
    other.open = true;
    other.dispatchEvent(new Event('toggle'));
    await flush();
    expect(c.querySelector(`details[data-plume-foyer="${second.id}"]`)?.textContent).toContain('indisponible');
  });
  it('foyer cliqué : recentrage ; sans gestionnaire, lignes non cliquables', () => {
    const { c, p } = mount();
    const onFoyer = vi.fn();
    p.setOnFocusFoyer(onFoyer);
    p.show(state());
    const first = FIRES_FIXTURE().foyers[0];
    (c.querySelector(`.lp-row[data-foyer="${first.id}"]`) as HTMLElement).click();
    expect(onFoyer).toHaveBeenCalledWith(expect.objectContaining({ id: first.id, dept: first.dept }));
    const other = mount();
    other.p.show(state());
    expect(other.c.querySelector('.lp-row[data-foyer]')).toBeNull();
  });
  it('dossier d’un grand feu : onglet ouvert, observé tout de suite, puis communes à moins de 10 km ; incident inconnu : faux', async () => {
    const { c, p } = mount();
    p.update(state([INCIDENT]));
    expect(p.openDossier('inconnu')).toBe(false);
    expect(p.openDossier('inc-porge')).toBe(true);
    expect(p.isVisible()).toBe(true);
    expect(c.querySelector('[data-tab="dossier"]')?.getAttribute('aria-selected')).toBe('true');
    expect(impacts.fetchFireImpacts).toHaveBeenCalledWith(44.88, -1.12);
    await flush();
    expect(c.textContent).toContain('Le Porge');
    expect(c.textContent).toContain('Aucune estimation de maisons menacées ni d’évacués');
  });
  it('fermer une seule fois ; silencieux sans rappel ; destroy retire', () => {
    const { c, p } = mount();
    const onClose = vi.fn();
    p.setOnClose(onClose);
    p.show(state());
    (c.querySelector('.lp-close') as HTMLButtonElement).click();
    p.hide({ silent: true });
    expect(onClose).toHaveBeenCalledTimes(1);
    p.destroy();
    expect(c.querySelector('.lp')).toBeNull();
  });
});
