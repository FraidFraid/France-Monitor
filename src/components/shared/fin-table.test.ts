// src/components/shared/fin-table.test.ts : ligne de tableau commune aux blocs « Stabilité financière » et « Matières premières »
// (refonte du 12/10/2026) : nom et unité, date sous le nom, valeur alignée, note (mot du niveau ou variation), courbe de largeur
// fixe ; ligne en alerte (jaune et plus) marquée d'un liseré à la couleur du niveau.
import { describe, expect, it } from 'vitest';
import { finTableRowHTML } from './fin-table.ts';
import { levelColorVar } from '../../services/vigilance.ts';

describe('finTableRowHTML', () => {
  it('cellules dans l’ordre : nom (unité, date), valeur, note, courbe', () => {
    const html = finTableRowHTML({ id: 'x', name: 'Brent', unit: '$/bbl', meta: 'en direct', value: '106,52', note: { text: '+1,72 %', tone: 'up' }, curve: '<svg></svg>' });
    expect(html).toMatch(/^<div class="fin-row" data-id="x"[^>]*>/);
    const order = ['fin-row__name', 'fin-row__unit', 'fin-row__meta', 'fin-row__value', 'fin-row__note is-up', 'fin-row__curve'].map((c) => html.indexOf(c));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain('<svg></svg>');
  });
  it('mot du niveau coloré ; ligne en alerte (jaune et plus) avec liseré, pas en vert', () => {
    const red = finTableRowHTML({ id: 's', name: 'Écart', value: '1,43 pt', note: { text: 'critique', level: 'rouge' }, level: 'rouge', curve: '' });
    expect(red).toContain('fin-row is-alert');
    expect(red).toContain(`--fin-lvl:${levelColorVar('rouge')}`);
    const green = finTableRowHTML({ id: 'c', name: 'CISS', value: '0,051', note: { text: 'calme', level: 'vert' }, level: 'vert', curve: '' });
    expect(green).not.toContain('is-alert');
  });
  it('texte échappé, infobulle', () => {
    const html = finTableRowHTML({ id: 'e', name: '<b>', value: '1', curve: '', help: 'a "b"' });
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('title="a &quot;b&quot;"');
  });
});
