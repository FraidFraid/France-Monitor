// src/components/layer-panel/sovereignty-legend.test.ts
// Légendes de carte Souveraineté (spec 2026-10-04 souveraineté § 2 ; contrats § 3.9) : sources réellement appelées et leurs
// licences, date de la donnée, « (en retard) » ; teintes de MapLibre égales aux jetons de main.css.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CablesWatchResponse, CyberResponse, MilitaryResponse, SubseaCablesFile } from '../../types/index.ts';
import { levelHex } from '../../services/vigilance.ts';
import type { LegendCategory } from '../MapLegend.ts';
import {
  BASE_TYPE_HEX, CABLE_HEX, CLAIMS_HEX, CONNECTIVITY_LEGEND, CYBER_LEGEND, DEFENSE_LEGEND, KEV_CITED_HEX, KEV_HEX, LANDING_HEX, MIL_AUTRES_HEX,
  MIL_FRANCAIS_HEX, NAVY_HEX, SOV_ABROAD_HEX, connectivityLegend, cyberLegend, defenseLegend,
} from './sovereignty-legend.ts';
import { NBSP } from './format.ts';
import { sovBreakable } from './sovereignty-format.ts';

const css = readFileSync(new URL('../../styles/main.css', import.meta.url), 'utf8');
const NOW = Date.parse('2026-10-04T16:48:30+02:00');
const MIN = 60_000;
const text = (c: LegendCategory): string =>
  [c.title, ...c.items.map((i) => i.label), c.source?.label ?? '', c.refresh?.label ?? '', ...(c.notes ?? [])].join(' | ');
const COLORS_GONE = 'En retard : couleurs retirées de la carte.';

const MIL: MilitaryResponse = {
  readAt: '2026-10-04T14:48:30Z', sourceNow: '2026-10-04T14:48:24.501Z', frenchByDept: [], others: [], maskedOthers: 0, abroadCount: 3, abroad: [], emergencies: [], emergencyLog: [],
  hourly: { hours: [], since: null }, errors: [],
};
const FILE: SubseaCablesFile = {
  generatedAt: '2026-10-04T13:02:00Z', osmBase: '2026-10-04T12:47:16Z', sources: [], cables: [], cableZones: [], anchorageZones: [],
};
const WATCH: CablesWatchResponse = {
  readAt: '2026-10-04T14:47:40Z', aisLastMessageAt: '2026-10-04T14:47:31Z', evaluated: true,
  cablesFile: { generatedAt: '2026-10-04T13:02:00Z', osmBase: '2026-10-04T12:47:16Z', cables: 39, landings: 50 }, slowVessels: 41, alerts: [], errors: [],
};
const CYBER: CyberResponse = {
  readAt: '2026-10-04T14:47:10Z', certfr: { readAt: '2026-10-04T14:47:10Z', alerts: [], avis: [], reports: [] },
  kev: { readAt: '2026-10-04T14:48:14Z', catalogVersion: '2026.10.02', dateReleased: '2026-10-02T15:19:38.2945Z', count: 1733, recent: [], weeks: [] },
  ransomware: null, hibp: null, cybermalveillance: null, errors: [],
};

describe('teintes : jetons CSS égaux aux hex de MapLibre', () => {
  it('catégories de la souveraineté', () => {
    for (const [token, hex] of [
      ['--cat-mil-francais', MIL_FRANCAIS_HEX], ['--cat-mil-autres', MIL_AUTRES_HEX], ['--cat-mil-etranger', SOV_ABROAD_HEX], ['--cat-navy', NAVY_HEX],
      ['--cat-cable', CABLE_HEX], ['--cat-landing', LANDING_HEX], ['--cat-kev', KEV_HEX], ['--cat-kev-cite', KEV_CITED_HEX], ['--cat-revendication', CLAIMS_HEX],
    ] as const) expect(css).toContain(`${token}: ${hex};`);
    expect(BASE_TYPE_HEX).toEqual({ air: '#4a9eff', navy: '#00d4c8', army: '#22c55e', joint: '#a855f7', fortification: '#78716c', other: '#f59e0b' });
  });
});

describe('légendes de base : sources réellement appelées, jamais « temps réel »', () => {
  it('Défense, Connectivité et Vigilance cyber ; identifiants des couches', () => {
    expect([DEFENSE_LEGEND.id, CONNECTIVITY_LEGEND.id, CYBER_LEGEND.id]).toEqual(['military', 'subseaCables', 'cyber']);
    expect([DEFENSE_LEGEND.title, CONNECTIVITY_LEGEND.title, CYBER_LEGEND.title]).toEqual(['Défense', 'Connectivité', 'Vigilance cyber']);
    expect(DEFENSE_LEGEND.source?.label).toContain('Données adsb.lol, ODbL 1.0');
    expect(DEFENSE_LEGEND.source?.label).toContain('AIS : aisstream.io via le relais');
    expect(CONNECTIVITY_LEGEND.source?.label).toContain('© les contributeurs d’OpenStreetMap, ODbL 1.0');
    expect(CONNECTIVITY_LEGEND.source?.label).toContain('Shom (CC BY-SA)');
    expect(CONNECTIVITY_LEGEND.source?.url).toBe('https://www.data.gouv.fr/datasets/conduites-et-cables-sous-marins-repertories-par-le-shom/');
    expect(CONNECTIVITY_LEGEND.notes?.join(' ')).toContain('Méthode et sources');
    expect(text(CYBER_LEGEND)).toContain('Pas de lieu publié : voir le panneau');
    for (const c of [DEFENSE_LEGEND, CONNECTIVITY_LEGEND, CYBER_LEGEND]) {
      expect(text(c)).not.toMatch(/temps réel|ADS-B Exchange|Marine ?Traffic|SubmarineCableMap|Shodan|Censys|~\s?5 min|OpenSky|adsb\.fi|\u2014/i);
      for (const item of c.items) expect(sovBreakable(item.label), item.label).toBeNull();
      for (const n of c.notes ?? []) expect(sovBreakable(n), n).toBeNull();
    }
  });
  it('Défense : hors de France en gris, urgences par niveau, ports d’attache de référence, sites ; plus de zones « ZIT » (tâche B27)', () => {
    const t = text(DEFENSE_LEGEND);
    for (const label of ['Autres pays', 'Hors de France, jamais compté', 'Urgence confirmée (deux lectures)',
      'Urgence vue une fois', 'Bâtiment vu en AIS (heure en étiquette)', 'Port base : position de référence, pas une observation',
    ]) expect(t).toContain(label);
    expect(t).not.toContain('Zone interdite');
    // S5 (FX2) : la mer territoriale en milles, comme le panneau ; plus jamais « 22 km ».
    expect(t).toContain(`au-dessus de la mer territoriale (moins de 12${NBSP}milles de la côte)`);
    expect(t).not.toMatch(/22.km/);
    const color = (id: string): string | undefined => DEFENSE_LEGEND.items.find((i) => i.id === id)?.color;
    expect(color('mil-francais')).toBeUndefined();
    expect([color('mil-autres'), color('mil-abroad'), color('mil-emergency-confirmed'), color('mil-emergency-once')])
      .toEqual([MIL_AUTRES_HEX, SOV_ABROAD_HEX, levelHex('orange'), levelHex('jaune')]);
    expect(DEFENSE_LEGEND.items[0]?.label).toBe('Aéronefs militaires ou d’État visibles en ADS-B au-dessus de la métropole');
    expect(t).toContain('Un appareil absent du flux n’est pas absent du ciel.');
  });
});

describe('légendes datées par la donnée (S1, S2)', () => {
  it('Défense : relevé adsb.lol à l’heure de Paris ; en retard après 10 min : dit, couleurs retirées ; jamais lue : indisponible', () => {
    expect(defenseLegend(MIL, { osmWorks: false, droneZones: false }, NOW).refresh?.label).toBe('Relevé adsb.lol 16:48');
    const late = defenseLegend(MIL, { osmWorks: false, droneZones: false }, NOW + 11 * MIN);
    expect(late.refresh?.label).toBe('Relevé adsb.lol 16:48 (en retard)');
    expect(late.notes).toContain(COLORS_GONE);
    expect(defenseLegend(null, { osmWorks: false, droneZones: false }, NOW).refresh?.label).toBe('adsb.lol indisponible');
    expect(defenseLegend({ ...MIL, readAt: null }, { osmWorks: false, droneZones: false }, NOW).refresh?.label).toBe('adsb.lol indisponible');
  });
  it('Défense : option des ouvrages OpenStreetMap, avec sa licence', () => {
    const on = defenseLegend(MIL, { osmWorks: true, droneZones: false }, NOW);
    expect(text(on)).toContain('Ouvrage OpenStreetMap (ODbL 1.0)');
    expect(text(defenseLegend(MIL, { osmWorks: false, droneZones: false }, NOW))).not.toContain('Ouvrage OpenStreetMap');
  });
  it('Connectivité : AIS à jour, fichier OSM daté ; veille non évaluée : sa cause dite (AIS muet, fichier illisible) ; jamais lue : indisponible', () => {
    const c = connectivityLegend(FILE, WATCH, NOW);
    expect(c.refresh?.label).toBe('AIS à jour 16:47');
    expect(c.notes).toContain('Tracés du Shom (CC BY-SA) et d’OpenStreetMap (ODbL 1.0) du 04/10, précision non garantie.');
    const mute = connectivityLegend(FILE, { ...WATCH, evaluated: false, aisLastMessageAt: '2026-10-04T14:41:00Z' }, NOW);
    expect(mute.refresh?.label).toBe('AIS muet depuis 16:41 : alertes non évaluées');
    expect(mute.notes).toContain('Veille non évaluée : navires signalés en gris, ni confirmés ni retirés.');
    const noFile = connectivityLegend(FILE, { ...WATCH, evaluated: false, errors: ['Câbles (Shom, OpenStreetMap) : fichier illisible'] }, NOW);
    expect(noFile.refresh?.label).toBe('Fichier des câbles illisible : alertes non évaluées');
    expect(connectivityLegend(null, null, NOW).refresh?.label).toBe('Veille des câbles indisponible');
    expect(connectivityLegend(null, WATCH, NOW).notes).toContain('Fichier des câbles illisible : tracés absents.');
  });
  it('Vigilance cyber : CERT-FR lu à l’heure de Paris ; en retard après 6 h ; jamais lu : indisponible', () => {
    expect(cyberLegend(CYBER, NOW).refresh?.label).toBe('CERT-FR lu à 16:47');
    expect(cyberLegend(CYBER, NOW + 6 * 60 * MIN + MIN).refresh?.label).toBe('CERT-FR lu à 16:47 (en retard)');
    expect(cyberLegend(null, NOW).refresh?.label).toBe('CERT-FR indisponible');
  });
  it('R1 : tous les textes de légende, de base et datés, sans nombre et unité séparables', () => {
    const all = [DEFENSE_LEGEND, CONNECTIVITY_LEGEND, CYBER_LEGEND,
      defenseLegend(MIL, { osmWorks: true, droneZones: false }, NOW), defenseLegend(MIL, { osmWorks: true, droneZones: false }, NOW + 11 * MIN),
      defenseLegend(null, { osmWorks: false, droneZones: false }, NOW),
      connectivityLegend(FILE, WATCH, NOW), connectivityLegend(FILE, { ...WATCH, evaluated: false }, NOW), connectivityLegend(null, null, NOW),
      connectivityLegend(FILE, { ...WATCH, aisLastMessageAt: '2026-10-04T14:00:00Z' }, NOW),
      cyberLegend(CYBER, NOW), cyberLegend(CYBER, NOW + 6 * 60 * MIN + MIN), cyberLegend(null, NOW)];
    for (const c of all) {
      for (const t of [c.title, ...c.items.map((i) => i.label), c.source?.label ?? '', c.refresh?.label ?? '', ...(c.notes ?? [])]) {
        expect(sovBreakable(t), t).toBeNull();
      }
    }
  });
  it('copies : la légende de base n’est jamais modifiée', () => {
    const before = JSON.stringify(DEFENSE_LEGEND);
    defenseLegend(MIL, { osmWorks: true, droneZones: false }, NOW + 11 * MIN).items.push({ id: 'x', label: 'x' });
    expect(JSON.stringify(DEFENSE_LEGEND)).toBe(before);
  });
});
