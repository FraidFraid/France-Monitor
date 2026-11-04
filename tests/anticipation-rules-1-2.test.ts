// tests/anticipation-rules-1-2.test.ts : règles 1 (mobilisation × transports) et 2 (tempête × réseaux), 04/11/2026.
import { describe, expect, it } from 'vitest';
// @ts-expect-error module JS sans déclaration
import { RULES } from '../api/_lib/anticipation/rules/index.js';
// @ts-expect-error module JS sans déclaration
// @ts-expect-error module JS sans déclaration
import { evaluate } from '../api/_lib/anticipation/engine.js';
// @ts-expect-error module JS sans déclaration
import mobilisation from '../api/_lib/anticipation/rules/mobilisation-transports.js';
// @ts-expect-error module JS sans déclaration
import tempete from '../api/_lib/anticipation/rules/tempete-reseaux.js';

type Sig = Record<string, unknown>;
// 4 nov 2026 : heure d'hiver (UTC+1). Après-midi de Paris 14 h à 22 h = 13:00Z à 21:00Z.
const NOW = Date.parse('2026-11-04T09:00:00Z');
const ctx = (precedent: string | null = null) => ({ now: NOW, precedent: () => precedent });

function sig(over: Sig): Sig {
  return {
    id: 'x', domain: 'social', kind: 'rassemblement_annonce', source: 's', origin: 'o', official: false, dept: ['69'], communes: [],
    level: null, value: null, window: null, publishedAt: null, observedAt: '2026-11-04T08:00:00Z', checkedAt: '2026-11-04T08:55:00Z', ref: 'r', ...over,
  };
}
const rally = (id: string, origin: string, from = '2026-11-04T15:00:00Z', to = '2026-11-04T18:00:00Z', extra: Sig = {}) =>
  sig({ id, kind: 'rassemblement_annonce', origin, window: { from, to }, ...extra });
const sncf = (id = 'mouvement_social_transport:sncf:69:1', from = '2026-11-04T12:00:00Z', to = '2026-11-04T20:00:00Z', extra: Sig = {}) =>
  sig({ id, domain: 'transport', kind: 'mouvement_social_transport', source: 'sncf', origin: 'sncf', official: true, window: { from, to }, ...extra });
const vig = (over: Sig = {}) =>
  sig({ id: 'vig1', domain: 'weather', kind: 'vigilance', source: 'meteo-france', origin: 'meteo-france', official: true, dept: ['29'], level: 'orange',
    window: { from: '2026-11-05T06:00:00Z', to: '2026-11-05T18:00:00Z' }, meta: { phenomenon: 'vent', echeance: 'J1' }, ...over });
const panne = (network: string, over: Sig = {}) =>
  sig({ id: `panne:${network}`, domain: network === 'electricite' ? 'energy' : 'telecom', kind: 'panne', source: 'enedis', origin: 'enedis', official: true,
    dept: ['29'], level: 'orange', window: { from: '2026-11-05T07:00:00Z', to: '2026-11-05T09:00:00Z' }, publishedAt: '2026-11-05T07:00:00Z', meta: { network }, ...over });

describe('RULES', () => {
  it('exposes both rules with public arrival test', () => {
    expect(RULES.map((r: { id: string }) => r.id)).toEqual(['mobilisation-transports', 'tempete-reseaux']);
    for (const r of RULES) expect(r.arrivalTest.length).toBeGreaterThan(20);
  });
});

describe('rule 1 mobilisation-transports', () => {
  it('Lyon: 3 rassemblements + mouvement social SNCF same afternoon → probable, chain of 3 steps with signal ids', () => {
    const signals = [rally('a', 'demosphere'), rally('b', 'cgt'), rally('c', 'presse:item:9'), sncf()];
    const out = mobilisation.evaluate(signals, ctx());
    expect(out).toHaveLength(1);
    const c = out[0];
    expect(c.word).toBe('probable');
    expect(c.title).toBe("Foule bloquée ou débordements en fin de cortège");
    expect(c.zone.dept).toEqual(['69']);
    expect(c.window).toEqual({ from: '2026-11-04T13:00:00.000Z', to: '2026-11-04T21:00:00.000Z' });
    expect(c.chain).toHaveLength(3);
    for (const step of c.chain) expect(step.signalIds.length).toBeGreaterThan(0);
    expect(c.chain[0].signalIds).toEqual(['a', 'b', 'c']);
    expect(c.chain[1].signalIds).toEqual(['mouvement_social_transport:sncf:69:1']);
    expect(c.evidence.origins).toBe(4);
    expect(c.evidence.hasOfficial).toBe(true);
    expect(c.bascules.map((b: { id: string; state: string }) => [b.id, b.state])).toEqual([['arrete', 'surveille'], ['affluence', 'surveille'], ['preavis_leve', 'surveille']]);
    expect(c.unknowns).toContain('Effectifs réels engagés : aucune donnée publique');
    expect(c.verify).toContain('Effectifs auprès de la DDSP du Rhône');
    expect(c.verify).toContain('Plan de transport auprès de SNCF Voyageurs');
    expect(c.disconfirmers.length).toBeGreaterThan(0);
  });

  it('two rassemblements only → possibilite_reelle; participants >= 15000 → probable and affluence atteint', () => {
    const two = mobilisation.evaluate([rally('a', 'demosphere'), rally('b', 'cgt'), sncf()], ctx());
    expect(two[0].word).toBe('possibilite_reelle');
    const big = mobilisation.evaluate([rally('a', 'demosphere'), rally('b', 'presse:item:2', '2026-11-04T15:00:00Z', '2026-11-04T18:00:00Z', { kind: 'rassemblement_signale', value: 20000, meta: { participants: 20000 } }), sncf()], ctx());
    expect(big[0].word).toBe('probable');
    expect(big[0].bascules.find((b: { id: string }) => b.id === 'affluence').state).toBe('atteint');
  });

  it('arrêté préfectoral in the dept the same half-day sets bascule arrete atteint', () => {
    const arr = sig({ id: 'arrete1', kind: 'arrete_prefectoral', source: 'prefecture', origin: 'prefecture:69', official: true, window: { from: '2026-11-04T15:00:00Z', to: '2026-11-04T18:00:00Z' }, publishedAt: '2026-11-04T07:00:00Z' });
    const out = mobilisation.evaluate([rally('a', 'demosphere'), rally('b', 'cgt'), sncf(), arr], ctx());
    expect(out[0].bascules.find((b: { id: string }) => b.id === 'arrete').state).toBe('atteint');
  });

  it('rassemblements without transport → no candidate', () => {
    expect(mobilisation.evaluate([rally('a', 'demosphere'), rally('b', 'cgt'), rally('c', 'x')], ctx())).toEqual([]);
  });

  it('different half-days → no candidate', () => {
    const morning = sncf('s2', '2026-11-04T06:00:00Z', '2026-11-04T10:00:00Z');
    expect(mobilisation.evaluate([rally('a', 'demosphere'), morning], ctx())).toEqual([]);
  });

  it('transport in another département → no candidate', () => {
    expect(mobilisation.evaluate([rally('a', 'demosphere'), sncf('s3', undefined, undefined, { dept: ['13'] })], ctx())).toEqual([]);
  });

  it('single origin evidence floors to peu_probable through the engine', () => {
    const one = [rally('a', 'presse:event:1'), sncf('s4', undefined, undefined, { origin: 'presse:event:1', official: false })];
    const cands = mobilisation.evaluate(one, ctx());
    expect(cands[0].evidence.origins).toBe(1);
    expect(cands[0].word).toBe('possibilite_reelle'); // mot de base ; le plancher est appliqué par le moteur
    const out = evaluate(one, { state: () => new Map() }, NOW, RULES);
    expect(out.opened).toHaveLength(1);
    expect(out.opened[0].word).toBe('peu_probable');
  });

  it('a rally ending exactly at 14 h Paris gives no afternoon candidate (end exclusive)', () => {
    const morning = rally('a', 'demosphere', '2026-11-04T09:00:00Z', '2026-11-04T13:00:00Z'); // 10 h à 14 h Paris
    expect(mobilisation.evaluate([morning, sncf('s6', '2026-11-04T09:00:00Z', '2026-11-04T20:00:00Z')], { now: Date.parse('2026-11-04T05:00:00Z'), precedent: () => null }).map((c: { window: { from: string } }) => c.window.from))
      .toEqual(['2026-11-04T05:00:00.000Z']);
    // transport finissant à 14 h pile : pas de candidat l'après-midi
    expect(mobilisation.evaluate([rally('b', 'demosphere'), sncf('s7', '2026-11-04T09:00:00Z', '2026-11-04T13:00:00Z')], ctx())).toEqual([]);
  });

  it('press-derived strike (window null) covers the Paris day of its publication when recent', () => {
    const strike = sig({ id: 'tcl1', domain: 'transport', kind: 'mouvement_social_transport', source: 'Le Progrès', origin: 'presse:event:77', official: false, publishedAt: '2026-11-04T07:00:00Z' });
    const out = mobilisation.evaluate([rally('a', 'demosphere'), rally('b', 'cgt'), strike], ctx());
    expect(out).toHaveLength(1);
    expect(out[0].chain[1].signalIds).toEqual(['tcl1']);
    const stale = { ...strike, publishedAt: '2026-11-02T07:00:00Z' };
    expect(mobilisation.evaluate([rally('a', 'demosphere'), stale], ctx())).toEqual([]);
  });

  it('place phrases follow the département', () => {
    const mk = (dept: string) => mobilisation.evaluate([rally('a', 'demosphere', undefined, undefined, { dept: [dept] }), sncf('s', undefined, undefined, { dept: [dept] })], ctx())[0].chain[0].text;
    expect(mk('69')).toContain('dans le Rhône, après-midi');
    expect(mk('33')).toContain('en Gironde');
    expect(mk('13')).toContain('dans les Bouches-du-Rhône');
    expect(mk('75')).toContain('à Paris');
  });

  it('a future half-day names its Paris date', () => {
    const out = mobilisation.evaluate([rally('a', 'demosphere', '2026-11-06T15:00:00Z', '2026-11-06T18:00:00Z'), sncf('s8', '2026-11-06T12:00:00Z', '2026-11-06T20:00:00Z')], ctx());
    expect(out[0].chain[0].text).toContain('après-midi du 06/11');
  });

  it('half-days use Paris time across the DST change (summer, UTC+2): 14 h Paris = 12:00Z', () => {
    const summer = (Date.parse('2026-07-14T08:00:00Z'));
    const r = rally('a', 'demosphere', '2026-07-14T13:00:00Z', '2026-07-14T16:00:00Z');
    const s = sncf('s5', '2026-07-14T12:00:00Z', '2026-07-14T15:00:00Z');
    const out = mobilisation.evaluate([r, s], { now: summer, precedent: () => null });
    expect(out[0].window).toEqual({ from: '2026-07-14T12:00:00.000Z', to: '2026-07-14T20:00:00.000Z' });
  });

  it('tolerates null and malformed inputs', () => {
    expect(mobilisation.evaluate([], ctx())).toEqual([]);
    expect(mobilisation.evaluate(null, ctx())).toEqual([]);
    expect(mobilisation.evaluate([null, {}, rally('a', 'x', null as unknown as string)], ctx())).toEqual([]);
  });

  it('arrival: press violence in the dept during the window → arrive; passed with press read → pas_arrive; no press → indecidable', () => {
    const scen = { ruleId: 'mobilisation-transports', zone: { dept: ['69'], communes: [] }, window: { from: '2026-11-04T13:00:00.000Z', to: '2026-11-04T21:00:00.000Z' } };
    const press = sig({ id: 'p1', domain: 'press', kind: 'presse', origin: 'presse:event:5', dept: ['69'], level: 'orange', publishedAt: '2026-11-04T16:00:00Z', meta: { category: 'security', severity: 'high' } });
    const other = sig({ id: 'p2', domain: 'press', kind: 'presse', origin: 'presse:event:6', dept: ['13'], level: 'jaune', publishedAt: '2026-11-04T16:00:00Z', meta: { category: 'security', severity: 'high' } });
    const mild = sig({ id: 'p3', domain: 'press', kind: 'presse', origin: 'presse:event:7', dept: ['69'], level: 'jaune', publishedAt: '2026-11-04T16:00:00Z', meta: { category: 'energy', severity: 'medium' } });
    const after = Date.parse('2026-11-04T22:30:00Z');
    expect(mobilisation.arrived(scen, [press], { now: after })).toBe('arrive');
    expect(mobilisation.arrived(scen, [other, mild], { now: after, unknown: [] })).toBe('pas_arrive');
    expect(mobilisation.arrived(scen, [], { now: after })).toBe('indecidable');
    expect(mobilisation.arrived(scen, [other, mild], { now: after, unknown: ['Presse non lue'] })).toBe('indecidable');
    expect(mobilisation.arrived(scen, [other, mild], { now: Date.parse('2026-11-04T17:00:00Z') })).toBeNull();
  });
});

describe('rule 2 tempete-reseaux', () => {
  it('vigilance vent orange J1 Finistère with a second origin → probable, window = slot', () => {
    const out = tempete.evaluate([vig(), panne('electricite', { level: 'jaune' })], ctx());
    expect(out).toHaveLength(1);
    const c = out[0];
    expect(c.word).toBe('probable');
    expect(c.title).toBe("Coupures d'électricité puis de réseau mobile");
    expect(c.zone.dept).toEqual(['29']);
    expect(c.window).toEqual({ from: '2026-11-05T06:00:00Z', to: '2026-11-05T18:00:00Z' });
    expect(c.evidence.officialLevel).toBe('orange');
    expect(c.evidence.hasPublishedDeadline).toBe(true);
    expect(c.chain[0].signalIds).toEqual(['vig1']);
    expect(c.verify.some((v: string) => v.includes('Finistère'))).toBe(true);
  });

  it('rouge → tres_probable; orages count as well; vigilance alone has a single origin', () => {
    const red = tempete.evaluate([vig({ level: 'rouge', meta: { phenomenon: 'orages', echeance: 'J' } })], ctx());
    expect(red[0].word).toBe('tres_probable');
    expect(red[0].evidence.origins).toBe(1);
  });

  it('jaune → nothing; other phenomenon → nothing; ended window → nothing', () => {
    expect(tempete.evaluate([vig({ level: 'jaune' })], ctx())).toEqual([]);
    expect(tempete.evaluate([vig({ meta: { phenomenon: 'canicule', echeance: 'J' } })], ctx())).toEqual([]);
    expect(tempete.evaluate([vig({ window: { from: '2026-11-03T06:00:00Z', to: '2026-11-03T18:00:00Z' } })], ctx())).toEqual([]);
  });

  it('bascule coupures atteint when panne electricite dept 29 appears; mobile when panne mobile', () => {
    const before = tempete.evaluate([vig()], ctx());
    expect(before[0].bascules.map((b: { id: string; state: string }) => [b.id, b.state])).toEqual([['coupures', 'surveille'], ['mobile', 'surveille']]);
    const withPanne = tempete.evaluate([vig(), panne('electricite')], ctx());
    const b = withPanne[0].bascules;
    expect(b.find((x: { id: string }) => x.id === 'coupures')).toMatchObject({ state: 'atteint', at: '2026-11-05T07:00:00Z' });
    expect(b.find((x: { id: string }) => x.id === 'mobile').state).toBe('surveille');
    const both = tempete.evaluate([vig(), panne('electricite'), panne('mobile')], ctx());
    expect(both[0].bascules.find((x: { id: string }) => x.id === 'mobile').state).toBe('atteint');
    expect(withPanne[0].evidence.basculeHit).toBe(true);
  });

  it('a panne before the vigilance window and publication is not cited', () => {
    const old = panne('electricite', { id: 'old', window: { from: '2026-11-01T07:00:00Z', to: '2026-11-01T09:00:00Z' }, publishedAt: '2026-11-01T07:00:00Z' });
    const out = tempete.evaluate([vig({ publishedAt: '2026-11-04T12:00:00Z' }), old], ctx());
    expect(out[0].bascules.find((x: { id: string }) => x.id === 'coupures').state).toBe('surveille');
  });

  it('panne in another département is ignored', () => {
    const out = tempete.evaluate([vig(), panne('electricite', { dept: ['35'] })], ctx());
    expect(out[0].bascules.find((x: { id: string }) => x.id === 'coupures').state).toBe('surveille');
  });

  it('tolerates null inputs', () => {
    expect(tempete.evaluate([], ctx())).toEqual([]);
    expect(tempete.evaluate(null, ctx())).toEqual([]);
    expect(tempete.evaluate([vig({ window: null, dept: [] })], ctx())).toEqual([]);
  });

  it('arrival: panne electricite rouge/orange in the dept during the window', () => {
    const scen = { ruleId: 'tempete-reseaux', zone: { dept: ['29'], communes: [] }, window: { from: '2026-11-05T06:00:00Z', to: '2026-11-05T18:00:00Z' } };
    expect(tempete.arrived(scen, [panne('electricite')], { now: Date.parse('2026-11-05T10:00:00Z') })).toBe('arrive');
    expect(tempete.arrived(scen, [panne('electricite', { level: 'jaune' })], { now: Date.parse('2026-11-05T19:00:00Z'), unknown: [] })).toBe('pas_arrive');
    expect(tempete.arrived(scen, [], { now: Date.parse('2026-11-05T19:00:00Z'), unknown: ['Pannes non lues'] })).toBe('indecidable');
    expect(tempete.arrived(scen, [], { now: Date.parse('2026-11-05T10:00:00Z') })).toBeNull();
  });
});
