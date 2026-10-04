// src/components/deckgl/environment-map.test.ts : couches Environnement de la carte (spec 2026-10-04 environnement § 2 ; contrats § 5)
// sur les réponses réelles du 04/10/2026 (environment.fixture.ts) et les polygones des départements versionnés.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { levelHex } from '../../services/vigilance.ts';
import {
  ENV_FIXTURE_NOW, FIRES_FIXTURE, FLOODS_FIXTURE, VIGILANCE_FIXTURE,
} from '../layer-panel/environment.fixture.ts';
import { ENV_NEUTRAL_HEX, FIRE_ABROAD_HEX, FIRE_RECURRENT_HEX, FLOOD_STATION_HEX } from '../layer-panel/environment-legend.ts';
import {
  LYR_FIRES_ABROAD, LYR_FIRES_GLOW, LYR_FIRES_POINTS, LYR_FLOODS, LYR_FLOOD_STATIONS, LYR_FOREST_DANGER_FILL, LYR_FOREST_DANGER_LINE,
  LYR_RADAR_PICK, LYR_WEATHER_FILL, LYR_WEATHER_ICONS,
} from './constants.ts';
import {
  ENV_HOVER_LAYERS, ENV_ICON_GLYPH, ENV_ICON_NAMES, ENV_ICON_SIZE, alphaToSdf, ENV_LAYERS, ENV_LAYER_BEFORE, ENV_LAYER_KEYS, ENV_SOURCE_IDS, envLayerOn, envTooltipHtml, fireAbroadFeatures,
  fireDetectionFeatures, floodSectionFeatures, floodStationFeatures, forestDangerFeatures, radarPickFeature, topEnvHit, vigilanceDeptFeatures,
  vigilanceIconFeatures,
} from './environment-map.ts';

const GEO = JSON.parse(readFileSync(new URL('../../../public/data/departements.geojson', import.meta.url), 'utf8')) as GeoJSON.FeatureCollection;
const NOW = ENV_FIXTURE_NOW;
const H = 3_600_000;
const props = (f: GeoJSON.Feature | undefined): Record<string, unknown> => (f?.properties ?? {}) as Record<string, unknown>;
const byCode = (fcol: GeoJSON.FeatureCollection, code: string): Record<string, unknown> => props(fcol.features.find((f) => props(f)['code'] === code));

describe('vigilance : départements de l’échéance choisie', () => {
  const j = vigilanceDeptFeatures(GEO, VIGILANCE_FIXTURE(), 'J', NOW);
  it('J du 04/10 : Pyrénées-Orientales et Aude orange, Gard jaune, Paris non rempli ; identifiant numérique, 2A et 2B compris', () => {
    expect(j.features).toHaveLength(96);
    expect([byCode(j, '66')['color'], byCode(j, '11')['color'], byCode(j, '30')['color']]).toEqual([levelHex('orange'), levelHex('orange'), levelHex('jaune')]);
    expect([byCode(j, '66')['level'], byCode(j, '66')['hasAlert'], byCode(j, '66')['fillColor']]).toEqual(['orange', true, levelHex('orange')]);
    expect([byCode(j, '75')['hasAlert'], byCode(j, '75')['color'], byCode(j, '75')['body']]).toEqual([false, null, '']);
    expect(j.features.find((f) => props(f)['code'] === '2A')?.id).toBe(200);
  });
  it('infobulle : phénomènes et créneaux en heure de Paris, carte datée, sans tiret cadratin', () => {
    const body = String(byCode(j, '11')['body']);
    expect(body).toContain('<b>Aude (11)</b>');
    expect(body).toContain('Vigilance orange aujourd’hui');
    expect(body).toContain('<span>Pluie-inondation</span><span>orange de 10:00 à 16:00, jaune de 16:00 à 20:00</span>');
    expect(body).toContain('Météo-France, carte de 10:00.');
    expect(body).not.toMatch(/\u2014/);
  });
  it('J+1 : les six départements en jaune ; copie des polygones, jamais modifiés', () => {
    const j1 = vigilanceDeptFeatures(GEO, VIGILANCE_FIXTURE(), 'J1', NOW);
    expect(['66', '11', '13', '30', '2A', '2B'].map((c) => byCode(j1, c)['color'])).toEqual(Array(6).fill(levelHex('jaune')));
    expect(byCode(j1, '64')['hasAlert']).toBe(false);
    expect(props(GEO.features[0])['color']).toBeUndefined();
  });
  it('carte en retard (15 h après 10:00) : gris neutre, dit ; carte absente : rien de rempli', () => {
    const late = vigilanceDeptFeatures(GEO, VIGILANCE_FIXTURE(), 'J', Date.parse('2026-10-04T23:00:13Z'));
    expect(byCode(late, '66')['color']).toBe(ENV_NEUTRAL_HEX);
    expect(String(byCode(late, '66')['body'])).toContain('Carte en retard : couleur retirée.');
    expect(vigilanceDeptFeatures(GEO, null, 'J', NOW).features.every((f) => props(f)['hasAlert'] === false)).toBe(true);
  });
  it('texte de la source échappé', () => {
    const v = VIGILANCE_FIXTURE();
    v.periods[0].departments[0].name = '<img src=x onerror=alert(1)>';
    const hostile = vigilanceDeptFeatures(GEO, v, 'J', NOW);
    const body = String(byCode(hostile, v.periods[0].departments[0].code)['body']);
    expect(body).not.toContain('<img');
    expect(body).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
  it('pictogramme du phénomène le plus fort au centroïde : pluie pour les Pyrénées-Orientales, orages pour le Gard', () => {
    const icons = vigilanceIconFeatures(VIGILANCE_FIXTURE(), 'J', NOW);
    expect(icons.features).toHaveLength(7);
    const po = icons.features.find((f) => props(f)['code'] === '66');
    expect([props(po)['iconImage'], props(po)['color'], po?.geometry.coordinates]).toEqual(['env-icon-cloud-rain', levelHex('orange'), [2.53, 42.6]]);
    expect(props(icons.features.find((f) => props(f)['code'] === '30'))['iconImage']).toBe('env-icon-cloud-lightning');
    expect(vigilanceIconFeatures(VIGILANCE_FIXTURE(), 'J', NOW + 16 * H).features.every((f) => props(f)['color'] === ENV_NEUTRAL_HEX)).toBe(true);
    expect(ENV_ICON_NAMES).toEqual(['wind', 'cloud-rain', 'cloud-lightning', 'waves', 'snowflake', 'thermometer', 'thermometer-snowflake', 'mountain-snow']);
  });
});

describe('crues : tronçons et stations', () => {
  it('quatre tronçons jaunes de Méditerranée Ouest, tracé publié, sans « confiance » ni « recalé »', () => {
    const s = floodSectionFeatures(FLOODS_FIXTURE(), NOW);
    expect(s.features.map((f) => [f.id, props(f)['name'], props(f)['color']])).toEqual([
      ['MO12', 'Têt', levelHex('jaune')], ['MO11', 'Agly', levelHex('jaune')], ['MO16', 'Réart', levelHex('jaune')], ['MO17', 'Tech', levelHex('jaune')],
    ]);
    expect(s.features[0].geometry.coordinates).toEqual(FLOODS_FIXTURE().sections[0].path);
    const body = String(props(s.features[0])['body']);
    expect(body).toContain('Vigilance jaune · Méditerranée Ouest');
    expect(body).toContain('Relevé Vigicrues 10:05');
    expect(body).not.toMatch(/confiance|recal/i);
  });
  it('relevé en retard (plus de 30 min) : gris neutre', () => {
    expect(floodSectionFeatures(FLOODS_FIXTURE(), NOW + 31 * 60_000).features.every((f) => props(f)['color'] === ENV_NEUTRAL_HEX)).toBe(true);
  });
  it('stations : teinte de station ; anneau rouge à Serdinya (+0,012 m), vert à Mas-d’en-Tourens (−0,248 m), aucun sous 5 mm (Saleilles +0,003 m, Vinca 0)', () => {
    const st = floodStationFeatures(FLOODS_FIXTURE(), NOW);
    expect(st.features).toHaveLength(9);
    const get = (code: string): Record<string, unknown> => props(st.features.find((f) => props(f)['code'] === code));
    expect([get('Y042401001')['color'], get('Y042401001')['ring'], get('Y042401001')['ringWidth']]).toEqual([FLOOD_STATION_HEX, levelHex('rouge'), 2.5]);
    expect(get('Y011541001')['ring']).toBe(levelHex('vert'));
    expect([get('Y033400101')['ringWidth'], get('Y046401001')['ringWidth']]).toEqual([0, 0]);
    const body = String(get('Y042401001')['body']);
    expect(body).toContain('<b>Serdinya</b><div class="hm-sub">Station de la vigilance Têt</div>');
    expect(body).toContain('<span>Hauteur</span><span>0,16\u00a0m</span>');
    expect(body).toContain('<span>Variation sur 1 h</span><span>+0,01\u00a0m</span>');
    expect(body).toContain('<span>Débit</span><span>2,2\u00a0m³/s</span>');
    expect(body).toContain('pas une cote d’alerte');
  });
  it('mesure de plus d’une heure : gris, sans anneau', () => {
    const late = floodStationFeatures(FLOODS_FIXTURE(), Date.parse('2026-10-04T09:00:01Z'));
    expect(late.features.every((f) => props(f)['color'] === ENV_NEUTRAL_HEX && props(f)['ringWidth'] === 0)).toBe(true);
  });
});

describe('feux : détections de France par foyer, étranger en gris clair', () => {
  const det = fireDetectionFeatures(FIRES_FIXTURE(), NOW);
  const ofDept = (dept: string): Array<Record<string, unknown>> =>
    det.features.filter((f) => FIRES_FIXTURE().detections.find((d) => d.id === props(f)['id'])?.dept === dept).map(props);
  it('foyers confirmés de moins de 10 MW (Ille-et-Vilaine, Alpes-Maritimes, Marne) jaunes sans halo, comme les isolés (arbitrage 14) ; Dunkerque et Fos-sur-Mer en gris récurrent', () => {
    expect(ofDept('35').map((p) => [p['color'], p['glow']])).toEqual(Array(3).fill([levelHex('jaune'), false]));
    expect(ofDept('89').map((p) => [p['color'], p['glow']])).toEqual([[levelHex('jaune'), false]]);
    expect(ofDept('59').map((p) => [p['color'], p['glow']])).toEqual(Array(3).fill([FIRE_RECURRENT_HEX, false]));
    expect(ofDept('13').every((p) => p['color'] === FIRE_RECURRENT_HEX)).toBe(true);
  });
  it('infobulle : satellite exact et capteur, confiance publiée, FRP, heure de Paris et âge ; jamais « VIIRS SNPP » codé', () => {
    const body = String(ofDept('35').find((p) => String(p['id']).includes('NOAA-20'))?.['body']);
    expect(body).toContain('<b>Foyer confirmé de moins de 10 MW</b><div class="hm-sub">Ille-et-Vilaine (35)</div>');
    expect(body).toContain('<span>Satellite</span><span>NOAA-20 (VIIRS)</span>');
    expect(body).toContain('<span>Confiance</span><span>nominale (n)</span>');
    expect(body).toContain('<span>Puissance (FRP)</span><span>0,8 MW</span>');
    expect(body).toContain('<span>Acquisition</span><span>05:19 (il y a 4 h 51)</span>');
    expect(body).toContain('NASA FIRMS, NOAA-20 (VIIRS).');
    expect(det.features.map((f) => String(props(f)['body'])).join(' ')).not.toMatch(/VIIRS SNPP|\u2014/);
    expect(String(ofDept('59')[0]['body'])).toContain('probablement industrielle, jamais un feu de forêt');
  });
  it('ligne Foyer : nombres collés à leur mot et à leur unité (R1)', () => {
    const body = String(ofDept('35')[0]['body']);
    const row = /<span>Foyer<\/span><span>([^<]*)<\/span>/.exec(body)?.[1] ?? '';
    expect(row).toMatch(/\d\u00a0détections, \d+\u00a0passages, .*\u00a0MW/);
    expect(row).not.toMatch(/\d [a-zé]/i);
  });
  it('ligne Foyer : singulier pour une détection et un passage (« 1 détection, 1 passage »)', () => {
    const f = FIRES_FIXTURE();
    const isolated = f.foyers.find((x) => x.detections === 1 && x.passes === 1 && !x.recurrent);
    if (!isolated) throw new Error('foyer d’une détection et d’un passage absent de la fixture');
    const body = String(ofDept(isolated.dept).find((p) => String(p['body']).includes('Foyer'))?.['body']);
    expect(/<span>Foyer<\/span><span>([^<]*)<\/span>/.exec(body)?.[1]).toMatch(/^1\u00a0détection, 1\u00a0passage, /);
  });
  it('confiance faible jamais en rouge : plafond orange dans un foyer majeur', () => {
    const f = FIRES_FIXTURE();
    const foyer = f.foyers.find((x) => x.dept === '55');
    if (!foyer) throw new Error('foyer de la Meuse absent de la fixture');
    Object.assign(foyer, { confirmed: true, passes: 2, frpTotalMw: 150, confidenceMax: 'haute' });
    const meuse = fireDetectionFeatures(f, NOW).features.find((x) => props(x)['foyerId'] === foyer.id);
    expect(props(meuse)['color']).toBe(levelHex('orange'));
  });
  it('dernière acquisition de plus de 14 h : gris neutre, sans halo, dit', () => {
    const late = fireDetectionFeatures(FIRES_FIXTURE(), Date.parse('2026-10-04T17:35:00Z'));
    expect(late.features.every((f) => props(f)['color'] === ENV_NEUTRAL_HEX && props(f)['glow'] === false)).toBe(true);
    expect(String(props(late.features[0])['body'])).toContain('Dernière acquisition de plus de 14 h : couleur retirée.');
  });
  it('hors de France : Belgique (Gand) et Italie (plaine du Pô) en gris clair, avec satellite et heure datée', () => {
    const abroad = fireAbroadFeatures(FIRES_FIXTURE());
    expect(abroad.features).toHaveLength(8);
    expect(abroad.features.every((f) => props(f)['color'] === FIRE_ABROAD_HEX)).toBe(true);
    const gand = abroad.features.find((f) => f.geometry.coordinates[0] === 3.81388);
    expect(String(props(gand)['body'])).toContain('<span>Acquisition</span><span>04/10\u00a003:39</span>');
    expect(abroad.features.some((f) => f.geometry.coordinates[1] === 45.14902)).toBe(true);
  });
  it('météo des forêts du 03/10 (J1 = 04/10) : 10 départements jaunes, les autres verts ; en retard : gris ; échue : rien', () => {
    const fd = forestDangerFeatures(GEO, FIRES_FIXTURE(), NOW);
    expect(fd.features).toHaveLength(96);
    expect(fd.features.filter((f) => props(f)['color'] === levelHex('jaune')).map((f) => props(f)['code']).sort())
      .toEqual(['04', '06', '13', '2A', '2B', '31', '44', '51', '83', '84']);
    expect(byCode(fd, '01')['color']).toBe(levelHex('vert'));
    expect(String(byCode(fd, '13')['body'])).toContain('Météo des forêts, aujourd’hui');
    expect(byCode(forestDangerFeatures(GEO, FIRES_FIXTURE(), Date.parse('2026-10-04T20:51:00Z')), '13')['color']).toBe(ENV_NEUTRAL_HEX);
    expect(forestDangerFeatures(GEO, FIRES_FIXTURE(), Date.parse('2026-10-05T10:00:00+02:00')).features).toEqual([]);
  });
});

describe('sources, couches, survol', () => {
  it('sources et couches nouvelles, masquées au départ ; météo des forêts et étranger sous les feux de France', () => {
    expect(ENV_LAYERS.map((l) => l.id)).toEqual([LYR_FOREST_DANGER_FILL, LYR_FOREST_DANGER_LINE, LYR_FIRES_ABROAD, LYR_FLOOD_STATIONS, LYR_WEATHER_ICONS, LYR_RADAR_PICK]);
    expect(ENV_LAYERS.every((l) => (l.layout as { visibility?: string } | undefined)?.visibility === 'none')).toBe(true);
    expect(ENV_SOURCE_IDS).toHaveLength(4);
    expect(ENV_LAYER_BEFORE[LYR_FOREST_DANGER_FILL]).toBe(LYR_FIRES_GLOW);
    // Un pictogramme de vigilance ne cache jamais un point de feu : il est inséré sous les feux de France.
    expect(ENV_LAYER_BEFORE[LYR_WEATHER_ICONS]).toBe(LYR_FIRES_GLOW);
  });
  it('couches par clé ; crues avec leur seule clé (plus de repli sur la vigilance)', () => {
    expect(ENV_LAYER_KEYS.floods).toEqual([LYR_FLOODS, LYR_FLOOD_STATIONS]);
    expect(ENV_LAYER_KEYS.weatherRadar).toEqual([LYR_RADAR_PICK]);
    expect(envLayerOn({ environmental: true }, 'floods')).toBe(false);
    expect(envLayerOn({ environmental: false, floods: true }, 'floods')).toBe(true);
    expect(envLayerOn({ fires: true }, 'weatherRadar')).toBe(false);
  });
  it('survol : couche du dessus d’abord (points, tracés, surfaces) ; infobulle préparée ; rien sans corps', () => {
    expect(ENV_HOVER_LAYERS[0]).toBe(LYR_FIRES_POINTS);
    expect(ENV_HOVER_LAYERS.at(-1)).toBe(LYR_WEATHER_FILL);
    const hit = topEnvHit([{ layer: { id: LYR_WEATHER_FILL } }, { layer: { id: LYR_FLOODS } }]);
    expect(hit?.layer.id).toBe(LYR_FLOODS);
    expect(envTooltipHtml(LYR_FLOODS, { body: '<b>Têt</b>' })).toBe('<div class="hm-tip"><b>Têt</b></div>');
    expect(envTooltipHtml(LYR_WEATHER_FILL, { body: '' })).toBeNull();
    expect(envTooltipHtml(LYR_RADAR_PICK, { body: 'x' })).toBeNull();
  });
  it('point du profil radar', () => {
    expect(radarPickFeature(43.6, 3.9).features[0].geometry.coordinates).toEqual([3.9, 43.6]);
  });
});

describe('pictogrammes : champ de distance', () => {
  it('un disque plein devient un dégradé : 192 au bord, plus fort dedans, nul loin dehors, sans palier 0 ou 255 collé au bord', () => {
    const size = ENV_ICON_SIZE;
    const rgba = new Uint8ClampedArray(size * size * 4);
    const c = size / 2;
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) rgba[(y * size + x) * 4 + 3] = Math.hypot(x + 0.5 - c, y + 0.5 - c) <= ENV_ICON_GLYPH / 4 ? 255 : 0;
    const sdf = alphaToSdf(rgba, size);
    const at = (x: number, y: number): number => sdf[y * size + x] ?? -1;
    const r = ENV_ICON_GLYPH / 4;
    expect(at(c, c)).toBe(255);
    expect(at(0, 0)).toBe(0);
    expect(Math.abs(at(Math.round(c + r - 1), c) - 192)).toBeLessThan(40);
    // dégradé progressif : au moins 4 valeurs intermédiaires sur les 8 pixels qui suivent le bord
    const ramp = new Set(Array.from({ length: 8 }, (_, i) => at(Math.round(c + r) + i, c)));
    expect(ramp.size).toBeGreaterThanOrEqual(4);
    expect(at(Math.round(c + r) + 1, c)).toBeGreaterThan(at(Math.round(c + r) + 6, c));
  });
});
