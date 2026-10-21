// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
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
  it('clic sur une case réseau : onFilter (re-clic : null) ; case sans source : rien', () => {
    const host = document.createElement('div');
    const room = new OutagesRoom(host);
    const filters: Array<string | null> = [];
    room.setOnFilter((n) => filters.push(n));
    room.update(body);
    (host.querySelector('[data-net="mobile"]') as HTMLElement).click();
    (host.querySelector('[data-net="mobile"]') as HTMLElement).click();
    (host.querySelector('[data-net="gaz"]') as HTMLElement).click();
    expect(filters).toEqual(['mobile', null, 'gaz']);
  });
});
