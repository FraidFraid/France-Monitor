// tests/anticipation-lot-3.test.ts : règle « crue et inondation » et enjeux exposés (13/11/2026).
// Cas réel : vigilance orange pluie-inondation en Corse publiée le 04/11/2026 pour le 05/11 ; deux morts à Porto-Vecchio.
import { describe, expect, it } from 'vitest';
// @ts-expect-error module JS sans déclaration
import crue from '../api/_lib/anticipation/rules/crue-inondation.js';
// @ts-expect-error module JS sans déclaration
import froid from '../api/_lib/anticipation/rules/froid-electricite.js';
// @ts-expect-error module JS sans déclaration
import neige from '../api/_lib/anticipation/rules/neige-transports.js';
// @ts-expect-error module JS sans déclaration
import { pressTags } from '../api/_lib/anticipation/press-tags.js';
// @ts-expect-error module JS sans déclaration
import { exposureOf, withExposure } from '../api/_lib/anticipation/exposure.js';
// @ts-expect-error module JS sans déclaration
import { archivedCopy } from '../api/_lib/anticipation/registry.js';
import { exposureHtml } from '../src/components/anticipation/scenario-view.ts';
import type { AnticipationScenario } from '../src/types/index.ts';

const NOW = Date.parse('2026-11-04T16:35:00Z');
const H = 3_600_000;
const ctx = (over: Record<string, unknown> = {}) => ({ now: NOW, unknown: [], precedent: () => null, ...over });
const vigi = (dept: string, phenomenon: string, level: string, over: Record<string, unknown> = {}) => ({
  id: `vigi:${dept}:${phenomenon}`, kind: 'vigilance', domain: 'weather', source: 'meteo-france', origin: 'meteo-france', official: true, dept: [dept], communes: [], level, value: null,
  window: { from: '2026-11-05T05:00:00.000Z', to: '2026-11-05T23:00:00.000Z' }, publishedAt: '2026-11-04T15:00:00.000Z', observedAt: '2026-11-04T16:30:00.000Z', checkedAt: '2026-11-04T16:30:00.000Z',
  ref: 'meteo-france:vigilance', meta: { phenomenon, echeance: 'J1' }, ...over,
});
const flood = (id: string, dept: string, title: string, publishedAt: string) => ({
  id, kind: 'presse', domain: 'press', source: 'x', origin: `presse:event:${id}`, official: false, dept: [dept], communes: [], level: 'orange', value: null, window: null,
  publishedAt, observedAt: publishedAt, checkedAt: publishedAt, ref: 'https://x', meta: { eventId: 1, category: 'weather', severity: 'high', title, ...pressTags(title, dept) },
});

describe('étiquette inondation', () => {
  it('exige l’eau et un dégât ; une vigilance annoncée seule ne compte pas', () => {
    expect(pressTags('Maisons inondées, routes coupées...un épisode de pluies intenses à Porto-Vecchio', '2A').topic).toBe('inondation');
    expect(pressTags('Centre-ville de Mandelieu inondé, routes coupées : la tempête Charles déferle', '06').topic).toBe('inondation');
    expect(pressTags('La Corse placée en vigilance orange pluie-inondation à partir de jeudi', '2A').topic).toBeNull();
    expect(pressTags('Près de Lyon, un ex-trafiquant livre sa vérité crue à des ados', '69').topic).toBeNull();
    expect(pressTags('Après la mort de José Capela et face "au risque de débordements", des commerçants font un choix radical', '31').topic).toBeNull();
  });
  it("l'archive garde un article d'inondation hors sécurité et social", () => {
    expect(archivedCopy([flood('f', '2A', 'Maisons inondées, routes coupées à Porto-Vecchio', '2026-11-05T10:00:00.000Z')])).toHaveLength(1);
  });
});

describe('règle crue et inondation', () => {
  it('une vigilance orange J+1 ouvre « probable » sur la fenêtre publiée ; le jaune seul n’ouvre rien', () => {
    expect(crue.evaluate([vigi('2A', 'pluie_inondation', 'jaune')], ctx())).toEqual([]);
    const [c] = crue.evaluate([vigi('2A', 'pluie_inondation', 'orange')], ctx());
    expect(c).toMatchObject({ ruleId: 'crue-inondation', zone: { dept: ['2A'] }, word: 'probable', window: { from: '2026-11-05T05:00:00.000Z', to: '2026-11-05T23:00:00.000Z' } });
    expect(c.chain[0].text).toBe('Vigilance orange pluie-inondation en Corse-du-Sud (Météo-France, Vigicrues)');
    expect(c.evidence.hasOfficial).toBe(true);
    // Même phénomène en jaune à une autre échéance : pas de ligne « sur le même département ».
    const same = crue.evaluate([vigi('2A', 'pluie_inondation', 'orange'), vigi('2A', 'pluie_inondation', 'jaune', { id: 'vigi:2A:pi:J', meta: { phenomenon: 'pluie_inondation', echeance: 'J' } })], ctx())[0];
    expect(same.chain).toHaveLength(2);
  });
  it('rouge, ou deux phénomènes avec premiers dégâts : très probable ; bascules atteintes', () => {
    expect(crue.evaluate([vigi('30', 'crues', 'rouge')], ctx())[0].word).toBe('tres_probable');
    const press = flood('p1', '2B', 'Routes coupées et habitations inondées près de Bastia', '2026-11-04T14:00:00.000Z');
    const [c] = crue.evaluate([vigi('2B', 'pluie_inondation', 'orange'), vigi('2B', 'crues', 'jaune'), press], ctx());
    expect(c.word).toBe('tres_probable');
    expect(c.bascules.map((b: { id: string; state: string }) => [b.id, b.state])).toEqual([['deux_phenomenes', 'atteint'], ['degats', 'atteint'], ['coupures', 'surveille']]);
  });
  it('ignore une vigilance échue ou au-delà de J+1', () => {
    expect(crue.evaluate([vigi('2A', 'crues', 'orange', { window: { from: '2026-11-03T05:00:00.000Z', to: '2026-11-04T05:00:00.000Z' } })], ctx())).toEqual([]);
    expect(crue.evaluate([vigi('2A', 'crues', 'orange', { meta: { phenomenon: 'crues', echeance: 'J2' } })], ctx())).toEqual([]);
  });
  it('arrivée : dégâts nouveaux dans le département pendant la fenêtre, pas ceux déjà cités', () => {
    const cited = flood('p1', '2A', 'Routes coupées et caves inondées à Ajaccio', '2026-11-04T14:00:00.000Z');
    const scenario = { ...crue.evaluate([vigi('2A', 'pluie_inondation', 'orange'), cited], ctx())[0], openedAt: new Date(NOW).toISOString() };
    const during = '2026-11-05T12:00:00.000Z';
    expect(crue.arrived(scenario, [cited], { now: NOW + 20 * H, unknown: [] })).toBeNull();
    expect(crue.arrived(scenario, [flood('p2', '2B', 'Maisons inondées à Bastia, des habitants évacués', during)], { now: NOW + 20 * H, unknown: [] })).toBeNull();
    expect(crue.arrived(scenario, [flood('p3', '2A', 'Maisons inondées, routes coupées à Porto-Vecchio', during)], { now: NOW + 20 * H, unknown: [] })).toBe('arrive');
    expect(crue.arrived(scenario, [cited], { now: NOW + 40 * H, unknown: [] })).toBe('pas_arrive');
    expect(crue.arrived(scenario, [], { now: NOW + 40 * H, unknown: ['Presse non lue', 'Pannes non lues'] })).toBe('indecidable');
  });
});

describe('enjeux exposés', () => {
  const table = { '2A': { urgences: 3, passages: 61000, mainHospitals: ['CH Ajaccio'], ehpad: 12, ehpadPlaces: 800, sevesoHaut: 1, sevesoBas: 2 } };
  it('compte par département ; rien pour un scénario national ou un département inconnu', () => {
    expect(exposureOf({ zone: { dept: ['2A'] } }, table)).toMatchObject({ urgences: 3, ehpadPlaces: 800, sevesoHaut: 1 });
    expect(exposureOf({ zone: { dept: [] } }, table)).toBeNull();
    expect(exposureOf({ zone: { dept: ['ZZ'] } }, table)).toBeNull();
    expect(withExposure({ id: 'x', zone: { dept: [] } })).toEqual({ id: 'x', zone: { dept: [] } });
    expect(withExposure({ id: 'x', ruleId: 'crue-inondation', zone: { dept: ['31'] } }).exposure.sources).toHaveLength(3);
    // Une fiche « lycées » n'affiche ni EHPAD ni sites Seveso.
    expect(withExposure({ id: 'x', ruleId: 'lycees-mobilisation', zone: { dept: ['31'] } }).exposure).toBeUndefined();
  });
  it('la fiche affiche les comptes avec leurs sources, texte échappé, sans tiret cadratin', () => {
    const html = exposureHtml({ exposure: { ...table['2A'], mainHospitals: ['CH <b>Ajaccio</b>'], sources: ['FINESS du 12/05/2026'] } } as unknown as AnticipationScenario);
    expect(html).toContain('Enjeux dans le département');
    expect(html).toMatch(/3 services d(&#39;|')urgences/);
    expect(html).toContain('61 000');
    expect(html).toContain('CH &lt;b&gt;Ajaccio&lt;/b&gt;');
    expect(html).not.toContain('—');
    expect(exposureHtml({} as AnticipationScenario)).toBe('');
  });
});

describe('règles d’hiver', () => {
  const eco = (level: string) => ({
    id: 'eco:J1', kind: 'ecowatt', domain: 'energy', source: 'rte', origin: 'rte', official: true, dept: [], communes: [], level, value: null,
    window: { from: '2026-11-05T05:00:00.000Z', to: '2026-11-05T23:00:00.000Z' }, publishedAt: '2026-11-04T15:00:00.000Z', observedAt: '2026-11-04T16:30:00.000Z', checkedAt: '2026-11-04T16:30:00.000Z', ref: 'rte', meta: {},
  });
  it('grand froid : il faut la vigilance ET une tension électrique ; Écowatt rouge rend probable', () => {
    expect(froid.evaluate([vigi('67', 'grand_froid', 'orange')], ctx())).toEqual([]);
    expect(froid.evaluate([vigi('67', 'canicule', 'orange'), eco('orange')], ctx())).toEqual([]);
    const [c] = froid.evaluate([vigi('67', 'grand_froid', 'orange'), eco('orange')], ctx());
    expect(c).toMatchObject({ ruleId: 'froid-electricite', zone: { dept: ['67'] }, word: 'possibilite_reelle', title: "Grand froid et tension sur l'électricité" });
    expect(c.chain[0].text).toBe('Vigilance grand froid orange dans le Bas-Rhin (Météo-France)');
    expect(froid.evaluate([vigi('67', 'grand_froid', 'orange'), eco('rouge')], ctx())[0].word).toBe('probable');
  });
  it('neige-verglas : vigilance orange ouvre probable ; rail et presse cités rendent très probable', () => {
    expect(neige.evaluate([vigi('38', 'neige_verglas', 'jaune')], ctx())).toEqual([]);
    const [c] = neige.evaluate([vigi('38', 'neige_verglas', 'orange')], ctx());
    expect(c).toMatchObject({ ruleId: 'neige-transports', word: 'probable' });
    const rail = { id: 'rail:1', kind: 'perturbation_sncf', domain: 'transport', source: 'sncf', origin: 'sncf', official: true, dept: ['38'], communes: [], level: null, value: null,
      window: { from: '2026-11-05T06:00:00.000Z', to: '2026-11-05T12:00:00.000Z' }, publishedAt: '2026-11-04T16:00:00.000Z', observedAt: '2026-11-04T16:30:00.000Z', checkedAt: '2026-11-04T16:30:00.000Z', ref: 'sncf', meta: {} };
    const press = flood('n1', '38', 'Neige en Isère : des automobilistes bloqués sur l’A48, la route coupée', '2026-11-04T15:00:00.000Z');
    expect(press.meta.topic).toBe('neige');
    const [d] = neige.evaluate([vigi('38', 'neige_verglas', 'orange'), rail, press], ctx());
    expect(d.word).toBe('tres_probable');
    // Arrivée : un blocage nouveau pendant la fenêtre, pas ceux cités.
    const scenario = { ...c, openedAt: new Date(NOW).toISOString() };
    expect(neige.arrived(scenario, [flood('n2', '38', 'Verglas : transports scolaires suspendus en Isère', '2026-11-05T07:00:00.000Z')], { now: NOW + 20 * H, unknown: [] })).toBe('arrive');
    expect(neige.arrived(scenario, [], { now: NOW + 40 * H, unknown: [] })).toBe('pas_arrive');
  });
  it('un paysage enneigé ou une vigilance annoncée ne sont pas un blocage', () => {
    expect(pressTags('Premières neiges sur les sommets des Pyrénées, les stations se préparent', '65').topic).toBeNull();
    expect(pressTags('Neige-verglas : douze départements placés en vigilance orange', '38').topic).toBeNull();
  });
});
