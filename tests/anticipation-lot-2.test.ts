// tests/anticipation-lot-2.test.ts : compte des crises manquées, règles « lycées » et « fausses alertes », suspension (13/11/2026).
// Les titres sont ceux des 35 « crises manquées » consignées en production du 4 au 13 novembre 2026.
import { describe, expect, it } from 'vitest';
// @ts-expect-error module JS sans déclaration
import { pressTags } from '../api/_lib/anticipation/press-tags.js';
// @ts-expect-error module JS sans déclaration
import { isCrisis, missedCrises } from '../api/_lib/anticipation/closing.js';
// @ts-expect-error module JS sans déclaration
import lycees, { nextSchoolWindow } from '../api/_lib/anticipation/rules/lycees-mobilisation.js';
// @ts-expect-error module JS sans déclaration
import alertes from '../api/_lib/anticipation/rules/alertes-serie.js';
// @ts-expect-error module JS sans déclaration
import { buildBilan } from '../api/_lib/anticipation/bilan.js';
// @ts-expect-error module JS sans déclaration
import { RULES } from '../api/_lib/anticipation/rules/index.js';
// @ts-expect-error module JS sans déclaration
import { archivedCopy } from '../api/_lib/anticipation/registry.js';

const NOW = Date.parse('2026-11-05T08:00:00Z'); // jeudi, 9 h à Paris
const H = 3_600_000;
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const ctx = (over: Record<string, unknown> = {}) => ({ now: NOW, unknown: [], precedent: () => null, ...over });

function press(id: string, dept: string, title: string, over: Record<string, unknown> = {}) {
  const tags = pressTags(title, dept);
  return {
    id, kind: 'presse', domain: 'press', source: 'x', origin: `presse:event:${id}`, official: false, dept: [dept], communes: [], level: 'orange', value: null, window: null,
    publishedAt: ago(2 * H), observedAt: ago(H), checkedAt: ago(H), ref: 'https://x', meta: { eventId: 1, category: 'security', severity: 'high', title, ...tags }, ...over,
  };
}
const rally = (id: string, dept: string) => ({
  id, kind: 'rassemblement_annonce', domain: 'social', source: 'demosphere', origin: `demosphere:${id}`, official: false, dept: [dept], communes: [], level: null, value: null,
  window: { from: '2026-11-05T13:00:00.000Z', to: '2026-11-05T16:00:00.000Z' }, publishedAt: ago(20 * H), observedAt: ago(H), checkedAt: ago(H), ref: 'https://x', meta: {},
});

describe('pressTags', () => {
  it('reconnaît les incidents dans les lycées et les alertes à la bombe', () => {
    expect(pressTags("«Restez confinés» : des mortiers d'artifice tirés dans les couloirs d'un lycée à Chelles", '77').topic).toBe('lycee');
    expect(pressTags("Le ministre de l'Education nationale annonce une plainte après un tir de mortier dans l'enceinte d'un lycée de Lille", '59')).toMatchObject({ topic: 'lycee', nature: 'fait' });
    expect(pressTags('Un lycée évacué après une alerte à la bombe à Marseille', '13').topic).toBe('alerte_bombe');
    expect(pressTags('Explosion devant les locaux de la Corsica Linea à Ajaccio', '2A')).toEqual({ topic: null, nature: 'fait', placeDoubt: false });
  });
  it('écarte les suites d’un fait passé, même sur un sujet reconnu', () => {
    expect(pressTags("Assassinat du professeur Dominique Bernard : l'assaillant est renvoyé aux assises, non-lieu pour son frère", '62').nature).toBe('suite');
    expect(pressTags("Attentat raciste dans les Yvelines : l'interrogatoire glaçant de Kévin T.", '78').nature).toBe('suite');
    expect(pressTags('Le dessin du vendredi 13 novembre : de fausses alertes à la bombe dans des écoles en France', '24')).toMatchObject({ topic: null, nature: 'suite' });
  });
  it('écarte les faits divers, sauf attentat', () => {
    expect(pressTags('Créteil : une sexagénaire retrouvée éviscérée à son domicile, son fils interpellé à Paris', '75').nature).toBe('fait_divers');
    expect(pressTags('Une cinquantenaire tuée de plusieurs coups de fusil', '60').nature).toBe('fait_divers');
    expect(pressTags('Attentat : un homme tué par balle devant une mosquée', '78').nature).toBe('fait');
  });
  it('doute du lieu quand le titre nomme un autre département', () => {
    expect(pressTags("Loire-Atlantique : un homme de 40 ans retrouvé tué par balle près d'une plage", '54').placeDoubt).toBe(true);
    expect(pressTags('Essonne: la députée légèrement blessée par un tir de mortier', '69').placeDoubt).toBe(true);
    expect(pressTags('Essonne: la députée légèrement blessée par un tir de mortier', '91').placeDoubt).toBe(false);
    // Noms courants ignorés : « parquet de Paris », « le nord ».
    expect(pressTags('Alertes à la bombe : une enquête ouverte par le parquet de Paris', '81').placeDoubt).toBe(false);
  });
});

describe('crises manquées : faits nouveaux au lieu certain', () => {
  it('ne compte ni suite, ni fait divers, ni lieu contredit', () => {
    expect(isCrisis(press('a', '14', 'Des casseurs à l’assaut de deux lycées à Caen, les élèves évacués'))).toBe(true);
    expect(isCrisis(press('b', '78', "Attentat de Trappes : le message fort de Thierry Henry"))).toBe(false);
    expect(isCrisis(press('c', '60', 'Une cinquantenaire tuée de plusieurs coups de fusil'))).toBe(false);
    expect(isCrisis(press('d', '54', 'Loire-Atlantique : explosion dans une usine'))).toBe(false);
  });
  it('un signal sans étiquette ni titre (ancienne archive) compte comme avant', () => {
    expect(isCrisis({ id: 'x', kind: 'presse', dept: ['31'], meta: { category: 'security', severity: 'high' } })).toBe(true);
  });
  it('la crise consignée cite le titre ; un scénario national ne couvre que son sujet', () => {
    const alert = press('al', '13', 'Un lycée évacué après une alerte à la bombe à Marseille');
    const other = press('ex', '2A', 'Explosion devant les locaux de la Corsica Linea à Ajaccio');
    const open = { id: 'alertes-serie:national:x', ruleId: 'alertes-serie', zone: { dept: [], communes: [] }, openedAt: ago(10 * H), closedAt: null, status: 'ouvert' };
    const out = missedCrises([alert, other], [open], [], NOW);
    expect(out.map((s: { id: string }) => s.id)).toEqual(['manque:ex']);
    expect(out[0].chain[0].text).toContain('Corsica Linea');
  });
  it("l'archive garde les étiquettes, pas le titre", () => {
    const [copy] = archivedCopy([press('a', '77', "Des mortiers d'artifice tirés dans les couloirs d'un lycée à Chelles")]) as Array<{ meta: Record<string, unknown> }>;
    expect(copy.meta).toMatchObject({ topic: 'lycee', nature: 'fait', placeDoubt: false });
    expect(copy.meta.title).toBeUndefined();
  });
});

describe('règle lycées', () => {
  const chelles = press('l1', '77', "Des mortiers d'artifice tirés dans les couloirs d'un lycée à Chelles");
  it('fenêtre : journée de cours en cours, sinon prochain jour de semaine', () => {
    expect(new Date(nextSchoolWindow(NOW).from).toISOString()).toBe('2026-11-05T05:00:00.000Z');
    // Vendredi 17 h à Paris : lundi suivant.
    expect(new Date(nextSchoolWindow(Date.parse('2026-11-06T16:00:00Z')).from).toISOString()).toBe('2026-11-09T05:00:00.000Z');
  });
  it('un incident local ouvre une possibilité réelle ; avec un rassemblement, probable', () => {
    const [one] = lycees.evaluate([chelles], ctx());
    expect(one).toMatchObject({ ruleId: 'lycees-mobilisation', zone: { dept: ['77'] }, word: 'possibilite_reelle' });
    expect(one.chain.at(-1).text).toContain('Hypothèse');
    const [two] = lycees.evaluate([chelles, rally('r1', '77')], ctx());
    expect(two.word).toBe('probable');
    expect(two.chain).toHaveLength(3);
  });
  it('mouvement national : un seul scénario pour le reste du pays, jamais un par département où un rassemblement est annoncé', () => {
    const wave = [chelles, press('l2', '31', 'Un lycée près de Toulouse incendié par des tirs de mortier'), press('l3', '14', 'Des casseurs à l’assaut de deux lycées à Caen')];
    const out = lycees.evaluate([...wave, rally('r2', '69'), rally('r3', '33')], ctx());
    expect(out.map((c: { zone: { dept: string[] } }) => c.zone.dept[0] ?? 'national')).toEqual(['14', '31', '77', 'national']);
    const nat = out.at(-1);
    expect(nat.chain[0].text).toContain('3 départements en 24 h (14, 31, 77)');
    // Arrivée du scénario national : un incident dans un département épargné à l'ouverture, pas un de plus dans un département déjà touché.
    const scenario = { ...nat, openedAt: new Date(NOW).toISOString() };
    const later = new Date(NOW + 3 * H).toISOString();
    expect(lycees.arrived(scenario, [...wave, press('n1', '77', 'Meaux : un lycée évacué après des tirs de mortier', { publishedAt: later })], { now: NOW + 4 * H, unknown: [] })).toBeNull();
    expect(lycees.arrived(scenario, [...wave, press('n2', '64', 'A Pau, deux lycéens interpellés après des tirs de mortiers', { publishedAt: later })], { now: NOW + 4 * H, unknown: [] })).toBe('arrive');
    // Sans mouvement national, un rassemblement ailleurs n'ouvre rien.
    expect(lycees.evaluate([chelles, rally('r2', '69')], ctx()).map((c: { zone: { dept: string[] } }) => c.zone.dept[0])).toEqual(['77']);
  });
  it('ignore un incident ancien, une suite ou un lieu douteux', () => {
    expect(lycees.evaluate([{ ...chelles, publishedAt: ago(30 * H) }], ctx())).toEqual([]);
    expect(lycees.evaluate([press('s', '77', 'Procès des tirs de mortier au lycée de Chelles')], ctx())).toEqual([]);
    expect(lycees.evaluate([press('d', '54', 'Essonne : un lycée bloqué par des casseurs')], ctx())).toEqual([]);
  });
  it('arrivée : un incident nouveau, pas celui cité à l’ouverture', () => {
    const [c] = lycees.evaluate([chelles], ctx());
    const scenario = { ...c, openedAt: new Date(NOW).toISOString() };
    const later = new Date(NOW + 3 * H).toISOString();
    expect(lycees.arrived(scenario, [chelles], { now: NOW + 4 * H, unknown: [] })).toBeNull();
    expect(lycees.arrived(scenario, [{ ...chelles, publishedAt: later }], { now: NOW + 4 * H, unknown: [] })).toBeNull();
    expect(lycees.arrived(scenario, [press('n', '77', 'Meaux : un lycée évacué après des tirs de mortier', { publishedAt: later })], { now: NOW + 4 * H, unknown: [] })).toBe('arrive');
    expect(lycees.arrived(scenario, [press('n', '31', 'Toulouse : un lycée évacué après des tirs de mortier', { publishedAt: later })], { now: NOW + 4 * H, unknown: [] })).toBeNull();
    expect(lycees.arrived(scenario, [chelles], { now: NOW + 30 * H, unknown: [] })).toBe('pas_arrive');
    expect(lycees.arrived(scenario, [], { now: NOW + 30 * H, unknown: ['Presse non lue'] })).toBe('indecidable');
  });
});

describe('règle fausses alertes', () => {
  const a = (id: string, dept: string, over: Record<string, unknown> = {}) => press(id, dept, `Alerte à la bombe dans un lycée (${id})`, over);
  it('trois alertes en 24 h ouvrent un scénario national ; cinq le rendent probable', () => {
    expect(alertes.evaluate([a('1', '13'), a('2', '54')], ctx())).toEqual([]);
    const [c] = alertes.evaluate([a('1', '13'), a('2', '54'), a('3', '75')], ctx());
    expect(c).toMatchObject({ zone: { dept: [] }, word: 'possibilite_reelle', window: { from: '2026-11-04T23:00:00.000Z', to: '2026-11-05T23:00:00.000Z' } });
    expect(c.chain[0].text).toBe('3 alertes à la bombe ou fausses alertes relevées par la presse en 24 h, dans 3 départements');
    expect(alertes.evaluate([a('1', '13'), a('2', '54'), a('3', '75'), a('4', '69'), a('5', '31')], ctx())[0].word).toBe('probable');
  });
  it('arrivée : une alerte nouvelle après l’ouverture', () => {
    const cited = [a('1', '13'), a('2', '54'), a('3', '75')];
    const scenario = { ...alertes.evaluate(cited, ctx())[0], openedAt: new Date(NOW).toISOString() };
    expect(alertes.arrived(scenario, cited, { now: NOW + H, unknown: [] })).toBeNull();
    expect(alertes.arrived(scenario, [...cited, a('9', '33', { publishedAt: new Date(NOW + 2 * H).toISOString() })], { now: NOW + 3 * H, unknown: [] })).toBe('arrive');
    expect(alertes.arrived(scenario, cited, { now: NOW + 40 * H, unknown: [] })).toBe('pas_arrive');
  });
});

describe('bilan', () => {
  it('sépare les crises manquées comptées des écartées et signale la règle suspendue', () => {
    const m = (id: string, counted?: boolean) => ({ id, ruleId: 'aucune', status: 'manque', word: '', ...(counted === false ? { counted: false } : {}) });
    const b = buildBilan('2026-11', [m('a'), m('b'), m('c', false)], RULES);
    expect(b).toMatchObject({ missed: 2, missedExcluded: 1, emitted: 0 });
    expect(b.byRule.find((r: { ruleId: string }) => r.ruleId === 'social-cyber').suspended).toBe(true);
    expect(b.byRule.find((r: { ruleId: string }) => r.ruleId === 'lycees-mobilisation').suspended).toBe(false);
  });
});

describe('tirets', () => {
  it('aucun tiret cadratin dans les textes des nouvelles règles', () => {
    const all = JSON.stringify([lycees.evaluate([press('l1', '77', 'Un lycée bloqué à Chelles'), rally('r', '77')], ctx()), lycees.title, lycees.arrivalTest, alertes.title, alertes.arrivalTest]);
    expect(all).not.toContain('—');
  });
});
