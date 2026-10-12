import { describe, it, expect } from 'vitest';
import { buildPressureView, causeLabel, pressureLead } from './pression.ts';
import { renderLayerView } from './frame.ts';
import type { DepartmentPressure } from '../../services/department-pressure.ts';

const open = (_id: string, byDefault: boolean): boolean => byDefault;

function dept(over: Partial<DepartmentPressure> = {}): DepartmentPressure {
  return {
    code: '13', name: 'Bouches-du-Rhône', level: 'orange', driver: 'security', badge: null,
    elements: [
      { key: 'event:1', level: 'orange', title: 'Rixe à Marseille', theme: 'security', source: 'event', badge: null },
      { key: null, level: 'jaune', title: 'Vigilance météo', theme: 'environment', source: 'meteo', badge: null },
    ],
    ...over,
  };
}

describe('panneau Pression par département (12/10/2026)', () => {
  it('l’essentiel : décompte par niveau puis le département de tête et sa cause', () => {
    expect(pressureLead([dept({ level: 'rouge' }), dept({ code: '69', name: 'Rhône' }), dept({ code: '33', name: 'Gironde', level: 'jaune' })]))
      .toBe('1 département en rouge, 1 en orange, 1 en jaune. En tête : Bouches-du-Rhône, sécurité et défense.');
    expect(causeLabel('general')).toBe('Actualité');
    expect(causeLabel('transport')).toBe('Transports');
    expect(pressureLead([])).toBe('Aucun département sous pression : aucun élément jaune ou plus n’y est rattaché.');
  });

  it('en-tête : niveau du département de tête, nombre en orange ou rouge ; plus aucun score 0-100', () => {
    const view = buildPressureView({ depts: [dept(), dept({ code: '33', name: 'Gironde', level: 'jaune' })], selected: null, open });
    expect(view.head).toMatchObject({ title: 'Pression par département', level: 'orange', figure: { value: '1', caption: 'département en orange ou rouge' } });
    expect(view.head.status).toEqual(['2 départements en jaune ou plus']);
    const html = renderLayerView('pressure', view);
    expect(html).toContain('data-dept="13"');
    expect(html).toContain('Bouches-du-Rhône (13)');
    expect(html).toContain('Rixe à Marseille · +1');
    expect(html).not.toMatch(/\/100/);
  });

  it('département choisi : ses éléments, ceux qui ont une fiche sont cliquables', () => {
    const html = renderLayerView('pressure', buildPressureView({ depts: [dept()], selected: '13', open }));
    expect(html).toContain('Bouches-du-Rhône : 2 éléments');
    expect(html).toContain('data-key="event:1"');
    expect(html.match(/data-key=/g)).toHaveLength(1);
  });

  it('données pas encore chargées : chargement, sans niveau ; aucun département : phrase vide explicite', () => {
    const loading = buildPressureView({ depts: null, selected: null, open });
    expect(loading.head.level).toBeUndefined();
    expect(loading.sections).toEqual([]);
    const empty = renderLayerView('pressure', buildPressureView({ depts: [], selected: null, open }));
    expect(empty).toContain('Aucun département en jaune ou plus.');
  });
});
