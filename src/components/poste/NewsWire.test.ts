// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { NewsWire, WIRE_MAX_ITEMS, renderNewsWire, wireDurationSeconds, wireItems, wireTime } from './NewsWire.ts';
import type { WorkItem } from '../../services/work-queue.ts';
import type { NewsEvent } from '../../types/index.ts';

const NOW = Date.parse('2026-10-12T08:00:00Z');

const EVENT: NewsEvent = {
  id: 42, evidenceId: 'E42', title: 'Explosion dans une usine chimique', category: 'security', severity: 'critical',
  status: 'active', firstSeen: '2026-10-12T07:30:00Z', lastSeen: '2026-10-12T07:50:00Z', articleCount: 3,
  sourceCount: 3, independentCount: 3, sourceNames: [], lat: null, lon: null,
};

function item(over: Partial<WorkItem> = {}): WorkItem {
  return {
    key: 'event:42', level: 'orange', title: 'Explosion dans une usine chimique', place: 'Rhône', since: NOW - 600_000,
    independentSources: 3, theme: 'security', badge: null, ref: { kind: 'event', event: EVENT }, ...over,
  };
}

describe('wireItems (fil des alertes, 12/10/2026)', () => {
  it('tous thèmes, jaune et au-delà, sans les cours de marché ; rouges en tête, puis par date', () => {
    const items = wireItems([
      item({ key: 'a', level: 'jaune', theme: 'health', since: NOW - 3_600_000 }),
      item({ key: 'b', level: 'vert', since: NOW }),
      item({ key: 'c', level: 'rouge', theme: 'environment', since: NOW - 60_000 }),
      item({ key: 'd', level: 'orange', since: null }),
      item({ key: 'e', level: 'orange', ref: { kind: 'market', line: { symbol: 'BZ=F', name: 'Brent', price: 80, changePercent: 5, kind: 'energy' } } }),
      item({ key: 'f', level: 'jaune', since: NOW - 60_000 }),
      item({ key: 'g', level: 'rouge', since: NOW - 7_200_000 }),
    ]);
    // Rouges d'abord, puis orange, puis jaunes ; dans chaque niveau, la plus récente d'abord (date inconnue en dernier).
    expect(items.map((i) => i.key)).toEqual(['c', 'g', 'd', 'f', 'a']);
  });

  it(`au plus ${WIRE_MAX_ITEMS} dépêches`, () => {
    const many = Array.from({ length: 30 }, (_, n) => item({ key: `k${n}`, since: NOW - n * 1000 }));
    expect(wireItems(many)).toHaveLength(WIRE_MAX_ITEMS);
  });

  it('jaunes en appoint : les alertes orange et rouges passent toujours, même plus anciennes que dix jaunes récentes', () => {
    const jaunes = Array.from({ length: 10 }, (_, n) => item({ key: `j${n}`, level: 'jaune', since: NOW - n * 1000 }));
    const graves = [item({ key: 'o', level: 'orange', since: NOW - 86_000_000 }), item({ key: 'r', level: 'rouge', since: NOW - 90_000_000 })];
    const keys = wireItems([...jaunes, ...graves]).map((i) => i.key);
    expect(WIRE_MAX_ITEMS).toBe(8);
    expect(keys.slice(0, 2)).toEqual(['r', 'o']);
    expect(keys.slice(2)).toEqual(['j0', 'j1', 'j2', 'j3', 'j4', 'j5']);
  });
});

describe('rendu du fil', () => {
  it('heure de Paris dans les 24 h, sinon le jour ; rien si inconnue', () => {
    expect(wireTime(Date.parse('2026-10-12T07:42:00Z'), NOW)).toBe('09:42');
    expect(wireTime(Date.parse('2026-10-10T07:42:00Z'), NOW)).toBe('10/10');
    expect(wireTime(null, NOW)).toBe('');
  });

  it('deux passages du fil pour un défilement continu, le second caché des lecteurs d’écran et du clavier', () => {
    const html = renderNewsWire(wireItems([item()]), NOW, 'fr');
    expect(html.match(/class="nw-run"/g)).toHaveLength(2);
    expect(html).toContain('<ul class="nw-run" aria-hidden="true">');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('<span class="visually-hidden">Orange : </span>');
    expect(renderNewsWire([], NOW, 'fr')).toBe('');
  });

  it('dépêche rouge : étiquette URGENT à la place du voyant ; les autres gardent leur voyant', () => {
    const html = renderNewsWire(wireItems([item({ key: 'r', level: 'rouge' }), item({ key: 'o', level: 'orange' })]), NOW, 'fr');
    expect(html).toContain('class="nw-item nw-item--rouge"');
    expect(html).toContain('<span class="nw-urgent" aria-hidden="true">URGENT</span>');
    expect(html).not.toContain('nw-dot--rouge');
    expect(html).toContain('nw-dot--orange');
    expect(html).toContain('<span class="visually-hidden">Rouge : </span>');
  });

  it('vitesse de lecture constante : un fil plus long dure plus longtemps, entre 25 et 300 s', () => {
    const one = wireDurationSeconds(wireItems([item()]));
    const many = wireDurationSeconds(wireItems(Array.from({ length: 10 }, (_, n) => item({ key: `k${n}` }))));
    expect(one).toBe(25);
    expect(many).toBeGreaterThan(one);
    expect(many).toBeLessThanOrEqual(300);
  });

  it('un clic sur une dépêche ouvre sa fiche ; pas de nouveau rendu sans changement', () => {
    const root = document.createElement('div');
    const wire = new NewsWire(root);
    const onSelect = vi.fn();
    wire.setOnSelect(onSelect);
    const items = wireItems([item()]);
    wire.update(items, NOW, 'fr');
    const first = root.firstElementChild;
    wire.update(items, NOW, 'fr');
    expect(root.firstElementChild).toBe(first);
    root.querySelector<HTMLButtonElement>('[data-wire-key="event:42"]')?.click();
    expect(onSelect).toHaveBeenCalledWith('event:42');
  });
});
