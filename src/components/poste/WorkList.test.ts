// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { WorkList, renderWorkList, type WorkListModel } from './WorkList.ts';
import { buildWorkQueue, viewWorkQueue, type WorkQueueInput } from '../../services/work-queue.ts';
import type { ThemeId } from '../../services/themes.ts';
import type { ChangeDigestItem, DetectedSituation, IntelEventsState, NewsEvent } from '../../types/index.ts';

const NOW = Date.parse('2026-09-24T08:00:00Z');

function situation(over: Partial<DetectedSituation> = {}): DetectedSituation {
  return {
    id: 'energy-stress', type: 'ENERGY_STRESS', severity: 'high', confidence: 0.8, title: 'Tension énergétique nationale',
    summary: 'Résumé.', affectedZones: [], drivers: [], recommendedActions: [], sourceRefs: [], updatedAt: new Date(NOW), ...over,
  };
}

function event(over: Partial<NewsEvent> = {}): NewsEvent {
  return {
    id: 42, evidenceId: 'E42', title: 'Explosion dans une usine chimique', category: 'security', severity: 'critical',
    status: 'active', firstSeen: '2026-09-24T07:30:00Z', lastSeen: '2026-09-24T07:50:00Z', articleCount: 3,
    sourceCount: 3, independentCount: 3, sourceNames: [], lat: null, lon: null, ...over,
  };
}

function events(over: Partial<IntelEventsState> = {}): IntelEventsState {
  return { events: [], digest: [], totals: {}, anchor: { since: NOW - 3_600_000, kind: 'last-visit' }, fetchedAt: NOW, unavailable: false, ...over };
}

function model(over: Partial<WorkQueueInput> = {}, theme: ThemeId = 'general', now = NOW): WorkListModel {
  const queue = buildWorkQueue({
    situations: [], alerts: [], events: events(), ecowatt: null, meteo: [], floods: [], markets: [],
    baseline: null, firstSeen: new Map(), lang: 'fr', ...over,
  });
  return { view: viewWorkQueue(queue, theme, false), selectedKey: null, ready: true, lang: 'fr', now };
}

function mount(): { root: HTMLElement; list: WorkList } {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return { root, list: new WorkList(root) };
}

const activeKey = (): string | undefined => (document.activeElement instanceof HTMLElement ? document.activeElement.dataset.key : undefined);

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** happy-dom n'a pas de mise en page : simule un conteneur en display: none (aucune boîte). */
function hideWithin(container: HTMLElement): void {
  const original = Element.prototype.getClientRects;
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element): DOMRectList {
    return container.contains(this) ? ([] as unknown as DOMRectList) : original.call(this);
  });
}

describe('renderWorkList (spec §7.2, §7.4)', () => {
  it('titre, badge et méta de chaque ligne (niveau réservé aux lecteurs d’écran)', () => {
    const html = renderWorkList(model({ events: events({
      events: [event()],
      digest: [{ event: event(), kinds: ['created'], latestAt: '2026-09-24T07:40:00Z', severityFrom: null, independentFrom: null }],
    }) }));
    expect(html).toContain('À traiter · Vue générale · 1');
    expect(html).toContain('>NOUVEAU</span>');
    expect(html).toContain('<span class="visually-hidden">Rouge · </span>');
    expect(html).toContain('France · il y a 10 min · 3 sources');
  });

  it('rien à traiter, événements indisponibles, voir les autres, garde hors thème', () => {
    const empty = renderWorkList(model({ events: events({ unavailable: true }) }, 'health'));
    expect(empty).toContain('Rien à traiter. 0 élément suivi est au vert.');
    expect(empty).toContain('Événements indisponibles pour le moment');
    // Avant les couches critiques, une liste vide ne rassure pas : « chargement », pas « rien à traiter » (revue).
    const loading = renderWorkList({ ...model({}, 'health'), ready: false });
    expect(loading).toContain('Chargement des données…');
    expect(loading).not.toContain('Rien à traiter');
    const many = Array.from({ length: 14 }, (_, i) => situation({ id: `s${i}` }));
    expect(renderWorkList(model({ situations: many }))).toContain('Voir les 2 autres');
    const guarded = renderWorkList(model({ situations: [situation({ severity: 'critical' })] }, 'health'));
    expect(guarded).toContain('data-guard="energy"');
    expect(guarded).toContain('Hors de ce thème : 1 rouge (Énergie)');
  });

  it('échappe le titre et la clé de ligne (revue)', () => {
    const html = renderWorkList(model({ situations: [situation({ id: 'x" onfocus="alert(1)', title: '<img src=x onerror=alert(1)>' })] }));
    expect(html).not.toContain('<img');
    expect(html).toContain('data-key="situation:x&quot; onfocus=&quot;alert(1)"');
  });
});

describe('WorkList — clavier et focus (spec §9)', () => {
  it('flèches pour se déplacer, clic ou Entrée pour ouvrir la fiche', () => {
    const { root, list } = mount();
    const onSelect = vi.fn();
    list.setOnSelect(onSelect);
    list.update(model({ situations: [situation({ id: 'a' }), situation({ id: 'b' })] }));
    const rows = [...root.querySelectorAll<HTMLButtonElement>('.wl-item')];
    rows[0].focus();
    rows[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    expect(document.activeElement).toBe(rows[1]);
    rows[1].click();
    expect(onSelect).toHaveBeenCalledWith('situation:b');
  });

  it('le focus survit à vingt reconstructions, puis passe à la première ligne si la sienne disparaît (revue)', () => {
    const { root, list } = mount();
    const at = (now: number, ids: string[]): WorkListModel => model({
      situations: ids.map((id) => situation({ id })),
      firstSeen: new Map(ids.map((id): [string, number] => [`situation:${id}`, NOW - 10 * 60_000])),
    }, 'general', now);
    list.update(at(NOW, ['a', 'b', 'c']));
    root.querySelectorAll<HTMLButtonElement>('.wl-item')[1].focus();
    // « depuis 11 min », « depuis 12 min »… : chaque mise à jour reconstruit réellement la liste.
    for (let i = 1; i <= 20; i += 1) list.update(at(NOW + i * 60_000, ['a', 'b', 'c']));
    expect(activeKey()).toBe('situation:b');
    list.update(at(NOW + 30 * 60_000, ['a', 'c']));
    expect(activeKey()).toBe('situation:a');
  });

  it('focusRow : false et aucun focus si la ligne n’est pas affichée (liste masquée, relecture finale I2)', () => {
    const { root, list } = mount();
    list.update(model({ situations: [situation()] }));
    expect(list.focusRow('situation:energy-stress')).toBe(true);
    expect(activeKey()).toBe('situation:energy-stress');
    root.querySelector<HTMLElement>('.wl-item')?.blur();
    hideWithin(root);
    expect(list.focusRow('situation:energy-stress')).toBe(false);
    expect(activeKey()).toBeUndefined();
    expect(list.focusTitle()).toBe(false);
  });

  it('ne réécrit pas le DOM quand rien ne change', () => {
    const { root, list } = mount();
    list.update(model({ situations: [situation()] }));
    const row = root.querySelector('.wl-item');
    list.update(model({ situations: [situation()] }));
    expect(root.querySelector('.wl-item')).toBe(row);
  });

  it('« Voir les autres » et la garde remontent leur action', () => {
    const { root, list } = mount();
    const onShowAll = vi.fn();
    const onGuard = vi.fn();
    list.setOnShowAll(onShowAll);
    list.setOnGuard(onGuard);
    const cyber = Array.from({ length: 13 }, (_, i) => situation({ id: `c${i}`, type: 'CYBER_PRESSURE' }));
    list.update(model({ situations: [...cyber, situation({ id: 'e', severity: 'critical' })] }, 'security'));
    root.querySelector<HTMLButtonElement>('[data-more]')?.click();
    root.querySelector<HTMLButtonElement>('[data-guard]')?.click();
    expect(onShowAll).toHaveBeenCalledWith(true);
    expect(onGuard).toHaveBeenCalledWith('energy');
  });
});

describe('ligne « à confirmer » (spec 2026-09-28 § 4.7)', () => {
  it('mention et niveau affiché', () => {
    const html = renderWorkList(model({ events: events({ events: [event({ severity: 'medium', peakSeverity: 'critical', independentCount: 1, sourceCount: 1 })] }) }));
    expect(html).toContain('À CONFIRMER');
    expect(html).toContain('<span class="visually-hidden">Jaune · </span>');
    expect(html).toContain('wl-bar--jaune');
  });
});

describe('ligne de la refonte 29/09 (spec 2026-09-29 § 6)', () => {
  it('lieu · heure du dernier article · sources ; le niveau seulement pour les lecteurs d’écran', () => {
    const html = renderWorkList(model({ events: events({ events: [event({ severity: 'high', lastSeen: '2026-09-24T06:00:00Z', independentCount: 5 })] }) }));
    expect(html).toContain('France · il y a 2 h · 5 sources');
    expect(html).toContain('<span class="visually-hidden">Orange · </span>');
  });

  it('une seule étiquette : À CONFIRMER passe avant AGGRAVÉ', () => {
    const e = event({ severity: 'medium', peakSeverity: 'critical', independentCount: 1 });
    const digest: ChangeDigestItem[] = [{ event: e, kinds: ['escalated'], latestAt: '2026-09-24T07:50:00Z', severityFrom: 'low', independentFrom: null }];
    const html = renderWorkList(model({ events: events({ events: [e], digest }) }));
    expect(html).toContain('À CONFIRMER');
    expect(html).not.toContain('AGGRAVÉ');
  });

  it('groupe replié « Hors de France »', () => {
    const html = renderWorkList(model({ events: events({ events: [event({ id: 9, title: 'Inondations à Bangkok', zone: 'etranger' })] }) }));
    expect(html).toContain('<details class="wl-foreign">');
    expect(html).toContain('Hors de France : 1');
    expect(html).toContain('data-key="event:9"');
  });
});

describe('groupe « Hors de France » (relecture finale I2)', () => {
  const foreignModel = (now: number, foreignOpen?: boolean): WorkListModel => ({
    ...model({ events: events({ events: [
      event({ id: 1, title: 'Explosion à Rouen' }),
      event({ id: 9, title: 'Inondations à Bangkok', zone: 'etranger' }),
    ] }) }, 'general', now),
    ...(foreignOpen === undefined ? {} : { foreignOpen }),
  });

  it('ouvert, il le reste après une mise à jour 5 minutes plus tard', () => {
    const { root, list } = mount();
    let open = false;
    list.setOnForeignToggle((o) => { open = o; });
    list.update(foreignModel(NOW));
    const details = root.querySelector('details.wl-foreign');
    expect(details).not.toBeNull();
    details?.setAttribute('open', '');
    details?.dispatchEvent(new Event('toggle'));
    expect(open).toBe(true);
    // Le poste repasse l'état ; la liste est mise à jour (« il y a … » change).
    list.update(foreignModel(NOW + 5 * 60_000, open));
    expect(root.querySelector('details.wl-foreign')?.hasAttribute('open')).toBe(true);
    expect(renderWorkList(foreignModel(NOW, true))).toContain('<details class="wl-foreign" open>');
  });

  it('flèche bas depuis la dernière ligne visible ne va pas dans le groupe replié', () => {
    const { root, list } = mount();
    list.update(foreignModel(NOW));
    const original = Element.prototype.getClientRects;
    vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function (this: Element): DOMRectList {
      return this.closest('details.wl-foreign:not([open])') ? ([] as unknown as DOMRectList) : original.call(this);
    });
    const visible = root.querySelector<HTMLElement>('[data-key="event:1"]');
    visible?.focus();
    expect(activeKey()).toBe('event:1');
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(activeKey()).toBe('event:1');
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    expect(activeKey()).toBe('event:1');
  });
});
