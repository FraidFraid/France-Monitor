import { describe, expect, it } from 'vitest';
import type { OutageJournalEntry, OutageNow } from '../../types/index.ts';
import { activeAt, cascadeHtml, friseHtml, timelineBars } from './timeline.ts';

const NOW = Date.parse('2026-10-21T16:00:00Z');
const H = 3600_000;
const iso = (h: number) => new Date(NOW - h * H).toISOString();
const entry = (kind: OutageJournalEntry['kind'], id: string, h: number, over: Partial<OutageJournalEntry> = {}): OutageJournalEntry => ({
  at: iso(h), kind, id, network: 'internet', name: 'Oise', dept: '60', level: 'jaune', rung: 'mesuree', ...over,
});
const outage = (over: Partial<OutageNow>): OutageNow => ({
  id: 'mobile|op:Orange', network: 'mobile', scope: 'operateur', operator: 'Orange', dept: null, label: 'Orange', level: 'orange',
  since: iso(6), national: true, measured: false, rung: 'signalee', evidence: [], ...over,
});

describe('frise des 24 h', () => {
  it('barres : nouvelle → rétablie ; niveau le plus haut atteint ; panne en cours sans début dans le journal : depuis son début', () => {
    const journal = [entry('retablie', 'internet|dept:60', 2), entry('aggravee', 'internet|dept:60', 3, { level: 'orange' }), entry('nouvelle', 'internet|dept:60', 5)];
    const bars = timelineBars(journal, [outage({})], NOW);
    // Ordre de la barre des réseaux : téléphone mobile, puis internet.
    expect(bars).toEqual([
      expect.objectContaining({ id: 'mobile|op:Orange', network: 'mobile', level: 'orange', start: NOW - 6 * H, end: null }),
      expect.objectContaining({ id: 'internet|dept:60', network: 'internet', dept: '60', level: 'orange', start: NOW - 5 * H, end: NOW - 2 * H }),
    ]);
  });
  it('fenêtre de 24 h : début ramené à la fenêtre, barre finie avant écartée', () => {
    const bars = timelineBars([entry('retablie', 'a', 30), entry('nouvelle', 'a', 40)], [outage({ since: iso(48) })], NOW);
    expect(bars).toEqual([expect.objectContaining({ id: 'mobile|op:Orange', start: NOW - 24 * H })]);
  });
  it('rejeu : pannes actives à un instant', () => {
    const bars = timelineBars([entry('retablie', 'internet|dept:60', 2), entry('nouvelle', 'internet|dept:60', 5)], [], NOW);
    expect(activeAt(bars, NOW - 3 * H).map((b) => b.id)).toEqual(['internet|dept:60']);
    expect(activeAt(bars, NOW - H)).toEqual([]);
  });
  it('rendu : une ligne par réseau touché, barres en pourcentage, curseur et bouton « maintenant » en rejeu', () => {
    const bars = timelineBars([entry('nouvelle', 'internet|dept:60', 12)], [outage({})], NOW);
    const html = friseHtml(bars, NOW, NOW - 3 * H);
    expect(html).toContain('Téléphone mobile');
    expect(html).toContain('Internet');
    expect(html).toMatch(/left:50(\.0+)?%/);
    expect(html).toContain('data-now');
    expect(friseHtml(bars, NOW, null)).not.toContain('data-now');
  });
  it('cascades : territoire et étapes dans l’ordre, avec l’heure', () => {
    const html = cascadeHtml([{ key: 'dept:13', dept: '13', national: false, level: 'orange', steps: [
      { id: 'a', network: 'electricite', since: '2026-10-21T08:12:00Z' }, { id: 'b', network: 'mobile', since: '2026-10-21T08:40:00Z' },
    ] }]);
    expect(html.replace(/<[^>]+>/g, '')).toContain('Bouches-du-Rhône (13)');
    expect(html.replace(/<[^>]+>/g, '')).toMatch(/Électricité 10\u00a0h\u00a012 → Téléphone mobile 10\u00a0h\u00a040/);
    expect(cascadeHtml([])).toBe('');
  });
  it('frise lisible (22/10/2026) : heures rondes, jour à minuit, « maintenant » à droite, sens du temps et clé des couleurs', () => {
    // NOW = 21/10 16 h UTC = 18 h à Paris : fenêtre du mardi 20 à 18 h au mercredi 21 à 18 h.
    const html = friseHtml([], NOW, null);
    const t = html.replace(/<[^>]+>/g, ' ');
    expect(t).toContain('maintenant');
    expect(t).toMatch(/mer\.? 21/);
    expect(t).toContain(`21\u00a0h`);
    expect(t).not.toMatch(/\d+\u00a0h\u00a0\d{2}/);
    expect(t).toContain('plus ancien');
    expect(t).toMatch(/Vigilance.*Alerte.*Crise/s);
    expect(html).toContain('orm-day');
  });
});
