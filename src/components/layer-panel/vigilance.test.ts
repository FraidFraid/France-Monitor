// src/components/layer-panel/vigilance.test.ts
import { describe, expect, it } from 'vitest';
import type { VigilanceResponse } from '../../types/index.ts';
import { nextVigilanceMap, vigilanceLevel } from '../../services/environment-levels.ts';
import { ENV_FIXTURE_NOW, VIGILANCE_FIXTURE } from './environment.fixture.ts';
import { envBreakable, glueEnvUnits } from './environment-format.ts';
import { renderLayerView } from './frame.ts';
import { NBSP, breakableValue, visibleText } from './format.ts';
import { VIGILANCE_TABS, VIGILANCE_TITLE, buildVigilanceView, type VigilanceViewInput } from './vigilance.ts';

const NOW = ENV_FIXTURE_NOW;
const open = (_: string, d: boolean): boolean => d;
const input = (over: Partial<VigilanceViewInput> = {}): VigilanceViewInput => ({
  vigilance: VIGILANCE_FIXTURE(), vigilanceError: null, echeance: 'J', selectedDept: null, canFocus: true, now: NOW, open, ...over,
});
const view = (over: Partial<VigilanceViewInput> = {}) => buildVigilanceView(input(over));
const html = (over: Partial<VigilanceViewInput> = {}): string => renderLayerView('environmental', view(over));
const sectionOf = (id: string, over: Partial<VigilanceViewInput> = {}) => view(over).sections.find((s) => s.id === id);
function withVigilance(edit: (v: VigilanceResponse) => void): VigilanceResponse {
  const v = VIGILANCE_FIXTURE();
  edit(v);
  return v;
}
/** 15 h après update_time (08:00:12Z) plus une seconde : carte en retard. */
const LATE = Date.parse('2026-10-04T23:00:13Z');

describe('vue Vigilance météo (spec 2026-10-04 environnement § 2.1)', () => {
  it('en-tête du 04/10 : 2 départements en orange, pastille Orange (pluie-inondation), prochaine carte, commentaire et J+1', () => {
    const v = view();
    expect(VIGILANCE_TITLE).toBe('Vigilance météo');
    expect(v.head).toMatchObject({ theme: 'Environnement', title: 'Vigilance météo', level: 'orange' });
    expect(v.head.figure).toEqual({ value: '2', caption: 'départements en orange aujourd’hui · 5 en jaune · produit Météo-France de 10:00', level: 'orange' });
    expect(v.head.status).toEqual([glueEnvUnits(vigilanceLevel(VIGILANCE_FIXTURE()).reason), `Météo-France${NBSP}10:00 · prochaine carte vers 16:00`]);
    expect(v.head.status[0]).toBe('pluie-inondation : Aude, Pyrénées-Orientales');
    expect(v.head.lead).toBe(`Un nouvel épisode pluvio-orageux actif est attendu sur les Pyrénées-orientales et l'Aude. Demain : 6${NBSP}départements en jaune.`);
    expect(html()).toContain('<b class="fmk-num lp-lvl lp-lvl--orange">2</b>');
    expect(html()).toContain('fm-vig--orange');
  });
  it('onglets Aujourd’hui et Demain, comptés ; sections, ordre et ouverture ; méthode en ton de référence', () => {
    const v = view();
    expect(VIGILANCE_TABS).toEqual(['J', 'J1']);
    expect([v.tabs, v.activeTab]).toEqual([[{ id: 'J', label: 'Aujourd’hui', count: 7 }, { id: 'J1', label: 'Demain', count: 6 }], 'J']);
    expect(v.sections.map((s) => [s.id, s.open ?? false])).toEqual([['departements', true], ['phenomenes', true], ['bulletin', false], ['methode', false]]);
    expect(v.sections.at(-1)?.tone).toBe('reference');
  });
  it('départements : un par ligne, couleur officielle, phénomènes et créneaux en heure de Paris, frise, jour aéronautique, clic', () => {
    const h = sectionOf('departements')?.html ?? '';
    expect(h.match(/class="lp-row/g)).toHaveLength(7);
    const order = ['Aude (11)', 'Pyrénées-Orientales (66)', 'Bouches-du-Rhône (13)', 'Gard (30)', 'Hautes-Pyrénées (65)', 'Hérault (34)', 'Pyrénées-Atlantiques (64)'];
    const at = order.map((t) => h.indexOf(`<span>${t}</span>`));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(h).toContain('<div class="lp-row is-link" tabindex="0" role="button" data-dept="11"><span class="fmk-dot fmk-dot--orange" aria-hidden="true"></span><span>Aude (11)</span><span class="lp-val fmk-num">Orange</span>');
    const t = visibleText(h);
    expect(t).toContain('pluie-inondation orange de 10:00 à 16:00, jaune de 16:00 à 20:00 · orages jaune de 10:00 à 20:00');
    expect(t).toContain('crues jaune, toute l’échéance');
    expect(t).toContain('orages jaune de 19:00 à minuit');
    expect(t).toContain('Jour aéronautique : lever 07:51 · coucher 19:26 · fin du jour aéronautique 19:56');
    expect(t).toContain('Métropole et Corse ; l’outre-mer n’est pas dans ce flux.');
    // Frise : une bande par phénomène ; la crue du 66, sans créneau publié, couvre toute l'échéance.
    expect(h).toContain('aria-label="Frise horaire de la vigilance, Pyrénées-Orientales"');
    expect((h.match(/data-level="orange"/g) ?? []).length).toBe(2);
    expect(h).toContain('fill="var(--sev-orange)"');
    expect(h).toContain('>minuit<');
    expect(sectionOf('departements')?.summary).toContain('fmk-dot--orange');
  });
  it('carte SVG du mobile : lignes non cliquables', () => {
    expect(sectionOf('departements', { canFocus: false })?.html).not.toContain('data-dept');
  });
  it('Demain : échéance J1, 6 départements en jaune, orages en tête ; créneaux du 05/10 datés', () => {
    const v = view({ echeance: 'J1' });
    expect(v.activeTab).toBe('J1');
    expect(v.head.figure).toEqual({ value: '6', caption: 'départements en jaune demain · produit Météo-France de 10:00', level: 'jaune' });
    expect(v.head.level).toBe('jaune');
    expect(v.head.status[0]).toBe(`orages : Aude, Bouches-du-Rhône, Corse-du-Sud et 3${NBSP}autres`);
    const t = visibleText(sectionOf('departements', { echeance: 'J1' })?.html ?? '');
    expect(t).toContain('Corse-du-Sud (2A)');
    expect(t).toContain('pluie-inondation jaune le 05/10 de 04:00 à 13:00');
  });
  it('par phénomène : comptes par couleur, sans vigilance en une ligne, courbe de 30 jours colorée par niveau', () => {
    const s = sectionOf('phenomenes');
    expect(s?.summary).toBe('3 phénomènes');
    const h = s?.html ?? '';
    const t = visibleText(h);
    expect(t.indexOf('Orages')).toBeLessThan(t.indexOf('Pluie-inondation'));
    expect(h).toContain('<span class="fmk-dot fmk-dot--orange" aria-hidden="true"></span><span>Pluie-inondation</span><span class="lp-val fmk-num">3 départements</span><small>2 en orange, 1 en jaune</small>');
    expect(t).toContain('Sans vigilance : vent violent, neige-verglas, canicule, grand froid, avalanches, vagues-submersion');
    expect((h.match(/<polyline /g) ?? []).length).toBe(3);
    for (const c of ['yellow', 'orange', 'red']) expect(h).toContain(`stroke="var(--sev-${c})"`);
    expect(t).toContain('Jour le plus chargé : 30/09 (63 en jaune, 4 en orange, 2 en rouge).');
    expect(h).toContain('>05/09<');
    expect(t).not.toContain('Référence en construction');
  });
  it('historique court : « référence en construction (N jours) » ; un seul jour : pas de courbe', () => {
    const short = withVigilance((v) => { v.history.days = v.history.days.slice(-10); });
    expect(visibleText(sectionOf('phenomenes', { vigilance: short })?.html ?? '')).toContain('Référence en construction (10 jours).');
    const one = withVigilance((v) => { v.history.days = v.history.days.slice(-1); });
    const h = sectionOf('phenomenes', { vigilance: one })?.html ?? '';
    expect(h).not.toContain('<polyline');
    expect(visibleText(h)).toContain('référence en construction (1 jour)');
  });
  it('bulletin : rubriques nationales, zone de défense Sud, département choisi, conseils en lien sortant', () => {
    const s = sectionOf('bulletin', { selectedDept: '66' });
    expect(s?.summary).toBe('textes de 10:00');
    const h = s?.html ?? '';
    expect(h).toContain('<b>Faits nouveaux</b> : Néant.');
    expect(h).toContain('<b>Situation générale</b> : Un nouveau système pluvio-orageux actif');
    expect(h).toContain('<b>Évolution prévue</b>');
    expect(h).toContain('>Défense Sud<');
    expect(h).toContain('>Pyrénées-Orientales<');
    expect(visibleText(h)).toContain(`15 à 30${NBSP}mm`);
    expect(h).toContain('href="https://vigilance.meteofrance.fr"');
    expect(visibleText(h)).toContain('Conseils de comportement (vigilance.meteofrance.fr)');
    expect(visibleText(sectionOf('bulletin')?.html ?? '')).toContain('Choisir un département dans la liste ou sur la carte pour lire son bulletin.');
    expect(visibleText(sectionOf('bulletin', { selectedDept: '75' })?.html ?? '')).toContain('Pas de bulletin départemental publié pour Paris (aujourd’hui).');
    expect(visibleText(sectionOf('bulletin', { echeance: 'J1' })?.html ?? '')).toContain('Pas de texte national pour demain.');
  });
  it('textes en panne : bulletin « textes indisponibles », carte gardée, panne nommée dans Méthode', () => {
    const vigilance = withVigilance((v) => { v.textsUpdateTime = null; v.bulletins = []; v.errors = ['Météo-France, textes : HTTP 401']; });
    const v = view({ vigilance });
    expect(v.head.level).toBe('orange');
    expect(v.sections.find((s) => s.id === 'bulletin')?.html).toContain('Textes indisponibles : le bulletin Météo-France n’a pas pu être lu.');
    const m = v.sections.find((s) => s.id === 'methode');
    expect(m?.summary).toBe('3 sources · 1 indisponible');
    expect(visibleText(m?.html ?? '')).toContain('Incidents de lecture : Météo-France, textes : HTTP 401.');
  });
  it('en retard (plus de 15 h) : pastille n.d., « (en retard) », aucune couleur ni frise ; l’historique reste', () => {
    const v = view({ now: LATE });
    expect(v.head.level).toBe('nd');
    expect(v.head.figure?.level).toBeNull();
    expect(v.head.figure?.caption).toContain('produit Météo-France de 04/10 10:00 (en retard)');
    expect(v.head.status[0]).toBe('niveau suspendu : carte Météo-France en retard');
    expect(v.head.lead).toBeNull();
    const h = renderLayerView('environmental', v);
    expect(h).toContain('fm-vig--nd');
    expect(h).not.toMatch(/fm-vig--(?:rouge|orange|jaune|vert)|lp-figure"><b class="fmk-num lp-lvl/);
    const dept = v.sections.find((s) => s.id === 'departements');
    expect(dept?.html).not.toMatch(/fmk-dot--|data-level=/);
    expect(dept?.summary).toBe('7 départements (en retard)');
    expect(v.sections.find((s) => s.id === 'phenomenes')?.html).not.toMatch(/lp-row"><span class="fmk-dot fmk-dot--/);
  });
  it('carte verte : zéro dit, « aucune vigilance jaune ou plus », pastille Vert', () => {
    const vigilance = withVigilance((v) => {
      for (const p of v.periods) { p.maxColor = 1; p.departments = []; p.counts = []; p.perPhenomenon = []; p.coast = p.coast.map((c) => ({ ...c, color: 1, slots: [] })); }
    });
    const v = view({ vigilance });
    expect(v.head.level).toBe('vert');
    expect(v.head.figure).toEqual({ value: '0', caption: 'départements en vigilance jaune ou plus aujourd’hui · produit Météo-France de 10:00', level: 'vert' });
    expect(v.head.status[0]).toBe('aucune vigilance jaune ou plus');
    expect(v.head.lead).toBe('Un nouvel épisode pluvio-orageux actif est attendu sur les Pyrénées-orientales et l\'Aude. Demain : aucune vigilance jaune ou plus.');
    expect(v.sections[0].html).toContain('Aucune vigilance jaune ou plus aujourd’hui (carte Météo-France de 10:00).');
  });
  it('domaines littoraux seuls à la couleur la plus haute (amendement 8) : compte des domaines, ligne littorale', () => {
    const vigilance = withVigilance((v) => {
      const j = v.periods[0];
      j.maxColor = 3;
      j.departments = j.departments.filter((d) => d.color === 2);
      j.coast = j.coast.map((c) => (c.code === '6610' ? { ...c, color: 3, slots: [{ from: '2026-10-04T12:00:00Z', to: '2026-10-04T18:00:00Z', color: 3 }] } : c));
    });
    const v = view({ vigilance });
    expect(v.head.figure).toEqual({ value: '1', caption: 'domaine littoral en orange aujourd’hui · 5 en jaune · produit Météo-France de 10:00', level: 'orange' });
    expect(v.head.status[0]).toBe('vagues-submersion : Pyrénées-Orientales, littoral');
    expect(visibleText(v.sections[0].html)).toContain('Pyrénées-Orientales, littoralOrangevagues-submersion orange de 14:00 à 20:00');
  });
  it('erreur sans donnée, erreur avec données, carte non lue, chargement : jamais « aucune vigilance »', () => {
    const failed = view({ vigilance: null, vigilanceError: 'HTTP 502' });
    expect(failed.head).toMatchObject({ level: 'nd', figure: { value: 'n.d.' }, status: ['Météo-France injoignable'] });
    expect(failed.bodyHtml).toContain('Source injoignable. Aucune donnée reçue.');
    expect(view({ vigilanceError: 'HTTP 502' }).bodyHtml).toContain('Source injoignable. Dernières données : 10:00.');
    const noMap = withVigilance((v) => { v.updateTime = null; v.periods = []; v.errors = ['Météo-France : clé absente']; });
    const down = view({ vigilance: noMap });
    expect(down.head).toMatchObject({ level: 'nd', figure: { value: 'n.d.' }, status: ['carte de vigilance Météo-France indisponible'] });
    expect(down.sections[0].html).toContain('Source indisponible : carte de vigilance Météo-France.');
    expect(visibleText(renderLayerView('environmental', down))).not.toMatch(/Aucune vigilance/i);
    expect(view({ vigilance: null }).bodyHtml).toContain('Chargement des données…');
  });
  it('textes hostiles échappés ; R1 ; aucun tiret cadratin, police à chasse fixe, couleur brute ni « temps réel »', () => {
    const vigilance = withVigilance((v) => {
      v.periods[0].departments[0].name = '<img src=x onerror=1>';
      v.periods[0].comment = '<script>x</script>';
      const fra = v.bulletins.find((b) => b.domainId === 'FRA');
      if (fra) fra.items[0].paragraphs[0].text = ['"><svg onload=1>'];
    });
    const h = html({ vigilance, selectedDept: '66' });
    expect(h).not.toMatch(/<img|<script|<svg onload/);
    expect(h).toContain('&lt;img src=x onerror=1&gt;');
    expect(h).toContain('&lt;svg onload=1&gt;');
    for (const over of [{}, { echeance: 'J1' as const }, { now: LATE }, { selectedDept: '66' }, { selectedDept: '11' }]) {
      const all = renderLayerView('environmental', buildVigilanceView(input(over)));
      const bulletin = buildVigilanceView(input({ ...over, open: () => true }));
      const text = visibleText(all) + visibleText(renderLayerView('environmental', bulletin));
      expect(breakableValue(text)).toBeNull();
      expect(envBreakable(text)).toBeNull();
      expect(all).not.toMatch(/\u2014|&mdash;|monospace|#[0-9a-fA-F]{6}\b|rgba?\(/);
      expect(text.toLowerCase()).not.toContain('temps réel');
    }
  });
});

describe('vigilance : décisions complémentaires', () => {
  it('note d’avancement de l’historique : note simple, jamais source indisponible ni incident', () => {
    const vigilance = withVigilance((v) => { v.errors = ['historique de la vigilance en cours de constitution']; });
    const m = view({ vigilance }).sections.find((s) => s.id === 'methode');
    const t = visibleText(m?.html ?? '');
    expect(t).toContain('historique en cours de constitution');
    expect(t).not.toContain('Incidents de lecture');
    expect(t).not.toMatch(/indisponible/);
    expect(m?.summary).toBe('3 sources');
    const mixed = withVigilance((v) => { v.errors = ['historique de la vigilance en cours de constitution', 'Météo-France, textes : HTTP 401']; });
    const mt = visibleText(view({ vigilance: mixed }).sections.find((s) => s.id === 'methode')?.html ?? '');
    expect(mt).toContain('Incidents de lecture : Météo-France, textes : HTTP 401.');
    expect(mt).not.toContain('Incidents de lecture : historique');
  });
  it('textes tiers en texte brut : « < » et « > » échappés, jamais du HTML', () => {
    const vigilance = withVigilance((v) => {
      v.periods[0].comment = 'Cumuls < 5 mm, jusqu\'à > 10 mm <script>x</script>';
      const fra = v.bulletins.find((b) => b.domainId === 'FRA');
      if (fra) fra.items[0].paragraphs[0].text = ['Cumuls < 5 mm, jusqu\'à > 10 mm', '<script>y</script>'];
    });
    const h = html({ vigilance });
    const b = renderLayerView('environmental', buildVigilanceView(input({ vigilance, open: () => true })));
    for (const out of [h, b]) {
      expect(out).not.toContain('<script');
      expect(out).toContain('Cumuls &lt; 5');
      expect(out).toContain('&gt; 10');
    }
    expect(visibleText(b)).toContain(`Cumuls < 5${NBSP}mm, jusqu'à > 10${NBSP}mm`);
  });
  it('jour partiel : point creux, segment en tirets et « jour en cours » ; deux jours adjacents sans trait plein', () => {
    const count = (h: string, re: RegExp): number => (h.match(re) ?? []).length;
    const last = withVigilance((v) => { v.history.days[v.history.days.length - 1].partial = true; });
    const h = sectionOf('phenomenes', { vigilance: last })?.html ?? '';
    expect(visibleText(h)).toContain('jour en cours');
    expect(count(h, /<circle [^>]*data-partial/g)).toBe(3);
    expect(count(h, /<polyline [^>]*data-partial/g)).toBe(3);
    expect(count(h, /<polyline (?![^>]*data-partial)/g)).toBe(3);
    expect(sectionOf('phenomenes')?.html).not.toContain('jour en cours');
    const two = withVigilance((v) => { for (const d of v.history.days.slice(-2)) d.partial = true; });
    const h2 = sectionOf('phenomenes', { vigilance: two })?.html ?? '';
    expect(count(h2, /<circle [^>]*data-partial/g)).toBe(6);
    expect(count(h2, /<polyline [^>]*data-partial/g)).toBe(3);
    expect(count(h2, /<polyline (?![^>]*data-partial)/g)).toBe(3);
  });
  it('créneau vert : ni dessiné dans la frise ni écrit dans le texte', () => {
    const vigilance = withVigilance((v) => {
      const p = v.periods[0].departments[0].phenomena.find((x) => x.slots.length > 0);
      if (p) p.slots.push({ from: '2026-10-04T20:00:00Z', to: '2026-10-04T22:00:00Z', color: 1 });
    });
    const dept = sectionOf('departements', { vigilance })?.html ?? '';
    expect(dept).not.toContain('data-level="vert"');
    expect(dept).toBe(sectionOf('departements')?.html);
  });
  it('prochaine carte à 06:00 et 16:00 toute l’année (heure de Paris)', () => {
    const night = Date.parse('2026-10-04T20:00:00Z');
    expect(view({ now: night }).head.status[1]).toBe(`Météo-France${NBSP}10:00 · prochaine carte vers 06:00`);
    const winter = Date.parse('2026-01-10T20:00:00Z');
    expect(nextVigilanceMap(winter)).toBe(Date.parse('2026-01-11T05:00:00Z'));
  });
  it('30 jours tous à zéro : « aucun département en vigilance sur la période » dit', () => {
    const vigilance = withVigilance((v) => { for (const d of v.history.days) { d.jaune = 0; d.orange = 0; d.rouge = 0; } });
    expect(visibleText(sectionOf('phenomenes', { vigilance })?.html ?? '')).toContain('Aucun département en vigilance sur la période.');
    expect(visibleText(sectionOf('phenomenes')?.html ?? '')).not.toContain('sur la période.');
  });
});
