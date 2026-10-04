import { describe, expect, it } from 'vitest';

import { radarProfileErrorHtml, radarProfileHtml, radarProfileLoadingHtml } from './radar-profile-view.ts';
import { RADAR_COLUMN_FIXTURE, ENV_FIXTURE_NOW } from './layer-panel/environment.fixture.ts';
import { NBSP, visibleText } from './layer-panel/format.ts';
import { envBreakable } from './layer-panel/environment-format.ts';
import type { RadarColumnProfile } from '../types/index.ts';

const PROFILE: RadarColumnProfile = {
  schemaVersion: 1,
  source: 'Météo-France DPRadar',
  license: 'Licence Ouverte 2.0',
  station: { id: 41, name: 'BORDEAUX', lat: 44.83139, lon: -0.69194 },
  distanceKm: 42.7,
  observedAt: '2026-07-23T08:30:00Z',
  levels: [
    { elevationDeg: 0.4, altitudeM: 620, dbz: 24.5 },
    { elevationDeg: 2.7, altitudeM: 2300, dbz: 12 },
    { elevationDeg: 8, altitudeM: 7150, dbz: null },
  ],
};
/** Le 23/07/2026 à 11 h à Paris : observation du jour même, la date est écrite quand même. */
const NOW = Date.parse('2026-07-23T11:00:00+02:00');
/** HTML hors de l'élément SVG (dont les libellés d'axe ne passent jamais à la ligne). */
const outsideSvg = (html: string): string => html.replace(/<svg[^]*?<\/svg>/g, '');

describe('radarProfileHtml', () => {
  it('affiche badge DÉMONSTRATION, station, distance sur une ligne, date et heure d’observation, nombre d’élévations', () => {
    const html = radarProfileHtml({ kind: 'profile', profile: PROFILE }, NOW);
    expect(html).toContain('<span class="fmk-tag fmk-tag--warn">DÉMONSTRATION</span>');
    expect(html).toContain(`Radar BORDEAUX · 42,7${NBSP}km · observation du 23/07 10:30 · 3 élévations`);
    expect(html).toContain('Réflectivité brute');
    expect(html).toContain('sans diagnostic automatique');
    expect(html).toContain('<svg');
  });

  it('colonne de production du 04/10 (Nîmes, 53,6 km, 5 élévations) datée, même un autre jour que maintenant', () => {
    const html = radarProfileHtml(RADAR_COLUMN_FIXTURE(), ENV_FIXTURE_NOW);
    expect(visibleText(html)).toContain(`Radar NIMES · 53,6${NBSP}km · observation du 04/10 11:30 · 5 élévations`);
    expect(radarProfileHtml(RADAR_COLUMN_FIXTURE(), Date.parse('2026-10-05T09:00:00+02:00'))).toContain('observation du 04/10 11:30');
    expect((html.match(/data-dbz=/g) ?? []).length).toBe(1);
    expect((html.match(/data-empty=/g) ?? []).length).toBe(4);
  });

  it('classes du cadre : aucun style en ligne hors du SVG ; une valeur sur une ligne (R1) ; aucun tiret cadratin', () => {
    for (const html of [radarProfileHtml({ kind: 'profile', profile: PROFILE }, NOW), radarProfileHtml({ kind: 'hors-couverture' }, NOW),
      radarProfileLoadingHtml(), radarProfileErrorHtml()]) {
      expect(outsideSvg(html)).not.toContain('style=');
      expect(envBreakable(visibleText(outsideSvg(html)))).toBeNull();
      expect(html).not.toMatch(/\u2014|&mdash;|monospace/);
    }
  });

  it('rend un point par niveau avec écho, un marqueur creux sinon', () => {
    const html = radarProfileHtml({ kind: 'profile', profile: PROFILE }, NOW);
    expect((html.match(/data-dbz=/g) ?? []).length).toBe(2);
    expect((html.match(/data-empty=/g) ?? []).length).toBe(1);
  });

  it('gère hors couverture sans SVG', () => {
    const html = radarProfileHtml({ kind: 'hors-couverture' }, NOW);
    expect(html).toContain('DÉMONSTRATION');
    expect(visibleText(html)).toContain(`Point hors de portée des radars de métropole (plus de 160${NBSP}km).`);
    expect(html).not.toContain('<svg');
  });

  it('échappe le nom de station', () => {
    const hostile = {
      ...PROFILE,
      station: { ...PROFILE.station, name: '<img src=x>' },
    };
    const html = radarProfileHtml({ kind: 'profile', profile: hostile }, NOW);
    expect(html).not.toContain('<img src=x>');
    expect(html).toContain('&lt;img src=x&gt;');
  });

  it('expose des états chargement et erreur', () => {
    expect(radarProfileLoadingHtml()).toBe('<p class="fmk-note">Chargement du profil radar…</p>');
    expect(radarProfileErrorHtml()).toBe('<p class="fmk-note">Profil radar indisponible pour le moment.</p>');
  });

  it("adapte l'axe des altitudes au niveau le plus haut du profil", () => {
    // Niveau max 7150 m → palier 2 km → plafond 8 km (plus de 12 km fixe).
    const html = radarProfileHtml({ kind: 'profile', profile: PROFILE }, NOW);
    expect(html).toContain('>8 km<');
    expect(html).not.toContain('12 km');

    // Profil bas (620 m) → plafond 1 km, graduations 0,5 km.
    const low = {
      ...PROFILE,
      levels: [{ elevationDeg: 0.4, altitudeM: 620, dbz: 12 }],
    };
    const lowHtml = radarProfileHtml({ kind: 'profile', profile: low }, NOW);
    expect(lowHtml).toContain('>1 km<');
    expect(lowHtml).toContain('>0.5 km<');
    expect(lowHtml).not.toContain('>8 km<');

    // Niveau haut (29 km, filtré à 30 km côté worker) → plafond 30 km lisible.
    const high = {
      ...PROFILE,
      levels: [{ elevationDeg: 45, altitudeM: 29_000, dbz: null }],
    };
    const highHtml = radarProfileHtml({ kind: 'profile', profile: high }, NOW);
    expect(highHtml).toContain('>30 km<');
  });
});
