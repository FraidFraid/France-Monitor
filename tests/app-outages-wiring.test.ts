// tests/app-outages-wiring.test.ts
// Câblage App.ts des Pannes réseau, phase A (spec 2026-10-08 panneaux pannes § 4 ; décisions R2, R3, R9, R11, R16, R24, R35).
// App.ts ne s'instancie pas sous vitest : ces tests lisent sa source, comme tests/app-sovereignty-panels-wiring.test.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { OUTAGES_ALWAYS_POLLED, OUTAGES_POLL_MS } from '../src/config/outages-sources.ts';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const app = read('src/App.ts');
const css = read('src/styles/main.css');
const layerPanel = read('src/components/LayerPanel.ts');
const oldPanel = read('src/components/OutagesPanel.ts');

function methodBody(name: string): string {
  const signature = new RegExp(`\\n  (?:private |public )?(?:async )?${name}\\([^]*?\\{[ \\t]*\\n`);
  const match = signature.exec(app);
  if (!match) throw new Error(`méthode ${name} introuvable dans App.ts`);
  const start = match.index + match[0].length - 2;
  let depth = 0;
  for (let i = start; i < app.length; i += 1) {
    if (app[i] === '{') depth += 1;
    else if (app[i] === '}') {
      depth -= 1;
      if (depth === 0) return app.slice(start, i + 1);
    }
  }
  throw new Error(`corps de ${name} non refermé`);
}

describe('câblage App.ts des Pannes réseau (phase A)', () => {
  it('un panneau par couche Électricité et Télécoms, importés à la demande', () => {
    expect(app).toContain("import('./components/OutagesTelecomPanel.ts')");
    expect(app).toContain("import('./components/OutagesPowerPanel.ts')");
    expect(app).toMatch(/id: 'outagesElec',\s*label: 'Électricité',/);
    expect(app).toMatch(/id: 'outagesTelecom',\s*label: 'Télécoms mobiles',/);
    expect(app).toMatch(/id: 'outagesInternet',\s*label: 'Pannes Internet et cloud',[^}]*layerKeys: \['outagesInternet', 'outagesCloud'\]/);
    expect(app).not.toMatch(/layerKeys: \['outagesElec', 'outagesTelecom'/);
  });

  it('relève à la cadence de la source, seulement couche active ou panneau ouvert ; Télécoms sans arrêt (R16)', () => {
    expect(app).toContain('OUTAGES_POLL_MS[key]');
    expect(app).toContain('private syncOutagesPolling(key: OutagesLayerKey)');
    expect(app).toContain('private outagesPolls: Partial<Record<OutagesLayerKey, PausableTimer>> = {};');
    const wanted = methodBody('outagesPollWanted');
    expect(wanted).toContain('OUTAGES_ALWAYS_POLLED.has(key) || this.activeLayers[key]');
    expect(wanted).toContain('?.isVisible?.()');
    expect([...OUTAGES_ALWAYS_POLLED]).toEqual(['outagesTelecom']);
    expect(OUTAGES_POLL_MS.outagesTelecom).toBe(30 * 60_000);
    expect(app).toContain('for (const key of OUTAGES_LAYER_KEYS) this.syncOutagesPolling(key);');
    expect(methodBody('destroy')).toContain('this.outagesPolls = {};');
    // Lu une fois au démarrage pour le score, couche éteinte aussi ; l'Électricité seulement à l'activation.
    expect(app).toContain("name: 'outagesTelecom', task: this.loadOutagesSource('outagesTelecom')");
    expect(app).not.toContain("task: this.loadOutagesSource('outagesElec')");
  });

  it('lignes du panneau des sources datées par la donnée ; plus de « Télécoms » à l’heure du navigateur', () => {
    expect(app).toContain('arcepStatus(');
    expect(app).toContain('edfStatus(');
    expect(app).toContain('iipStatus(');
    expect(app).toContain('seiStatus(');
    expect(app).not.toContain("updateSource('Télécoms'");
    expect(app).not.toMatch(/'ARCEP Réseau Mobile'|'Enedis \/ Pannes Électricité'/);
    const load = methodBody('loadOutagesSource');
    expect(load).toContain("this.statusPanel?.updateSource('ARCEP sites mobiles', arcepStatus(");
    expect(load).toContain("this.statusPanel?.updateSource('EDF indisponibilités', edfStatus(");
    expect(load).toContain("this.statusPanel?.updateSource('RTE IIP', iipStatus(");
    expect(load).toContain("this.statusPanel?.updateSource('EDF SEI (îles)', seiStatus(");
    expect(load).toContain('dedupe(`outages:${key}`');
    expect(load).toContain('this.markOutagesSourcesFailed(key, err);');
    expect(methodBody('markOutagesSourcesFailed')).toContain('OUTAGES_LAYER_SOURCES[key]');
    const status = read('src/components/StatusPanel.ts');
    expect(status).toContain("{ name: 'ARCEP sites mobiles', lastUpdate: null, status: 'loading' }");
    expect(status).toContain('outagesSourceDetail(src.name)');
  });

  it('lignes du panneau des sources : ouvrent le panneau de leur couche, couche éteinte possible', () => {
    expect(app).toMatch(/'ARCEP sites mobiles': 'outagesTelecom'/);
    expect(app).toMatch(/'EDF indisponibilités': 'outagesElec'/);
    expect(app).toMatch(/'RTE IIP': 'outagesElec'/);
    expect(app).toMatch(/'EDF SEI \(îles\)': 'outagesElec'/);
    expect(app).toMatch(/'Infra Réseau DC \/ IXP': 'outagesInternet'/);
    expect(app).toMatch(/'IODA Internet': 'outagesInternet'/);
    const click = methodBody('handleSourcePanelClick');
    expect(click).toContain("name === 'ARCEP sites mobiles'");
    expect(click).toContain("this.ensureOutagesLayerPanel('outagesTelecom').then(() => this.openOutagesPanel('outagesTelecom'))");
    expect(click).toContain("name === 'EDF indisponibilités' || name === 'RTE IIP' || name === 'EDF SEI (îles)'");
    expect(click).toContain("this.ensureOutagesLayerPanel('outagesElec').then(() => this.openOutagesPanel('outagesElec'))");
  });

  it('carte : sites ARCEP et unités de production, repeints à l’activation et quand la carte est prête (R35) ; plus de couche des départements « PDL »', () => {
    expect(app).toContain('updateOutagesTelecom(');
    expect(app).toContain('updateOutagesPower(');
    expect(app).not.toContain('fetchPowerOutages(');
    expect(app).not.toContain('fetchTelecomOutages(');
    expect(app).not.toContain('fetchOutageZoneCollection(');
    expect(app).not.toMatch(/updateCitizenOutageZones\(|updateIIPIncidents\(|highlightPowerDept|highlightCitizenZone/);
    expect(methodBody('openOutagesPanel')).toContain('this.repaintOutagesMap(key);');
    const map = methodBody('initMap');
    expect(map).toMatch(/await this\.mapContainer\.init\(\);\s*\/\/[^\n]*\n\s*this\.repaintOutagesMap\('outagesTelecom'\);\s*this\.repaintOutagesMap\('outagesElec'\);/);
    expect(app).not.toContain('(0 PDL mesuré)');
    // L'ancienne relève de l'infra réseau ne tourne pas pour Électricité ou Télécoms seuls (maître `outages` dérivé).
    expect(methodBody('startInfraNetworkPolling')).toContain('!this.activeLayers.outagesInternet && !this.activeLayers.outagesCloud && this.outagesPanel?.isVisible() !== true');
    expect(methodBody('startInfraNetworkPolling')).not.toContain('activeLayers.outages &&');
  });

  it('panneau Électricité : Écowatt, Parc nucléaire, recentrage sur une unité par son emplacement connu ; App.ts n’importe pas la carte', () => {
    const ensure = methodBody('ensureOutagesLayerPanel');
    expect(ensure).toContain('panel.setOnOpenNuclear(');
    expect(ensure).toContain("this.onLayerToggle('nuclearFleet', true)");
    expect(ensure).toContain('panel.setOnFocusUnit((name) => this.mapContainer?.flyToAsset(name))');
    expect(ensure).toContain('this.currentEcowattResponse?.official ?? null');
    expect(methodBody('loadEcowatt')).toContain('this.outagesPowerPanel?.update(this.currentOutPower,');
    expect(app).not.toContain('setEcowattNational(');
    expect(app).not.toMatch(/import\('\.\/components\/deckgl\//);
    expect(read('src/components/DeckGLMap.ts')).toMatch(/flyToAsset\(label: string\): void \{\s*const coords = resolveAssetCoords\(label\);\s*if \(coords\) this\.flyTo\(coords\[0\], coords\[1\], 9\);/);
  });

  it('panneau Télécoms : recentrage d’un site et d’un département, option des maintenances', () => {
    const ensure = methodBody('ensureOutagesLayerPanel');
    expect(ensure).toContain('panel.setOnFocusSite((lat, lon) => this.mapContainer?.flyTo(lon, lat, 11))');
    expect(ensure).toContain('panel.setOnFocusDept((dept) => this.focusDepartment(dept))');
    expect(ensure).toContain('panel.setOnToggleMaintenance((on) => this.mapContainer?.setTelecomMaintenanceVisible(on))');
    expect(ensure).toContain("panel.setOnClose(() => this.closeOutagesLayer('outagesTelecom'))");
    expect(ensure).toContain("panel.setOnClose(() => this.closeOutagesLayer('outagesElec'))");
  });

  it('couches : maître dérivé, panneaux du sélecteur, ouverture et extinction silencieuse', () => {
    expect(methodBody('getEffectiveLayers')).toContain('effective.outages = hasActiveOutages(effective);');
    expect(methodBody('_syncGroupFlags')).toContain('if (isOutagesLayerKey(key)) this.activeLayers.outages = hasActiveOutages(this.activeLayers);');
    const visibility = methodBody('_handlePanelVisibility');
    expect(visibility).toContain("if (key === 'outagesElec' || key === 'outagesTelecom') {");
    expect(visibility).toContain('this.openOutagesPanel(key);');
    expect(visibility).toContain("} else if (key === 'outagesInternet' || key === 'outagesCloud') {");
    const instance = methodBody('getFloatingPanelInstance');
    expect(instance).toContain("case 'outagesElec': return this.outagesPowerPanel;");
    expect(instance).toContain("case 'outagesTelecom': return this.outagesTelecomPanel;");
    expect(instance).toContain("case 'outagesInternet': return this.outagesPanel;");
    const lazy = methodBody('ensureLazyPanelForLayer');
    expect(lazy).toMatch(/case 'outagesElec':\s*case 'outagesTelecom':\s*return \[this\.ensureOutagesLayerPanel\(key\)\];/);
    expect(lazy).toMatch(/case 'outagesInternet':\s*case 'outagesCloud':\s*return \[this\.ensureOutagesPanel\(\)\];/);
  });

  it('ancien panneau : plus que Internet et Cloud ; aucun appel show() ne lui passe d’anciennes listes', () => {
    expect(app).not.toMatch(/outagesPanel(?:\?)?\.show\(\s*this\.currentPowerOutages/);
    expect(app).not.toContain('currentCitizenZones');
    expect(oldPanel).not.toMatch(/PowerOutage|TelecomOutage|OutageZone|RTEIIPState|OutagesMeta|EcowattSignal|setOnDeptHover|setOnZoneHover|setOutagesMeta|setRTEIIP|setEcowattNational|setArcepFetchedDate|tab-electric|tab-telecom/);
    expect(oldPanel).not.toContain("from '../services/outages.ts'");
    expect(oldPanel).toContain("type ActiveTab = 'internet' | 'cloud';");
  });

  it('feuilles de style : les deux panneaux dans les listes de panneaux (mobile, ::before, v2, kit)', () => {
    expect(css).toContain('  .defense-panel-modal,\n  .connectivity-panel-modal,\n  .outages-telecom-panel-modal,\n  .outages-power-panel-modal,');
    expect(css).toContain('  .outages-telecom-panel-modal::before,\n  .outages-power-panel-modal::before,');
    expect(css).toContain('  #app.ui-v2 .outages-telecom-panel-modal,\n  #app.ui-v2 .outages-power-panel-modal,');
    expect(css).toContain(':is(.defense-panel-modal, .connectivity-panel-modal, .cyber-panel-modal, .outages-telecom-panel-modal, .outages-power-panel-modal).lp .fmk-level .fmk-ctx { white-space: normal; }');
  });

  it('aide des couches : Électricité et Télécoms sans badge « live », libellé « Télécoms mobiles »', () => {
    const section = layerPanel.slice(layerPanel.indexOf("this.helpSection(fmIcon('satellite-dish'), 'Pannes réseau'"));
    const lines = section.split('\n').filter((line) => /helpItem\(fmIcon\('(zap|satellite-dish)'\), '(Électricité|Télécoms mobiles)'/.test(line));
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).not.toContain("'live'");
      expect(line).not.toMatch(/temps réel|LIVE|Enedis|zones citoyennes|DataFair/i);
    }
    expect(layerPanel).toContain("label: 'TÉLÉCOMS MOBILES'");
    expect(layerPanel).not.toContain('TÉLÉCOM 4G·5G');
  });
});
