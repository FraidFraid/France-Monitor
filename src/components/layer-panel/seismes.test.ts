import { describe, expect, it } from 'vitest';
import type { EarthquakesResponse, Quake } from '../../types/index.ts';
import { fmIcon } from '../shared/icons.ts';
import { ENV_FIXTURE_NOW, QUAKES_FIXTURE } from './environment.fixture.ts';
import { renderLayerView } from './frame.ts';
import { NBSP, breakableValue, visibleText } from './format.ts';
import { envBreakable } from './environment-format.ts';
import { buildSeismesView, quakeRowLevel, type SeismesViewInput } from './seismes.ts';

const open = (_: string, d: boolean): boolean => d;
const input = (over: Partial<SeismesViewInput> = {}): SeismesViewInput => ({
  quakes: structuredClone(QUAKES_FIXTURE), quakesError: null, canFocus: true, now: ENV_FIXTURE_NOW, open, ...over,
});
const view = (over: Partial<SeismesViewInput> = {}) => buildSeismesView(input(over));
const html = (over: Partial<SeismesViewInput> = {}): string => renderLayerView('earthquakes', view(over));
const section = (id: string, over: Partial<SeismesViewInput> = {}) => view(over).sections.find((s) => s.id === id);
function withQuakes(edit: (q: EarthquakesResponse) => void): EarthquakesResponse {
  const q = structuredClone(QUAKES_FIXTURE);
  edit(q);
  return q;
}
function strong(magnitude: number, over: Partial<Quake> = {}): Quake {
  return {
    id: `fort-${magnitude}`, at: '2026-10-04T03:10:00.000Z', lat: 44.56, lon: 6.08, depthKm: 7, magnitude, magType: 'MLv', type: 'earthquake',
    description: `Tremblement de terre de magnitude ${magnitude}, proche de Gap`, status: 'automatique', url: null, dept: '05', distanceKm: 0, inFrance: true,
    source: 'BCSF-RéNaSS', ...over,
  };
}

describe('vue Séismes (spec 2026-10-04 environnement § 3.3, amendement 2)', () => {
  it('en-tête du 04/10 : 0 séisme de magnitude 3 ou plus en France sur 7 jours, en vert ; pastille Verte (72 h) ; relevé daté ; synthèse', () => {
    const v = view();
    expect(v.head).toMatchObject({ theme: 'Environnement', title: 'Séismes', level: 'vert' });
    expect(v.head.figure).toEqual({ value: '0', caption: `séismes de magnitude 3 ou plus en France sur 7${NBSP}jours · BCSF-RéNaSS, 10:05`, level: 'vert' });
    expect(v.head.status).toEqual([`aucun séisme de magnitude 3 ou plus en France sur 72${NBSP}h`, `BCSF-RéNaSS${NBSP}10:05`]);
    expect(v.head.lead).toBe(`Le plus fort en France sur 7${NBSP}jours : magnitude 2,5 proche de Albertville (Savoie), 30/09 19:01. 7 séismes en France, dont 1 de magnitude 2,5 ou plus.`);
  });
  it('sections, ordre et ouverture', () => {
    expect(view().sections.map((s) => [s.id, s.open ?? false])).toEqual([['derniers', true], ['methode', false]]);
  });
  it('derniers séismes : plus récent d’abord ; sous 2,5 en gris et en clair ; 2,5 en vert ; hors de France en gris avec la distance ; clic vers la carte', () => {
    const s = section('derniers');
    expect(s?.summary).toBe(`7 en France · max M${NBSP}2,5`);
    const h = s?.html ?? '';
    expect(h.match(/class="lp-row/g)).toHaveLength(8);
    expect(h).toContain(`<div class="lp-row is-link" tabindex="0" role="button" data-quake="fr2026utlsew"><span class="fmk-dot" aria-hidden="true"></span><span>Proche de Gap (Hautes-Alpes)</span>`
      + `<span class="lp-val fmk-num lp-faint">M${NBSP}1,0</span><small>08:16 · profondeur 5${NBSP}km · automatique</small></div>`);
    expect(h).toContain(`<span class="fmk-dot fmk-dot--vert" aria-hidden="true"></span><span>Proche de Albertville (Savoie)</span><span class="lp-val fmk-num">M${NBSP}2,5</span>`
      + `<small>30/09 19:01 · profondeur 9${NBSP}km · revu</small>`);
    expect(h).toContain(`<span>Proche de Aosta</span><span class="lp-val fmk-num lp-faint">M${NBSP}1,5</span><small>05:51 · profondeur 5${NBSP}km · automatique · hors de France, à 3${NBSP}km de la frontière</small>`);
    expect(h.indexOf('fr2026utlsew')).toBeLessThan(h.indexOf('fr2026usdzpp'));
    expect(h).toMatch(/<svg[^>]*aria-label="Magnitude selon l’heure, 7 derniers jours"/);
    expect(h).toContain('var(--sev-green)');
    expect(section('derniers', { canFocus: false })?.html).not.toContain('data-quake');
  });
  it('couleurs d’une ligne : 5 rouge, 4 orange, 3 jaune, 2,5 vert, plus faible gris ; hors de France ou en retard gris', () => {
    expect([5.1, 4.3, 3, 2.5, 2.4].map((m) => quakeRowLevel(strong(m), false))).toEqual(['rouge', 'orange', 'jaune', 'vert', 'gris']);
    expect(quakeRowLevel(strong(4.3, { inFrance: false, dept: null, distanceKm: 3.2 }), false)).toBe('gris');
    expect(quakeRowLevel(strong(4.3), true)).toBe('gris');
  });
  it('séisme de magnitude 4,3 en France il y a 5 h : pastille Orange, gros chiffre 1 en orange, ligne orange ; en mer : distance aux côtes', () => {
    const quakes = withQuakes((q) => { q.quakes.unshift(strong(4.3)); q.quakes.push(strong(4.5, { id: 'mer', dept: null, distanceKm: 40.4, lat: 43, lon: 4.5, description: 'Golfe du Lion' })); });
    const v = view({ quakes });
    expect(v.head.level).toBe('orange');
    expect(v.head.figure).toMatchObject({ value: '2', level: 'orange' });
    expect(v.head.status[0]).toBe('séisme de magnitude 4,5 Golfe du Lion');
    const h = v.sections[0].html;
    expect(h).toContain(`<span class="fmk-dot fmk-dot--orange" aria-hidden="true"></span><span>Proche de Gap (Hautes-Alpes)</span><span class="lp-val fmk-num">M${NBSP}4,3</span>`);
    expect(h).toContain(`en mer, à 40${NBSP}km des côtes`);
    expect(view({ quakes: withQuakes((q) => { q.quakes.unshift(strong(5.1)); }) }).head.level).toBe('rouge');
  });
  it('méthode et sources : périmètre (amendement 2), événements non sismiques écartés, pastille, situation, retard, outre-mer hors champ', () => {
    const t = visibleText(section('methode')?.html ?? '');
    for (const part of ['épicentre sur le territoire métropolitain (Corse comprise) ou dans les eaux françaises', `à moins de 20${NBSP}km`, 'hors de France',
      `129 tirs de carrière, explosions et autres événements non sismiques écartés sur 7${NBSP}jours`, 'rouge dès magnitude 5', 'plafonne le score à 78',
      `30${NBSP}min`, 'outre-mer']) expect(t).toContain(part);
    expect(section('methode')?.summary).toBe('BCSF-RéNaSS');
  });
  it('repli EMSC : nommé dans le relevé et la méthode', () => {
    const quakes = withQuakes((q) => { q.source = 'EMSC'; q.errors = ['BCSF-RéNaSS : HTTP 500']; });
    const v = view({ quakes });
    expect(v.head.status[1]).toBe(`EMSC (repli)${NBSP}10:05`);
    expect(v.head.status[2]).toBe('BCSF-RéNaSS indisponible, repli EMSC');
    expect(visibleText(v.sections[1].html)).toContain('Incidents de lecture : BCSF-RéNaSS : HTTP 500.');
  });
  it('en retard (relevé de plus de 30 min) : n.d., « (en retard) », aucune couleur, points sans couleur de niveau', () => {
    const v = view({ now: Date.parse('2026-10-04T08:40:00Z') });
    expect(v.head.level).toBe('nd');
    expect(v.head.figure?.level).toBeNull();
    expect(v.head.status[0]).toBe('niveau suspendu : relevé des séismes en retard');
    expect(v.sections[0].html).not.toMatch(/lp-lvl--|fmk-dot--(?:rouge|orange|jaune|vert)|var\(--sev-/);
  });
  it('pannes : rien de lu, liste vide avec panne nommée (jamais « aucun séisme »), chargement', () => {
    const failed = view({ quakes: null, quakesError: 'HTTP 502' });
    expect(failed.head).toMatchObject({ level: 'nd', figure: { value: 'n.d.' }, status: ['BCSF-RéNaSS injoignable'] });
    expect(failed.sections[0].html).toContain('Source indisponible : BCSF-RéNaSS et EMSC.');
    const down = view({ quakes: { readAt: null, source: null, quakes: [], nonSeismic: 0, errors: ['BCSF-RéNaSS : HTTP 500', 'EMSC (repli) : HTTP 503'] } });
    expect(down.sections[0].html).toContain('Source indisponible : BCSF-RéNaSS et EMSC.');
    const calm = view({ quakes: withQuakes((q) => { q.quakes = []; }) });
    expect(calm.sections[0].html).toContain(`Aucun séisme enregistré en France ni à moins de 20${NBSP}km sur 7${NBSP}jours.`);
    expect(view({ quakes: null }).bodyHtml).toContain('Chargement des données…');
  });
  it('séisme hors de France (M 3,5 et M 4,8, Aoste à 1 km) : gris, « hors de France », ni pastille, ni gros chiffre, ni synthèse', () => {
    const base = view();
    for (const m of [3.5, 4.8]) {
      const quakes = withQuakes((q) => { q.quakes.unshift(strong(m, { id: `ao-${m}`, inFrance: false, dept: null, distanceKm: 1, lat: 45.7, lon: 7.3, description: 'Proche de Aosta' })); });
      const v = view({ quakes });
      expect(v.head.level).toBe(base.head.level);
      expect(v.head.figure).toEqual(base.head.figure);
      expect(v.head.status).toEqual(base.head.status);
      expect(v.head.lead).toBe(base.head.lead);
      expect(v.sections[0].summary).toBe(base.sections[0].summary);
      const row = v.sections[0].html.split('<div class="lp-row').find((r) => r.includes(`ao-${m}`)) ?? '';
      expect(row).toContain(`hors de France, à 1${NBSP}km de la frontière`);
      expect(row).toContain('lp-faint');
      expect(row).not.toMatch(/fmk-dot--/);
    }
  });
  it('liste vide en retard : phrase datée avec « (en retard) » et source nommée ; à jour : source nommée', () => {
    const empty = (over: Partial<EarthquakesResponse> = {}) => withQuakes((q) => { q.quakes = []; Object.assign(q, over); });
    const late = visibleText(section('derniers', { quakes: empty(), now: Date.parse('2026-10-04T08:40:00Z') })?.html ?? '');
    expect(late).toContain('Aucun séisme enregistré au dernier relevé du 04/10 10:05 (en retard), source BCSF-RéNaSS.');
    const emsc = visibleText(section('derniers', { quakes: empty({ source: 'EMSC' }) })?.html ?? '');
    expect(emsc).toContain('Source : EMSC (repli).');
  });
  it('un seul événement non sismique : singulier', () => {
    const t = visibleText(section('methode', { quakes: withQuakes((q) => { q.nonSeismic = 1; }) })?.html ?? '');
    expect(t).toContain(`1 tir de carrière ou explosion écarté sur 7${NBSP}jours`);
  });
  it('icône « activity » disponible', () => {
    expect(fmIcon('activity')).toContain('<svg');
  });
  it('textes hostiles échappés ; R1 ; aucun tiret cadratin, aucune police à chasse fixe, aucune couleur brute ; jamais « temps réel »', () => {
    const quakes = withQuakes((q) => { q.quakes[0].description = '<img src=x onerror=1> proche de <script>x</script>'; });
    const h = html({ quakes });
    expect(h).not.toMatch(/<img|<script/);
    expect(h).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(h).toContain(quakes.quakes[0].id);
    const hostile = withQuakes((q) => { q.quakes[0].status = '<b>x</b>' as Quake['status']; q.quakes[0].id = 'a"onclick="x'; });
    const hh = html({ quakes: hostile });
    expect(hh).not.toMatch(/<b>x|data-quake="a"onclick/);
    expect(hh).toContain('&lt;b&gt;x&lt;/b&gt;');
    for (const over of [{}, { now: Date.parse('2026-10-04T08:40:00Z') }, { quakes: null, quakesError: 'HTTP 502' }]) {
      const all = html(over);
      const text = visibleText(all);
      expect(breakableValue(text)).toBeNull();
      expect(envBreakable(text)).toBeNull();
      expect(all).not.toMatch(/\u2014|&mdash;|monospace|#[0-9a-fA-F]{6}\b|rgba?\(/);
      expect(text.toLowerCase()).not.toContain('temps réel');
    }
  });
});
