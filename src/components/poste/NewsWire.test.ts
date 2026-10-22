// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { NewsWire, WIRE_MAX_ITEMS, renderNewsWire, wireDurationSeconds, wireItems as wireItemsAt, wireTime } from './NewsWire.ts';
import type { WorkItem } from '../../services/work-queue.ts';
import type { NewsEvent } from '../../types/index.ts';

const NOW = Date.parse('2026-10-12T08:00:00Z');
const wireItems = (items: readonly WorkItem[]) => wireItemsAt(items, NOW);

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

const ALERT_REF = { kind: 'situation', situation: {} } as unknown as WorkItem['ref'];

describe('wireItems (fil des alertes, 12/10/2026)', () => {
  it('tous thèmes, jaune et au-delà, sans les cours de marché ; alertes : rouges en tête, puis par date', () => {
    const items = wireItems([
      item({ key: 'a', level: 'jaune', theme: 'health', since: NOW - 3_600_000, ref: ALERT_REF }),
      item({ key: 'b', level: 'vert', since: NOW, ref: ALERT_REF }),
      item({ key: 'c', level: 'rouge', theme: 'environment', since: NOW - 60_000, ref: ALERT_REF }),
      item({ key: 'd', level: 'orange', since: null, ref: ALERT_REF }),
      item({ key: 'e', level: 'orange', ref: { kind: 'market', line: { symbol: 'BZ=F', name: 'Brent', price: 80, changePercent: 5, kind: 'energy' } } }),
      item({ key: 'f', level: 'jaune', since: NOW - 60_000, ref: ALERT_REF }),
      item({ key: 'g', level: 'rouge', since: NOW - 7_200_000, ref: ALERT_REF }),
    ]);
    // Rouges d'abord, puis orange, puis jaunes ; dans chaque niveau, la plus récente d'abord (date inconnue en dernier).
    expect(items.map((i) => i.key)).toEqual(['c', 'g', 'd', 'f', 'a']);
  });

  it(`au plus ${WIRE_MAX_ITEMS} dépêches`, () => {
    const many = Array.from({ length: 30 }, (_, n) => item({ key: `k${n}`, since: NOW - n * 1000 }));
    expect(wireItems(many)).toHaveLength(WIRE_MAX_ITEMS);
  });

  it('jaunes en appoint : les alertes orange et rouges passent toujours, même plus anciennes que dix jaunes récentes', () => {
    const jaunes = Array.from({ length: 10 }, (_, n) => item({ key: `j${n}`, level: 'jaune', since: NOW - n * 1000, ref: ALERT_REF }));
    const graves = [item({ key: 'o', level: 'orange', since: NOW - 86_000_000, ref: ALERT_REF }), item({ key: 'r', level: 'rouge', since: NOW - 90_000_000, ref: ALERT_REF })];
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

describe('alertes distinctes des actualités (13/10/2026)', () => {
  const SITUATION = { kind: 'situation', situation: {} } as unknown as WorkItem['ref'];
  const alert = (key: string, level: WorkItem['level'], since: number | null = NOW): WorkItem => item({ key, level, since, ref: SITUATION });
  const news = (key: string, level: WorkItem['level'], since: number | null = NOW): WorkItem => item({ key, level, since });

  it('alertes (situations, surveillance, vigilances) d’abord, triées par gravité puis date, puis les actualités', () => {
    const items = wireItems([
      news('n-rouge', 'rouge', NOW), alert('a-orange', 'orange', NOW), news('n-orange', 'orange', NOW),
      item({ key: 'a-officiel', level: 'jaune', ref: { kind: 'official', group: {} } as unknown as WorkItem['ref'] }),
      item({ key: 'a-surv', level: 'rouge', since: NOW - 60_000, ref: { kind: 'alert', situation: {} } as unknown as WorkItem['ref'] }),
    ]);
    expect(items.map((i) => [i.key, i.type])).toEqual([
      ['a-surv', 'alerte'], ['a-orange', 'alerte'], ['a-officiel', 'alerte'], ['n-rouge', 'actu'], ['n-orange', 'actu'],
    ]);
  });

  it('les actualités gardent au moins 4 places quand les alertes débordent', () => {
    const alerts = Array.from({ length: 12 }, (_, n) => alert(`a${n}`, 'rouge', NOW - n * 1000));
    const items = wireItems([...alerts, ...['n1', 'n2', 'n3', 'n4', 'n5'].map((k, n) => news(k, 'jaune', NOW - n * 5000))]);
    expect(items).toHaveLength(WIRE_MAX_ITEMS);
    expect(items.filter((i) => i.type === 'actu').map((i) => i.key)).toEqual(['n1', 'n2', 'n3', 'n4']);
  });

  it('actualités : les plus fraîches d’abord, quel que soit le niveau ; plus de 6 h sans nouvel article : hors du fil (22/10/2026)', () => {
    const H = 3_600_000;
    const items = wireItems([
      news('hier-soir-rouge', 'rouge', NOW - 16 * H), news('matin-orange', 'orange', NOW - 2 * H),
      news('frais-jaune', 'jaune', NOW - 10 * 60_000), news('rouge-recent', 'rouge', NOW - H), news('sans-date', 'orange', null),
    ]);
    expect(items.map((i) => i.key)).toEqual(['frais-jaune', 'rouge-recent', 'matin-orange']);
  });

  it('peu d’actualités : les alertes prennent les places libres', () => {
    const alerts = Array.from({ length: 12 }, (_, n) => alert(`a${n}`, 'orange', NOW - n * 1000));
    const items = wireItems([...alerts, news('n1', 'jaune')]);
    expect(items.filter((i) => i.type === 'alerte')).toHaveLength(WIRE_MAX_ITEMS - 1);
  });

  it('rendu : étiquette ALERTE et fond teinté ; repère ACTU entre les groupes, dans les deux passages ; URGENT en rouge', () => {
    const html = renderNewsWire(wireItems([alert('a', 'orange'), alert('r', 'rouge'), news('n', 'orange')]), NOW, 'fr');
    expect(html).toContain('class="nw-item nw-item--orange nw-item--alert"');
    expect(html).toContain('<span class="nw-alert-tag" aria-hidden="true">ALERTE</span>');
    expect(html).toContain('<span class="visually-hidden">Alerte, </span>');
    expect(html).toContain('<span class="visually-hidden">Actualité, </span>');
    expect(html.match(/class="nw-sep"/g)).toHaveLength(2);
    const urgent = html.slice(html.indexOf('data-wire-key="r"'), html.indexOf('</button>', html.indexOf('data-wire-key="r"')));
    expect(urgent).toContain('URGENT');
    expect(urgent).not.toContain('ALERTE');
    expect(html).not.toContain('—');
  });

  it('sans alerte, ou sans actualité : aucun repère ACTU', () => {
    expect(renderNewsWire(wireItems([news('n', 'orange')]), NOW, 'fr')).not.toContain('nw-sep');
    expect(renderNewsWire(wireItems([alert('a', 'orange')]), NOW, 'fr')).not.toContain('nw-sep');
  });
});
