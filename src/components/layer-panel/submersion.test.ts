import { describe, expect, it } from 'vitest';
import type { SeaLevelsResponse, VigilanceCoastDomain, VigilancePeriod } from '../../types/index.ts';
import { ENV_FIXTURE_NOW, SEA_LEVELS_FIXTURE, VIGILANCE_FIXTURE } from './environment.fixture.ts';
import { NBSP, breakableValue, visibleText } from './format.ts';
import { departementName } from './health-format.ts';
import { envBreakable, formatChangeM, formatHeightM, slotText } from './environment-format.ts';
import { renderLayerSections } from './frame.ts';
import { buildVigilanceView, type VigilanceViewInput } from './vigilance.ts';
import { submersionSection, type SubmersionInput } from './submersion.ts';

const COAST = ['5910', '6210', '8010', '7610', '1410', '5010', '3510', '2210', '2910', '5610', '4410', '8510', '1710', '3310', '4010', '6410', '6610', '1110',
  '3410', '3010', '1310', '8310', '0610', '2A10', '2B10'];
function domain(code: string, over: Partial<VigilanceCoastDomain> = {}): VigilanceCoastDomain {
  return { code, departement: code.slice(0, 2), name: `${departementName(code.slice(0, 2))}, littoral`, color: 1, slots: [], ...over };
}
function period(edit: (coast: VigilanceCoastDomain[]) => void = () => undefined): VigilancePeriod {
  const coast = COAST.map((c) => domain(c));
  edit(coast);
  return {
    echeance: 'J', begin: '2026-10-04T08:00:00Z', end: '2026-10-04T22:00:00Z', maxColor: 3, comment: null, departments: [], greenDepartments: 96,
    coast, counts: [], perPhenomenon: [],
  };
}
const SLOT = { from: '2026-10-04T08:00:00Z', to: '2026-10-04T14:00:00Z', color: 2 as const };
const FINISTERE_JAUNE = period((coast) => {
  const i = coast.findIndex((d) => d.code === '2910');
  coast[i] = domain('2910', { color: 2, slots: [SLOT] });
});
const open = (_: string, d: boolean): boolean => d;
const input = (over: Partial<SubmersionInput> = {}): SubmersionInput => ({
  period: period(), seaLevels: structuredClone(SEA_LEVELS_FIXTURE), seaLevelsError: null, canFocus: true, now: ENV_FIXTURE_NOW, ...over,
});
const section = (over: Partial<SubmersionInput> = {}) => submersionSection(input(over), open);
function withSea(edit: (s: SeaLevelsResponse) => void): SeaLevelsResponse {
  const s = structuredClone(SEA_LEVELS_FIXTURE);
  edit(s);
  return s;
}

describe('section Submersion marine (spec 2026-10-04 environnement § 3.4)', () => {
  it('04/10 : 25 domaines littoraux verts, deux marégraphes ; repliée quand rien n’est en vigilance', () => {
    const s = section();
    expect([s.id, s.title, s.collapsible, s.open]).toEqual(['submersion', 'Submersion marine', true, false]);
    expect(s.summary).toBe('25 domaines en vert · 2 marégraphes');
    expect(visibleText(s.html)).toContain('Les 25 domaines littoraux sont en vert (vagues-submersion).');
  });
  it('un domaine en jaune : nommé, créneau, couleur ; section ouverte par défaut', () => {
    const s = section({ period: FINISTERE_JAUNE });
    expect([s.open, s.summary]).toEqual([true, '1 domaine en jaune · 2 marégraphes']);
    expect(s.html).toContain(`<div class="lp-row"><span class="fmk-dot fmk-dot--jaune" aria-hidden="true"></span><span>Finistère, littoral</span><span class="lp-val fmk-num">jaune</span><small>${slotText(SLOT, ENV_FIXTURE_NOW)}</small></div>`);
    expect(visibleText(s.html)).toContain('24 autres domaines littoraux en vert.');
  });
  it('marégraphes : hauteur, variation sur 1 h, heure de mesure, domaine (couleur du domaine) ; clic vers la carte', () => {
    const h = section({ period: FINISTERE_JAUNE }).html;
    expect(h).toContain(`<div class="lp-row is-link" tabindex="0" role="button" data-gauge="3"><span class="fmk-dot fmk-dot--jaune" aria-hidden="true"></span><span>Brest</span>`
      + `<span class="lp-val fmk-num">${formatHeightM(5.1772)}</span><small>${formatChangeM(0.4567)} en 1${NBSP}h · mesure 10:10 · Finistère, littoral</small></div>`);
    expect(h).toContain(`data-gauge="524"><span class="fmk-dot fmk-dot--vert" aria-hidden="true"></span><span>Marseille</span><span class="lp-val fmk-num">${formatHeightM(0.4949)}</span>`);
    expect(section({ canFocus: false }).html).not.toContain('data-gauge');
  });
  it('courbe de 24 h par marégraphe, repliable (ouverte si son domaine est en vigilance), mémorisée par le cadre', () => {
    const h = section({ period: FINISTERE_JAUNE }).html;
    expect(h).toContain('<details class="lp-sub" data-section="layer:environmental:maregraphe-3" open><summary>Hauteur d’eau sur 24');
    expect(h).toContain('<details class="lp-sub" data-section="layer:environmental:maregraphe-524"><summary>');
    expect(h).toMatch(/<svg[^>]*aria-label="Hauteur d’eau à Brest, 24 dernières heures"[^]*stroke="var\(--cat-port\)"/);
    const opened = submersionSection(input(), (id, d) => (id === 'maregraphe-524' ? true : d));
    expect(opened.html).toContain('data-section="layer:environmental:maregraphe-524" open>');
  });
  it('marée prédite absente, dite (S4) ; sources et périmètre', () => {
    const t = visibleText(section().html);
    for (const part of ['l’écart à la marée prédite n’est pas affiché', 'clé', 'zéro hydrographique', '19 ports', 'une mesure par minute',
      `une valeur toutes les 10${NBSP}min`]) expect(t).toContain(part);
  });
  it('marégraphe en retard (dernière mesure de plus de 30 min) : gris, « (en retard) », courbe sans couleur', () => {
    const h = section({ now: Date.parse('2026-10-04T08:45:00Z') }).html;
    expect(h).toMatch(/data-gauge="3"><span class="fmk-dot" aria-hidden="true"><\/span>[^]*mesure 10:10 \(en retard\)/);
    expect(h).not.toContain('stroke="var(--cat-port)"');
  });
  it('un marégraphe en retard à côté d’un marégraphe frais : seul le premier perd ses couleurs', () => {
    const sea = withSea((x) => { x.gauges[1] = { ...x.gauges[1], lastAt: '2026-10-04T08:40:00Z' }; });
    const h = section({ seaLevels: sea, now: Date.parse('2026-10-04T08:45:00Z') }).html;
    expect(h).toMatch(/data-gauge="3"><span class="fmk-dot" aria-hidden="true"><\/span>[^]*mesure 10:10 \(en retard\)/);
    expect(h).toMatch(/data-gauge="524"><span class="fmk-dot fmk-dot--vert" aria-hidden="true"><\/span>/);
    expect(h).not.toMatch(/mesure 10:40 \(en retard\)/);
  });
  it('pannes nommées : marégraphe sans mesure, tous en panne, chargement, carte de vigilance absente', () => {
    const one = section({ seaLevels: withSea((s) => { s.gauges[1] = { ...s.gauges[1], lastAt: null, heightM: null, change1hM: null, series: [] }; s.errors = ['Marégraphe Marseille : HTTP 503']; }) });
    expect(one.html).toMatch(/data-gauge="524"><span class="fmk-dot" aria-hidden="true"><\/span><span>Marseille<\/span><span class="lp-val fmk-num">n\.d\.<\/span><small>aucune mesure lue/);
    expect(visibleText(one.html)).toContain('Incidents de lecture : Marégraphe Marseille : HTTP 503.');
    expect(section({ seaLevels: null, seaLevelsError: 'HTTP 502' }).html).toContain('Source indisponible : marégraphes SHOM.');
    expect(section({ seaLevels: null }).html).toContain('Chargement des marégraphes…');
    expect(section({ period: null }).html).toContain('Source indisponible : carte de vigilance Météo-France (domaines littoraux).');
  });
  it('R1 ; aucun tiret cadratin ; aucune couleur brute ; textes échappés', () => {
    const hostile = withSea((s) => { s.gauges[0].name = '<img src=x onerror=1>'; });
    for (const over of [{}, { period: FINISTERE_JAUNE }, { seaLevels: hostile }, { now: Date.parse('2026-10-04T08:45:00Z') }]) {
      const h = renderLayerSections('environmental', [section(over)]);
      const t = visibleText(h);
      expect(breakableValue(t)).toBeNull();
      expect(envBreakable(t)).toBeNull();
      expect(h).not.toMatch(/\u2014|&mdash;|monospace|#[0-9a-fA-F]{6}\b|rgba?\(|<img/);
    }
  });
});

describe('panneau Vigilance météo : section Submersion entre le bulletin et « Méthode et sources »', () => {
  const base = (over: Partial<VigilanceViewInput> = {}): VigilanceViewInput => ({
    vigilance: VIGILANCE_FIXTURE(), vigilanceError: null, seaLevels: structuredClone(SEA_LEVELS_FIXTURE), seaLevelsError: null,
    echeance: 'J', selectedDept: null, canFocus: true, now: ENV_FIXTURE_NOW, open, ...over,
  });
  it('ordre des sections', () => {
    const ids = buildVigilanceView(base()).sections.map((s) => s.id);
    expect(ids.indexOf('submersion')).toBe(ids.indexOf('methode') - 1);
    expect(ids.indexOf('submersion')).toBeGreaterThan(ids.indexOf('bulletin'));
  });
  it('marégraphes non encore lus (couche éteinte) : chargement dit, jamais « aucun »', () => {
    const s = buildVigilanceView(base({ seaLevels: null })).sections.find((x) => x.id === 'submersion');
    expect(s?.html).toContain('Chargement des marégraphes…');
  });
});
