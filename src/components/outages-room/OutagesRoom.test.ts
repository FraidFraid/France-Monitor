// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import type { OutagesNowResponse } from '../../types/index.ts';
import { OutagesRoom } from './OutagesRoom.ts';

const body: OutagesNowResponse = {
  generatedAt: '2026-10-21T12:30:00Z',
  outages: [{ id: 'mobile|op:Orange', network: 'mobile', scope: 'operateur', operator: 'Orange', dept: null, label: 'Orange', level: 'orange',
    since: '2026-10-21T10:00:00Z', national: true, measured: false, rung: 'signalee', evidence: [] }],
  journal: [{ at: '2026-10-21T12:01:00Z', kind: 'nouvelle', id: 'mobile|op:Orange', network: 'mobile', name: 'Orange', dept: null, level: 'orange', rung: 'signalee' }],
  sources: [], errors: [],
};

describe('OutagesRoom', () => {
  it('clic sur une entrée du fil : onFocus avec la panne et détail ouvert ; « ← fil » revient', () => {
    const host = document.createElement('div');
    const room = new OutagesRoom(host);
    const focused: string[] = [];
    room.setOnFocus((o) => focused.push(o.id));
    room.update(body);
    (host.querySelector('[data-outage="mobile|op:Orange"]') as HTMLElement).click();
    expect(focused).toEqual(['mobile|op:Orange']);
    expect(host.querySelector('.orm-detail')).not.toBeNull();
    (host.querySelector('[data-back]') as HTMLElement).click();
    expect(host.querySelector('.orm-detail')).toBeNull();
    room.destroy();
    expect(host.children).toHaveLength(0);
  });
  it('clic sur une case réseau : onFilter (re-clic : null) ; case grise des réseaux de presse seule sans panne : rien', () => {
    const host = document.createElement('div');
    const room = new OutagesRoom(host);
    const filters: Array<string | null> = [];
    room.setOnFilter((n) => filters.push(n));
    room.update(body);
    (host.querySelector('[data-net="mobile"]') as HTMLElement).click();
    (host.querySelector('[data-net="mobile"]') as HTMLElement).click();
    expect(host.querySelector('[data-net="gaz"]')).toBeNull();
    (host.querySelector('.orm-net--rest') as HTMLElement).click();
    expect(filters).toEqual(['mobile', null]);
  });
});

describe('OutagesRoom : frise, rejeu et cascades (lot 3)', () => {
  it('frise affichée en bas ; clic dans la frise : rejeu à l’instant cliqué ; « maintenant » : retour au direct', () => {
    const host = document.createElement('div');
    const room = new OutagesRoom(host);
    const cursors: Array<number | null> = [];
    room.setOnCursor((t) => cursors.push(t));
    room.update({ ...body, cascades: [{ key: 'dept:13', dept: '13', national: false, level: 'orange', steps: [
      { id: 'a', network: 'electricite', since: '2026-10-21T08:12:00Z' }, { id: 'b', network: 'mobile', since: '2026-10-21T08:40:00Z' }] }] });
    room.setJournal(body.journal);
    expect(host.querySelector('.orm-frise')).not.toBeNull();
    expect(host.querySelector('.orm-cascade')).not.toBeNull();
    const area = host.querySelector('[data-frise]') as HTMLElement;
    area.getBoundingClientRect = () => ({ left: 100, width: 400, top: 0, height: 50, right: 500, bottom: 50, x: 100, y: 0, toJSON: () => ({}) });
    // Maintenant au milieu de la frise (48 h) : le quart gauche = 12 h avant ; un clic dans la partie à venir revient au direct.
    area.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 200 }));
    expect(cursors).toHaveLength(1);
    expect(Math.abs((cursors[0] ?? 0) - (Date.now() - 12 * 3600_000))).toBeLessThan(5000);
    (host.querySelector('[data-now]') as HTMLElement).click();
    expect(cursors.at(-1)).toBeNull();
    const again = host.querySelector('[data-frise]') as HTMLElement;
    again.getBoundingClientRect = area.getBoundingClientRect;
    again.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 450 }));
    expect(cursors.at(-1)).toBeNull();
  });
});

describe('OutagesRoom sous la barre des pastilles (03/11/2026)', () => {
  it('barre passée sur deux lignes après le rendu : la salle descend d’autant, sans attendre de nouvelles données', () => {
    const fire = { cb: (): void => undefined };
    const observed: Element[] = [];
    vi.stubGlobal('ResizeObserver', class {
      constructor(cb: () => void) { fire.cb = cb; }
      observe(el: Element): void { observed.push(el); }
      disconnect(): void { observed.length = 0; }
    });
    try {
      const map = document.createElement('div');
      const pills = document.createElement('div');
      pills.className = 'floating-panel-switcher';
      const host = document.createElement('div');
      map.append(pills, host);
      let bottom = 60;
      pills.getBoundingClientRect = () => ({ bottom } as DOMRect);
      host.getBoundingClientRect = () => ({ top: 0 } as DOMRect);
      const room = new OutagesRoom(host);
      const orm = host.querySelector('.orm') as HTMLElement;
      expect(orm.style.getPropertyValue('--orm-top')).toBe('68px');
      expect(observed).toEqual([pills, host]);
      bottom = 112;
      fire.cb();
      expect(orm.style.getPropertyValue('--orm-top')).toBe('120px');
      room.destroy();
      expect(observed).toEqual([]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
