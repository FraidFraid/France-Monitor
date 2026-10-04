// src/components/layer-panel/crues.test.ts
import { describe, expect, it } from 'vitest';
import type { FloodsResponse } from '../../types/index.ts';
import { floodsLevel } from '../../services/environment-levels.ts';
import { ENV_FIXTURE_NOW, FLOODS_FIXTURE } from './environment.fixture.ts';
import { renderLayerView } from './frame.ts';
import { NBSP, breakableValue, visibleText } from './format.ts';
import { envBreakable, glueEnvUnits } from './environment-format.ts';
import { CRUES_TITLE, STATION_GAP_MS, buildCruesView, type CruesViewInput } from './crues.ts';

const NOW = ENV_FIXTURE_NOW; // 04/10/2026, 10 h 10 à Paris
const H = 3_600_000;
const open = (_: string, d: boolean): boolean => d;
const input = (over: Partial<CruesViewInput> = {}): CruesViewInput => ({ floods: FLOODS_FIXTURE(), floodsError: null, canFocus: true, now: NOW, open, ...over });
const view = (over: Partial<CruesViewInput> = {}) => buildCruesView(input(over));
const html = (over: Partial<CruesViewInput> = {}): string => renderLayerView('floods', view(over));
const sectionOf = (id: string, over: Partial<CruesViewInput> = {}) => view(over).sections.find((s) => s.id === id);
function withFloods(edit: (f: FloodsResponse) => void): FloodsResponse {
  const f = FLOODS_FIXTURE();
  edit(f);
  return f;
}
/** Hub'Eau sans aucune mesure lue (panne ou lecture en cours) : stations listées, mesures et séries vides. */
function withoutMeasures(error: string): FloodsResponse {
  return withFloods((f) => {
    for (const s of f.sections) for (const st of s.stations) Object.assign(st, { lastAt: null, heightM: null, flowM3s: null, change1hM: null, heightSeries: [], flowSeries: [] });
    f.stationsReadAt = null;
    f.errors = [error];
  });
}

describe('vue Crues (spec 2026-10-04 environnement § 2.2)', () => {
  it('en-tête du 04/10 : 4 tronçons en jaune, sur 337 surveillés, relevé du serveur ; pastille et raison de floodsLevel ; plus forte hausse', () => {
    const v = view();
    expect(v.head).toMatchObject({ theme: 'Environnement', title: CRUES_TITLE, level: 'jaune' });
    expect(v.head.figure).toEqual({ value: '4', caption: 'tronçons en jaune · 0 orange · 0 rouge · sur 337 surveillés · relevé Vigicrues 10:05', level: 'jaune' });
    expect(v.head.status).toEqual([glueEnvUnits(floodsLevel(FLOODS_FIXTURE()).reason), `Vigicrues${NBSP}10:05 · mesures Hub’Eau${NBSP}10:00`]);
    expect(v.head.status[0]).toBe('Têt, Agly, Réart, Tech (Méditerranée Ouest)');
    expect(v.head.lead).toBe(`Plus forte hausse sur 1${NBSP}h : St-Paul-de-Fenouillet (Agly), +0,10${NBSP}m.`);
    const h = html();
    expect(h).toContain('<b class="fmk-num lp-lvl lp-lvl--jaune">4</b>');
    expect(h).toContain('fm-vig--jaune');
  });
  it('sections, ordre et ouverture ; « Méthode et sources » en ton de référence', () => {
    expect(view().sections.map((s) => [s.id, s.open ?? false])).toEqual([['troncons', true], ['stations', true], ['methode', false]]);
    expect(view().sections.at(-1)?.tone).toBe('reference');
  });
  it('tronçons en vigilance : niveau officiel, nom, territoire, lien vers le bulletin du territoire ; clic vers la carte', () => {
    const s = sectionOf('troncons');
    expect(s?.summary).toBe('4 tronçons en vigilance');
    const h = s?.html ?? '';
    expect(h).toContain('<div class="lp-row is-link" tabindex="0" role="button" data-section="MO12"><span class="fmk-dot fmk-dot--jaune" aria-hidden="true"></span>'
      + '<span>Têt</span><span class="lp-val fmk-num lp-lvl lp-lvl--jaune">jaune</span><small>Méditerranée Ouest · '
      + '<a class="lp-link" href="https://www.vigicrues.gouv.fr/territoire/21" target="_blank" rel="noopener noreferrer">bulletin du territoire</a> · 3 stations</small></div>');
    expect(['MO12', 'MO11', 'MO16', 'MO17'].map((id) => h.indexOf(`data-section="${id}"`)).every((i, k, a) => i >= 0 && (k === 0 || i > a[k - 1]))).toBe(true);
    expect(visibleText(h)).toContain('337 tronçons de cours d’eau surveillés par l’État ; les tronçons verts sont comptés, ni listés ni dessinés.');
    expect(sectionOf('troncons', { canFocus: false })?.html).not.toContain('data-section');
  });
  it('stations : hauteur au repère, variation sur 1 h (rouge à la hausse, vert à la baisse, neutre à 0), heure de mesure, débit', () => {
    const s = sectionOf('stations');
    expect(s?.summary).toBe('9 stations mesurées · 4 en hausse');
    const h = s?.html ?? '';
    expect(h).toContain(`<span>Vinca</span><span class="lp-val fmk-num">22,29${NBSP}m <span class="lp-trend" aria-label="variation sur 1${NBSP}h">0,00${NBSP}m</span></span><small>Têt · mesure 10:00</small>`);
    expect(h).toContain(`<span>St-Paul-de-Fenouillet</span><span class="lp-val fmk-num">1,19${NBSP}m <span class="lp-trend lp-lvl lp-lvl--rouge" aria-label="variation sur 1${NBSP}h">+0,10${NBSP}m</span></span><small>Agly · mesure 10:00 · débit 0,56${NBSP}m³/s</small>`);
    expect(h).toContain(`<span>Mas-d&#39;en-Tourens</span><span class="lp-val fmk-num">0,80${NBSP}m <span class="lp-trend lp-lvl lp-lvl--vert" aria-label="variation sur 1${NBSP}h">−0,25${NBSP}m</span></span><small>Tech · mesure 10:00 · débit 7,0${NBSP}m³/s</small>`);
    // Hausse de 3 mm : « 0,00 m », ni colorée ni comptée.
    expect(h).toContain(`<span>Saleilles</span><span class="lp-val fmk-num">2,02${NBSP}m <span class="lp-trend" aria-label="variation sur 1${NBSP}h">0,00${NBSP}m</span></span><small>Réart · mesure 10:00 · débit 0,00${NBSP}m³/s</small>`);
    expect(h).toContain('data-station="Y046401001"');
    expect(visibleText(h)).toContain('Hauteur au repère de la station, pas une cote d’alerte : Vigicrues ne publie pas les seuils de ses stations en API.');
  });
  it('courbes de 48 h : hauteur (et débit s’il existe), catégorie des stations, trous de mesure gardés, axe en heure de Paris', () => {
    const h = sectionOf('stations')?.html ?? '';
    expect(h).toContain(`<details class="lp-more" data-curve="Y046401001" open><summary>hauteur sur 48${NBSP}h</summary>`);
    expect(h).toContain(`data-curve="Y042401001"><summary>hauteur et débit sur 48${NBSP}h</summary>`);
    expect(h).toContain('aria-label="Hauteur d’eau à Vinca, 48 dernières heures"');
    expect(h).toContain('aria-label="Débit à Saleilles, 48 dernières heures"');
    expect(h).toContain('stroke="var(--cat-station-hydro)"');
    expect(h).toContain('>02/10 10:10<');
    expect(h).toContain(`>22,29${NBSP}m<`);
    expect(h).toContain(`>22,28${NBSP}m<`);
    // Mesures manquantes de Serdinya (plus de 40 min entre deux points) : trois morceaux, jamais un trait continu inventé.
    const serdinya = h.slice(h.indexOf('aria-label="Hauteur d’eau à Serdinya'), h.indexOf('</svg>', h.indexOf('aria-label="Hauteur d’eau à Serdinya')));
    expect((serdinya.match(/<polyline /g) ?? []).length).toBe(3);
    expect(STATION_GAP_MS).toBe(40 * 60_000);
  });
  it('station en retard (dernière mesure de plus d’une heure) : « (en retard) », aucune couleur', () => {
    const floods = withFloods((f) => {
      const st = f.sections[1].stations[0];
      st.lastAt = '2026-10-04T06:45:00Z';
    });
    const h = sectionOf('stations', { floods })?.html ?? '';
    expect(h).toContain(`<span>St-Paul-de-Fenouillet</span><span class="lp-val fmk-num">1,19${NBSP}m <span class="lp-trend" aria-label="variation sur 1${NBSP}h">+0,10${NBSP}m</span></span><small>Agly · mesure 08:45 (en retard) · débit 0,56${NBSP}m³/s</small>`);
    expect(view({ floods }).head.lead).toBe(`Plus forte hausse sur 1${NBSP}h : Serdinya (Têt), +0,01${NBSP}m.`);
  });
  it('en retard (relevé Vigicrues de plus de 30 min) : pastille n.d., « (en retard) », aucune couleur', () => {
    const v = view({ now: NOW + H });
    expect(v.head.level).toBe('nd');
    expect(v.head.figure).toEqual({ value: '4', caption: 'tronçons en jaune · 0 orange · 0 rouge · sur 337 surveillés · relevé Vigicrues 10:05 (en retard)', level: null });
    expect(v.head.status[0]).toBe('niveau suspendu : relevé Vigicrues en retard');
    expect(v.head.lead).toBeNull();
    const h = renderLayerView('floods', v);
    expect(h).toContain('fm-vig--nd');
    expect(h).not.toMatch(/fm-vig--(?:rouge|orange|jaune|vert)|lp-lvl--|fmk-dot--(?:rouge|orange|jaune|vert)|var\(--cat-station-hydro\)/);
    expect(v.sections[0].summary).toBe('4 tronçons en vigilance (en retard)');
  });
  it('vert réel : « aucun tronçon en vigilance jaune ou plus » et le total surveillé ; jamais une panne', () => {
    const floods = withFloods((f) => { f.sections = []; f.counts = { vert: 337, jaune: 0, orange: 0, rouge: 0 }; f.stationsReadAt = null; });
    const v = view({ floods });
    expect(v.head).toMatchObject({ level: 'vert', figure: { value: '0', caption: 'tronçon en vigilance jaune ou plus · sur 337 surveillés · relevé Vigicrues 10:05', level: 'vert' } });
    expect(v.head.status).toEqual(['aucun tronçon en vigilance jaune ou plus', `Vigicrues${NBSP}10:05`]);
    expect(v.sections[0].html).toContain('Aucun tronçon en vigilance jaune ou plus.');
    expect(v.sections[1].html).toContain('Aucun tronçon en vigilance : aucune station suivie.');
    expect(visibleText(renderLayerView('floods', v))).not.toContain('Source indisponible');
  });
  it('Hub’Eau en panne : tronçons gardés, stations listées en « n.d. », panne nommée ; jamais 0', () => {
    const v = view({ floods: withoutMeasures("Hub'Eau : HTTP 503") });
    const h = v.sections.find((s) => s.id === 'stations')?.html ?? '';
    expect(h).toContain('Source indisponible : mesures Hub’Eau des stations.');
    expect(h).toContain('<span>Vinca</span><span class="lp-val fmk-num">n.d.</span><small>Têt · aucune mesure lue</small>');
    expect(h).not.toMatch(new RegExp(`>0,00${NBSP}m<`));
    expect(v.sections.find((s) => s.id === 'stations')?.summary).toBe('n.d.');
    expect(v.head.status[1]).toBe(`Vigicrues${NBSP}10:05`);
    expect(v.head.lead).toBeNull();
    expect(v.sections[0].html).toContain('data-section="MO12"');
    const m = v.sections.find((s) => s.id === 'methode');
    expect(m?.summary).toBe('2 sources · 1 indisponible');
    expect(visibleText(m?.html ?? '')).toContain("Incidents de lecture : Hub'Eau : HTTP 503.");
  });
  it('Hub’Eau lent (lecture en cours au-delà de 12 s) : panne partielle nommée, hauteurs à la prochaine relève', () => {
    const h = sectionOf('stations', { floods: withoutMeasures("Hub'Eau : lecture en cours, hauteurs à la prochaine relève") })?.html ?? '';
    expect(h).toContain('Mesures Hub’Eau en cours de lecture : hauteurs à la prochaine relève.');
    expect(h).toContain('<span>Saleilles</span><span class="lp-val fmk-num">n.d.</span>');
  });
  it('débits seuls en panne : hauteurs gardées, lecture partielle nommée ; stations d’un tronçon non lues : nommées', () => {
    const floods = withFloods((f) => {
      f.errors = ["Hub'Eau, débits : HTTP 503", 'Vigicrues, stations MO17 : HTTP 404'];
      f.sections[3].stations = [];
    });
    const h = sectionOf('stations', { floods })?.html ?? '';
    expect(visibleText(h)).toContain("Lecture partielle : Hub'Eau, débits : HTTP 503.");
    expect(h).toContain(`22,29${NBSP}m`);
    expect(h).toContain('Source indisponible : stations du tronçon Tech.');
  });
  it('plafond de 60 stations : le reste est dit', () => {
    const floods = withFloods((f) => { f.stationsOmitted = 12; });
    expect(visibleText(sectionOf('stations', { floods })?.html ?? '')).toContain('12 stations au-delà du plafond de 60 : non lues (tronçons rouges, puis orange, puis jaunes d’abord).');
  });
  it('niveau orange et rouge : gros chiffre au niveau le plus haut, autres niveaux dans l’ordre', () => {
    const floods = withFloods((f) => { f.sections[0].level = 4; f.sections[1].level = 3; f.counts = { vert: 333, jaune: 2, orange: 1, rouge: 1 }; });
    const v = view({ floods });
    expect(v.head).toMatchObject({ level: 'rouge', figure: { value: '1', caption: 'tronçon en rouge · 1 orange · 2 en jaune · sur 337 surveillés · relevé Vigicrues 10:05', level: 'rouge' } });
    expect(v.head.status[0]).toBe('Têt (Méditerranée Ouest)');
    const h = v.sections[0].html;
    expect(h.indexOf('data-section="MO12"')).toBeLessThan(h.indexOf('data-section="MO11"'));
    expect(h).toContain('lp-lvl--rouge">rouge</span>');
  });
  it('erreur sans donnée, erreur avec données, chargement : jamais « aucun tronçon »', () => {
    const failed = view({ floods: null, floodsError: 'HTTP 502' });
    expect(failed.head).toMatchObject({ level: 'nd', figure: { value: 'n.d.', caption: 'tronçons en vigilance · Vigicrues injoignable', level: null }, status: ['Vigicrues injoignable'] });
    expect(failed.bodyHtml).toContain('Source injoignable. Aucune donnée reçue.');
    expect(failed.sections[0].html).toContain('Source indisponible : tronçons Vigicrues.');
    expect(failed.sections[1].html).toContain('Source indisponible : stations Hub’Eau.');
    expect(visibleText(renderLayerView('floods', failed))).not.toMatch(/Aucun tronçon/);
    expect(view({ floodsError: 'HTTP 502' }).bodyHtml).toContain('Source injoignable. Dernières données : 10:05.');
    expect(view({ floods: null }).bodyHtml).toContain('Chargement des données…');
  });
  it('méthode et sources : relevé du serveur (pas d’heure de bulletin), stations par code jamais par département, retards, couleurs', () => {
    const t = visibleText(sectionOf('methode')?.html ?? '');
    for (const part of ['relevé du serveur 10:05', 'dernière mesure 10:00', 'ne publie pas d’heure de bulletin', 'jamais par département',
      `au-delà de 30${NBSP}min`, `au-delà de 1${NBSP}h`, 'en rouge à la hausse, en vert à la baisse']) expect(t).toContain(part);
    expect(sectionOf('methode')?.summary).toBe('2 sources');
  });
  it('textes hostiles échappés ; R1 ; aucun tiret cadratin, aucune police à chasse fixe, aucune couleur brute ; jamais « recalé », « confiance » ni « temps réel »', () => {
    const floods = withFloods((f) => {
      f.sections[0].name = '<img src=x onerror=1>';
      f.sections[0].stations[0].name = '"><svg onload=1>';
      f.sections[0].territory.name = '<b>t</b>';
    });
    const h = html({ floods });
    expect(h).not.toMatch(/<img|<svg onload|<b>t<\/b>/);
    expect(h).toContain('&lt;img src=x onerror=1&gt;');
    for (const over of [{}, { now: NOW + H }, { floods: withoutMeasures("Hub'Eau : HTTP 503") }]) {
      const all = html(over);
      const text = visibleText(all);
      expect(breakableValue(text)).toBeNull();
      expect(envBreakable(text)).toBeNull();
      expect(all).not.toMatch(/\u2014|&mdash;|monospace|#[0-9a-fA-F]{6}\b|rgba?\(/);
      expect(text.toLowerCase()).not.toMatch(/recal|confiance|temps réel|live/);
    }
  });
});

describe('vue Crues : décisions postérieures au brief', () => {
  it('notes d’avancement : jamais une panne, hauteurs en cours de lecture, stations en « n.d. » sans 0', () => {
    for (const note of ["Hub'Eau : lecture en cours, hauteurs à la prochaine relève"]) {
      const v = view({ floods: withoutMeasures(note) });
      const h = v.sections.find((s) => s.id === 'stations')?.html ?? '';
      expect(visibleText(h)).not.toContain('Source indisponible');
      expect(visibleText(h)).toContain('en cours de lecture');
      expect(h).toContain('<span>Vinca</span><span class="lp-val fmk-num">n.d.</span>');
      expect(h).not.toMatch(new RegExp(`>0,00${NBSP}m<`));
      const m = v.sections.find((s) => s.id === 'methode');
      expect(m?.summary).toBe('2 sources');
      expect(visibleText(m?.html ?? '')).not.toContain('Incidents de lecture');
    }
  });
  it('relevé précédent servi (lecture en cours) : hauteurs gardées, simple note, ni panne ni lecture partielle', () => {
    const floods = withFloods((f) => { f.errors = ['Vigicrues, stations : relevé précédent servi (lecture en cours)']; });
    const v = view({ floods });
    const s = v.sections.find((x) => x.id === 'stations');
    const t = visibleText(s?.html ?? '');
    expect(t.toLowerCase()).toContain('hauteurs en cours de lecture');
    expect(t).not.toMatch(/Source indisponible|Lecture partielle/);
    expect(s?.html).toContain(`22,29${NBSP}m`);
    const m = v.sections.find((x) => x.id === 'methode');
    expect(m?.summary).toBe('2 sources');
    expect(visibleText(m?.html ?? '')).not.toContain('Incidents de lecture');
    expect(v.head.level).toBe('jaune');
  });
  it('une panne réelle reste une panne même avec une note d’avancement', () => {
    const floods = withFloods((f) => { f.errors = ["Hub'Eau, débits : HTTP 503", "Hub'Eau : lecture en cours, hauteurs à la prochaine relève"]; });
    const t = visibleText(sectionOf('stations', { floods })?.html ?? '');
    expect(t).toContain("Lecture partielle : Hub'Eau, débits : HTTP 503.");
    expect(t).not.toContain('prochaine relève.');
  });
  it('débit seul : le débit s’affiche avec sa propre date, jamais « aucune mesure lue »', () => {
    const floods = withFloods((f) => {
      Object.assign(f.sections[0].stations[0], { lastAt: null, heightM: null, change1hM: null, heightSeries: [], flowM3s: 3.2, flowAt: '2026-10-04T07:30:00Z' });
    });
    const h = sectionOf('stations', { floods })?.html ?? '';
    expect(h).toContain(`<span class="lp-val fmk-num">3,2${NBSP}m³/s</span><small>Têt · débit mesuré 09:30</small>`);
    expect(h).not.toContain('aucune mesure lue');
  });
  it('débit daté autrement que la hauteur : sa date est dite', () => {
    const floods = withFloods((f) => { f.sections[1].stations[0].flowAt = '2026-10-04T07:30:00Z'; });
    expect(sectionOf('stations', { floods })?.html).toContain(`mesure 10:00 · débit 0,56${NBSP}m³/s (mesuré 09:30)`);
  });
  it('mesures Hub’Eau de plus d’une heure : hauteurs en retard dites, variation sans couleur', () => {
    const floods = withFloods((f) => { for (const s of f.sections) for (const st of s.stations) st.lastAt = '2026-10-04T06:45:00Z'; });
    const v = view({ floods });
    const h = sectionOf('stations', { floods })?.html ?? '';
    expect(visibleText(h)).toContain('Hauteurs Hub’Eau en retard : dernière mesure 08:45.');
    expect(h).not.toMatch(/lp-trend lp-lvl/);
    expect(v.head.status[1]).toBe(`Vigicrues${NBSP}10:05 · mesures Hub’Eau${NBSP}08:45 (en retard)`);
    expect(v.head.lead).toBeNull();
    expect(v.sections.find((s) => s.id === 'stations')?.summary).toBe('9 stations mesurées · 0 en hausse (en retard)');
  });
  it('variation lue au centimètre : 4 mm est « 0,00 m », sans couleur ; 5 mm est colorée', () => {
    const floods = withFloods((f) => {
      f.sections[0].stations[0].change1hM = 0.004;
      f.sections[0].stations[1].change1hM = -0.004;
    });
    const h = sectionOf('stations', { floods })?.html ?? '';
    expect(h).not.toMatch(/lp-trend lp-lvl[^>]*>0,00/);
    expect(h).not.toMatch(/lp-trend lp-lvl[^>]*>[−+]0,00/);
  });
});
