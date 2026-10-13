import { describe, it, expect } from 'vitest';
import { GENERAL_SOCLE, WATCHED_LAYERS, generalChipHidden, generalWatch, isEscalation, watchLevels, watchTransitions, type GeneralWatchInput, type WatchLevel } from './watch.ts';
import type { MapLayers } from '../../types/index.ts';

const NOW = Date.parse('2026-10-12T08:00:00Z');
const levels = (entries: Array<[keyof MapLayers, WatchLevel]>): Map<keyof MapLayers, WatchLevel> => new Map(entries);

describe('Vue générale dynamique (12/10/2026)', () => {
  it('socle toujours (vert par défaut), autres couches seulement en jaune ou plus ou n.d. ; rouge d’abord', () => {
    const out = generalWatch(levels([
      ['environmental', 'jaune'], ['floods', 'vert'], ['fires', 'orange'], ['earthquakes', 'vert'], ['cyber', 'nd'],
      ['military', 'rouge'], ['powerGrid', 'jaune'],
    ]));
    expect(out.map((e) => [e.key, e.level])).toEqual([
      ['military', 'rouge'], ['fires', 'orange'], ['environmental', 'jaune'], ['powerGrid', 'jaune'], ['cyber', 'nd'], ['floods', 'vert'],
    ]);
    expect(generalWatch(new Map()).map((e) => e.key)).toEqual([...GENERAL_SOCLE]);
  });

  it('sécheresse : seulement en crise (rouge), jamais pour ses restrictions courantes ni en n.d.', () => {
    expect(generalWatch(levels([['drought', 'orange']])).map((e) => e.key)).not.toContain('drought');
    expect(generalWatch(levels([['drought', 'nd']])).map((e) => e.key)).not.toContain('drought');
    expect(generalWatch(levels([['drought', 'rouge']])).map((e) => e.key)).toContain('drought');
  });

  it('source jamais lue : pas de verdict ; lue mais indisponible : n.d.', () => {
    const none = { data: null, loaded: false };
    const input: GeneralWatchInput = {
      vigilance: none, floods: none, fires: none, earthquakes: none, airQuality: none, telecom: none, ecowatt: none, nuclear: none,
      cyber: none, military: { data: null, loaded: true }, fuel: none, health: none, power: none, internet: none, cloud: none, drought: none,
      gnss: null, now: NOW,
    };
    expect([...watchLevels(input)]).toEqual([['military', 'nd']]);
  });

  it('passages de niveau notés entre niveaux connus ; une source qui tombe (n.d.) n’écrit rien', () => {
    const last = new Map<keyof MapLayers, 'vert' | 'jaune' | 'orange' | 'rouge'>([['environmental', 'orange'], ['fires', 'vert'], ['cyber', 'jaune']]);
    const t = watchTransitions(last, levels([['environmental', 'vert'], ['fires', 'orange'], ['cyber', 'nd'], ['military', 'jaune']]), NOW);
    expect(t.map((x) => [x.key, x.from, x.to, isEscalation(x)])).toEqual([['environmental', 'orange', 'vert', false], ['fires', 'vert', 'orange', true]]);
  });

  it('chaque couche suivie a une puce de panneau (FLOATING_PANEL_DEFS) : rien n’est suivi sans pouvoir être montré', () => {
    expect(WATCHED_LAYERS).toEqual([
      'environmental', 'floods', 'fires', 'earthquakes', 'airQuality', 'drought', 'outagesElec', 'outagesTelecom', 'outagesInternet',
      'outagesCloud', 'powerGrid', 'nuclearFleet', 'oilNetwork', 'cyber', 'military', 'health',
    ]);
  });
});

describe('puces de la Vue générale (13/10/2026)', () => {
  it('une couche du socle au vert garde sa couche mais perd sa puce ; jaune ou n.d. : puce gardée ; hors suivi : puce gardée', () => {
    const entries = generalWatch(new Map<keyof MapLayers, WatchLevel>([['environmental', 'vert'], ['floods', 'jaune'], ['fires', 'nd']]));
    expect(generalChipHidden('environmental', entries)).toBe(true);
    expect(generalChipHidden('floods', entries)).toBe(false);
    expect(generalChipHidden('fires', entries)).toBe(false);
    expect(generalChipHidden('trafficRoad' as keyof MapLayers, entries)).toBe(false);
  });
});
