// src/components/layer-panel/maritime.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MaritimeSignal, MaritimeSnapshot } from '../../types/index.ts';
import { maritimeLevel } from '../../services/traffic-levels.ts';
import { TRAFFIC_NOW, maritimeSnapshotFixture, paris } from './traffic.fixture.ts';
import { renderLayerView } from './frame.ts';
import { NBSP, breakableValue, visibleText } from './format.ts';
import { glueUnits, trafficBreakable } from './traffic-format.ts';
import { maritimeHead, maritimeMethodSection, veilleSections, type MaritimeVeilleInput } from './maritime.ts';

const open = (_: string, d: boolean): boolean => d;
const input = (over: Partial<MaritimeVeilleInput> = {}): MaritimeVeilleInput => ({ snapshot: maritimeSnapshotFixture(), error: null, now: TRAFFIC_NOW, open, ...over });
const sections = (over: Partial<MaritimeVeilleInput> = {}) => [...veilleSections(input(over)), maritimeMethodSection(input(over))];
const sectionOf = (id: string, over: Partial<MaritimeVeilleInput> = {}) => sections(over).find((s) => s.id === id);
const html = (over: Partial<MaritimeVeilleInput> = {}): string => {
  const i = input(over);
  return renderLayerView('trafficMaritime', { head: maritimeHead(i.snapshot, i.error, i.now), sections: sections(over) });
};
function withSnapshot(edit: (s: MaritimeSnapshot) => void): MaritimeSnapshot {
  const s = maritimeSnapshotFixture();
  edit(s);
  return s;
}
const signal = (over: Partial<MaritimeSignal> = {}): MaritimeSignal => ({
  mmsi: '228111000', name: 'PETROLIER TEST', type: 'Pétrolier', status: 2, statusLabel: 'non maître de sa manœuvre', lat: 48.1, lon: -5.3,
  since: paris('14:30'), confirmed: true, sensitive: true, ...over,
});
const LATE_NOW = Date.parse('2026-10-03T13:18:00Z');

describe('vue Trafic maritime, onglet Veille (spec 2026-10-03 trafics § 3.4)', () => {
  it('en-tête du 03/10 : 1 196 navires sans couleur (un nombre de navires n’est pas une gravité), pastille Vert, AIS daté, synthèse', () => {
    const h = maritimeHead(maritimeSnapshotFixture(), null, TRAFFIC_NOW);
    expect(maritimeLevel(maritimeSnapshotFixture()).level).toBe('vert');
    expect(h).toMatchObject({ theme: 'Trafics', title: 'Trafic maritime', level: 'vert' });
    expect(h.figure).toEqual({ value: '1\u202F196', caption: 'navires suivis dans les eaux françaises · dont 681 sous pavillon français · AIS, 15:12', level: null });
    expect(h.status).toEqual([glueUnits(maritimeLevel(maritimeSnapshotFixture()).reason), `AIS${NBSP}15:12`]);
    expect(h.lead).toBe('Aucun navire en difficulté confirmé. Le Havre : 7 navires au mouillage.');
    expect(html()).toContain('<b class="fmk-num">1\u202F196</b>');
  });
  it('sections, ordre, ouverture', () => {
    expect(sections().map((s) => [s.id, s.open ?? false])).toEqual([
      ['signals', true], ['zones', true], ['ports', true], ['sensitive', true], ['method', false],
    ]);
    expect(sections().at(-1)?.tone).toBe('reference');
  });
  it('signalements : aucun confirmé ; statuts d’information en gris, jamais une alerte (T3)', () => {
    const s = sectionOf('signals');
    expect(s?.summary).toBe('aucun confirmé · 41 manœuvre restreinte');
    const h = s?.html ?? '';
    expect(h).toContain('<span class="fmk-dot fmk-dot--vert" aria-hidden="true"></span><span>Aucun navire en difficulté confirmé</span><span class="lp-val fmk-num">15:12</span>'
      + `<small>non maître de sa manœuvre : 0 · échoué hors port, à l’arrêt depuis 30${NBSP}min : 0</small>`);
    expect(h).toContain('<span class="fmk-dot" aria-hidden="true"></span><span>Manœuvrabilité restreinte</span><span class="lp-val fmk-num">41</span>'
      + '<small>dragues, remorqueurs, câbliers, pilotes : information, pas une alerte</small>');
    expect(h).toContain('<span>Contraint par son tirant d’eau</span><span class="lp-val fmk-num">3</span>');
    expect(h).toContain('<span>En pêche</span><span class="lp-val fmk-num">43</span>');
    expect(visibleText(h)).toContain(`à moins de 0,5${NBSP}nœud, constant sur 30${NBSP}min et sur au moins deux positions`);
  });
  it('signalement confirmé : pétrolier rouge, autre navire orange ; pastille et synthèse', () => {
    const tanker = withSnapshot((s) => { s.signals = [signal()]; });
    expect(maritimeLevel(tanker).level).toBe('rouge');
    expect(maritimeHead(tanker, null, TRAFFIC_NOW).level).toBe('rouge');
    expect(maritimeHead(tanker, null, TRAFFIC_NOW).lead).toBe('1 navire en difficulté confirmée : PETROLIER TEST (non maître de sa manœuvre). Le Havre : 7 navires au mouillage.');
    const h = sectionOf('signals', { snapshot: tanker })?.html ?? '';
    expect(h).toContain('<span class="fmk-dot fmk-dot--rouge" aria-hidden="true"></span><span>PETROLIER TEST · non maître de sa manœuvre</span><span class="lp-val fmk-num">14:30</span>'
      + '<small>Pétrolier · 48,100 N 5,300 O · constant depuis 14:30 · pétrolier ou navire à passagers</small>');
    expect(sectionOf('signals', { snapshot: tanker })?.summary).toBe('1 confirmé · 41 manœuvre restreinte');
    const cargo = withSnapshot((s) => { s.signals = [signal({ name: null, type: null, sensitive: false, mmsi: '256000111' })]; });
    expect(sectionOf('signals', { snapshot: cargo })?.html).toContain('<span class="fmk-dot fmk-dot--orange" aria-hidden="true"></span><span>MMSI 256000111 · non maître de sa manœuvre</span>');
  });
  it('par zone : navires, au mouillage, en route ; le plus chargé d’abord', () => {
    const s = sectionOf('zones');
    expect(s?.summary).toBe('Méditerranée 499');
    const h = s?.html ?? '';
    expect(h).toContain('<tr><th scope="row">Méditerranée</th><td><span class="lp-val fmk-num">499</span></td><td><span class="lp-val fmk-num">35</span></td><td><span class="lp-val fmk-num">62</span></td></tr>');
    const order = ['Méditerranée', 'Atlantique', 'Manche', 'Pas-de-Calais (rail de navigation)'].map((n) => h.indexOf(`>${n}<`));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(visibleText(h)).toContain('la classe B (plaisance, petits navires) ne transmet pas de statut');
  });
  it('ports : jauges de catégorie, mouillage, amarrés, en route ; couverture étendue', () => {
    const s = sectionOf('ports');
    expect(s?.summary).toBe('Le Havre 94 · 7 au mouillage');
    const h = s?.html ?? '';
    expect(h.match(/class="lp-bar-row"/g)).toHaveLength(8);
    expect(h).toContain('<span class="lp-bar-label">Le Havre</span><span class="fmk-bar"><i style="width:100%;background:var(--cat-port)"></i></span>'
      + '<span class="lp-val fmk-num">94</span><small>au mouillage 7 · amarrés 20 · en route 41</small>');
    expect(h).toContain('<span class="lp-bar-label">Brest</span><span class="fmk-bar"><i style="width:59.6%;background:var(--cat-port)"></i></span>');
    expect(visibleText(h)).toContain(`à moins de 25${NBSP}km du port ; au mouillage : à moins de 40${NBSP}km`);
    expect(visibleText(h)).toContain('Dunkerque, Calais et la Gironde');
  });
  it('ports : couverture AIS (amendement 5), jamais un 0 factuel ni une jauge sans réception en 24 h ; planchers', () => {
    const h = sectionOf('ports')?.html ?? '';
    expect(h).toContain('<div class="lp-row"><span class="fmk-dot" aria-hidden="true"></span><span>Bordeaux</span><span class="lp-val fmk-num">n.d.</span><small>aucune réception AIS depuis 24\u00A0h</small></div>');
    expect(h).not.toMatch(/lp-bar-label">Bordeaux/);
    expect(h.indexOf('>Bordeaux<')).toBeGreaterThan(h.indexOf('>Calais<'));
    expect(h).toMatch(/lp-bar-label">Dunkerque<[^]*dernière réception 11:47/);
    const t = visibleText(h);
    for (const part of ['planchers liés à la couverture des récepteurs AIS bénévoles', 'Dunkerque Est et Ouest', 'de Bassens au Verdon', 'Lavéra et Fos', 'Donges-Montoir', 'Port-Jérôme']) expect(t).toContain(part);
    const none = withSnapshot((s) => { s.ports.forEach((p) => { p.lastSeenAt = null; p.vessels = 0; }); });
    const s2 = sectionOf('ports', { snapshot: none });
    expect(s2?.summary).toBe('aucune réception AIS depuis 24\u00A0h');
    expect(s2?.html).not.toContain('lp-bar-row');
  });
  it('panne partielle du flux amont : nommée dans les zones, la synthèse et « Méthode et sources » ; périmètre métropole', () => {
    const msg = 'flux AIS partiel : lot 2 sur 3 coupé (Atlantique, golfe du Lion)';
    const partial = withSnapshot((s) => { s.errors = [msg, 'ports : calcul interrompu']; });
    const z = sectionOf('zones', { snapshot: partial });
    expect(z?.summary).toBe('Méditerranée 499 · flux partiel');
    expect(visibleText(z?.html ?? '')).toContain(`${msg}. Les zones concernées ne se lisent pas comme calmes`);
    const m = visibleText(sectionOf('method', { snapshot: partial })?.html ?? '');
    expect(m).toContain('Flux AIS partiel : lot 2 sur 3 coupé (Atlantique, golfe du Lion).');
    expect(m).toContain('Incidents de lecture : ports : calcul interrompu.');
    expect(m).not.toContain('Incidents de lecture : flux AIS partiel');
    expect(maritimeHead(partial, null, TRAFFIC_NOW).lead).toContain('Flux AIS partiel : des zones ne sont pas couvertes.');
    expect(sectionOf('signals', { snapshot: partial })?.html).toContain('sur les zones couvertes seulement');
    expect(sectionOf('zones')?.html).not.toContain('lp-callout');
    expect(visibleText(sectionOf('zones')?.html ?? '')).toContain('navires d’outre-mer apparaissent sur la carte');
    expect(m).toContain('limités aux eaux métropolitaines');
  });
  it('navires sensibles : pétroliers et passagers à moins de 12 milles, les plus proches d’abord', () => {
    const s = sectionOf('sensitive');
    expect(s?.summary).toBe('21 pétroliers · 39 passagers');
    const h = s?.html ?? '';
    expect(h).toContain(`<span class="fmk-kv-k">Pétroliers à moins de 12${NBSP}milles des côtes</span><span class="fmk-kv-v fmk-num"><span class="lp-val fmk-num">21</span></span>`);
    expect(h.indexOf('PASSAGERS ESSAI 1')).toBeLessThan(h.indexOf('PETROLIER ESSAI 1'));
    expect(h).toContain(`<span>PASSAGERS ESSAI 1</span><span class="lp-val fmk-num">1,1${NBSP}milles</span><small>navire à passagers · 50,950\u00a0N\u00a01,820\u00a0E</small>`);
    expect(visibleText(h)).toContain(`13${NBSP}% des navires suivis ont un type connu`);
  });
  it('méthode et sources : AIS daté, périmètre (T1), règle de la pastille, croisement (T3), retard, millésimes des listes', () => {
    const t = visibleText(sectionOf('method')?.html ?? '');
    for (const part of ['dernier message de 15:12', 'instantané de 15:12', 'Royaume-Uni, Espagne et Seine en amont de Rouen exclus',
      'rouge si un pétrolier ou un navire à passagers est en difficulté confirmée', `au-delà de 5${NBSP}min`, 'MMSI 226 à 228',
      'rapport annuel Paris MOU 2024', 'OFAC, liste saisie le 27/03/2026']) expect(t).toContain(part);
    expect(sectionOf('method')?.summary).toBe('AIS (aisstream, relais)');
  });
  it('AIS en retard (dernier message de plus de 5 min) : « AIS indisponible depuis 15:12 », pastille n.d., aucune couleur', () => {
    const h = maritimeHead(maritimeSnapshotFixture(), null, LATE_NOW);
    expect(h.level).toBe('nd');
    expect(h.status[0]).toBe('AIS indisponible depuis 15:12');
    expect(h.figure?.caption).toMatch(/AIS, 15:12 \(en retard\)$/);
    expect(h.lead).toBeNull();
    expect(sectionOf('signals', { now: LATE_NOW })?.html).not.toMatch(/fmk-dot--/);
    expect(sectionOf('signals', { now: LATE_NOW })?.html).toContain('<span>Signalements suspendus</span><span class="lp-val fmk-num">15:12</span>');
    expect(visibleText(html({ now: LATE_NOW }))).not.toMatch(/aucun navire/i);
    // Ports : comme les aéroports et les jauges des DIR, une donnée en retard perd ses couleurs (aucune jauge de catégorie).
    const ports = sectionOf('ports', { now: LATE_NOW });
    expect(ports?.html).not.toContain('lp-bar-row');
    expect(ports?.html).not.toContain('var(--cat-port)');
    expect(ports?.html).toMatch(/<div class="lp-row"><span class="fmk-dot" aria-hidden="true"><\/span><span>[^<]+<\/span><span class="lp-val fmk-num">\d+<\/span><small>au mouillage/);
    expect(ports?.summary).toMatch(/\(en retard\)$/);
  });
  it('AIS indisponible sans donnée : jamais « aucun navire » ; erreur avec données ; panne partielle ; vide', () => {
    const down = maritimeHead(null, 'HTTP 502', TRAFFIC_NOW);
    expect(down).toMatchObject({ level: 'nd', figure: { value: 'n.d.' }, status: ['AIS indisponible'] });
    const downSections = sections({ snapshot: null, error: 'HTTP 502' });
    expect(downSections.find((s) => s.id === 'signals')?.html).toContain('Source indisponible : instantané AIS du relais.');
    expect(visibleText(html({ snapshot: null, error: 'HTTP 502' }))).not.toMatch(/aucun navire/i);
    const partial = withSnapshot((s) => { s.ports = []; s.errors = ['ports : calcul interrompu']; });
    expect(sectionOf('ports', { snapshot: partial })?.html).toContain('Source indisponible : ports (instantané AIS).');
    expect(visibleText(sectionOf('method', { snapshot: partial })?.html ?? '')).toContain('Incidents de lecture : ports : calcul interrompu.');
    const empty = withSnapshot((s) => { s.zones = []; s.ports = []; s.vessels = 0; });
    expect(sectionOf('zones', { snapshot: empty })?.html).toContain('Aucun navire dans les eaux couvertes.');
  });
  it('lastMessageAt absent : « aucun message reçu », jamais « depuis n.d. » ; panne partielle sur zones vides et ports', () => {
    const never = withSnapshot((s) => { s.lastMessageAt = null; });
    const h = maritimeHead(never, null, TRAFFIC_NOW);
    expect(h.status).toEqual(['AIS indisponible (aucun message reçu)']);
    expect(h.figure?.caption).toContain('AIS : aucun message reçu');
    expect(visibleText(html({ snapshot: never }))).not.toContain('depuis n.d.');
    const msg = 'flux AIS partiel : lot 2 sur 3 coupé (Atlantique, golfe du Lion)';
    const part = withSnapshot((s) => { s.errors = [msg]; s.zones = []; });
    expect(sectionOf('zones', { snapshot: part })?.html).toContain('lp-callout');
    expect(visibleText(sectionOf('ports', { snapshot: part })?.html ?? '')).toContain('comptes des ports concernés sont des minimums');
    expect(maritimeHead(part, null, TRAFFIC_NOW).status[0]).toMatch(/\(flux partiel\)$/);
  });
  it('textes hostiles échappés ; R1 ; aucun tiret cadratin, aucune police à chasse fixe, aucune couleur brute', () => {
    const snapshot = withSnapshot((s) => {
      s.signals = [signal({ name: '<img src=x>' })];
      s.ports[0].port = '<script>p</script>';
      s.sensitive.list[0].name = '"><svg onload=1>';
    });
    const h = html({ snapshot });
    expect(h).not.toMatch(/<img|<script|<svg onload/);
    for (const over of [{}, { snapshot }, { now: LATE_NOW }, { snapshot: null, error: 'HTTP 502' }]) {
      const all = html(over);
      const text = visibleText(all);
      expect(breakableValue(text)).toBeNull();
      expect(trafficBreakable(text)).toBeNull();
      expect(all).not.toMatch(/\u2014|&mdash;|monospace|#[0-9a-fA-F]{6}\b|rgba?\(/);
      expect(text.toLowerCase()).not.toContain('temps réel');
    }
  });
  it('jeton de catégorie des ports défini dans :root', () => {
    const css = readFileSync(new URL('../../styles/main.css', import.meta.url), 'utf8');
    expect(css).toMatch(/:root \{[^}]*--cat-port: #30b0c7;/);
  });
});
