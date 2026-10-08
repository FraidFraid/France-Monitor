// src/components/deckgl/outages-map.test.ts
// Carte des pannes réseau (spec 2026-10-08 § 2.1, § 2.2) : entités Télécoms et Électricité, couches, infobulle.
import { describe, expect, it } from 'vitest';
import type { PowerOutagesResponse } from '../../types/index.ts';
import { NBSP } from '../layer-panel/format.ts';
import { OUTAGES_FIXTURE_NOW, powerFixtureResponse, telecomFixtureResponse } from '../layer-panel/outages.fixture.ts';
import { OUT_LATE_HEX, OUT_LONG_HEX, OUT_MAINT_HEX, OUT_RECENT_HEX } from '../layer-panel/outages-legend.ts';
import {
  OUT_HOVER_LAYERS, OUT_LAYERS, OUT_LAYER_KEYS, OUT_MAINTENANCE_LAYER, OUT_SOURCE_IDS, outTooltipHtml, powerFeatures, telecomFeatures, topOutHit,
} from './outages-map.ts';
import { resolveAssetCoords } from './iip-geocoding.ts';

const LATE_NOW = Date.parse('2026-10-09T16:00:00+02:00');
const names = (p: PowerOutagesResponse): Array<string | undefined> => powerFeatures(p, OUTAGES_FIXTURE_NOW).features.map((f) => f.properties?.name as string | undefined);

describe('carte des pannes : Télécoms', () => {
  it('un point par site, classe et couleur de la classe ; une panne récente est en rouge', () => {
    const fc = telecomFeatures(telecomFixtureResponse(), OUTAGES_FIXTURE_NOW);
    expect(fc.features).toHaveLength(34);
    expect(fc.features.filter((f) => f.properties?.cls === 'recente')).toHaveLength(18);
    expect(fc.features.find((f) => f.properties?.cls === 'recente')?.properties?.color).toBe('#ef4444');
    expect(fc.features.find((f) => f.properties?.cls === 'recente')?.properties?.color).toBe(OUT_RECENT_HEX);
  });
  it('chaque classe porte sa couleur : longue et sans date en orange, maintenance en gris clair', () => {
    const fc = telecomFeatures(telecomFixtureResponse(), OUTAGES_FIXTURE_NOW);
    const colors = new Map<string, string>();
    for (const f of fc.features) colors.set(String(f.properties?.cls), String(f.properties?.color));
    expect(colors.get('maintenance')).toBe(OUT_MAINT_HEX);
    expect(colors.get('longue')).toBe(OUT_LONG_HEX);
  });
  it('I7 : l’infobulle donne le début de la panne (« Depuis 08/10 à 11 h 02 », heure de Paris), « date n.d. » sans début', () => {
    const t = telecomFixtureResponse();
    const site = t.sites.find((s) => s.since !== null) as (typeof t.sites)[number];
    const parts = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).formatToParts(Date.parse(site.since as string));
    const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
    const expected = `${get('day')}/${get('month')} à ${Number(get('hour'))}${NBSP}h${NBSP}${get('minute')}`;
    const withSince = telecomFeatures({ ...t, sites: [site] }, OUTAGES_FIXTURE_NOW).features[0].properties?.body as string;
    expect(withSince).toContain('<span>Depuis</span>');
    expect(withSince).toContain(`<span>${expected}</span>`);
    const noDate = telecomFeatures({ ...t, sites: [{ ...site, since: null }] }, OUTAGES_FIXTURE_NOW).features[0].properties?.body as string;
    expect(noDate).toContain('<span>Depuis</span><span>date n.d.</span>');
  });
  it('fichier en retard (16 h sans nouveau fichier) : tous les points en gris', () => {
    const late = telecomFeatures(telecomFixtureResponse(), LATE_NOW);
    expect(late.features).toHaveLength(34);
    expect(new Set(late.features.map((f) => f.properties?.color))).toEqual(new Set(['#6b7280']));
    expect(new Set(late.features.map((f) => f.properties?.color))).toEqual(new Set([OUT_LATE_HEX]));
  });
  it('fichier de la veille avant 15 h : couleurs gardées (pas en retard)', () => {
    const morning = telecomFeatures(telecomFixtureResponse(), Date.parse('2026-10-09T09:00:00+02:00'));
    expect(morning.features.find((f) => f.properties?.cls === 'recente')?.properties?.color).toBe(OUT_RECENT_HEX);
  });
  it('jamais lu : aucun point ; la géométrie est [lng, lat]', () => {
    expect(telecomFeatures(null, OUTAGES_FIXTURE_NOW).features).toEqual([]);
    expect(telecomFeatures({ ...telecomFixtureResponse(), file: null }, OUTAGES_FIXTURE_NOW).features).toEqual([]);
    const t = telecomFixtureResponse();
    const [first] = telecomFeatures(t, OUTAGES_FIXTURE_NOW).features;
    expect(first.geometry.coordinates).toEqual([t.sites[0].lon, t.sites[0].lat]);
  });
  it('un site sans position lisible n’est pas dessiné', () => {
    const t = telecomFixtureResponse();
    const broken = { ...t, sites: [{ ...t.sites[0], lat: Number.NaN }, ...t.sites.slice(1)] };
    expect(telecomFeatures(broken, OUTAGES_FIXTURE_NOW).features).toHaveLength(33);
  });
});

describe('carte des pannes : Électricité', () => {
  it('unités placées par la liste d’emplacements ; une unité sans emplacement n’est pas dessinée (V5)', () => {
    const p = powerFixtureResponse();
    const fc = powerFeatures(p, OUTAGES_FIXTURE_NOW);
    expect(fc.features.map((f) => f.properties?.name)).toEqual(expect.arrayContaining(['PALUEL 1', 'CRUAS 1', 'BLENOD 5', 'SUPER BISSORTE 5']));
    expect(fc.features.find((f) => f.properties?.name === 'PALUEL 1')?.properties?.kind).toBe('imprevue');
    const unplaced = [...p.unplanned, ...p.planned].filter((u) => resolveAssetCoords(u.name) === null).map((u) => u.name);
    for (const name of unplaced) expect(names(p), name).not.toContain(name);
    expect(fc.features).toHaveLength([...p.unplanned, ...p.planned].length - unplaced.length);
  });
  it('arrêt imprévu en rouge, maintenance en gris clair ; EDF muet ou en retard : tout en gris', () => {
    const p = powerFixtureResponse();
    const fc = powerFeatures(p, OUTAGES_FIXTURE_NOW);
    expect(fc.features.find((f) => f.properties?.kind === 'imprevue')?.properties?.color).toBe(OUT_RECENT_HEX);
    expect(fc.features.find((f) => f.properties?.kind === 'planifiee')?.properties?.color).toBe(OUT_MAINT_HEX);
    // Le retard se mesure sur la dernière lecture EDF réussie (R20), non sur la date de mise à jour du jeu.
    const stale = powerFeatures({ ...p, edfReadAt: '2026-10-08T10:00:00.000Z' }, OUTAGES_FIXTURE_NOW);
    expect(new Set(stale.features.map((f) => f.properties?.color))).toEqual(new Set([OUT_LATE_HEX]));
    const mute = powerFeatures({ ...p, edfReadAt: null }, OUTAGES_FIXTURE_NOW);
    expect(new Set(mute.features.map((f) => f.properties?.color))).toEqual(new Set([OUT_LATE_HEX]));
    expect(powerFeatures({ ...p, edfUpdatedAt: '2026-10-01T00:00:00.000Z' }, OUTAGES_FIXTURE_NOW).features[0].properties?.color).not.toBe(OUT_LATE_HEX);
  });
  it('jamais lu : aucune unité', () => {
    expect(powerFeatures(null, OUTAGES_FIXTURE_NOW).features).toEqual([]);
  });
});

describe('carte des pannes : couches et infobulle', () => {
  it('couches : toutes cachées jusqu’à setLayerVisibility ; maintenances télécoms à part (option)', () => {
    expect(OUT_LAYERS.every((l) => (l.layout as { visibility?: string } | undefined)?.visibility === 'none')).toBe(true);
    expect(OUT_LAYER_KEYS.outagesTelecom).toEqual(['out-telecom-long', 'out-telecom-recent']);
    expect(OUT_LAYER_KEYS.outagesElec).toEqual(['out-power-planned', 'out-power-unplanned']);
    expect(OUT_MAINTENANCE_LAYER).toBe('out-telecom-maint');
    expect(OUT_LAYERS.map((l) => l.id).sort()).toEqual([...OUT_LAYER_KEYS.outagesTelecom, ...OUT_LAYER_KEYS.outagesElec, OUT_MAINTENANCE_LAYER].sort());
    expect(OUT_SOURCE_IDS).toEqual(['out-telecom-src', 'out-power-src']);
    expect([...OUT_HOVER_LAYERS].sort()).toEqual(OUT_LAYERS.map((l) => l.id).sort());
  });
  it('infobulle : le corps préparé avec la donnée est repris dans le gabarit hm-tip ; null hors des couches survolables ou sans corps', () => {
    const fc = powerFeatures(powerFixtureResponse(), OUTAGES_FIXTURE_NOW);
    const props = fc.features[0].properties ?? {};
    const html = outTooltipHtml('out-power-unplanned', props);
    expect(html).toContain('class="hm-tip"');
    expect(html).toContain(String(props.name));
    expect(outTooltipHtml('sov-aircraft', props)).toBeNull();
    expect(outTooltipHtml('out-power-unplanned', { name: 'x' })).toBeNull();
    expect(outTooltipHtml('out-telecom-recent', { body: '<b>ok</b>' })).toBe('<div class="hm-tip"><b>ok</b></div>');
  });
  it('le corps d’une infobulle Télécoms échappe les textes de la source', () => {
    const t = telecomFixtureResponse();
    t.sites[0] = { ...t.sites[0], commune: '<img src=x onerror=alert(1)>', detail: '<script>alert(1)</script>' };
    const body = String(telecomFeatures(t, OUTAGES_FIXTURE_NOW).features[0].properties?.body);
    expect(body).not.toContain('<img');
    expect(body).not.toContain('<script');
    expect(body).toContain('&lt;img');
  });
  it('couche survolée : la plus haute répond (arrêt imprévu avant maintenance)', () => {
    const hit = topOutHit([{ layer: { id: 'out-telecom-maint' } }, { layer: { id: 'out-power-unplanned' } }]);
    expect(hit?.layer.id).toBe('out-power-unplanned');
    expect(topOutHit([])).toBeUndefined();
  });
  it('R1 et typographie : ni tiret cadratin ni « temps réel » dans les corps ; valeur sur une ligne', () => {
    const bodies = [
      ...telecomFeatures(telecomFixtureResponse(), OUTAGES_FIXTURE_NOW).features, ...powerFeatures(powerFixtureResponse(), OUTAGES_FIXTURE_NOW).features,
    ].map((f) => String(f.properties?.body));
    for (const b of bodies) {
      expect(b).not.toMatch(/\u2014|temps réel|LIVE/i);
      expect(b, b).not.toMatch(/\d (?:MW|%|km|h|min|j)\b/);
    }
  });
});
