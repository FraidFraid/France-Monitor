// @vitest-environment happy-dom
// Bloc « Événements en cours » de la légende (spec 2026-10-14) : règles cartographiques et d'accessibilité.
import { describe, expect, it } from 'vitest';

import { buildEventsKeyHtml, nestedCirclesSvg } from './events-key.ts';
import type { EventMapPoint } from '../../services/v2-map.ts';

const pt = (id: number, level: EventMapPoint['level'], hollow = false, category = 'security'): EventMapPoint => ({
  id, title: 't', lon: 0, lat: 0, level, radius: 8, hollow, color: [0, 0, 0], category, alert: level === 'rouge' || level === 'orange',
});
const parse = (html: string): HTMLElement => { const d = document.createElement('div'); d.innerHTML = html; return d; };

describe('bloc événements de la légende', () => {
  const points = [pt(1, 'rouge'), pt(2, 'orange', true, 'energy'), pt(3, 'jaune'), pt(4, 'jaune')];

  it('niveaux présents seulement, du plus grave au moins grave, avec signification et nombre', () => {
    const el = parse(buildEventsKeyHtml({ eventsVisible: true, newsVisible: false, points, hiddenLevels: new Set() }));
    const rows = [...el.querySelectorAll<HTMLButtonElement>('[data-key-action^="level:"]')];
    expect(rows.map((r) => r.dataset.keyAction)).toEqual(['level:rouge', 'level:orange', 'level:jaune']);
    expect(rows[0].textContent).toContain('Rouge');
    expect(rows[0].textContent).toContain('vigilance absolue');
    expect(rows[2].querySelector('.mk-n')?.textContent).toBe('2');
    expect(rows[0].getAttribute('aria-pressed')).toBe('true');
  });

  it('niveau masqué : bouton non pressé, compte gardé', () => {
    const el = parse(buildEventsKeyHtml({ eventsVisible: true, newsVisible: false, points, hiddenLevels: new Set(['jaune']) }));
    const jaune = el.querySelector('[data-key-action="level:jaune"]');
    expect(jaune?.getAttribute('aria-pressed')).toBe('false');
    expect(jaune?.querySelector('.mk-n')?.textContent).toBe('2');
  });

  it('rond vide expliqué, cercles emboîtés des sources, pictos des seuls domaines présents parmi les alertes', () => {
    const el = parse(buildEventsKeyHtml({ eventsVisible: true, newsVisible: false, points, hiddenLevels: new Set() }));
    expect(el.textContent).toContain('à confirmer');
    expect(el.querySelector('svg[aria-label^="Sources indépendantes"]')).not.toBeNull();
    const domains = [...el.querySelectorAll('.mk-icons span')].map((s) => s.textContent?.trim());
    expect(domains).toEqual(['Sécurité', 'Énergie']);
  });

  it('bloc articles seul quand la couche Actualités est allumée ; vide si rien n’est allumé', () => {
    const news = parse(buildEventsKeyHtml({ eventsVisible: false, newsVisible: true, points: [], hiddenLevels: new Set() }));
    expect(news.textContent).toContain('Autres articles');
    expect(news.textContent).toContain('Information');
    expect(buildEventsKeyHtml({ eventsVisible: false, newsVisible: false, points, hiddenLevels: new Set() })).toBe('');
  });

  it('aucun tiret cadratin', () => {
    expect(buildEventsKeyHtml({ eventsVisible: true, newsVisible: true, points, hiddenLevels: new Set() })).not.toContain('—');
  });
});

describe('cercles emboîtés', () => {
  it('libellés espacés d’au moins 15 px, tous dans le cadre', () => {
    const el = parse(nestedCirclesSvg([12, 8, 5], ['5 sources et plus', '2 à 4 sources', '1 source'], 'Sources indépendantes'));
    const svg = el.querySelector('svg');
    const h = Number(svg?.getAttribute('height'));
    const ys = [...el.querySelectorAll('text')].map((t) => Number(t.getAttribute('y')));
    expect(ys).toHaveLength(3);
    for (let i = 1; i < ys.length; i += 1) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(15);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(12);
    expect(Math.max(...ys)).toBeLessThanOrEqual(h);
  });
});
