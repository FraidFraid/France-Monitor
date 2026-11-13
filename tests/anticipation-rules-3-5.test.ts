// tests/anticipation-rules-3-5.test.ts : règles 3 (chaleur × électricité), 4 (crise sociale × cyber) et 5 (grève × carburant), 04/11/2026.
import { describe, expect, it } from 'vitest';
// @ts-expect-error module JS sans déclaration
import { RULES } from '../api/_lib/anticipation/rules/index.js';
// @ts-expect-error module JS sans déclaration
import chaleur from '../api/_lib/anticipation/rules/chaleur-sante.js';
// @ts-expect-error module JS sans déclaration
import socialCyber from '../api/_lib/anticipation/rules/social-cyber.js';
// @ts-expect-error module JS sans déclaration
import greve from '../api/_lib/anticipation/rules/greve-carburant.js';
// @ts-expect-error module JS sans déclaration
import { evaluate } from '../api/_lib/anticipation/engine.js';

type Sig = Record<string, unknown>;
const NOW = Date.parse('2026-11-04T09:00:00Z');
const ctx = (unknown: string[] = []) => ({ now: NOW, precedent: () => null, unknown });

function sig(over: Sig): Sig {
  return {
    id: 'x', domain: 'social', kind: 'rassemblement_annonce', source: 's', origin: 'o', official: false, dept: [], communes: [],
    level: null, value: null, window: null, publishedAt: null, observedAt: '2026-11-04T08:00:00Z', checkedAt: '2026-11-04T08:55:00Z', ref: 'r', ...over,
  };
}
const DAY = { from: '2026-11-05T00:00:00Z', to: '2026-11-06T00:00:00Z' };
const canicule = (over: Sig = {}) => sig({ id: 'vig', domain: 'weather', kind: 'vigilance', source: 'meteo-france', origin: 'meteo-france', official: true, dept: ['13'], level: 'orange',
  window: DAY, publishedAt: '2026-11-04T08:00:00Z', meta: { phenomenon: 'canicule', echeance: 'J1' }, ...over });
const eco = (level = 'orange', over: Sig = {}) => sig({ id: 'eco', domain: 'energy', kind: 'ecowatt', source: 'rte', origin: 'rte', official: true, level, window: DAY, publishedAt: '2026-11-04T08:00:00Z', ...over });
const panne = (over: Sig = {}) => sig({ id: 'pe', domain: 'energy', kind: 'panne', source: 'enedis', origin: 'enedis', official: true, dept: ['13'], level: 'orange',
  window: { from: '2026-11-05T10:00:00Z', to: '2026-11-05T12:00:00Z' }, publishedAt: '2026-11-05T10:00:00Z', meta: { network: 'electricite' }, ...over });

describe('registry', () => {
  it('lists the eight rules in order, each with a public arrival test', () => {
    expect(RULES.map((r: { id: string }) => r.id)).toEqual(['mobilisation-transports', 'tempete-reseaux', 'chaleur-sante', 'social-cyber', 'greve-carburant', 'evenement-mobilisation', 'lycees-mobilisation', 'alertes-serie']);
    for (const r of RULES) expect(r.arrivalTest.length).toBeGreaterThan(20);
  });
});

describe('rule 3 chaleur-sante', () => {
  it('canicule orange + Écowatt orange same day → possibilite_reelle with a 3-step chain', () => {
    const out = chaleur.evaluate([canicule(), eco()], ctx());
    expect(out).toHaveLength(1);
    expect(out[0].word).toBe('possibilite_reelle');
    expect(out[0].window).toEqual(DAY);
    expect(out[0].zone.dept).toEqual(['13']);
    expect(out[0].chain[0].text).toBe('Vigilance canicule orange dans les Bouches-du-Rhône (Météo-France)');
    for (const step of out[0].chain) expect(step.signalIds.length).toBeGreaterThan(0);
    expect(out[0].unknowns).toContain('Passages aux urgences de la semaine non encore publiés');
    expect(out[0].evidence.hasOfficial).toBe(true);
  });

  it('canicule rouge + panne électricité in the dept → probable, panne bascule atteinte', () => {
    const out = chaleur.evaluate([canicule({ level: 'rouge' }), panne()], ctx());
    expect(out[0].word).toBe('probable');
    expect(out[0].bascules.find((b: { id: string }) => b.id === 'panne').state).toBe('atteint');
  });

  it('missing condition → no candidate (no electric signal, wrong phenomenon, jaune, other dept panne)', () => {
    expect(chaleur.evaluate([canicule()], ctx())).toEqual([]);
    expect(chaleur.evaluate([canicule({ meta: { phenomenon: 'vent', echeance: 'J1' } }), eco()], ctx())).toEqual([]);
    expect(chaleur.evaluate([canicule({ level: 'jaune' }), eco()], ctx())).toEqual([]);
    expect(chaleur.evaluate([canicule(), panne({ dept: ['69'] })], ctx())).toEqual([]);
    expect(chaleur.evaluate([canicule(), eco('jaune')], ctx())).toEqual([]);
  });

  it('single origin floors to peu_probable through the engine; tolerates null', () => {
    const out = evaluate([canicule(), eco()], { state: () => new Map() }, NOW, [chaleur]);
    expect(out.opened[0].word).toBe('possibilite_reelle'); // deux origines (météo + RTE) : pas de plancher
    expect(chaleur.evaluate(null, ctx())).toEqual([]);
    expect(chaleur.evaluate([null, {}, 3], ctx())).toEqual([]);
  });

  it('two vigilance periods in one département merge into one window', () => {
    const v2 = canicule({ id: 'vig2', window: { from: '2026-11-06T00:00:00Z', to: '2026-11-07T00:00:00Z' }, meta: { phenomenon: 'canicule', echeance: 'J1' } });
    const out = chaleur.evaluate([canicule(), v2, eco('orange', { window: { from: '2026-11-06T00:00:00Z', to: '2026-11-07T00:00:00Z' } })], ctx());
    expect(out).toHaveLength(1);
    expect(out[0].window).toEqual({ from: '2026-11-05T00:00:00.000Z', to: '2026-11-07T00:00:00.000Z' });
    expect(out[0].chain[0].signalIds).toEqual(['vig', 'vig2']);
  });

  it('really floors to peu_probable through the engine when all cited signals share one origin', () => {
    const one = [canicule(), panne({ origin: 'meteo-france', official: false })];
    const cands = chaleur.evaluate(one, ctx());
    expect(cands[0].evidence.origins).toBe(1);
    const out = evaluate(one, { state: () => new Map() }, NOW, [chaleur]);
    expect(out.opened[0].word).toBe('peu_probable');
  });

  describe('arrived', () => {
    const scenario = { window: DAY, zone: { dept: ['13'] } };
    it('a cited signal counts only when its level rose since it was cited', () => {
      const chain = (lv: Record<string, string>) => [{ text: 't', signalIds: Object.keys(lv), levels: lv }];
      const base = { ...scenario, openedAt: '2026-11-04T09:00:00.000Z' };
      // même id cité orange, maintenant rouge : arrive
      expect(chaleur.arrived({ ...base, chain: chain({ eco: 'orange' }) }, [eco('rouge')], { now: NOW })).toBe('arrive');
      // cité rouge, toujours rouge : n'arrive pas
      expect(chaleur.arrived({ ...base, chain: chain({ eco: 'rouge' }) }, [eco('rouge')], { now: NOW })).toBeNull();
      // panne commencée avant l'ouverture, montée d'orange à rouge après : arrive
      const early = { publishedAt: '2026-11-04T06:00:00Z', observedAt: '2026-11-04T06:00:00Z' };
      expect(chaleur.arrived({ ...base, chain: chain({ pe: 'orange' }) }, [panne({ ...early, level: 'rouge' })], { now: NOW })).toBe('arrive');
      expect(chaleur.arrived({ ...base, chain: chain({ pe: 'orange' }) }, [panne({ ...early })], { now: NOW })).toBeNull();
    });
    it('evaluate writes the cited levels into the chain', () => {
      const c = chaleur.evaluate([canicule(), eco('orange')], ctx())[0];
      expect(c.chain[1].levels).toEqual({ eco: 'orange' });
      expect(c.chain[0].levels).toEqual({ vig: 'orange' });
    });
    it('is not circular and uses strict bounds', () => {
      const opened = { ...scenario, openedAt: '2026-11-04T09:00:00.000Z', chain: [{ text: 't', signalIds: ['pe', 'eco'] }] };
      // signaux cités : ne comptent pas
      expect(chaleur.arrived(opened, [eco('rouge'), panne()], { now: NOW })).toBeNull();
      // signal non cité mais antérieur à l'ouverture : ne compte pas
      expect(chaleur.arrived(opened, [panne({ id: 'old', publishedAt: '2026-11-04T08:00:00Z', observedAt: '2026-11-04T08:00:00Z' })], { now: NOW })).toBeNull();
      // signal nouveau, non cité, après l'ouverture : arrive
      expect(chaleur.arrived(opened, [panne({ id: 'new' })], { now: NOW })).toBe('arrive');
      // Écowatt rouge du jour adjacent (fin de la fenêtre = début du jour suivant) : pas arrive
      const next = eco('rouge', { id: 'eco2', window: { from: '2026-11-06T00:00:00Z', to: '2026-11-07T00:00:00Z' } });
      expect(chaleur.arrived(opened, [next], { now: Date.parse('2026-11-06T01:00:00Z'), unknown: [] })).toBe('pas_arrive');
    });

    it('arrive on Écowatt rouge or panne orange; null before end; pas_arrive after; indecidable when unread', () => {
      expect(chaleur.arrived(scenario, [eco('rouge')], { now: NOW })).toBe('arrive');
      expect(chaleur.arrived(scenario, [panne()], { now: NOW })).toBe('arrive');
      expect(chaleur.arrived(scenario, [eco('orange')], { now: Date.parse('2026-11-05T12:00:00Z') })).toBeNull();
      const after = Date.parse('2026-11-06T01:00:00Z');
      expect(chaleur.arrived(scenario, [eco('orange')], { now: after, unknown: [] })).toBe('pas_arrive');
      expect(chaleur.arrived(scenario, [], { now: after, unknown: ['Pannes non lues'] })).toBe('indecidable');
      expect(chaleur.arrived(scenario, [], { now: after, unknown: ['Écowatt non lu'] })).toBe('indecidable');
    });
  });
});

const rallies = (n: number) => Array.from({ length: n }, (_, i) => sig({ id: `r${i}`, kind: 'rassemblement_annonce', origin: i % 2 ? 'cgt' : 'demosphere', dept: [String(10 + (i % 50))],
  window: { from: '2026-11-04T10:00:00Z', to: '2026-11-04T13:00:00Z' } }));
const revendication = (over: Sig = {}) => sig({ id: 'cy1', domain: 'cyber', kind: 'cyber_revendication', source: 'ddosia', origin: 'ddosia', publishedAt: '2026-11-04T07:00:00Z', ref: 'impots.gouv.fr', ...over });
const press = (over: Sig = {}) => sig({ id: 'p1', domain: 'press', kind: 'presse', source: 'Le Monde', origin: 'presse:event:1', publishedAt: '2026-11-04T06:00:00Z', meta: { category: 'social', severity: 'high', title: 't' }, ...over });

describe('rule 4 social-cyber', () => {
  it('20 rassemblements + revendication .fr → national candidate over the Paris day', () => {
    const out = socialCyber.evaluate([...rallies(20), revendication()], ctx());
    expect(out).toHaveLength(1);
    expect(out[0].zone).toEqual({ dept: [], communes: [] });
    expect(out[0].window).toEqual({ from: '2026-11-03T23:00:00.000Z', to: '2026-11-04T23:00:00.000Z' });
    expect(out[0].word).toBe('possibilite_reelle');
    expect(out[0].chain[0].text).toBe("20 rassemblements annoncés en France aujourd'hui");
    for (const step of out[0].chain) expect(step.signalIds.length).toBeGreaterThan(0);
  });

  it('press social high or cyber_pic also trigger', () => {
    const pic = sig({ id: 'pic', domain: 'cyber', kind: 'cyber_pic', source: 'cloudflare-radar', origin: 'cloudflare-radar', official: true, value: 2 });
    expect(socialCyber.evaluate([press(), pic], ctx())).toHaveLength(1);
  });

  it('missing condition → no candidate (19 rassemblements, no cyber, old revendication, press medium)', () => {
    expect(socialCyber.evaluate([...rallies(19), revendication()], ctx())).toEqual([]);
    expect(socialCyber.evaluate(rallies(25), ctx())).toEqual([]);
    expect(socialCyber.evaluate([...rallies(25), revendication({ publishedAt: '2026-11-02T07:00:00Z' })], ctx())).toEqual([]);
    expect(socialCyber.evaluate([press({ meta: { category: 'social', severity: 'medium' } }), revendication()], ctx())).toEqual([]);
    expect(socialCyber.evaluate(null, ctx())).toEqual([]);
  });

  it('engine opens it with a national id', () => {
    // Règle suspendue le 13/11/2026 : le moteur ne l'évalue plus ; l'identifiant national se vérifie sur la règle sans suspension.
    expect(evaluate([...rallies(20), revendication()], { state: () => new Map() }, NOW, [socialCyber]).opened).toEqual([]);
    const out = evaluate([...rallies(20), revendication()], { state: () => new Map() }, NOW, [{ ...socialCyber, suspended: undefined }]);
    expect(out.opened[0].id).toBe('social-cyber:national:2026-11-03T23:00:00.000Z');
  });

  describe('arrived', () => {
    const scenario = { window: { from: '2026-11-03T23:00:00.000Z', to: '2026-11-04T23:00:00.000Z' }, openedAt: '2026-11-04T09:00:00.000Z', zone: { dept: [] } };
    it('new revendication or exposed outage → arrive', () => {
      expect(socialCyber.arrived(scenario, [revendication({ publishedAt: '2026-11-04T10:00:00Z' })], { now: NOW })).toBe('arrive');
      const out = sig({ id: 'pc', kind: 'panne', domain: 'telecom', window: { from: '2026-11-04T11:00:00Z', to: '2026-11-04T12:00:00Z' }, meta: { network: 'cloud', exposed: true } });
      expect(socialCyber.arrived(scenario, [out], { now: NOW })).toBe('arrive');
    });
    it('an outage already ongoing before openedAt does not count; press social older than 24 h does not trigger', () => {
      const before = sig({ id: 'pc3', kind: 'panne', domain: 'telecom', window: { from: '2026-11-04T07:00:00Z', to: '2026-11-04T12:00:00Z' }, meta: { network: 'cloud', exposed: true } });
      expect(socialCyber.arrived(scenario, [before], { now: NOW })).toBeNull();
      expect(socialCyber.evaluate([press({ publishedAt: '2026-11-02T06:00:00Z' }), revendication()], ctx())).toEqual([]);
    });
    it('the revendication that opened the scenario is not new; null before end; pas_arrive / indecidable after', () => {
      expect(socialCyber.arrived(scenario, [revendication()], { now: NOW })).toBeNull();
      const after = Date.parse('2026-11-05T00:30:00Z');
      expect(socialCyber.arrived(scenario, [revendication()], { now: after, unknown: [] })).toBe('pas_arrive');
      expect(socialCyber.arrived(scenario, [], { now: after, unknown: ['Veille cyber non lue'] })).toBe('indecidable');
      const notExposed = sig({ id: 'pc2', kind: 'panne', window: { from: '2026-11-04T11:00:00Z', to: '2026-11-04T12:00:00Z' }, meta: { network: 'cloud', exposed: false } });
      expect(socialCyber.arrived(scenario, [notExposed], { now: after, unknown: [] })).toBe('pas_arrive');
    });
  });
});

const strike = (id: string, origin: string, title = 'Grève à la raffinerie de Donges', over: Sig = {}) =>
  sig({ id, domain: 'press', kind: 'presse', source: 'Presse', origin, publishedAt: '2026-11-03T12:00:00Z', meta: { category: 'social', severity: 'medium', title }, ...over });
const fuelUp = (over: Sig = {}) => sig({ id: 'fu1', domain: 'fuel', kind: 'tension_carburant', source: 'prix-carburants', origin: 'prix-carburants', official: true, dept: ['44'], level: 'orange', value: 27, meta: { previousValue: 20 }, ...over });

describe('rule 5 greve-carburant', () => {
  it('2 origins on a refinery strike + rising share → national candidate on J+2', () => {
    const out = greve.evaluate([strike('a', 'presse:event:1'), strike('b', 'presse:event:2', 'Blocage du dépôt pétrolier de Lyon'), fuelUp()], ctx());
    expect(out).toHaveLength(1);
    expect(out[0].zone.dept).toEqual([]);
    expect(out[0].window).toEqual({ from: '2026-11-05T23:00:00.000Z', to: '2026-11-06T23:00:00.000Z' });
    expect(out[0].word).toBe('possibilite_reelle');
    expect(out[0].chain[0].signalIds).toEqual(['a', 'b']);
    expect(out[0].chain[1].signalIds).toEqual(['fu1']);
    expect(out[0].evidence.origins).toBe(3);
  });

  it('missing condition → no candidate (one origin, title off-topic, share not rising, trend unknown)', () => {
    const two = [strike('a', 'presse:event:1'), strike('b', 'presse:event:2')];
    expect(greve.evaluate([strike('a', 'presse:event:1'), fuelUp()], ctx())).toEqual([]);
    expect(greve.evaluate([strike('a', 'presse:event:1'), strike('b', 'presse:event:2', 'Accident sur la raffinerie'), fuelUp()], ctx())).toEqual([]);
    expect(greve.evaluate([...two, fuelUp({ value: 18 })], ctx())).toEqual([]);
    expect(greve.evaluate([...two, fuelUp({ meta: undefined })], ctx())).toEqual([]);
    expect(greve.evaluate([...two, fuelUp()].map((s) => ({ ...s, publishedAt: s.kind === 'presse' ? '2026-10-30T12:00:00Z' : s.publishedAt })), ctx())).toEqual([]);
    expect(greve.evaluate(undefined, ctx())).toEqual([]);
  });

  describe('arrived', () => {
    const scenario = { window: { from: '2026-11-05T23:00:00.000Z', to: '2026-11-06T23:00:00.000Z' }, zone: { dept: [] } };
    const nat = (value: number, observedAt = '2026-11-06T10:00:00Z') => sig({ id: 'n', domain: 'fuel', kind: 'tension_carburant', value, observedAt, meta: { national: true } });
    it('arrive above 15 %, null before end, pas_arrive when read and below, indecidable when absent', () => {
      expect(greve.arrived(scenario, [nat(16)], { now: Date.parse('2026-11-06T10:00:00Z') })).toBe('arrive');
      expect(greve.arrived(scenario, [nat(15)], { now: Date.parse('2026-11-06T10:00:00Z') })).toBeNull();
      const after = Date.parse('2026-11-07T01:00:00Z');
      expect(greve.arrived(scenario, [nat(15)], { now: after, unknown: [] })).toBe('pas_arrive');
      expect(greve.arrived(scenario, [], { now: after, unknown: [] })).toBe('indecidable');
      expect(greve.arrived(scenario, [nat(10)], { now: after, unknown: ['Carburants non lus'] })).toBe('indecidable');
    });
  });
});

describe('texts', () => {
  it('no em dash and no literal NBSP in rule outputs', () => {
    const outs = [
      ...chaleur.evaluate([canicule(), eco()], ctx()),
      ...socialCyber.evaluate([...rallies(20), revendication()], ctx()),
      ...greve.evaluate([strike('a', 'presse:event:1'), strike('b', 'presse:event:2'), fuelUp()], ctx()),
    ];
    const text = JSON.stringify(outs) + chaleur.arrivalTest + socialCyber.arrivalTest + greve.arrivalTest;
    expect(text).not.toMatch(new RegExp(`[${String.fromCharCode(0x2014, 0xa0)}]`));
  });
});
