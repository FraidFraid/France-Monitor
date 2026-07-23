import { describe, expect, it } from 'vitest';

import { radarProfileErrorHtml, radarProfileHtml, radarProfileLoadingHtml } from './radar-profile-view.ts';
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

describe('radarProfileHtml', () => {
  it('affiche badge DÉMONSTRATION, station, distance et nb d’élévations', () => {
    const html = radarProfileHtml({ kind: 'profile', profile: PROFILE });
    expect(html).toContain('DÉMONSTRATION');
    expect(html).toContain('BORDEAUX');
    expect(html).toContain('42.7');
    expect(html).toContain('3 élévations');
    expect(html).toContain('Réflectivité brute');
    expect(html).toContain('sans diagnostic automatique');
    expect(html).toContain('<svg');
  });

  it('rend un point par niveau avec écho, un marqueur creux sinon', () => {
    const html = radarProfileHtml({ kind: 'profile', profile: PROFILE });
    expect((html.match(/data-dbz=/g) ?? []).length).toBe(2);
    expect((html.match(/data-empty=/g) ?? []).length).toBe(1);
  });

  it('gère hors couverture sans SVG', () => {
    const html = radarProfileHtml({ kind: 'hors-couverture' });
    expect(html).toContain('hors de portée');
    expect(html).not.toContain('<svg');
  });

  it('échappe le nom de station', () => {
    const hostile = {
      ...PROFILE,
      station: { ...PROFILE.station, name: '<img src=x>' },
    };
    const html = radarProfileHtml({ kind: 'profile', profile: hostile });
    expect(html).not.toContain('<img src=x>');
  });

  it('expose des états chargement et erreur', () => {
    expect(radarProfileLoadingHtml()).toContain('Chargement');
    expect(radarProfileErrorHtml()).toContain('indisponible');
  });
});
