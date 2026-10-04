// src/components/layer-panel/secheresse.test.ts
import { describe, expect, it } from 'vitest';
import type { DroughtResponse } from '../../types/index.ts';
import { droughtLevel } from '../../services/environment-levels.ts';
import { DROUGHT_FIXTURE, ENV_FIXTURE_NOW } from './environment.fixture.ts';
import { renderLayerView } from './frame.ts';
import { NBSP, breakableValue, visibleText } from './format.ts';
import { envBreakable } from './environment-format.ts';
import { buildSecheresseView, sortDroughtDepartments, type SecheresseViewInput } from './secheresse.ts';

const open = (_: string, d: boolean): boolean => d;
const input = (over: Partial<SecheresseViewInput> = {}): SecheresseViewInput => ({
  drought: structuredClone(DROUGHT_FIXTURE), droughtError: null, canFocus: true, now: ENV_FIXTURE_NOW, open, ...over,
});
const view = (over: Partial<SecheresseViewInput> = {}) => buildSecheresseView(input(over));
const html = (over: Partial<SecheresseViewInput> = {}): string => renderLayerView('drought', view(over));
const section = (id: string, over: Partial<SecheresseViewInput> = {}) => view(over).sections.find((s) => s.id === id);
function withDrought(edit: (d: DroughtResponse) => void): DroughtResponse {
  const d = structuredClone(DROUGHT_FIXTURE);
  edit(d);
  return d;
}
const LATE = Date.parse('2026-10-05T13:00:00Z');

describe('vue Sécheresse (spec 2026-10-04 environnement § 3.1)', () => {
  it('en-tête du 04/10 : 79 départements en crise en rouge, pastille Rouge, arrêtés datés, synthèse', () => {
    const v = view();
    expect(droughtLevel(DROUGHT_FIXTURE).level).toBe('rouge');
    expect(v.head).toMatchObject({ theme: 'Environnement', title: 'Sécheresse', level: 'rouge' });
    expect(v.head.figure).toEqual({ value: '79', caption: 'départements en crise · arrêtés en vigueur au 4 octobre 02:43', level: 'rouge' });
    expect(v.head.status).toEqual([`79${NBSP}départements en crise`, `VigiEau${NBSP}02:43`]);
    expect(v.head.lead).toBe('79 départements en crise, 14 en alerte renforcée, 3 en alerte, 3 en vigilance. Eau potable : 70 départements en crise.');
    expect(html()).toContain('<b class="fmk-num lp-lvl lp-lvl--rouge">79</b>');
    expect(html()).toContain('fm-vig--rouge');
  });
  it('sections, ordre et ouverture ; « Méthode et sources » en ton de référence', () => {
    expect(view().sections.map((s) => [s.id, s.open ?? false])).toEqual([['niveaux', true], ['eau-potable', false], ['departements', false], ['methode', false]]);
    expect(view().sections.at(-1)?.tone).toBe('reference');
  });
  it('par niveau : jauges colorées (vigilance en teinte de catégorie), part des 99 départements publiés ; donnée indisponible à part (amendement 15) ; courbe quotidienne, référence en construction', () => {
    const s = section('niveaux');
    expect(s?.summary).toBe('79 en crise');
    const h = s?.html ?? '';
    expect(h).toContain('<span class="lp-bar-label">Crise</span><span class="fmk-bar"><i style="width:79.8%;background:var(--sev-red)"></i></span><span class="lp-val fmk-num">79</span>');
    expect(h).toContain('<span class="lp-bar-label">Alerte renforcée</span><span class="fmk-bar"><i style="width:14.1%;background:var(--sev-orange)"></i></span><span class="lp-val fmk-num">14</span>');
    expect(h).toContain('<span class="lp-bar-label">Alerte</span><span class="fmk-bar"><i style="width:3%;background:var(--sev-yellow)"></i></span><span class="lp-val fmk-num">3</span>');
    expect(h).toContain('<span class="lp-swatch" style="background:var(--cat-secheresse-vigilance)" aria-hidden="true"></span><span class="lp-bar-label">Vigilance</span>');
    expect(h).toContain('<span class="lp-bar-label">Aucun arrêté</span><span class="fmk-bar"><i style="width:0%;background:var(--sev-green)"></i></span><span class="lp-val fmk-num">0</span>');
    // Amendement 15 : Guyane et Mayotte (« unavailable ») hors de la répartition, en gris, jamais « aucun arrêté ».
    expect(h).toContain('<div class="lp-row"><span class="fmk-dot" aria-hidden="true"></span><span>Donnée indisponible</span><span class="lp-val fmk-num">2</span><small>Guyane, Mayotte</small></div>');
    expect(visibleText(h)).toContain('sans donnée (« unavailable »), hors répartition');
    expect(h).toMatch(/<svg[^>]*aria-label="Départements par niveau de restriction, par jour"/);
    expect(visibleText(h)).toContain('référence en construction (1 jour), série quotidienne relevée par le serveur depuis le 04/10/2026');
  });
  it('série de 30 jours ou plus : plus de mention « référence en construction »', () => {
    const drought = withDrought((d) => {
      d.history.days = Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, vigilance: 3, alerte: 3, alerte_renforcee: 14, crise: 79 }));
      d.history.since = '2026-09-01';
    });
    expect(visibleText(section('niveaux', { drought })?.html ?? '')).not.toContain('référence en construction');
  });
  it('eau potable : comptes par niveau, départements en crise nommés (douze puis le reste)', () => {
    const s = section('eau-potable');
    expect(s?.summary).toBe('70 en crise');
    const h = s?.html ?? '';
    expect(h).toContain('<span class="fmk-dot fmk-dot--rouge" aria-hidden="true"></span><span>Crise</span><span class="lp-val fmk-num">70</span>');
    expect(h).toContain('<span class="fmk-dot fmk-dot--orange" aria-hidden="true"></span><span>Alerte renforcée</span><span class="lp-val fmk-num">17</span>');
    expect(visibleText(h)).toContain('En crise pour l’eau potable : Ain, Allier, Alpes-de-Haute-Provence, Alpes-Maritimes, Ardèche, Ardennes, Ariège, Aube, Aude, Aveyron, Calvados, Cantal et 58 autres.');
    expect(visibleText(h)).toContain('la vigilance n’est pas une restriction');
  });
  it('départements : triés par niveau puis code, usages et région en sous-ligne, clic vers la carte (métropole seulement)', () => {
    const sorted = sortDroughtDepartments(DROUGHT_FIXTURE.departments);
    expect(sorted.slice(0, 3).map((d) => d.dept)).toEqual(['01', '03', '04']);
    expect(sorted.at(-1)?.dept).toBe('976');
    const s = section('departements');
    expect(s?.summary).toBe('101 départements');
    const h = s?.html ?? '';
    expect(h).toContain('<div class="lp-row is-link" tabindex="0" role="button" data-dept="01"><span class="fmk-dot fmk-dot--rouge" aria-hidden="true"></span><span>Ain (01)</span>'
      + '<span class="lp-val fmk-num">crise</span><small>eaux superficielles crise · eaux souterraines crise · eau potable crise · Auvergne-Rhône-Alpes</small></div>');
    expect(h).toContain('<span>Charente (16)</span><span class="lp-val fmk-num">crise</span><small>eaux superficielles crise · eaux souterraines aucun arrêté · eau potable alerte · Nouvelle-Aquitaine</small>');
    expect(h).toContain('<span class="lp-swatch" style="background:var(--cat-secheresse-vigilance)" aria-hidden="true"></span><span>Paris (75)</span>');
    expect(h).toContain('<div class="lp-row"><span class="fmk-dot" aria-hidden="true"></span><span>Guyane (973)</span><span class="lp-val fmk-num">donnée indisponible</span><small>VigiEau ne publie pas ses arrêtés (« unavailable ») · Guyane</small></div>');
    expect(h).not.toMatch(/(?:Guyane \(973\)|Mayotte \(976\))<\/span><span class="lp-val fmk-num">aucun arrêté/);
    expect(h).not.toContain('data-dept="971"');
    expect(section('departements', { canFocus: false })?.html).not.toContain('data-dept');
  });
  it('méthode et sources : stock hors score (E2), règle de pastille, teinte de la vigilance, périmètre, retard, relève', () => {
    const s = section('methode');
    expect(s?.summary).toBe('VigiEau');
    const t = visibleText(s?.html ?? '');
    for (const part of ['en vigueur au 4 octobre 02:43', 'Un stock, pas un événement', 'n’entre ni dans le score France ni dans une situation',
      'rouge si au moins un département est en crise', 'teinte bleue de catégorie', '101 départements', 'donnée indisponible (« unavailable », jamais lue comme « aucun arrêté ») : Guyane, Mayotte',
      `36${NBSP}h`, `toutes les 6${NBSP}h`]) expect(t).toContain(part);
  });
  it('en retard (arrêtés de plus de 36 h) : pastille n.d., « (en retard) », aucune couleur, aucune jauge', () => {
    const v = view({ now: LATE });
    expect(v.head.level).toBe('nd');
    expect(v.head.figure).toEqual({ value: '79', caption: 'départements en crise · arrêtés en vigueur au 4 octobre 02:43 (en retard)', level: null });
    expect(v.head.status).toEqual(['niveau suspendu : arrêtés VigiEau en retard', `VigiEau${NBSP}04/10${NBSP}02:43${NBSP}(en retard)`]);
    expect(v.head.lead).toBeNull();
    const h = renderLayerView('drought', v);
    expect(h).toContain('fm-vig--nd');
    for (const id of ['niveaux', 'eau-potable', 'departements']) {
      expect(v.sections.find((s) => s.id === id)?.html).not.toMatch(/lp-lvl--|fmk-dot--(?:rouge|orange|jaune|vert)|class="fmk-bar"><i|--cat-secheresse-vigilance/);
    }
  });
  it('erreur sans donnée, erreur avec données, chargement, vide : jamais une liste vide silencieuse', () => {
    const failed = view({ drought: null, droughtError: 'HTTP 502' });
    expect(failed.head).toMatchObject({ level: 'nd', figure: { value: 'n.d.' }, status: ['VigiEau injoignable'] });
    expect(failed.bodyHtml).toContain('Source injoignable. Aucune donnée reçue.');
    expect(failed.sections.find((s) => s.id === 'niveaux')?.html).toContain('Source indisponible : arrêtés VigiEau.');
    expect(view({ droughtError: 'HTTP 502' }).bodyHtml).toContain('Source injoignable. Dernières données : 02:43.');
    expect(view({ drought: null }).bodyHtml).toContain('Chargement des données…');
    const empty = view({ drought: withDrought((d) => { d.departments = []; d.counts = { vigilance: 0, alerte: 0, alerte_renforcee: 0, crise: 0, aucun: 0 }; d.errors = ['VigiEau : HTTP 503']; }) });
    expect(empty.head.level).toBe('nd');
    expect(empty.sections.find((s) => s.id === 'departements')?.html).toContain('Source indisponible : arrêtés VigiEau.');
    expect(visibleText(empty.sections.find((s) => s.id === 'methode')?.html ?? '')).toContain('Incidents de lecture : VigiEau : HTTP 503.');
  });
  it('textes hostiles échappés ; R1 ; aucun tiret cadratin, aucune police à chasse fixe, aucune couleur brute ; jamais « temps réel »', () => {
    const drought = withDrought((d) => { d.departments[0].name = '<img src=x onerror=1>'; d.departments[0].region = '<script>x</script>'; });
    const h = html({ drought });
    expect(h).not.toMatch(/<img|<script/);
    expect(h).toContain('&lt;img src=x onerror=1&gt;');
    for (const over of [{}, { now: LATE }, { drought: null, droughtError: 'HTTP 502' }]) {
      const all = html(over);
      const text = visibleText(all);
      expect(breakableValue(text)).toBeNull();
      expect(envBreakable(text)).toBeNull();
      expect(all).not.toMatch(/\u2014|&mdash;|monospace|#[0-9a-fA-F]{6}\b|rgba?\(/);
      expect(text.toLowerCase()).not.toContain('temps réel');
    }
  });
});
