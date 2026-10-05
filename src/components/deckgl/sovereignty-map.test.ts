// src/components/deckgl/sovereignty-map.test.ts
// Couches Souveraineté de la carte (spec 2026-10-04 souveraineté § 2 ; contrats § 5) sur la collecte réelle du 04/10 : aéronefs au-dessus
// de la France par famille, hors de France en gris, urgences cerclées par niveau, Marine nationale vue en AIS et ports d'attache de
// référence, sites de la liste interne, câbles OpenStreetMap, navires lents signalés ; rien pour la Vigilance cyber (V5).
import { describe, expect, it } from 'vitest';
import type { CableAlert, CablesWatchResponse, DefenseOsmWorksFile, MilitaryResponse, ShownMilitaryEmergency } from '../../types/index.ts';
import { ACTIVE_INSTALLATIONS } from '../../config/military-bases-db.ts';
import type { MilitaryShip } from '../../services/military-ships.ts';
import { levelHex } from '../../services/vigilance.ts';
import {
  CABLES_FILE_FIXTURE, CABLES_WATCH_ALERTS_FIXTURE, CABLES_WATCH_FROZEN_FIXTURE, CABLES_WATCH_ZONE_MUTED_FIXTURE, MILITARY_FIXTURE,
  MILITARY_MASKED_EMERGENCY_FIXTURE, SOV_FIXTURE_NOW,
} from '../layer-panel/sovereignty.fixture.ts';
import { buildConnectiviteView } from '../layer-panel/connectivite.ts';
import { NBSP } from '../layer-panel/format.ts';
import { formatFeet } from '../layer-panel/sovereignty-format.ts';
import { BASE_TYPE_HEX, CABLE_HEX, MIL_AUTRES_HEX, NAVY_HEX, SOV_ABROAD_HEX } from '../layer-panel/sovereignty-legend.ts';
import {
  LYR_MILITARY_BASES_CIRCLE, LYR_MILITARY_BASES_LABEL, LYR_SOV_AIRCRAFT, LYR_SOV_AIRCRAFT_ABROAD, LYR_SOV_DRONES_FILL, LYR_SOV_DRONES_LINE,
  LYR_SOV_GNSS_FILL, LYR_SOV_GNSS_LINE, LYR_SOV_AIRCRAFT_LABEL, LYR_SOV_CABLE_VESSELS, LYR_SOV_EMERGENCIES, LYR_SOV_NAVY_OBSERVED, LYR_SOV_NAVY_REFERENCE, LYR_SOV_OSM_WORKS,
  LYR_SUBMARINE_CABLES, LYR_SUBMARINE_CABLES_CORE, LYR_SUBMARINE_CABLES_GLOW, LYR_SUBMARINE_CABLES_HITAREA, LYR_SUBMARINE_CABLES_LANDING,
} from './constants.ts';
import {
  SOV_HOVER_LAYERS, SOV_LAYERS, SOV_LAYER_KEYS, SOV_OPTION_LAYERS, SOV_SOURCE_IDS, abroadAircraftFeatures, aircraftFeatures, cableAlertFeatures,
  cableFeatures, defenseSiteFeatures, landingFeatures, militaryEmergencyFeatures, navyFeatures, osmWorksFeatures, sovCableColor, sovTooltipHtml,
  topSovHit,
} from './sovereignty-map.ts';

const NOW = SOV_FIXTURE_NOW;
const MIN = 60_000;
const props = (f: GeoJSON.Feature | undefined): Record<string, unknown> => (f?.properties ?? {}) as Record<string, unknown>;
const byId = (fc: GeoJSON.FeatureCollection, id: string): Record<string, unknown> => props(fc.features.find((f) => props(f)['id'] === id));
const military = (edit: (m: MilitaryResponse) => void): MilitaryResponse => {
  const m = MILITARY_FIXTURE();
  edit(m);
  return m;
};
const ship = (over: Partial<MilitaryShip> & Pick<MilitaryShip, 'id' | 'name'>): MilitaryShip => ({
  type: 'FREMM', role: 'Frégate multi-missions', lat: 43.12, lon: 5.92, isLive: false, port: 'Toulon', speed: 0, ...over,
});
const E7700: ShownMilitaryEmergency = {
  icao24: 'ae0805', callsign: 'RCH161', squawk: '7700', lat: 48.39, lon: -4.49, altitudeM: 7620, firstSeen: '2026-10-04T14:44:00Z',
  lastSeen: '2026-10-04T14:48:24Z', overFrance: true, type: 'C17', country: 'États-Unis', family: 'autres', emergency: 'general', inFrance: true, dept: '29', masked: false,
};
const E7500: ShownMilitaryEmergency = {
  icao24: '4b1814', callsign: 'ESSAI75', squawk: '7500', lat: 46.204, lon: 6.143, altitudeM: 9140, firstSeen: '2026-10-04T14:48:24Z',
  lastSeen: '2026-10-04T14:48:24Z', overFrance: true, type: 'A400', country: 'Suisse', family: 'autres', emergency: 'unlawful', inFrance: false, dept: null, masked: false,
};
const FAR: ShownMilitaryEmergency = { ...E7700, icao24: 'ae1436', callsign: 'FAZE37', lat: 51.37, lon: -0.57, overFrance: false, inFrance: false, dept: null };

describe('aéronefs militaires : autres pays au-dessus de la France, hors de France en gris, jamais un appareil français (O10)', () => {
  it('5 aéronefs d’autres pays du 04/10 en rose, aucun point pour les 4 français ; position au relevé [lng, lat] ; infobulle datée, sans immatriculation', () => {
    const fc = aircraftFeatures(MILITARY_FIXTURE(), NOW);
    expect(fc.features).toHaveLength(5);
    expect(fc.features.every((f) => props(f)['color'] === MIL_AUTRES_HEX)).toBe(true);
    const rrr = fc.features.find((f) => props(f)['id'] === '43c700');
    expect(rrr?.geometry.coordinates).toEqual([3.590057, 45.947059]);
    expect(props(rrr)['label']).toBe('RRR2301 16:48');
    const body = String(props(rrr)['body']);
    expect(body).toContain('<b>RRR2301 · A332</b>');
    expect(body).toContain('<span>Pays</span><span>Royaume-Uni</span>');
    expect(body).toContain('<span>Département</span><span>Puy-de-Dôme (63)</span>');
    expect(body).toContain(`<span>Altitude</span><span>${formatFeet(39000)}</span>`);
    expect(body).toContain('<span>Vu à</span><span>16:48</span>');
    expect(body).toContain('Un appareil absent du flux n’est pas absent du ciel.');
    expect(body).not.toMatch(/Immatriculation|français/);
    expect(body).toContain(`${NBSP}ft`);
  });
  it('adresse non OACI : jamais un point, même si une réponse en laissait passer une', () => {
    const m = military((r) => { r.others = [{ ...r.others[0], hex: '~ab12cd' }, r.others[1]]; r.abroad = [{ ...r.abroad[0], hex: '~ab12ce' }]; });
    expect(aircraftFeatures(m, NOW).features.map((f) => props(f)['id'])).toEqual(['c2b5b7']);
    expect(abroadAircraftFeatures(m).features).toHaveLength(0);
  });
  it('défense en profondeur (O10) : un appareil français (pays ou bloc OACI) ou PIA/LADD n’a jamais de point, dans others comme dans abroad', () => {
    const base = MILITARY_FIXTURE();
    const french = { ...base.others[0], hex: '3bf004', country: 'France' };
    const frenchBlock = { ...base.others[1], country: null, hex: '39abcd' };
    const pia = { ...base.others[2], dbFlags: 4 };
    const ladd = { ...base.others[3], dbFlags: '8' };
    const ok = base.others[4];
    const m = military((r) => { r.others = [french, frenchBlock, pia, ladd, ok]; r.abroad = [{ ...r.abroad[0], country: 'France' }, { ...r.abroad[1], hex: '3a0001' }, r.abroad[2]]; });
    expect(aircraftFeatures(m, NOW).features.map((f) => props(f)['id'])).toEqual([ok.hex]);
    expect(abroadAircraftFeatures(m).features.map((f) => props(f)['id'])).toEqual([base.abroad[2].hex]);
  });
  it('relevé en retard (12 min) : gris, dit ; jamais lu : rien dessiné', () => {
    const late = aircraftFeatures(MILITARY_FIXTURE(), NOW + 12 * MIN);
    expect(late.features.every((f) => props(f)['color'] === SOV_ABROAD_HEX)).toBe(true);
    expect(String(props(late.features[0])['body'])).toContain('Relevé en retard : couleur retirée.');
    expect(aircraftFeatures(null, NOW).features).toHaveLength(0);
    expect(aircraftFeatures(military((m) => { m.readAt = null; }), NOW).features).toHaveLength(0);
  });
  it('hors de France : 3 aéronefs en gris clair, jamais comptés', () => {
    const fc = abroadAircraftFeatures(MILITARY_FIXTURE());
    expect(fc.features).toHaveLength(3);
    expect(fc.features.every((f) => props(f)['color'] === SOV_ABROAD_HEX)).toBe(true);
    expect(String(props(fc.features[0])['body'])).toContain('Hors de France, jamais compté');
  });
  it('urgence masquée (appareil d’État français, PIA, LADD) : aucun point, seul le panneau la compte', () => {
    const masked = MILITARY_MASKED_EMERGENCY_FIXTURE();
    expect(masked.emergencies).toHaveLength(2);
    expect(militaryEmergencyFeatures(masked, NOW).features).toHaveLength(0);
    const mixed = military((m) => { m.emergencies = [...MILITARY_MASKED_EMERGENCY_FIXTURE().emergencies, E7700]; });
    expect(militaryEmergencyFeatures(mixed, NOW).features.map((f) => props(f)['id'])).toEqual(['ae0805:7700']);
  });
  it('urgences : 7700 confirmé orange, 7500 vu une fois aux approches jaune, hors des approches gris ; relevé en retard gris', () => {
    const fc = militaryEmergencyFeatures(military((m) => { m.emergencies = [E7700, E7500, FAR]; }), NOW);
    expect(byId(fc, 'ae0805:7700')['color']).toBe(levelHex('orange'));
    expect(byId(fc, '4b1814:7500')['color']).toBe(levelHex('jaune'));
    expect(byId(fc, 'ae1436:7700')['color']).toBe(SOV_ABROAD_HEX);
    expect(String(byId(fc, 'ae0805:7700')['body'])).toContain('Urgence confirmée (deux lectures)');
    expect(String(byId(fc, '4b1814:7500')['body'])).toContain('Vue une fois, à confirmer');
    expect(String(byId(fc, '4b1814:7500')['body'])).toContain('7500 (intervention illicite)');
    expect(String(byId(fc, '4b1814:7500')['body'])).toContain('Code affiché par le transpondeur, non confirmé par les autorités.');
    const late = militaryEmergencyFeatures(military((m) => { m.emergencies = [E7700]; }), NOW + 12 * MIN);
    expect(props(late.features[0])['color']).toBe(SOV_ABROAD_HEX);
  });
});

describe('Marine nationale : vus en AIS datés, port base de référence (icône à part), aucun sous-marin (O11)', () => {
  const LIVE = ship({ id: 'd651', name: 'Provence', mmsi: '227802000', isLive: true, lastSeen: SOV_FIXTURE_NOW - MIN, speed: 14.2, lat: 42.9, lon: 6.1 });
  const HOME = ship({ id: 'd650', name: 'Aquitaine', mmsi: '227801000' });
  const SNLE = ship({ id: 's616', name: 'Le Triomphant', type: 'SNLE', role: 'Dissuasion nucléaire', port: 'Île Longue', lat: 48.3018, lon: -4.5172, isLive: true });
  const SNA = ship({ id: 's617', name: 'Suffren', type: 'SNA', role: 'Attaque', port: 'Toulon', isLive: false });
  it('observé : icône du navire, heure en étiquette ; référence : icône pointillée, « pas une observation » ; SNLE et SNA jamais dessinés', () => {
    const fc = navyFeatures([LIVE, HOME, SNLE, SNA], false, NOW);
    expect(fc.features).toHaveLength(2);
    expect([byId(fc, '227802000')['kind'], byId(fc, '227802000')['icon'], byId(fc, '227802000')['label']]).toEqual(['observed', 'mil-ship', '16:47']);
    expect([byId(fc, '227801000')['kind'], byId(fc, '227801000')['icon'], byId(fc, '227801000')['label']]).toEqual(['reference', 'mil-ship-ref', '']);
    expect(String(byId(fc, '227801000')['body'])).toContain('Port base : position de référence, pas une observation.');
    expect(String(byId(fc, '227801000')['body'])).not.toMatch(/stationn|attache/);
    expect(byId(fc, '227802000')['color']).toBe(NAVY_HEX);
  });
  it('heure AIS illisible : le point est écarté, sans exception', () => {
    const bad = ship({ id: 'd652', name: 'Illisible', mmsi: '227803000', isLive: true, lastSeen: Number.NaN });
    expect(() => navyFeatures([bad, LIVE], false, NOW)).not.toThrow();
    expect(navyFeatures([bad, LIVE], false, NOW).features.map((f) => props(f)['id'])).toEqual(['227802000']);
  });
  it('flux figé (T3) : bâtiment vu en AIS en gris, « non évalué »', () => {
    const fc = navyFeatures([LIVE], true, NOW);
    expect([byId(fc, '227802000')['icon'], byId(fc, '227802000')['color']]).toEqual(['mil-ship-stale', SOV_ABROAD_HEX]);
    expect(String(byId(fc, '227802000')['body'])).toContain('Flux AIS figé : position non évaluée.');
  });
});

describe('sites de défense, ouvrages OpenStreetMap', () => {
  it('112 sites de la liste interne, catégorie et nom ; l’Île Longue au point de la base', () => {
    const fc = defenseSiteFeatures(ACTIVE_INSTALLATIONS);
    expect(fc.features).toHaveLength(ACTIVE_INSTALLATIONS.length);
    const ile = fc.features.find((f) => props(f)['id'] === 'BN-ILE-LONGUE');
    expect(ile?.geometry.coordinates).toEqual([-4.5172, 48.3018]);
    expect([props(ile)['type'], props(ile)['name']]).toEqual(['navy', 'Île Longue (base navale)']);
    expect(String(props(ile)['body'])).toContain('Liste interne de sites publics, sans date par site.');
  });
  it('infobulle d’un site (O13) : nom et catégorie seulement, ni description ni unité', () => {
    for (const f of defenseSiteFeatures(ACTIVE_INSTALLATIONS).features) {
      const body = String(props(f)['body']);
      expect(body).toContain(`<b>${String(props(f)['name']).replace(/&/g, '&amp;')}</b>`.replace(/'/g, '&#39;'));
      expect(body.match(/<div class="hm-note">/g)).toHaveLength(1);
      expect(body).not.toContain('hm-row');
    }
    // La liste ne porte plus de description depuis la tâche A17 (O13) ; un champ en trop ne passe toujours pas dans l'infobulle.
    const base = { ...ACTIVE_INSTALLATIONS.filter((b) => b.id === 'BA-103')[0], description: 'Description non sourcée' };
    expect(base.id).toBe('BA-103');
    expect(String(props(defenseSiteFeatures([base]).features[0])['body'])).not.toContain('Description non sourcée');
  });
  it('ouvrages OpenStreetMap : couleur de catégorie, licence et date du fichier ; fichier absent : rien', () => {
    const file: DefenseOsmWorksFile = {
      generatedAt: '2026-10-04T13:05:00Z', osmBase: '2026-10-04T12:40:00Z', licence: 'ODbL 1.0', source: '© les contributeurs d’OpenStreetMap',
      items: [{ id: 'node/1', name: '<b>Batterie</b>', kind: 'bunker', type: 'fortification', lat: 48.6, lon: -4.6, dept: '29' }],
    };
    const fc = osmWorksFeatures(file);
    expect(props(fc.features[0])['color']).toBe(BASE_TYPE_HEX.fortification);
    const body = String(props(fc.features[0])['body']);
    expect(body).toContain('&lt;b&gt;Batterie&lt;/b&gt;');
    expect(body).toContain('© les contributeurs d’OpenStreetMap, ODbL 1.0 · fichier du 04/10/2026');
    expect(osmWorksFeatures(null).features).toHaveLength(0);
  });
});

describe('Connectivité : câbles du Shom et d’OpenStreetMap avec leur source, atterrages par commune, navires signalés', () => {
  const file = CABLES_FILE_FIXTURE();
  it('53 câbles en MultiLineString [lng, lat] : 19 du Shom (préfixe shom/), 34 d’OpenStreetMap ; atterrages par point', () => {
    const cables = cableFeatures(file);
    expect(cables.features).toHaveLength(53);
    expect(cables.features.filter((f) => String(f.id).startsWith('shom/'))).toHaveLength(19);
    expect(cables.features.filter((f) => String(f.id).startsWith('way/'))).toHaveLength(34);
    expect(cables.features.every((f) => f.geometry.type === 'MultiLineString')).toBe(true);
    expect(landingFeatures(file).features).toHaveLength(file.cables.reduce((n, c) => n + c.landings.length, 0));
    expect(cableFeatures(null).features).toHaveLength(0);
  });
  it('câble du Shom sans nom : « câble télécom · Shom (CC BY-SA, 2019) » ; complément OpenStreetMap : nom, ODbL et date du fichier', () => {
    const shom = file.cables.find((c) => c.source === 'Shom' && !c.outOfService && c.name === null);
    const osm = file.cables.find((c) => c.source === 'OpenStreetMap' && c.name !== null);
    expect(shom && osm).toBeTruthy();
    const shomBody = String(props(cableFeatures(file).features.find((f) => f.id === shom?.id))['body']);
    expect(shomBody).toContain('<b>câble télécom · Shom (CC BY-SA, 2019)</b>');
    expect(shomBody).not.toMatch(/OpenStreetMap|ODbL/);
    const osmBody = String(props(cableFeatures(file).features.find((f) => f.id === osm?.id))['body']);
    expect(osmBody).toContain(`<b>${osm?.name}</b>`);
    expect(osmBody).toContain('Tracé OpenStreetMap, précision non garantie.');
    expect(osmBody).toContain('ODbL 1.0, fichier du 04/10/2026');
  });
  it('câble du Shom hors service : gris, « hors service », jamais une alerte ; en service : bleu des câbles', () => {
    const off = file.cables.find((c) => c.outOfService);
    const on = file.cables.find((c) => !c.outOfService);
    expect(off && on).toBeTruthy();
    const fc = cableFeatures(file);
    const offProps = props(fc.features.find((f) => f.id === off?.id));
    expect([offProps['color'], offProps['outOfService']]).toEqual([SOV_ABROAD_HEX, true]);
    expect(String(offProps['body'])).toContain('<div class="hm-sub">hors service</div>');
    expect(props(fc.features.find((f) => f.id === on?.id))['color']).toBe(CABLE_HEX);
    expect(sovCableColor('#22c7ff')).toEqual(['case', ['==', ['get', 'outOfService'], true], SOV_ABROAD_HEX, '#22c7ff']);
  });
  it('Shom reconnu par le seul préfixe shom/ ; atterrage d’un câble hors service gris', () => {
    const odd = CABLES_FILE_FIXTURE();
    const target = odd.cables.find((c) => c.source === 'Shom' && c.name === null && !c.outOfService);
    expect(target).toBeDefined();
    if (target) target.source = 'OpenStreetMap';
    const body = String(props(cableFeatures(odd).features.find((f) => f.id === target?.id))['body']);
    expect(body).toContain('Shom (CC BY-SA, 2019)');
    const off = file.cables.find((c) => c.outOfService && c.landings.length > 0);
    const landings = landingFeatures(file).features.filter((f) => props(f)['cable'] === off?.id);
    if (off) {
      expect(landings.length).toBeGreaterThan(0);
      expect(landings.every((f) => props(f)['outOfService'] === true)).toBe(true);
    }
    expect(landingFeatures(file).features.some((f) => props(f)['outOfService'] === false)).toBe(true);
  });
  it('atterrage nommé par commune ; tronçon au large sans atterrage dit « tronçon au large »', () => {
    const landing = landingFeatures(file).features[0];
    expect(String(props(landing)['body'])).toContain('<b>Marseille (13)</b>');
    const offshore = file.cables.find((c) => c.landings.length === 0);
    expect(offshore).toBeDefined();
    expect(String(props(cableFeatures(file).features.find((f) => f.id === offshore?.id))['body'])).toContain('tronçon au large');
  });
  it('navires lents : confirmé orange, vu une fois jaune ; AIS muet ou zone muette : gris, non évalué ; « à vérifier », jamais une menace', () => {
    const fc = cableAlertFeatures(CABLES_WATCH_ALERTS_FIXTURE(), NOW);
    expect(fc.features.map((f) => props(f)['color']).sort()).toEqual([levelHex('jaune'), levelHex('orange')].sort());
    expect(String(props(fc.features[0])['body'])).toContain('« À vérifier », jamais une menace. Seule la préfecture maritime qualifie une infraction.');
    const frozen = cableAlertFeatures(CABLES_WATCH_FROZEN_FIXTURE(), NOW);
    expect(frozen.features.length).toBeGreaterThan(0);
    expect(frozen.features.every((f) => props(f)['color'] === SOV_ABROAD_HEX)).toBe(true);
    expect(String(props(frozen.features[0])['body'])).toContain('Veille non évaluée (AIS muet ou flux de la zone muet) : alerte gardée, ni confirmée ni retirée.');
    const muted = cableAlertFeatures(CABLES_WATCH_ZONE_MUTED_FIXTURE(), NOW);
    expect(muted.features.every((f) => props(f)['color'] === SOV_ABROAD_HEX)).toBe(true);
  });
  it('un point par navire (FX2) : ses câbles listés en infobulle, couleur la plus haute, identifiant = cible du clic de sa ligne au panneau', () => {
    const w = CABLES_WATCH_ALERTS_FIXTURE();
    const base = w.alerts.find((a) => a.confirmed);
    if (!base) throw new Error('jeu d’essai sans alerte confirmée');
    // Relevé du 05/10 : un même navire à 112 et 113 m de deux câbles du Shom sans nom, vu une fois sur un câble nommé à 420 m.
    const shomA: CableAlert = { ...base, id: `${base.mmsi}:shom/FR000008471300001`, cableId: 'shom/FR000008471300001', cableName: null, distanceM: 113, lat: 47.1, lon: -4.1 };
    const shomB: CableAlert = { ...shomA, id: `${base.mmsi}:shom/FR000008471400001`, cableId: 'shom/FR000008471400001', distanceM: 112, lat: 47.2, lon: -4.2 };
    const named: CableAlert = { ...shomA, id: `${base.mmsi}:way/761201702`, cableId: 'way/761201702', cableName: 'BARMAR', distanceM: 420, confirmed: false };
    const twins: CablesWatchResponse = { ...w, alerts: [shomA, named, shomB] };
    const fc = cableAlertFeatures(twins, NOW);
    expect(fc.features).toHaveLength(1);
    const [f] = fc.features;
    expect(props(f)['id']).toBe(shomB.id);
    expect(f?.geometry.coordinates).toEqual([shomB.lon, shomB.lat]);
    expect(props(f)['color']).toBe(levelHex('orange'));
    const body = String(props(f)['body']);
    expect(body).toContain(`2${NBSP}câbles télécom du Shom, sans nom, BARMAR`);
    expect(body).toContain('Distance au tracé le plus proche');
    expect(body).toContain('Navire lent confirmé sur deux relevés');
    // Même identifiant que la ligne du navire au panneau Connectivité (clic : la même position).
    const view = buildConnectiviteView({ watch: twins, watchError: null, file: CABLES_FILE_FIXTURE(), fileError: null, canFocus: true, now: NOW, open: () => true });
    const rows = view.sections.find((s) => s.id === 'navires')?.html ?? '';
    expect([...rows.matchAll(/data-vessel="([^"]+)"/g)].map((m) => m[1])).toEqual([shomB.id]);
    // Un seul câble : infobulle au singulier, inchangée.
    const single = cableAlertFeatures({ ...w, alerts: [base] }, NOW);
    expect(String(props(single.features[0])['body'])).toContain('Distance au tracé');
    expect(String(props(single.features[0])['body'])).not.toContain('le plus proche');
  });
});

describe('sources, couches, survol', () => {
  it('six sources neuves ; couches neuves masquées ; clés par couche ; option des ouvrages OSM ; aucune couche cyber', () => {
    expect(SOV_SOURCE_IDS).toHaveLength(6);
    expect(SOV_LAYERS.every((l) => (l.layout as { visibility?: string } | undefined)?.visibility === 'none')).toBe(true);
    expect(SOV_LAYER_KEYS.military).toEqual([
      LYR_SOV_AIRCRAFT_ABROAD, LYR_SOV_AIRCRAFT, LYR_SOV_AIRCRAFT_LABEL, LYR_SOV_EMERGENCIES, LYR_SOV_NAVY_REFERENCE, LYR_SOV_NAVY_OBSERVED,
      LYR_MILITARY_BASES_CIRCLE, LYR_MILITARY_BASES_LABEL, LYR_SOV_GNSS_FILL, LYR_SOV_GNSS_LINE,
    ]);
    expect(SOV_LAYER_KEYS.subseaCables).toEqual([
      LYR_SUBMARINE_CABLES_GLOW, LYR_SUBMARINE_CABLES, LYR_SUBMARINE_CABLES_CORE, LYR_SUBMARINE_CABLES_HITAREA, LYR_SUBMARINE_CABLES_LANDING,
      LYR_SOV_CABLE_VESSELS,
    ]);
    expect(SOV_OPTION_LAYERS).toEqual({ osmWorks: [LYR_SOV_OSM_WORKS], droneZones: [LYR_SOV_DRONES_FILL, LYR_SOV_DRONES_LINE] });
    expect(Object.keys(SOV_LAYER_KEYS)).toEqual(['military', 'subseaCables']);
  });
  it('couche du dessus d’abord ; infobulle préparée, échappée ; hors des couches survolables : rien', () => {
    expect(SOV_HOVER_LAYERS[0]).toBe(LYR_SOV_EMERGENCIES);
    const hit = topSovHit([{ layer: { id: LYR_SUBMARINE_CABLES_HITAREA } }, { layer: { id: LYR_SOV_AIRCRAFT } }]);
    expect(hit?.layer.id).toBe(LYR_SOV_AIRCRAFT);
    const hostile = aircraftFeatures(military((m) => { m.others = [{ ...m.others[0], callsign: '<img src=x onerror=alert(1)>' }]; }), NOW);
    const html = sovTooltipHtml(LYR_SOV_AIRCRAFT, props(hostile.features[0]));
    expect(html).toMatch(/^<div class="hm-tip">/);
    expect(html).not.toContain('<img');
    expect(sovTooltipHtml('autre-couche', { body: '<b>x</b>' })).toBeNull();
    expect(sovTooltipHtml(LYR_SOV_AIRCRAFT, {})).toBeNull();
  });
  it('aucun tiret cadratin, jamais « temps réel » ni « stationné » dans les infobulles', () => {
    const bodies = [
      ...aircraftFeatures(MILITARY_FIXTURE(), NOW).features, ...abroadAircraftFeatures(MILITARY_FIXTURE()).features,
      ...cableFeatures(CABLES_FILE_FIXTURE()).features, ...landingFeatures(CABLES_FILE_FIXTURE()).features, ...cableAlertFeatures(CABLES_WATCH_ALERTS_FIXTURE(), NOW).features,
      ...defenseSiteFeatures(ACTIVE_INSTALLATIONS).features,
    ].map((f) => String(props(f)['body']));
    for (const b of bodies) expect(b).not.toMatch(/\u2014|temps réel|stationn/i);
  });
});
