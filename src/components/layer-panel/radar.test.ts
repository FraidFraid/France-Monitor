// src/components/layer-panel/radar.test.ts : vue Radar météo (spec 2026-10-04 environnement § 2.3) sur le manifeste et la colonne
// de production du 04/10/2026 (image observée à 08:05Z, 10 h 05 à Paris ; colonne de Nîmes à 53,6 km).
import { describe, expect, it } from 'vitest';
import type { RadarProfileState } from '../../services/environment-radar.ts';
import { ENV_FIXTURE_NOW, RADAR_COLUMN_FIXTURE, RADAR_MANIFEST_FIXTURE } from './environment.fixture.ts';
import { envBreakable } from './environment-format.ts';
import { NBSP, breakableValue, visibleText } from './format.ts';
import { renderLayerView } from './frame.ts';
import { RADAR_TITLE, buildRadarView, type RadarViewInput } from './radar.ts';

const N = NBSP;
const NOW = ENV_FIXTURE_NOW;
const open = (_: string, d: boolean): boolean => d;
const input = (over: Partial<RadarViewInput> = {}): RadarViewInput => ({
  manifest: RADAR_MANIFEST_FIXTURE(), configured: true, manifestError: null, echoTops: false, echoTopsAvailable: true, profile: null,
  now: NOW, open, ...over,
});
const view = (over: Partial<RadarViewInput> = {}) => buildRadarView(input(over));
const html = (over: Partial<RadarViewInput> = {}): string => renderLayerView('weatherRadar', view(over));
const section = (id: string, over: Partial<RadarViewInput> = {}) => view(over).sections.find((s) => s.id === id);
const outsideSvg = (h: string): string => h.replace(/<svg[^]*?<\/svg>/g, '');
const point = (result: RadarProfileState['result']): RadarProfileState => ({ lat: 43.6, lon: 3.9, result });
const CAPTION = `dernière image Météo-France · mosaïque 1${N}km · une image toutes les 5${N}min`;

describe('vue Radar météo : une observation, pas un niveau', () => {
  it('en-tête du 04/10 : heure de la dernière image en gros chiffre jamais coloré, aucune pastille, source datée', () => {
    const v = view();
    expect(v.head).toMatchObject({ theme: 'Environnement', title: RADAR_TITLE });
    expect(v.head.level).toBeUndefined();
    expect(v.head.figure).toEqual({ value: '10:05', caption: CAPTION, level: null });
    expect(v.head.status).toEqual([`Radar Météo-France${N}10:05`]);
    expect(v.head.lead).toBe('Observation de la réflectivité, pas un niveau de vigilance : à lire avec la vigilance Météo-France.');
    const h = html();
    expect(h).toContain('<b class="fmk-num">10:05</b>');
    expect(h).not.toMatch(/fm-vig|lp-lvl/);
    expect(v.bodyHtml).toBeUndefined();
  });
  it('en retard au-delà de 15 min après l’observation : dit dans la légende et la source, jamais coloré', () => {
    const v = view({ now: Date.parse('2026-10-04T08:20:01Z') });
    expect(v.head.figure).toEqual({ value: '10:05', caption: `${CAPTION} (en retard)`, level: null });
    expect(v.head.status[0]).toBe(`Radar Météo-France${N}10:05${N}(en retard)`);
    expect(view({ now: Date.parse('2026-10-04T08:20:00Z') }).head.figure?.caption).toBe(CAPTION);
  });
  it('sections, ordre et ouverture ; « Méthode et sources » en ton de référence', () => {
    expect(view().sections.map((s) => [s.id, s.open ?? false])).toEqual([['echelle', true], ['sommets', false], ['profil', false], ['methode', false]]);
    expect(view().sections.at(-1)?.tone).toBe('reference');
  });
});

describe('échelle des réflectivités', () => {
  it('neuf classes du worker, puce de la classe en jeton, pluie équivalente de Marshall-Palmer', () => {
    const h = section('echelle')?.html ?? '';
    expect(h.match(/class="lp-row"/g)).toHaveLength(9);
    expect(h).toContain(`<span class="lp-swatch" style="background:var(--radar-dbz-1)" aria-hidden="true"></span><span>−9${N}dBZ et plus</span>`
      + `<span class="lp-val fmk-num">&lt;${N}0,1${N}mm/h</span>`);
    expect(h).toContain(`<span>30${N}dBZ et plus</span><span class="lp-val fmk-num">2,7${N}mm/h</span>`);
    expect(h).toContain('style="background:var(--radar-dbz-9)"');
    const t = visibleText(h);
    expect(t).toContain('Pluie équivalente par la relation de Marshall-Palmer : Z = 200 R^1,6');
    expect(t).toContain(`Au-delà de 50${N}dBZ, grêle possible`);
  });
});

describe('sommets d’écho (option partagée avec le panneau Feux)', () => {
  it('option décochée : bouton de bascule, classes en km avec leur jeton', () => {
    const s = section('sommets');
    expect(s?.summary).toBe('masqués');
    expect(s?.html).toContain('<button type="button" class="lp-toggle" data-echo-tops="off" aria-pressed="false">Afficher les sommets d’écho sur la carte</button>');
    expect(s?.html.match(/class="lp-row"/g)).toHaveLength(6);
    expect(visibleText(s?.html ?? '')).toContain(`8${N}km et plus`);
    expect(s?.html).toContain('style="background:var(--echo-top-1)"');
    expect(visibleText(s?.html ?? '')).toContain('pyroconvection');
  });
  it('option cochée : bouton pressé ; non publiés par le manifeste : dit, sans bouton', () => {
    const on = section('sommets', { echoTops: true });
    expect(on?.summary).toBe('affichés');
    expect(on?.html).toContain('data-echo-tops="on" aria-pressed="true">Sommets d’écho affichés sur la carte</button>');
    const off = section('sommets', { echoTopsAvailable: false });
    expect([off?.summary, visibleText(off?.html ?? '')]).toEqual(['non publiés', 'Sommets d’écho non publiés par ce manifeste.']);
    expect(off?.html).not.toContain('data-echo-tops');
  });
});

describe('profil vertical en un point (démonstration)', () => {
  it('aucun point : invitation à cliquer sur la carte', () => {
    const s = section('profil');
    expect(s?.summary).toBe('aucun point');
    expect(visibleText(s?.html ?? '')).toBe('Cliquer sur la carte pour lire le profil vertical de réflectivité au radar le plus proche (démonstration).');
  });
  it('chargement, erreur, hors de portée : dits, avec le point', () => {
    expect(section('profil', { profile: point('loading') })?.summary).toBe('chargement…');
    expect(visibleText(section('profil', { profile: point('loading') })?.html ?? '')).toBe(`Point 43,600${N}N${N}3,900${N}EChargement du profil radar…`);
    expect(section('profil', { profile: point('error') })?.summary).toBe('indisponible');
    expect(section('profil', { profile: point('error') })?.html).toContain('Profil radar indisponible pour le moment.');
    const out = section('profil', { profile: point({ kind: 'hors-couverture' }) });
    expect(out?.summary).toBe('hors de portée');
    expect(out?.html).toContain('DÉMONSTRATION');
  });
  it('profil rendu : station et heure d’observation avec la date, badge DÉMONSTRATION, SVG', () => {
    const s = section('profil', { profile: point(RADAR_COLUMN_FIXTURE()) });
    expect(s?.summary).toBe('NIMES · balayage annoncé pour 04/10 11:30 (heure nominale Météo-France)');
    expect(visibleText(s?.html ?? '')).toContain(`Radar NIMES · 53,6${N}km · balayage annoncé pour 04/10 11:30 (heure nominale Météo-France) · 5 élévations`);
    expect(s?.html).not.toContain('observation du');
    const later = section('profil', { profile: point(RADAR_COLUMN_FIXTURE()), now: Date.parse('2026-10-04T12:00:00+02:00') });
    expect(later?.summary).toBe('NIMES · 04/10 11:30');
    expect(visibleText(later?.html ?? '')).toContain('observation du 04/10 11:30');
    expect(s?.html).toContain('<span class="fmk-tag fmk-tag--warn">DÉMONSTRATION</span>');
    expect(s?.html).toContain('<svg');
  });
});

describe('états de la source', () => {
  it('chargement : en-tête minimal et indicateur', () => {
    const v = view({ manifest: null });
    expect(v.head.status).toEqual(['chargement…']);
    expect(v.sections).toEqual([]);
    expect(v.bodyHtml).toContain('Chargement des données…');
  });
  it('manifeste injoignable sans image : « source injoignable », aucun chiffre', () => {
    const v = view({ manifest: null, manifestError: 'HTTP 502' });
    expect(v.head.figure).toEqual({ value: 'n.d.', caption: CAPTION, level: null });
    expect(v.head.status).toEqual(['Radar Météo-France injoignable']);
    expect(visibleText(v.bodyHtml ?? '')).toBe('Source injoignable. Aucune donnée reçue.');
    const m = v.sections.find((s) => s.id === 'methode');
    expect(m?.summary).toBe('1 source · indisponible');
    expect(visibleText(m?.html ?? '')).toContain('Météo-France, DPRadar · source injoignable');
    expect(visibleText(m?.html ?? '')).toContain('Incident de lecture : HTTP 502.');
  });
  it('lecture en échec, dernière image gardée : dite, avec sa date', () => {
    const v = view({ manifestError: 'Radar 2D manifest HTTP 502' });
    expect(v.head.status).toEqual([`Radar Météo-France${N}10:05`, 'dernière image gardée (lecture en échec)']);
    expect(v.head.figure).toEqual({ value: '10:05', caption: `${CAPTION} (dernière image gardée)`, level: null });
    expect(visibleText(v.bodyHtml ?? '')).toBe('Source injoignable. Dernières données : 10:05.');
  });
  it('worker non configuré : dit partout, jamais « aucune pluie »', () => {
    const v = view({ manifest: null, configured: false });
    expect(v.head.status).toEqual(['worker radar non configuré']);
    expect(visibleText(v.bodyHtml ?? '')).toContain('Worker radar non configuré');
    expect(v.sections.find((s) => s.id === 'profil')?.summary).toBe('n.d.');
    expect(v.sections.find((s) => s.id === 'methode')?.summary).toBe('non configuré');
  });
  it('méthode : image datée avec sa génération, licence, cadence, latence, retard, profil brut', () => {
    const t = visibleText(section('methode')?.html ?? '');
    expect(t).toContain('Météo-France, DPRadar · image du 04/10 10:05, générée à 10:10');
    expect(t).toContain('Licence Ouverte 2.0');
    expect(t).toContain(`une image toutes les 5${N}min, latence de 5 à 10${N}min`);
    expect(t).toContain(`au-delà de 15${N}min après l’observation`);
    expect(t).toContain('sans diagnostic automatique');
  });
});

describe('règles communes', () => {
  it('une valeur sur une ligne (R1), aucun tiret cadratin, aucune police à chasse fixe, aucune couleur brute hors du SVG, jamais « temps réel »', () => {
    for (const over of [{}, { echoTops: true }, { profile: point(RADAR_COLUMN_FIXTURE()) }, { manifest: null, manifestError: 'HTTP 502' },
      { manifest: null, configured: false }, { now: NOW + 3_600_000 }] as Array<Partial<RadarViewInput>>) {
      const h = outsideSvg(html(over));
      const t = visibleText(h);
      expect(breakableValue(t)).toBeNull();
      expect(envBreakable(t)).toBeNull();
      expect(h).not.toMatch(/\u2014|&mdash;|monospace|#[0-9a-fA-F]{6}\b|rgba?\(/);
      expect(t.toLowerCase()).not.toMatch(/temps réel|live/);
    }
  });
  it('texte de panne hostile échappé', () => {
    const h = html({ manifest: null, manifestError: '<img src=x onerror=alert(1)>' });
    expect(h).not.toContain('<img src=x');
    expect(h).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
