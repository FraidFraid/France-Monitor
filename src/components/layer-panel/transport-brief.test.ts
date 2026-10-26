import { describe, expect, it } from 'vitest';
import { buildThemeBriefView, themeBriefNoteText, type ThemeBriefInput } from './theme-brief.ts';
import { transportBriefSections, transportLead, type TransportBriefData } from './transport-brief.ts';
import type { TransportVigilancePoint } from './transport-vigilance.ts';
import { airOverviewFixture, maritimeSnapshotFixture, railOverviewFixture, railSituationsFixture, roadNationalFixture, TRAFFIC_NOW } from './traffic.fixture.ts';
import { cumulFocusKey, focusSwatchHtml } from './env-focus.ts';
import { buildTransportKeyHtml } from '../map-key/transport-key.ts';
import { railStationTierMax } from '../deckgl/traffic-map.ts';
import {
  calloutAnchorHtml, calloutDimmed, calloutLabelHtml, calloutRoutesFeatures, calloutTooltipHtml, calloutsSignature, layoutCallouts, type CalloutBox,
} from '../deckgl/transport-callouts.ts';

const POINT: TransportVigilancePoint = {
  n: 1, id: 'rail-axe:atlantique', mode: 'trafficRail', level: 'rouge', lon: -1.67, lat: 48.1, title: 'Axe Atlantique', short: '6 trains · jusqu’à 390\u00a0min',
  detail: '6 trains très retardés.', cause: 'Dérangement affectant la voie à RENNES (SIRI SX, 19:48)', causeTag: 'annoncée', who: 'SNCF Voyageurs et SNCF Réseau',
};

function data(over: Partial<TransportBriefData> = {}): TransportBriefData {
  return {
    points: [POINT], rail: railOverviewFixture(), situations: railSituationsFixture(), road: roadNationalFixture(), urban: null,
    urbanError: 'TomTom : aucune donnée récente depuis le 15/10\u00a015:12', air: airOverviewFixture(), maritime: maritimeSnapshotFixture(),
    levels: { trafficRail: 'rouge', trafficRoad: 'jaune', trafficAir: 'vert', trafficMaritime: 'vert' }, ...over,
  };
}

const open = (): boolean => true;
const visible = (html: string): string => html.replace(/<[^>]+>/g, '');

describe('En bref Transports (lots 1 et 2, 25/10/2026)', () => {
  it('l’essentiel : points de vigilance par mode, sinon niveau de la pastille ; modes calmes et sources indisponibles regroupés', () => {
    expect(transportLead(data())).toBe('Rail : Axe Atlantique. Route : jaune, sans point localisé. Aérien et maritime : rien d’anormal.');
    expect(transportLead(data({ points: [], levels: { trafficRail: 'vert', trafficRoad: 'nd' } }))).toBe('Rail : rien d’anormal. Source indisponible : route.');
  });

  it('sections : points numérotés (cause et qui est concerné), une section par mode, écart à la normale ; TomTom indisponible dit', () => {
    const sections = transportBriefSections(data(), TRAFFIC_NOW, open);
    expect(sections.map((s) => s.id)).toEqual(['tb-points', 'tb-rail', 'tb-road', 'tb-air', 'tb-sea', 'tb-normal']);
    const points = sections[0].html;
    expect(points).toContain('data-lon="-1.67" data-lat="48.1"');
    expect(visible(points)).toContain('Cause : Dérangement affectant la voie à RENNES (SIRI SX, 19:48) cause annoncée');
    expect(visible(points)).toContain('Concerne : SNCF Voyageurs et SNCF Réseau');
    expect(visible(sections[2].html)).toContain('Bouchons TomTom (agglomérations) : n.d., TomTom : aucune donnée récente depuis le 15/10\u00a015:12.');
    for (const s of sections) expect(s.html).not.toMatch(/\u2014|&mdash;/);
  });

  it('le panneau En bref de l’onglet : chiffre = points de vigilance, sections Transports en tête, note à copier avec les points', () => {
    const input: ThemeBriefInput = {
      themeName: 'Transports', pastilles: [], items: [], themeLevel: null, changes: [], eventsStatus: null, transport: data(), now: TRAFFIC_NOW, open,
    };
    const view = buildThemeBriefView(input);
    expect(view.head.figure).toEqual({ value: '1', caption: 'point de vigilance', level: 'rouge' });
    expect(view.sections[0].id).toBe('tb-points');
    const note = themeBriefNoteText(input);
    expect(note).toContain('Points de vigilance :');
    expect(note).toContain('- 1. Axe Atlantique (rouge)');
    expect(note).not.toMatch(/[\u00a0\u202f]/);
  });
});

describe('grammaire commune dans l’onglet Transports', () => {
  it('pastilles cumulables dans l’onglet Transports seulement', () => {
    expect(cumulFocusKey('transport', 'trafficRail')).toBe(true);
    expect(cumulFocusKey('transport', 'brief')).toBe(false);
    expect(cumulFocusKey('general', 'trafficRail')).toBe(false);
  });

  it('mini-légende : forme du picto (triangle, losange, trait) ou icône teintée, couleur échappée', () => {
    expect(focusSwatchHtml({ color: '#e879f9', shape: 'triangle' })).toBe('<i class="ef-dot ef-dot--triangle" style="background:#e879f9"></i>');
    expect(focusSwatchHtml({ color: '#ff3b30', icon: '━' })).toBe('<i class="ef-dot ef-dot--line" style="background:#ff3b30"></i>');
    expect(focusSwatchHtml({ color: '#fff', icon: '<svg></svg>' })).toContain('class="ef-ico"');
    expect(focusSwatchHtml({ color: '"><script>' })).not.toContain('<script>');
  });

  it('étiquettes de la carte : icône du mode dans l’étiquette, numéro, titre échappé ; point au lieu ; tamisées si une autre pastille est mise en avant', () => {
    const html = calloutLabelHtml({ ...POINT, title: '<b>Axe</b>' });
    expect(html).toContain('class="tv-mode"');
    expect(html).toContain('<span class="tv-n">1.</span>');
    expect(html).toContain('&lt;b&gt;Axe&lt;/b&gt;');
    expect(calloutAnchorHtml(POINT)).toBe('<span class="tv-dot tv-dot--rouge" aria-hidden="true"></span>');
    expect(calloutDimmed('trafficRail', [])).toBe(false);
    expect(calloutDimmed('trafficRail', ['trafficRoad'])).toBe(true);
    expect(calloutsSignature([POINT])).toBe(calloutsSignature([{ ...POINT }]));
    const tip = calloutTooltipHtml({ ...POINT, routes: [[[-1.67, 48.1], [2.32, 48.84]]] });
    expect(visible(tip)).toContain('Trajets des 1 trains allumés sur la carte.');
    expect(calloutRoutesFeatures({ ...POINT, routes: [[[-1.67, 48.1], [2.32, 48.84]]] }).features[0].geometry).toEqual({ type: 'LineString', coordinates: [[-1.67, 48.1], [2.32, 48.84]] });
  });

  it('disposition : trois points confondus en une colonne alignée, sans chevauchement, dans l’ordre des numéros ; place manquante à droite : à gauche', () => {
    const box = (x: number, y: number): CalloutBox => ({ x, y, w: 150, h: 36 });
    const placed = layoutCallouts([box(300, 200), box(302, 201), box(299, 199)], 1000, 600);
    expect(new Set(placed.map((p) => p.left)).size).toBe(1);
    expect(placed.map((p) => p.side)).toEqual(['right', 'right', 'right']);
    const tops = placed.map((p) => p.top);
    expect(tops[0]).toBeLessThan(tops[1]);
    expect(tops[1]).toBeLessThan(tops[2]);
    for (let i = 1; i < tops.length; i += 1) expect(tops[i] - tops[i - 1]).toBeGreaterThanOrEqual(36 + 6);
    // Colonne recentrée sur les ancres.
    expect(Math.abs((tops[0] + tops[2] + 36) / 2 - 200)).toBeLessThan(2);
    for (const p of placed) expect(p.path).toMatch(/^M[\d.]+ [\d.]+C/);
    expect(layoutCallouts([box(950, 300)], 1000, 600)[0].side).toBe('left');
    // Lieux éloignés à la même hauteur : chacun garde son étiquette à côté de lui, pas de colonne commune qui traverse la carte.
    const far = layoutCallouts([box(100, 200), box(600, 205)], 1000, 600);
    expect([far[0].left, far[1].left]).toEqual([146, 646]);
  });

  it('étiquettes d’abord : gares rouges seules à l’échelle de la France, orange au zoom régional, tout de près ou pastille Ferroviaire allumée', () => {
    expect([railStationTierMax(6, false), railStationTierMax(7.5, false), railStationTierMax(9, false), railStationTierMax(5, true)]).toEqual([0, 1, 3, 3]);
  });

  it('« Lire la carte » : points comptés par niveau, natures routières à l’écran, gares colorées ; vide hors de l’onglet', () => {
    expect(buildTransportKeyHtml({ visible: false, points: [POINT], roadKinds: null, stations: null })).toBe('');
    const html = buildTransportKeyHtml({ visible: true, points: [POINT], roadKinds: { accident: 4, weather: 1 }, stations: { orange: 2, rouge: 3 } });
    const t = visible(html);
    for (const part of ['Point de vigilance rouge1', 'Météo, inondation, éboulement1', 'Accident4', 'Gare : 90\u00a0min ou plus, ou train supprimé3']) expect(t).toContain(part);
    expect(html).not.toMatch(/\u2014/);
  });
});
