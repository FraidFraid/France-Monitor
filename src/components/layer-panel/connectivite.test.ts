// src/components/layer-panel/connectivite.test.ts
// Vue Connectivité (spec 2026-10-04 souveraineté § 2.2 ; contrats § 4.1 ; amendement 7, O18, S9) : tracés du Shom et d'OpenStreetMap datés, atterrages en France, navires
// lents près d'un câble « à vérifier », jamais une menace ; flux AIS muet : non évalué (T3).
import { describe, expect, it } from 'vitest';
import type { CableAlert, CablesWatchResponse, SubseaCablesFile } from '../../types/index.ts';
import { cablesLevel } from '../../services/sovereignty-levels.ts';
import {
  CABLES_FILE_FIXTURE, CABLES_WATCH_ALERTS_FIXTURE, CABLES_WATCH_FIXTURE, CABLES_WATCH_FROZEN_FIXTURE, CABLES_WATCH_ZONE_MUTED_FIXTURE, SOV_FIXTURE_NOW,
} from './sovereignty.fixture.ts';
import { NBSP, breakableValue, visibleText } from './format.ts';
import { renderLayerView, type LayerView } from './frame.ts';
import { trafficBreakable } from './traffic-format.ts';
import { CABLES_FILE_ERROR_TEXT, clockOf, glueSovUnits, sovBreakable } from './sovereignty-format.ts';
import { CONNECTIVITE_SOURCES, CONNECTIVITE_TITLE, buildConnectiviteView, landingPlace, type ConnectiviteViewInput } from './connectivite.ts';

const NOW = SOV_FIXTURE_NOW;
const MIN = 60_000;
const open = (_: string, d: boolean): boolean => d;
const input = (over: Partial<ConnectiviteViewInput> = {}): ConnectiviteViewInput => ({
  watch: CABLES_WATCH_FIXTURE(), watchError: null, file: CABLES_FILE_FIXTURE(), fileError: null, canFocus: true, now: NOW, open, ...over,
});
const view = (over: Partial<ConnectiviteViewInput> = {}) => buildConnectiviteView(input(over));
const html = (over: Partial<ConnectiviteViewInput> = {}): string => renderLayerView('subseaCables', view(over));
/** Gros chiffre de la phase A : la phase B (B26) le déplace dans la section « Navires » (ou « Câbles ») ; valeur, légende et couleur de la ligne. */
function slow(v: LayerView): { value: string; caption: string; level: string | null } {
  const h = (v.sections.find((s) => s.id === 'navires') ?? v.sections.find((s) => s.id === 'cables'))?.html ?? '';
  const m = /Navires lents sur un tracé<\/span><span class="fmk-kv-v fmk-num"><span class="lp-val fmk-num( lp-lvl lp-lvl--(\w+))?">([^<]*)<\/span><\/span><\/div><p class="fmk-note">([^<]*)<\/p>/.exec(h);
  return { value: m?.[3] ?? '', caption: visibleText(m?.[4] ?? ''), level: m?.[2] ?? null };
}
const sectionOf = (id: string, over: Partial<ConnectiviteViewInput> = {}) => view(over).sections.find((s) => s.id === id);

const OSM = { source: 'OpenStreetMap', licence: 'ODbL 1.0', outOfService: false } as const;
const SHOM = { source: 'Shom', licence: 'CC BY-SA', name: null, operator: null } as const;
/** Six câbles construits : trois OSM (deux à Marseille, dont un qui y atterrit deux fois ; un breton sans commune nommée) et trois du Shom (un sans nom qui atterrit à Marseille, un tronçon au large, un hors service). */
const SMALL: SubseaCablesFile = {
  generatedAt: '2026-10-04T13:02:00Z', osmBase: '2026-10-04T12:47:16Z',
  sources: [
    { source: 'Shom', dataset: 'Conduites et câbles sous-marins répertoriés par le Shom', layer: 'CABLES_BDD_WFS:cblsub_lv', licence: 'CC BY-SA', attribution: 'Shom', edition: '2019-01-07', url: 'https://www.data.gouv.fr/datasets/conduites-et-cables-sous-marins-repertories-par-le-shom/', count: 3 },
    { source: 'OpenStreetMap', dataset: 'OpenStreetMap', layer: 'Overpass', licence: 'ODbL 1.0', attribution: '© les contributeurs d’OpenStreetMap', edition: '2026-10-04T12:47:16Z', url: 'https://www.openstreetmap.org/copyright', count: 3 },
  ],
  cables: [
    { id: 'shom/FR000000000000001', ...SHOM, path: [[[5.4, 43.2], [6.0, 42.0]]], landings: [{ commune: 'Marseille', dept: '13', lat: 43.2, lon: 5.4 }], outOfService: false },
    { id: 'shom/FR000000000000002', ...SHOM, path: [[[6.0, 41.0], [7.0, 41.5]]], landings: [], outOfService: false },
    { id: 'shom/FR000000000000003', ...SHOM, path: [[[5.0, 43.0], [5.1, 42.5]]], landings: [{ commune: 'Marseille', dept: '13', lat: 43.0, lon: 5.0 }], outOfService: true },
    { id: 'way/761201753', name: 'IMEWE Seg3.4', operator: null, path: [[[5.37, 43.29], [6.5, 41.0]]], landings: [{ commune: 'Marseille', dept: '13', lat: 43.29, lon: 5.37 }], ...OSM },
    { id: 'way/761201702', name: 'BARMAR', operator: null, path: [[[5.36, 43.3], [5.35, 43.28]]],
      landings: [{ commune: 'Marseille', dept: '13', lat: 43.3, lon: 5.36 }, { commune: 'Marseille', dept: '13', lat: 43.28, lon: 5.35 }], ...OSM },
    { id: 'way/761201752', name: null, operator: 'Orange Marine', path: [[[-4.33, 47.81], [-9, 45]]], landings: [{ commune: '', dept: '29', lat: 47.81, lon: -4.33 }], ...OSM },
  ],
  cableZones: [], anchorageZones: [],
};
/** Navire lent à 312 m d'un tracé, confirmé sur deux relevés espacés de plus de 5 min. */
const ALERT: CableAlert = {
  id: '227123456:way/761201753', mmsi: '227123456', name: 'ESSAI MARINE', vesselType: 'Cargo', cableId: 'way/761201753', cableName: 'IMEWE Seg3.4',
  lat: 43.25, lon: 5.3, distanceM: 312, speedKn: 0.4, navStatus: 1, firstSeen: '2026-10-04T14:31:00Z', lastSeen: '2026-10-04T14:47:00Z', confirmed: true, zoneMuted: false,
};
const WATCH: CablesWatchResponse = {
  readAt: '2026-10-04T14:47:40Z', aisLastMessageAt: '2026-10-04T14:47:31Z', evaluated: true,
  cablesFile: { generatedAt: '2026-10-04T13:02:00Z', osmBase: '2026-10-04T12:47:16Z', cables: 6, landings: 5 }, slowVessels: 41, alerts: [], errors: [],
};

describe('vue Connectivité (spec 2026-10-04 souveraineté § 2.2)', () => {
  it('en-tête du 04/10 : aucun navire lent sur un tracé, pastille verte, AIS daté ; câbles du Shom et d’OpenStreetMap dits', () => {
    const w = CABLES_WATCH_FIXTURE();
    const v = view();
    expect(cablesLevel(w, NOW).level).toBe('vert');
    expect(v.head).toMatchObject({ theme: 'Souveraineté', title: CONNECTIVITE_TITLE, level: 'vert' });
    expect(slow(v)).toEqual({ value: '0', caption: `navire lent à moins de 500${NBSP}m d’un câble · AIS à jour ${clockOf(w.aisLastMessageAt, NOW)}`, level: 'vert' });
    expect(v.head.status[0]).toBe(glueSovUnits(cablesLevel(w, NOW).reason));
    expect(v.head.status[1]).toMatch(/^AIS\u00A0\d\d:\d\d · câbles du \d\d\/\d\d$/);
    const file = CABLES_FILE_FIXTURE();
    const landings = file.cables.reduce((n, c) => n + c.landings.length, 0);
    expect(v.head.lead).toBe(`${file.cables.length}${NBSP}câbles télécom sous-marins dans les eaux françaises, ${landings}${NBSP}atterrages en France, d’après le Shom et OpenStreetMap.`);
  });
  it('sections et ouverture : câbles ouverts, navires repliés sans alerte, méthode en ton de référence', () => {
    expect(view().sections.map((s) => [s.id, s.open ?? false])).toEqual([['reseaux', true], ['cables', true], ['navires', false], ['echanges', false], ['methode', false]]);
    expect(view().sections.at(-1)?.tone).toBe('reference');
  });
  it('câbles et atterrages du fichier (Shom et OpenStreetMap) : tous les câbles listés, liste repliée', () => {
    const file = CABLES_FILE_FIXTURE();
    const landings = file.cables.reduce((n, c) => n + c.landings.length, 0);
    const s = sectionOf('cables');
    expect(s?.summary).toBe(`${file.cables.length}${NBSP}câbles · ${landings}${NBSP}atterrages`);
    expect(s?.html.match(/data-cable="(?:way|shom)\/[^"]+"/g)).toHaveLength(file.cables.length);
    expect(s?.html).toContain(`<details class="lp-more"><summary>Liste des ${file.cables.length}${NBSP}câbles</summary>`);
  });
  it('lieux d’atterrage exacts (fichier construit) : commune, à défaut département ; triés par nombre de câbles ; câbles du Shom sans nom comptés', () => {
    expect(landingPlace({ commune: 'Marseille', dept: '13', lat: 43.29, lon: 5.37 })).toBe('Marseille (13)');
    expect(landingPlace({ commune: '', dept: '29', lat: 47.81, lon: -4.33 })).toBe('Finistère (29)');
    const h = sectionOf('cables', { file: SMALL })?.html ?? '';
    expect(h).toContain('<div class="lp-row is-link" tabindex="0" role="button" data-landing="shom/FR000000000000001:0">'
      + '<span class="lp-swatch" style="background:var(--cat-landing)" aria-hidden="true"></span><span>Marseille (13)</span>'
      + `<span class="lp-val fmk-num">4${NBSP}câbles</span><small>câble télécom (Shom), câble télécom (Shom) hors service, IMEWE Seg3.4, BARMAR</small></div>`);
    expect(h).toContain(`<span>Finistère (29)</span><span class="lp-val fmk-num">1${NBSP}câble</span><small>câble sans nom</small>`);
    expect(h.indexOf('Marseille (13)')).toBeLessThan(h.indexOf('Finistère (29)'));
    expect(h).toContain('data-cable="way/761201702" title="OpenStreetMap, ODbL 1.0"><span class="lp-swatch" style="background:var(--cat-cable)" aria-hidden="true"></span><span>BARMAR</span>'
      + `<span class="lp-val fmk-num">2${NBSP}atterrages</span><small>Marseille (13)</small></div>`);
    expect(sectionOf('cables', { file: SMALL, canFocus: false })?.html).not.toMatch(/data-landing|data-cable/);
  });
  it('câbles du Shom (O18) : « câble télécom (Shom) » avec ses atterrages, « tronçon au large » sans atterrage, hors service en gris ; source et licence par câble', () => {
    const h = sectionOf('cables', { file: SMALL })?.html ?? '';
    expect(h).toContain('data-cable="shom/FR000000000000001" title="Shom, CC BY-SA"><span class="lp-swatch" style="background:var(--cat-cable)" aria-hidden="true"></span><span>câble télécom (Shom)</span>'
      + `<span class="lp-val fmk-num">1${NBSP}atterrage</span><small>Marseille (13)</small></div>`);
    expect(h).toContain('data-cable="shom/FR000000000000002" title="Shom, CC BY-SA"><span class="lp-swatch" style="background:var(--cat-cable)" aria-hidden="true"></span><span>tronçon au large</span>'
      + '<span></span><small>câble télécom (Shom), sans atterrage en France</small></div>');
    expect(h).toContain('data-cable="shom/FR000000000000003" title="Shom, CC BY-SA"><span class="fmk-dot" aria-hidden="true"></span><span>câble télécom (Shom)</span>'
      + `<span class="lp-val fmk-num">1${NBSP}atterrage</span><small>hors service (Shom) · Marseille (13)</small></div>`);
    expect(h).not.toMatch(/fmk-dot--(?:orange|jaune|rouge)/);
    expect(h).toContain('câble sans nom');
    expect(visibleText(h)).toContain('Tracés du Shom (CC BY-SA, édition du 07/01/2019) et d’OpenStreetMap (ODbL 1.0, base OSM du 04/10 14:47), fichier du 04/10/2026 ; précision non garantie ; câbles électriques non retenus');
  });
  it('navire lent confirmé (construit) : « à vérifier », distance au tracé, vitesse, mouillage, première et dernière vue ; jamais « menace »', () => {
    const v = view({ watch: { ...WATCH, alerts: [ALERT] }, file: SMALL });
    expect(v.head.level).toBe('orange');
    expect(slow(v)).toMatchObject({ value: '1', caption: `navire lent à moins de 500${NBSP}m d’un câble · AIS à jour 16:47` });
    const s = v.sections.find((x) => x.id === 'navires');
    expect([s?.open, s?.summary]).toEqual([true, '1 à vérifier']);
    expect(s?.html).toContain('<div class="lp-row is-link" tabindex="0" role="button" data-vessel="227123456:way/761201753">'
      + '<span class="fmk-dot fmk-dot--orange" aria-hidden="true"></span><span>ESSAI MARINE · Cargo</span>'
      + `<span class="lp-val fmk-num">312${NBSP}m</span><small>IMEWE Seg3.4 · 0,4${NBSP}nœud · au mouillage · confirmé sur deux relevés, vu de 16:31 à 16:47</small></div>`);
    expect(visibleText(s?.html ?? '')).toContain('« à vérifier », jamais une menace');
    expect(visibleText(html({ watch: { ...WATCH, alerts: [ALERT] } })).replace(/jamais une menace/g, '')).not.toMatch(/menace/i);
  });
  it('un navire près de deux câbles compte une fois dans le gros chiffre, la pastille et la section ; une ligne par navire, ses câbles listés (FX2)', () => {
    const twin: CableAlert = { ...ALERT, id: '227123456:shom/FR000000000000001', cableId: 'shom/FR000000000000001', cableName: null, distanceM: 113 };
    const other: CableAlert = { ...ALERT, id: '227654321:way/761201702', mmsi: '227654321', name: 'AUTRE ESSAI', cableId: 'way/761201702', cableName: 'BARMAR' };
    const w: CablesWatchResponse = { ...WATCH, alerts: [ALERT, twin, other] };
    const v = view({ watch: w, file: SMALL });
    expect(slow(v)).toMatchObject({ value: '2', caption: `navires lents à moins de 500${NBSP}m d’un câble · AIS à jour 16:47` });
    expect(v.head.status[0]).toBe(glueSovUnits(cablesLevel(w, NOW).reason));
    expect(v.head.status[0]).toContain(`2${NBSP}navires lents confirmés sur un câble`);
    const s = v.sections.find((x) => x.id === 'navires');
    const h = s?.html ?? '';
    expect(s?.summary).toBe('2 à vérifier');
    // Une ligne par navire : le clic recentre sur l'alerte du câble le plus proche (113 m).
    expect(h.match(/data-vessel="/g)).toHaveLength(2);
    expect(h).toContain(`data-vessel="${twin.id}"`);
    expect(h).toContain(`data-vessel="${other.id}"`);
    expect(h).not.toContain(`data-vessel="${ALERT.id}"`);
    const t = visibleText(h);
    expect(t).toContain(`ESSAI MARINE · Cargo113${NBSP}m`);
    expect(t).toContain('câble télécom (Shom), IMEWE Seg3.4 · ');            // câble le plus proche d’abord
  });
  it('relevé du 05/10 (KILREDENN 2 à 112 m de deux câbles du Shom sans nom) : une seule ligne « 2 câbles télécom (Shom) », jamais deux lignes jumelles', () => {
    const k1: CableAlert = { ...ALERT, id: '227000051:shom/FR000000000000001', mmsi: '227000051', name: 'DEUX CABLES ESSAI', cableId: 'shom/FR000000000000001', cableName: null, distanceM: 112, navStatus: null };
    const k2: CableAlert = { ...k1, id: '227000051:shom/FR000000000000002', cableId: 'shom/FR000000000000002' };
    const h = sectionOf('navires', { watch: { ...WATCH, alerts: [k1, k2] }, file: SMALL })?.html ?? '';
    expect(h.match(/data-vessel="/g)).toHaveLength(1);
    const t = visibleText(h);
    expect(t).toContain(`DEUX CABLES ESSAI · Cargo112${NBSP}m2${NBSP}câbles télécom (Shom) · `);
    expect(t.match(/DEUX CABLES ESSAI/g)).toHaveLength(1);
  });
  it('navire confirmé sur un câble et vu une fois sur un autre : orange (la plus haute) ; toutes ses alertes en zone muette : gris, « non évaluée »', () => {
    const once: CableAlert = { ...ALERT, id: '227123456:way/761201702', cableId: 'way/761201702', cableName: 'BARMAR', confirmed: false, distanceM: 90 };
    const mixed = sectionOf('navires', { watch: { ...WATCH, alerts: [ALERT, once] }, file: SMALL })?.html ?? '';
    expect(mixed).toContain('lp-lvl--orange');
    expect(mixed).not.toContain('lp-lvl--jaune');
    expect(visibleText(mixed)).toContain('confirmé sur deux relevés');
    const mutedAll = sectionOf('navires', { watch: { ...WATCH, alerts: [{ ...ALERT, zoneMuted: true }, { ...once, zoneMuted: true }] }, file: SMALL })?.html ?? '';
    expect(visibleText(mutedAll)).toContain('non évaluée (flux de la zone muet)');
    expect(mutedAll).not.toContain('lp-lvl--orange');
  });
  it('navire près d’un câble du Shom sans nom : « câble télécom (Shom) »', () => {
    const a: CableAlert = { ...ALERT, id: '227123456:shom/FR000000000000001', cableId: 'shom/FR000000000000001', cableName: null };
    const h = sectionOf('navires', { watch: { ...WATCH, alerts: [a] }, file: SMALL })?.html ?? '';
    expect(h).toContain('<small>câble télécom (Shom) · 0,4');
    expect(sectionOf('navires', { watch: { ...WATCH, alerts: [a] } })?.html).toContain('data-vessel="227123456:shom/FR000000000000001"');
  });
  it('jeu d’essai des alertes (A9) : une confirmée en orange, une vue une fois en jaune ; pastille orange', () => {
    const w = CABLES_WATCH_ALERTS_FIXTURE();
    const v = view({ watch: w });
    expect(v.head.level).toBe('orange');
    expect(slow(v).value).toBe(String(w.alerts.length));
    const h = v.sections.find((x) => x.id === 'navires')?.html ?? '';
    for (const a of w.alerts) expect(h).toContain(`data-vessel="${a.id}"`);
    expect(h).toContain('fmk-dot--orange');
    expect(h).toContain('fmk-dot--jaune');
    expect(visibleText(h)).toContain('vu une fois à ');
  });
  it('aucun navire lent : dit avec le dénominateur du relevé, sans calme inventé', () => {
    expect(visibleText(sectionOf('navires', { watch: WATCH, file: SMALL })?.html ?? ''))
      .toContain(`Aucun navire lent à moins de 500${NBSP}m d’un câble parmi 41${NBSP}navires de moins de 2${NBSP}nœuds du relevé AIS.`);
    expect(sectionOf('navires', { watch: WATCH })?.summary).toBe('aucun');
  });
  it('méthode et sources : Shom et OpenStreetMap (attribution groupée), requête OpenStreetMap, atterrages à 2 km, proximité confirmée, exclusions, retard', () => {
    const t = visibleText(sectionOf('methode', { watch: WATCH, file: SMALL })?.html ?? '');
    expect(t).toContain('Shom (CC BY-SA), OpenStreetMap (ODbL), Shom réglementation (Licence ouverte 2.0) · fichier du 04/10/2026');
    expect(t).toContain('quatre câbles anciens (ARIANE 2, ARTEMIS, TAGIDE, F-LYBIE) ne sont pas tracés');
    expect(t).toContain('« tronçon au large »');
    expect(t).toContain('Limites maritimes approchées (Menton, Hendaye)');
    expect(t).toContain('seule la préfecture maritime qualifie une infraction');
    expect(t).toContain('qui ne recoupe pas une zone de câbles n’est pas signalé');
    expect(t).toContain('aisstream.io via le relais · AIS à jour 16:47');
    expect(t).toContain('communication=line ou telecom=line');
    expect(t).toContain(`moins de 2${NBSP}km de sa côte`);
    expect(t).toContain('vitesse inconnue, navires amarrés, bâtiments militaires français');
    expect(t).toContain('TeleGeography');
  });
  it('résumé « N sources » déduit de la liste, phase B comprise (FX2) ; chaque source de la liste est nommée dans la méthode', () => {
    const s = sectionOf('methode', { watch: WATCH, file: SMALL });
    const t = visibleText(s?.html ?? '');
    expect(CONNECTIVITE_SOURCES).toHaveLength(6);
    expect(s?.summary).toBe(`${CONNECTIVITE_SOURCES.length}${NBSP}sources`);
    for (const name of CONNECTIVITE_SOURCES) expect(t, name).toContain(name);
  });
  it('méthode (arbitrage FX2) : approches d’atterrage et ports dits, nom « FRENCH WARSHIP » écarté, S9 et « jamais une menace » gardés', () => {
    const t = visibleText(sectionOf('methode', { watch: WATCH, file: SMALL })?.html ?? '');
    expect(t).toContain(`Approches d’atterrage et ports (moins de 2${NBSP}km d’un atterrage) : seuls les navires déclarés au mouillage dans une zone de câbles `
      + 'du Shom sont signalés ; seule la préfecture maritime qualifie une infraction.');
    expect(t).toContain('bâtiments militaires français (type AIS 35, ou nom AIS « FRENCH WARSHIP » sous pavillon français, outre-mer compris)');
    expect(t).toContain('hors des approches d’atterrage, un navire au mouillage reste compté');
    expect(t).toContain('Un navire dans une zone de mouillage du Shom qui ne recoupe pas une zone de câbles n’est pas signalé.');
    expect(t).toContain('« à vérifier », jamais une menace');
  });
});

describe('flux AIS muet, pannes, retards (T3, S1 à S3)', () => {
  it('AIS muet côté serveur (jeu d’essai figé) : n.d., alerte gardée en gris, non évaluée, jamais retirée', () => {
    const w = CABLES_WATCH_FROZEN_FIXTURE();
    const v = view({ watch: w });
    const since = clockOf(w.aisLastMessageAt, NOW);
    expect(v.head.level).toBe('nd');
    expect(slow(v)).toMatchObject({ value: 'n.d.', caption: `navires lents sur un câble : non évalué · AIS muet depuis ${since}` });
    expect(v.head.status[0]).toBe(`non évalué · AIS muet depuis ${since}`);
    const s = v.sections.find((x) => x.id === 'navires');
    expect(s?.summary).toBe('non évalué');
    expect(s?.html).toContain(`<p class="fmk-callout lp-callout">AIS muet depuis ${since} : alertes gardées, non évaluées.</p>`);
    expect(s?.html).not.toMatch(/fmk-dot--(?:orange|jaune|rouge)/);
    for (const a of w.alerts) expect(s?.html).toContain(`data-vessel="${a.id}"`);
  });
  it('veille non évaluée pour une autre cause que l’AIS (tâche A5) : la cause est dite, jamais « AIS muet »', () => {
    const noFile = view({ watch: { ...WATCH, alerts: [ALERT], evaluated: false, errors: [CABLES_FILE_ERROR_TEXT] }, file: SMALL });
    expect(noFile.head.status[0]).toBe('non évalué · fichier des câbles illisible');
    expect(noFile.sections.find((x) => x.id === 'navires')?.html).toContain('<p class="fmk-callout lp-callout">Fichier des câbles illisible : alertes gardées, non évaluées.</p>');
    const relay = view({ watch: { ...WATCH, evaluated: false, errors: ['Relais AIS : HTTP 503'] }, file: SMALL });
    expect(slow(relay).caption).toBe('navires lents sur un câble : non évalué · relais AIS injoignable');
    expect(visibleText(relay.sections.find((x) => x.id === 'navires')?.html ?? '')).toContain('Relais AIS injoignable : alertes non évaluées.');
    expect(visibleText(relay.sections.find((x) => x.id === 'navires')?.html ?? '')).not.toContain('AIS muet');
    expect(relay.head.status.join(' ')).not.toContain('AIS muet');
  });
  it('réponse vieillie côté client (AIS de plus de 15 min, amendement 5) : gros chiffre gardé en retard, sans couleur, pastille n.d.', () => {
    const v = view({ watch: { ...WATCH, alerts: [ALERT] }, file: SMALL, now: Date.parse('2026-10-04T15:03:00Z') });
    expect(v.head.level).toBe('nd');
    expect(slow(v)).toMatchObject({ value: '1', level: null });
    expect(slow(v).caption).toContain('(en retard)');
    expect(v.head.status[0]).toBe('niveau suspendu : relevé AIS en retard');
  });
  it('réponse vieillie : les lignes de navires passent en gris, sans couleur de niveau', () => {
    const h = view({ watch: { ...WATCH, alerts: [ALERT] }, file: SMALL, now: Date.parse('2026-10-04T15:03:00Z') }).sections.find((x) => x.id === 'navires')?.html ?? '';
    expect(h).toContain('data-vessel="227123456:way/761201753"');
    expect(h).toContain('<span class="fmk-dot" aria-hidden="true"></span>');
    expect(h).not.toMatch(/fmk-dot--(?:orange|jaune|rouge)/);
  });
  it('flux figé et alerte de zone muette : non évalué, jamais coloré', () => {
    const muted: CableAlert = { ...ALERT, zoneMuted: true };
    const v = view({ watch: { ...WATCH, evaluated: false, slowVessels: null, alerts: [muted] }, file: SMALL });
    expect(v.head.level).toBe('nd');
    expect(slow(v)).toMatchObject({ value: 'n.d.', level: null });
    const s = v.sections.find((x) => x.id === 'navires');
    expect(s?.summary).toBe('non évalué');
    expect(s?.html).not.toMatch(/fmk-dot--(?:orange|jaune|rouge)/);
    expect(s?.html).toContain('data-vessel="227123456:way/761201753"');
  });
  it('câble hors service : « hors service » avec sa propre source (Shom ou OpenStreetMap)', () => {
    const osmOff: SubseaCablesFile = { ...SMALL, cables: SMALL.cables.map((c) => (c.id === 'way/761201702' ? { ...c, outOfService: true } : c)) };
    const h = sectionOf('cables', { file: osmOff })?.html ?? '';
    expect(h).toContain('<small>hors service (OpenStreetMap) · Marseille (13)</small>');
    expect(h).toContain('<small>hors service (Shom) · Marseille (13)</small>');
  });
  it('R1 : « 5 minutes » et « 15 minutes » de la méthode sont insécables', () => {
    const t = visibleText(sectionOf('methode', { watch: WATCH, file: SMALL })?.html ?? '');
    expect(t).toContain(`5${NBSP}minutes`);
    expect(t).toContain(`15${NBSP}minutes`);
    expect(sovBreakable(t)).toBeNull();
  });
  it('veille injoignable : n.d. nommé ; fichier des câbles illisible : section en panne, veille gardée ; chargement', () => {
    const v = view({ watch: null, watchError: 'HTTP 502' });
    expect(v.head).toMatchObject({ level: 'nd', status: ['veille des câbles injoignable'] });
    expect(v.bodyHtml).toContain('Source injoignable. Aucune donnée reçue.');
    expect(visibleText(sectionOf('cables', { file: null, fileError: 'HTTP 404' })?.html ?? '')).toBe('Source indisponible : fichier des câbles (Shom, OpenStreetMap).');
    expect(sectionOf('cables', { file: null, fileError: 'HTTP 404' })?.summary).toBe('n.d.');
    const loading = view({ watch: null, watchError: null });
    expect(loading.head.status).toEqual(['chargement…']);
    expect(loading.bodyHtml).toContain('Chargement des données');
    const never = view({ watch: { ...WATCH, readAt: null, errors: ['Relais AIS : HTTP 503'] } });
    expect(never.head).toMatchObject({ level: 'nd', status: ['veille des câbles indisponible'] });
    expect(visibleText(never.sections.find((s) => s.id === 'methode')?.html ?? '')).toContain('Incidents de lecture : Relais AIS : HTTP 503.');
  });
});

describe('flux de zone muet et compte non évalué (A5, A9)', () => {
  it('alerte de zone muette : gardée en gris « non évaluée (flux de la zone muet) », jamais une couleur, pastille verte avec note, hors du gros chiffre', () => {
    const w = CABLES_WATCH_ZONE_MUTED_FIXTURE();
    const v = view({ watch: w });
    expect(cablesLevel(w, NOW).level).toBe('vert');
    expect(v.head.level).toBe('vert');
    expect(slow(v).value).toBe('0');
    expect(v.head.status[0]).toBe(glueSovUnits(cablesLevel(w, NOW).reason));
    expect(v.head.status[0]).toContain('non évaluée (flux de la zone muet)');
    const s = v.sections.find((x) => x.id === 'navires');
    expect(s?.open).toBe(true);
    expect(s?.summary).toBe(`1${NBSP}alerte non évaluée (flux de la zone muet)`);
    expect(s?.html).not.toMatch(/fmk-dot--(?:orange|jaune|rouge)/);
    expect(s?.html).toContain('<span class="fmk-dot" aria-hidden="true"></span>');
    for (const a of w.alerts) expect(s?.html).toContain(`data-vessel="${a.id}"`);
    expect(visibleText(s?.html ?? '')).toContain('non évaluée (flux de la zone muet)');
  });
  it('alerte de zone muette à côté d’une alerte évaluée : seule l’évaluée colore et compte', () => {
    const muted: CableAlert = { ...ALERT, id: '227999999:way/761201753', mmsi: '227999999', zoneMuted: true };
    const v = view({ watch: { ...WATCH, alerts: [ALERT, muted] }, file: SMALL });
    expect(v.head.level).toBe('orange');
    expect(slow(v).value).toBe('1');
    expect(v.sections.find((x) => x.id === 'navires')?.summary).toBe(`1 à vérifier · 1${NBSP}alerte non évaluée (flux de la zone muet)`);
  });
  it('compte des navires lents non évalué (slowVessels null) : jamais « aucun navire »', () => {
    const s = sectionOf('navires', { watch: { ...WATCH, slowVessels: null } });
    expect(s?.summary).toBe('non évalué');
    expect(visibleText(s?.html ?? '')).toContain('compte des navires lents non évalué');
    expect(visibleText(s?.html ?? '')).not.toMatch(/Aucun navire/);
  });
});

describe('hygiène du rendu', () => {
  const variants: Array<Partial<ConnectiviteViewInput>> = [
    {}, { watch: CABLES_WATCH_ALERTS_FIXTURE() }, { watch: CABLES_WATCH_FROZEN_FIXTURE() }, { watch: CABLES_WATCH_ZONE_MUTED_FIXTURE() }, { file: SMALL }, { watch: null, watchError: 'HTTP 502' },
    { watch: { ...WATCH, alerts: [ALERT] }, file: SMALL, now: SOV_FIXTURE_NOW + 10 * MIN },
  ];
  it('aucun tiret cadratin, aucune police à chasse fixe, aucune couleur brute, jamais « temps réel » ni « LIVE »', () => {
    for (const over of variants) {
      const h = html(over);
      expect(h).not.toMatch(/\u2014|&mdash;|monospace|#[0-9a-fA-F]{6}\b|rgba?\(/);
      expect(visibleText(h)).not.toMatch(/temps réel|TEMPS RÉEL|\bLIVE\b|SubmarineCableMap|Situation normale/i);
    }
  });
  it('R1 : aucune valeur coupée entre nombre et unité', () => {
    for (const over of variants) {
      const v = view(over);
      const texts = [v.head.figure?.caption ?? '', ...v.head.status, v.head.lead ?? '', ...v.sections.map((s) => visibleText(`${s.summary ?? ''} ${s.html}`))];
      for (const t of texts) {
        expect(breakableValue(t), t.slice(0, 80)).toBeNull();
        expect(trafficBreakable(t), t.slice(0, 80)).toBeNull();
        expect(sovBreakable(t), t.slice(0, 80)).toBeNull();
      }
    }
  });
  it('textes tiers échappés (nom de câble et de navire publiés)', () => {
    const file: SubseaCablesFile = { ...SMALL, cables: [{ ...SMALL.cables[0], name: '<img src=x onerror=alert(1)>' }] };
    const h = html({ file, watch: { ...WATCH, alerts: [{ ...ALERT, name: '<script>x</script>' }] } });
    expect(h).not.toMatch(/<img src=x|<script>/);
    expect(h).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
