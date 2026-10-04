// tests/app-environment-panels-wiring.test.ts
// Câblage des quatre panneaux Environnement dans App.ts (spec 2026-10-04 environnement § 2 ; contrats § 4.2 à 4.4). App.ts ne
// s'instancie pas sous vitest : ces tests lisent sa source, comme tests/app-traffic-panels-wiring.test.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ENVIRONMENT_POLL_MS } from '../src/config/environment-sources.ts';

const app = readFileSync(new URL('../src/App.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8');

function methodBody(name: string): string {
  // Signature jusqu'à la première ligne qui se termine par « { » (un type de retour peut contenir des accolades).
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

const PANELS = [
  ['environmental', 'Vigilance météo', 'cloud-lightning', 'vigilancePanel', 'ensureVigilancePanel', 'VigilancePanel', 'vigilance-panel-modal', 'loadVigilance'],
  ['floods', 'Crues', 'waves', 'floodsPanel', 'ensureFloodsPanel', 'FloodsPanel', 'floods-panel-modal', 'loadFloods'],
  ['weatherRadar', 'Radar météo', 'cloud-rain', 'weatherRadarPanel', 'ensureWeatherRadarPanel', 'WeatherRadarPanel', 'radar-panel-modal', 'loadRadarManifest'],
  ['fires', 'Feux de forêt', 'flame', 'firesPanel', 'ensureFiresPanel', 'FiresPanel', 'fires-panel-modal', 'loadFires'],
] as const;

describe('panneaux Environnement : un panneau par couche (spec 2026-10-04 environnement § 2)', () => {
  it('quatre panneaux flottants, la couche Crues ajoutée, Jour / Nuit retiré', () => {
    for (const [id, label, icon] of PANELS) expect(app).toContain(`{ id: '${id}', label: '${label}', icon: '${icon}', layerKeys: ['${id}'] }`);
    expect(app).toContain('environmental: false,\n  floods: false,');
    expect(app).not.toMatch(/dayNight|DayNight|computeTerminatorGeoJSON|updateTerminator/);
  });
  it('création paresseuse, instance, fermeture qui éteint la couche, ouverture qui lit la source et règle la relève', () => {
    const open = methodBody('openEnvironmentPanel');
    const source = methodBody('loadEnvironmentSource');
    for (const [id, , , field, ensure, chunk, , load] of PANELS) {
      expect(methodBody(ensure)).toContain(`import('./components/${chunk}.ts')`);
      expect(methodBody(ensure)).toContain(`this.closeEnvironmentLayer('${id}')`);
      expect(methodBody('ensureLazyPanelForLayer')).toContain(`case '${id}': return [this.${ensure}()];`);
      expect(methodBody('getFloatingPanelInstance')).toContain(`case '${id}': return this.${field};`);
      expect(open).toContain(`case '${id}': this.${field}?.show(`);
      expect(source).toContain(`case '${id}': return this.${load}();`);
    }
    expect(open).toContain('this.syncEnvironmentPolling(key);');
    const vis = methodBody('_handlePanelVisibility');
    expect(vis).toContain('if (isEnvironmentLayerKey(key)) {');
    expect(vis).toContain('this.openEnvironmentPanel(key);');
    expect(vis).toContain('this.getFloatingPanelInstance(key)?.hide({ silent: true });');
  });
  it('les quatre endroits de la liste de contrôle des couches enfants, ensemble', () => {
    expect(methodBody('normalizeLayerState')).toContain('normalized.environmentGroup = hasActiveEnvironment(normalized);');
    expect(methodBody('getEffectiveLayers')).toContain('effective.environmentGroup = hasActiveEnvironment(effective);');
    expect(methodBody('_syncGroupFlags')).toContain('this.activeLayers.environmentGroup = hasActiveEnvironment(this.activeLayers);');
    expect(methodBody('restoreActiveLayerPanelsAfterRefresh')).toContain("'environmental',\n      'floods',\n      'weatherRadar',\n      'fires',");
    expect(methodBody('readStoredActiveLayers')).toContain('const parsed = migrateStoredLayers(stored);');
  });
  it('relèves pausables par couche, aux cadences de la configuration ; vigilance, crues et feux toujours relevés', () => {
    expect(ENVIRONMENT_POLL_MS).toEqual({ environmental: 300_000, floods: 600_000, weatherRadar: 300_000, fires: 900_000 });
    const sync = methodBody('syncEnvironmentPolling');
    expect(sync).toContain('this.registerPausableInterval(');
    expect(sync).toContain('ENVIRONMENT_POLL_MS[key]');
    expect(methodBody('environmentPollWanted')).toContain('ENVIRONMENT_ALWAYS_POLLED.has(key)');
    expect(methodBody('init')).toContain('for (const key of ENVIRONMENT_LAYER_KEYS) this.syncEnvironmentPolling(key);');
    expect(app).not.toMatch(/startWeatherPolling|startRadar2dPolling|POLL_WEATHER_VIGILANCE_MS|POLL_RADAR_2D_MS/);
    expect(methodBody('destroy')).toContain('environmentPolls');
  });
  it('consommateurs historiques : entrées Environnement lues par environmentInputs(), jamais copiées dans un champ (tâche 17)', () => {
    expect(methodBody('environmentInputs')).toContain('buildEnvironmentInputs(');
    const fires = methodBody('loadFires');
    expect(fires).toContain('clusterFireDetections(this.environmentInputs().activeFires, { epsKm: 3, minPoints: 2 })');
    expect(fires).toContain('void resolveIncidentGeography(incidents)');
    expect(methodBody('buildFranceSnapshot')).toContain('...this.environmentInputs(),');
    expect(methodBody('buildFranceSnapshot')).not.toMatch(/activeFires:|fireIncidents:|meteoAlerts:|floodSegments:/);
    for (const m of ['buildFranceTimeline', 'buildSituationReportContext', 'updatePoste', 'updateISNR', 'refreshHydraulicLayer', 'buildAlertMonitorSituations']) {
      expect(methodBody(m)).toContain('this.environmentInputs()');
    }
    expect(methodBody('buildExportContext')).toContain('fires: this.currentFires?.fires.data?.detections ?? [],');
    expect(app).not.toMatch(/currentMeteoAlerts|currentFloodSegments|currentActiveFires/);
    expect(app).not.toMatch(/fetchVigilanceMeteo|fetchVigilanceTimeline|fetchVigicrues|fetchFiresData|v2FloodSegments/);
  });
  it('carte : méthodes neuves seulement ; image radar commandée par la couche ; profil au clic ; légendes datées', () => {
    expect(methodBody('loadVigilance')).toContain('this.mapContainer?.updateVigilanceLayer(data, this.vigilanceEcheance, now)');
    expect(methodBody('loadFloods')).toContain('this.mapContainer?.updateFloodsLayer(data, now);');
    expect(methodBody('loadFires')).toContain('this.mapContainer?.updateFiresLayer(data, now, { forestDangerFill: this.forestDangerFill });');
    expect(methodBody('loadRadarManifest')).toContain('await this.mapContainer?.setRadar2dOverlay(manifest, false);');
    expect(app).toContain('this.mapContainer.setOnRadarPointPick((lat, lon) => this.loadRadarProfile(lat, lon));');
    expect(app).not.toMatch(/mapContainer\??\.(updateWeather|updateFloods|updateFires|highlightFloodSegment|refreshWeatherRadar|setOnWeatherRadarFrame)\(/);
    const legend = methodBody('refreshEnvironmentLegend');
    for (const fn of ['vigilanceLegend(', 'floodsLegend(', 'radarLegend(', 'firesLegend(']) expect(legend).toContain(fn);
  });
  it('sommets d’écho : une seule option pour les panneaux Radar et Feux', () => {
    const echo = methodBody('setEchoTops');
    expect(echo).toContain('this.echoTopsEnabled = on;');
    expect(echo).toContain('this.weatherRadarPanel?.update(this.radarPanelState());');
    expect(echo).toContain('this.firesPanel?.update(this.firesPanelState());');
    expect(methodBody('ensureWeatherRadarPanel')).toContain('panel.setOnEchoTops((on) => this.setEchoTops(on));');
    expect(methodBody('ensureFiresPanel')).toContain('panel.setOnEchoTops((on) => this.setEchoTops(on));');
  });
  it('panneau des sources et note de situation : lignes datées par la donnée ; dossier d’un feu dans le panneau Feux', () => {
    const click = methodBody('handleSourcePanelClick');
    for (const name of ['Météo-France', 'Vigicrues', 'Radar Météo-France', 'NASA FIRMS', 'Météo des forêts']) expect(click).toContain(`'${name}'`);
    expect(methodBody('buildSituationReportContext')).toContain('environmentReportSources(this.statusPanel?.getSources() ?? [])');
    expect(methodBody('openAlertDossier')).toContain('this.firesPanel?.openDossier(incidentId)');
    expect(app).not.toMatch(/WildfireDossierModal|\bEnvironmentPanel\b|installRadar2dObservation|fireObservationRuntime/);
  });
  it('feuille basse mobile, colonne v2 et lignes longues : les quatre classes', () => {
    for (const [, , , , , , cls] of PANELS) {
      expect(css).toContain(`  .${cls},\n`);
      expect(css).toContain(`  .${cls}::before,\n`);
      expect(css).toContain(`  #app.ui-v2 .${cls},\n`);
    }
    expect(css).not.toContain('.environment-panel-modal,');
  });
});
