// src/components/layer-panel/hopitaux.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { HospitalsDataset } from '../../types/index.ts';
import { HEALTH_NOW, hospitalsFixture } from './health.fixture.ts';
import { renderLayerView } from './frame.ts';
import { NBSP, breakableValue, visibleText } from './format.ts';
import { buildHopitauxView, type HopitauxViewInput } from './hopitaux.ts';

const NNBSP = ' ';
const open = (_: string, d: boolean): boolean => d;
const input = (over: Partial<HopitauxViewInput> = {}): HopitauxViewInput => ({
  data: hospitalsFixture(), error: null, canSelectSite: true, now: HEALTH_NOW, open, ...over,
});
const view = (over: Partial<HopitauxViewInput> = {}) => buildHopitauxView(input(over));
const html = (over: Partial<HopitauxViewInput> = {}): string => renderLayerView('hospitals', view(over));
const sectionOf = (id: string, over: Partial<HopitauxViewInput> = {}) => view(over).sections.find((s) => s.id === id);
function withData(edit: (d: HospitalsDataset) => void): HospitalsDataset {
  const d = hospitalsFixture();
  edit(d);
  return d;
}

describe('vue Hôpitaux (spec 2026-10-03 § 3.4)', () => {
  it('en-tête : 617 sites non coloré, 21,7 millions de passages en 2025, pas de pastille, offre et non occupation', () => {
    const v = view();
    expect(v.head).toMatchObject({ theme: 'Santé', title: 'Hôpitaux' });
    expect(v.head.level ?? null).toBeNull();
    expect(v.head.figure).toEqual({ value: '617', level: null, caption: `sites d’urgences autorisés · 21,7${NBSP}millions de passages en 2025` });
    expect(v.head.status).toEqual(['données annuelles 2025', 'DREES SAE, FINESS']);
    expect(v.head.lead).toBe(`617 sites d’urgences. France entière, tous établissements (SAE 2025) : 5${NNBSP}755 lits de réanimation, `
      + 'dont 274 dans les sites d’urgences. Aucune donnée ouverte ne mesure la tension hospitalière en temps réel : le panneau décrit l’offre, '
      + 'pas l’occupation.');
    expect(html()).toContain('<b class="fmk-num">617</b>');
    expect(html()).not.toMatch(/fm-vig|Sous tension|plan blanc/);
  });
  it('sections, ordre, ouverture', () => {
    expect(view().sections.map((s) => [s.id, s.open ?? false])).toEqual([
      ['categories', true], ['capacity', true], ['busiest', true], ['departments', false], ['establishments', false], ['method', false],
    ]);
    expect(view().sections.at(-1)?.tone).toBe('reference');
  });
  it('urgences par catégorie : barre empilée et légende en couleurs de catégorie, pédiatriques, antennes, saisonnières', () => {
    const s = sectionOf('categories');
    expect(s?.summary).toBe('616 sites placés · 89 pédiatriques');
    const h = s?.html ?? '';
    expect(h).toContain('<i style="width:60.2%;background:var(--cat-hosp-ch)"></i><i style="width:24.4%;background:var(--cat-hosp-private)"></i>'
      + '<i style="width:13.3%;background:var(--cat-hosp-chu)"></i><i style="width:1.1%;background:var(--cat-hosp-gcs)"></i>'
      + '<i style="width:1%;background:var(--cat-hosp-army)"></i></div>');
    // aucune donnée « autres » dans le fichier : ni segment de barre ni ligne de légende
    expect(h).not.toContain('--mix-other');
    expect(h).not.toContain('Autres établissements');
    expect(h).toMatch(/var\(--cat-hosp-ch\)"><\/span><span>Centres hospitaliers<\/span><b class="fmk-num">371<\/b>/);
    expect(h).toMatch(/var\(--cat-hosp-chu\)"><\/span><span>CHU et CHR<\/span><b class="fmk-num">82<\/b>/);
    expect(h).toContain('dont urgences pédiatriques 89 · antennes 6 · saisonnières 3');
    expect(visibleText(h)).toContain('617 sites autorisés dont 1 sans coordonnées FINESS : barre et décomptes sur les 616 placés.');
  });
  it('capacités : France entière, tous établissements (SAE 2025), puis dont sites d’urgences calculé sur les sites placés', () => {
    const s = sectionOf('capacity');
    expect(s?.summary).toBe(`184${NNBSP}933 lits MCO · 5${NNBSP}755 en réanimation (France entière)`);
    const t = visibleText(s?.html ?? '');
    expect(t).toMatch(new RegExp(`^France entière, tous établissements \\(SAE 2025\\)Lits de médecine, chirurgie, obstétrique184${NNBSP}933`
      + `Lits de réanimation5${NNBSP}755Lits de soins intensifs9${NNBSP}867Sites de réanimation327`
      + `Dont sites d’urgencesLits de médecine, chirurgie, obstétrique124${NNBSP}600Lits de réanimation274Lits de soins intensifs120Sites de réanimation5`));
    expect(t).toContain('sites d’urgences : somme des 616 sites placés sur la carte');
    expect(t).toContain('aucune donnée ouverte d’occupation');
  });
  it('sites les plus fréquentés : cinq, passages, réanimation, couleur de catégorie, ligne cliquable', () => {
    const s = sectionOf('busiest');
    expect(s?.summary).toBe(`Pitié-Salpêtrière 132${NNBSP}774 passages`);
    const h = s?.html ?? '';
    expect(h.match(/data-hosp-finess=/g)).toHaveLength(5);
    expect(h).toContain('data-hosp-finess="750100125"');
    expect(h).toMatch(new RegExp(`is-link" tabindex="0" role="button" data-hosp-finess="750100125" title="n° FINESS 750100125">`
      + `<span class="lp-swatch" style="background:var\\(--cat-hosp-chu\\)" aria-hidden="true"><\\/span><span>Pitié-Salpêtrière<\\/span>`
      + `<span class="lp-val fmk-num">132${NNBSP}774<\\/span><small>Paris \\(75\\) · CHU et CHR · passages en 2025 · 110 lits de réanimation<\\/small>`));
    expect(h.indexOf('CH d’Avignon')).toBeLessThan(h.indexOf('Lapeyronie'));
    expect(h).toContain('CHU de Nîmes');
  });
  it('carte sans recentrage (mobile, carte SVG) : lignes non cliquables, sans invitation au clic', () => {
    const h = sectionOf('busiest', { canSelectSite: false })?.html ?? '';
    expect(h.match(/class="lp-row"/g)).toHaveLength(5);
    expect(h).not.toMatch(/is-link|role="button"|tabindex|data-hosp-finess/);
    expect(h).not.toContain('Clic :');
  });
  it('par département : sites et passages, du plus doté au moins doté', () => {
    const s = sectionOf('departments');
    expect(s?.summary).toBe('Nord 20 sites · Bouches-du-Rhône 17');
    const h = s?.html ?? '';
    expect(h).toMatch(/Nord \(59\)[^]*20 sites/);
    expect(h).toMatch(/Paris \(75\)[^]*16 sites/);
    expect(h.match(/class="lp-row"/g)).toHaveLength(20);
    expect(h).toMatch(/\d+ autres départements\./);
  });
  it('établissements de santé : FINESS par catégorie agrégée', () => {
    const s = sectionOf('establishments');
    expect(s?.summary).toBe(`8${NNBSP}496 établissements · FINESS mai 2026`);
    const t = visibleText(s?.html ?? '');
    expect(t).toContain('Centres hospitaliers régionaux (CHR et CHU)388');
    expect(t).toContain(`Autres établissements relevant de la loi hospitalière3${NNBSP}189`);
  });
  it('méthode et sources : SAE 2025, FINESS du 04/05, 617 sites dont 616 placés, site sans coordonnées nommé', () => {
    const s = sectionOf('method');
    expect(s?.summary).toBe('SAE 2025 · FINESS mai 2026');
    const h = s?.html ?? '';
    expect(h).toContain('href="https://data.drees.solidarites-sante.gouv.fr/explore/dataset/707_bases-administratives-sae/"');
    expect(h).toContain('href="https://www.data.gouv.fr/fr/datasets/finess-extraction-du-fichier-des-etablissements/"');
    const t = visibleText(h);
    expect(t).toContain('extraction du 04/05');
    expect(t).toContain('617 sites d’urgences autorisés, 616 placés sur la carte ; sans coordonnées FINESS : 830200523');
    expect(t).toContain('jamais « en retard »');
  });
  it('donnée annuelle : jamais « en retard » ; erreur, vide, chargement', () => {
    expect(renderLayerView('hospitals', view({ now: Date.parse('2030-01-01T00:00:00Z') }))).not.toContain('en retard)');
    const failed = view({ data: null, error: 'HTTP 404' });
    expect(failed.head.figure?.value).toBe('n.d.');
    expect(failed.bodyHtml).toContain('Source injoignable. Aucune donnée reçue.');
    expect(visibleText(failed.sections.map((s) => s.html).join(''))).toContain('source indisponible');
    expect(view({ data: withData((d) => { d.sites = []; }) }).bodyHtml).toContain('Aucun site d’urgences dans le fichier.');
    expect(view({ data: null }).bodyHtml).toContain('Chargement des données…');
  });
  it('textes hostiles échappés ; R1 ; aucun tiret cadratin, aucune police à chasse fixe, aucune couleur brute ; jetons définis', () => {
    const data = withData((d) => {
      d.sites[0].name = '<img src=x onerror=1>';
      d.sites[1].commune = '<img src=x onerror=3>';
      d.sites[2].name = '"><img src=x onerror=4>';
      d.establishments[0].label = '<img src=x onerror=2>';
    });
    expect(html({ data })).not.toContain('<img');
    expect(sectionOf('busiest', { data })?.html).toContain('&lt;img src=x onerror=3&gt; (84)');
    const h = html();
    expect(breakableValue(visibleText(h))).toBeNull();
    expect(h).not.toMatch(/\u2014|&mdash;|monospace|#[0-9a-fA-F]{6}\b|rgba?\(/);
    const css = readFileSync(new URL('../../styles/main.css', import.meta.url), 'utf8');
    expect(css).toContain('--cat-hosp-chu: #64d2ff; --cat-hosp-ch: #bf5af2; --cat-hosp-private: #5e5ce6; --cat-hosp-gcs: #30b0c7; --cat-hosp-army: #ac8e68;');
  });
});
