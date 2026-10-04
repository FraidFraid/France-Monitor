// tests/environment-removals.test.ts
// Retraits de l'Environnement (spec 2026-10-04 environnement § 2.6 ; contrats § 7) : anciens panneaux, services, routes, miroir de
// dev, Jour / Nuit, RainViewer, champs inventés des tronçons et niveau violet. Chaque retrait a son remplaçant, vérifié ici.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { posix } from 'node:path';

const at = (p: string): URL => new URL(`../${p}`, import.meta.url);
const read = (p: string): string => readFileSync(at(p), 'utf8');
/** Source sans ses commentaires (blocs et lignes entières) : les en-têtes disent ce qui a été retiré. */
const code = (p: string): string => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const REMOVED_FILES = [
  'src/components/EnvironmentPanel.ts', 'src/components/DayNightPanel.ts', 'src/layers/DayNightLayer.ts',
  'src/components/WildfireDossierModal.ts', 'src/components/WildfireDossierModal.test.ts',
  'src/services/vigilance-meteo.ts', 'src/services/vigicrues.ts', 'src/services/fires.ts',
  'src/services/weather-radar.ts', 'src/services/weather-radar.test.ts', 'src/config/weather-radar-legend.ts',
  'src/services/radar-2d-orchestration.ts', 'src/services/radar-2d-orchestration.test.ts',
  'src/components/fire-observation-model.ts', 'src/components/fire-observation-model.test.ts',
  'src/services/fire-observation-runtime.ts', 'src/services/fire-observation-runtime.test.ts',
  'api/_handlers/weather/vigilance.js', 'api/_handlers/fires.js', 'src/plugins/weather-vigilance-proxy.ts',
  'public/data/topage',
];

/** Remplaçants nommés (contrats § 7). */
const REPLACEMENTS = [
  'src/components/VigilancePanel.ts', 'src/components/FloodsPanel.ts', 'src/components/WeatherRadarPanel.ts', 'src/components/FiresPanel.ts',
  'src/components/layer-panel/feux-dossier.ts', 'src/services/environment-vigilance.ts', 'src/services/environment-floods.ts',
  'src/services/environment-fires.ts', 'src/services/environment-radar.ts', 'src/services/aeronautical-day.ts', 'src/config/departements.ts',
  'api/_handlers/environment/vigilance.js', 'api/_handlers/environment/floods.js', 'api/_handlers/environment/fires.js', 'api/_lib/firms-window.js',
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
function specifiers(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/(?:^|\n)\s*import[^;]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1] ?? m[2] ?? '');
  return out;
}

const noExt = (p: string): string => p.replace(/\.(ts|js|mjs)$/, '');
const GONE = new Set(REMOVED_FILES.map(noExt));

/** Chemin du dépôt visé par un import (relatif ou alias `@/`), sans extension ; null pour un paquet. */
function target(file: string, spec: string): string | null {
  if (spec.startsWith('@/')) return noExt(`src/${spec.slice(2)}`);
  return spec.startsWith('.') ? noExt(posix.join(posix.dirname(file), spec)) : null;
}

/** Code de l'application (hors tests). */
const APP = [...sources('src'), ...sources('api'), ...sources('server'), 'vite.config.ts'].filter((p) => !p.endsWith('.test.ts'));

const GONE_SYMBOL = new RegExp('\\b(' + [
  // panneaux et services
  'EnvironmentPanel', 'DayNightPanel', 'DayNightLayer', 'WildfireDossierModal', 'fetchVigilanceMeteo', 'fetchVigilanceTimeline',
  'VigilanceTimeline', 'getAlertsForTimeSlot', 'RISK_PICTOGRAMS', 'getPrimaryRiskIcon', 'DEPT_CENTROIDS', 'WEATHER_DEPT_CENTROIDS',
  'fetchVigicrues', 'fetchFiresData', 'fetchActiveFires', 'applyFiresFilter', 'DEFAULT_FIRES_FILTER', 'URBAN_AREAS',
  'deriveFireObservationStatus', 'FireObservationRuntimeState', 'installRadar2dObservation', 'runRadar2dToggleTransition',
  'weatherVigilanceProxyPlugin', 'MOCK_METEO_ALERTS',
  // RainViewer
  'ensureWeatherRadarLayer', 'refreshWeatherRadar', 'setOnWeatherRadarFrame', 'publishWeatherRadar', 'WEATHER_RADAR_REGIONS',
  'WEATHER_RADAR_MAX_ZOOM', 'getWeatherRadarSourceId', 'getWeatherRadarLayerId', 'POLL_WEATHER_RADAR_MS', '_intervalWeatherRadar',
  'currentWeatherRadarFrame', 'currentWeatherRadarStatus', 'WEATHER_RADAR_LEGEND', 'WEATHER_RADAR_LEGEND_ITEMS', 'weatherRadarSummary',
  // Jour / Nuit
  'dayNightOptions', 'dayNightVisible', 'updateTerminator', 'updateDayNightOptions', 'SRC_TERMINATOR', 'LYR_TERMINATOR',
  'computeTerminatorGeoJSON', '_intervalSpaceWeatherTerminator', 'POLL_SPACE_WEATHER_TERMINATOR_MS',
  // tronçons inventés et Topage
  'FloodSegment', 'FloodDataSource', 'FloodGeometryFidelity', 'geometryFidelity', 'rawVertexCount', 'displayVertexCount', 'rawGeometry',
  'displayGeometry', 'LYR_FLOODS_RAW', 'SRC_TOPAGE_VIS', 'LYR_TOPAGE_VIS', 'updateTopageVisual', 'v2FloodSegments',
  // violet, couleurs et anciennes méthodes de la carte
  'LYR_WEATHER_LINE_VIOLET', 'METEO_COLORS', 'WEATHER_RISK_ICONS', 'FLOOD_COLORS', 'OfficialMeteoLevel', 'officialMeteoLevel',
  'updateWeather', 'updateWeatherIcons', 'highlightWeatherDepartment', 'updateFloods', 'highlightFloodSegment', 'updateFires', 'highlightFire',
  'highlightFireCluster', 'clearFireHighlight', 'setFirePointsVisible', '_firePointsEnabled',
  // anciens chemins d'App.ts
  'layoutEnvironmentFloatingPanels', 'renderEnvironmentPanel', 'renderFiresPanel', 'environmentLoaded', 'firesLoaded', 'currentMeteoTimeline',
  'startWeatherPolling', '_intervalWeather', 'meteoTotal', 'currentMeteoAlerts', 'currentFloodSegments', 'currentActiveFires',
].join('|') + ')\\b');

describe('retraits Environnement (spec 2026-10-04 environnement § 2.6, contrats § 7)', () => {
  it('fichiers retirés ; remplaçants présents', () => {
    for (const f of REMOVED_FILES) expect(existsSync(at(f)), f).toBe(false);
    for (const f of REPLACEMENTS) expect(existsSync(at(f)), f).toBe(true);
  });

  it('routes : anciennes retirées, nouvelles servies ; test de fumée et OpenAPI suivent', () => {
    const routes = read('api/_routes.js');
    for (const r of ["'/api/fires'", "'/api/weather/vigilance'"]) expect(routes).not.toContain(r);
    for (const r of ['vigilance', 'floods', 'fires']) expect(routes).toContain(`'/api/environment/${r}'`);
    expect(routes).toContain("'/api/fires/impacts'");
    for (const r of ['mtg-frp', 'radar-2d', 'radar-column']) expect(routes).toContain(`'/api/fire-observations/${r}'`);
    const smoke = read('.github/workflows/smoke.yml');
    expect(smoke).not.toMatch(/"\/api\/(fires|weather\/vigilance);/);
    for (const r of ['vigilance', 'fires']) expect(smoke).toContain(`"/api/environment/${r};200"`);
    const openapi = read('public/openapi.json');
    expect(openapi).not.toContain('"/api/fires"');
    expect(openapi).toContain('"/api/environment/fires"');
    expect(read('.env.example')).not.toContain('/api/weather/vigilance');
  });

  it('dev : plus de miroir de /api/weather/vigilance (le routeur de secours sert les handlers) ; json-proxy sans Vigicrues', () => {
    const vite = read('vite.config.ts');
    expect(vite).not.toContain('weather-vigilance-proxy');
    expect(vite).toContain('apiRouterFallbackPlugin()');
    expect(read('api/_handlers/json-proxy.js')).not.toMatch(/vigicrues/i);
  });

  it('aucun importeur des modules retirés ne reste (src, api, server, scripts, tests, vite.config.ts)', () => {
    for (const f of [...sources('src'), ...sources('api'), ...sources('server'), ...sources('scripts'), ...sources('tests'), 'vite.config.ts']) {
      expect(specifiers(read(f)).map((s) => target(f, s)).filter((p) => p !== null && GONE.has(p)), f).toEqual([]);
    }
  });

  it('code mort et symboles retirés du code de l’application ; remplaçants nommés', () => {
    for (const f of APP) expect(read(f), f).not.toMatch(GONE_SYMBOL);
    const types = read('src/types/index.ts');
    expect(types).toContain("export type MeteoVigilanceLevel = 'green' | 'yellow' | 'orange' | 'red';");
    expect(types).toContain('export interface FloodSectionRef {');
    expect(types).not.toContain('dayNight?: boolean;');
    expect(read('src/services/vigilance.ts')).toContain("export type OfficialColor = 'green' | 'yellow' | 'orange' | 'red';");
    expect(read('src/components/layer-panel/environment-format.ts')).toContain('export const PHENOMENON_ICON');
    expect(read('src/config/departements.ts')).toContain('export const DEPARTEMENT_CENTROIDS');
    expect(read('src/config/layer-presets.ts')).toContain('delete out.dayNight;');
    expect(read('src/App.ts')).toContain('private syncEnvironmentPolling(');
  });

  it('niveau violet : jamais publié, absent du code', () => {
    for (const f of APP) expect(read(f), f).not.toMatch(/['"]violet['"]|violet: /);
    expect(read('src/styles/main.css')).not.toContain('--meteo-violet');
  });

  it('Jour / Nuit remplacé par la ligne « jour aéronautique » de Vigilance météo et de Feux de forêt', () => {
    expect(read('src/services/space-weather.ts')).not.toMatch(/terminat|subsolarPoint/i);
    expect(read('src/styles/main.css')).not.toMatch(/\.dn-[a-z]/);
    expect(read('src/components/layer-panel/vigilance.ts')).toContain('Jour aéronautique : ${aeronauticalLine(day, at).text}');
    expect(read('src/components/layer-panel/feux.ts')).toContain("title: 'Jour aéronautique'");
  });

  it('RainViewer remplacé par la mosaïque Météo-France (couche Radar météo)', () => {
    for (const f of APP) expect(read(f), f).not.toMatch(/rainviewer\.com/);
    expect(read('src/services/freshness.ts')).not.toContain('weatherRadar');
    expect(read('src/components/layer-panel/environment-legend.ts')).toContain('export const RADAR_LEGEND');
    expect(read('src/components/DeckGLMap.ts')).toContain('return this.currentLayers?.weatherRadar ?? false;');
  });

  it('dossier d’un feu : fenêtre retirée, ses faits repris dans l’onglet du panneau Feux de forêt', () => {
    const css = read('src/styles/main.css');
    expect(css).not.toMatch(/\.wf-(modal|metric|observed|badge|timeline)/);
    expect(css).toContain('.wf-fact {');
    expect(read('src/components/layer-panel/feux-dossier.ts')).toContain('export function renderDeclaredBlock(');
  });

  it('tronçons : tracé publié par Vigicrues, jaunes compris, en v1 comme en v2', () => {
    expect(read('src/components/deckgl/environment-map.ts')).toContain('f.sections.filter((s) => s.level >= 2 && s.path.length > 0)');
    expect(read('src/services/v2-map.ts')).not.toContain('Flood');
  });

  it('badges « LIVE » et « TEMPS RÉEL », interrupteur radar du panneau Feux et « aucune » sur panne retirés ; lignes datées hors Watchdog', () => {
    for (const f of ['src/components/VigilancePanel.ts', 'src/components/FloodsPanel.ts', 'src/components/WeatherRadarPanel.ts', 'src/components/FiresPanel.ts',
      'src/components/layer-panel/vigilance.ts', 'src/components/layer-panel/crues.ts', 'src/components/layer-panel/radar.ts', 'src/components/layer-panel/feux.ts']) {
      expect(code(f), f).not.toMatch(/renderFreshnessBadge|truthBadge|TEMPS RÉEL|latence ~1h|Réel-temps|['"`>]LIVE['"`<]/);
    }
    for (const f of ['src/components/FiresPanel.ts', 'src/components/layer-panel/feux.ts']) expect(code(f), f).not.toContain('Réflectivité radar 2D');
    const app = read('src/App.ts');
    expect(code('src/App.ts')).not.toMatch(/Aucune vigilance|Aucun tronçon/);
    for (const id of ['meteo-france', 'vigicrues', 'fires-nasa', 'fire-radar-2d']) expect(app).not.toContain(`Watchdog.register('${id}'`);
    for (const f of APP) expect(read(f), f).not.toContain('Feux NASA FIRMS');
    expect(read('src/config/environment-sources.ts')).toContain('export function environmentReportSources(');
  });
});
