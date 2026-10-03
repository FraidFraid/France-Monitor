// src/components/layer-panel/veille.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { epiWeekLabel } from '../../services/health-levels.ts';
import type { HealthSurveillanceState } from '../../services/health-surveillance.ts';
import { HEALTH_NOW, isoMonday, surveillanceFixture, weekId } from './health.fixture.ts';
import { renderLayerView } from './frame.ts';
import { NBSP, breakableValue, visibleText } from './format.ts';
import { PER_100K } from './health-format.ts';
import { VEILLE_TABS, buildVeilleFranceView, nationalSummary, veilleTabs, type VeilleViewInput } from './veille.ts';

const NNBSP = ' ';
const open = (_: string, d: boolean): boolean => d;
const input = (over: Partial<VeilleViewInput> = {}): VeilleViewInput => ({ state: surveillanceFixture(), tab: 'france', now: HEALTH_NOW, open, ...over });
const view = (over: Partial<VeilleViewInput> = {}) => buildVeilleFranceView(input(over));
const html = (over: Partial<VeilleViewInput> = {}): string => renderLayerView('health', view(over));
const sectionOf = (id: string, over: Partial<VeilleViewInput> = {}) => view(over).sections.find((s) => s.id === id);
function withState(edit: (s: HealthSurveillanceState) => void): HealthSurveillanceState {
  const s = surveillanceFixture();
  edit(s);
  return s;
}

describe('vue Veille sanitaire, onglet France (spec 2026-10-03 § 3.1)', () => {
  it('niveau national : quatre entrées datées ; Jaune le 03/10 (alertes, urgences et eaux usées jaunes, Sentinelles vert)', () => {
    const n = nationalSummary(surveillanceFixture(), HEALTH_NOW);
    expect(n.level).toBe('jaune');
    expect(n.driverPhrase).toBe('eaux usées en forte hausse');
    expect(n.inputs).toEqual([
      { key: 'alerts', level: 'jaune', late: false, label: 'Alertes épidémiques (grippe, bronchiolite)', value: 'hors saison', period: 'S39',
        note: 'Hexagone : hors saison (dernière publication le 13/04 : pas d’alerte) ; outre-mer : grippe en pré-épidémie à Mayotte' },
      { key: 'sentinelles', level: 'vert', late: false, label: 'Médecine générale (Sentinelles)', value: 'activité faible', period: 'S39',
        note: `IRA 151 ${PER_100K}, semaine provisoire` },
      { key: 'urgences', level: 'jaune', late: false, label: 'Urgences, gastro-entérite', value: `1,10${NBSP}% des passages`, period: 'S39',
        note: `au-dessus des 3 saisons précédentes à la même semaine (maximum 1,06${NBSP}%)` },
      { key: 'wastewater', level: 'jaune', late: false, label: 'Eaux usées, COVID-19', value: '×2 en 2 semaines', period: 'S38',
        note: `indicateur 54 stations : 1${NNBSP}839 en S38 (+44${NBSP}% sur S37) ; même semaine 2025 : 3${NNBSP}340` },
    ]);
  });
  it('en-tête S39 : gros chiffre Sentinelles vert, hausse en rouge, pastille Jaune, ligne de niveau, synthèse', () => {
    const v = view();
    expect(v.head).toMatchObject({ theme: 'Santé', title: 'Veille sanitaire', level: 'jaune' });
    expect(v.head.figure).toMatchObject({ value: '151', level: 'vert', caption: `cas d’IRA ${PER_100K} · médecine générale, S39 (21-27 sept.) · en hausse` });
    expect(v.head.figure?.captionHtml).toBe(`cas d’IRA ${PER_100K} · médecine générale, S39 (21-27 sept.) · <span class="lp-val fmk-num lp-lvl lp-lvl--rouge">en hausse</span>`);
    expect(v.head.status).toEqual(['eaux usées en forte hausse', 'S39 · publiée le 30/09', 'Santé publique France, Sentinelles']);
    expect(v.head.lead).toBe('Infections respiratoires en hausse de rentrée, encore sous le niveau des saisons précédentes. '
      + 'COVID-19 en forte hausse dans les eaux usées (×2 en 2 semaines). Grippe en pré-épidémie à Mayotte.');
    expect(html()).toContain('<b class="fmk-num lp-lvl lp-lvl--vert">151</b>');
    expect(html()).toContain('fm-vig--jaune');
  });
  it('onglets : France, Outre-mer (2 territoires), International (2 messages OMS en 30 jours), Produits (180 situations actives)', () => {
    expect(VEILLE_TABS).toEqual(['france', 'outremer', 'international', 'produits']);
    expect(view().tabs).toEqual([
      { id: 'france', label: 'France' }, { id: 'outremer', label: 'Outre-mer', count: 2 },
      { id: 'international', label: 'International', count: 2 }, { id: 'produits', label: 'Produits', count: 180 },
    ]);
    expect(view().activeTab).toBe('france');
    expect(veilleTabs(null, HEALTH_NOW).map((t) => t.count ?? null)).toEqual([null, null, null, null]);
  });
  it('sections de l’onglet France : ordre et ouverture de la spec', () => {
    expect(view().sections.map((s) => [s.id, s.open ?? false])).toEqual([
      ['national', true], ['alerts', false], ['sentinelles', true], ['wastewater', true], ['ministry', true], ['method', false],
    ]);
    expect(view().sections.at(-1)?.tone).toBe('reference');
  });
  it('niveau national : puce, valeur, période, règle en une ligne ; résumé par niveau', () => {
    const s = sectionOf('national');
    expect(visibleText(s?.summary ?? '')).toBe('Jaune3 Vert1');
    const h = s?.html ?? '';
    expect(h).toMatch(/fmk-dot--jaune[^]*Alertes épidémiques \(grippe, bronchiolite\)[^]*hors saison/);
    expect(h).toMatch(new RegExp(`fmk-dot--jaune[^]*Urgences, gastro-entérite[^]*1,10${NBSP}% des passages`));
    expect(h.indexOf('Médecine générale (Sentinelles)')).toBeLessThan(h.indexOf('Urgences, gastro-entérite'));
    expect(h).toContain('Règle : ×1,5 en 2 semaines ou au-dessus de l’an dernier : jaune ; les deux : orange ; sinon vert');
    expect(h).toContain(' · S38');
    expect(h).toContain('une entrée en retard est écartée et nommée ici');
  });
  it('alertes épidémiques : hors saison avec la dernière publication (S4), Mayotte en saison, phase 4 sans couleur hors saison', () => {
    const s = sectionOf('alerts');
    expect(s?.summary).toBe('Hexagone hors saison · Mayotte : grippe en pré-épidémie');
    const h = s?.html ?? '';
    expect(h).toContain('grippe : hors saison (dernière publication le 13/04 : pas d’alerte) · bronchiolite : hors saison (dernière publication le 13/04 : pas d’alerte)');
    expect(h).toMatch(/fmk-dot--jaune[^]*Mayotte[^]*grippe : pré-épidémie · bronchiolite : hors saison \(dernière publication le 13\/04 : post-épidémie\)/);
    expect(h).toContain('grippe : hors saison (dernière publication le 06/04 : épidémie)');
    expect(h).not.toContain('niveau 1');
    expect(h.indexOf('Auvergne-Rhône-Alpes')).toBeLessThan(h.indexOf('Île-de-France'));
    expect(h.indexOf('Provence-Alpes-Côte d’Azur')).toBeLessThan(h.indexOf('Guadeloupe'));
  });
  it('médecine générale : taux officiels, IC 95 %, semaine précédente, flèches, régions les plus touchées, provisoire', () => {
    const s = sectionOf('sentinelles');
    expect(s?.summary).toBe('IRA 151 · activité faible');
    const h = s?.html ?? '';
    expect(h).toContain(`<th scope="col">Cas pour 100${NNBSP}000 hab.</th><th scope="col">S39</th><th scope="col">IC 95${NBSP}%</th><th scope="col">S38</th>`);
    expect(h).toContain('<th scope="row">IRA</th><td><b class="lp-val fmk-num">151</b><span class="lp-trend lp-lvl lp-lvl--rouge" aria-label="en hausse">▲</span></td><td class="lp-faint">144 à 158</td><td class="lp-faint">103</td>');
    expect(h).toContain('<th scope="row">dont grippe</th><td><span class="lp-val fmk-num">4</span><span class="lp-trend" aria-label="stable">=</span></td>');
    expect(h).toContain('<th scope="row">Varicelle</th><td><span class="lp-val fmk-num">4</span><span class="lp-trend lp-lvl lp-lvl--rouge" aria-label="en hausse">▲</span>');
    expect(h).toMatch(/Bourgogne-Franche-Comté[^]*310[^]*Bretagne[^]*254[^]*Hauts-de-France[^]*186/);
    expect(h).not.toContain('Corse');
    expect(h).toContain('semaine S39 provisoire');
    expect(h).toContain('href="https://www.sentiweb.fr/6917.pdf"');
  });
  it('eaux usées : courbe 26 semaines au niveau jaune, même semaine 2025 en pointillé, hausse en rouge, stations', () => {
    const s = sectionOf('wastewater');
    expect(s?.summary).toBe('×2 en 2 semaines · S38');
    const h = s?.html ?? '';
    expect(h).toContain('role="img"');
    expect(h).toMatch(/<polyline points="[^"]+" fill="none" stroke="var\(--sev-yellow\)" stroke-width="2"\/>/);
    expect(h).toContain('stroke-dasharray="4 3"');
    expect(h).toContain(`<span class="lp-val fmk-num">1${NNBSP}839</span> <span class="lp-val fmk-num lp-lvl lp-lvl--rouge">+44${NBSP}%</span>`);
    expect(h).toMatch(new RegExp(`Même semaine 2025[^]*3${NNBSP}340`));
    expect(h).toContain('48 stations sur 55');
    expect(h).toContain('<i class="lp-dash"></i>même semaine 2025');
    expect(h).toContain('à lire en tendance');
  });
  it('messages du ministère : quatre derniers datés, version mise à jour dite, « 2 autres », mention PEPS et lien officiel', () => {
    const s = sectionOf('ministry');
    expect(s?.summary).toBe('DGS-Urgent 2026_12 du 28/09');
    const h = s?.html ?? '';
    expect(h).toMatch(/DGS-Urgent 2026_12[^]*28\/09[^]*Campagne de vaccination 2026-2027 contre la grippe saisonnière et le COVID-19 \(version mise à jour\)/);
    expect(h.indexOf('MARS 2026_14')).toBeLessThan(h.indexOf('DGS-Urgent 2026-11'));
    expect(h).toContain('DGS-Urgent 2026-10');
    expect(h).not.toContain('MARS 2026_09');
    expect(h).toContain('2 autres messages depuis 12 mois.');
    expect(h).toContain('Messages relayés par le portail PEPS du ministère ; un message peut manquer');
    expect(h).toContain('href="https://sante.gouv.fr/ministere/informations-pratiques/site/dgs-urgent"');
  });
  it('méthode et sources : huit sources datées, règles de retard, hors saison n’est pas un retard', () => {
    const s = sectionOf('method');
    expect(s?.summary).toBe('8 sources');
    const t = visibleText(s?.html ?? '');
    for (const part of ['S39, publiée le 30/09', 'dernière semaine S39 ; 2 codes de région sans libellé écartés (07, 08)', 'S39 provisoire',
      'S38, publiée le 30/09', 'dernier message le 02/10', 'dernier message le 28/09', 'liste mise à jour le 02/10', 'dernière publication le 02/10',
      'Hors saison n’est pas un retard', 'au-delà de 17 jours après la fin de la semaine']) expect(t).toContain(part);
  });
  it('Sentinelles en retard (S35) : chiffre sans couleur, « (en retard) », entrée écartée et nommée, pastille sur les autres', () => {
    const late = { id: weekId(2026, 35), start: isoMonday(2026, 35), end: '2026-08-30' };
    const state = withState((s) => { if (s.sentinelles.data) s.sentinelles.data.week = late; });
    const v = view({ state });
    expect(v.head.figure?.level ?? null).toBeNull();
    expect(v.head.figure?.caption).toBe(`cas d’IRA ${PER_100K} · médecine générale, ${epiWeekLabel(late)} · en hausse (en retard)`);
    expect(v.head.figure?.captionHtml).not.toContain('lp-lvl');
    const n = nationalSummary(state, HEALTH_NOW);
    expect(n.inputs[1]).toMatchObject({ key: 'sentinelles', late: true, period: 'S35' });
    expect(n.level).toBe('jaune');
    const s = v.sections.find((x) => x.id === 'national');
    expect(s?.html).toContain('en retard : écartée du niveau national');
    expect(visibleText(s?.summary ?? '')).toBe('Jaune3 · 1 en retard');
    expect(v.sections.find((x) => x.id === 'sentinelles')?.html).not.toContain('lp-lvl--rouge');
  });
  it('hors saison partout : entrée verte dite « hors saison », pas de phrase d’alerte dans la synthèse (S4)', () => {
    const state = withState((s) => {
      const may = s.alerts.data?.levels.find((l) => l.region === '06' && l.pathology === 'grippe');
      if (may) { may.week = weekId(2026, 16); may.start = isoMonday(2026, 16); }
    });
    expect(nationalSummary(state, HEALTH_NOW).inputs[0]).toMatchObject({
      level: 'vert', value: 'hors saison', note: 'Hexagone : hors saison (dernière publication le 13/04 : pas d’alerte) ; outre-mer : hors saison',
    });
    expect(view({ state }).head.lead).not.toContain('Mayotte');
    expect(view({ state }).sections.find((x) => x.id === 'alerts')?.summary).toBe('Hexagone hors saison');
  });
  it('source en échec sans donnée : « source indisponible » dans la section et dans « Méthode et sources », entrée n.d. (S3)', () => {
    const state = withState((s) => { s.sentinelles = { data: null, error: 'HTTP 429', fetchedAt: null }; });
    const v = view({ state });
    expect(v.head.figure).toEqual({ value: 'n.d.', caption: `cas d’IRA ${PER_100K} · médecine générale` });
    expect(nationalSummary(state, HEALTH_NOW).inputs[1]).toMatchObject({ level: 'nd', value: 'n.d.', note: 'source indisponible' });
    expect(v.sections.find((x) => x.id === 'sentinelles')?.html).toContain('Source indisponible : réseau Sentinelles.');
    const method = v.sections.find((x) => x.id === 'method');
    expect(visibleText(method?.html ?? '')).toMatch(/Réseau Sentinelles · source indisponible/);
    expect(method?.summary).toBe('8 sources · 1 indisponible');
  });
  it('panne partielle, Odissé en échec et pages régionales lues : entrée n.d. nommée et écartée, jamais verte ; section indisponible (S3)', () => {
    const state = withState((s) => {
      if (s.alerts.data) s.alerts.data = { ...s.alerts.data, levels: [], latestWeek: null, errors: ['Odissé, niveaux d’alerte : HTTP 429'] };
    });
    const n = nationalSummary(state, HEALTH_NOW);
    expect(n.inputs[0]).toMatchObject({ key: 'alerts', level: 'nd', value: 'n.d.', period: 'n.d.', note: 'source indisponible', unavailable: true });
    expect(n.level).toBe('jaune');
    const v = view({ state });
    const national = v.sections.find((x) => x.id === 'national');
    expect(visibleText(national?.summary ?? '')).toBe('Jaune2 Vert1 · 1 indisponible');
    expect(visibleText(national?.html ?? '')).toContain('source indisponible : écartée du niveau national');
    const alerts = v.sections.find((x) => x.id === 'alerts');
    expect(alerts?.summary).toBe('n.d.');
    expect(alerts?.html).toContain('Source indisponible : niveaux d’alerte Odissé.');
    expect(alerts?.html).not.toContain('Aucun niveau d’alerte publié');
  });
  it('panne partielle, export France de l’IRA en échec : entrée Urgences n.d. nommée (jamais calculée sur les autres syndromes)', () => {
    const state = withState((s) => {
      const d = s.syndromic.data;
      if (!d) return;
      d.errors = ['Odissé, IRA France : HTTP 500'];
      for (const x of d.syndromes) if (x.key === 'ira') { x.france = []; x.ages = {}; }
    });
    expect(nationalSummary(state, HEALTH_NOW).inputs[2]).toMatchObject({
      key: 'urgences', level: 'nd', value: 'n.d.', note: 'source indisponible (IRA)', unavailable: true,
    });
  });
  it('toutes les sources en échec : pastille n.d., encadré, aucune synthèse inventée', () => {
    const state = withState((s) => {
      for (const k of Object.keys(s) as Array<keyof HealthSurveillanceState>) s[k] = { data: null, error: 'HTTP 502', fetchedAt: null };
    });
    const v = view({ state });
    expect(v.head.level).toBe('nd');
    expect(v.head.status).toEqual(['niveau national n.d.', 'Santé publique France, Sentinelles']);
    expect(v.bodyHtml).toContain('Source injoignable. Aucune donnée reçue.');
    expect(v.head.lead ?? null).toBeNull();
    expect(html({ state })).toContain('fm-vig--nd');
  });
  it('chargement : loader unique, aucune section', () => {
    const v = view({ state: null });
    expect(v.head.status).toEqual(['chargement…']);
    expect(v.bodyHtml).toContain('Chargement des données…');
    expect(v.sections).toEqual([]);
  });
  it('textes hostiles échappés ; R1 ; aucun tiret cadratin, aucune police à chasse fixe, aucune couleur brute', () => {
    const evil = '<img src=x onerror=1>';
    const state = withState((s) => {
      if (s.alerts.data) s.alerts.data.levels[0].regionName = evil;
      if (s.sentinelles.data) s.sentinelles.data.topRegions[0].region = evil;
      if (s.ministry.data) s.ministry.data.messages[1].title = evil;
    });
    expect(html({ state })).not.toContain('<img');
    const h = html();
    expect(breakableValue(visibleText(h))).toBeNull();
    expect(h).not.toMatch(/\u2014|&mdash;|monospace|#[0-9a-fA-F]{6}\b|rgba?\(/);
  });
  it('CSS : tableau des panneaux, cellules insécables, pointillé de légende', () => {
    const css = readFileSync(new URL('../../styles/main.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.lp \.lp-tbl td \{[^}]*white-space: nowrap/);
    expect(css).toContain('.lp .lp-key i.lp-dash');
  });
});
