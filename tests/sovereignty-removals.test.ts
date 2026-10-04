// tests/sovereignty-removals.test.ts
// Retraits de la Souveraineté (spec 2026-10-04 souveraineté § 2.5 ; contrats § 7) : anciens vols (adsb.fi, airplanes.live, OpenSky,
// hexdb.io), brouillage déduit des vols, câbles dessinés à la main, fusion OpenStreetMap du navigateur, tableau cyber, carte des
// incidents, exposition Shodan et Censys. Reports de la tâche A17 : ancienne couche des navires, clés de langue des anciennes alertes,
// descriptions des sites de défense (amendement 7, O13). Chaque retrait a son remplaçant, vérifié ici.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { posix } from 'node:path';
import { ALL_MILITARY_INSTALLATIONS } from '../src/config/military-bases-db.ts';

const at = (p: string): URL => new URL(`../${p}`, import.meta.url);
const read = (p: string): string => readFileSync(at(p), 'utf8');
/** Source sans ses commentaires (blocs et lignes entières) : les en-têtes disent ce qui a été retiré. */
const code = (p: string): string => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const REMOVED_FILES = [
  'src/services/military-flights.ts', 'api/_shared/military-flights.js', 'api/_handlers/traffic/military.js', 'src/plugins/military-flights-proxy.ts',
  'src/config/military.test.ts', 'src/services/gps-jamming.ts', 'src/services/cable-threats.ts', 'src/utils/cable-proximity.ts',
  'public/data/submarine-cables.json', 'src/services/military-osm.ts', 'src/config/osm-france-military.json', 'src/services/cyber.ts',
  'src/services/threat-map.ts', 'src/services/exposure.ts', 'api/_handlers/threats.js', 'api/_handlers/exposure.js', 'src/plugins/threats-proxy.ts',
  'src/plugins/exposure-proxy.ts', 'src/components/deckgl/types.ts',
];

/** Remplaçants nommés (contrats § 7 ; le fichier des câbles est surtout Shom depuis la tâche A5, d'où son nom sans « -osm »). */
const REPLACEMENTS = [
  'api/_lib/adsb-lol.js', 'api/_lib/territory.js', 'api/_lib/icao-country.js', 'api/_lib/military-collect.js', 'api/_handlers/sovereignty/military.js',
  'api/_lib/cable-watch.js', 'api/_handlers/sovereignty/cables-watch.js', 'public/data/subsea-cables.json', 'public/data/defense-osm-works.json',
  'api/_lib/certfr.js', 'api/_lib/cisa-kev.js', 'api/_lib/ransomware-live.js', 'api/_lib/hibp.js', 'api/_lib/cybermalveillance.js',
  'api/_handlers/sovereignty/cyber.js', 'src/components/DefensePanel.ts', 'src/components/ConnectivityPanel.ts', 'src/components/CyberPanel.ts',
  'src/components/deckgl/sovereignty-map.ts', 'src/services/sovereignty-inputs.ts',
];

/** Fichiers sources d'un dossier (récursif), chemins relatifs à la racine du dépôt. */
function sources(dir: string): string[] {
  if (!existsSync(at(dir))) return [];
  return readdirSync(at(dir), { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sources(p);
    return /\.(ts|js|mjs)$/.test(e.name) ? [p] : [];
  });
}

/** Modules importés par un fichier (import statique, import de type, import dynamique). */
function specifiers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?:^|\n)\s*import[^;]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1] ?? m[2] ?? '');
  return out;
}

const noExt = (p: string): string => p.replace(/\.(ts|js|mjs|json)$/, '');
const GONE = new Set(REMOVED_FILES.map(noExt));

/** Chemin du dépôt visé par un import (relatif ou alias `@/`), sans extension ; null pour un paquet. */
function target(file: string, spec: string): string | null {
  if (spec.startsWith('@/')) return noExt(`src/${spec.slice(2)}`);
  return spec.startsWith('.') ? noExt(posix.join(posix.dirname(file), spec)) : null;
}

/** Code de l'application (hors tests). */
const APP = [...sources('src'), ...sources('api'), ...sources('server'), 'vite.config.ts'].filter((p) => !p.endsWith('.test.ts'));

const GONE_SYMBOL = new RegExp('\\b(' + [
  // vols, traînées, interpolation, classification
  'MilitaryFlight', 'MilitaryFlightsSnapshot', 'MilitaryFlightsMode', 'fetchMilitaryFlights', 'interpolateFlightPosition', 'updateMilitaryFlights',
  'updateMilitaryFlightTrails', 'setOnMilitaryFlightClick', 'showMilitaryFlight', 'militaryFlightsById', 'LYR_MILITARY_FLIGHTS',
  'LYR_MILITARY_FLIGHTS_LABEL', 'LYR_MILITARY_FLIGHT_TRAILS', 'SRC_MILITARY_FLIGHTS', 'SRC_MILITARY_FLIGHT_TRAILS', 'detectMilitarySurges',
  'MilitarySurge', 'FRENCH_HEX_RANGES', 'ALLIED_HEX_RANGES', 'detectAlliedHex', 'detectFrenchHex', 'determineAircraftInfo', 'militaryFlightsProxyPlugin',
  'AIRCRAFT_TYPES', 'FRENCH_AIRCRAFT_TYPES', 'AIRCRAFT_TYPE_COLORS', 'SPECIAL_SQUAWKS', 'checkSquawk', 'FRENCH_OPERATOR_LABELS', 'FRENCH_OPERATOR_COLORS',
  'MILITARY_BASE_TYPE_LABELS', 'identifyFrenchAircraftType', 'EnhancedAircraftInfo', 'renderMilitaryFlightPopup', '_startFlightInterpolation',
  // ancienne couche des navires (plus nourrie depuis la tâche A15) : la Marine nationale est dessinée par la couche Souveraineté (updateNavyLayer),
  // son clic ouvre la fiche du bâtiment (onSovereigntyMapClick) ; ancienne pose des sites remplacée par updateDefenseSites (tâche A14)
  'LYR_MILITARY_SHIPS', 'SRC_MILITARY_SHIPS', 'updateMilitaryShips', 'setOnMilitaryShipClick', 'onMilitaryShipClick', 'setOnMaritimeShipClick',
  '_onMaritimeShipClick', '_onMaritimeShipClickCb', 'updateMilitaryBases',
  // brouillage déduit des vols, câbles dessinés à la main
  'GpsJammingSignal', 'detectGpsJammingSignals', 'DefenseAlert', 'detectCableThreats', 'militaryShipToAIS', 'loadDefenseAlerts', 'submarineCablesData',
  'buildSubseaCableTooltip', 'buildSubmarineLandingPoints', 'SubmarineCableProperties', 'normalizeLandingPoints',
  // fusion OpenStreetMap du navigateur
  'loadStaticOsmFeatures', 'mergeWithStaticDb',
  // ancien cyber, carte des incidents, exposition
  'CyberState', 'CyberAlert', 'CyberCVE', 'CyberRansomwareVictim', 'CyberSourceStatus', 'fetchCyberDashboard', 'isCyberPanelEnabled', 'ThreatEvent',
  'ThreatMapDatum', 'fetchThreatMapEvents', 'filterThreatEvents', 'updateThreatEvents', 'setOnThreatEventClick', 'showThreatEvent', 'focusThreatEvent',
  'currentThreatFilters', 'threatMap', 'isFranceThreatEvent', 'summarizeCyberThreatEvents', 'computeLegacyFallbackScore', 'computeSecurityFromThreatEvents',
  'fetchExposureEvents', 'threatsProxyPlugin', 'exposureProxyPlugin', 'positionPopupMeasured', 'renderThreatEventPopup', 'getThreatMapData',
  'rebuildThreatClusterIndex', 'describeSecurityDriver', 'threatSeverityWeight',
  // anciens chemins d'App.ts
  'startMilitaryPolling', '_intervalMilitaryFlights', 'MILITARY_DETECTION_THROTTLE_MS', 'currentCyberData', 'currentThreatEvents', 'currentDefenseAlerts',
  'currentJammingSignals', 'currentMilitarySurges', 'currentMilitaryFlights', 'MILITARY_LEGEND', 'SUBSEA_CABLES_LEGEND', 'MILITARY_SURGE_SEVERITY_SUFFIX',
].join('|') + ')\\b');

/** Clés de langue des anciennes alertes (poussées militaires, câbles, brouillage déduit), sans lecteur depuis la tâche A16. */
const GONE_ALERT_KEYS = [
  'zoneFrance', 'airZone', 'affectedAirZone', 'flightCount', 'flightTypes', 'estimatedRadiusKm', 'confirmSurge', 'watchTraffic', 'defenseWatch',
  'airCell', 'nearCable', 'distanceSpeed', 'ship', 'distance', 'speed', 'verifyShip', 'monitorCableZone', 'infraSafety', 'gpsJammingTitle',
  'heuristicSignal', 'affectedAircraft', 'crossCheckSensors', 'monitorSignal', 'ewWatch', 'militaryFlights', 'adsb', 'subsea', 'gps',
];

describe('retraits Souveraineté (spec 2026-10-04 souveraineté § 2.5, contrats § 7)', () => {
  it('fichiers retirés ; remplaçants présents', () => {
    for (const f of REMOVED_FILES) expect(existsSync(at(f)), f).toBe(false);
    for (const f of REPLACEMENTS) expect(existsSync(at(f)), f).toBe(true);
  });

  it('routes : anciennes retirées, les trois routes Souveraineté servies ; test de fumée, OpenAPI et documentation suivent', () => {
    const routes = read('api/_routes.js');
    for (const r of ["'/api/threats'", "'/api/exposure'", "'/api/traffic/military'"]) expect(routes).not.toContain(r);
    for (const r of ['military', 'cables-watch', 'cyber']) expect(routes).toContain(`'/api/sovereignty/${r}'`);
    const smoke = read('.github/workflows/smoke.yml');
    expect(smoke).not.toMatch(/"\/api\/(threats|exposure|traffic\/military);/);
    for (const r of ['military', 'cables-watch', 'cyber']) expect(smoke).toContain(`"/api/sovereignty/${r};200"`);
    const openapi = read('public/openapi.json');
    expect(openapi).not.toMatch(/"\/api\/threats"|"\/api\/exposure"|ThreatEvent/);
    for (const r of ['military', 'cables-watch', 'cyber']) expect(openapi).toContain(`"/api/sovereignty/${r}"`);
    expect(() => JSON.parse(openapi)).not.toThrow();
    const docs = read('docs/api.md');
    expect(docs).not.toContain('/api/threats');
    for (const r of ['military', 'cables-watch', 'cyber']) expect(docs).toContain(`/api/sovereignty/${r}`);
    const env = read('deploy/oracle/francemonitor.env.example');
    expect(env).not.toMatch(/SHODAN|CENSYS|Shodan|Censys|FRENCH_BREACHES/);
    expect(env).toContain('AIS_RELAY_INTERNAL_URL=');
  });

  it('dev : plus de miroir des anciennes routes (le routeur de secours sert les handlers) ; proxy RSS sans CERT-FR', () => {
    const vite = read('vite.config.ts');
    expect(vite).not.toMatch(/military-flights-proxy|threats-proxy|exposure-proxy/);
    expect(vite).toContain('apiRouterFallbackPlugin()');
    expect(read('api/_handlers/rss.js')).not.toContain('cert.ssi.gouv.fr');
  });

  it('aucun importeur des modules retirés ne reste (src, api, server, scripts, tests, vite.config.ts)', () => {
    for (const f of [...sources('src'), ...sources('api'), ...sources('server'), ...sources('scripts'), ...sources('tests'), 'vite.config.ts']) {
      expect(specifiers(read(f)).map((s) => target(f, s)).filter((p) => p !== null && GONE.has(p)), f).toEqual([]);
    }
  });

  it('aucun symbole retiré dans le code de l’application (commentaires exclus)', () => {
    for (const f of APP) expect(code(f).match(GONE_SYMBOL)?.[0] ?? null, f).toBeNull();
  });

  it('plus aucun nom de source retirée dans le code de l’application ; aucun badge ni « Situation normale » dans les panneaux Souveraineté', () => {
    // json-proxy.js garde ses domaines tant que le test de bout en bout du serveur de production passe par lui (écart de la tâche A17).
    for (const f of APP.filter((p) => p !== 'api/_handlers/json-proxy.js')) {
      // La méthode du panneau Vigilance cyber nomme une fois ce qui a été retiré.
      const text = code(f).replace('Retirés : exposition Shodan et Censys', '');
      expect(text.match(/Shodan|Censys|adsb\.fi|hexdb\.io|nvd\.nist/)?.[0] ?? null, f).toBeNull();
    }
    for (const f of [
      'src/components/DefensePanel.ts', 'src/components/ConnectivityPanel.ts', 'src/components/CyberPanel.ts', 'src/components/layer-panel/defense.ts',
      'src/components/layer-panel/connectivite.ts', 'src/components/layer-panel/cyber.ts',
    ]) {
      expect(code(f).match(/TEMPS RÉEL|CACHE FIGÉ|\bLIVE\b|Situation normale|Aucune activité suspecte|Aucun brouillage détecté|renderFreshnessBadge|truthBadge/)?.[0] ?? null, f).toBeNull();
    }
  });

  it('ISNR sans événements de menace ; carte sans calques Deck.gl des menaces ; cas des urgences militaires sans gravité dans l’identifiant', () => {
    expect(code('src/services/stability-index.ts')).not.toMatch(/threatEvents|ThreatEvent/);
    expect(code('src/components/DeckGLMap.ts')).not.toMatch(/deck-threat|threatEvents|Supercluster/);
    expect(code('src/services/work-queue.ts')).not.toContain('military-surge');
  });

  it('Marine nationale : plus d’ancienne couche des navires ; la couche Souveraineté la dessine, surbrillance et sélection du Trafic maritime gardées', () => {
    expect(code('src/components/deckgl/constants.ts')).not.toMatch(/'military-ships'|'military-ships-src'/);
    const deck = code('src/components/DeckGLMap.ts');
    expect(deck).toContain('updateNavyLayer(ships: readonly MilitaryShip[], frozen: boolean, now: number): void {');
    expect(deck).toContain('(this.map.getSource(SRC_SOV_NAVY) as maplibregl.GeoJSONSource | undefined)?.setData(navyFeatures(shown, frozen, now));');
    expect(deck).toContain('this.setVis(LYR_MILITARY_SHIPS_HIGHLIGHT, vis(layers.trafficMaritime || layers.military));');
    expect(deck).toContain('this.setVis(LYR_MILITARY_SHIPS_SELECTED, vis(layers.trafficMaritime || layers.military));');
    // Le clic d'un bâtiment de la couche Souveraineté ouvre toujours sa fiche ; les sites sont posés par updateDefenseSites.
    expect(code('src/App.ts')).toContain('this.mapPopup?.showMilitaryShip(ship, at.x, at.y);');
    expect(code('src/App.ts')).toContain('this.mapContainer?.updateDefenseSites(ACTIVE_INSTALLATIONS);');
  });

  it('clés de langue des anciennes alertes retirées ; le moniteur d’alertes lit les urgences et la veille des câbles', () => {
    for (const f of ['src/locales/fr.ts', 'src/locales/en.ts']) {
      const text = read(f);
      const alerts = text.slice(text.indexOf('\n  alerts: {'), text.indexOf('\n} as const;'));
      for (const key of GONE_ALERT_KEYS) expect(alerts, `${f} : alerts.${key}`).not.toMatch(new RegExp(`\\n {4,6}${key}: `));
    }
    const app = code('src/App.ts');
    expect(app).toContain('militaryEmergencyAlerts(monitoredMilitaryEmergencies(');
    expect(app).toContain('cableAlertSituations(sov.cableAlerts)');
  });

  it('sites de défense (amendement 7, O13) : nom, catégorie et lien seulement ; ni description, ni unités, ni aéronefs, ni effectif', () => {
    for (const s of ALL_MILITARY_INSTALLATIONS) {
      expect(Object.keys(s).filter((k) => ['description', 'units', 'aircraft', 'personnel'].includes(k)), s.id).toEqual([]);
    }
    const types = code('src/types/index.ts');
    expect(types.slice(types.indexOf('export interface MilitaryBase {'), types.indexOf('export interface RestrictedZone {'))).not.toContain('description');
    const military = code('src/config/military.ts');
    expect(military.slice(military.indexOf('export const MILITARY_BASES'), military.indexOf('export const RESTRICTED_ZONES'))).not.toContain('description:');
    const popup = code('src/components/MapPopup.ts');
    expect(popup).not.toMatch(/base\.description|ext\['(units|aircraft|icao|region)'\]|UNITÉS STATIONÉES|data\.gouv\.fr/);
    // Remplaçants : l'infobulle de la carte (tâche A14) et la fiche disent la même chose.
    expect(code('src/components/deckgl/sovereignty-map.ts')).toContain("body: head(b.name, `site ${BASE_TYPE_WORD[b.type]}`) + note('Liste interne de sites publics, sans date par site.'),");
    expect(popup).toContain('Liste interne de sites publics, sans date par site.');
  });
});
