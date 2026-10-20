// src/components/map-key/environment-key.test.ts : bloc Environnement de « Lire la carte ».
import { describe, expect, it } from 'vitest';
import { buildEnvironmentKeyHtml, type EnvironmentKeyModel } from './environment-key.ts';

const base: EnvironmentKeyModel = { visible: true, vigilance: {}, phenomena: [], floods: {}, exposed: null };
const text = (html: string): string => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('Lire la carte : Environnement', () => {
  it('hors de l’onglet : rien', () => {
    expect(buildEnvironmentKeyHtml({ ...base, visible: false })).toBe('');
  });
  it('éléments comptés, du rouge au jaune, seulement ceux à l’écran', () => {
    const t = text(buildEnvironmentKeyHtml({ ...base, vigilance: { orange: 4, jaune: 12 }, phenomena: ['2', '3'], floods: { orange: 2 }, exposed: 15 }));
    expect(t).toContain('Vigilance orange · département 4');
    expect(t).toContain('Vigilance jaune · département 12');
    expect(t).not.toContain('Vigilance rouge');
    expect(t).toContain('pluie-inondation');
    expect(t).toContain('Crue orange · tronçon Vigicrues 2');
    expect(t).toContain('à portée d’un phénomène 15');
  });
  it('temps calme : dit, jamais vide ; pas de tiret cadratin', () => {
    const html = buildEnvironmentKeyHtml(base);
    expect(text(html)).toContain('Aucun phénomène en jaune ou plus à l’écran.');
    expect(html).not.toContain('—');
  });
});
