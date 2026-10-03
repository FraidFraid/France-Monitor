// src/components/layer-panel/urgences.test.ts
import { describe, expect, it } from 'vitest';
import type { SyndromicResponse } from '../../types/index.ts';
import { HEALTH_NOW, alertLevelsFixture, syndromicFixture } from './health.fixture.ts';
import { renderLayerView } from './frame.ts';
import { NBSP, breakableValue, visibleText } from './format.ts';
import { PER_100K } from './health-format.ts';
import { buildUrgencesView, type UrgencesViewInput } from './urgences.ts';

const open = (_: string, d: boolean): boolean => d;
const input = (over: Partial<UrgencesViewInput> = {}): UrgencesViewInput => ({
  data: syndromicFixture(), error: null, alerts: alertLevelsFixture(), syndrome: 'ira', now: HEALTH_NOW, open, ...over,
});
const view = (over: Partial<UrgencesViewInput> = {}) => buildUrgencesView(input(over));
const html = (over: Partial<UrgencesViewInput> = {}): string => renderLayerView('healthOscour', view(over));
const sectionOf = (id: string, over: Partial<UrgencesViewInput> = {}) => view(over).sections.find((s) => s.id === id);
function withData(edit: (d: SyndromicResponse) => void): SyndromicResponse {
  const d = syndromicFixture();
  edit(d);
  return d;
}

describe('vue Urgences et SOS Médecins (spec 2026-10-03 § 3.2)', () => {
  it('en-tête S39 : IRA 2,1 % vert, +11 % sur S38 en rouge ; pastille Jaune portée par la gastro-entérite ; synthèse sur deux semaines', () => {
    const v = view();
    expect(v.head).toMatchObject({ theme: 'Santé', title: 'Urgences et SOS Médecins', level: 'jaune' });
    expect(v.head.figure).toMatchObject({
      value: `2,1${NBSP}%`, level: 'vert',
      caption: `des passages aux urgences pour IRA · S39 · +11${NBSP}% sur S38 · sous les saisons précédentes`,
    });
    expect(v.head.figure?.captionHtml).toBe(`des passages aux urgences pour IRA · S39 · <span class="lp-val fmk-num lp-lvl lp-lvl--rouge">+11${NBSP}% sur S38</span> · sous les saisons précédentes`);
    expect(v.head.status).toEqual(['gastro-entérite au-dessus des 3 saisons précédentes', 'S39 · publiée le 30/09', 'Santé publique France']);
    expect(v.head.lead).toBe(`Hausse de rentrée sur deux semaines (IRA +31${NBSP}%, COVID-19 +69${NBSP}%, bronchiolite +67${NBSP}%, grippe +31${NBSP}% depuis S37) ; `
      + 'gastro-entérite au-dessus des saisons précédentes.');
    expect(html()).toContain(`<b class="fmk-num lp-lvl lp-lvl--vert">2,1${NBSP}%</b>`);
    expect(html()).toContain('fm-vig--jaune');
  });
  it('IRA à 1,15 fois le maximum des saisons précédentes ou plus : chiffre et pastille orange, syndrome nommé', () => {
    const data = withData((d) => {
      const p = d.syndromes.find((s) => s.key === 'ira')?.france.find((x) => x.week === '2026-S39');
      if (p) p.er = 4;
    });
    const v = view({ data });
    expect(v.head.level).toBe('orange');
    expect(v.head.figure).toMatchObject({ value: `4,0${NBSP}%`, level: 'orange' });
    expect(v.head.figure?.caption).toContain('bien au-dessus des saisons précédentes');
    expect(v.head.status[0]).toBe('IRA bien au-dessus des 3 saisons précédentes');
    expect(v.head.lead).toContain(' ; IRA bien au-dessus des saisons précédentes.');
    expect(html({ data })).toContain('<b class="fmk-num lp-lvl lp-lvl--orange">');
  });
  it('sections, ordre, ouverture ; sélecteur de syndrome en tête du corps, IRA par défaut', () => {
    expect(view().sections.map((s) => [s.id, s.open ?? false])).toEqual([
      ['syndromes', true], ['ira12', true], ['departments', true], ['ages', false], ['hosp', false], ['method', false],
    ]);
    expect(view().sections.at(-1)?.tone).toBe('reference');
    const body = view().bodyHtml ?? '';
    expect(body).toContain('<button type="button" class="lp-toggle" data-urg-syndrome="ira" aria-pressed="true">IRA</button>');
    expect(body).toContain('data-urg-syndrome="gastro" aria-pressed="false">Gastro-entérite</button>');
  });
  it('syndromes : sept lignes, urgences et SOS Médecins, évolution colorée à ±10 %, puce du niveau saisonnier', () => {
    const s = sectionOf('syndromes');
    expect(s?.summary).toBe('7 suivis · 5 en hausse');
    const h = s?.html ?? '';
    expect(h).toContain(`<th scope="row"><span class="fmk-dot fmk-dot--vert" aria-hidden="true"></span>IRA</th><td><b class="lp-val fmk-num">2,1${NBSP}%</b></td>`
      + `<td><span class="lp-val fmk-num">11,1${NBSP}%</span></td><td><span class="lp-val fmk-num lp-lvl lp-lvl--rouge">+11${NBSP}%</span></td>`);
    expect(h).toContain(`Allergie</th><td><span class="lp-val fmk-num">0,7${NBSP}%</span></td><td><span class="lp-val fmk-num">1,1${NBSP}%</span></td><td><span class="lp-val fmk-num lp-lvl lp-lvl--vert">−10${NBSP}%</span></td>`);
    expect(h).toContain(`Asthme</th><td><span class="lp-val fmk-num">1,0${NBSP}%</span></td><td><span class="lp-val fmk-num">1,4${NBSP}%</span></td><td><span class="lp-val fmk-num">−9${NBSP}%</span></td>`);
    expect(h).toContain(`<span class="fmk-dot fmk-dot--jaune" aria-hidden="true"></span>Gastro-entérite</th><td><span class="lp-val fmk-num">1,1${NBSP}%</span></td><td><span class="lp-val fmk-num">5,3${NBSP}%</span></td><td><span class="lp-val fmk-num">+4${NBSP}%</span></td>`);
    expect(h).toContain('Bronchiolite (moins de 1 an)');
    expect(h.indexOf('Allergie')).toBeLessThan(h.indexOf('Grippe'));
    expect(h).toContain(`jamais un taux ${PER_100K}`);
  });
  it('IRA, 12 semaines : courbe de la saison au niveau vert, saison précédente en pointillé, mêmes semaines des trois saisons', () => {
    const s = sectionOf('ira12');
    expect(s?.summary).toBe(`2,1${NBSP}% contre 2,5${NBSP}% en 2025`);
    const h = s?.html ?? '';
    expect(/<polyline points="([^"]+)" fill="none" stroke="var\(--sev-green\)"/.exec(h)?.[1].split(' ')).toHaveLength(12);
    expect(/<polyline points="([^"]+)" fill="none" stroke="var\(--text-muted\)" stroke-width="1\.5" stroke-dasharray="4 3"/.exec(h)?.[1].split(' ')).toHaveLength(12);
    expect(h).toContain('>S28<');
    expect(h).toContain('>S39<');
    expect(h).toContain('<i class="lp-dash"></i>2025, même semaine');
    expect(h).toMatch(new RegExp(`Même semaine, 3 saisons précédentes[^]*2,5${NBSP}% · 3,5${NBSP}% · 3,3${NBSP}%`));
  });
  it('départements les plus hauts (IRA) : cinq, puce saisonnière départementale, notes SOS, hospitalisations, contexte outre-mer', () => {
    const s = sectionOf('departments');
    expect(s?.summary).toBe(`IRA · La Réunion 5,7${NBSP}%`);
    const h = s?.html ?? '';
    expect(h.match(/class="lp-row"/g)).toHaveLength(5);
    expect(h).toMatch(new RegExp(`fmk-dot--orange[^]*La Réunion[^]*5,7${NBSP}%[^]*pas d’association SOS Médecins · hospitalisations après passage 6,0${NBSP}%`));
    expect(h).toMatch(new RegExp(`fmk-dot--orange[^]*Mayotte[^]*3,9${NBSP}%[^]*grippe en pré-épidémie · pas d’association SOS Médecins`));
    expect(h).toMatch(/fmk-dot--jaune[^]*Lozère/);
    expect(h).toMatch(new RegExp(`Bouches-du-Rhône[^]*SOS Médecins 17,8${NBSP}% des actes · hospitalisations après passage 5,0${NBSP}%`));
    expect(h).toMatch(new RegExp(`Rhône</span>[^]*2,0${NBSP}%[^]*SOS Médecins 11,4${NBSP}% des actes · hospitalisations après passage 6,5${NBSP}%`));
    expect(h).not.toContain('Paris');
    expect(h).toContain('data-dept="974"');
  });
  it('sélecteur sur la gastro-entérite : départements de la gastro-entérite, bouton pressé', () => {
    const v = view({ syndrome: 'gastro' });
    expect(v.sections.find((x) => x.id === 'departments')?.summary).toBe(`Gastro-entérite · Mayotte 3,8${NBSP}%`);
    expect(v.bodyHtml).toContain('data-urg-syndrome="gastro" aria-pressed="true"');
    expect(v.bodyHtml).toContain('data-urg-syndrome="ira" aria-pressed="false"');
  });
  it('par âge : IRA par classe, bronchiolite moins de 1 an, COVID-19 65 ans et plus, évolution sur S38', () => {
    const s = sectionOf('ages');
    expect(s?.summary).toBe(`IRA 0-4 ans 4,1${NBSP}% · 65 ans et plus 3,9${NBSP}%`);
    const h = s?.html ?? '';
    expect(h).toMatch(new RegExp(`IRA, 0-4 ans[^]*4,1${NBSP}%[^]*sur S38 : <span class="lp-val fmk-num lp-lvl lp-lvl--rouge">\\+14${NBSP}%`));
    expect(h).toMatch(new RegExp(`Bronchiolite, moins de 1 an[^]*6,6${NBSP}%`));
    expect(h).toMatch(new RegExp(`COVID-19, 65 ans et plus[^]*0,4${NBSP}%[^]*\\+36${NBSP}%`));
  });
  it('hospitalisations après passage : sept syndromes, niveau saisonnier', () => {
    const s = sectionOf('hosp');
    expect(s?.summary).toBe(`IRA 4,7${NBSP}% · toutes sous les saisons précédentes`);
    expect((s?.html ?? '').match(/fmk-dot--vert/g)).toHaveLength(7);
  });
  it('méthode et sources : définition du taux, couverture, départements non agrégeables, retard', () => {
    const t = visibleText(sectionOf('method')?.html ?? '');
    for (const part of ['S39 (21-27 sept.), publiée le 30/09', `ce n’est pas un taux ${PER_100K}`, 'environ 700 structures d’urgences',
      '62 associations SOS Médecins', 'valeurs non agrégeables', 'au-delà de 17 jours après la fin de la semaine',
      'jaune au-dessus, orange à 1,15 fois ce maximum ou plus, rouge à 1,5 fois ou plus']) expect(t).toContain(part);
    expect(sectionOf('method')?.summary).toBe('OSCOUR · SOS Médecins');
    const noSos = syndromicFixture().departments.filter((dep) => dep.values.ira?.sos === null).length;
    expect(t).toContain(`${noSos} départements sans association SOS Médecins`);
  });
  it('hospitalisations : données en retard ou moins de deux saisons de référence, comparaison n.d. sans affirmation', () => {
    expect(sectionOf('hosp', { now: Date.parse('2026-10-20T00:00:00Z') })?.summary).toBe(`IRA 4,7${NBSP}% · comparaison saisonnière n.d.`);
    const data = withData((d) => { for (const s of d.syndromes) s.france = s.france.filter((p) => p.week.startsWith('2026')); });
    expect(sectionOf('hosp', { data })?.summary).toBe(`IRA 4,7${NBSP}% · comparaison saisonnière n.d.`);
  });
  it('en retard (17 jours après la fin de la semaine) : « (en retard) », pastille n.d., aucune couleur', () => {
    const now = Date.parse('2026-10-20T00:00:00Z');
    const v = view({ now });
    expect(v.head.level).toBe('nd');
    expect(v.head.figure?.level ?? null).toBeNull();
    expect(v.head.figure?.caption).toMatch(/\(en retard\)$/);
    expect(v.head.status).toEqual(['niveau saisonnier suspendu : données en retard', 'S39 · publiée le 30/09 (en retard)', 'Santé publique France']);
    expect(renderLayerView('healthOscour', v)).not.toMatch(/lp-lvl|fmk-dot--/);
    expect(view({ now: Date.parse('2026-10-12T00:00:00Z') }).head.level).toBe('jaune');
  });
  it('erreur, vide, chargement : jamais une liste vide silencieuse', () => {
    const failed = view({ data: null, error: 'HTTP 500' });
    expect(failed.head).toMatchObject({ level: 'nd', figure: { value: 'n.d.' }, status: ['Odissé injoignable', 'Santé publique France'] });
    expect(failed.bodyHtml).toContain('Source injoignable. Aucune donnée reçue.');
    expect(failed.sections.map((s) => s.id)).toEqual(['method']);
    expect(visibleText(failed.sections[0].html)).toContain('source indisponible');
    expect(view({ error: 'HTTP 500' }).bodyHtml).toContain('Source injoignable. Dernières données : 30/09 12:01.');
    expect(view({ data: withData((d) => { d.syndromes = []; }) }).bodyHtml).toContain('Aucune donnée de surveillance syndromique reçue.');
    expect(view({ data: null }).bodyHtml).toContain('Chargement des données…');
  });
  it('textes hostiles échappés ; R1 ; aucun tiret cadratin, aucune police à chasse fixe, aucune couleur brute', () => {
    const data = withData((d) => { d.departments[0].name = '<img src=x onerror=1>'; });
    expect(html({ data })).not.toContain('<img');
    for (const syndrome of ['ira', 'bronchio', 'gastro'] as const) {
      const h = html({ syndrome });
      expect(breakableValue(visibleText(h))).toBeNull();
      expect(h).not.toMatch(/\u2014|&mdash;|monospace|#[0-9a-fA-F]{6}\b|rgba?\(/);
    }
  });
});
