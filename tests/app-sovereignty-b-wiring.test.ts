// tests/app-sovereignty-b-wiring.test.ts : câblage de la phase B dans App.ts (contrats § 4.4 points 10, 15, 17, 18 ; § 6 ; amendement 7,
// O7, O15, O17, S15). App.ts ne s'instancie pas sous vitest : ces tests lisent sa source, comme tests/app-environment-panels-wiring.test.ts.
// Aussi : aide du tiroir, test de fumée, OpenAPI et documentation de l'API.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const app = read('src/App.ts');

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
const count = (text: string, needle: string): number => text.split(needle).length - 1;
const B_ROUTES = ['/api/sovereignty/gnss', '/api/sovereignty/connectivity', '/api/sovereignty/sanctions', '/api/sovereignty/vigipirate'] as const;

describe('App.ts, phase B', () => {
  it('remplacements mécaniques : les appels de la phase A passent par les méthodes B, qui seules les appellent', () => {
    for (const [a, b] of [
      ['this.defensePanelState()', 'defensePanelStateB'], ['this.connectivityPanelState()', 'connectivityPanelStateB'],
      ['this.loadSovereigntySource(', 'loadSovereigntySourceB'],
    ] as const) {
      expect(count(app, a), a).toBe(1);
      expect(methodBody(b)).toContain(a);
    }
    expect([...app.matchAll(/(?<![.\w])defenseLegend\(/g)]).toHaveLength(1);
    expect(methodBody('defenseLegendB')).toContain('withDefensePhaseB(defenseLegend(m, { ...opts, droneZones: this.droneZonesOn }, now), {');
    expect([...app.matchAll(/(?<![.\w])buildSovereigntyInputs\(/g)]).toHaveLength(1);
    expect(methodBody('buildSovereigntyInputsB')).toContain('withGnssInputs(buildSovereigntyInputs(military, cables, cyber, now), gnss, military, now)');
    expect(methodBody('sovereigntyInputs')).toContain('this.buildSovereigntyInputsB(');
  });
  it('lectures : grille avec chaque lecture de la Défense et au démarrage ; gels couche active ou panneau ouvert ; réseaux avec la Connectivité', () => {
    const b = methodBody('loadSovereigntySourceB');
    expect(b).toContain('reads.push(this.loadGnss());');
    expect(b).toContain("if (this.sovereigntyBWanted('military')) reads.push(this.loadSanctions());");
    expect(b).toContain("if (key === 'subseaCables' && this.sovereigntyBWanted('subseaCables')) reads.push(this.loadConnectivity());");
    expect(methodBody('sovereigntyBWanted')).toContain('this.getFloatingPanelInstance(key)?.isVisible?.()');
    expect(methodBody('loadSecondaryLayers')).toContain("name: 'gnss', task: this.loadGnss()");
    expect(methodBody('warmCriticalDataCache')).toContain('void fetchGnss(null);');
    const gnss = methodBody('loadGnss');
    for (const s of [
      "updateSource('Grille GNSS', gnssStatus(", "updateSource('NOAA SWPC', gnssStatus(", 'this.mapContainer?.updateGnssLayer(', 'this.refreshFranceIntelPanel();',
      'this.recordSovereigntySamples(now);',
    ]) {
      expect(gnss).toContain(s);
    }
    expect(methodBody('loadConnectivity')).toContain("updateSource('RIPEstat', ripeStatus(");
    expect(methodBody('loadSanctions')).toContain("updateSource('Registre des gels', gelsStatus(");
    // Hors score : ni les réseaux ni le registre ne relancent le score.
    expect(methodBody('loadConnectivity')).not.toContain('refreshFranceIntelPanel');
    expect(methodBody('loadSanctions')).not.toContain('refreshFranceIntelPanel');
  });
  it('zones drones : fichier lu une fois par session, à l’activation de l’option seulement (jamais au démarrage)', () => {
    expect(methodBody('loadDroneZonesOnce')).toContain('if (this.droneZonesFile !== null) return Promise.resolve();');
    expect(methodBody('loadDroneZonesOnce')).toContain('this.mapContainer?.updateDroneZones(data);');
    const set = methodBody('setDroneZones');
    expect(set).toContain('this.mapContainer?.setDroneZonesVisible(on);');
    expect(set).toContain('if (on) this.loadDroneZonesOnce()');
    expect(count(app, 'this.loadDroneZonesOnce(')).toBe(1);
    expect(count(app, 'fetchDroneZones(')).toBe(1);
  });
  it('panneaux : états B (grille, registre, zones drones, réseaux) ; légende Défense de la phase B', () => {
    const defense = methodBody('defensePanelStateB');
    expect(defense).toContain('gnss: this.gnssState');
    expect(defense).toContain('sanctions: this.sanctionsState');
    expect(defense).toContain('drones: { meta, error: this.droneZonesError, shown: this.droneZonesOn }');
    expect(methodBody('connectivityPanelStateB')).toContain('connectivity: this.connectivityState');
    expect(methodBody('refreshSovereigntyLegend')).toContain('this.defenseLegendB(');
  });
  it('moniteur d’alertes : une entrée GNSS sans lieu, retirée du cache dès qu’elle n’a plus lieu d’être ; elle ouvre le panneau Défense', () => {
    const monitor = methodBody('buildAlertMonitorSituations');
    expect(monitor).toContain('const jammingSituations = gnssJammingSituations(this.gnssState?.gnss.data ?? null, nowMs).slice(0, ALERT_MONITOR_LIMIT);');
    // Revue de B28 (m1) : retirée avant l'écriture du cache, jamais laissée jusqu'à sa durée de vie.
    expect(monitor).toContain('pruneStaleGnssAlert(this.alertMonitorCache, jammingSituations);');
    expect(monitor.indexOf('pruneStaleGnssAlert(')).toBeLessThan(monitor.indexOf('for (const alert of freshAlerts)'));
    expect(methodBody('buildAlertMonitorSituations')).not.toContain('currentJammingSignals');
    expect(methodBody('openAlertDossier')).toContain("if (situation.type === 'GPS_JAMMING_ALERT') {");
    expect(methodBody('openAlertDossier')).toContain("this.showSovereigntyPanel('military');");
  });
  it('rappels du panneau Défense, clic sur une maille de la carte, sources cliquables', () => {
    const ensure = methodBody('ensureDefensePanel');
    expect(ensure).toContain('panel.setOnDroneZones((on) => this.setDroneZones(on));');
    expect(ensure).toContain('panel.setOnFocusGnssCell((cell) => this.focusGnssCell(cell));');
    // Recentrage sur la carte WebGL seulement, comme les autres lignes du panneau (O17 : mailles du jour UTC précédent seulement).
    expect(ensure.indexOf('panel.setOnFocusGnssCell(')).toBeGreaterThan(ensure.indexOf('if (this.mapContainer?.canFocusMap()) {'));
    expect(ensure.indexOf('panel.setOnFocusGnssCell(')).toBeLessThan(ensure.indexOf('panel.setOnOsmWorks('));
    const map = methodBody('onSovereigntyMapClick');
    expect(map).toContain('if (layerId === LYR_SOV_GNSS_FILL) {');
    expect(map).toContain('this.focusGnssCell(');
    for (const line of ["'Grille GNSS': 'military',", "'NOAA SWPC': 'military',", "'Registre des gels': 'military',", "'RIPEstat': 'subseaCables',"]) {
      expect(app).toContain(line);
    }
    const click = methodBody('handleSourcePanelClick');
    expect(click).toContain("} else if (name === 'Grille GNSS' || name === 'NOAA SWPC' || name === 'Registre des gels') {\n      void this.ensureDefensePanel().then(() => this.openSovereigntyPanel('military'));");
    expect(click).toContain("} else if (name === 'RIPEstat') {\n      void this.ensureConnectivityPanel().then(() => this.openSovereigntyPanel('subseaCables'));");
  });
  it('revue de B28 (I1) : la ligne « NOAA SWPC » n’est écrite que par loadGnss et markSovereigntyBFailed, jamais à l’heure du navigateur', () => {
    // Mentions de la ligne : liste des lignes de la phase B, correspondance des panneaux, clic de la source, et les deux écritures de loadGnss.
    expect(count(app, "'NOAA SWPC'")).toBe(5);
    expect(app).toContain("const SOVEREIGNTY_B_SOURCE_NAMES: ReadonlySet<string> = new Set(['Grille GNSS', 'NOAA SWPC', 'RIPEstat', 'Registre des gels']);");
    expect(app).toContain("  'NOAA SWPC': 'military',");
    expect(methodBody('handleSourcePanelClick')).toContain("name === 'NOAA SWPC'");
    expect([...app.matchAll(/updateSource\(\s*'NOAA SWPC'/g)]).toHaveLength(1);
    const gnss = methodBody('loadGnss');
    expect(gnss).toContain("this.statusPanel?.updateSource('NOAA SWPC', gnssStatus(this.gnssState, 'noaa', now));");
    expect(gnss).toContain("this.markSovereigntyBFailed(['Grille GNSS', 'NOAA SWPC'], err);");
    // L'ancien chargeur du panneau Énergie n'écrit plus la ligne ; un service de la phase A non plus (lignes de la phase B écartées).
    expect(methodBody('loadSpaceWeather')).not.toMatch(/NOAA SWPC|updateSource/);
    expect(methodBody('loadOptionalLayers')).not.toContain('NOAA SWPC');
    expect(methodBody('markSovereigntySourcesFailed')).toContain('SOVEREIGNTY_LAYER_SOURCES[key].filter((n) => !SOVEREIGNTY_B_SOURCE_NAMES.has(n))');
  });
  it('O15 : aucun libellé « brouillage » affirmé ni « navigation dégradée » ajouté à App.ts', () => {
    expect(app).not.toMatch(/brouillage mesuré|[Nn]avigation (?:GNSS )?dégradée|Brouillage GNSS/);
  });
});

describe('aide, test de fumée, API publique', () => {
  it('aide du tiroir : sources de la phase B nommées (O15 : précision de position, jamais « navigation dégradée »)', () => {
    const layerPanel = read('src/components/LayerPanel.ts');
    expect(layerPanel).toContain('sites de défense ; précision de position GNSS dégradée (compte sur 24\\u00a0h, mailles du jour UTC précédent), météo spatiale (NOAA SWPC), registre national des gels (DG Trésor), zones drones (DGAC).');
    expect(layerPanel).toContain('navires lents près d’un câble (AIS) ; visibilité des grands réseaux français (RIPEstat), points d’échange (PeeringDB).');
    expect(layerPanel).not.toMatch(/navigation GNSS dégradée/);
  });
  it('quatre routes dans le test de fumée, l’OpenAPI et la documentation', () => {
    const smoke = read('.github/workflows/smoke.yml');
    const openapi = JSON.parse(read('public/openapi.json')) as {
      paths: Record<string, { get: { tags: string[]; operationId: string; responses: Record<string, unknown> } }>;
      tags: Array<{ name: string }>;
    };
    const docs = read('docs/api.md');
    const cacheTable = docs.slice(docs.indexOf('## Cache et fraîcheur'));
    for (const route of B_ROUTES) {
      expect(smoke).toContain(`"${route};200"`);
      expect(openapi.paths[route]?.get.tags).toEqual(['Souveraineté']);
      expect(Object.keys(openapi.paths[route]?.get.responses ?? {})).toEqual(['200', '502']);
      expect(docs).toContain(`| \`GET ${route}\` |`);
      expect(cacheTable).toContain(`\`${route}\``);
    }
    expect(openapi.tags.filter((t) => t.name === 'Souveraineté')).toHaveLength(1);
    // Lignes de la phase B seulement : des tirets anciens restent ailleurs dans docs/api.md (hors de cette tâche).
    const text = read('public/openapi.json') + docs.split('\n').filter((l) => B_ROUTES.some((r) => l.includes(r))).join('\n');
    expect(text).not.toMatch(/\u2014|brouillage mesuré|navigation dégradée|[Nn]avigation GNSS dégradée|pleinement visible/);
  });
});
