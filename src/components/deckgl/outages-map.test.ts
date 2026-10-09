// src/components/deckgl/outages-map.test.ts
// Carte des pannes réseau (spec 2026-10-08 § 2.1, § 2.2) : entités Télécoms et Électricité, couches, infobulle.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { levelHex } from '../../services/vigilance.ts';
import type { CloudOutagesResponse, CloudProvider, CloudStatus, InternetEvent, InternetOutagesResponse, PowerOutagesResponse } from '../../types/index.ts';
import { NBSP, breakableValue } from '../layer-panel/format.ts';
import {
  CLOUD_FIXTURE_NOW, INTERNET_FIXTURE_NOW, OUTAGES_FIXTURE_NOW, cloudFixtureResponse, internetFixtureResponse, powerFixtureResponse, telecomFixtureResponse,
} from '../layer-panel/outages.fixture.ts';
import { OUT_LATE_HEX, OUT_LONG_HEX, OUT_MAINT_HEX, OUT_RECENT_HEX, OUT_REF_HEX } from '../layer-panel/outages-legend.ts';
import {
  OUT_HOVER_LAYERS, OUT_LAYERS, OUT_LAYER_KEYS, OUT_MAINTENANCE_LAYER, OUT_SOURCE_IDS, cloudReferenceFeatures, cloudZoneFeatures, internetFeatures,
  outTooltipHtml, powerFeatures, telecomFeatures, topOutHit,
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
    expect(OUT_LAYER_KEYS.outagesInternet).toEqual(['out-internet-fill', 'out-internet-line']);
    expect(OUT_LAYER_KEYS.outagesCloud).toEqual(['out-cloud-ref', 'out-cloud-zones']);
    expect(Object.keys(OUT_LAYER_KEYS).sort()).toEqual(['outagesCloud', 'outagesElec', 'outagesInternet', 'outagesTelecom']);
    expect(OUT_MAINTENANCE_LAYER).toBe('out-telecom-maint');
    expect(OUT_LAYERS.map((l) => l.id).sort()).toEqual([...Object.values(OUT_LAYER_KEYS).flat(), OUT_MAINTENANCE_LAYER].sort());
    expect(OUT_SOURCE_IDS).toEqual(['out-telecom-src', 'out-power-src', 'out-internet-src', 'out-cloud-ref-src', 'out-cloud-zones-src']);
    expect([...OUT_HOVER_LAYERS].sort()).toEqual(OUT_LAYERS.map((l) => l.id).sort());
  });
  it('chaque couche lit une source déclarée ; le remplissage Internet ne montre que les départements en cours, le contour tous', () => {
    for (const l of OUT_LAYERS) expect(OUT_SOURCE_IDS, l.id).toContain((l as { source: string }).source);
    const fill = OUT_LAYERS.find((l) => l.id === 'out-internet-fill');
    expect(fill?.type).toBe('fill');
    expect((fill as { filter?: unknown }).filter).toEqual(['==', ['get', 'state'], 'encours']);
    expect(OUT_LAYERS.find((l) => l.id === 'out-internet-line')?.type).toBe('line');
    expect(OUT_LAYERS.find((l) => l.id === 'out-cloud-ref')?.type).toBe('circle');
    expect(OUT_LAYERS.find((l) => l.id === 'out-cloud-zones')?.type).toBe('circle');
  });
  it('survol : points du cloud en tête, puis les couches de la phase A, les surfaces Internet en dernier (la plus basse répond en dernier)', () => {
    expect(OUT_HOVER_LAYERS.slice(0, 2)).toEqual(['out-cloud-zones', 'out-cloud-ref']);
    expect(OUT_HOVER_LAYERS.slice(-2)).toEqual(['out-internet-line', 'out-internet-fill']);
    expect(topOutHit([{ layer: { id: 'out-internet-fill' } }, { layer: { id: 'out-cloud-ref' } }, { layer: { id: 'out-cloud-zones' } }])?.layer.id).toBe('out-cloud-zones');
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

// ─── Internet ───

const GEO = JSON.parse(readFileSync(new URL('../../../public/data/departements.geojson', import.meta.url), 'utf8')) as GeoJSON.FeatureCollection;
const DAY = 86_400_000;
const iodaRead = (r: InternetOutagesResponse): number => Date.parse(r.iodaReadAt as string);
/** Événement de la Creuse en cours depuis 3 jours (à la lecture IODA), modifiable par `patch`. */
const event = (r: InternetOutagesResponse, patch: Partial<InternetEvent>): InternetEvent => ({
  id: 'region/test:1:bgp', scope: 'departement', dept: '23', asn: null, label: 'Creuse', signal: 'bgp', start: new Date(iodaRead(r) - 3 * DAY).toISOString(),
  end: null, durationSec: 3 * 86_400, ongoing: true, staleOpen: false, score: 1, ...patch,
});
const withEvents = (events: InternetEvent[], patch: Partial<InternetOutagesResponse> = {}): InternetOutagesResponse => ({ ...internetFixtureResponse(), events, ...patch });
const body = (f: GeoJSON.Feature | undefined): string => String(f?.properties?.body ?? '');

describe('carte des pannes : Internet (départements en anomalie)', () => {
  it('jeu d’essai du 08/10 : aucune entité (quatre départements de métropole terminés depuis plus de 7 jours, Guadeloupe sans polygone, opérateur sans lieu)', () => {
    const r = internetFixtureResponse();
    expect(r.events.some((e) => e.dept === '971' && !e.ongoing)).toBe(true);
    expect(internetFeatures(r, GEO, INTERNET_FIXTURE_NOW).features).toEqual([]);
  });
  it('outre-mer : le fichier des départements n’a pas de polygone 971, un événement récent de la Guadeloupe n’est pas dessiné (V5)', () => {
    expect(GEO.features.some((f) => f.properties?.code === '971')).toBe(false);
    const r = internetFixtureResponse();
    const gp = r.events.find((e) => e.dept === '971') as InternetEvent;
    expect(iodaRead(r) - Date.parse(gp.end as string)).toBeLessThan(7 * DAY);
    expect(internetFeatures(withEvents([gp]), GEO, INTERNET_FIXTURE_NOW).features).toEqual([]);
  });
  it('un événement d’opérateur, national ou d’une région non identifiée n’a jamais d’entité, même en cours', () => {
    const r = internetFixtureResponse();
    const events = [
      event(r, { scope: 'operateur', dept: null, asn: 3215, label: 'Orange (AS3215)' }), event(r, { scope: 'national', dept: null, label: 'France' }),
      event(r, { scope: 'inconnu', dept: null, label: 'Région inconnue' }),
    ];
    expect(internetFeatures(withEvents(events), GEO, INTERNET_FIXTURE_NOW).features).toEqual([]);
  });
  it('Creuse terminée il y a 2 jours : une entité « recent », contour orange, géométrie identique à celle du fichier', () => {
    const r = internetFixtureResponse();
    const end = new Date(iodaRead(r) - 2 * DAY).toISOString();
    const start = new Date(iodaRead(r) - 2 * DAY - 3_600_000).toISOString();
    const fc = internetFeatures(withEvents([event(r, { start, end, ongoing: false, durationSec: 3600 })]), GEO, INTERNET_FIXTURE_NOW);
    expect(fc.features).toHaveLength(1);
    const [f] = fc.features;
    expect(f.properties).toMatchObject({ dept: '23', state: 'recent', color: OUT_LONG_HEX });
    expect(f.geometry).toEqual(GEO.features.find((g) => g.properties?.code === '23')?.geometry);
  });
  it('terminée depuis 8 jours : pas d’entité', () => {
    const r = internetFixtureResponse();
    const end = new Date(iodaRead(r) - 8 * DAY).toISOString();
    expect(internetFeatures(withEvents([event(r, { end, ongoing: false })]), GEO, INTERNET_FIXTURE_NOW).features).toEqual([]);
  });
  it('Creuse en cours : état « encours » en rouge ; ouverte depuis plus de 7 jours (staleOpen) : pas d’entité', () => {
    const r = internetFixtureResponse();
    const live = internetFeatures(withEvents([event(r, {})]), GEO, INTERNET_FIXTURE_NOW);
    expect(live.features).toHaveLength(1);
    expect(live.features[0].properties).toMatchObject({ dept: '23', state: 'encours', color: levelHex('rouge') });
    expect(internetFeatures(withEvents([event(r, { staleOpen: true })]), GEO, INTERNET_FIXTURE_NOW).features).toEqual([]);
  });
  it('deux événements (bgp, ping-slash24) sur la Creuse : une seule entité, deux lignes dans l’infobulle ; en cours l’emporte sur terminé', () => {
    const r = internetFixtureResponse();
    const end = new Date(iodaRead(r) - 2 * DAY).toISOString();
    const two = withEvents([event(r, { signal: 'bgp' }), event(r, { id: 'region/test:2:ping', signal: 'ping-slash24' })]);
    const fc = internetFeatures(two, GEO, INTERNET_FIXTURE_NOW);
    expect(fc.features).toHaveLength(1);
    expect(body(fc.features[0]).match(/class="hm-row"/g)).toHaveLength(2);
    const mixed = internetFeatures(withEvents([event(r, { end, ongoing: false }), event(r, { signal: 'ping-slash24' })]), GEO, INTERNET_FIXTURE_NOW);
    expect(mixed.features).toHaveLength(1);
    expect(mixed.features[0].properties?.state).toBe('encours');
  });
  it('une entité par département touché, chacun à sa géométrie', () => {
    const r = internetFixtureResponse();
    const fc = internetFeatures(withEvents([event(r, {}), event(r, { dept: '87', label: 'Haute-Vienne' })]), GEO, INTERNET_FIXTURE_NOW);
    expect(fc.features.map((f) => f.properties?.dept).sort()).toEqual(['23', '87']);
  });
  it('IODA en retard : gris, état gardé ; jamais lu : aucune entité', () => {
    const r = internetFixtureResponse();
    const events = [event(r, {})];
    const late = internetFeatures(withEvents(events), GEO, iodaRead(r) + 2 * 3_600_000);
    expect(late.features).toHaveLength(1);
    expect(late.features[0].properties?.color).toBe(OUT_LATE_HEX);
    expect(body(late.features[0])).toContain('IODA en retard : couleur retirée.');
    expect(internetFeatures(withEvents(events, { iodaReadAt: null }), GEO, INTERNET_FIXTURE_NOW).features).toEqual([]);
    expect(internetFeatures(null, GEO, INTERNET_FIXTURE_NOW).features).toEqual([]);
  });
  it('infobulle : département nommé, source IODA, signal, début à l’heure de Paris, durée ; textes échappés', () => {
    const r = internetFixtureResponse();
    const start = '2026-10-07T10:05:00.000Z';
    const f = internetFeatures(withEvents([event(r, { start, durationSec: 3 * 86_400 + 4 * 3600, signal: '<b>x</b>' })]), GEO, INTERNET_FIXTURE_NOW).features[0];
    const b = body(f);
    expect(b).toContain('<b>Creuse (23)</b>');
    expect(b).toContain('IODA');
    expect(b).toContain(`07/10 à 12${NBSP}h${NBSP}05`);
    expect(b).toContain('en cours');
    expect(b).not.toContain('<b>x</b>');
    expect(b).toContain('&lt;b&gt;x');
  });
  it('infobulle d’un événement terminé : durée en minutes, insécable', () => {
    const r = internetFixtureResponse();
    const end = new Date(iodaRead(r) - 2 * DAY).toISOString();
    const f = internetFeatures(withEvents([event(r, { end, ongoing: false, durationSec: 4500 })]), GEO, INTERNET_FIXTURE_NOW).features[0];
    expect(body(f)).toContain(`1${NBSP}h${NBSP}15`);
    expect(breakableValue(body(f).replace(/<[^>]+>/g, ' '))).toBeNull();
  });
});

// ─── Cloud ───

const ref = (r: CloudOutagesResponse, p: CloudProvider) => r.providers.find((x) => x.provider === p) as CloudOutagesResponse['providers'][number];
const setStatus = (r: CloudOutagesResponse, provider: CloudProvider, zoneId: string, status: CloudStatus): void => {
  const z = ref(r, provider).zones.find((x) => x.id === zoneId);
  if (!z) throw new Error(`zone ${zoneId} absente`);
  z.status = status;
};
const place = (f: GeoJSON.Feature<GeoJSON.Point>): string => `${f.geometry.coordinates[0]},${f.geometry.coordinates[1]}`;
const at = (fc: GeoJSON.FeatureCollection<GeoJSON.Point>, lon: number, lat: number): GeoJSON.Feature<GeoJSON.Point> => {
  const found = fc.features.find((f) => place(f) === `${lon},${lat}`);
  if (!found) throw new Error(`aucun cercle en ${lon},${lat}`);
  return found;
};
const PARIS = [2.35, 48.86] as const;
const GRAVELINES = [2.13, 50.99] as const;
const cloudBodies = (): string[] => [
  ...cloudZoneFeatures(cloudFixtureResponse(), CLOUD_FIXTURE_NOW).features, ...cloudReferenceFeatures(cloudFixtureResponse()).features,
].map((f) => String(f.properties?.body));
/** Jeu d'essai où les zones DONT l'état est publié sont toutes opérationnelles (le jeu réel du 08/10 en a une en maintenance, DC1). */
const quiet = (): CloudOutagesResponse => {
  const r = cloudFixtureResponse();
  for (const p of r.providers) for (const z of p.zones) if (z.status === 'maintenance') z.status = 'operational';
  return r;
};

describe('carte des pannes : Cloud (un cercle par lieu)', () => {
  it('un cercle par lieu, tous fournisseurs confondus : Paris, Gravelines, Roubaix, Strasbourg, Bordeaux, Lyon, Marseille, et aucune position en double', () => {
    const fc = cloudZoneFeatures(cloudFixtureResponse(), CLOUD_FIXTURE_NOW);
    expect(fc.features.map(place).sort()).toEqual(['-0.58,44.84', '2.13,50.99', '2.35,48.86', '3.18,50.69', '4.84,45.76', '5.37,43.3', '7.79,48.58'].sort());
    expect(new Set(fc.features.map(place)).size).toBe(fc.features.length);
  });
  it('lieu partagé : OVH en panne majeure à Paris et les autres fournisseurs verts donnent un cercle rouge dont l’infobulle nomme OVHcloud', () => {
    const r = quiet();
    setStatus(r, 'ovhcloud', 'EU-WEST-PAR-A', 'major');
    const paris = at(cloudZoneFeatures(r, CLOUD_FIXTURE_NOW), ...PARIS);
    expect(paris.properties).toMatchObject({ color: levelHex('rouge'), status: 'major', rank: 6 });
    expect(String(paris.properties?.providers).split(',')).toEqual(expect.arrayContaining(['ovhcloud', 'cloudflare', 'gcp', 'aws', 'scaleway']));
    const b = body(paris);
    expect(b).toContain('<span>OVHcloud</span><span>panne majeure</span>');
    expect(b).toContain('Paris (EU-WEST-PAR-A)');
    expect(b).toContain('<span>Cloudflare</span><span>opérationnel</span>');
    expect(b).toContain('<span>Google Cloud</span><span>aucun incident publié</span>');
    expect(b).toContain('<span>AWS</span><span>aucun incident publié</span>');
    expect(b).toContain('<b>Paris</b>');
  });
  it('couche des zones : le plus grave est dessiné au-dessus (circle-sort-key sur le rang)', () => {
    const layer = OUT_LAYERS.find((l) => l.id === 'out-cloud-zones');
    expect((layer?.layout as Record<string, unknown>)['circle-sort-key']).toEqual(['get', 'rank']);
    const r = quiet();
    setStatus(r, 'ovhcloud', 'GRA7', 'partial');
    const fc = cloudZoneFeatures(r, CLOUD_FIXTURE_NOW);
    const rank = (f: GeoJSON.Feature): number => Number(f.properties?.rank);
    expect(rank(at(fc, ...GRAVELINES))).toBeGreaterThan(rank(at(fc, ...PARIS)));
  });
  it('quatre points de présence Cloudflare (BOD, CDG, LYS, MRS) : Bordeaux, Lyon et Marseille verts, Paris partagé', () => {
    const fc = cloudZoneFeatures(quiet(), CLOUD_FIXTURE_NOW);
    for (const [lon, lat] of [[-0.58, 44.84], [4.84, 45.76], [5.37, 43.3]] as const) {
      expect(at(fc, lon, lat).properties).toMatchObject({ providers: 'cloudflare', color: levelHex('vert') });
    }
    expect(String(at(fc, ...PARIS).properties?.providers)).toContain('cloudflare');
  });
  it('OVHcloud : 24 zones sur quatre lieux (Roubaix, Strasbourg, Gravelines, Paris) ; Gravelines regroupe ses zones sous un seul nom', () => {
    const r = cloudFixtureResponse();
    const fc = cloudZoneFeatures(r, CLOUD_FIXTURE_NOW);
    const ovh = fc.features.filter((f) => String(f.properties?.providers).split(',').includes('ovhcloud'));
    expect(ovh.map((f) => body(f).match(/<b>([^<]+)<\/b>/)?.[1]).sort()).toEqual(['Gravelines', 'Paris', 'Roubaix', 'Strasbourg']);
    expect(ref(r, 'ovhcloud').zones.filter((z) => z.lat !== null).length).toBeGreaterThan(ovh.length);
    expect(body(at(fc, ...GRAVELINES))).toMatch(/<span>Zones suivies<\/span><span>\d+<\/span>/);
  });
  it('Scaleway : régions fr-par et centres DC1 à DC5 sont au point de Paris (région parisienne), non à part ; Outscale (sans coordonnées) et Azure non dessinés', () => {
    const fc = cloudZoneFeatures(cloudFixtureResponse(), CLOUD_FIXTURE_NOW);
    const providers = new Set(fc.features.flatMap((f) => String(f.properties?.providers).split(',')));
    expect(providers.has('scaleway')).toBe(true);
    expect(providers.has('outscale')).toBe(false);
    expect(providers.has('azure')).toBe(false);
    const b = body(at(fc, ...PARIS));
    expect(b).toContain('<span>Scaleway</span>');
    expect(b).toContain('Région fr-par : région parisienne.');
  });
  it('une zone OVH en panne partielle sur Gravelines colore le seul cercle de Gravelines en orange ; les autres lieux OVH restent verts', () => {
    const r = quiet();
    setStatus(r, 'ovhcloud', 'GRA7', 'partial');
    const fc = cloudZoneFeatures(r, CLOUD_FIXTURE_NOW);
    expect(fc.features.filter((f) => f.properties?.color === levelHex('orange'))).toHaveLength(1);
    const gra = at(fc, ...GRAVELINES);
    expect(gra.properties?.color).toBe(levelHex('orange'));
    expect(body(gra)).toContain('<b>Gravelines</b>');
    expect(body(gra)).toContain('<span>OVHcloud</span><span>panne partielle</span>');
    expect(body(gra)).toContain('<span>Gravelines (GRA7)</span><span>panne partielle</span>');
    for (const [lon, lat] of [[3.18, 50.69], [7.79, 48.58]] as const) expect(at(fc, lon, lat).properties?.color).toBe(levelHex('vert'));
  });
  it('regroupement : majeure avant partielle avant dégradée avant maintenance avant opérationnel avant inconnu', () => {
    const r = quiet();
    setStatus(r, 'ovhcloud', 'GRA5', 'degraded');
    setStatus(r, 'ovhcloud', 'GRA7', 'major');
    setStatus(r, 'ovhcloud', 'GRA9', 'partial');
    setStatus(r, 'ovhcloud', 'GRA11', 'unknown');
    expect(at(cloudZoneFeatures(r, CLOUD_FIXTURE_NOW), ...GRAVELINES).properties).toMatchObject({ color: levelHex('rouge'), status: 'major' });
    const m = quiet();
    setStatus(m, 'ovhcloud', 'GRA5', 'maintenance');
    expect(at(cloudZoneFeatures(m, CLOUD_FIXTURE_NOW), ...GRAVELINES).properties?.color).toBe(OUT_MAINT_HEX);
    const u = quiet();
    setStatus(u, 'ovhcloud', 'GRA5', 'unknown');
    expect(at(cloudZoneFeatures(u, CLOUD_FIXTURE_NOW), ...GRAVELINES).properties?.color).toBe(levelHex('vert'));
    const d = quiet();
    setStatus(d, 'ovhcloud', 'GRA5', 'degraded');
    expect(at(cloudZoneFeatures(d, CLOUD_FIXTURE_NOW), ...GRAVELINES).properties?.color).toBe(levelHex('jaune'));
  });
  it('un lieu entièrement inconnu est gris (aucun état lisible)', () => {
    const r = quiet();
    for (const z of ref(r, 'cloudflare').zones) z.status = 'unknown';
    expect(at(cloudZoneFeatures(r, CLOUD_FIXTURE_NOW), 4.84, 45.76).properties?.color).toBe(OUT_LATE_HEX);
  });
  it('GCP et AWS ne publient aucun état par région : seule, une zone déduite reste en teinte neutre, jamais en vert', () => {
    const r = quiet();
    for (const p of r.providers) if (p.provider !== 'gcp' && p.provider !== 'aws') p.zones = [];
    const paris = at(cloudZoneFeatures(r, CLOUD_FIXTURE_NOW), ...PARIS);
    expect(paris.properties).toMatchObject({ color: OUT_REF_HEX, status: 'none', rank: 0 });
    expect(body(paris)).toContain('<span>Google Cloud</span><span>aucun incident publié</span>');
  });
  it('GCP avec un incident publié (zone dégradée) : le lieu prend la couleur de l’incident', () => {
    const r = quiet();
    for (const p of r.providers) if (p.provider !== 'gcp' && p.provider !== 'aws') p.zones = [];
    setStatus(r, 'gcp', 'europe-west9', 'degraded');
    const paris = at(cloudZoneFeatures(r, CLOUD_FIXTURE_NOW), ...PARIS);
    expect(paris.properties).toMatchObject({ color: levelHex('jaune'), status: 'degraded' });
    expect(body(paris)).toContain('<span>Google Cloud</span><span>performances dégradées</span>');
  });
  it('un état publié opérationnel à Paris (Cloudflare) colore en vert malgré les zones déduites du même lieu', () => {
    const paris = at(cloudZoneFeatures(quiet(), CLOUD_FIXTURE_NOW), ...PARIS);
    expect(paris.properties?.color).toBe(levelHex('vert'));
  });
  it('infobulle : lieu, fournisseurs, état, zones suivies, zones non opérationnelles et date de mise à jour par fournisseur', () => {
    const r = quiet();
    setStatus(r, 'ovhcloud', 'GRA7', 'partial');
    const b = body(at(cloudZoneFeatures(r, CLOUD_FIXTURE_NOW), ...GRAVELINES));
    expect(b).toContain('class="hm-sub">OVHcloud</div>');
    expect(b).toContain('<span>Mis à jour</span>');
    const paris = body(at(cloudZoneFeatures(r, CLOUD_FIXTURE_NOW), ...PARIS));
    expect(paris).toContain('<span>Mis à jour</span><span>aucun incident publié</span>');
  });
  it('plus de huit zones non opérationnelles : huit lignes puis « et n autres. »', () => {
    const r = quiet();
    const many = ref(r, 'ovhcloud').zones.filter((z) => z.lat === GRAVELINES[1]);
    expect(many.length).toBeGreaterThan(8);
    for (const z of many) z.status = 'degraded';
    const b = body(at(cloudZoneFeatures(r, CLOUD_FIXTURE_NOW), ...GRAVELINES));
    expect(b.match(/performances dégradées/g)?.length).toBe(9); // huit lignes de zone et la ligne du fournisseur
    expect(b).toContain(`et ${many.length - 8}${NBSP}autre`);
  });
  it('fournisseur en retard (lu il y a 3 h) : il ne colore plus ; le lieu est gris s’il est seul, sinon les autres fournisseurs colorent', () => {
    const late = quiet();
    ref(late, 'cloudflare').readAt = new Date(CLOUD_FIXTURE_NOW - 3 * 3_600_000).toISOString();
    setStatus(late, 'cloudflare', 'CDG', 'major');
    setStatus(late, 'cloudflare', 'LYS', 'major');
    const fc = cloudZoneFeatures(late, CLOUD_FIXTURE_NOW);
    const lyon = at(fc, 4.84, 45.76);
    expect(lyon.properties?.color).toBe(OUT_LATE_HEX);
    expect(body(lyon)).toContain('Cloudflare : page d’état en retard, couleur retirée.');
    expect(at(fc, ...PARIS).properties?.color).toBe(levelHex('vert'));
    expect(at(fc, ...GRAVELINES).properties?.color).toBe(levelHex('vert'));
  });
  it('I3 (R41, B7) : fournisseur à jour dont une page a échoué : couleurs gardées, panne d’une autre page gardée au lieu, erreur nommée', () => {
    const err = quiet();
    ref(err, 'ovhcloud').error = 'OVHcloud (web-cloud) : HTTP 503';
    setStatus(err, 'ovhcloud', 'GRA7', 'major');
    const fc = cloudZoneFeatures(err, CLOUD_FIXTURE_NOW);
    expect(at(fc, ...GRAVELINES).properties).toMatchObject({ color: levelHex('rouge'), status: 'major' });
    for (const [lon, lat] of [[3.18, 50.69], [7.79, 48.58]] as const) expect(at(fc, lon, lat).properties?.color).toBe(levelHex('vert'));
    expect(body(at(fc, ...GRAVELINES))).toContain('OVHcloud : une page d’état en erreur, dernières données gardées.');
    expect(body(at(fc, ...GRAVELINES))).not.toContain('couleur retirée');
  });
  it('fournisseur en erreur ET en retard (lu il y a 3 h) : gris ; jamais lu : gris', () => {
    const err = quiet();
    ref(err, 'ovhcloud').error = 'OVHcloud (network) : HTTP 503';
    ref(err, 'ovhcloud').readAt = new Date(CLOUD_FIXTURE_NOW - 3 * 3_600_000).toISOString();
    const fc = cloudZoneFeatures(err, CLOUD_FIXTURE_NOW);
    expect(at(fc, ...GRAVELINES).properties?.color).toBe(OUT_LATE_HEX);
    expect(body(at(fc, ...GRAVELINES))).toContain('OVHcloud : page d’état en retard, couleur retirée.');
    const never = quiet();
    ref(never, 'cloudflare').readAt = null;
    expect(at(cloudZoneFeatures(never, CLOUD_FIXTURE_NOW), 4.84, 45.76).properties?.color).toBe(OUT_LATE_HEX);
  });
  it('jamais lu : aucune entité', () => {
    expect(cloudZoneFeatures(null, CLOUD_FIXTURE_NOW).features).toEqual([]);
    expect(cloudReferenceFeatures(null).features).toEqual([]);
  });
  it('une zone sans position lisible n’est pas dessinée', () => {
    const r = quiet();
    const lys = ref(r, 'cloudflare').zones.find((z) => z.id === 'LYS');
    if (lys) lys.lat = Number.NaN;
    expect(cloudZoneFeatures(r, CLOUD_FIXTURE_NOW).features.map(place)).not.toContain('4.84,45.76');
  });
});

describe('carte des pannes : Cloud (référentiel, inventaire)', () => {
  it('chaque centre du référentiel est en teinte neutre, jamais une teinte de statut, même si son fournisseur est en panne', () => {
    const r = cloudFixtureResponse();
    for (const p of r.providers) for (const z of p.zones) z.status = 'major';
    const fc = cloudReferenceFeatures(r);
    expect(fc.features).toHaveLength(r.reference.datacenters.length);
    expect(fc.features.length).toBeGreaterThan(0);
    expect(new Set(fc.features.map((f) => f.properties?.color))).toEqual(new Set([OUT_REF_HEX]));
    expect(fc.features[0].geometry.coordinates).toEqual([r.reference.datacenters[0].lon, r.reference.datacenters[0].lat]);
  });
  it('infobulle : nom, opérateur, ville, avancement, puissance si publiés ; « Inventaire, pas un état. » ; source en français', () => {
    const r = cloudFixtureResponse();
    r.reference.datacenters = [
      { id: 'a', name: 'Centre <A>', operator: 'Opérateur', city: 'Paris', lat: 48.86, lon: 2.35, stage: 'en projet', power: '10 à 50 MW', source: 'static backbone' },
      { id: 'b', name: 'Centre B', operator: null, city: null, lat: 45.76, lon: 4.84, stage: null, power: null, source: 'OpenStreetMap France datacenters snapshot' },
    ];
    const [a, b] = cloudReferenceFeatures(r).features.map(body);
    expect(a).toContain('<b>Centre &lt;A&gt;</b>');
    expect(a).toContain('<span>Ville</span><span>Paris</span>');
    expect(a).toContain('<span>Avancement</span><span>en projet</span>');
    expect(a).toContain('<span>Puissance</span><span>10 à 50 MW</span>');
    expect(a).toContain('Inventaire, pas un état.');
    expect(a).toContain('inventaire embarqué');
    expect(a).not.toContain('static backbone');
    expect(b).toContain('opérateur n.d.');
    expect(b).toContain('<span>Ville</span><span>n.d.</span>');
    expect(b).not.toContain('Avancement');
    expect(b).not.toContain('Puissance');
    expect(b).toContain('OpenStreetMap');
    expect(b).not.toContain('snapshot');
  });
  it('un libellé de source inconnu est repris tel quel (rien d’inventé), échappé', () => {
    const r = cloudFixtureResponse();
    r.reference.datacenters = [{ id: 'a', name: 'A', operator: null, city: null, lat: 1, lon: 2, stage: null, power: null, source: 'Autre <i>' }];
    expect(body(cloudReferenceFeatures(r).features[0])).toContain('Autre &lt;i&gt;');
  });
  it('un site sans position lisible n’est pas dessiné', () => {
    const r = cloudFixtureResponse();
    r.reference.datacenters = [...r.reference.datacenters, { id: 'x', name: 'X', operator: null, city: null, lat: Number.NaN, lon: 2, stage: null, power: null, source: 'uMap' }];
    expect(cloudReferenceFeatures(r).features).toHaveLength(r.reference.datacenters.length - 1);
  });
});

describe('carte des pannes : Internet et Cloud, hygiène des infobulles', () => {
  it('ni tiret cadratin, ni « temps réel », ni « live » ; aucune valeur coupée entre nombre et unité', () => {
    const r = internetFixtureResponse();
    const internet = internetFeatures(withEvents([event(r, {}), event(r, { dept: '87', label: 'Haute-Vienne', end: new Date(iodaRead(r) - DAY).toISOString(), ongoing: false })]), GEO, INTERNET_FIXTURE_NOW);
    const bodies = [...internet.features.map(body), ...cloudBodies()];
    expect(bodies.length).toBeGreaterThan(6);
    for (const b of bodies) {
      expect(b).not.toMatch(/\u2014|temps réel|LIVE/i);
      expect(breakableValue(b.replace(/<[^>]+>/g, ' ')), b).toBeNull();
    }
  });
  it('les textes de la source sont échappés dans les zones du cloud', () => {
    const r = cloudFixtureResponse();
    const z = ref(r, 'cloudflare').zones.find((x) => x.id === 'LYS');
    if (z) z.label = '<img src=x onerror=alert(1)>';
    const html = cloudZoneFeatures(r, CLOUD_FIXTURE_NOW).features.map(body).join('');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});
