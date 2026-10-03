// src/components/deckgl/health-map.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { EpidemicPhase, HospitalCategory, RegionalAlertLevel } from '../../types/index.ts';
import { levelHex } from '../../services/vigilance.ts';
import { HEALTH_NOW, alertLevelsFixture, aplFixture, hospitalsFixture, syndromicFixture } from '../layer-panel/health.fixture.ts';
import { NBSP } from '../layer-panel/format.ts';
import type { LegendCategory } from '../MapLegend.ts';
import { HOSPITAL_CATEGORY_LABEL } from '../layer-panel/health-format.ts';
import { LYR_HEALTH_ALERT_FILL, LYR_HEALTH_APL_FILL, LYR_HEALTH_HANTAVIRUS, LYR_HEALTH_URG_FILL, LYR_HOSPITALS } from './constants.ts';
import {
  HEALTH_HOVER_LAYERS, HEALTH_OFF_SEASON_HEX, HOSPITAL_CATEGORY_HEX, HOSPITAL_COLOR, aplProp, aplTooltipHtml, colorFromProp,
  departmentHealthFeatures, hantavirusFeatures, hantavirusTooltipHtml, healthTooltipHtml, hospitalAuthorizations, hospitalFeatures,
  hospitalPopupHtml, hospitalTooltipHtml, regionAlert, regionAlertFeatures, regionAlertTooltipHtml, urgencesLate, urgencesLegend, urgencesProp,
  urgencesTooltipHtml,
  type HealthMapData,
} from './health-map.ts';

const geo = (codes: ReadonlyArray<readonly [string, string]>): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: codes.map(([code, nom]): GeoJSON.Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [2, 46] }, properties: { code, nom } })),
});
const line = (phase: EpidemicPhase, start: string, pathology: 'grippe' | 'bronchiolite' = 'grippe'): RegionalAlertLevel =>
  ({ region: '11', regionName: 'Île-de-France', pathology, phase, week: '2026-S39', start });
const EM_DASH = /\u2014|&mdash;/;

describe('régions : alertes épidémiques en saison (spec § 3.1)', () => {
  it('03/10 : Mayotte jaune (grippe en pré-épidémie S39) ; Martinique et Hexagone hors saison en gris clair ; région sans ligne sans couleur', () => {
    const fc = regionAlertFeatures(geo([['06', 'Mayotte'], ['02', 'Martinique'], ['11', 'Île-de-France'], ['05', 'Inconnue']]), alertLevelsFixture().levels, HEALTH_NOW);
    expect(fc.features.map((f) => f.properties?.['hmColor'])).toEqual([levelHex('jaune'), HEALTH_OFF_SEASON_HEX, HEALTH_OFF_SEASON_HEX, null]);
    expect(fc.features[0].properties?.['nom']).toBe('Mayotte');
  });
  it('en saison : épidémie orange, post-épidémie jaune, pas d’alerte vert ; le plus haut des deux pathologies', () => {
    expect(regionAlert('11', [line(3, '2026-09-21')], HEALTH_NOW).level).toBe('orange');
    expect(regionAlert('11', [line(4, '2026-09-21')], HEALTH_NOW).level).toBe('jaune');
    expect(regionAlert('11', [line(1, '2026-09-21')], HEALTH_NOW).level).toBe('vert');
    expect(regionAlert('11', [line(1, '2026-09-21'), line(3, '2026-09-21', 'bronchiolite')], HEALTH_NOW).level).toBe('orange');
    expect(regionAlert('11', [line(3, '2026-04-13')], HEALTH_NOW).level).toBe('hors');
  });
  it('infobulle : région, niveau par pathologie avec la semaine, hors saison daté ; texte hostile échappé ; aucun tiret cadratin', () => {
    const h = regionAlertTooltipHtml('Mayotte', '06', alertLevelsFixture().levels, HEALTH_NOW);
    expect(h).toContain('<b>Mayotte</b>');
    expect(h).toContain('Alertes épidémiques · Jaune');
    expect(h).toContain('<span>Grippe</span><span><i class="hm-dot" style="background:var(--sev-yellow)"></i>pré-épidémie · S39</span>');
    expect(h).toContain('<span>Bronchiolite</span><span>hors saison (dernière publication le 13/04 : post-épidémie)</span>');
    expect(regionAlertTooltipHtml('Île-de-France', '11', alertLevelsFixture().levels, HEALTH_NOW)).toContain('Alertes épidémiques · hors saison');
    expect(regionAlertTooltipHtml('<img src=x>', '99', [], HEALTH_NOW)).toContain('&lt;img src=x&gt;');
    expect(h).not.toMatch(EM_DASH);
  });
});

describe('départements : urgences (spec § 3.2) et APL (§ 3.3)', () => {
  const fc = departmentHealthFeatures(
    geo([['13', 'Bouches-du-Rhône'], ['75', 'Paris'], ['95', 'Val-d’Oise'], ['48', 'Lozère'], ['2A', 'Corse-du-Sud']]), syndromicFixture(), aplFixture(), HEALTH_NOW);
  const p = (i: number): Record<string, unknown> => fc.features[i].properties ?? {};
  it('niveau saisonnier par syndrome ; sans valeur : propriété absente (transparent), jamais une couleur de niveau', () => {
    expect(p(0)[urgencesProp('ira')]).toBe(levelHex('jaune'));      // 2,415 contre un maximum de 2,3
    expect(p(0)[urgencesProp('bronchio')]).toBe(levelHex('vert'));  // 6,604 contre 8
    expect(p(1)[urgencesProp('ira')]).toBe(levelHex('vert'));       // 1,757 contre 2,9
    expect(p(3)[urgencesProp('ira')]).toBe(levelHex('jaune'));      // 3,711 contre 3,5
    expect(p(3)[urgencesProp('bronchio')]).toBeUndefined();
    expect(p(4)[urgencesProp('ira')]).toBeUndefined();
    expect(p(0)['nom']).toBe('Bouches-du-Rhône');
  });
  it('APL : généralistes par seuils (rouge sous 2,5, jaune de 3,5 à 4, vert au-delà) ; autres professions par rapport à la moyenne', () => {
    expect(p(2)[aplProp('mg')]).toBe(levelHex('rouge'));    // 2,37
    expect(p(1)[aplProp('mg')]).toBe(levelHex('vert'));     // 5,5
    expect(p(4)[aplProp('mg')]).toBe(levelHex('jaune'));    // 3,95
    expect(p(2)[aplProp('kine')]).toBe(levelHex('jaune'));  // 95,2 / 123,2 = 0,77
    expect(p(0)[urgencesProp('gastro')]).toBe(levelHex('vert'));
  });
  it('la peinture lit la propriété du syndrome ou de la profession choisie ; sans valeur : transparent', () => {
    expect(colorFromProp(urgencesProp('gastro'))).toEqual(['coalesce', ['get', 'urg_gastro'], 'rgba(0, 0, 0, 0)']);
    expect(colorFromProp(aplProp('sf'))).toEqual(['coalesce', ['get', 'apl_sf'], 'rgba(0, 0, 0, 0)']);
  });
  it('infobulle urgences : département, part aux urgences, part SOS Médecins, niveau, semaine, maximum de référence', () => {
    const h = urgencesTooltipHtml('Bouches-du-Rhône', '13', syndromicFixture(), 'ira', HEALTH_NOW);
    expect(h).toContain('<b>Bouches-du-Rhône (13)</b>');
    expect(h).toContain('IRA · S39');
    expect(h).toContain(`<span>Urgences</span><span>2,4${NBSP}% des passages</span>`);
    expect(h).toContain(`<span>SOS Médecins</span><span>17,8${NBSP}% des actes</span>`);
    expect(h).toContain('<span>Niveau</span><span><i class="hm-dot" style="background:var(--sev-yellow)"></i>Jaune</span>');
    expect(h).toContain(`<span>Maximum des 3 saisons précédentes</span><span>2,3${NBSP}%</span>`);
    expect(h).toContain(`Au-dessus de ce maximum, de moins de 15${NBSP}%.`);
    expect(urgencesTooltipHtml('Lozère', '48', syndromicFixture(), 'ira', HEALTH_NOW)).toContain('<span>SOS Médecins</span><span>n.d.</span>');
    const nd = urgencesTooltipHtml('Lozère', '48', syndromicFixture(), 'bronchio', HEALTH_NOW);
    expect(nd).toContain('<span>Urgences</span><span>n.d.</span>');
    expect(nd).toContain('<span>Niveau</span><span>n.d.</span>');
    expect(nd).toContain('Moins de deux saisons de référence.');
    expect(urgencesTooltipHtml('<b>x</b>', '13', null, 'ira', HEALTH_NOW)).toContain('&lt;b&gt;x&lt;/b&gt;');
  });
  it('infobulle APL : valeur du département et de la France, rapport à la moyenne, niveau, millésime', () => {
    const mg = aplTooltipHtml('Val-d’Oise', '95', aplFixture(), 'mg');
    expect(mg).toContain('Médecins généralistes · APL 2024');
    expect(mg).toContain(`<span>Département</span><span>2,37${NBSP}consultations par an et par habitant</span>`);
    expect(mg).toContain(`<span>France</span><span>3,72${NBSP}consultations par an et par habitant</span>`);
    expect(mg).not.toContain('Rapport à la moyenne');
    expect(mg).toContain('<i class="hm-dot" style="background:var(--sev-red)"></i>Rouge');
    const kine = aplTooltipHtml('Val-d’Oise', '95', aplFixture(), 'kine');
    expect(kine).toContain('<span>Rapport à la moyenne nationale</span><span>0,77</span>');
    expect(aplTooltipHtml('Mayotte', '976', aplFixture(), 'mg')).toContain('<span>Département</span><span>n.d.</span>');
  });
});

describe('S2 : données en retard, couleurs retirées', () => {
  // S39 se termine le dimanche 27/09 : en retard après le 14/10 (fin de semaine + 17 jours).
  const LATE_NOW = Date.parse('2026-10-15T06:00:00Z');
  const depts = geo([['13', 'Bouches-du-Rhône'], ['75', 'Paris'], ['95', 'Val-d’Oise']]);
  it('urgences en retard : aucune couleur de niveau sur la carte ; l’APL annuelle garde les siennes', () => {
    expect(urgencesLate(syndromicFixture(), HEALTH_NOW)).toBe(false);
    expect(urgencesLate(syndromicFixture(), LATE_NOW)).toBe(true);
    expect(urgencesLate(null, LATE_NOW)).toBe(false);
    const fc = departmentHealthFeatures(depts, syndromicFixture(), aplFixture(), LATE_NOW);
    for (const f of fc.features) expect(Object.keys(f.properties ?? {}).filter((k) => k.startsWith('urg_'))).toEqual([]);
    expect(fc.features[2].properties?.[aplProp('mg')]).toBe(levelHex('rouge'));
  });
  it('infobulle en retard : valeurs et semaine gardées, « (en retard) », niveau suspendu, aucune puce de couleur', () => {
    const h = urgencesTooltipHtml('Bouches-du-Rhône', '13', syndromicFixture(), 'ira', LATE_NOW);
    expect(h).toContain('IRA · S39 (en retard)');
    expect(h).toContain(`<span>Urgences</span><span>2,4${NBSP}% des passages</span>`);
    expect(h).toContain('<span>Niveau</span><span>n.d.</span>');
    expect(h).toContain('Niveau saisonnier suspendu : données en retard.');
    expect(h).not.toContain('hm-dot');
    const data: HealthMapData = {
      alerts: [], now: LATE_NOW, syndromic: syndromicFixture(), apl: null, hospitals: new Map(), hospitalsVintage: null, syndrome: 'ira', profession: 'mg',
    };
    expect(healthTooltipHtml(LYR_HEALTH_URG_FILL, { code: '13', nom: 'Bouches-du-Rhône' }, data)).toContain('(en retard)');
    expect(h).not.toMatch(EM_DASH);
  });
  it('légende datée (S1) ; en retard : « (en retard) » et couleurs retirées ; sans semaine : légende de base', () => {
    const base: LegendCategory = { id: 'healthOscour', title: 'Urgences', items: [], notes: ['Département sans couleur : moins de deux saisons de référence.'] };
    expect(urgencesLegend(base, syndromicFixture(), HEALTH_NOW).notes)
      .toEqual(['Données : S39 (21-27 sept.), publiées le 30/09.', 'Département sans couleur : moins de deux saisons de référence.']);
    expect(urgencesLegend(base, syndromicFixture(), LATE_NOW).notes?.[0])
      .toBe('Données : S39 (21-27 sept.), publiées le 30/09 (en retard) : couleurs de niveau retirées.');
    expect(urgencesLegend(base, null, LATE_NOW)).toBe(base);
  });
  it('alertes : une ligne trop ancienne n’est jamais colorée par son niveau, elle passe hors saison en gris clair (pas de retard, S4)', () => {
    // Épidémie publiée pour la semaine du 31/08 : début + 28 jours = 28/09, avant le 03/10.
    const fc = regionAlertFeatures(geo([['11', 'Île-de-France']]), [line(3, '2026-08-31')], HEALTH_NOW);
    expect(fc.features[0].properties?.['hmColor']).toBe(HEALTH_OFF_SEASON_HEX);
    expect(regionAlertTooltipHtml('Île-de-France', '11', [line(3, '2026-08-31')], HEALTH_NOW)).not.toContain('hm-dot');
  });
});

describe('zones d’endémie historiques du hantavirus (spec § 2.9)', () => {
  it('seize départements en marqueurs [lng, lat], noms accentués, infobulle datée', () => {
    const fc = hantavirusFeatures();
    expect(fc.features).toHaveLength(16);
    const doubs = fc.features.find((f) => f.properties?.['code'] === 'DEP-25');
    expect(doubs?.geometry.coordinates).toEqual([6.02, 47.24]);
    expect(fc.features.map((f) => f.properties?.['name'])).toEqual(expect.arrayContaining(['Côte-d’Or', 'Rhône', 'Haute-Saône']));
    const h = hantavirusTooltipHtml({ name: 'Ardennes', risk: 'historic' });
    expect(h).toContain('<b>Ardennes</b>');
    expect(h).toContain('Zone d’endémie historique du hantavirus');
    expect(h).toContain('Cas recensés de 2005 à 2024 (Santé publique France)');
    expect(hantavirusTooltipHtml({ name: 'Aube', risk: 'extended' })).toContain('(extension)');
  });
});

describe('sites d’urgences (spec § 3.4)', () => {
  it('616 sites placés, [lng, lat], les plus fréquentés dessinés d’abord (les petits restent visibles)', () => {
    const fc = hospitalFeatures(hospitalsFixture());
    expect(fc.features).toHaveLength(616);
    expect(fc.features[0].properties).toEqual({ finess: '750100125', category: 'chu', passages: 132_774 });
    expect(fc.features[0].geometry.coordinates).toEqual([2.365, 48.838]);
    expect(hospitalFeatures(null).features).toEqual([]);
  });
  it('couleurs de catégorie = jetons --cat-hosp-* de main.css ; « autres » = --mix-other ; libellés de la vue', () => {
    const css = readFileSync(new URL('../../styles/main.css', import.meta.url), 'utf8');
    for (const c of ['chu', 'ch', 'private', 'gcs', 'army'] as const) expect(css).toContain(`--cat-hosp-${c}: ${HOSPITAL_CATEGORY_HEX[c]};`);
    expect(css).toContain(`--mix-other: ${HOSPITAL_CATEGORY_HEX.other};`);
    const cats = Object.keys(HOSPITAL_CATEGORY_LABEL) as HospitalCategory[];
    for (const c of cats) expect(HOSPITAL_COLOR).toContain(HOSPITAL_CATEGORY_HEX[c]);
  });
  it('autorisations en mots ; infobulle courte ; fiche : catégorie, autorisations, passages, lits, réanimation, n° FINESS', () => {
    const data = hospitalsFixture();
    const pitie = data.sites[0];
    expect(hospitalAuthorizations(pitie)).toBe('urgences générales');
    expect(hospitalAuthorizations({ ...pitie, pediatric: true, seasonal: true })).toBe('urgences générales et pédiatriques, ouverture saisonnière');
    expect(hospitalAuthorizations({ ...pitie, general: false, antenna: true })).toBe('antenne d’urgences');
    const tip = hospitalTooltipHtml(pitie, 2025);
    expect(tip).toContain('<b>Pitié-Salpêtrière</b>');
    expect(tip).toContain('Paris (75) · CHU et CHR');
    expect(tip).toContain('<span>Passages aux urgences en 2025</span><span>132 774</span>');
    const fiche = hospitalPopupHtml(pitie, 2025);
    expect(fiche).toContain('<span>Autorisations</span><span>urgences générales</span>');
    expect(fiche).toContain('<span>Lits de médecine, chirurgie, obstétrique</span><span>1 600</span>');
    expect(fiche).toContain(`<span>Réanimation</span><span>110${NBSP}lits</span>`);
    expect(fiche).toContain('<span>N° FINESS</span><span>750100125</span>');
    // Lit null = aucune ligne déclarée dans le bordereau SAE : « aucun lit déclaré », jamais 0 ni n.d. ; un vrai 0 reste 0.
    expect(hospitalPopupHtml(data.sites[1], 2025)).toContain('<span>Soins intensifs</span><span>aucun lit déclaré</span>');
    const empty = hospitalPopupHtml({ ...pitie, bedsMco: null, bedsIcu: null, bedsUhcd: 0 }, 2025);
    expect(empty).toContain('<span>Lits de médecine, chirurgie, obstétrique</span><span>aucun lit déclaré</span>');
    expect(empty).toContain('<span>Réanimation</span><span>aucun lit déclaré</span>');
    expect(empty).toContain(`<span>Unité d’hospitalisation de courte durée</span><span>0${NBSP}lit</span>`);
    expect(hospitalPopupHtml({ ...pitie, passages: null }, 2025)).toContain('<span>Passages aux urgences en 2025</span><span>n.d.</span>');
    expect(hospitalPopupHtml({ ...pitie, name: '<script>' }, 2025)).toContain('&lt;script&gt;');
    expect(fiche).not.toMatch(EM_DASH);
  });
});

describe('infobulle au survol : la couche la plus précise d’abord', () => {
  const data = (): HealthMapData => ({
    alerts: alertLevelsFixture().levels, now: HEALTH_NOW, syndromic: syndromicFixture(), apl: aplFixture(),
    hospitals: new Map(hospitalsFixture().sites.map((s) => [s.finess, s] as const)), hospitalsVintage: 2025, syndrome: 'gastro', profession: 'kine',
  });
  it('ordre : site, marqueur hantavirus, urgences, APL, région', () => {
    expect(HEALTH_HOVER_LAYERS).toEqual([LYR_HOSPITALS, LYR_HEALTH_HANTAVIRUS, LYR_HEALTH_URG_FILL, LYR_HEALTH_APL_FILL, LYR_HEALTH_ALERT_FILL]);
  });
  it('aiguillage par couche, syndrome et profession choisis ; nom du département repris de la géométrie ou de la table INSEE', () => {
    expect(healthTooltipHtml(LYR_HOSPITALS, { finess: '840000046' }, data())).toContain('CH d’Avignon');
    expect(healthTooltipHtml(LYR_HOSPITALS, { finess: 'inconnu' }, data())).toBeNull();
    expect(healthTooltipHtml(LYR_HEALTH_URG_FILL, { code: '13', nom: 'Bouches-du-Rhône' }, data())).toContain('Gastro-entérite · S39');
    expect(healthTooltipHtml(LYR_HEALTH_APL_FILL, { code: '95' }, data())).toContain('<b>Val-d’Oise (95)</b>');
    expect(healthTooltipHtml(LYR_HEALTH_APL_FILL, { code: '95' }, data())).toContain('Kinésithérapeutes · APL 2024');
    expect(healthTooltipHtml(LYR_HEALTH_ALERT_FILL, { code: '06', nom: 'Mayotte' }, data())).toContain('pré-épidémie · S39');
    expect(healthTooltipHtml(LYR_HEALTH_HANTAVIRUS, { name: 'Jura', risk: 'historic' }, data())).toContain('<b>Jura</b>');
    expect(healthTooltipHtml('autre-couche', {}, data())).toBeNull();
  });
});
