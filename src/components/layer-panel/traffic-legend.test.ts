import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { levelHex } from '../../services/vigilance.ts';
import type { LegendCategory } from '../MapLegend.ts';
import { NBSP } from './format.ts';
import { trafficBreakable } from './traffic-format.ts';
import {
  TRAFFIC_NOW, airOverviewFixture, maritimeSnapshotFixture, railOverviewFixture, railSituationsFixture, roadNationalFixture, roadUrbanFixture,
} from './traffic.fixture.ts';
import {
  AIR_TRAFFIC_LEGEND, CAT_AIRPORT_HEX, CAT_PORT_HEX, MARITIME_TRAFFIC_LEGEND, RAIL_TRAFFIC_LEGEND, ROAD_TRAFFIC_LEGEND, TRAFFIC_NEUTRAL_HEX,
  VESSEL_TYPE_HEX, airLegend, maritimeLegend, railLegend, roadLegend, vesselCategory, vesselHex,
} from './traffic-legend.ts';

const css = readFileSync(new URL('../../styles/main.css', import.meta.url), 'utf8');
const H = 3_600_000;
const text = (c: LegendCategory): string =>
  [c.title, ...c.items.map((i) => i.label), c.source?.label ?? '', c.refresh?.label ?? '', ...(c.notes ?? [])].join(' | ');
const color = (c: LegendCategory, id: string): string | undefined => c.items.find((i) => i.id === id)?.color;
const label = (c: LegendCategory, id: string): string | undefined => c.items.find((i) => i.id === id)?.label;
const COLORS_GONE = 'En retard : couleurs de niveau retirées de la carte pour ces données.';

describe('légendes Trafics : sources, périmètres (T1), dates réelles (S1)', () => {
  it('route : DIR et TomTom datés, périmètres des deux sources, sections Traficolor, palette L1', () => {
    const l = roadLegend(roadNationalFixture(), roadUrbanFixture(), TRAFFIC_NOW);
    expect(l.id).toBe('trafficRoad');
    expect(l.notes?.[0]).toBe('Données : DIR 14:57 · TomTom 15:00.');
    const t = text(l);
    for (const part of ['routes nationales non concédées', `moins de 24${NBSP}h`, '12 agglomérations', 'zoom 10', 'Sections Traficolor',
      'DIR (DATEX II, Traficolor)']) expect(t).toContain(part);
    expect([color(l, 'road-accident'), color(l, 'road-major'), color(l, 'road-minor'), color(l, 'road-jam-3'), color(l, 'road-section-congested'),
      color(l, 'road-section-free')]).toEqual([levelHex('rouge'), levelHex('orange'), levelHex('jaune'), levelHex('rouge'), levelHex('rouge'), levelHex('vert')]);
  });
  it('en retard : « (en retard) » et couleurs retirées dites ; partie absente : « indisponible » ; autre jour : date', () => {
    expect(roadLegend(roadNationalFixture(), roadUrbanFixture(), TRAFFIC_NOW + 2 * H).notes?.slice(0, 2))
      .toEqual(['Données : DIR 14:57 (en retard) · TomTom 15:00 (en retard).', COLORS_GONE]);
    expect(roadLegend(null, roadUrbanFixture(), TRAFFIC_NOW).notes?.[0]).toBe('Données : DIR indisponible · TomTom 15:00.');
    const unpublished = roadNationalFixture();
    unpublished.publishedAt = null;
    expect(roadLegend(unpublished, null, TRAFFIC_NOW).notes?.slice(0, 2)).toEqual(['Données : DIR n.d. · TomTom indisponible.', COLORS_GONE]);
    expect(roadLegend(roadNationalFixture(), roadUrbanFixture(), TRAFFIC_NOW + 24 * H).notes?.[0])
      .toBe('Données : DIR 03/10 14:57 (en retard) · TomTom 03/10 15:00 (en retard).');
  });
  it('aérien : OpenSky daté, densité, urgences rouges, aéroports en jeton de catégorie', () => {
    const l = airLegend(airOverviewFixture(), TRAFFIC_NOW);
    expect(l.notes?.[0]).toBe('Données : OpenSky 15:09.');
    const t = text(l);
    for (const part of ['OpenSky', 'sous le zoom 7', 'indicatif au survol', '7500, 7600, 7700', 'départs détectés', 'couche Défense',
      `toutes les 4${NBSP}h`]) expect(t).toContain(part);
    expect(color(l, 'air-emergency')).toBe(levelHex('rouge'));
    expect(color(l, 'air-airport')).toBe(CAT_AIRPORT_HEX);
    expect(airLegend(null, TRAFFIC_NOW).notes?.[0]).toBe('Données : OpenSky indisponible.');
  });
  it('rail : SNCF et SIRI SX datés, seuils de retard des gares, situations hors carte dites', () => {
    const l = railLegend(railOverviewFixture(), railSituationsFixture(), TRAFFIC_NOW);
    expect(l.id).toBe('trafficRail');
    expect(l.notes?.[0]).toBe('Données : SNCF 15:10 · SIRI SX 15:10.');
    expect(l.items.filter((i) => !i.isHeader).map((i) => i.color)).toEqual([levelHex('rouge'), levelHex('orange'), levelHex('jaune'), levelHex('vert')]);
    expect(text(l)).toContain(`90${NBSP}min`);
    expect(text(l)).toContain('ne sont pas placées sur la carte');
  });
  it('maritime : AIS daté, compte de chaque type déclaré (onze catégories de byType), signalements comme la pastille, mouillages en jeton de port', () => {
    const l = maritimeLegend(maritimeSnapshotFixture(), TRAFFIC_NOW);
    expect(l.notes?.[0]).toBe('Données : AIS 15:12.');
    expect(label(l, 'sea-cargo')).toBe('Cargo · 48');
    expect(label(l, 'sea-tug')).toBe('Remorqueur · 9');
    expect(label(l, 'sea-service')).toBe('Service : pilote, sauvetage, police · 6');
    expect(label(l, 'sea-military')).toBe('Militaire · 3');
    expect(label(l, 'sea-other')).toBe('Autre type · 1');
    expect(label(l, 'sea-unknown')).toBe('Type inconnu · 1\u202F041');
    expect(text(l)).toContain('par type déclaré (données statiques AIS)');
    expect(text(l)).not.toMatch(/sauvetage · 9|Autres types/);
    expect([color(l, 'sea-service'), color(l, 'sea-military'), color(l, 'sea-other')]).toEqual(['#2dd4bf', '#818cf8', '#e2e8f0']);
    expect([color(l, 'sea-signal-sensitive'), color(l, 'sea-signal'), color(l, 'sea-anchorage')]).toEqual([levelHex('rouge'), levelHex('orange'), CAT_PORT_HEX]);
    expect(label(maritimeLegend(null, TRAFFIC_NOW), 'sea-cargo')).toBe('Cargo');
    expect(label(MARITIME_TRAFFIC_LEGEND, 'sea-cargo')).toBe('Cargo');
  });
  it('maritime : une entrée de légende par catégorie de byType, dans la teinte de la carte', () => {
    const snapshot = maritimeSnapshotFixture();
    const vessels = MARITIME_TRAFFIC_LEGEND.items.filter((i) => i.shape === 'vessel');
    expect(vessels).toHaveLength(Object.keys(snapshot.byType).length);
    expect(new Set(vessels.map((i) => i.color))).toEqual(new Set(Object.values(VESSEL_TYPE_HEX)));
    expect(new Set(Object.keys(VESSEL_TYPE_HEX))).toEqual(new Set(Object.keys(snapshot.byType)));
    // Comptes de la légende : somme des types = navires comptés par le serveur dans l'instantané (amendement 3).
    expect(Object.values(snapshot.byType).reduce((a, b) => a + b, 0)).toBe(snapshot.vessels);
  });
  it('teinte d’un navire : classement UIT du serveur ; type inconnu en pêche (statut 7) reste jaune ; couleurs existantes gardées', () => {
    expect([vesselCategory(30), vesselCategory(31), vesselCategory(33), vesselCategory(35), vesselCategory(36), vesselCategory(50),
      vesselCategory(52), vesselCategory(55), vesselCategory(56), vesselCategory(0), vesselCategory(null), vesselCategory(90)])
      .toEqual(['peche', 'remorqueur', 'service', 'militaire', 'plaisance', 'service', 'remorqueur', 'service', 'autre', 'inconnu', 'inconnu', 'autre']);
    expect([vesselHex(75, 0), vesselHex(85, 0), vesselHex(65, 0), vesselHex(30, 0), vesselHex(52, 0), vesselHex(37, 0), vesselHex(45, 0), vesselHex(0, 0)])
      .toEqual(['#4ade80', '#60a5fa', '#f97316', '#facc15', '#a855f7', '#06b6d4', '#f472b6', '#94a3b8']);
    expect(vesselHex(0, 7)).toBe(VESSEL_TYPE_HEX.peche);
    expect(vesselHex(undefined, 7)).toBe(VESSEL_TYPE_HEX.peche);
    // Le statut « en pêche » ne recolore jamais un type déclaré.
    expect(vesselHex(70, 7)).toBe(VESSEL_TYPE_HEX.cargo);
    expect(vesselHex(51, 7)).toBe(VESSEL_TYPE_HEX.service);
  });
  it('jetons copiés de main.css ; teinte neutre hors palette ; R1 ; ni tiret cadratin, ni « temps réel », ni airplanes.live', () => {
    expect(css).toContain(`--cat-airport: ${CAT_AIRPORT_HEX};`);
    expect(css).toContain(`--cat-port: ${CAT_PORT_HEX};`);
    expect((['vert', 'jaune', 'orange', 'rouge'] as const).map((l) => levelHex(l))).not.toContain(TRAFFIC_NEUTRAL_HEX);
    for (const c of [ROAD_TRAFFIC_LEGEND, AIR_TRAFFIC_LEGEND, RAIL_TRAFFIC_LEGEND, MARITIME_TRAFFIC_LEGEND,
      roadLegend(roadNationalFixture(), roadUrbanFixture(), TRAFFIC_NOW + 2 * H), maritimeLegend(maritimeSnapshotFixture(), TRAFFIC_NOW)]) {
      const t = text(c);
      expect(trafficBreakable(t)).toBeNull();
      expect(t).not.toMatch(/\u2014|&mdash;|temps réel|airplanes|preview/i);
    }
  });
});
