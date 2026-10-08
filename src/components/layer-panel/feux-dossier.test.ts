// @vitest-environment happy-dom
// src/components/layer-panel/feux-dossier.test.ts : onglet « Dossier d'un feu », règles du dossier OSINT reprises de
// WildfireDossierModal (aucun chiffre sans provenance ni notes, séries jamais réconciliées, échappement, liens http(s) seulement).
import { describe, expect, it, vi } from 'vitest';
import type { ImpactFact, LocatedFireIncident } from '../../types/index.ts';
import { buildDossier } from '../../services/wildfire-dossier.ts';
import { ENV_FIXTURE_NOW, FIRE_IMPACTS_FIXTURE } from './environment.fixture.ts';
import { NBSP, visibleText } from './format.ts';
import { dossierSections, incidentPlace, renderDeclaredBlock, renderFactRow, type FeuxDossierInput } from './feux-dossier.ts';

const NOW = ENV_FIXTURE_NOW;
const open = (_: string, d: boolean): boolean => d;

function fact(over: Partial<ImpactFact> = {}): ImpactFact {
  return {
    id: 1, kind: 'area_ha', value: 42000, unit: 'ha', quote: '42 000 hectares de forêt ont été détruits',
    sourceUrl: 'https://www.sudouest.fr/a/1', sourceName: 'Sud Ouest', sourceLevel: 'secondary', reliability: 'D', hedged: false, provisional: true,
    observedAt: '2026-07-26T08:00:00Z', communes: ['Le Porge'], credibility: 4, corroboration: ['Sud Ouest'], ...over,
  };
}

const PORGE: LocatedFireIncident = {
  id: 'porge-1', centroidLat: 44.88, centroidLon: -1.12, bboxMinLat: 44.85, bboxMaxLat: 44.9, bboxMinLon: -1.15, bboxMaxLon: -1.05,
  detectionsCount: 48, frpMean: 6.4, frpMax: 21.4, frpTotal: 307.6, confidenceMax: 'nominal', startDatetime: '2026-10-04T01:20:00Z',
  endDatetime: '2026-10-04T03:00:00Z', durationMinutes: 100, satellites: ['Suomi NPP', 'NOAA-20'], hasNightDetection: true, nearUrban: false,
  clusterMethod: 'dbscan', epsKm: 3, minPoints: 2, score: { severityScore: 40, impactScore: 20, labels: [] }, detectionIds: [],
  deptCodes: ['33'], communes: ['Le Porge'],
};

const input = (over: Partial<FeuxDossierInput> = {}): FeuxDossierInput => ({
  incident: PORGE, dossier: buildDossier(PORGE, [], ['33']), impacts: FIRE_IMPACTS_FIXTURE(), impactsError: null, ...over,
});
const sectionOf = (id: string, over: Partial<FeuxDossierInput> = {}) => dossierSections(input(over), NOW, open).find((s) => s.id === id);

describe('fait déclaré (repris de WildfireDossierModal)', () => {
  it('valeur et unité insécables, source, niveau, deux notes (D4), provisoire et approximatif', () => {
    const h = renderFactRow(fact({ hedged: true }));
    expect(h).toContain(`42\u202f000${NBSP}ha`);
    expect(h).toContain('Sud Ouest');
    expect(h).toContain('source secondaire');
    expect(h).toContain('>D4<');
    expect(h).toContain('provisoire');
    expect(h).toContain('approximatif');
    expect(h).toContain('26/07 10:00');
  });
  it('fait qualitatif : aucune valeur inventée', () => {
    const h = renderFactRow(fact({ kind: 'evacuation_order', value: null, unit: null }));
    expect(h).toContain('Ordre d’évacuation');
    expect(h).not.toContain('null');
    expect(visibleText(h)).not.toMatch(/\b0\b/);
  });
  it('texte tiers échappé ; lien de source en http(s) seulement, sinon la provenance reste en texte', () => {
    const h = renderFactRow(fact({ quote: '<script>alert(1)</script>', sourceName: '<img src=x onerror=alert(1)>' }));
    const el = document.createElement('div');
    el.innerHTML = h;
    expect(el.querySelectorAll('img, script')).toHaveLength(0);
    for (const url of ['javascript:alert(document.cookie)', 'data:text/html,<script>alert(1)</script>', '/a/1', '']) {
      const box = document.createElement('div');
      box.innerHTML = renderFactRow(fact({ sourceUrl: url }));
      expect(box.querySelector('a'), url).toBeNull();
      expect(box.textContent).toContain('Sud Ouest');
    }
    const ok = document.createElement('div');
    ok.innerHTML = renderFactRow(fact());
    expect(ok.querySelector('a')?.getAttribute('href')).toBe('https://www.sudouest.fr/a/1');
  });
});

describe('bloc déclaré : trois états jamais confondus', () => {
  it('aucun fait : « Impacts non renseignés. » (silence de la source, jamais un zéro)', () => {
    expect(visibleText(renderDeclaredBlock([]))).toBe('Impacts non renseignés.');
  });
  it('tous rejetés : donnée corrompue ; certains rejetés : liste et mention accordée', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(visibleText(renderDeclaredBlock([{ id: 2, kind: 'evacuated' } as unknown as ImpactFact]))).toBe('1 fait reçu mais invalide : donnée corrompue.');
      const mixed = renderDeclaredBlock([fact(), { id: 2, kind: 'bogus' } as unknown as ImpactFact, fact({ id: 3, kind: 'evacuated', value: 12, unit: 'personnes' })]);
      expect(mixed.match(/<li class="wf-fact"/g)).toHaveLength(2);
      expect(visibleText(mixed)).toContain('1 fait ignoré : donnée invalide.');
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('sections du dossier', () => {
  it('ordre : observé, déclaré, communes ; chronologie de la surface seulement si publiée', () => {
    expect(dossierSections(input(), NOW, open).map((s) => s.id)).toEqual(['dossier-observe', 'dossier-declare', 'dossier-communes']);
    const withArea = input({ dossier: buildDossier(PORGE, [fact(), fact({ id: 2, value: 45000, observedAt: '2026-07-26T12:00:00Z', sourceName: 'Préfecture' })], ['33']) });
    const ids = dossierSections(withArea, NOW, open).map((s) => s.id);
    expect(ids).toEqual(['dossier-observe', 'dossier-declare', 'dossier-communes', 'dossier-chronologie']);
    const t = visibleText(dossierSections(withArea, NOW, open)[3].html);
    expect(t).toContain(`26/07 10:0042\u202f000${NBSP}ha`);
    expect(t).toContain(`26/07 14:0045\u202f000${NBSP}ha`);
  });
  it('observé : sévérité colorée (moyenne, jaune), mesures insécables, emprise sans tiret, dernière détection datée', () => {
    const s = sectionOf('dossier-observe');
    expect(s?.summary).toBe(`48 détections · 307,6${NBSP}MW`);
    const h = s?.html ?? '';
    expect(h).toContain('<span class="lp-val fmk-num lp-lvl lp-lvl--jaune">moyenne</span>');
    const t = visibleText(h);
    expect(t).toContain(`Persistance1${NBSP}h${NBSP}40`);
    expect(t).toContain(`Dernière détection04/10 05:00 (il y a 5${NBSP}h${NBSP}10)`);
    expect(t).toContain(`Emprise44,85 à 44,90${NBSP}N · 1,15 à 1,05${NBSP}O`);
    expect(t).toContain('Confiance maximalenominale');
  });
  it('communes à moins de 10 km : distance, population, rapport Géorisques de la plus proche ; aucune estimation de maisons ni d’évacués', () => {
    const s = sectionOf('dossier-communes');
    expect(s?.summary).toBe('3 communes');
    const h = s?.html ?? '';
    const t = visibleText(h);
    expect(t).toContain(`Le Porge (Gironde)2,1${NBSP}km3${'\u202f'}465${NBSP}habitants`);
    expect(t).toContain(`Saumos (Gironde)9,9${NBSP}km550${NBSP}habitants`);
    expect(h).toContain('<a class="lp-link" href="https://www.georisques.gouv.fr/api/v1/rapport_pdf?code_insee=33333" target="_blank" rel="noopener noreferrer">rapport Géorisques de la commune (PDF)</a>');
    expect(t).toContain(`Zonage des risques de Le Porge, commune la plus proche (2,1${NBSP}km) :`);
    expect(t).toContain('Aucune estimation de maisons menacées ni d’évacués : l’impact humain ne se déduit pas de la puissance radiative.');
  });
  it('communes : panne nommée, chargement dit, aucune commune dite', () => {
    expect(visibleText(sectionOf('dossier-communes', { impacts: null, impactsError: 'HTTP 502' })?.html ?? '')).toContain('Source indisponible : communes de geo.api.gouv.fr.');
    expect(sectionOf('dossier-communes', { impacts: null, impactsError: null })?.summary).toBe('chargement…');
    const none = { ...FIRE_IMPACTS_FIXTURE(), communes: [], nearest: null, georisquesUrl: null };
    const t = visibleText(sectionOf('dossier-communes', { impacts: none })?.html ?? '');
    expect(t).toContain(`Aucune commune dont le centre est à moins de 10${NBSP}km.`);
    expect(t).toContain('Rapport Géorisques indisponible : aucune commune lue près du foyer.');
  });
  it('lieu d’un incident : départements nommés et communes ; à défaut, coordonnées', () => {
    expect(incidentPlace(PORGE)).toBe('Gironde (33) · Le Porge');
    expect(incidentPlace({ ...PORGE, deptCodes: [], communes: [] })).toBe(`44,880${NBSP}N 1,120${NBSP}O`);
  });
});

describe('communes autour du feu : décisions du contrôleur postérieures à la brief', () => {
  it('commune la plus proche au-delà de 10 km : dit, avec sa distance, et son rapport Géorisques (PDF de la commune)', () => {
    const far = {
      ...FIRE_IMPACTS_FIXTURE(), communes: [],
      nearest: { code: '33333', name: 'Le Porge', dept: '33', population: 3465, distanceKm: 12.3 },
      georisquesUrl: 'https://www.georisques.gouv.fr/api/v1/rapport_pdf?code_insee=33333',
    };
    const s = sectionOf('dossier-communes', { impacts: far });
    expect(s?.summary).toBe('0 commune');
    const t = visibleText(s?.html ?? '');
    expect(t).toContain(`Aucune commune dont le centre est à moins de 10${NBSP}km ; la plus proche, Le Porge (Gironde), est à 12,3${NBSP}km.`);
    expect(t).toContain(`Zonage des risques de Le Porge, commune la plus proche, au-delà de 10${NBSP}km (12,3${NBSP}km) :`);
    expect(s?.html).toContain('href="https://www.georisques.gouv.fr/api/v1/rapport_pdf?code_insee=33333"');
    // Commune la plus proche à moins de 10 km : jamais « au-delà ».
    expect(visibleText(sectionOf('dossier-communes')?.html ?? '')).not.toContain('au-delà');
  });
  it('département voisin non lu et liste vide : panne nommée, jamais « aucune commune »', () => {
    const partial = { ...FIRE_IMPACTS_FIXTURE(), communes: [], nearest: null, georisquesUrl: null, errors: ['geo.api.gouv.fr, département 33 : HTTP 503'] };
    const s = sectionOf('dossier-communes', { impacts: partial });
    expect(s?.summary).toBe('n.d.');
    const t = visibleText(s?.html ?? '');
    expect(t).toContain('Source indisponible : communes de geo.api.gouv.fr.');
    expect(t).not.toContain('Aucune commune');
    expect(t).toContain('Incidents de lecture : geo.api.gouv.fr, département 33 : HTTP 503.');
  });
  it('jamais d’estimation de maisons menacées ni d’évacués, quel que soit l’état des communes', () => {
    const states: Array<Partial<FeuxDossierInput>> = [{}, { impacts: null, impactsError: 'HTTP 502' }, { impacts: { ...FIRE_IMPACTS_FIXTURE(), communes: [], nearest: null, georisquesUrl: null } }];
    for (const over of states) {
      const t = visibleText(sectionOf('dossier-communes', over)?.html ?? '');
      expect(t).toContain('Aucune estimation de maisons menacées ni d’évacués');
      expect(t).not.toMatch(/\d[\d\u202f\u00a0]*\s*(?:maisons|habitations|évacués)/);
    }
  });
});

describe('correction 1 de la revue : emprise et persistance', () => {
  it('emprise à cheval sur le méridien de Greenwich : sens de chaque borne tiré de son propre signe', () => {
    const t = visibleText(sectionOf('dossier-observe', { incident: { ...PORGE, bboxMinLon: -0.1, bboxMaxLon: 0.2 } })?.html ?? '');
    expect(t).toContain(`Emprise44,85 à 44,90${NBSP}N · 0,10${NBSP}O à 0,20${NBSP}E`);
  });
  it('persistance : minutes totales arrondies avant d’être découpées, jamais « 1 h 60 »', () => {
    const at = (durationMinutes: number): string => visibleText(sectionOf('dossier-observe', { incident: { ...PORGE, durationMinutes } })?.html ?? '');
    expect(at(119.6)).toContain(`Persistance2${NBSP}h${NBSP}00`);
    expect(at(59.7)).toContain(`Persistance1${NBSP}h${NBSP}00`);
    expect(at(25.4)).toContain(`Persistance25${NBSP}min`);
    for (const m of [59.7, 119.6, 179.5]) expect(at(m)).not.toMatch(/h\u00a060/);
  });
});
