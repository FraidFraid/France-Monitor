// src/components/layer-panel/maritime-tabs.test.ts
import { describe, expect, it } from 'vitest';
import type { MilitaryShip } from '../../services/military-ships.ts';
import { TRAFFIC_NOW, maritimeSnapshotFixture } from './traffic.fixture.ts';
import { renderLayerView } from './frame.ts';
import { NBSP, breakableValue, visibleText } from './format.ts';
import { trafficBreakable } from './traffic-format.ts';
import { MARITIME_PAGE_SIZE, buildMaritimeView, maritimeTabs, type MaritimeLiveInput, type MaritimeViewInput } from './maritime-tabs.ts';

const open = (_: string, d: boolean): boolean => d;
const ship = (over: Partial<MilitaryShip> & Pick<MilitaryShip, 'id' | 'name'>): MilitaryShip => ({
  type: 'Cargo', role: 'Civil/Inconnu', lat: 49.6, lon: -1.0, isLive: true, lastSeen: TRAFFIC_NOW - 60_000, riskLevel: 'none', ...over,
});
const TRAFFIC: MilitaryShip[] = [
  ship({ id: 'ais-1', name: 'CALANDRA', mmsi: '232063461', speed: 4.1, country: 'GB|Royaume-Uni' }),
  ship({ id: 'ais-2', name: 'OCEAN STAR', mmsi: '667001234', speed: 11.2, country: 'SL|Sierra Leone', flagRisk: 'blacklist', riskLevel: 'medium',
    riskReasons: ['Pavillon liste noire Paris MOU'], navStatus: 0, cog: 245, heading: 244, destination: 'LE HAVRE', shipType: 70, imoNumber: 9123456,
    callSign: 'J8AB1', draught: 9.4, dimensions: { length: 182, width: 28 }, eta: { month: 10, day: 4, hour: 6, minute: 30 },
    nearestPort: { name: 'Le Havre', locode: 'FRLEH', distanceKm: 38 }, maritimeTerritory: { code: 'FR-METRO', name: 'France hexagonale' },
    trail: [[-1.2, 49.5], [-1.1, 49.55], [-1.0, 49.6]] }),
  ship({ id: 'ais-3', name: 'NORD EXPRESS', mmsi: '273123456', speed: 14, country: 'RU|Russie', type: 'Militaire', riskLevel: 'high',
    riskReasons: ['Navire militaire étranger (Russie)'], lat: 43.0, lon: 6.4 }),
  ship({ id: 'ais-4', name: 'CALANDRA', mmsi: '228000777', speed: 0.2, country: 'FR|France' }),
  ship({ id: 'ais-5', name: 'BELLE ÎLE', mmsi: '329001122', speed: 8, country: 'GP|Guadeloupe', riskLevel: 'low', lat: 16.24, lon: -61.53 }),
];
const NAVY: MilitaryShip[] = [
  ship({ id: 'r91', name: 'Charles de Gaulle', type: 'Porte-avions', role: 'Aviation', mmsi: '227334000', lat: 43.122, lon: 5.928, speed: 0,
    port: 'Toulon', isLive: false, lastSeen: undefined }),
  ship({ id: 'd620', name: 'Chevalier Paul', type: 'Frégate DA', role: 'Défense aérienne', mmsi: '227731000', lat: 43.0, lon: 6.2, speed: 16.5, port: 'Toulon' }),
];
const live = (over: Partial<MaritimeLiveInput> = {}): MaritimeLiveInput => ({
  status: 'connected', lastMessageAt: TRAFFIC_NOW - 5_000, navy: NAVY, traffic: TRAFFIC, search: '', territory: 'all', filter: 'alertes', pages: 1,
  selected: null, ...over,
});
const input = (over: Partial<MaritimeViewInput> = {}): MaritimeViewInput => ({
  snapshot: maritimeSnapshotFixture(), error: null, tab: 'alertes', live: live(), now: TRAFFIC_NOW, open, ...over,
});
const view = (over: Partial<MaritimeViewInput> = {}) => buildMaritimeView(input(over));
const html = (over: Partial<MaritimeViewInput> = {}): string => renderLayerView('trafficMaritime', view(over));
const sectionOf = (id: string, over: Partial<MaritimeViewInput> = {}) => view(over).sections.find((s) => s.id === id);

describe('panneau Trafic maritime : onglets, Marine nationale, Alertes, fiche navire (spec § 3.4)', () => {
  it('trois onglets, comptes : navires de la Marine nationale suivis en mer, alertes ; même en-tête partout', () => {
    expect(maritimeTabs(maritimeSnapshotFixture(), live())).toEqual([
      { id: 'veille', label: 'Veille' }, { id: 'marine', label: 'Marine nationale', count: 1 }, { id: 'alertes', label: 'Alertes', count: 2 },
    ]);
    for (const tab of ['veille', 'marine', 'alertes'] as const) {
      const v = view({ tab });
      expect(v.activeTab).toBe(tab);
      expect(v.head.figure?.value).toBe('1\u202F196');
      expect(v.sections.at(-1)?.id).toBe('method');
    }
    expect(view({ tab: 'veille' }).sections.map((s) => s.id)).toEqual(['signals', 'zones', 'ports', 'sensitive', 'method']);
  });
  it('Marine nationale : recherche et territoire gardés, navire en mer et au port d’attache, liste paginée', () => {
    const v = view({ tab: 'marine' });
    expect(v.sections.map((s) => s.id)).toEqual(['navy', 'method']);
    const h = v.sections[0].html;
    expect(v.sections[0].summary).toBe('1 en mer suivi · 2 navires');
    expect(h).toContain('<input type="search" class="lp-search" data-mar-search value="" placeholder="Nom ou MMSI" aria-label="Rechercher un navire par nom ou MMSI">');
    expect(h).toContain('<select class="lp-select" data-mar-territory aria-label="Territoire"><option value="all" selected>Tous les territoires français</option>');
    expect(h).toContain('<option value="GP">Guadeloupe</option>');
    expect(h).toContain(`<div class="lp-row is-link" tabindex="0" role="button" data-mar-ship="227731000"><span class="fmk-dot fmk-dot--vert" aria-hidden="true"></span><span>Chevalier Paul</span><span class="lp-val fmk-num">16,5${NBSP}nœuds</span><small>Frégate DA · Défense aérienne · vu à 15:14</small></div>`);
    expect(h).toContain('<span>Charles de Gaulle</span><span class="lp-val fmk-num">port d’attache</span><small>Porte-avions · Aviation · position de référence : Toulon</small>');
    expect(sectionOf('navy', { tab: 'marine', live: live({ search: 'charles' }) })?.html).not.toContain('Chevalier Paul');
    expect(sectionOf('navy', { tab: 'marine', live: live({ territory: 'GP' }) })?.html).toContain('Aucun navire de la Marine nationale pour ce choix.');
  });
  it('Alertes : risque modéré ou plus, le plus grave d’abord, critères dans la note ; filtres ; homonymes distingués', () => {
    const s = sectionOf('alerts');
    expect(s?.summary).toBe('2 alertes');
    const h = s?.html ?? '';
    expect(h).toContain('<button type="button" class="lp-toggle" data-mar-filter="alertes" aria-pressed="true">Alertes</button>');
    expect(h).toContain('<button type="button" class="lp-toggle" data-mar-filter="tous" aria-pressed="false">Tous les navires</button>');
    expect(h.indexOf('NORD EXPRESS')).toBeLessThan(h.indexOf('OCEAN STAR'));
    expect(h).toContain(`<span class="fmk-dot fmk-dot--rouge" aria-hidden="true"></span><span>NORD EXPRESS</span><span class="lp-val fmk-num">14${NBSP}nœuds</span>`
      + '<small>Militaire · pavillon Russie · vu à 15:14 · Navire militaire étranger (Russie)</small>');
    expect(h).toMatch(/fmk-dot--orange[^]*OCEAN STAR[^]*pavillon Sierra Leone · France hexagonale · Le Havre à 38/);
    expect(visibleText(sectionOf('alerts', { live: live({ filter: 'risque-eleve' }) })?.html ?? '')).not.toContain('OCEAN STAR');
    const flags = visibleText(sectionOf('alerts', { live: live({ filter: 'pavillon' }) })?.html ?? '');
    expect(flags).toContain('OCEAN STAR');
    expect(flags).not.toContain('NORD EXPRESS');
    const all = sectionOf('alerts', { live: live({ filter: 'tous' }) });
    expect(all?.summary).toBe('5 navires suivis');
    expect(all?.html).toContain('<span>CALANDRA · MMSI …3461</span>');
    expect(all?.html).toContain('<span>CALANDRA · MMSI …0777</span>');
    const gp = sectionOf('alerts', { live: live({ filter: 'tous', territory: 'GP' }) });
    expect(visibleText(gp?.html ?? '')).toContain('BELLE ÎLE');
    expect(visibleText(gp?.html ?? '')).not.toContain('OCEAN STAR');
    expect(visibleText(sectionOf('alerts', { live: live({ search: '6670' }) })?.html ?? '')).toContain('OCEAN STAR');
  });
  it('Alertes : liste paginée par 20, bouton « Afficher de plus »', () => {
    const many = Array.from({ length: 25 }, (_, i) => ship({ id: `x-${i}`, name: `NAVIRE ${i}`, mmsi: `66700${String(i).padStart(4, '0')}`, riskLevel: 'medium' }));
    const h = sectionOf('alerts', { live: live({ traffic: many }) })?.html ?? '';
    expect(h.match(/data-mar-ship=/g)).toHaveLength(MARITIME_PAGE_SIZE);
    expect(h).toContain('<button type="button" class="lp-toggle" data-mar-more>Afficher 5 de plus (5 restants)</button>');
    expect(sectionOf('alerts', { live: live({ traffic: many, pages: 2 }) })?.html).not.toContain('data-mar-more');
  });
  it('pavillons à risque : listes avec leur millésime', () => {
    const s = sectionOf('flags');
    expect(s?.open).toBe(false);
    const t = visibleText(s?.html ?? '');
    expect(t).toContain('Liste noire (rapport annuel Paris MOU 2024)');
    expect(t).toContain('Sierra Leone');
    expect(t).toContain('Registres sous sanctions (OFAC, liste saisie le 27/03/2026)');
    expect(t).toContain('Corée du Nord');
  });
  it('AIS figé ou coupé (en-tête en retard aussi) : « AIS indisponible depuis hh:mm », puces grises ; jamais « aucune alerte » sans flux', () => {
    const lateSnapshot = { ...maritimeSnapshotFixture(), lastMessageAt: '2026-10-03T15:05:00+02:00' };
    const stale = view({ snapshot: lateSnapshot, live: live({ status: 'stale', lastMessageAt: TRAFFIC_NOW - 10 * 60_000 }) });
    expect(stale.head.level).toBe('nd');
    expect(stale.bodyHtml).toContain('AIS indisponible depuis 15:05 : positions figées.');
    expect(stale.sections.find((s) => s.id === 'alerts')?.html).not.toMatch(/fmk-dot--/);
    const cut = view({ snapshot: null, error: 'HTTP 502', live: live({ status: 'disconnected', lastMessageAt: null, traffic: [], navy: [] }) });
    expect(cut.bodyHtml).toContain('AIS indisponible : aucun message reçu.');
    expect(visibleText(cut.sections.find((s) => s.id === 'alerts')?.html ?? '')).toContain('AIS indisponible : aucune position reçue.');
    expect(visibleText(renderLayerView('trafficMaritime', cut))).not.toMatch(/Aucune alerte/);
    expect(visibleText(sectionOf('alerts', { live: live({ traffic: [TRAFFIC[0]] }) })?.html ?? '')).toContain('Aucune alerte parmi 1 navire suivi.');
  });
  it('fiche navire : position, caractéristiques, risque, liens, route récente ; retour à la liste ; sans police à chasse fixe', () => {
    const selected = TRAFFIC[1];
    const v = view({ live: live({ selected }) });
    expect(v.sections.map((s) => s.id)).toEqual(['ship-position', 'ship-specs', 'ship-risk', 'ship-links', 'method']);
    expect(v.bodyHtml).toContain('<button type="button" class="lp-toggle" data-mar-back>Retour à la liste</button>');
    const pos = v.sections[0].html;
    expect(pos).toContain('<span class="fmk-kv-k">Statut</span><span class="fmk-kv-v fmk-num"><span class="lp-val fmk-num">En route (moteur)</span></span>');
    expect(pos).toContain(`<span class="lp-val fmk-num">11,2${NBSP}nœuds</span>`);
    expect(pos).toContain('<span class="lp-val fmk-num">04/10 06:30 UTC</span>');
    expect(pos).toContain('<span class="lp-val fmk-num">49,600 N 1,000 O</span>');
    expect(pos).toMatch(/<svg class="lp-chart"[^>]*role="img" aria-label="Route récente \(3 positions\)"[^]*stroke="var\(--cat-port\)"/);
    const specs = v.sections[1].html;
    expect(specs).toContain('<span class="lp-val fmk-num">Cargo (code 70)</span>');
    expect(specs).toContain('<span class="lp-val fmk-num">Sierra Leone · liste noire Paris MOU</span>');
    expect(specs).toContain(`<span class="lp-val fmk-num">182${NBSP}m</span>`);
    expect(specs).toContain('<span class="lp-val fmk-num">667001234</span>');
    expect(v.sections[2].html).toContain('<span class="fmk-dot fmk-dot--orange" aria-hidden="true"></span><span>Risque modéré</span>');
    expect(v.sections[2].html).toContain('<span>Pavillon liste noire Paris MOU</span>');
    expect(v.sections[3].html).toContain('<a class="lp-link" href="https://www.marinetraffic.com/en/ais/details/ships/mmsi:667001234" target="_blank" rel="noopener noreferrer">MarineTraffic</a>');
    expect(v.sections[3].html).toContain('Equasis (IMO)');
    expect(renderLayerView('trafficMaritime', v)).not.toMatch(/monospace|font-family/);
  });
  it('flux figé avec positions figées : aucune alerte lue comme calme (T3), résumé sans « 0 alerte »', () => {
    const lateSnapshot = { ...maritimeSnapshotFixture(), lastMessageAt: '2026-10-03T15:05:00+02:00' };
    const frozen = live({ status: 'stale', lastMessageAt: TRAFFIC_NOW - 10 * 60_000, traffic: [TRAFFIC[0]] });
    const s = sectionOf('alerts', { snapshot: lateSnapshot, live: frozen });
    expect(s?.summary).toBe('alertes non évaluées');
    expect(visibleText(s?.html ?? '')).toContain('AIS indisponible : alertes non évaluées.');
    expect(visibleText(s?.html ?? '')).not.toMatch(/Aucune alerte/);
    expect(sectionOf('alerts', { snapshot: lateSnapshot, live: { ...frozen, traffic: TRAFFIC } })?.summary).toBe('2 alertes (AIS indisponible)');
  });
  it('un seul seuil AIS dans le panneau (5 min, comme l’en-tête et la Veille) : à 3 min, liste vivante et couleurs gardées', () => {
    const v = view({ live: live({ status: 'stale', lastMessageAt: TRAFFIC_NOW - 3 * 60_000 }) });
    expect(v.bodyHtml).toBeUndefined();
    expect(v.sections.find((s) => s.id === 'alerts')?.html).toContain('fmk-dot--orange');
    expect(v.sections.find((s) => s.id === 'alerts')?.summary).toBe('2 alertes');
    const navy = view({ tab: 'marine', live: live({ status: 'stale', lastMessageAt: TRAFFIC_NOW - 3 * 60_000 }) });
    expect(navy.bodyHtml).toBeUndefined();
  });
  it('liaison directe figée mais instantané du relais à l’heure (pastille colorée) : jamais « positions figées » ni « AIS indisponible » sous la pastille', () => {
    for (const tab of ['alertes', 'marine'] as const) {
      const v = view({ tab, live: live({ status: 'stale', lastMessageAt: TRAFFIC_NOW - 10 * 60_000 }) });
      expect(v.head.level).toBe('vert');
      const all = visibleText(renderLayerView('trafficMaritime', v));
      expect(all).not.toMatch(/positions figées|AIS indisponible/);
      expect(v.bodyHtml).toContain('Liaison directe au relais interrompue depuis 15:05 : liste figée ; l’en-tête suit l’instantané du relais.');
      expect(v.sections[0].html).not.toMatch(/fmk-dot--/);
    }
    const frozen = live({ status: 'stale', lastMessageAt: TRAFFIC_NOW - 10 * 60_000 });
    expect(sectionOf('alerts', { live: frozen })?.summary).toBe('2 alertes (liaison directe interrompue)');
    expect(visibleText(sectionOf('alerts', { live: { ...frozen, traffic: [TRAFFIC[0]] } })?.html ?? '')).toContain('Liaison directe interrompue : alertes non évaluées.');
    const cut = view({ live: live({ status: 'disconnected', lastMessageAt: null, traffic: [], navy: [] }) });
    expect(cut.bodyHtml).toContain('Liaison directe au relais : aucun message reçu ; l’en-tête suit l’instantané du relais.');
    expect(visibleText(cut.sections.find((s) => s.id === 'alerts')?.html ?? '')).toContain('Liaison directe interrompue : aucune position reçue.');
  });
  it('pavillons : résumé dérivé des millésimes ; Marine nationale nomme le filtre remplacé', () => {
    expect(sectionOf('flags')?.summary).toBe('rapport annuel Paris MOU 2024 · OFAC, liste saisie le 27/03/2026');
    expect(visibleText(sectionOf('navy', { tab: 'marine' })?.html ?? '')).not.toContain('Remplace');
  });
  it('filtre Militaire : navires militaires français et étrangers, quel que soit le risque ; puce présente', () => {
    const french = ship({ id: 'fr-1', name: 'FREGATE FR', mmsi: '227500001', type: 'Frégate DA', role: 'Défense aérienne', riskLevel: 'none' });
    const low = ship({ id: 'ru-1', name: 'RU PATROL', mmsi: '273000001', type: 'Militaire', riskLevel: 'low' });
    const med = ship({ id: 'cn-1', name: 'CN ESCORT', mmsi: '412000001', type: 'Militaire', riskLevel: 'medium' });
    const cargo = ship({ id: 'c-1', name: 'CARGO CIVIL', mmsi: '229000001', riskLevel: 'medium' });
    const s = sectionOf('alerts', { live: live({ filter: 'militaire', traffic: [...TRAFFIC, french, low, med, cargo] }) });
    const t = visibleText(s?.html ?? '');
    for (const n of ['FREGATE FR', 'RU PATROL', 'CN ESCORT', 'NORD EXPRESS']) expect(t).toContain(n);
    for (const n of ['CARGO CIVIL', 'OCEAN STAR']) expect(t).not.toContain(n);
    expect(s?.summary).toBe('4 navires militaires');
    expect(s?.html).toContain('<button type="button" class="lp-toggle" data-mar-filter="militaire" aria-pressed="true">Militaire</button>');
    expect(sectionOf('alerts')?.html).toContain('data-mar-filter="militaire" aria-pressed="false">Militaire</button>');
    expect(visibleText(sectionOf('alerts', { live: live({ filter: 'militaire', traffic: [cargo] }) })?.html ?? '')).toContain('Aucun navire militaire parmi 1 navire suivi.');
    expect(maritimeTabs(maritimeSnapshotFixture(), live({ traffic: [low, med] })).find((x) => x.id === 'alertes')?.count).toBe(1);
  });
  it('textes hostiles échappés ; R1 ; aucun tiret cadratin, aucune couleur brute', () => {
    const hostile = [ship({ id: 'h', name: '<img src=x>', mmsi: '667000001', riskLevel: 'high', riskReasons: ['<script>r</script>'], destination: '"><svg onload=1>' })];
    const variants: Array<Partial<MaritimeViewInput>> = [
      { live: live({ traffic: hostile, search: '"><b>q' }) }, { live: live({ traffic: hostile, selected: hostile[0] }) }, { tab: 'marine' }, { tab: 'veille' },
      { live: live({ status: 'stale', lastMessageAt: TRAFFIC_NOW - 600_000 }) },
    ];
    for (const over of variants) {
      const all = html(over);
      expect(all).not.toMatch(/<img|<script|<svg onload|<b>q/);
      const text = visibleText(all);
      expect(breakableValue(text)).toBeNull();
      expect(trafficBreakable(text)).toBeNull();
      expect(all).not.toMatch(/\u2014|&mdash;|monospace|#[0-9a-fA-F]{6}\b|rgba?\(/);
    }
  });
});
