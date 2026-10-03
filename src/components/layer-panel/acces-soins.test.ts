// src/components/layer-panel/acces-soins.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { AplDataset } from '../../types/index.ts';
import { HEALTH_NOW, aplFixture } from './health.fixture.ts';
import { renderLayerView } from './frame.ts';
import { NBSP, breakableValue, visibleText } from './format.ts';
import { buildAccesSoinsView, shareTrendLevel, type AccesSoinsViewInput } from './acces-soins.ts';

const NNBSP = ' ';
const open = (_: string, d: boolean): boolean => d;
const input = (over: Partial<AccesSoinsViewInput> = {}): AccesSoinsViewInput => ({ data: aplFixture(), error: null, profession: 'mg', now: HEALTH_NOW, open, ...over });
const view = (over: Partial<AccesSoinsViewInput> = {}) => buildAccesSoinsView(input(over));
const html = (over: Partial<AccesSoinsViewInput> = {}): string => renderLayerView('healthApl', view(over));
const sectionOf = (id: string, over: Partial<AccesSoinsViewInput> = {}) => view(over).sections.find((s) => s.id === id);
function withData(edit: (d: AplDataset) => void): AplDataset {
  const d = aplFixture();
  edit(d);
  return d;
}

describe('vue Accès aux soins (spec 2026-10-03 § 3.3)', () => {
  it('en-tête : 18,2 % orange (hausse aux deux derniers millésimes), 12,3 millions, 14,9 % en 2022 en rouge, pas de pastille', () => {
    const v = view();
    expect(v.head).toMatchObject({ theme: 'Santé', title: 'Accès aux soins' });
    expect(v.head.level ?? null).toBeNull();
    expect(v.head.figure).toMatchObject({
      value: `18,2${NBSP}%`, level: 'orange',
      caption: `de la population vit dans une commune où l’APL aux médecins généralistes est inférieure à 2,5 · 12,3${NBSP}millions d’habitants · 14,9${NBSP}% en 2022`,
    });
    expect(v.head.figure?.captionHtml).toContain(`<span class="lp-val fmk-num lp-lvl lp-lvl--rouge">14,9${NBSP}% en 2022</span>`);
    expect(v.head.status).toEqual(['millésime 2024 (activité 2024, population 2022)', 'DREES']);
    expect(v.head.lead).toBe('L’accès au médecin généraliste recule depuis 2022 (APL nationale 3,72). '
      + 'Val-d’Oise, Guyane et Essonne ont plus de six habitants sur dix sous le seuil.');
    expect(html()).toContain(`<b class="fmk-num lp-lvl lp-lvl--orange">18,2${NBSP}%</b>`);
    expect(html()).not.toContain('fm-vig');
  });
  it('couleur du gros chiffre : orange si la part monte aux deux derniers millésimes, jaune à un seul, vert si elle baisse', () => {
    const y = (a: number, b: number, c: number) => [
      { year: 2022, aplMg: 3.79, shareUnder25: a, popUnder25: 1 }, { year: 2023, aplMg: 3.74, shareUnder25: b, popUnder25: 1 },
      { year: 2024, aplMg: 3.72, shareUnder25: c, popUnder25: 1 },
    ];
    expect([shareTrendLevel(y(14.9, 16.6, 18.2)), shareTrendLevel(y(16.6, 14.9, 18.2)), shareTrendLevel(y(18.2, 16.6, 14.9)), shareTrendLevel([])])
      .toEqual(['orange', 'jaune', 'vert', null]);
  });
  it('sections, ordre, ouverture ; sélecteur des cinq professions, généralistes par défaut', () => {
    expect(view().sections.map((s) => [s.id, s.open ?? false])).toEqual([
      ['professions', true], ['exposed', true], ['evolution', true], ['outremer', false], ['method', false],
    ]);
    const body = view().bodyHtml ?? '';
    expect(body.match(/data-apl-profession=/g)).toHaveLength(5);
    expect(body).toContain('<button type="button" class="lp-toggle" data-apl-profession="mg" aria-pressed="true">Généralistes</button>');
    expect(view({ profession: 'kine' }).bodyHtml).toContain('data-apl-profession="kine" aria-pressed="true">Kinés</button>');
  });
  it('par profession : valeur nationale et unité, flèche rouge en recul et verte en progrès, barre colorée, département le plus bas', () => {
    const s = sectionOf('professions');
    expect(s?.summary).toBe('5 professions · 2 en baisse');
    const h = s?.html ?? '';
    expect(h).toContain('<span class="fmk-dot fmk-dot--orange" aria-hidden="true"></span><span class="lp-bar-label">Médecins généralistes</span>'
      + '<span class="fmk-bar"><i style="width:67.6%;background:var(--sev-orange)"></i></span><span class="lp-val fmk-num">3,72</span>'
      + '<span class="lp-trend lp-lvl lp-lvl--rouge" aria-label="en recul">▼</span>'
      + '<small>consultations par an et par habitant · 2023 : 3,74 · le plus bas : Guyane 1,76</small>');
    expect(h).toMatch(/Infirmiers[^]*width:32\.9%;background:var\(--sev-yellow\)[^]*154,8[^]*lp-lvl--rouge" aria-label="en recul">▼[^]*le plus bas : Yvelines 67,9/);
    expect(h).toMatch(/Kinésithérapeutes[^]*background:var\(--sev-green\)[^]*123,2[^]*lp-lvl--vert" aria-label="en progrès">▲[^]*le plus bas : Guyane 49,3/);
    expect(h).toContain(`ETP pour 100${NNBSP}000 femmes · 2023 : 21,8 · le plus bas : Orne 11,9`);
    expect(h).toContain('le plus bas : Creuse 22,0');
    expect(h).not.toMatch(/background:var\(--text-secondary\)/);
    expect(visibleText(h)).toContain('couleur : généralistes, reculs de l’APL nationale de 2022 à 2024 (deux : orange, un : jaune, aucun : vert) ; '
      + 'autres professions, recul sur 2023 : jaune, sinon vert.');
  });
  it('départements les plus exposés : dix, part sous 2,5 en jauge colorée par l’APL du département', () => {
    const s = sectionOf('exposed');
    expect(s?.summary).toBe(`10 au-dessus de 49${NBSP}% sous le seuil`);
    const h = s?.html ?? '';
    expect(h.match(/class="lp-bar-row"/g)).toHaveLength(10);
    expect(h).toMatch(new RegExp(`Val-d’Oise[^]*width:69\\.1%;background:var\\(--sev-red\\)[^]*69${NBSP}% · 2,37`));
    expect(h).toMatch(/Ain<\/span>[^]*background:var\(--sev-orange\)[^]*2,57/);
    expect(h.indexOf('Val-d’Oise')).toBeLessThan(h.indexOf('Guyane'));
    expect(h).not.toContain('Orne');
  });
  it('évolution : 2022, 2023, 2024, part, APL et habitants', () => {
    const s = sectionOf('evolution');
    expect(s?.summary).toBe(`18,2${NBSP}% en 2024 contre 14,9${NBSP}% en 2022`);
    const t = visibleText(s?.html ?? '');
    expect(t).toContain(`202214,9${NBSP}% · APL 3,79 · 10,1${NBSP}millions`);
    expect(t).toContain(`202316,6${NBSP}% · APL 3,74 · 11,2${NBSP}millions`);
    expect(t).toContain(`202418,2${NBSP}% · APL 3,72 · 12,3${NBSP}millions`);
  });
  it('outre-mer et Corse : valeurs réelles, Mayotte absente du fichier, jamais remplacée', () => {
    const s = sectionOf('outremer');
    expect(s?.summary).toBe('Guyane 1,76 · Mayotte absente du fichier');
    const h = s?.html ?? '';
    expect(h).toMatch(/fmk-dot--rouge[^]*Guyane[^]*1,76/);
    expect(h).toMatch(/fmk-dot--jaune[^]*Corse-du-Sud[^]*3,95/);
    expect(h).toMatch(/fmk-dot--vert[^]*La Réunion[^]*5,44/);
    expect(h).toMatch(/Mayotte[^]*n\.d\.[^]*absente du fichier DREES/);
    expect(h).not.toMatch(/1,00\b/);
  });
  it('méthode et sources : définition, pondération, seuil historique 2,5, zonage 2025 non comparable, lien DREES réparé', () => {
    const s = sectionOf('method');
    expect(s?.summary).toBe('DREES · zonage 2025');
    const h = s?.html ?? '';
    expect(h).toContain('href="https://data.drees.solidarites-sante.gouv.fr/explore/dataset/530_l-accessibilite-potentielle-localisee-apl/"');
    const t = visibleText(h);
    for (const part of ['millésime 2024, publié le 22/07', 'pondérée par la population standardisée', 'seuil historique du zonage médecin 2017 à 2022',
      'zonage 2025 (seuils 2,71 et 3,98', 'n’est pas comparable aux parts communales', 'jamais « en retard »']) expect(t).toContain(part);
  });
  it('donnée annuelle : jamais « en retard », même des années plus tard', () => {
    const v = view({ now: Date.parse('2030-01-01T00:00:00Z') });
    expect(renderLayerView('healthApl', v)).not.toContain('en retard)');
    expect(v.head.figure?.level).toBe('orange');
  });
  it('erreur, vide, chargement', () => {
    const failed = view({ data: null, error: 'HTTP 404' });
    expect(failed.head.figure?.value).toBe('n.d.');
    expect(failed.bodyHtml).toContain('Source injoignable. Aucune donnée reçue.');
    expect(visibleText(failed.sections.map((s) => s.html).join(''))).toContain('source indisponible');
    expect(view({ error: 'HTTP 500' }).bodyHtml).toContain('Fichier injoignable au dernier essai : millésime 2024 affiché.');
    expect(view({ data: withData((d) => { d.departments = []; }) }).bodyHtml).toContain('Aucune valeur APL dans le fichier.');
    expect(view({ data: null }).bodyHtml).toContain('Chargement des données…');
  });
  it('textes hostiles échappés ; R1 ; aucun tiret cadratin, aucune police à chasse fixe, aucune couleur brute ; sélecteur à la ligne sur mobile', () => {
    expect(html({ data: withData((d) => { d.departments[0].name = '<img src=x onerror=1>'; }) })).not.toContain('<img');
    for (const profession of ['mg', 'inf', 'kine', 'sf', 'dent'] as const) {
      const h = html({ profession });
      expect(breakableValue(visibleText(h))).toBeNull();
      expect(h).not.toMatch(/\u2014|&mdash;|monospace|#[0-9a-fA-F]{6}\b|rgba?\(/);
    }
    const css = readFileSync(new URL('../../styles/main.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.lp \.lp-seg \{[^}]*flex-wrap: wrap/);
  });
});
