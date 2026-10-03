// tests/app-traffic-panels-wiring.test.ts
// Câblage des quatre panneaux Trafics dans App.ts (spec 2026-10-03 trafics § 3). App.ts ne s'instancie pas sous vitest : ces
// tests lisent sa source, comme tests/app-health-panels-wiring.test.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ROAD_TTL_MS } from '../src/services/traffic-road.ts';
import { AIR_OVERVIEW_TTL_MS } from '../src/services/traffic-air.ts';
import { RAIL_TTL_MS } from '../src/services/traffic-rail.ts';
import { MARITIME_SNAPSHOT_TTL_MS } from '../src/services/traffic-maritime.ts';

const app = readFileSync(new URL('../src/App.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8');
const layerPanel = readFileSync(new URL('../src/components/LayerPanel.ts', import.meta.url), 'utf8');
const mapContainer = readFileSync(new URL('../src/components/MapContainer.ts', import.meta.url), 'utf8');

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

function pollMinutes(name: string): number {
  return Number(new RegExp(`const ${name}\\s*=\\s*(\\d+)\\s*\\*\\s*60_000`).exec(app)?.[1]);
}

const PANELS = [
  ['trafficRoad', 'Trafic routier', 'car-front', 'trafficPanel', 'ensureTrafficPanel', 'traffic-panel-modal', 'loadRoadTraffic()', 'currentRoadTraffic'],
  ['trafficAir', 'Trafic aérien', 'plane', 'airTrafficPanel', 'ensureAirTrafficPanel', 'air-traffic-panel-modal', 'loadAirOverview()', 'currentAirOverview'],
  ['trafficRail', 'Réseau ferroviaire', 'train-front', 'transportPanel', 'ensureTransportPanel', 'transport-panel-modal', 'loadRailTraffic()', 'currentRailTraffic'],
  ['trafficMaritime', 'Trafic maritime', 'ship', 'maritimePanel', 'ensureMaritimePanel', 'maritime-panel-modal', 'loadMaritimeSnapshot()', 'currentMaritimeSnapshot'],
] as const;

describe('panneaux Trafics : un panneau par couche (spec 2026-10-03 trafics § 3)', () => {
  it('quatre panneaux flottants, mêmes id et couches ; le panneau aérien est ajouté', () => {
    for (const [id, label, icon] of PANELS) expect(app).toContain(`{ id: '${id}', label: '${label}', icon: '${icon}', layerKeys: ['${id}'] }`);
    expect(app).toContain("label: 'Trafic aérien',\n    legend:");
    expect(app).not.toMatch(/Trafic aérien \(preview\)|Trafic maritime \(AIS\)|Réseau ferroviaire \(SNCF\)/);
  });
  it('création paresseuse, instance, ouverture avec la couche, fermeture qui coupe la couche, masquage silencieux', () => {
    const vis = methodBody('_handlePanelVisibility');
    for (const [id, , , field, ensure, , load, current] of PANELS) {
      expect(methodBody('ensureLazyPanelForLayer')).toContain(`case '${id}': return [this.${ensure}()];`);
      expect(methodBody('getFloatingPanelInstance')).toContain(`case '${id}': return this.${field};`);
      expect(methodBody(ensure)).toContain(`this.closeTrafficLayer('${id}')`);
      expect(methodBody(ensure)).toContain(`panel.show(this.${current})`);
      expect(vis).toMatch(new RegExp(`key === '${id}'\\)[^]*this\\.${load.replace('()', '\\(\\)')}[^]*this\\.${field}\\?\\.show\\(this\\.${current}\\);[^]*this\\.${field}\\?\\.hide\\(\\{ silent: true \\}\\)`));
    }
    expect(methodBody('closeTrafficLayer')).toContain('this.onLayerToggle(key, false);');
    // Créé à la demande seulement (ensureTransportPanel), plus au rendu de la coquille (renderShell).
    expect(app.split('new TransportPanel(').length - 1).toBe(1);
    expect(methodBody('ensureTransportPanel')).toContain('new TransportPanel(container)');
  });
  it('relèves : route 5 min, aérien 2 min (panneau) et 12 s (carte), rail 5 min, maritime 2 min ; caches clients plus courts', () => {
    expect(pollMinutes('POLL_ROAD_MS')).toBe(5);
    expect(pollMinutes('POLL_AIR_OVERVIEW_MS')).toBe(2);
    expect(pollMinutes('POLL_SNCF_MS')).toBe(5);
    expect(pollMinutes('POLL_MARITIME_SNAPSHOT_MS')).toBe(2);
    expect(/const POLL_AIR_TRAFFIC_MS\s*=\s*12_000;/.test(app)).toBe(true);
    expect(ROAD_TTL_MS).toBeLessThan(pollMinutes('POLL_ROAD_MS') * 60_000);
    expect(AIR_OVERVIEW_TTL_MS).toBeLessThan(pollMinutes('POLL_AIR_OVERVIEW_MS') * 60_000);
    expect(RAIL_TTL_MS).toBeLessThan(pollMinutes('POLL_SNCF_MS') * 60_000);
    expect(MARITIME_SNAPSHOT_TTL_MS).toBeLessThan(pollMinutes('POLL_MARITIME_SNAPSHOT_MS') * 60_000);
    const polls: Array<[string, string, string, string]> = [
      ['startRoadPolling', 'POLL_ROAD_MS', 'trafficRoad', 'loadRoadTraffic'], ['startAirOverviewPolling', 'POLL_AIR_OVERVIEW_MS', 'trafficAir', 'loadAirOverview'],
      ['startRailPolling', 'POLL_SNCF_MS', 'trafficRail', 'loadRailTraffic'], ['startMaritimePolling', 'POLL_MARITIME_SNAPSHOT_MS', 'trafficMaritime', 'loadMaritimeSnapshot'],
      ['startAirTrafficPolling', 'POLL_AIR_TRAFFIC_MS', 'trafficAir', 'pollAirTraffic'],
    ];
    for (const [method, constant, layer, load] of polls) {
      const body = methodBody(method);
      expect(body).toContain('this.registerPausableInterval(');
      expect(body).toContain(constant);
      expect(body).toContain(`this.activeLayers.${layer}`);
      expect(body).toContain(`this.${load}(`);
      expect(app).toContain(`this.${method}();`);
    }
    for (const field of ['_intervalRoad', '_intervalAirOverview', '_intervalSncf', '_intervalMaritime']) {
      expect(app).toContain(`this.removePausableInterval(this.${field}); this.${field} = null;`);
    }
    expect(app).not.toMatch(/sncfFullCoverageLoaded|loadSncfFullCoverage|setInterval\(\(\) => \{\s*if \(document\.hidden\) return; \/\/ skip tick while tab is hidden\s*if \(!this\.activeLayers\.trafficRail/);
  });
  it('chargeurs : services chargés à la demande, panneaux mis à jour, panneau des sources sur la date de la donnée, jamais new Date()', () => {
    const loaders: Array<[string, string, string[]]> = [
      ['loadRoadTraffic', "import('./services/traffic-road.ts')", ['this.trafficPanel?.update(state);', "roadStatus(state, 'national', now)", "roadStatus(state, 'urban', now)", 'clearLegacyTomTomStorage(']],
      ['loadAirOverview', "import('./services/traffic-air.ts')", ['this.airTrafficPanel?.update(state);', "this.statusPanel?.updateSource('Trafic aérien', airStatus(state, now));"]],
      ['loadRailTraffic', "import('./services/traffic-rail.ts')", ['this.transportPanel?.update(state);', "railStatus(state, 'overview', now)", "railStatus(state, 'situations', now)"]],
      ['loadMaritimeSnapshot', "import('./services/traffic-maritime.ts')", ['this.maritimePanel?.update(state);', 'fetchMaritimeSnapshot(this.currentMaritimeSnapshot, AIS_RELAY_URL, now)', "maritimeStatus(state, now)"]],
    ];
    for (const [method, imp, parts] of loaders) {
      const body = methodBody(method);
      expect(body).toContain(imp);
      for (const p of parts) expect(body).toContain(p);
      expect(body).not.toContain('new Date()');
    }
    const air = methodBody('loadAirTraffic');
    expect(air).toContain('this.mapContainer?.updateAirTraffic(snapshot.flights);');
    expect(air).not.toMatch(/statusPanel|airplanes\.live|new Date\(\)/);
    expect(methodBody('pollAirTraffic')).not.toMatch(/statusPanel|new Date\(\)/);
  });
  it('AIS : panneau des sources daté par le dernier message, panneau maritime rafraîchi à chaque tour', () => {
    const ships = methodBody('startMilitaryPolling');
    expect(ships).toContain('const aisState = getAisConnectionState();');
    expect(ships).toContain('lastUpdate: aisState.lastMessageAt !== null ? new Date(aisState.lastMessageAt) : null,');
    expect(ships).not.toContain('lastUpdate: aisStatus.connected ? new Date() : null');
    expect(ships).toContain('this.maritimePanel?.refreshLive();');
    expect(app).not.toContain('maritimeHasData');
  });
  it('démarrage : rail et aperçu aérien lus même couche éteinte, route seulement avec sa couche ; erreurs sans heure inventée', () => {
    const secondary = methodBody('loadSecondaryLayers');
    expect(secondary).toContain("name: 'sncf', task: this.loadRailTraffic()");
    expect(secondary).toContain("...(this.activeLayers.trafficRoad ? [{\n        name: 'traffic', task: this.loadRoadTraffic()");
    expect(methodBody('loadOptionalLayers')).toContain("name: 'air-overview', task: this.loadAirOverview()");
    expect(secondary).not.toMatch(/updateSource\('(?:Trafic|SNCF)', \{ status: 'error', lastUpdate: new Date\(\)/);
  });
  it('score France, frise, note de situation et export sur les nouvelles sources (arbitrage 14)', () => {
    const inputs = methodBody('trafficInputs');
    expect(inputs).toContain('railTrains: this.currentRailTraffic?.overview.data?.trains ?? [],');
    expect(inputs).toContain('roadEvents: this.currentRoadTraffic?.national.data?.events ?? [],');
    expect(inputs).toContain('urbanJamCount: (this.currentRoadTraffic?.urban.data?.agglos ?? []).reduce((n, a) => n + a.jams, 0),');
    expect(methodBody('buildFranceSnapshot')).toContain('...this.trafficInputs(),');
    expect(methodBody('buildFranceTimeline')).toContain('traffic.railTrains.length + traffic.roadEvents.length + traffic.urbanJamCount');
    const report = methodBody('buildSituationReportContext');
    expect(report).toContain('railTrains: traffic.railTrains,');
    expect(report).toContain('roadEvents: traffic.roadEvents,');
    expect(report).toContain('context.sources.push(...trafficReportSources(this.statusPanel?.getSources() ?? []));');
    expect(methodBody('buildExportContext')).toContain('roadEvents: this.trafficInputs().roadEvents,');
    for (const gone of ['currentSncfDisruptions', 'currentTrafficIncidents', 'currentRailNetworkData', 'fetchTrafficIncidents', 'hasFreshTrafficIncidentCache',
      'buildRailNetworkData', 'resolveRailFocusDisruption', 'highlightRailDisruptionFromPanel', 'hasRailMapCoverage', 'ensureTrafficLoaded',
      'renderTrafficPanel', 'trafficDataLoaded', 'airplanes.live · proxy gratuit', 'airplanes.live + OpenSky']) {
      expect(app).not.toContain(gone);
    }
  });
  it('sources Trafics cliquées : panneau créé à la demande', () => {
    const click = methodBody('handleSourcePanelClick');
    expect(click).toContain("void this.ensureTransportPanel().then(() => this.transportPanel?.show(this.currentRailTraffic));");
    expect(click).toContain("void this.ensureTrafficPanel().then(() => this.trafficPanel?.show(this.currentRoadTraffic));");
    expect(click).toContain("void this.ensureAirTrafficPanel().then(() => this.airTrafficPanel?.show(this.currentAirOverview));");
    expect(click).toContain("void this.ensureMaritimePanel().then(() => this.maritimePanel?.show(this.currentMaritimeSnapshot));");
  });
  it('carte WebGL seulement : lignes cliquables (événements, trains, navires)', () => {
    expect(mapContainer).toContain('canFocusMap(): boolean');
    expect(methodBody('ensureTrafficPanel')).toContain('if (this.mapContainer?.canFocusMap()) panel.setOnFocusEvent(');
    expect(methodBody('ensureTransportPanel')).toContain('if (this.mapContainer?.canFocusMap()) panel.setOnSelectTrain((train) => this.focusTrain(train));');
  });
  it('aide des couches : plus d’airplanes.live ni de « temps réel » TomTom ; libellés inchangés', () => {
    expect(layerPanel).not.toMatch(/airplanes\.live|TomTom Traffic API|Incidents routiers temps réel/);
    expect(layerPanel).toContain("this.helpItem(fmIcon('plane'), 'Trafic aérien', 'Aéronefs suivis par OpenSky");
    for (const [label] of [['TRAFIC ROUTIER'], ['TRAFIC MARITIME'], ['TRAFIC AÉRIEN'], ['RÉSEAU FERROVIAIRE']]) expect(layerPanel).toContain(`label: '${label}'`);
  });
  it('panneaux en colonne v2 et en feuille basse mobile ; « Méthode et sources » en phrases', () => {
    const mobile = /@media \(max-width: 768px\) \{\s*([^{]*)\{\s*position: fixed !important;/.exec(css)?.[1] ?? '';
    for (const [, , , , , cls] of PANELS) {
      expect(css).toContain(`#app.ui-v2 .${cls},`);
      expect(mobile).toContain(`.${cls}`);
      expect(css).toContain(`.${cls}::before`);
      expect(css).toMatch(new RegExp(`#app :is\\([^)]*\\.${cls}[^)]*\\) \\.fmk \\.fmk-sec--ref \\.fmk-kv \\{`));
    }
  });
});
