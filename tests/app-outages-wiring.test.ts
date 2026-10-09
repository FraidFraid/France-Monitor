// tests/app-outages-wiring.test.ts
// Câblage App.ts des Pannes réseau, phases A et B (spec 2026-10-08 panneaux pannes § 4 ; décisions R2, R3, R9, R11, R16, R24, R35, R41, R42 ;
// preflight-B P34, P35).
// App.ts ne s'instancie pas sous vitest : ces tests lisent sa source, comme tests/app-sovereignty-panels-wiring.test.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { OUTAGES_ALWAYS_POLLED, OUTAGES_POLL_MS } from '../src/config/outages-sources.ts';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const app = read('src/App.ts');
const css = read('src/styles/main.css');
const layerPanel = read('src/components/LayerPanel.ts');

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

describe('câblage App.ts des Pannes réseau (phases A et B)', () => {
  it('un panneau par couche (Électricité, Télécoms, Internet, Cloud), importés à la demande', () => {
    expect(app).toContain("import('./components/OutagesTelecomPanel.ts')");
    expect(app).toContain("import('./components/OutagesPowerPanel.ts')");
    expect(app).toContain("import('./components/OutagesInternetPanel.ts')");
    expect(app).toContain("import('./components/OutagesCloudPanel.ts')");
    expect(app).toMatch(/id: 'outagesElec',\s*label: 'Électricité',/);
    expect(app).toMatch(/id: 'outagesTelecom',\s*label: 'Télécoms mobiles',/);
    expect(app).toContain("{ id: 'outagesInternet', label: 'Internet', icon: 'globe', layerKeys: ['outagesInternet'] },");
    expect(app).toContain("{ id: 'outagesCloud', label: 'Cloud et hébergement', icon: 'cloud', layerKeys: ['outagesCloud'] },");
    expect(app).not.toMatch(/layerKeys: \['outagesElec', 'outagesTelecom'/);
    expect(app).not.toMatch(/layerKeys: \['outagesInternet', 'outagesCloud'/);
  });

  it('relève à la cadence de la source, seulement couche active ou panneau ouvert ; Télécoms sans arrêt (R16)', () => {
    expect(app).toContain('OUTAGES_POLL_MS[key]');
    expect(app).toContain('private syncOutagesPolling(key: OutagesLayerKey)');
    expect(app).toContain('private outagesPolls: Partial<Record<OutagesLayerKey, PausableTimer>> = {};');
    const wanted = methodBody('outagesPollWanted');
    expect(wanted).toContain('OUTAGES_ALWAYS_POLLED.has(key) || this.activeLayers[key]');
    expect(wanted).toContain('?.isVisible?.()');
    // Internet et Cloud relevés comme Électricité (couche active ou panneau ouvert) : plus de retour anticipé pour deux couches.
    expect(wanted).not.toContain('return false');
    expect(wanted).not.toContain("key !== 'outagesTelecom'");
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
    expect(load).toContain("this.statusPanel?.updateSource('IODA', iodaStatus(");
    // radarStatus d'outages-internet.ts importé sous ce nom : App.ts importe déjà le radarStatus du radar Météo-France.
    expect(app).toContain('radarStatus as cloudflareRadarStatus');
    expect(load).toContain("this.statusPanel?.updateSource('Cloudflare Radar', cloudflareRadarStatus(");
    expect(load).toContain("this.statusPanel?.updateSource('Pages d’état cloud', cloudStatus(");
    expect(load).toContain('this.currentOutInternet = mergeInternet(this.currentOutInternet, await fetchInternet(this.currentOutInternet, now));');
    expect(load).toContain('this.currentOutCloud = mergeCloud(this.currentOutCloud, await fetchCloud(this.currentOutCloud, now));');
    expect(load).toContain('this.mapContainer?.updateOutagesInternet(this.currentOutInternet.internet.data, now);');
    expect(load).toContain('this.mapContainer?.updateOutagesCloud(this.currentOutCloud.cloud.data, now);');
    expect(load).not.toContain("key !== 'outagesTelecom'");
    expect(load).toContain('dedupe(`outages:${key}`');
    expect(load).toContain('this.markOutagesSourcesFailed(key, err);');
    expect(methodBody('markOutagesSourcesFailed')).toContain('OUTAGES_LAYER_SOURCES[key]');
    expect(app).not.toContain("'IODA Internet'");
    const status = read('src/components/StatusPanel.ts');
    expect(status).toContain("{ name: 'ARCEP sites mobiles', lastUpdate: null, status: 'loading' }");
    expect(status).toContain('outagesSourceDetail(src.name)');
  });

  it('lignes du panneau des sources : ouvrent le panneau de leur couche, couche éteinte possible', () => {
    expect(app).toMatch(/'ARCEP sites mobiles': 'outagesTelecom'/);
    expect(app).toMatch(/'EDF indisponibilités': 'outagesElec'/);
    expect(app).toMatch(/'RTE IIP': 'outagesElec'/);
    expect(app).toMatch(/'EDF SEI \(îles\)': 'outagesElec'/);
    expect(app).toMatch(/'IODA': 'outagesInternet'/);
    expect(app).toMatch(/'Cloudflare Radar': 'outagesInternet'/);
    expect(app).toMatch(/'Pages d’état cloud': 'outagesCloud'/);
    expect(app).not.toContain('Infra Réseau DC / IXP');
    const click = methodBody('handleSourcePanelClick');
    expect(click).toContain("name === 'ARCEP sites mobiles'");
    expect(click).toContain("this.ensureOutagesLayerPanel('outagesTelecom').then(() => this.openOutagesPanel('outagesTelecom'))");
    expect(click).toContain("name === 'EDF indisponibilités' || name === 'RTE IIP' || name === 'EDF SEI (îles)'");
    expect(click).toContain("this.ensureOutagesLayerPanel('outagesElec').then(() => this.openOutagesPanel('outagesElec'))");
    expect(click).toContain("name === 'IODA' || name === 'Cloudflare Radar'");
    expect(click).toContain("this.ensureOutagesLayerPanel('outagesInternet').then(() => this.openOutagesPanel('outagesInternet'))");
    expect(click).toContain("name === 'Pages d’état cloud'");
    expect(click).toContain("this.ensureOutagesLayerPanel('outagesCloud').then(() => this.openOutagesPanel('outagesCloud'))");
  });

  it('Cloudflare Radar sans jeton : ni échantillon de qualité (P34) ni erreur quand le service ne se charge pas', () => {
    expect(methodBody('loadOutagesSource')).toContain("s.name !== 'Cloudflare Radar' || !this.radarNotConfigured()");
    expect(methodBody('markOutagesSourcesFailed')).toContain("if (name === 'Cloudflare Radar' && this.radarNotConfigured()) continue;");
    expect(methodBody('radarNotConfigured')).toContain('this.currentOutInternet?.internet.data?.radar.configured === false');
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
    expect(map).toMatch(/await this\.mapContainer\.init\(\);\s*\/\/[^\n]*\n\s*for \(const key of OUTAGES_LAYER_KEYS\) this\.repaintOutagesMap\(key\);/);
    expect(app).not.toContain('(0 PDL mesuré)');
    const repaint = methodBody('repaintOutagesMap');
    expect(repaint).toContain('this.mapContainer?.updateOutagesInternet(this.currentOutInternet.internet.data, now)');
    expect(repaint).toContain('this.mapContainer?.updateOutagesCloud(this.currentOutCloud.cloud.data, now)');
  });

  it('légendes Internet et Cloud lues dans outages-legend.ts, plus de légende codée en dur (BGPView, « 5 min »)', () => {
    expect(app).toContain('const OUTAGES_INTERNET_LEGEND: LegendCategory = internetLegend();');
    expect(app).toContain('const OUTAGES_CLOUD_LEGEND: LegendCategory = cloudLegend();');
    expect(app).not.toContain('BGPView');
    expect(app).not.toMatch(/id: 'isp-outage'|id: 'dc-fast-track'|id: 'ixp-ok'/);
    expect(app).toMatch(/id: 'outagesInternet',\s*groupId: 'outages',\s*role: 'child',\s*dependsOnGroup: true,\s*label: 'Internet',/);
    expect(app).toMatch(/id: 'outagesCloud',\s*groupId: 'outages',\s*role: 'child',\s*dependsOnGroup: true,\s*label: 'Cloud et hébergement',/);
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

  it('panneau Internet : recentrage d’un département sur la carte WebGL seulement, lien Connectivité toujours (couche cochée, tiroir à jour)', () => {
    const ensure = methodBody('ensureOutagesLayerPanel');
    expect(ensure).toContain("panel.setOnClose(() => this.closeOutagesLayer('outagesInternet'))");
    expect(ensure).toMatch(/if \(this\.mapContainer\?\.canFocusMap\(\)\) panel\.setOnFocusDept\(\(dept\) => this\.focusDepartment\(dept\)\);\s*panel\.setOnOpenConnectivity\(\(\) => \{\s*this\.onLayerToggle\('subseaCables', true\);\s*this\.layerPanel\?\.updateLayers\(this\.activeLayers\);\s*\}\);/);
    expect(ensure).toContain('this.outagesInternetPanel = panel;');
    expect(ensure).toContain('if (this.activeLayers.outagesInternet) panel.show(this.outagesInternetState());');
  });

  it('panneau Cloud : recentrage d’une zone sur la carte WebGL', () => {
    const ensure = methodBody('ensureOutagesLayerPanel');
    expect(ensure).toContain("panel.setOnClose(() => this.closeOutagesLayer('outagesCloud'))");
    expect(ensure).toContain('if (this.mapContainer?.canFocusMap()) panel.setOnFocusZone((lat, lon) => this.mapContainer?.flyTo(lon, lat, 9));');
    expect(ensure).toContain('this.outagesCloudPanel = panel;');
    expect(ensure).toContain('if (this.activeLayers.outagesCloud) panel.show(this.outagesCloudState());');
    const open = methodBody('openOutagesPanel');
    expect(open).toContain('this.outagesInternetPanel?.show(this.outagesInternetState())');
    expect(open).toContain('this.outagesCloudPanel?.show(this.outagesCloudState())');
  });

  it('couches : maître dérivé, panneaux du sélecteur, ouverture et extinction silencieuse', () => {
    expect(methodBody('getEffectiveLayers')).toContain('effective.outages = hasActiveOutages(effective);');
    expect(methodBody('_syncGroupFlags')).toContain('if (isOutagesLayerKey(key)) this.activeLayers.outages = hasActiveOutages(this.activeLayers);');
    const visibility = methodBody('_handlePanelVisibility');
    expect(visibility).toContain('if (isOutagesLayerKey(key)) {');
    expect(visibility).toContain('this.openOutagesPanel(key);');
    expect(visibility).not.toContain("key === 'outagesInternet' || key === 'outagesCloud'");
    // Maître éteint : les quatre panneaux masqués en silence (les couches gardent leur état), relèves réglées.
    expect(visibility).toMatch(/for \(const outKey of OUTAGES_LAYER_KEYS\) \{\s*this\.getFloatingPanelInstance\(outKey\)\?\.hide\(\{ silent: true \}\);\s*this\.syncOutagesPolling\(outKey\);/);
    const instance = methodBody('getFloatingPanelInstance');
    expect(instance).toContain("case 'outagesElec': return this.outagesPowerPanel;");
    expect(instance).toContain("case 'outagesTelecom': return this.outagesTelecomPanel;");
    expect(instance).toContain("case 'outagesInternet': return this.outagesInternetPanel;");
    expect(instance).toContain("case 'outagesCloud': return this.outagesCloudPanel;");
    const lazy = methodBody('ensureLazyPanelForLayer');
    expect(lazy).toMatch(/case 'outagesElec':\s*case 'outagesTelecom':\s*case 'outagesInternet':\s*case 'outagesCloud':\s*return \[this\.ensureOutagesLayerPanel\(key\)\];/);
    expect(lazy).toContain("case 'outages': return OUTAGES_LAYER_KEYS.map((k) => this.ensureOutagesLayerPanel(k));");
  });

  it('ancien panneau débranché : ni import, ni lecture, ni relève, ni survol de l’ancien service', () => {
    expect(app).not.toMatch(/\bOutagesPanel\b/);
    expect([
      "components/OutagesPanel.ts'", 'ensureOutagesPanel', 'loadOutages(', 'fetchNetworkOutages(', 'fetchInfraNetwork(', 'currentNetworkState', 'currentInfraState',
      'startInfraNetworkPolling', 'refreshInfraNetworkLive', 'highlightIsp', 'highlightIoda', 'highlightDc', 'highlightIxp', 'POLL_INFRA_NETWORK_MS',
      '_intervalInfraNetwork', 'outagesLoaded', 'NetworkOutageState', 'InfraNetworkState', "name: 'outages', task",
    ].filter((gone) => app.includes(gone))).toEqual([]);
    expect(app).not.toContain('currentCitizenZones');
  });

  it('feuilles de style : les quatre panneaux dans les listes de panneaux (mobile, ::before, v2, kit)', () => {
    expect(css).toContain('  .defense-panel-modal,\n  .connectivity-panel-modal,\n  .outages-telecom-panel-modal,\n  .outages-power-panel-modal,\n  .outages-internet-panel-modal,\n  .outages-cloud-panel-modal,');
    expect(css).toContain('  .outages-telecom-panel-modal::before,\n  .outages-power-panel-modal::before,\n  .outages-internet-panel-modal::before,\n  .outages-cloud-panel-modal::before,');
    expect(css).toContain('  #app.ui-v2 .outages-telecom-panel-modal,\n  #app.ui-v2 .outages-power-panel-modal,\n  #app.ui-v2 .outages-internet-panel-modal,\n  #app.ui-v2 .outages-cloud-panel-modal,');
    const kit = '.outages-telecom-panel-modal, .outages-power-panel-modal, .outages-internet-panel-modal, .outages-cloud-panel-modal)';
    expect(css).toContain(`:is(.defense-panel-modal, .connectivity-panel-modal, .cyber-panel-modal, ${kit}.lp .fmk-level .fmk-ctx { white-space: normal; }`);
    expect(css.split(kit)).toHaveLength(5);
  });

  it('aide des couches : quatre lignes « Pannes réseau » sans badge « live », sans BGPView ; libellés du tiroir', () => {
    const start = layerPanel.indexOf("this.helpSection(fmIcon('satellite-dish'), 'Pannes réseau'");
    const section = layerPanel.slice(start, layerPanel.indexOf(']),', start));
    const lines = section.split('\n').filter((line) => line.includes('this.helpItem('));
    expect(lines.map((line) => /helpItem\(fmIcon\('[\w-]+'\), '([^']+)'/.exec(line)?.[1])).toEqual(['Électricité', 'Télécoms mobiles', 'Internet', 'Cloud et hébergement']);
    for (const line of lines) {
      expect(line).not.toContain("'live'");
      expect(line).not.toMatch(/temps réel|LIVE|Enedis|zones citoyennes|DataFair|BGPView/i);
    }
    expect(layerPanel).toContain("label: 'TÉLÉCOMS MOBILES'");
    expect(layerPanel).toContain("{ key: 'outagesInternet', label: 'INTERNET',");
    expect(layerPanel).toContain("{ key: 'outagesCloud',    label: 'CLOUD ET HÉBERGEMENT',");
    expect(layerPanel).not.toContain('TÉLÉCOM 4G·5G');
    expect(layerPanel).not.toMatch(/INTERNET \/ BGP|CLOUD \/ IXP/);
  });
});

describe('fichier ARCEP en retard : muet pour le score, les situations, l\u2019ISNR, le brief et la note (I6)', () => {
  it('une seule aide, telecomForScore(), qui passe par telecomIfFresh', () => {
    expect(app).toContain("import { telecomIfFresh } from './services/outages-levels.ts';");
    expect(methodBody('telecomForScore')).toContain('telecomIfFresh(this.currentOutTelecom?.telecom.data ?? null, Date.now())');
  });
  it('score et brief (buildFranceSnapshot), note de situation et ISNR lisent telecomForScore(), jamais le fichier brut', () => {
    expect(methodBody('buildFranceSnapshot')).toContain('telecomOutages:       this.telecomForScore(),');
    expect(methodBody('buildSituationReportContext')).toContain('telecomOutages: this.telecomForScore(),');
    expect(app).toMatch(/computeISNR\(\s*this\.newsItems,[^;]*this\.telecomForScore\(\),\s*\);/);
  });
  it('seul l\u2019export garde le fichier lu (daté, il dit tout)', () => {
    const raw = app.match(/telecomOutages:\s+this\.currentOutTelecom\?\.telecom\.data \?\? null/g) ?? [];
    expect(raw).toHaveLength(1);
    expect(methodBody('buildExportContext')).toContain('telecomOutages: this.currentOutTelecom?.telecom.data ?? null');
  });
});
