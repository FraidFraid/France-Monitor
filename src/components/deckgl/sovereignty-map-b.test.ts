// src/components/deckgl/sovereignty-map-b.test.ts : carte de la phase B (spec 2026-10-04 souveraineté § 3.1, § 3.2 ; contrats § 5 ;
// amendement 7, O15, O17, S6) : mailles GNSS du jour UTC complet précédent seulement (jaunes et orange ; hors de France en gris, jamais
// comptées ; dégradation générale DE CE JOUR en contour seul ; en retard : gris), mailles « trop peu d'avions » et vertes non dessinées ;
// zones drones DGAC en option ; listes de la tâche A14 complétées, sans « ZIT » ; infobulles échappées ; légende Défense datée.
import { describe, expect, it } from 'vitest';
import type { DroneZonesFile, GnssResponse } from '../../types/index.ts';
import { levelHex } from '../../services/vigilance.ts';
import { DRONES_TITLE } from '../../services/sovereignty-drones.ts';
import { DRONE_ZONES_META_FIXTURE, GNSS_FIXTURE, GNSS_STORM_FIXTURE, MILITARY_FIXTURE, SOV_FIXTURE_NOW } from '../layer-panel/sovereignty.fixture.ts';
import { DRONE_ZONE_HEX, SOV_ABROAD_HEX, defenseLegend, withDefensePhaseB } from '../layer-panel/sovereignty-legend.ts';
import { GNSS_ORANGE_PCT } from '../layer-panel/defense-b.ts';
import { sovBreakable } from '../layer-panel/sovereignty-format.ts';
import {
  LYR_MILITARY_BASES_LABEL, LYR_SOV_AIRCRAFT, LYR_SOV_DRONES_FILL, LYR_SOV_DRONES_LINE, LYR_SOV_GNSS_FILL, LYR_SOV_GNSS_LINE,
  LYR_SUBMARINE_CABLES_HITAREA, SRC_SOV_DRONES, SRC_SOV_GNSS,
} from './constants.ts';
import { SOV_B_LAYERS, SOV_B_SOURCE_IDS, droneZoneFeatures, gnssCellFeatures } from './sovereignty-map-b.ts';
import {
  SOV_HOVER_LAYERS, SOV_LAYER_KEYS, SOV_OPTION_LAYERS, droneZoneFeatures as reexportedDrones, gnssCellFeatures as reexportedGnss, sovTooltipHtml,
  topSovHit,
} from './sovereignty-map.ts';

const NOW = SOV_FIXTURE_NOW;
const NBSP = ' ';
const DRONES = (): DroneZonesFile => ({
  ...DRONE_ZONES_META_FIXTURE(),
  zones: [{
    id: '54999', remarque: "Altitude de référence de l'aérodrome : 112 m <b>",
    polygons: [[[[5.4168, 43.457], [5.4181, 43.4584], [5.4196, 43.4585], [5.4168, 43.457]]]],
  }],
});
const gnss = (over: Partial<GnssResponse>): GnssResponse => ({ ...GNSS_FIXTURE(), ...over });
const props = (f: GeoJSON.Feature | undefined): Record<string, unknown> => (f?.properties ?? {}) as Record<string, unknown>;

describe('sources, couches et listes de la tâche A14', () => {
  it('deux sources, quatre couches masquées, couleur portée par l’objet ; réexport par sovereignty-map.ts', () => {
    expect(SOV_B_SOURCE_IDS).toEqual([SRC_SOV_GNSS, SRC_SOV_DRONES]);
    expect(SOV_B_LAYERS.map((l) => l.id)).toEqual([LYR_SOV_DRONES_FILL, LYR_SOV_DRONES_LINE, LYR_SOV_GNSS_FILL, LYR_SOV_GNSS_LINE]);
    expect(SOV_B_LAYERS.every((l) => (l.layout as { visibility?: string } | undefined)?.visibility === 'none')).toBe(true);
    expect(JSON.stringify(SOV_B_LAYERS.find((l) => l.id === LYR_SOV_GNSS_FILL))).toContain('["get","color"]');
    expect(reexportedGnss).toBe(gnssCellFeatures);
    expect(reexportedDrones).toBe(droneZoneFeatures);
  });
  it('mailles avec la couche Défense à la place des rectangles « ZIT » ; zones drones en option ; surfaces survolées en dernier', () => {
    expect(SOV_LAYER_KEYS.military.slice(-3)).toEqual([LYR_MILITARY_BASES_LABEL, LYR_SOV_GNSS_FILL, LYR_SOV_GNSS_LINE]);
    expect(SOV_LAYER_KEYS.military.some((id) => id.startsWith('military-zones'))).toBe(false);
    expect(SOV_OPTION_LAYERS.droneZones).toEqual([LYR_SOV_DRONES_FILL, LYR_SOV_DRONES_LINE]);
    expect(SOV_HOVER_LAYERS.slice(-3)).toEqual([LYR_SUBMARINE_CABLES_HITAREA, LYR_SOV_GNSS_FILL, LYR_SOV_DRONES_FILL]);
    expect(topSovHit([{ layer: { id: LYR_SOV_GNSS_FILL } }, { layer: { id: LYR_SOV_AIRCRAFT } }])?.layer.id).toBe(LYR_SOV_AIRCRAFT);
    expect(topSovHit([{ layer: { id: LYR_SOV_DRONES_FILL } }, { layer: { id: LYR_SOV_GNSS_FILL } }])?.layer.id).toBe(LYR_SOV_GNSS_FILL);
  });
});

describe('mailles GNSS (O15, O17)', () => {
  it('jaunes et orange seulement ; françaises en couleur de niveau, anglaise en gris ; maille de 0,5° depuis son coin sud-ouest', () => {
    const fc = gnssCellFeatures(GNSS_FIXTURE(), NOW);
    expect(fc.features.map((f) => `${String(props(f)['cell'])} ${String(props(f)['color'])} ${String(props(f)['fillOpacity'])}`)).toEqual([
      `50.5:-1.5 ${SOV_ABROAD_HEX} 0.2`, `48:-4 ${levelHex('orange')} 0.32`, `48:-3.5 ${levelHex('orange')} 0.32`, `48:-3 ${levelHex('jaune')} 0.32`,
    ]);
    expect(fc.features[2].geometry.coordinates).toEqual([[[-3.5, 48], [-3, 48], [-3, 48.5], [-3.5, 48.5], [-3.5, 48]]]);
  });
  it('O17 : jour des mailles non couvert (cellsDay nul ou cells vide) : aucune maille ; jamais complète : rien', () => {
    expect(gnssCellFeatures(gnss({ cellsDay: null }), NOW).features).toEqual([]);
    expect(gnssCellFeatures(gnss({ cells: [] }), NOW).features).toEqual([]);
    expect(gnssCellFeatures(null, NOW).features).toEqual([]);
    expect(gnssCellFeatures(gnss({ readAt: null }), NOW).features).toEqual([]);
  });
  it('O17 : la couleur suit days[cellsDay].general, jamais la dégradation générale de la fenêtre glissante', () => {
    // Fenêtre glissante en orage, mais le jour des mailles n'est pas général : couleurs de niveau.
    const rollingOnly = gnssCellFeatures(gnss({ generalDegradation: true }), NOW);
    expect(rollingOnly.features.filter((f) => props(f)['color'] === levelHex('orange'))).toHaveLength(2);
    expect(rollingOnly.features.every((f) => props(f)['lineWidth'] !== 1.6)).toBe(true);
    // Jour des mailles général : contour seul pour les mailles françaises, même si la fenêtre glissante est calme.
    const storm = gnssCellFeatures(gnss({ ...GNSS_STORM_FIXTURE(), generalDegradation: false }), NOW);
    expect(storm.features).toHaveLength(4);
    expect(storm.features.every((f) => props(f)['fillOpacity'] === 0 && props(f)['lineWidth'] === 1.6)).toBe(true);
    // Un autre jour que cellsDay ne compte pas.
    const other = GNSS_STORM_FIXTURE();
    other.days.days = other.days.days.map((d) => ({ ...d, general: d.date !== other.cellsDay }));
    expect(gnssCellFeatures(other, NOW).features.every((f) => props(f)['lineWidth'] !== 1.6)).toBe(true);
  });
  it('grille en retard (40 min) : tout en gris', () => {
    const late = gnssCellFeatures(gnss({ readAt: '2026-10-04T13:50:00.000Z' }), NOW);
    expect(late.features.length).toBeGreaterThan(0);
    expect(late.features.every((f) => props(f)['color'] === SOV_ABROAD_HEX)).toBe(true);
  });
  it('infobulle : datée par cellsDay, jamais « hier » ni l’heure de la grille ; verdict prudent ; hors de France et dégradation générale dites', () => {
    const fc = gnssCellFeatures(GNSS_FIXTURE(), NOW);
    const breton = sovTooltipHtml(LYR_SOV_GNSS_FILL, props(fc.features[2])) ?? '';
    expect(breton).toMatch(/^<div class="hm-tip"><b>Maille GNSS : précision de position dégradée<\/b>/);
    for (const part of [`12,5${NBSP}%`, `24${NBSP}aéronefs`, `4${NBSP}aéronefs`, `1${NBSP}aéronef<`, 'mailles du 03/10, jour UTC complet',
      'À vérifier : seules la DGAC et l’ANFR qualifient un brouillage.']) expect(breton).toContain(part);
    expect(breton).not.toMatch(/\bhier\b|brouillage mesuré|navigation dégradée|16:4|\(en retard\)/i);
    expect(sovTooltipHtml(LYR_SOV_GNSS_FILL, props(fc.features[0]))).toContain('Hors de France : jamais comptée.');
    const storm = gnssCellFeatures(GNSS_STORM_FIXTURE(), NOW);
    expect(sovTooltipHtml(LYR_SOV_GNSS_FILL, props(storm.features[0]))).toContain('Dégradation générale ce jour-là, probablement météo spatiale : non comptée.');
    const late = gnssCellFeatures(gnss({ readAt: '2026-10-04T13:50:00.000Z' }), NOW);
    expect(sovTooltipHtml(LYR_SOV_GNSS_FILL, props(late.features[1]))).toContain('(en retard) : couleurs retirées');
  });
});

describe('zones drones (S6)', () => {
  it('une zone par entrée, MultiPolygon [lng, lat] ; rien sans fichier', () => {
    const fc = droneZoneFeatures(DRONES());
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].geometry).toEqual({ type: 'MultiPolygon', coordinates: DRONES().zones[0].polygons });
    expect(props(fc.features[0])).toEqual({ id: '54999', remarque: "Altitude de référence de l'aérodrome : 112 m <b>", edition: '2025-07-01' });
    expect(droneZoneFeatures(null).features).toEqual([]);
    expect(DRONE_ZONE_HEX).toBe('#5e5ce6');
  });
  it('infobulle construite au survol : titre officiel, remarque échappée, édition, agglomérations exclues, NOTAM non couverts, carte officielle', () => {
    const tip = sovTooltipHtml(LYR_SOV_DRONES_FILL, props(droneZoneFeatures(DRONES()).features[0])) ?? '';
    expect(tip).toMatch(/^<div class="hm-tip"><b>Zone drones : vol interdit<\/b>/);
    expect(tip).toContain(DRONES_TITLE);
    expect(tip).toContain('112 m &lt;b&gt;');
    expect(tip).not.toContain('<b>Altitude');
    expect(tip).toContain('à jour au 07-2025');
    expect(tip).toContain('hors agglomérations');
    expect(tip).toContain('les interdictions temporaires (NOTAM) ne sont pas couvertes');
    expect(tip).toContain('la carte officielle fait foi');
    expect(tip).not.toContain('href');
  });
});

describe('légende Défense de la phase B', () => {
  const base = (drones: boolean) => defenseLegend(MILITARY_FIXTURE(), { osmWorks: false, droneZones: drones }, NOW);
  it('plus de rectangles « ZIT » ; mailles datées par cellsDay ; zones drones seulement option active, avec édition, agglomérations et NOTAM', () => {
    expect(JSON.stringify(base(false))).not.toContain('Zone interdite');
    const legend = withDefensePhaseB(base(true), { gnss: GNSS_FIXTURE(), drones: DRONES(), dronesShown: true }, NOW);
    expect(JSON.stringify(legend)).not.toContain('Zone interdite');
    expect(legend.items.slice(-5).map((i) => i.id)).toEqual(['sov-gnss-header', 'sov-gnss-orange', 'sov-gnss-jaune', 'sov-gnss-abroad', 'sov-drones']);
    expect(legend.items.find((i) => i.id === 'sov-gnss-orange')?.color).toBe(levelHex('orange'));
    expect(legend.items.find((i) => i.id === 'sov-gnss-orange')?.label).toBe(`Au-delà de ${GNSS_ORANGE_PCT}${NBSP}% des aéronefs à précision dégradée`);
    expect(legend.items.find((i) => i.id === 'sov-drones')?.color).toBe(DRONE_ZONE_HEX);
    expect(legend.notes).toContain('Mailles du 03/10, jour UTC complet ; « trop peu d’avions » et mailles vertes non dessinées.');
    expect(legend.notes).toContain('Zones drones : DGAC / IGN, Géoplateforme, à jour au 07-2025 ; fichier du 04/10/2026.');
    expect(legend.notes?.some((n) => n.includes(DRONES_TITLE))).toBe(true);
    expect(legend.notes).toContain('Zones permanentes hors agglomérations seulement ; les interdictions temporaires (NOTAM) ne sont pas couvertes.');
    const text = JSON.stringify(legend);
    expect(text).not.toMatch(/\bhier\b|brouillage mesuré|navigation dégradée|16:40/i);
    const added = [...legend.items.slice(-5).map((i) => i.label), ...(legend.notes ?? []).filter((n) => !(base(true).notes ?? []).includes(n))];
    for (const t of added) expect(sovBreakable(t), t).toBeNull();
    const off = withDefensePhaseB(base(false), { gnss: GNSS_FIXTURE(), drones: DRONES(), dronesShown: false }, NOW);
    expect(off.items.some((i) => i.id === 'sov-drones')).toBe(false);
    expect((off.notes ?? []).some((n) => n.includes('NOTAM'))).toBe(false);
  });
  it('dégradation générale du jour dite ; grille en retard : couleurs retirées ; veille non couverte ou fichier non lu : dit ; aucune mutation', () => {
    expect(withDefensePhaseB(base(false), { gnss: GNSS_STORM_FIXTURE(), drones: null, dronesShown: false }, NOW).notes)
      .toContain('Dégradation générale le 03/10, probablement météo spatiale : mailles françaises en contour seul, non comptées.');
    const rollingOnly = withDefensePhaseB(base(false), { gnss: gnss({ generalDegradation: true }), drones: null, dronesShown: false }, NOW);
    expect((rollingOnly.notes ?? []).some((n) => n.startsWith('Dégradation générale'))).toBe(false);
    const late = withDefensePhaseB(base(false), { gnss: gnss({ readAt: '2026-10-04T13:50:00.000Z' }), drones: null, dronesShown: false }, NOW);
    expect(late.items.find((i) => i.id === 'sov-gnss-orange')?.color).toBe(SOV_ABROAD_HEX);
    expect((late.notes ?? []).join(' ')).toContain('Mailles du 03/10, jour UTC complet (en retard) : couleurs retirées');
    const unpublished = withDefensePhaseB(base(false), { gnss: gnss({ cellsDay: null, cells: [] }), drones: null, dronesShown: false }, NOW);
    expect(unpublished.items.map((i) => i.id)).toContain('sov-gnss-nd');
    expect(unpublished.notes).toContain('Mailles du jour UTC précédent : non publiées (jour non couvert).');
    expect(withDefensePhaseB(base(false), { gnss: null, drones: null, dronesShown: false }, NOW).items.map((i) => i.id)).toContain('sov-gnss-nd');
    expect(withDefensePhaseB(base(true), { gnss: null, drones: null, dronesShown: true }, NOW).notes).toContain('Zones drones : fichier pas encore lu.');
    const before = base(false);
    const snapshot = JSON.stringify(before);
    withDefensePhaseB(before, { gnss: GNSS_FIXTURE(), drones: null, dronesShown: false }, NOW);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(JSON.stringify(late)).not.toContain('\u2014');
  });
});
