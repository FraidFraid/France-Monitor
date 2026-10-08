// src/components/layer-panel/outages-telecom.test.ts
// Vue pure du panneau Télécoms (spec 2026-10-08 panneaux pannes § 2.1) sur le jeu d'essai réel du 08/10/2026 : gros chiffre, sections,
// pagination, fichier de la veille (normal avant 15 h), fichier en retard (couleurs retirées), source muette (n.d.), hygiène du rendu.
import { describe, expect, it } from 'vitest';
import type { TelecomOutagesResponse, TelecomSite } from '../../types/index.ts';
import { renderLayerView } from './frame.ts';
import { NBSP, breakableValue, visibleText } from './format.ts';
import { buildTelecomView, TELECOM_PAGE, TELECOM_TITLE, type TelecomViewInput } from './outages-telecom.ts';
import { OUTAGES_FIXTURE_NOW, telecomFixtureResponse } from './outages.fixture.ts';

const open = (): boolean => true;
const view = (over: Partial<TelecomViewInput> = {}) => buildTelecomView({
  telecom: telecomFixtureResponse(), error: null, canFocus: true, now: OUTAGES_FIXTURE_NOW, open, shown: TELECOM_PAGE, ...over,
});
const html = (over: Partial<TelecomViewInput> = {}): string => renderLayerView('outagesTelecom', view(over));
const text = (over: Partial<TelecomViewInput> = {}): string => visibleText(html(over));
const section = (over: Partial<TelecomViewInput>, id: string): string => view(over).sections.find((s) => s.id === id)?.html ?? '';
const count = (h: string, re: RegExp): number => (h.match(re) ?? []).length;

describe('vue Télécoms (jeu d’essai du 08/10)', () => {
  it('en-tête : 18 antennes en panne imprévue depuis moins de 24 h, vert (6 au plus dans un département), fichier daté', () => {
    const v = view();
    expect(v.head.title).toBe(TELECOM_TITLE);
    expect(v.head.figure).toMatchObject({ value: '18', caption: `antennes en panne imprévue depuis moins de 24${NBSP}h` });
    expect(v.head.level).toBe('vert');
    expect(v.head.status).toEqual([`fichier ARCEP du 08/10, publié à 11${NBSP}h${NBSP}02`]);
    expect(html()).toContain('lp-lvl--vert');
  });
  it('sections : opérateurs, départements, depuis la veille, ancienneté, pannes récentes, maintenances, courbe, méthode', () => {
    expect(view().sections.map((s) => s.id)).toEqual(['operateurs', 'departements', 'evolution', 'anciennete', 'recentes', 'maintenances', 'courbe', 'methode']);
    const t = text();
    expect(t).toContain('Free');
    expect(t).toContain('Aisne (02)');
    expect(t).toContain(`23${NBSP}nouvelles`);
    expect(t).toContain(`3${NBSP}rétablies`);
    expect(t).toContain(`plus de 30${NBSP}jours`);
    expect(t).toContain('Haute-Corse (2B)');
    expect(t).toContain('Depuis le fichier du 07/10');
    expect(t).not.toMatch(/temps r[ée]el|\u2014/i);
  });
  it('lignes de département cliquables seulement avec un gestionnaire de carte ; idem pour le bouton des maintenances', () => {
    expect(html()).toContain('data-dept="02"');
    expect(html()).toContain('data-option="maintenances"');
    const bare = html({ canFocus: false });
    expect(bare).not.toContain('data-dept=');
    expect(bare).not.toContain('data-site=');
    expect(bare).not.toContain('data-option=');
  });
  it('pagination : 5 lignes de pannes récentes (maintenances à part) puis « Afficher 13 de plus », 18 lignes sans bouton', () => {
    const five = section({ shown: 5 }, 'recentes');
    expect(count(five, /data-site="/g)).toBe(5);
    expect(five).toContain('data-more="recentes"');
    expect(visibleText(five)).toContain(`Afficher 13 de plus (13${NBSP}restantes)`);
    const all = section({ shown: TELECOM_PAGE }, 'recentes');
    expect(count(all, /data-site="/g)).toBe(18);
    expect(all).not.toContain('data-more=');
  });
  it('classes et couleurs : récentes en rouge de catégorie, maintenances en gris de catégorie, longues absentes de la liste récente', () => {
    const t = telecomFixtureResponse();
    expect(section({}, 'recentes')).toContain('var(--cat-out-recent)');
    expect(section({}, 'maintenances')).toContain('var(--cat-out-maint)');
    expect(count(section({}, 'maintenances'), /data-site="/g)).toBe(t.sites.filter((s) => s.cls === 'maintenance').length);
    const longIds = t.sites.filter((s) => s.cls === 'longue').map((s) => s.id);
    for (const id of longIds) expect(section({}, 'recentes')).not.toContain(`data-site="${id}"`);
  });
  it('R19 : à 9 h le lendemain, fichier de la veille : ligne « fichier ARCEP de la veille », pas « (en retard) », couleurs gardées', () => {
    const v = view({ now: Date.parse('2026-10-09T09:00:00+02:00') });
    expect(v.head.status).toEqual([`fichier ARCEP de la veille (08/10), publié à 11${NBSP}h${NBSP}02`]);
    expect(v.head.status.join(' ')).not.toContain('(en retard)');
    expect(v.head.level).toBe('vert');
    expect(v.head.figure?.level).toBeUndefined();
    const h = html({ now: Date.parse('2026-10-09T09:00:00+02:00') });
    expect(h).toContain('lp-lvl--vert');
    expect(h).toContain('var(--cat-out-recent)');
    expect(h).not.toContain('background:var(--text-muted)');
    expect(h).not.toContain('stroke="var(--text-muted)"');
  });
  it('jour de Paris : à 00 h 30 le 09/10 (22 h 30 UTC le 08/10), le fichier du 08/10 est celui de la veille, pas « du jour »', () => {
    const v = view({ now: Date.parse('2026-10-09T00:30:00+02:00') });
    expect(v.head.status[0]).toContain('fichier ARCEP de la veille (08/10)');
    // 22 h 30 UTC le 08/10 est déjà le 09/10 à Paris : un jour UTC dirait « du 08/10 ».
    expect(v.head.status[0]).not.toContain('fichier ARCEP du 08/10');
  });
  it('fichier de la veille à 16 h : « (en retard) », niveau n.d., chiffre sans couleur, plus aucune couleur de catégorie', () => {
    const now = Date.parse('2026-10-09T16:00:00+02:00');
    const v = view({ now });
    expect(v.head.level).toBe('nd');
    expect(v.head.figure?.level).toBeNull();
    expect(v.head.status.join(' ')).toContain('(en retard)');
    const h = html({ now });
    expect(h).not.toContain('var(--cat-out-');
    expect(h).not.toMatch(/lp-lvl--(vert|jaune|orange|rouge)/);
    expect(h).toContain('background:var(--text-muted)');
    expect(h).toContain('stroke="var(--text-muted)"');
    expect(v.head.figure?.value).toBe('18');
  });
  it('fichier plus ancien que la veille : « du jj/mm » et « (en retard) »', () => {
    const v = view({ now: Date.parse('2026-10-11T10:00:00+02:00') });
    expect(v.head.status).toEqual([`fichier ARCEP du 08/10, publié à 11${NBSP}h${NBSP}02 (en retard)`]);
  });
  it('jamais lu, source en panne : n.d., panne nommée, jamais « aucune panne »', () => {
    const v = view({ telecom: null, error: 'ARCEP : HTTP 503' });
    expect(v.head.figure?.value).toBe('n.d.');
    expect(v.head.level).toBe('nd');
    expect(v.sections).toEqual([]);
    expect(visibleText(v.bodyHtml ?? '')).toContain('ARCEP : HTTP 503');
    expect(text({ telecom: null, error: 'ARCEP : HTTP 503' })).not.toMatch(/aucune panne/i);
  });
  it('réponse sans fichier lu (introuvable sur 10 jours) : n.d. et erreurs du serveur nommées', () => {
    const empty: TelecomOutagesResponse = { ...telecomFixtureResponse(), file: null, previousFile: null, summary: null, sites: [], byOperator: [], byDept: [], errors: ['ARCEP : fichier introuvable sur 10 jours'] };
    const v = view({ telecom: empty });
    expect(v.head.figure?.value).toBe('n.d.');
    expect(v.head.level).toBe('nd');
    expect(visibleText(v.bodyHtml ?? '')).toContain('ARCEP : fichier introuvable sur 10 jours');
  });
  it('relève en échec avec des données gardées : sections gardées, encadré daté du fichier', () => {
    const v = view({ error: 'ARCEP : HTTP 503' });
    expect(v.sections).toHaveLength(8);
    expect(visibleText(v.bodyHtml ?? '')).toContain('Source injoignable. Dernières données :');
  });
  it('chargement : corps de chargement, aucune section', () => {
    const v = view({ telecom: null, error: null });
    expect(v.sections).toEqual([]);
    expect(v.bodyHtml).toContain('Chargement');
  });
});

describe('hygiène du rendu', () => {
  const site = (over: Partial<TelecomSite>): TelecomSite => ({ ...telecomFixtureResponse().sites[0], ...over });
  const hostile = (): TelecomOutagesResponse => {
    const t = telecomFixtureResponse();
    t.sites[0] = site({ id: '"><script>x</script>', commune: '<img src=x onerror=alert(1)>', operator: '<b>X</b>', detail: '<i>Y</i>', cls: 'recente' });
    t.byOperator[0] = { ...t.byOperator[0], operator: '<u>Z</u>' };
    return t;
  };
  const oneFile = (): TelecomOutagesResponse => ({ ...telecomFixtureResponse(), history: [{ day: '2026-10-08', recent: 18 }] });
  const noPrevious = (): TelecomOutagesResponse => {
    const t = telecomFixtureResponse();
    return { ...t, previousFile: null, summary: t.summary === null ? null : { ...t.summary, newSincePrevious: null, resolvedSincePrevious: null, undated: 1 } };
  };
  const variants: Array<Partial<TelecomViewInput>> = [
    {}, { shown: 5 }, { canFocus: false }, { now: Date.parse('2026-10-09T09:00:00+02:00') }, { now: Date.parse('2026-10-09T16:00:00+02:00') },
    { now: Date.parse('2026-10-11T10:00:00+02:00') }, { error: 'ARCEP : HTTP 503' }, { telecom: null, error: 'ARCEP : HTTP 503' }, { telecom: null },
    { telecom: hostile() }, { telecom: oneFile() }, { telecom: noPrevious() },
  ];
  it('aucun tiret cadratin, aucune couleur brute, jamais « temps réel » ni « LIVE »', () => {
    for (const over of variants) {
      const h = html(over);
      expect(h).not.toMatch(/\u2014|&mdash;|#[0-9a-fA-F]{6}\b|rgba?\(/);
      expect(visibleText(h)).not.toMatch(/temps réel|TEMPS RÉEL|\bLIVE\b|aucune panne\b/i);
    }
  });
  it('R1 : aucune valeur coupée entre nombre et unité', () => {
    for (const over of variants) {
      const v = view(over);
      const texts = [v.head.figure?.caption ?? '', ...v.head.status, v.head.lead ?? '', visibleText(v.bodyHtml ?? ''),
        ...v.sections.map((s) => visibleText(`${s.summary ?? ''} ${s.html}`))];
      for (const t of texts) expect(breakableValue(t), t.slice(0, 80)).toBeNull();
    }
  });
  it('textes tiers échappés (commune, opérateur, détail, identifiant de site)', () => {
    const h = html({ telecom: hostile() });
    expect(h).not.toContain('<img src=x');
    expect(h).not.toContain('<b>X</b>');
    expect(h).not.toContain('<i>Y</i>');
    expect(h).not.toContain('<u>Z</u>');
    expect(h).not.toContain('<script>');
    expect(h).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
