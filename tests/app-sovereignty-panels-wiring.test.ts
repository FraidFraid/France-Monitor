// tests/app-sovereignty-panels-wiring.test.ts
// Câblage des trois panneaux Souveraineté dans App.ts (spec 2026-10-04 souveraineté § 2 ; contrats § 4.2 à 4.4 ; amendement 7, O9, O14,
// O18 ; décision du 08/10/2026 : aucun aéronef masqué). App.ts ne s'instancie pas sous vitest : ces tests lisent sa source, comme tests/app-environment-panels-wiring.test.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SOVEREIGNTY_POLL_MS } from '../src/config/sovereignty-sources.ts';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const app = read('src/App.ts');
const css = read('src/styles/main.css');

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

/** Appels `updateSource(…)` d'un fichier, arguments compris (parenthèses équilibrées). */
function updateSourceCalls(src: string): string[] {
  const calls: string[] = [];
  let i = src.indexOf('updateSource(');
  while (i !== -1) {
    let depth = 0;
    let j = i + 'updateSource'.length;
    for (; j < src.length; j += 1) {
      if (src[j] === '(') depth += 1;
      else if (src[j] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    calls.push(src.slice(i, j + 1));
    i = src.indexOf('updateSource(', j);
  }
  return calls;
}

const PANELS = [
  ['military', 'Défense', 'shield', 'defensePanel', 'ensureDefensePanel', 'DefensePanel', 'defense-panel-modal', 'loadMilitary'],
  ['subseaCables', 'Connectivité', 'waves', 'connectivityPanel', 'ensureConnectivityPanel', 'ConnectivityPanel', 'connectivity-panel-modal', 'loadCables'],
  ['cyber', 'Vigilance cyber', 'lock-keyhole', 'cyberPanel', 'ensureCyberPanel', 'CyberPanel', 'cyber-panel-modal', 'loadCyber'],
] as const;

describe('panneaux Souveraineté : un panneau par couche (contrats § 4.2 à 4.4)', () => {
  it('trois panneaux flottants (Connectivité ajoutée) ; libellés du tiroir, des couches et des légendes ; aide sur les sources réelles', () => {
    expect(app).toContain("{ id: 'military', label: 'Défense', icon: 'shield', layerKeys: ['military'] },");
    expect(app).toContain("{ id: 'subseaCables', label: 'Connectivité', icon: 'waves', layerKeys: ['subseaCables'] },");
    expect(app).toContain("{ id: 'cyber', label: 'Vigilance cyber', icon: 'lock-keyhole', layerKeys: ['cyber'] },");
    expect(app).not.toContain('threatMap');
    expect(app).toContain("    label: 'Défense',\n    legend: DEFENSE_LEGEND,");
    expect(app).toContain("    label: 'Connectivité',\n    legend: CONNECTIVITY_LEGEND,");
    expect(app).toContain("    label: 'Vigilance cyber',\n    legend: CYBER_LEGEND,");
    expect(app).not.toMatch(/const (MILITARY_LEGEND|SUBSEA_CABLES_LEGEND|CYBER_LEGEND): LegendCategory/);
    const layerPanel = read('src/components/LayerPanel.ts');
    expect(layerPanel).toContain("{ key: 'subseaCables', label: 'CONNECTIVITÉ', icon: fmIcon('waves'), sublayerOf: 'sovereignty' },");
    const help = layerPanel.slice(layerPanel.indexOf("this.helpSection(fmIcon('shield'), 'Souveraineté', ["), layerPanel.indexOf("this.helpSection(fmIcon('satellite-dish'), 'Pannes réseau'"));
    // O9 : libellé du gros chiffre ; aucun masquage (décision du 08/10/2026) ; S2 : port base.
    expect(help).toContain('Aéronefs militaires ou d’État visibles en ADS-B au-dessus de la métropole (adsb.lol), tous montrés avec indicatif, immatriculation et position');
    expect(help).not.toContain('comptes par département');
    expect(help).toContain('Marine nationale vue en AIS et ports base de référence');
    // O18 : le Shom en référence, OpenStreetMap en complément (phase B, B28 : grands réseaux et points d'échange ajoutés à la phrase).
    expect(help).toContain('Câbles télécom sous-marins du Shom et d’OpenStreetMap, atterrages en France, navires lents près d’un câble (AIS) ;');
    expect(help).toContain('Alertes CERT-FR en cours (statut officiel), avis, catalogue KEV de la CISA, revendications de rançongiciels (Ransomware.live, comptes agrégés)');
    expect(help).not.toMatch(/'live'|'monthly'|Shodan|Censys|NVD|leaks|score global|faille|ports d’attache|au-dessus de la France/);
  });
  it('création paresseuse, instance, fermeture qui éteint la couche, ouverture qui lit la source et règle la relève', () => {
    const open = methodBody('openSovereigntyPanel');
    const source = methodBody('loadSovereigntySource');
    for (const [id, , , field, ensure, chunk, , load] of PANELS) {
      expect(methodBody(ensure)).toContain(`import('./components/${chunk}.ts')`);
      expect(methodBody(ensure)).toContain(`this.closeSovereigntyLayer('${id}')`);
      expect(methodBody('ensureLazyPanelForLayer')).toContain(`case '${id}': return [this.${ensure}()];`);
      expect(methodBody('getFloatingPanelInstance')).toContain(`case '${id}': return this.${field};`);
      expect(open).toContain(`case '${id}': this.${field}?.show(`);
      expect(source).toContain(`case '${id}': return this.${load}();`);
    }
    expect(methodBody('ensureLazyPanelForLayer')).toContain("case 'sovereignty': return [this.ensureDefensePanel(), this.ensureConnectivityPanel(), this.ensureCyberPanel()];");
    expect(methodBody('ensureDefensePanel')).toContain("Promise.all([import('./components/DefensePanel.ts'), this.loadDefenseSites()])");
    expect(open).toContain('this.syncSovereigntyPolling(key);');
    const vis = methodBody('_handlePanelVisibility');
    expect(vis).toContain('if (isSovereigntyLayerKey(key)) {');
    expect(vis).toContain('this.openSovereigntyPanel(key);');
    expect(vis).toContain('for (const sovKey of SOVEREIGNTY_LAYER_KEYS) {');
    expect(vis).not.toMatch(/key === 'subseaCables'|key === 'threatMap'|key === 'military'|Visual-only|currentDefenseAlerts|loadThreatMapEvents/);
  });
  it('aucun masquage (décision du 08/10/2026) : tout aéronef de la réponse est une ligne cliquable, toute urgence est recentrable', () => {
    const defense = methodBody('ensureDefensePanel');
    expect(defense).toContain('panel.setOnFocusAircraft((aircraft) => this.mapContainer?.flyTo(aircraft.lon, aircraft.lat, 9));');
    expect(defense).toContain('panel.setOnFocusEmergency((emergency) => this.mapContainer?.flyTo(emergency.lon, emergency.lat, 9));');
    const shell = read('src/components/DefensePanel.ts');
    expect(shell).toContain('m?.aircraft.find((a) => a.hex === hex)');
    expect(shell).toContain('m?.emergencies.find((x) => `${x.icao24}:${x.squawk}` === key)');
    expect(shell).not.toMatch(/\.others\b|maskedOthers|\.masked\b|inFrance\.find/);
    // Les anciens flux qui poussaient des vols français avec indicatif, et les navires vers l'ancienne couche, sont coupés (A17 retire les couches).
    expect(app).not.toMatch(/updateMilitaryFlights\(|updateMilitaryShips\(|updateMilitaryBases\(/);
  });
  it('liste de contrôle des couches enfants : maître dérivé partout par hasActiveSovereignty, Trafics intacts, ordre de restauration', () => {
    expect(methodBody('normalizeLayerState')).toContain('normalized.sovereignty = hasActiveSovereignty(normalized);');
    expect(methodBody('getEffectiveLayers')).toContain('effective.sovereignty = hasActiveSovereignty(effective);');
    expect(methodBody('_syncGroupFlags')).toContain('if (isSovereigntyLayerKey(key)) this.activeLayers.sovereignty = hasActiveSovereignty(this.activeLayers);');
    expect(methodBody('syncTrafficGroupState')).not.toMatch(/military|subseaCables|cyber|sovereignty/);
    expect(methodBody('restoreActiveLayerPanelsAfterRefresh')).toContain("'military',\n      'subseaCables',\n      'cyber',\n      'stability',");
    expect(methodBody('onLayerToggle')).toContain('this.refreshEnvironmentLegend();\n    this.refreshSovereigntyLegend();');
    expect(methodBody('onLayerToggle')).toContain("if ((key === 'trafficMaritime' || key === 'military') && enabled) {\n      connectAis();");
    expect(app).toContain('const isSovereigntyLayerKey = (key: keyof MapLayers): key is SovereigntyLayerKey => (SOVEREIGNTY_LAYER_KEYS as readonly string[]).includes(key);');
  });
  it('relèves pausables aux cadences de la configuration, toutes trois sans arrêt ; plus de relève des vols de 5 s', () => {
    expect(SOVEREIGNTY_POLL_MS).toEqual({ military: 120_000, subseaCables: 300_000, cyber: 900_000 });
    const sync = methodBody('syncSovereigntyPolling');
    expect(sync).toContain('this.registerPausableInterval(');
    expect(sync).toContain('SOVEREIGNTY_POLL_MS[key]');
    expect(methodBody('sovereigntyPollWanted')).toContain('SOVEREIGNTY_ALWAYS_POLLED.has(key)');
    expect(methodBody('init')).toContain('for (const key of SOVEREIGNTY_LAYER_KEYS) this.syncSovereigntyPolling(key);');
    expect(methodBody('init')).toContain('this.startShipsPolling();');
    expect(methodBody('destroy')).toContain('sovereigntyPolls');
    expect(app).not.toMatch(/startMilitaryPolling|_intervalMilitaryFlights|MILITARY_DETECTION_THROTTLE_MS|MILITARY_SLOW_POLL_MS/);
    const ships = methodBody('startShipsPolling');
    expect(ships).toContain('this.mapContainer?.updateNavyLayer(militaryShips, navyFrozen, navyNow);');
    expect(ships).toContain('this.defensePanel?.refreshLive();');
    expect(ships).not.toMatch(/loadDefenseAlerts|fetchMilitaryFlights|updateMilitaryShips|updateMilitaryFlights/);
    expect(methodBody('loadSecondaryLayers')).toContain("name: 'military', task: this.loadMilitary()");
    expect(methodBody('loadSecondaryLayers')).toContain("name: 'cables', task: this.loadCables()");
    expect(methodBody('loadOptionalLayers')).toContain("name: 'cyber', task: this.loadCyber()");
    const warm = methodBody('warmCriticalDataCache');
    for (const f of ['fetchMilitary(null)', 'fetchCables(null)', 'fetchCyber(null)']) expect(warm).toContain(f);
  });
  it('panneau des sources (point 17) : lignes datées par la donnée, jamais LIVE, adsb.fi, Shodan, Censys ni NVD', () => {
    expect(methodBody('loadMilitary')).toContain("this.statusPanel?.updateSource('Vols militaires', militaryStatus(this.currentMilitary, now));");
    expect(methodBody('loadCables')).toContain("this.statusPanel?.updateSource('Câbles et AIS', cablesStatus(this.currentCables, now));");
    expect(methodBody('loadCyber')).toContain('for (const [part, name] of CYBER_STATUS_PARTS) this.statusPanel?.updateSource(name, cyberStatus(this.currentSovCyber, part, now));');
    expect(app).toContain("['certfr', 'CERT-FR'], ['kev', 'CISA KEV'], ['ransomware', 'Ransomware.live'], ['hibp', 'Have I Been Pwned'],");
    for (const call of updateSourceCalls(app)) {
      expect(call).not.toMatch(/\bLIVE\b|DEGRADE|'CACHE'|'VIDE'|adsb\.fi|airplanes\.live|Shodan|Censys|\bNVD\b/);
    }
    expect(app).not.toMatch(/updateSource\('Cyber'|updateSource\('Vols militaires', \{|adsb\.fi|airplanes\.live|Shodan|Censys|\bNVD\b/);
    // Fin de la transition (tâche A16) : plus d'ancien chargeur des vols ni d'ancien tableau cyber.
    expect(app).not.toMatch(/refreshLegacyMilitaryScore|loadLegacyCyberScore|fetchMilitaryFlights|fetchCyberDashboard|fetchThreatMapEvents/);
    const status = read('src/components/StatusPanel.ts');
    expect(status).not.toMatch(/adsb\.fi|airplanes\.live|Shodan|Censys|NVD|status\.details\.militaryFlights/);
    for (const name of ['Vols militaires', 'Vigipirate (page du SGDSN)', 'Câbles et AIS', 'CERT-FR', 'CISA KEV', 'Ransomware.live', 'Have I Been Pwned', 'Cybermalveillance.gouv.fr']) {
      expect(status.split(`{ name: '${name}', lastUpdate: null, status: 'loading' },`)).toHaveLength(3);
    }
    // Lien de la source rendu par le panneau des sources (Ransomware.live : conditions d'utilisation).
    expect(status).toContain('sovereigntySourceDetail(src.name)');
    expect(status).toContain("detailEl.rel = 'noopener noreferrer';");
    for (const f of ['src/locales/fr.ts', 'src/locales/en.ts']) expect(read(f)).not.toContain('adsb.fi');
    expect(methodBody('recordSovereigntySamples')).toContain('SOVEREIGNTY_SOURCE_NAMES.includes(s.name)');
    expect(methodBody('markSovereigntySourcesFailed')).toContain('SOVEREIGNTY_LAYER_SOURCES[key]');
    expect(methodBody('buildSituationReportContext')).toContain('context.sources.push(...sovereigntyReportSources(this.statusPanel?.getSources() ?? []));');
  });
  it('O14 : relecture de la page Vigipirate du SGDSN lue avec la Défense, passée au panneau et datée dans sa propre ligne', () => {
    const military = methodBody('loadMilitary');
    expect(military).toContain('fetchVigipirateCheck(this.currentVigipirate)');
    expect(military).toContain('this.currentVigipirate = mergeVigipirateCheck(this.currentVigipirate, check);');
    expect(military).toContain('this.statusPanel?.updateSource(VIGIPIRATE_CHECK_SOURCE, vigipirateCheckStatus(this.currentVigipirate, now));');
    expect(app).toContain("const VIGIPIRATE_CHECK_SOURCE = 'Vigipirate (page du SGDSN)';");
    expect(methodBody('defensePanelState')).toContain('vigipirate: this.currentVigipirate');
    expect(read('src/components/DefensePanel.ts')).toContain('vigipirateCheck: vigipirate?.check ?? null,');
    expect(app).toContain("  'Vigipirate (page du SGDSN)': 'military',");
    expect(methodBody('handleSourcePanelClick')).toContain("} else if (name === VIGIPIRATE_CHECK_SOURCE) {\n      void this.ensureDefensePanel().then(() => this.openSovereigntyPanel('military'));");
  });
  it('clic sur une source, bouton du baromètre et clic sur la carte ouvrent le bon panneau (points 18 et 19)', () => {
    const click = methodBody('handleSourcePanelClick');
    expect(click).toContain("} else if (name === 'Vols militaires') {\n      void this.ensureDefensePanel().then(() => this.openSovereigntyPanel('military'));");
    expect(click).toContain("} else if (name === 'Câbles et AIS') {\n      void this.ensureConnectivityPanel().then(() => this.openSovereigntyPanel('subseaCables'));");
    expect(click).toContain("} else if (SOURCE_NAME_TO_FLOATING_PANEL[name] === 'cyber') {");
    for (const name of ['CERT-FR', 'CISA KEV', 'Ransomware.live', 'Have I Been Pwned', 'Cybermalveillance.gouv.fr']) expect(app).toContain(`  '${name}': 'cyber',`);
    expect(app).toContain("  'Câbles et AIS': 'subseaCables',");
    expect(app).toContain("  'Vols militaires': 'military',");
    expect(app).not.toMatch(/'Vols Militaires ADS-B'|'Cyber': 'cyber'/);
    expect(app).toContain("this.addGlobalListener(document, 'open-cyber-panel', () => this.showSovereigntyPanel('cyber'));");
    expect(methodBody('initMap')).toContain('this.mapContainer.setOnSovereigntyFeatureClick((layerId, props) => this.onSovereigntyMapClick(layerId, props));');
    const map = methodBody('onSovereigntyMapClick');
    // Clé `mmsi ?? id` du marqueur ; un bâtiment sans MMSI vérifié (O12) est trouvé par son identifiant.
    expect(map).toContain('findShipByKey(id, getMilitaryShips())');
    expect(map).toContain('this.mapPopup?.showMilitaryShip(ship, at.x, at.y);');
    expect(map).toContain("this.showSovereigntyPanel('military');");
    expect(map).toContain("this.showSovereigntyPanel('subseaCables');");
  });
  it('carte nourrie par les lectures ; sites sans fusion OpenStreetMap ; option des ouvrages lue à la demande', () => {
    expect(methodBody('loadMilitary')).toContain('this.mapContainer?.updateMilitaryLayer(this.currentMilitary.military.data, now);');
    expect(methodBody('loadCables')).toContain('this.mapContainer?.updateCablesLayer(this.currentCables.file, this.currentCables.watch.data, now);');
    const sites = methodBody('loadDefenseSites');
    expect(sites).toContain('this.mapContainer?.updateDefenseSites(ACTIVE_INSTALLATIONS);');
    expect(sites).toContain('summarizeCuratedSites(ACTIVE_INSTALLATIONS)');
    expect(methodBody('loadStaticData')).toContain('void this.loadDefenseSites();');
    expect(app).not.toMatch(/military-osm|mergeWithStaticDb|loadStaticOsmFeatures/);
    const osm = methodBody('setOsmWorks');
    expect(osm).toContain('this.mapContainer?.setOsmWorksVisible(on);');
    expect(osm).toContain('fetchDefenseOsmWorks()');
    expect(osm).toContain('this.mapContainer?.updateOsmWorks(data);');
    expect(app).not.toMatch(/focusThreatEvent|currentThreatFilters|filterThreatEvents|updateThreatEvents\(/);
  });
  it('feuilles de style : Connectivité dans les trois listes de panneaux ; styles de l’ancien panneau cyber retirés', () => {
    expect(css).toContain('  .defense-panel-modal,\n  .connectivity-panel-modal,');
    expect(css).toContain('  .defense-panel-modal::before,\n  .connectivity-panel-modal::before,');
    expect(css).toContain('  #app.ui-v2 .defense-panel-modal,\n  #app.ui-v2 .connectivity-panel-modal,');
    expect(css).toContain(':is(.defense-panel-modal, .connectivity-panel-modal, .cyber-panel-modal).lp .fmk-level .fmk-ctx { white-space: normal; }');
    expect(css).not.toMatch(/cyber-bento|cyber-alert-item|cyber-cve-badge|cyber-odometer|cyber-ring-container|cyber-warning|@keyframes cyber-pulse|Responsive adjustments for cyber panel/);
    expect(css).toContain('@keyframes pulse {');
  });
  it('fiche d’un bâtiment de la Marine nationale : « position de référence, pas une observation », jamais « AIS LIVE »', () => {
    const popup = read('src/components/MapPopup.ts');
    expect(popup).toContain('position de référence, pas une observation');
    expect(popup).not.toMatch(/AIS LIVE|PORT D'ATTACHE/);
  });
  it('score, frise, moniteur d’alertes et ISNR sur les entrées Souveraineté (tâche A16, contrats § 6 ; amendement 7, O7)', () => {
    expect(methodBody('sovereigntyInputs')).toContain('this.buildSovereigntyInputsB(');
    const snap = methodBody('buildFranceSnapshot');
    expect(snap).toContain('...sov,');
    expect(snap).not.toMatch(/cyberData|threatEvents|defenseAlerts|jammingSignals|currentMilitaryFlightsCount/);
    const monitor = methodBody('buildAlertMonitorSituations');
    expect(monitor).toContain('militaryEmergencyAlerts(monitoredMilitaryEmergencies(this.currentMilitary?.military.data ?? null, nowMs))');
    expect(monitor).toContain('cableAlertSituations(sov.cableAlerts)');
    expect(monitor).not.toMatch(/currentMilitarySurges|currentDefenseAlerts|currentJammingSignals/);
    expect(methodBody('buildFranceTimeline')).toContain('distinctVessels(sov.cableAlerts) + (sov.gnssDegraded?.rolling24h ?? 0)');
    expect(methodBody('updateISNR')).not.toContain('currentThreatEvents');
    for (const name of ['loadMilitary', 'loadCables', 'loadCyber']) expect(methodBody(name)).toContain('this.refreshFranceIntelPanel();');
    expect(app).not.toMatch(/currentCyberData|currentThreatEvents|currentDefenseAlerts|currentJammingSignals|currentMilitarySurges|currentMilitaryFlights|submarineCablesData|loadDefenseAlerts|defenseSeverityToSituationSeverity/);
    // Une urgence ouverte depuis une alerte recentre la carte sur sa position, pour toute urgence (plus aucune n'est masquée).
    const dossier = methodBody('openAlertDossier');
    expect(dossier).toContain("if (situation.type === 'MILITARY_SURGE_ALERT') {");
    expect(dossier).not.toMatch(/showMilitaryFlight/);
  });
});
