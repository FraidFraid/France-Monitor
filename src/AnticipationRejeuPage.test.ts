// src/AnticipationRejeuPage.test.ts : rejeu public de l'épisode du 4 au 6 novembre 2026.
import { describe, expect, it } from 'vitest';
import { groupEpisodes, leadHours, rejeuHtml, when } from './AnticipationRejeuPage.ts';
import { REJEU_EPISODES, REJEU_PRESS } from './config/anticipation-rejeu-corse.ts';

describe('rejeu de la Corse', () => {
  it('données réelles : la Corse est ouverte avant le Gard et l’Hérault, et avant le premier dégât rapporté', () => {
    const groups = groupEpisodes(REJEU_EPISODES);
    expect(groups.map((g) => g.map((e) => e.dept))).toEqual([['2A', '2B'], ['30', '34']]);
    expect(when(groups[0][0].publishedAt)).toBe('mer. 4 nov. 16:00');
    expect(leadHours(REJEU_EPISODES, REJEU_PRESS)).toBe(17);
  });
  it('la page dit en tête que la règle a été écrite après l’épisode, et liste ses limites', () => {
    const html = rejeuHtml();
    expect(html).toContain('écrite le 13 novembre 2026, après l’épisode');
    expect(html).toContain('Ce que ce rejeu ne prouve pas');
    expect(html).toContain('Hypothèse ouverte : Corse-du-Sud, Haute-Corse');
    expect(html).toContain('Porto-Vecchio');
    expect(html).not.toContain('—');
  });
  it('échappe les titres et refuse un lien qui n’est pas http(s)', () => {
    const html = rejeuHtml(REJEU_EPISODES, [{ at: '2026-11-05T08:00:00Z', title: '<img src=x onerror=1>', source: 'x', link: 'javascript:alert(1)' }]);
    expect(html).toContain('&lt;img src=x onerror=1&gt;');
    expect(html).not.toContain('javascript:');
  });
  it('sans article : pas de délai inventé', () => {
    expect(leadHours(REJEU_EPISODES, [])).toBeNull();
    expect(rejeuHtml(REJEU_EPISODES, [])).toContain('n.d.');
  });
});
