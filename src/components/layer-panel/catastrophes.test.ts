// src/components/layer-panel/catastrophes.test.ts : vue pure du panneau Catastrophes (GDACS).
import { describe, expect, it } from 'vitest';
import type { DisasterAlert, DisastersResponse, EmsActivation, EmsResponse } from '../../types/index.ts';
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
    expect(t).toContain('Séisme · PAN');
    expect(t).not.toContain('Earthquake in Panama');
  });
  it('temps calme : ligne explicite, chiffre 0 en vert ; jamais vide', () => {
    const v = view(body([]));
    expect(v.head.figure).toMatchObject({ value: '0', level: 'vert' });
    expect(text(body([]))).toContain('Aucune alerte GDACS sur le territoire français');
  });
  it('sécheresse d’Europe centrale touchant la France : bloc « Contexte européen », hors du chiffre et de la couleur', () => {
    const drought = a({
      id: 'DR-1', type: 'secheresse', level: 'orange', frenchTerritory: 'France (Hexagone et Corse)', countries: ['AUT', 'BEL', 'FRA'],
      name: 'Drought in Austria, Belgium, France', severity: 'Medium impact for agricultural drought in 1759971 km2',
    });
    const flood = a({ id: 'FL-2', type: 'inondation', level: 'vert', frenchTerritory: 'France (Hexagone et Corse)', countries: ['FRA'], name: 'Flood in France', severity: 'Magnitude 0 ' });
    const v = view(body([drought, flood]));
    expect(v.sections.map((s) => s.id)).toEqual(['france', 'contexte', 'monde', 'methode']);
    expect(v.head.figure).toMatchObject({ value: '1', level: 'vert' });
    const france = visibleText(v.sections.find((s) => s.id === 'france')?.html ?? '');
    const contexte = visibleText(v.sections.find((s) => s.id === 'contexte')?.html ?? '');
    expect(france).toContain('Inondation · France (Hexagone et Corse)');
    expect(france).not.toContain('Sécheresse');
    expect(contexte).toContain('Sécheresse · 3 pays touchés');
    expect(view(body([drought])).head.figure).toMatchObject({ value: '0', level: 'vert' });
  });
  it('textes en français : gravité traduite, nom anglais seulement en infobulle', () => {
    const html = renderLayerView('disasters', view(body([a({ severity: 'Hurricane/Typhoon > 74 mph (maximum wind speed of 250 km/h)' })])));
    const t = visibleText(html);
    expect(t).toContain('Cyclone tropical TEST-26');
    expect(t).toContain('Ouragan ou typhon, vent maximal 250\u00a0km/h');
    expect(t).not.toMatch(/mph|Tropical Cyclone/);
    expect(html).toContain('title="Tropical Cyclone TEST-26"');
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

describe('Copernicus EMS (spec 2026-10-12)', () => {
  const act = (over: Partial<EmsActivation> = {}): EmsActivation => ({
    code: 'EMSR866', category: 'inondation', name: 'Flood in New Aquitaine, France', place: 'New Aquitaine', territory: 'France (Hexagone et Corse)',
    activationTime: '2026-10-11T11:50:00.000Z', eventTime: null, closed: false, gdacsId: 'FL1102030', products: 14,
    url: 'https://mapping.emergency.copernicus.eu/activations/EMSR866', activator: 'COGIC', population: 83890, zones: [], lon: -0.67, lat: 45.27, ...over,
  });
  const ems = (over: Partial<EmsResponse> = {}): EmsResponse => ({
    readAt: '2026-10-12T07:55:00.000Z', active: [act()], recent: [act({ code: 'EMSR902', category: 'feu', place: 'Biscarrosse', closed: true, activationTime: '2026-07-24T10:00:00.000Z', population: null, activator: null })],
    elsewhere: { count: 2, countries: ['Panama', 'Grèce'] }, errors: [], ...over,
  });
  const viewE = (e: EmsResponse | null, err: string | null = null) =>
    buildCatastrophesView({ disasters: body([]), disastersError: null, ems: e, emsError: err, canFocus: true, now: NOW, open: (_id, byDefault) => byDefault });
  const textE = (e: EmsResponse | null, err: string | null = null) => visibleText(renderLayerView('disasters', viewE(e, err)));

  it('section « Cartographie d’urgence » : ligne en cours avec code, date, déclencheur, cartes, population, liens', () => {
    const t = textE(ems());
    expect(t).toContain('Cartographie d’urgence (Copernicus)');
    expect(t).toContain('Inondation · France (Hexagone et Corse)');
    expect(t).toContain('EMSR866');
    expect(t).toContain('COGIC');
    expect(t).toContain('14 cartes');
    expect(t).toContain('83 890 hab. dans l’emprise');
    expect(t).toContain('Fiche Copernicus');
    expect(t).toContain('Fiche GDACS');
    expect(t).not.toContain('—');
  });
  it('chiffre et couleur : une activation française en cours compte orange', () => {
    const v = viewE(ems());
    expect(v.head.figure).toMatchObject({ value: '1', level: 'orange' });
  });
  it('relevé EMS en retard : activation non comptée', () => {
    expect(viewE(ems({ readAt: '2026-10-12T06:30:00.000Z' })).head.figure).toMatchObject({ value: '0' });
  });
  it('aucune en cours ; historique 12 mois ; ailleurs ; source indisponible', () => {
    expect(textE(ems({ active: [] }))).toContain('Aucune activation en cours sur le territoire français.');
    expect(textE(ems())).toContain('12 derniers mois');
    expect(textE(ems())).toContain('2 activations en cours ailleurs : Panama, Grèce');
    expect(textE(null, 'HTTP 502')).toContain('Source indisponible : Copernicus EMS.');
  });
  it('sans données EMS fournies : panneau GDACS inchangé', () => {
    expect(view(body([])).head.figure).toMatchObject({ value: '0' });
  });
});

describe('Copernicus EMS : revue finale', () => {
  const act = (over: Partial<EmsActivation> = {}): EmsActivation => ({
    code: 'EMSR866', category: 'inondation', name: 'Flood in New Aquitaine, France', place: 'New Aquitaine', territory: 'France (Hexagone et Corse)',
    activationTime: '2026-10-11T11:50:00.000Z', eventTime: null, closed: false, gdacsId: null, products: 0,
    url: 'https://mapping.emergency.copernicus.eu/activations/EMSR866', activator: null, population: null, zones: [], lon: null, lat: null, ...over,
  });
  const ems = (over: Partial<EmsResponse> = {}): EmsResponse => ({
    readAt: '2026-10-12T07:55:00.000Z', active: [act()], recent: [], elsewhere: { count: 0, countries: [] }, errors: [], ...over,
  });
  const v = (d: DisastersResponse | null, dErr: string | null, e: EmsResponse | null) =>
    buildCatastrophesView({ disasters: d, disastersError: dErr, ems: e, emsError: null, canFocus: true, now: NOW, open: (_id, byDefault) => byDefault });
  it('relevé EMS en retard : activation toujours « en cours » (grise, relevé en retard), jamais « close »', () => {
    const t = visibleText(renderLayerView('disasters', v(body([]), null, ems({ readAt: '2026-10-12T06:30:00.000Z' }))));
    expect(t).toContain('en cours');
    expect(t).not.toContain('close');
    expect(t).toContain('relevé en retard');
  });
  it('GDACS injoignable, EMS à jour avec une activation : chiffre et orange d’EMS, GDACS nommé indisponible', () => {
    const view = v(null, 'HTTP 502', ems());
    expect(view.head.figure).toMatchObject({ value: '1', level: 'orange' });
    expect(view.head.level).toBe('orange');
    expect(view.head.status).toContain('GDACS injoignable');
  });
  it('GDACS en retard, EMS à jour avec une activation : niveau orange gardé', () => {
    const view = v(body([], { readAt: '2026-10-12T07:00:00.000Z' }), null, ems());
    expect(view.head.level).toBe('orange');
  });
});
