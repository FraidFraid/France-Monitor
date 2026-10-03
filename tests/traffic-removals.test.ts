// tests/traffic-removals.test.ts
// Retraits de la phase B des Trafics (spec 2026-10-03 trafics § 2.6) : services, routes, miroirs de dev, types et textes remplacés.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const at = (p: string): URL => new URL(`../${p}`, import.meta.url);
const read = (p: string): string => readFileSync(at(p), 'utf8');

const REMOVED_FILES = [
  'src/services/traffic.ts', 'src/services/transport.ts', 'src/plugins/traffic-road-proxy.ts', 'src/plugins/traffic-flow-proxy.ts',
  'src/plugins/sncf-proxy.ts', 'api/_handlers/traffic/road.js', 'api/_handlers/transport/disruptions.js',
  // retirés par la partie A (tâches 6 et 7), vérifiés ici
  'src/plugins/air-traffic-proxy.ts', 'src/plugins/osm-railways-proxy.ts', 'api/_handlers/transport/osm-railways.js', 'src/types/air-traffic-shared.d.ts',
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

const GONE_MODULE = /(?:^|\/)(?:traffic|transport)(?:\.ts)?$|traffic\/road\.js$|transport\/disruptions\.js$|sncf-proxy|traffic-road-proxy|traffic-flow-proxy/;

describe('retraits Trafics (spec 2026-10-03 trafics § 2.6)', () => {
  it('fichiers retirés ; tuiles TomTom gardées', () => {
    for (const f of REMOVED_FILES) expect(existsSync(at(f)), f).toBe(false);
    expect(existsSync(at('src/plugins/traffic-tile-proxy.ts'))).toBe(true);
  });
  it('routes : anciennes retirées, nouvelles servies, tuiles et survol gardés', () => {
    const routes = read('api/_routes.js');
    for (const r of ["'/api/traffic/road'", "'/api/transport/disruptions'", "'/api/transport/osm-railways'"]) expect(routes).not.toContain(r);
    for (const r of ['road-national', 'road-urban', 'air-overview', 'air', 'tile', 'flow']) expect(routes).toContain(`'/api/traffic/${r}'`);
    for (const r of ['rail-overview', 'rail-situations']) expect(routes).toContain(`'/api/transport/${r}'`);
  });
  it('dev : plus de miroir des anciennes routes ni du survol non budgété', () => {
    const vite = read('vite.config.ts');
    for (const gone of ['sncfProxyPlugin', 'trafficRoadProxyPlugin', 'trafficFlowProxyPlugin', 'airTrafficProxyPlugin', 'osmRailwaysProxyPlugin']) {
      expect(vite).not.toContain(gone);
    }
    expect(vite).toContain('trafficTileProxyPlugin()');
    expect(read('tests/swr-cache-handlers.test.ts')).not.toContain('disruptions');
  });
  it('aucun importeur des modules retirés ne reste (src, api, server, scripts, tests)', () => {
    for (const f of [...sources('src'), ...sources('api'), ...sources('server'), ...sources('scripts'), ...sources('tests')]) {
      expect(specifiers(read(f)).filter((s) => GONE_MODULE.test(s)), f).toEqual([]);
    }
  });
  it('code mort et types retirés du code de l’application', () => {
    for (const f of sources('src').filter((p) => !p.endsWith('.test.ts'))) {
      expect(read(f), f).not.toMatch(/\b(TransportDisruption|RailNetworkData|TrainStop|AirTrafficAirportScore|TrafficSegment|MOCK_TRAFFIC_SEGMENTS|filterOsintTrafficIncidents|computeOsintMetadata|fetchSncfTraffic|fetchTrafficIncidents|fetchSncfDisruptions|buildRailNetworkData|airportScore|airportSeverity|airportSignals|topAirports)\b/);
    }
    for (const kept of ['interface RoadNationalResponse', 'interface RoadUrbanResponse', 'interface AirOverviewResponse', 'interface RailOverviewResponse',
      'interface RailSituationsResponse', 'interface MaritimeSnapshot', 'interface AirTrafficFlight']) expect(read('src/types/index.ts')).toContain(kept);
    expect(read('src/components/MapContainer.ts')).not.toMatch(/updateTraffic\(|mock-data/);
    expect(read('src/components/DeckGLMap.ts')).not.toMatch(/updateTraffic\(/);
  });
  it('trafic aérien civil : OpenSky seul dans le service et le panneau des sources ; vols militaires inchangés', () => {
    expect(read('src/services/air-traffic.ts')).not.toMatch(/airplanes|signalCount/);
    const status = read('src/components/StatusPanel.ts');
    expect(status).toContain("{ name: 'Trafic aérien', lastUpdate: null, status: 'loading', detail: 'OpenSky (ADS-B), collecte du serveur' }");
    expect(status).not.toContain('OpenSky + airplanes.live');
    expect(status).toContain('adsb.fi → airplanes.live → OpenSky');
    for (const f of ['src/locales/fr.ts', 'src/locales/en.ts']) expect(read(f)).not.toContain('OpenSky + airplanes.live');
  });
  it('badges « TEMPS RÉEL » des panneaux Trafics et budget TomTom du navigateur retirés', () => {
    for (const f of ['src/components/TrafficPanel.ts', 'src/components/TransportPanel.ts', 'src/components/AirTrafficPanel.ts', 'src/components/MaritimePanel.ts']) {
      expect(read(f)).not.toMatch(/renderFreshnessBadge|truthBadge|TEMPS RÉEL/);
    }
    // Les anciennes clés ne restent que pour être effacées (traffic-road.ts, LEGACY_TOMTOM_KEYS).
    expect(sources('src').filter((f) => read(f).includes('fm-tomtom-traffic-budget'))).toEqual(['src/services/traffic-road.ts']);
  });
});
