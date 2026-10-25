import { describe, it, expect } from 'vitest';
import { GENERAL_SOCLE, WATCHED_LAYERS, generalChipHidden, generalWatch, isEscalation, watchLevels, watchTransitions, type GeneralWatchInput, type WatchLevel } from './watch.ts';
import type { MapLayers } from '../../types/index.ts';

const NOW = Date.parse('2026-10-12T08:00:00Z');
const levels = (entries: Array<[keyof MapLayers, WatchLevel]>): Map<keyof MapLayers, WatchLevel> => new Map(entries);

describe('Vue générale dynamique (12/10/2026)', () => {
  it('socle toujours (vert par défaut), autres couches seulement en orange ou en rouge (19/10/2026 : ni jaune ni n.d.) ; rouge d’abord', () => {
    const out = generalWatch(levels([
      ['environmental', 'jaune'], ['floods', 'vert'], ['fires', 'orange'], ['earthquakes', 'vert'], ['cyber', 'nd'],
      ['military', 'rouge'], ['powerGrid', 'jaune'],
    ]));
    expect(out.map((e) => [e.key, e.level])).toEqual([
      ['military', 'rouge'], ['fires', 'orange'], ['environmental', 'jaune'], ['floods', 'vert'],
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
      'outagesCloud', 'powerGrid', 'nuclearFleet', 'oilNetwork', 'cyber', 'military', 'health', 'disasters',
      'trafficRail', 'trafficRoad', 'trafficAir', 'trafficMaritime',
    ]);
  });

  it('Trafics (lot 1 Transports, 25/10/2026) : niveau de la pastille de chaque panneau ; donnée absente ou périmée : n.d.', () => {
    const none = { data: null, loaded: false };
    const read = { data: null, loaded: true };
    const rail = {
      updatedAt: '2026-10-12T07:58:00Z', longDistance: { active: 60, delayed15: 2 }, topDelays: [], trains: [], errors: [],
      axes: [{ key: 'atlantique', label: 'Atlantique', trains: 6, avgDelayMin: 95, maxDelayMin: 300, cancelled: 0, reduced: 0, detour: 0 }], regions: [],
    };
    const input: GeneralWatchInput = {
      vigilance: none, floods: none, fires: none, earthquakes: none, airQuality: none, telecom: none, ecowatt: none, nuclear: none,
      cyber: none, military: none, fuel: none, health: none, power: none, internet: none, cloud: none, drought: none,
      traffic: { road: read, air: none, rail: { data: rail, loaded: true }, maritime: none },
      gnss: null, now: NOW,
    };
    expect([...watchLevels(input)]).toEqual([['trafficRoad', 'nd'], ['trafficRail', 'rouge']]);
    // Rouge : la couche entre dans la Vue générale ; n.d. : non.
    expect(generalWatch(watchLevels(input)).map((e) => e.key)).toEqual(['trafficRail', 'environmental', 'floods']);
  });
});

describe('puces de la Vue générale (13/10/2026)', () => {
  it('une couche du socle sous l’orange garde sa couche mais perd sa puce (19/10/2026) ; orange : puce gardée ; hors suivi : puce gardée', () => {
    const entries = generalWatch(new Map<keyof MapLayers, WatchLevel>([['environmental', 'vert'], ['floods', 'jaune'], ['fires', 'orange']]));
    expect(generalChipHidden('environmental', entries)).toBe(true);
    expect(generalChipHidden('floods', entries)).toBe(true);
    expect(generalChipHidden('fires', entries)).toBe(false);
    expect(generalChipHidden('trafficRoad' as keyof MapLayers, entries)).toBe(false);
  });
});
