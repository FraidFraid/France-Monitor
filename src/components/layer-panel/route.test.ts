// src/components/layer-panel/route.test.ts
import { describe, expect, it } from 'vitest';
import type { RoadNationalResponse } from '../../types/index.ts';
import { roadLevel } from '../../services/traffic-levels.ts';
import { TRAFFIC_NOW, roadNationalFixture, roadUrbanFixture } from './traffic.fixture.ts';
import { renderLayerView } from './frame.ts';
import { NBSP, breakableValue, visibleText } from './format.ts';
import { glueUnits, trafficBreakable } from './traffic-format.ts';
import { buildRouteView, sortRoadEvents, type RouteViewInput } from './route.ts';

const open = (_: string, d: boolean): boolean => d;
const input = (over: Partial<RouteViewInput> = {}): RouteViewInput => ({
  national: roadNationalFixture(), nationalError: null, urban: roadUrbanFixture(), urbanError: null, canFocus: true, now: TRAFFIC_NOW, open, ...over,
});
const view = (over: Partial<RouteViewInput> = {}) => buildRouteView(input(over));
const html = (over: Partial<RouteViewInput> = {}): string => renderLayerView('trafficRoad', view(over));
const sectionOf = (id: string, over: Partial<RouteViewInput> = {}) => view(over).sections.find((s) => s.id === id);
function withNational(edit: (n: RoadNationalResponse) => void): RoadNationalResponse {
  const n = roadNationalFixture();
  edit(n);
  return n;
}

describe('vue Trafic routier (spec 2026-10-03 trafics § 3.1)', () => {
  it('en-tête du 03/10 : 64 incidents en jaune, pastille Jaune (4 accidents, 1 coupure), sources datées, synthèse', () => {
    const v = view();
    expect(roadLevel(roadNationalFixture()).level).toBe('jaune');
    expect(v.head).toMatchObject({ theme: 'Trafics', title: 'Trafic routier', level: 'jaune' });
    expect(v.head.figure).toEqual({
      value: '64', caption: 'incidents en cours sur le réseau national non concédé · dont 4 accidents · DIR, 14:57', level: undefined,
    });
    expect(v.head.status).toEqual([glueUnits(roadLevel(roadNationalFixture()).reason), 'DIR\u00A014:57 · TomTom\u00A015:00']);
    expect(v.head.lead).toBe(`4 accidents en cours, le plus récent à 14:44 (A55). A63 coupée (Cestas à Pessac) depuis 09:25. Paris : 169,5${NBSP}km de bouchons.`);
    expect(html()).toContain('<b class="fmk-num lp-lvl lp-lvl--jaune">64</b>');
    expect(html()).toContain('fm-vig--jaune');
  });
  it('sections, ordre et ouverture ; « Méthode et sources » en ton de référence', () => {
    expect(view().sections.map((s) => [s.id, s.open ?? false])).toEqual([
      ['events', true], ['dirs', true], ['agglos', true], ['conceded', true], ['speeds', false], ['longterm', false], ['method', false],
    ]);
    expect(view().sections.at(-1)?.tone).toBe('reference');
  });
  it('événements en cours : accidents, bouchon, coupure, obstacles ; dix puis « n autres » ; puces de la maquette ; clic vers la carte', () => {
    const s = sectionOf('events');
    expect(s?.summary).toBe('4 accidents · 1 bouchon · 1 coupure');
    const h = s?.html ?? '';
    expect(h.match(/class="lp-row/g)).toHaveLength(10);
    const order = ['A55, Les Pennes-Mirabeau', 'A86, Colombes', 'N10, Saint-Yrieix-sur-Charente', 'N10, Vignolles', 'Bouchon · A7, Saint-Fons',
      'Route coupée · A63, Cestas à Pessac', 'Gravillons · Flumet (Savoie)'];
    const at = order.map((t) => h.indexOf(t));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(h).toContain('<div class="lp-row is-link" tabindex="0" role="button" data-road-event="acc-a55"><span class="fmk-dot fmk-dot--rouge" aria-hidden="true"></span>'
      + '<span>Accident · A55, Les Pennes-Mirabeau</span><span class="lp-val fmk-num">14:44</span><small>vers Marseille · DIR Méditerranée</small></div>');
    expect(h).toContain('<small>bande d’arrêt et chaussée entière · vers Bordeaux · gravité élevée · DIR Atlantique</small>');
    expect(h).toMatch(/fmk-dot--orange[^]*Route coupée · A63, Cestas à Pessac[^]*<small>vers Bordeaux · sans fin déclarée · DIR Atlantique<\/small>/);
    expect(h).toMatch(/fmk-dot--jaune[^]*Gravillons · Flumet \(Savoie\)[^]*14:15[^]*après trois accidents · DIR Centre-Est/);
    expect(visibleText(h)).toContain('55 autres : véhicule en panne (37), obstacle (12), personnes sur la chaussée (3), objet sur la chaussée (2)….');
    expect(visibleText(h)).toContain(`démarré depuis moins de 24${NBSP}h`);
  });
  it('carte SVG du mobile : lignes non cliquables', () => {
    expect(sectionOf('events', { canFocus: false })?.html).not.toContain('data-road-event');
  });
  it('tri des événements : nature puis plus récent d’abord', () => {
    const sorted = sortRoadEvents(roadNationalFixture().events);
    expect(sorted.slice(0, 7).map((e) => e.id)).toEqual(['acc-a55', 'acc-a86', 'acc-n10-yrieix', 'acc-n10-vignolles', 'queue-a7', 'closure-a63', 'gravel-flumet']);
  });
  it('par direction des routes : six jauges colorées par le nombre d’incidents, puis le reste résumé', () => {
    const s = sectionOf('dirs');
    expect(s?.summary).toBe('DIR Méditerranée 21');
    const h = s?.html ?? '';
    expect(h.match(/class="lp-bar-row"/g)).toHaveLength(6);
    expect(h).toContain('<span class="lp-bar-label">DIR Méditerranée</span><span class="fmk-bar"><i style="width:100%;background:var(--sev-orange)"></i></span><span class="lp-val fmk-num">21</span>');
    expect(h).toContain('<span class="lp-bar-label">DIR Centre-Est</span><span class="fmk-bar"><i style="width:52.4%;background:var(--sev-yellow)"></i></span>');
    expect(h).toContain('<span class="lp-bar-label">DIR Atlantique</span><span class="fmk-bar"><i style="width:19%;background:var(--sev-green)"></i></span>');
    expect(visibleText(h)).toContain('7 autres DIR : 2 incidents ou moins.');
  });
  it('agglomérations : bouchons et retard TomTom, part saturée officielle (rouge dès 5 %), n.d. hors couverture', () => {
    const s = sectionOf('agglos');
    expect(s?.summary).toBe(`Paris 169,5${NBSP}km de bouchons`);
    const h = s?.html ?? '';
    expect(h).toContain(`<tr><th scope="row">Paris</th><td><b class="lp-val fmk-num">169,5${NBSP}km</b></td><td><span class="lp-val fmk-num">1\u202F193${NBSP}min</span></td><td class="lp-faint">n.d.</td></tr>`);
    expect(h).toContain(`<tr><th scope="row">Lyon</th><td><span class="lp-val fmk-num">11,7${NBSP}km</span></td><td><span class="lp-val fmk-num">83${NBSP}min</span></td><td><span class="lp-val fmk-num">0,4${NBSP}%</span></td></tr>`);
    expect(h).toContain(`<tr><th scope="row">Marseille</th><td class="lp-faint">n.d.</td><td class="lp-faint">n.d.</td><td><span class="lp-val fmk-num lp-lvl lp-lvl--rouge">7${NBSP}%</span></td></tr>`);
    expect(h).toContain(`<th scope="row">Limoges</th><td class="lp-faint">n.d.</td><td class="lp-faint">n.d.</td><td><span class="lp-val fmk-num lp-lvl lp-lvl--rouge">11${NBSP}%</span></td>`);
    expect(h.indexOf('>Lyon<')).toBeLessThan(h.indexOf('>Limoges<'));
    expect(h.indexOf('>Limoges<')).toBeLessThan(h.indexOf('>Marseille<'));
    expect(visibleText(h)).toContain('embouteillages seulement (jamais les routes fermées)');
    expect(visibleText(h)).toContain(`de 7${NBSP}h à 21${NBSP}h`);
  });
  it('autoroutes concédées : bouchons du CNIR par importance, le reste résumé avec les gestionnaires', () => {
    const s = sectionOf('conceded');
    expect(s?.summary).toBe(`8 bouchons · A8 4,5${NBSP}km`);
    const h = s?.html ?? '';
    expect(h).toContain(`<span class="fmk-dot fmk-dot--orange" aria-hidden="true"></span><span>A8, Italie vers Aix-en-Provence</span><span class="lp-val fmk-num">4,5${NBSP}km</span><small>Escota</small>`);
    expect(h.match(/class="lp-row"/g)).toHaveLength(5);
    expect(visibleText(h)).toContain('3 autres bouchons (Escota, DIRCE Lyon et St Etienne) · récapitulatif national du CNIR, 14:57.');
  });
  it('vitesses mesurées : stations sous 50 km/h, médiane, les plus lentes colorées', () => {
    const s = sectionOf('speeds');
    expect(s?.summary).toBe(`19 stations sous 50${NBSP}km/h`);
    const h = s?.html ?? '';
    expect(h).toContain(`<span class="fmk-kv-k">Vitesse médiane nationale</span><span class="fmk-kv-v fmk-num"><span class="lp-val fmk-num">89${NBSP}km/h</span></span>`);
    expect(h).toMatch(new RegExp(`fmk-dot--rouge[^]*DIR Sud-Ouest, A620[^]*14${NBSP}km/h[^]*1\u202F320 véhicules par heure`));
    expect(visibleText(h)).toContain('Mesure de 15:00');
  });
  it('fermetures et chantiers de longue durée : coupures d’abord, dates de début et de fin prévue', () => {
    const s = sectionOf('longterm');
    expect(s?.summary).toBe('6 fermetures et chantiers · tunnel du Puymorens');
    const h = s?.html ?? '';
    expect(h).toContain('<span>Route coupée · N320, tunnel du Puymorens</span><span class="lp-val fmk-num">01/06</span><small>du 01/06/2026 au 29/10/2026 · planifié · DIR Sud-Ouest</small>');
    expect(h).toContain('<span>Éboulement · N20, Mérens-les-Vals</span><span class="lp-val fmk-num">31/01</span><small>depuis le 31/01/2026, sans fin déclarée · démarré depuis plus de 24');
    expect(h.indexOf('tunnel du Puymorens')).toBeLessThan(h.indexOf('Mérens-les-Vals'));
  });
  it('méthode et sources : cinq sources datées, périmètres, règle de la pastille, retards, couleurs', () => {
    const s = sectionOf('method');
    expect(s?.summary).toBe('5 sources');
    const t = visibleText(s?.html ?? '');
    for (const part of ['publication de 14:57', 'mesure de 15:00', 'fichiers de 15:06', 'récapitulatif de 14:57', 'collecte de 15:00',
      '588 appels sur 2\u202F500', 'réseau routier national non concédé', '2 agglomérations (TomTom', 'Jamais une couverture France entière',
      'les accidents ne dépassent jamais le jaune', 'au moins 5 coupures non planifiées', `au-delà de 30${NBSP}min après leur publication`,
      'jaune dès 7, orange dès 20, rouge dès 40', 'sections Traficolor géolocalisées']) expect(t).toContain(part);
  });
  it('en retard (DIR publié il y a plus de 30 min) : pastille n.d., « (en retard) », aucune couleur, pas de jauge', () => {
    const now = Date.parse('2026-10-03T13:40:00Z');
    const v = view({ now });
    expect(v.head.level).toBe('nd');
    expect(v.head.figure?.level).toBeNull();
    expect(v.head.figure?.caption).toBe('incidents en cours sur le réseau national non concédé · dont 4 accidents · DIR, 14:57 (en retard)');
    expect(v.head.status[0]).toBe('niveau suspendu : données DIR en retard');
    expect(v.head.lead).toBeNull();
    const h = renderLayerView('trafficRoad', v);
    expect(h).toContain('fm-vig--nd');
    expect(h).not.toMatch(/fm-vig--(?:rouge|orange|jaune|vert)|lp-figure"><b class="fmk-num lp-lvl/);
    for (const id of ['events', 'dirs', 'speeds']) {
      expect(v.sections.find((s) => s.id === id)?.html).not.toMatch(/lp-lvl--|fmk-dot--(?:rouge|orange|jaune|vert)|class="fmk-bar"><i/);
    }
    // Traficolor (fichiers de 15:06) en retard à 15:40 : part saturée sans couleur. Le CNIR (14:57, tolérance 2 h) reste à l'heure.
    expect(v.sections.find((s) => s.id === 'agglos')?.html).not.toContain('lp-lvl--rouge');
    expect(v.sections.find((s) => s.id === 'conceded')?.html).toContain('fmk-dot--orange');
  });
  it('panne partielle : CNIR et vitesses non lus, erreurs nommées ; jamais « aucun bouchon »', () => {
    const national = withNational((n) => {
      n.conceded = { at: null, jams: [] };
      n.speeds = { at: null, stations: 0, under50: 0, median: null, slowest: [] };
      n.errors = ['CNIR : HTTP 503', 'QTV : HTTP 500'];
    });
    const v = view({ national });
    expect(v.sections.find((s) => s.id === 'conceded')?.html).toContain('Source indisponible : récapitulatif national du CNIR (autoroutes concédées).');
    expect(v.sections.find((s) => s.id === 'speeds')?.html).toContain('Source indisponible : vitesses des stations QTV des DIR.');
    expect(visibleText(renderLayerView('trafficRoad', v))).not.toMatch(/Aucun bouchon/);
    expect(visibleText(v.sections.find((s) => s.id === 'method')?.html ?? '')).toContain('Incidents de lecture : CNIR : HTTP 503 ; QTV : HTTP 500.');
    const empty = view({ national: withNational((n) => { n.events = []; n.errors = ['DIR : HTTP 502']; }) });
    expect(empty.sections[0].html).toContain('Source indisponible : événements des DIR.');
  });
  it('TomTom en panne : colonnes n.d., partie nommée, le reste affiché', () => {
    const v = view({ urban: null, urbanError: 'HTTP 502' });
    const h = v.sections.find((s) => s.id === 'agglos')?.html ?? '';
    expect(h).toContain('Source indisponible : collecte TomTom des agglomérations.');
    expect(h).toContain(`<th scope="row">Marseille</th><td class="lp-faint">n.d.</td><td class="lp-faint">n.d.</td><td><span class="lp-val fmk-num lp-lvl lp-lvl--rouge">7${NBSP}%</span></td>`);
    expect(v.head.status[1]).toBe('DIR\u00A014:57 · TomTom injoignable');
  });
  it('erreur sans donnée, erreur avec données, vide, chargement : jamais une liste vide silencieuse', () => {
    const failed = view({ national: null, nationalError: 'HTTP 500' });
    expect(failed.head).toMatchObject({ level: 'nd', figure: { value: 'n.d.' } });
    expect(failed.head.status[0]).toBe('DIR injoignable');
    expect(failed.bodyHtml).toContain('Source injoignable. Aucune donnée reçue.');
    expect(failed.sections.find((s) => s.id === 'events')?.html).toContain('Source indisponible : événements des DIR.');
    expect(view({ nationalError: 'HTTP 500' }).bodyHtml).toContain('Source injoignable. Dernières données : 14:57.');
    const calm = view({ national: withNational((n) => { n.events = []; n.counts = { ...n.counts, incidents: 0, accidents: 0 }; }) });
    expect(calm.sections[0].html).toContain('Aucun événement en cours sur le réseau national non concédé (les autoroutes concédées sont suivies à part).');
    expect(view({ national: null }).bodyHtml).toContain('Chargement des données…');
  });
  it('textes hostiles échappés ; R1 ; aucun tiret cadratin, aucune police à chasse fixe, aucune couleur brute', () => {
    const national = withNational((n) => {
      n.events[0].place = '<img src=x onerror=1>';
      n.events[0].detail = '<script>x</script>';
      n.conceded.jams[0].operator = '<b>op</b>';
      n.longTerm[0].place = '"><svg onload=1>';
    });
    const h = html({ national });
    expect(h).not.toMatch(/<img|<script|<svg onload|<b>op/);
    expect(h).toContain('&lt;img src=x onerror=1&gt;');
    expect(h).toContain('&lt;svg onload=1&gt;');
    expect(h).toContain('&lt;b&gt;op&lt;/b&gt;');
    for (const over of [{}, { now: Date.parse('2026-10-03T13:40:00Z') }, { urban: null, urbanError: 'HTTP 502' }]) {
      const all = html(over);
      const text = visibleText(all);
      expect(breakableValue(text)).toBeNull();
      expect(trafficBreakable(text)).toBeNull();
      expect(all).not.toMatch(/\u2014|&mdash;|monospace|#[0-9a-fA-F]{6}\b|rgba?\(/);
    }
  });
  it('périmètre DIR dit partout : réseau non concédé, jamais « aucun accident » sur les concessions', () => {
    const calm = view({ national: withNational((n) => { n.events = []; n.counts = { ...n.counts, incidents: 0, accidents: 0 }; }) });
    expect(calm.head.lead).toContain('Aucun accident en cours sur le réseau national non concédé (les autoroutes concédées sont suivies à part).');
    expect(visibleText(calm.sections[0].html)).toContain('réseau national non concédé');
    expect(view().head.figure?.caption).toContain('réseau national non concédé');
    expect(visibleText(sectionOf('events')?.html ?? '')).toContain('autoroutes concédées sont suivies à part, par les bouchons du CNIR');
  });
  it('Traficolor seul en panne : nommé dans Agglomérations, jamais « la source ne couvre pas » ; le reste reste', () => {
    const national = withNational((n) => { n.agglos = []; n.errors = ['Traficolor : HTTP 500']; });
    const v = view({ national });
    const h = v.sections.find((s) => s.id === 'agglos')?.html ?? '';
    expect(h).toContain('Source indisponible : niveaux Traficolor des DIR.');
    expect(visibleText(h)).not.toContain('ne couvre pas');
    expect(h).toContain('169,5');
    expect(v.sections.find((s) => s.id === 'speeds')?.html).toContain('89');
    const m = sectionOf('method', { national });
    expect(visibleText(m?.html ?? '')).toContain('source indisponible');
    expect(m?.summary).toBe('5 sources · 1 indisponible');
  });
  it('QTV seul en panne : nommé dans Vitesses et dans Méthode ; les autres parties restent', () => {
    const national = withNational((n) => { n.speeds = { at: null, stations: 0, under50: 0, median: null, slowest: [] }; n.errors = ['QTV : HTTP 500']; });
    const v = view({ national });
    expect(v.sections.find((s) => s.id === 'speeds')?.html).toContain('Source indisponible : vitesses des stations QTV des DIR.');
    expect(v.sections.find((s) => s.id === 'agglos')?.html).not.toContain('Source indisponible');
    expect(v.sections.find((s) => s.id === 'conceded')?.html).toContain('A8, Italie');
    const m = v.sections.find((s) => s.id === 'method');
    expect(visibleText(m?.html ?? '')).toContain('Vitesses');
    expect(visibleText(m?.html ?? '')).toContain('source indisponible');
    expect(m?.summary).toBe('5 sources · 1 indisponible');
  });
  it('période réelle de chaque partie (T1, S1) : jamais « temps réel »', () => {
    const t = visibleText(html()).toLowerCase();
    expect(t).not.toContain('temps réel');
    expect(t).toContain('dir\u00A014:57');
    expect(t).toContain('tomtom\u00A015:00');
    expect(sectionOf('agglos')?.html).toContain(`fichiers de ${'15:06'}`);
  });
});
