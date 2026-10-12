// src/components/layer-panel/catastrophes.test.ts : vue pure du panneau Catastrophes (GDACS).
import { describe, expect, it } from 'vitest';
import type { DisasterAlert, DisastersResponse } from '../../types/index.ts';
import { visibleText } from './format.ts';
import { renderLayerView } from './frame.ts';
import { buildCatastrophesView } from './catastrophes.ts';

const NOW = Date.parse('2026-10-12T08:00:00Z');
const a = (over: Partial<DisasterAlert>): DisasterAlert => ({
  id: 'TC-1', type: 'cyclone', level: 'rouge', name: 'Tropical Cyclone TEST-26', countries: ['GLP'], frenchTerritory: 'Guadeloupe',
  lat: 16.2, lon: -61.5, from: '2026-10-10T00:00:00.000Z', to: '2026-10-12T06:00:00.000Z', current: true, severity: 'Hurricane', url: 'https://www.gdacs.org/r', ...over,
});
const body = (alerts: DisasterAlert[], over: Partial<DisastersResponse> = {}): DisastersResponse => ({ readAt: '2026-10-12T07:55:00.000Z', alerts, errors: [], ...over });
const view = (d: DisastersResponse | null, error: string | null = null) =>
  buildCatastrophesView({ disasters: d, disastersError: error, canFocus: true, now: NOW, open: (_id, byDefault) => byDefault });
const text = (d: DisastersResponse | null, error: string | null = null) => visibleText(renderLayerView('disasters', view(d, error)));

describe('buildCatastrophesView', () => {
  it('deux blocs : territoire français puis monde ; chiffre = alertes sur sol français, niveau le plus haut', () => {
    const v = view(body([a({}), a({ id: 'EQ-2', type: 'seisme', level: 'orange', frenchTerritory: null, countries: ['PAN'], name: 'Earthquake in Panama' })]));
    expect(v.sections.map((s) => s.id)).toEqual(['france', 'monde', 'methode']);
    expect(v.head.figure).toMatchObject({ value: '1', level: 'rouge' });
    const t = text(body([a({}), a({ id: 'EQ-2', type: 'seisme', level: 'orange', frenchTerritory: null, countries: ['PAN'], name: 'Earthquake in Panama' })]));
    expect(t).toContain('Cyclone · Guadeloupe');
    expect(t).toContain('Earthquake in Panama');
  });
  it('temps calme : ligne explicite, chiffre 0 en vert ; jamais vide', () => {
    const v = view(body([]));
    expect(v.head.figure).toMatchObject({ value: '0', level: 'vert' });
    expect(text(body([]))).toContain('Aucune alerte GDACS sur le territoire français');
  });
  it('sécheresse d’Europe centrale touchant la France : visible dans le bloc France', () => {
    expect(text(body([a({ id: 'DR-1', type: 'secheresse', level: 'orange', frenchTerritory: 'France (Hexagone et Corse)' })]))).toContain('Sécheresse · France (Hexagone et Corse)');
  });
  it('en retard : « en retard », niveau n.d. ; injoignable : n.d. et message ; pannes nommées dans Méthode', () => {
    expect(view(body([a({})], { readAt: '2026-10-12T07:00:00.000Z' })).head.level).toBe('nd');
    const down = view(null, 'réponse GDACS mal formée');
    expect(down.head.figure?.value).toBe('n.d.');
    const m = visibleText(view(body([], { errors: ['GDACS Guadeloupe : HTTP 500'] })).sections.find((s) => s.id === 'methode')?.html ?? '');
    expect(m).toContain('GDACS Guadeloupe : HTTP 500');
  });
  it('règles typographiques : aucun tiret cadratin, aucune date ISO', () => {
    const t = text(body([a({}), a({ id: 'X-2', frenchTerritory: null, severity: null, url: null })]));
    expect(t).not.toMatch(/—|\d{4}-\d{2}-\d{2}T/);
  });
});

describe('correctifs de la revue finale', () => {
  it('relevé en retard : lignes en gris (jamais la couleur de niveau) ; temps calme dit « en retard », jamais « aucune alerte » seul', () => {
    const late = renderLayerView('disasters', view(body([a({})], { readAt: '2026-10-12T07:00:00.000Z' })));
    expect(renderLayerView('disasters', view(body([a({})])))).toContain('fmk-dot--rouge');
    expect(late).not.toContain('fmk-dot--rouge');
    expect(text(body([], { readAt: '2026-10-12T07:00:00.000Z' }))).toMatch(/Aucune alerte GDACS sur le territoire français[^.]*\(relevé en retard\)/);
  });
  it('chaque ligne porte le lien vers la fiche GDACS', () => {
    const html = renderLayerView('disasters', view(body([a({ url: 'https://www.gdacs.org/report.aspx?eventid=1' })])));
    expect(html).toContain('href="https://www.gdacs.org/report.aspx?eventid=1"');
    expect(visibleText(html)).toContain('Fiche GDACS');
  });
  it('accord : « Alerte verte » ; « 7 jours » insécable ; nom très long tronqué (complet en infobulle)', () => {
    const long = `Drought in ${Array.from({ length: 29 }, (_, i) => `Country${i}`).join(', ')}`;
    const html = renderLayerView('disasters', view(body([a({ level: 'vert' }), a({ id: 'DR-9', type: 'secheresse', level: 'orange', name: long })])));
    const t = visibleText(html);
    expect(t).toContain('Alerte verte');
    expect(t).not.toContain('Alerte vert ');
    expect(t).not.toMatch(/7 derniers/);
    expect(t).not.toContain('Country28');
    expect(html).toContain(`title="${long}"`);
    expect(text(body([]))).toContain('7 derniers jours');
  });
});
