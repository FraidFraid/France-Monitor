// tests/anticipation-rule-6.test.ts : règle 6 evenement-mobilisation, 04/11/2026.
import { describe, expect, it } from 'vitest';
// @ts-expect-error module JS sans déclaration
import rule from '../api/_lib/anticipation/rules/evenement-mobilisation.js';

type Sig = Record<string, unknown>;
const NOW = Date.parse('2026-11-04T09:00:00Z');
const ctx = { now: NOW, precedent: () => null };
const sig = (over: Sig): Sig => ({
  id: 'x', domain: 'social', kind: 'rassemblement_annonce', source: 's', origin: 'o', official: false, dept: ['69'], communes: [], level: null, value: null,
  window: null, publishedAt: null, observedAt: '2026-11-04T08:00:00Z', checkedAt: '2026-11-04T08:55:00Z', ref: 'r', ...over,
});
// Coup d'envoi 19 h 45 UTC (20 h 45 à Paris, soirée) : fenêtre 17:45Z à 22:45Z. Pour l'après-midi : coup d'envoi 15:00Z.
const game = (over: Sig = {}) => sig({ id: 'evenement_sportif:football-data:69:1', domain: 'event', kind: 'evenement_sportif', source: 'football-data', origin: 'football-data',
  window: { from: '2026-11-04T13:00:00Z', to: '2026-11-04T18:00:00Z' }, meta: { home: 'Olympique Lyonnais', away: 'Autre FC' }, ...over });
const rally = sig({ id: 'r1', origin: 'demosphere', window: { from: '2026-11-04T15:00:00Z', to: '2026-11-04T18:00:00Z' } });
const social = sig({ id: 's1', domain: 'transport', kind: 'mouvement_social_transport', source: 'sncf', origin: 'sncf', official: true, window: { from: '2026-11-04T12:00:00Z', to: '2026-11-04T20:00:00Z' } });

describe('rule 6 evenement-mobilisation', () => {
  it('match + rassemblement same dept and half-day → scenario', () => {
    const out = rule.evaluate([game(), rally], ctx);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Saturation des transports et de l'espace public autour du stade");
    expect(out[0].zone.dept).toEqual(['69']);
    expect(out[0].window).toEqual({ from: '2026-11-04T13:00:00.000Z', to: '2026-11-04T21:00:00.000Z' });
    expect(out[0].word).toBe('possibilite_reelle');
    expect(out[0].evidence.origins).toBe(2);
    for (const step of out[0].chain) expect(step.signalIds.length).toBeGreaterThan(0);
  });

  it('rally + social movement → probable', () => {
    expect(rule.evaluate([game(), rally, social], ctx)[0].word).toBe('probable');
  });

  it('inactive without a sporting signal (not configured)', () => {
    expect(rule.evaluate([rally, social], ctx)).toEqual([]);
    expect(rule.evaluate(null, ctx)).toEqual([]);
  });

  it('other dept or other half-day gives nothing', () => {
    expect(rule.evaluate([game(), { ...rally, dept: ['13'] }], ctx)).toEqual([]);
    expect(rule.evaluate([game(), { ...rally, window: { from: '2026-11-05T08:00:00Z', to: '2026-11-05T09:00:00Z' } }], ctx)).toEqual([]);
  });

  it('names the matches overlapping the half-day, not just the first one', () => {
    const b = game({ id: 'evenement_sportif:football-data:69:2', meta: { home: 'Autre Club', away: 'Visiteur' }, communes: ['Villeurbanne'] });
    const out = rule.evaluate([b, game(), rally], ctx);
    expect(out).toHaveLength(1);
    expect(out[0].chain[0].text).toContain('Olympique Lyonnais contre Autre FC');
    expect(out[0].chain[0].text).toContain('Autre Club contre Visiteur');
    expect(out[0].chain[0].signalIds).toHaveLength(2);
    expect(out[0].zone.communes).toEqual(['Villeurbanne']);
  });

  it('a match outside the half-day is not named', () => {
    const night = game({ id: 'evenement_sportif:football-data:69:3', meta: { home: 'Match du soir', away: 'X' }, window: { from: '2026-11-04T22:30:00Z', to: '2026-11-05T02:00:00Z' } });
    const out = rule.evaluate([night, game(), rally], ctx);
    expect(out).toHaveLength(1);
    expect(out[0].chain[0].text).not.toContain('Match du soir');
  });

  it('a match without dept opens nothing and adds nothing to scenarios', () => {
    const lost = game({ id: 'evenement_sportif:football-data:-:9', dept: [], meta: { home: 'AS Monaco FC', away: 'Autre FC' } });
    expect(rule.evaluate([lost, rally], ctx)).toEqual([]);
    expect(rule.evaluate([game(), lost, rally], ctx)[0].unknowns.join()).not.toContain('Stade non reconnu');
  });

  it('arrived: transport disruption in the window arrives, unread press is undecidable', () => {
    const scenario = { window: { from: '2026-11-04T13:00:00.000Z', to: '2026-11-04T21:00:00.000Z' }, zone: { dept: ['69'] } };
    const press = sig({ id: 'p1', domain: 'press', kind: 'presse', origin: 'presse:event:1', publishedAt: '2026-11-04T19:00:00Z', meta: { category: 'security', severity: 'high' } });
    expect(rule.arrived(scenario, [press], { now: NOW + 1000 })).toBe('arrive');
    expect(rule.arrived(scenario, [], { now: Date.parse('2026-11-04T22:00:00Z'), unknown: ['Presse non lue'] })).toBe('indecidable');
  });
});
