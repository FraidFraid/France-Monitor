// @vitest-environment happy-dom
// src/components/ThemeBriefPanel.test.ts : points de vigilance Transports sans étiquette sur la carte (03/11/2026) : le clic dans
// l'En bref retient le point (carte centrée, trajets gardés), le second clic le relâche ; la ligne retenue reste marquée au rendu suivant.
import { describe, expect, it } from 'vitest';
import { ThemeBriefPanel, type ThemeBriefData } from './ThemeBriefPanel.ts';
import type { TransportVigilancePoint } from './layer-panel/transport-vigilance.ts';

const point = (n: number, id: string): TransportVigilancePoint => ({
  n, id, mode: 'trafficRail', level: 'rouge', lon: -1.67 + n, lat: 48.1, title: `Axe ${n}`, short: '6 trains', detail: 'Trains très retardés.',
  cause: null, causeTag: 'à vérifier', who: 'SNCF Voyageurs',
});

const data = (points: TransportVigilancePoint[]): ThemeBriefData => ({
  themeName: 'Transports', pastilles: [], items: [], themeLevel: 'orange', changes: [], eventsStatus: null, now: Date.parse('2026-11-03T10:00:00Z'),
  transport: { points, rail: null, situations: null, road: null, urban: null, urbanError: null, air: null, maritime: null, levels: {} },
});

function mounted(points: TransportVigilancePoint[]): { host: HTMLElement; panel: ThemeBriefPanel; picks: Array<string | null> } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const panel = new ThemeBriefPanel(host);
  panel.mount();
  const picks: Array<string | null> = [];
  panel.setOnSelectPoint((sel) => picks.push(sel?.id ?? null));
  panel.show(data(points));
  return { host, panel, picks };
}

const row = (host: HTMLElement, id: string): HTMLElement => host.querySelector(`.tb-point[data-id="${id}"]`) as HTMLElement;

describe('En bref Transports : point retenu au clic', () => {
  it('clic : point retenu avec sa position ; second clic : relâché', () => {
    const { host, picks } = mounted([point(1, 'rail-axe:atlantique')]);
    row(host, 'rail-axe:atlantique').click();
    expect(picks).toEqual(['rail-axe:atlantique']);
    expect(row(host, 'rail-axe:atlantique').classList.contains('is-selected')).toBe(true);
    row(host, 'rail-axe:atlantique').click();
    expect(picks).toEqual(['rail-axe:atlantique', null]);
    expect(row(host, 'rail-axe:atlantique').classList.contains('is-selected')).toBe(false);
  });

  it('nouveau rendu, point renuméroté : la ligne retenue reste marquée (identifiant, pas numéro)', () => {
    const { host, panel } = mounted([point(1, 'a'), point(2, 'b')]);
    row(host, 'b').click();
    panel.update(data([point(1, 'b'), point(2, 'a')]));
    expect(row(host, 'b').classList.contains('is-selected')).toBe(true);
    expect(row(host, 'a').classList.contains('is-selected')).toBe(false);
  });
});
