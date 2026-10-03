// tests/health-map-wiring.test.ts
// Carte santé (spec 2026-10-03 § 3) : DeckGLMap.ts, MapContainer.ts et App.ts ne s'instancient pas sous vitest ;
// ces tests lisent leur source, comme tests/app-layer-panels-lot2-wiring.test.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { HANTAVIRUS_RING_HEX, HEALTH_OFF_SEASON_HEX, HOSPITAL_CATEGORY_HEX } from '../src/components/deckgl/health-map.ts';
import { HOSPITAL_CATEGORY_LABEL } from '../src/components/layer-panel/health-format.ts';
import type { HospitalCategory } from '../src/types/index.ts';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const deck = read('src/components/DeckGLMap.ts');
const container = read('src/components/MapContainer.ts');
const app = read('src/App.ts');
const constants = read('src/components/deckgl/constants.ts');
const formatUtils = read('src/components/deckgl/format-utils.ts');
const css = read('src/styles/main.css');

describe('DeckGLMap : couches santé réécrites', () => {
  it('anciennes couches (ISS, cercles OSCOUR, CHU/CH, APL par catégorie) et ancien câblage retirés', () => {
    for (const gone of [/\bSRC_HEALTH\b/, /\bSRC_HEALTH_MARKERS\b/, /\bLYR_HEALTH_FILL\b/, /\bLYR_HEALTH_LINE\b/, /\bLYR_HEALTH_MARKERS\b/,
      /\bLYR_HEALTH_OSCOUR_CIRCLES\b/, /\bLYR_HOSPITALS_CHU\b/, /\bLYR_HOSPITALS_CH\b/, /\bLYR_HOSPITALS_LABEL\b/, /updateHealth\(/,
      /getHealthFeatures/, /aplByDept/, /_pendingHealthArgs/, /issToFillColor/, /getISSSemio/, /getHealthSourceLabel/, /open-national-health/,
      /\bAPL_LEVELS\b/, /\bOSCOUR_LEVELS\b/, /health-hospital-popup/, /\bHealthFeatures\b/, /HealthDepartmentMetric/, /HealthRegionMetric/]) {
      expect(deck).not.toMatch(gone);
      expect(container).not.toMatch(gone);
    }
    expect(constants).not.toMatch(/LYR_HEALTH_FILL|LYR_HEALTH_OSCOUR_CIRCLES|LYR_HOSPITALS_CHU|SRC_HEALTH_MARKERS/);
    expect(formatUtils).not.toMatch(/ISS_LEVELS|issTo|getISSSemio|getHealthSourceLabel/);
  });
  it('sources et couches ajoutées ; peinture par la propriété du syndrome et de la profession choisis', () => {
    for (const src of ['SRC_HEALTH_REGIONS', 'SRC_HEALTH_DEPTS', 'SRC_HEALTH_HANTAVIRUS']) expect(deck).toContain(`this.map.addSource(${src},`);
    for (const lyr of ['LYR_HEALTH_ALERT_FILL', 'LYR_HEALTH_ALERT_LINE', 'LYR_HEALTH_URG_FILL', 'LYR_HEALTH_URG_LINE', 'LYR_HEALTH_APL_FILL',
      'LYR_HEALTH_APL_LINE', 'LYR_HEALTH_HANTAVIRUS', 'LYR_HOSPITALS']) expect(deck).toContain(`id: ${lyr},`);
    expect(deck).toContain("'fill-color': colorFromProp(urgencesProp(this.healthUrgencesSyndrome))");
    expect(deck).toContain("'fill-color': colorFromProp(aplProp(this.healthAplProfession))");
    expect(deck).toContain("this.map.setPaintProperty(LYR_HEALTH_URG_FILL, 'fill-color', colorFromProp(urgencesProp(syndrome)))");
    expect(deck).toContain("this.map.setPaintProperty(LYR_HEALTH_APL_FILL, 'fill-color', colorFromProp(aplProp(profession)))");
    expect(deck).toContain("'circle-color': HOSPITAL_COLOR,");
    expect(deck).toContain("'circle-radius': HOSPITAL_RADIUS,");
  });
  it('visibilité par couche, relecture différée des géométries, survol et fiche de site', () => {
    for (const [lyr, key] of [['LYR_HEALTH_ALERT_FILL', 'health'], ['LYR_HEALTH_ALERT_LINE', 'health'], ['LYR_HEALTH_HANTAVIRUS', 'health'],
      ['LYR_HEALTH_URG_FILL', 'healthOscour'], ['LYR_HEALTH_URG_LINE', 'healthOscour'], ['LYR_HEALTH_APL_FILL', 'healthApl'],
      ['LYR_HEALTH_APL_LINE', 'healthApl'], ['LYR_HOSPITALS', 'hospitals']] as const) {
      expect(deck).toContain(`this.setVis(${lyr}, vis(layers.${key} ?? false));`);
    }
    expect(deck).toContain('if (layers.health && this.healthRegionsDirty) void this.renderHealthRegions();');
    expect(deck).toContain('if ((layers.healthOscour || layers.healthApl) && this.healthDeptsDirty) void this.renderHealthDepartments();');
    expect(deck).toContain('this.initHealthInteractions();');
    expect(deck).toContain("map.on('click', LYR_HOSPITALS,");
    expect(deck).toContain('healthTooltipHtml(hit.layer.id, hit.properties ?? {}, this.healthMapData())');
    expect(deck).toContain('.setHTML(hospitalPopupHtml(site, this.hospitalsVintage))');
  });
  it('survol de légende : une catégorie par couche santé', () => {
    expect(deck).toContain('activeLayers = [LYR_HEALTH_ALERT_FILL, LYR_HEALTH_ALERT_LINE, LYR_HEALTH_HANTAVIRUS];');
    expect(deck).toContain('activeLayers = [LYR_HEALTH_URG_FILL, LYR_HEALTH_URG_LINE];');
    expect(deck).toContain('activeLayers = [LYR_HEALTH_APL_FILL, LYR_HEALTH_APL_LINE];');
    expect(deck).toContain('activeLayers = [LYR_HOSPITALS];');
  });
  it('MapContainer relaie les six méthodes', () => {
    for (const call of ['this.deckMap?.updateHealthAlerts(alerts, now);', 'this.deckMap?.updateHealthDepartments(syndromic, apl);',
      'this.deckMap?.setHealthUrgencesSyndrome(syndrome);', 'this.deckMap?.setHealthAplProfession(profession);',
      'this.deckMap?.updateHospitals(data);', 'this.deckMap?.focusHospital(site);']) expect(container).toContain(call);
  });
});

describe('App : légendes réécrites et données transmises à la carte', () => {
  it('légendes : niveaux L1, hors saison en gris clair, anneau hantavirus, catégories d’hôpitaux aux couleurs de la carte', () => {
    for (const gone of ['HEALTH_ISS_LEGEND', 'HEALTH_OSCOUR_LEGEND', 'Stress Sanitaire', 'APL_LEVELS', 'OSCOUR_LEVELS', 'Données quotidiennes (J-1)']) expect(app).not.toContain(gone);
    expect(app).toContain('legend: HEALTH_ALERTS_LEGEND,');
    expect(app).toContain('legend: HEALTH_URGENCES_LEGEND,');
    expect(app).toContain(`color: '${HEALTH_OFF_SEASON_HEX}'`);
    expect(app).toContain(`color: '${HANTAVIRUS_RING_HEX}', shape: 'ring'`);
    for (const c of Object.keys(HOSPITAL_CATEGORY_LABEL) as HospitalCategory[]) {
      expect(app).toContain(`label: '${HOSPITAL_CATEGORY_LABEL[c]}', color: '${HOSPITAL_CATEGORY_HEX[c]}', shape: 'circle'`);
    }
    expect(app).toContain("url: 'https://data.drees.solidarites-sante.gouv.fr/explore/dataset/530_l-accessibilite-potentielle-localisee-apl/'");
  });
  it('relève : alertes, urgences et APL, sites ; sélecteurs des panneaux ; site choisi dans le panneau', () => {
    expect(app).toContain('this.mapContainer?.updateHealthAlerts(state.alerts.data, now);');
    expect(app).toContain('this.mapContainer?.updateHealthDepartments(state.syndromic.data, this.currentHealthOffer?.apl.data ?? null);');
    expect(app).toContain('this.mapContainer?.updateHealthDepartments(this.currentHealth?.syndromic.data ?? null, offer.apl.data);');
    expect(app).toContain('this.mapContainer?.updateHospitals(offer.hospitals.data);');
    expect(app).toContain('panel.setOnSyndrome((syndrome) => this.mapContainer?.setHealthUrgencesSyndrome(syndrome));');
    expect(app).toContain('this.mapContainer?.setHealthUrgencesSyndrome(panel.getSyndrome());');
    expect(app).toContain('panel.setOnProfession((profession) => this.mapContainer?.setHealthAplProfession(profession));');
    expect(app).toContain('this.mapContainer?.setHealthAplProfession(panel.getProfession());');
    expect(app).toContain('panel.setOnSelectSite((site) => this.mapContainer?.focusHospital(site));');
  });
});

describe('styles des infobulles santé', () => {
  it('classe hm-tip, aucune police à chasse fixe, anciennes fenêtres d’hôpitaux retirées', () => {
    const block = /\/\* Carte santé[^]*?\.hm-tip \.hm-dot[^}]*\}/.exec(css)?.[0] ?? '';
    expect(block).toContain('.hm-tip');
    expect(block).not.toMatch(/monospace|ui-monospace|Menlo|Consolas/);
    expect(css).not.toContain('health-hospital-popup');
    expect(css).not.toContain('health-hospital-detail-popup');
  });
});
