import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string): string => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const exists = (p: string): boolean => existsSync(new URL(`../${p}`, import.meta.url));

describe('retraits de la phase A (spec 2026-10-08 § 2.4)', () => {
  it('plus de scraping citoyen, de proxy ARCEP brut, d’adaptateur Enedis ni d’ancien service de pannes', () => {
    for (const p of [
      'src/services/outages-scraper.ts', 'api/_handlers/citizen-outages.js', 'api/_shared/citizen-outages-handler.js', 'src/plugins/citizen-outages-proxy.ts',
      'api/_handlers/arcep.js', 'src/services/adapters/enedis-adapter.ts', 'src/services/outages.ts',
    ]) {
      expect(exists(p), p).toBe(false);
    }
    expect(read('api/_routes.js')).not.toMatch(/citizen|'\/api\/arcep'/);
    expect(read('scripts/generate-api-routes.mjs')).not.toContain('/api/outages/citizen');
    expect(read('vite.config.ts')).not.toContain('citizenOutagesProxyPlugin');
    expect(read('.github/workflows/smoke.yml')).not.toContain('/api/arcep');
  });

  it('test de fumée de production : les deux routes des pannes ; README : cadence Télécoms de 30 min, ni 10 min ni route retirée', () => {
    const smoke = read('.github/workflows/smoke.yml');
    expect(smoke).toContain('"/api/outages/telecom;200"');
    expect(smoke).toContain('"/api/outages/power;200"');
    const telecomRow = read('README.md').split('\n').find((l) => l.includes('`/api/outages/telecom`')) ?? '';
    expect(telecomRow).toMatch(/\| 30 min \|$/);
  });

  it('/api/rte-iip : agent TLS strict dédié à l’hôte IIP, plus de rejectUnauthorized: false', () => {
    const handler = read('api/_handlers/rte-iip.js');
    expect(handler).toContain("import { iipDispatcher } from '../_lib/rte-iip-agent.js';");
    expect(handler).toContain('dispatcher: iipDispatcher()');
    expect(handler).not.toMatch(/rejectUnauthorized|getInsecureAgent/);
  });

  it('plus de « PDL hors réseau » ni de total de PDL fabriqué dans le code des pannes', () => {
    for (const p of ['src/App.ts', 'src/components/DeckGLMap.ts', 'src/components/MapContainer.ts']) {
      const t = read(p);
      expect(t, p).not.toContain('offGridCount');
      expect(t, p).not.toContain('totalPDL');
      expect(t, p).not.toContain('PDL hors réseau');
    }
  });

  it('jamais de badge « TEMPS RÉEL » dans le code des pannes (S1)', () => {
    for (const p of [
      'src/App.ts', 'src/components/DeckGLMap.ts', 'src/components/MapContainer.ts',
      'src/components/OutagesTelecomPanel.ts', 'src/components/OutagesPowerPanel.ts', 'src/components/OutagesInternetPanel.ts',
      'src/components/OutagesCloudPanel.ts', 'src/components/deckgl/outages-map.ts',
    ]) {
      expect(read(p), p).not.toMatch(/TEMPS R[ÉE]EL/);
    }
    // L’infobulle IIP de l’ancienne couche, qui affichait « Temps réel », a disparu avec elle.
    expect(read('src/components/DeckGLMap.ts')).not.toContain('IIP RTE · REMIT · Temps réel');
  });

  it('plus de couche, de méthode ni de relais de l’ancienne carte des pannes (départements PDL, zones citoyennes, points ARCEP bruts, IIP)', () => {
    const deck = read('src/components/DeckGLMap.ts');
    const container = read('src/components/MapContainer.ts');
    const constants = read('src/components/deckgl/constants.ts');
    for (const name of [
      'LYR_POWER_FILL', 'LYR_POWER_LINE', 'LYR_CITIZEN_FILL', 'LYR_CITIZEN_LINE', 'LYR_TELECOM_PTS', 'LYR_IIP_GLOW', 'LYR_IIP_CORE',
      'SRC_CITIZEN_ZONES', 'SRC_IIP', 'SRC_POWER\\b', 'SRC_TELECOM\\b',
    ]) {
      expect(deck, name).not.toMatch(new RegExp(name));
      expect(constants, name).not.toMatch(new RegExp(`export const ${name}`));
    }
    for (const method of ['updateOutages', 'updateCitizenOutageZones', 'updateIIPIncidents', 'highlightPowerDept', 'highlightCitizenZone', 'highlightIIPIncident', 'computePowerOutageStyle']) {
      expect(deck, method).not.toMatch(new RegExp(`\\b${method}\\(`));
      expect(container, method).not.toMatch(new RegExp(`\\b${method}\\(`));
    }
    // Les points de la phase B de l’Environnement sont désormais ancrés sous la première couche Télécoms nouvelle.
    expect(read('src/components/deckgl/environment-map-b.ts')).toContain('export const ENV_B_POINTS_ANCHOR = LYR_OUT_TELECOM_MAINT;');
  });

  it('ni type ni paramètre orphelin : PowerOutage, TelecomOutage, signalements citoyens, powerOutageCount', () => {
    const types = read('src/types/index.ts');
    expect(types).not.toMatch(/\binterface (PowerOutage|TelecomOutage|CitizenOutageReport|CitizenOutageResponse|OutageZoneProperties)\b/);
    expect(types).not.toMatch(/\btype OutageZone(Collection)?\b/);
    expect(read('src/services/cyber-threat-scoring.ts')).not.toContain('powerOutageCount');
  });

  it('la route IIP et son service restent pour le parc nucléaire ; le plugin de développement est retiré (R22, P5)', () => {
    for (const p of ['api/_handlers/rte-iip.js', 'src/services/rte-iip.ts']) expect(exists(p), p).toBe(true);
    expect(exists('src/plugins/rte-iip-proxy.ts')).toBe(false);
    expect(read('api/_routes.js')).toContain("'/api/rte-iip'");
  });
});

/** Fichiers de src/ (code de l'application), tests exclus. */
const srcFiles = (): string[] => {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const e of readdirSync(new URL(`../${rel}`, import.meta.url), { withFileTypes: true })) {
      const p = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|js|css|html)$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(p);
    }
  };
  walk('src');
  return out;
};

describe('retraits de la phase B (spec 2026-10-08 § 3.3)', () => {
  it('ancien panneau, services, routes, plugins, utilitaires et instantané vide supprimés ; référentiel des centres de données gardé', () => {
    for (const p of [
      'src/components/OutagesPanel.ts', 'src/services/internet-outages.ts', 'src/services/infra-network.ts',
      'api/_handlers/internet-outages.js', 'api/_handlers/infra-network.js',
      'src/plugins/internet-outages-proxy.ts', 'src/plugins/infra-network-proxy.ts',
      'src/utils/infra-network-visuals.js', 'src/utils/infra-network-popup.js',
      'tests/infra-network-visuals.test.ts', 'tests/datacenter-popup.test.ts',
      'api/_shared/datacentermap-france-snapshot.js', 'scripts/generate-datacentermap-france-snapshot.mjs',
    ]) {
      expect(exists(p), p).toBe(false);
    }
    for (const p of ['api/_shared/infra-network-datacenters.js', 'tests/infra-network-datacenters.test.ts', 'tests/infra-network-official-cache.test.ts', 'api/_lib/peeringdb.js']) {
      expect(exists(p), p).toBe(true);
    }
    const routes = read('api/_routes.js');
    expect(routes).not.toContain('/api/internet-outages');
    expect(routes).not.toContain('/api/infra-network');
    const vite = read('vite.config.ts');
    for (const plugin of ['internetOutagesProxyPlugin', 'infraNetworkProxyPlugin', 'rteIipProxyPlugin']) expect(vite, plugin).not.toContain(plugin);
  });

  it('aucun fichier de src/ ne dit « Non qualifié », « Site existant », « BGPView » ni un score national de 100 par défaut', () => {
    const files = srcFiles();
    expect(files.length).toBeGreaterThan(100);
    for (const p of files) {
      const t = read(p);
      for (const banned of ['Non qualifié', 'Site existant', 'BGPView', 'nationalScore: 100']) expect(t, `${p} : ${banned}`).not.toContain(banned);
    }
  });

  it('plus de couche, de source, d’icône ni de méthode de l’ancienne carte Internet et Cloud', () => {
    const deck = read('src/components/DeckGLMap.ts');
    const container = read('src/components/MapContainer.ts');
    const constants = read('src/components/deckgl/constants.ts');
    for (const method of ['updateNetworkOutages', 'updateInfraNetwork', 'highlightIsp', 'highlightIoda', 'highlightDc', 'highlightIxp']) {
      expect(deck, method).not.toContain(method);
      expect(container, method).not.toContain(method);
    }
    for (const name of ['LYR_NET_', 'LYR_DC_', 'LYR_IXP_', 'SRC_NET_', 'SRC_DC', 'SRC_IXP']) {
      expect(deck, name).not.toContain(name);
      expect(constants, name).not.toContain(name);
    }
    for (const leftover of ['triangle-dc', 'square-ixp', 'buildDatacenterPopupHtml', 'outageFocusGroups', 'explicitOpacityLayers']) {
      expect(deck, leftover).not.toContain(leftover);
    }
  });

  it('plus de style de l’ancien panneau ni de type de l’ancien état réseau', () => {
    expect(read('src/styles/main.css')).not.toContain('.outages-panel-modal');
    const types = read('src/types/index.ts');
    for (const t of ['NetworkOutageState', 'InfraNetworkState', 'IodaOutageEvent', 'IspBgpStatus', 'InfraStatusLevel', 'InfraIncident', 'DatacenterStatus', 'IxpStatus', 'CloudflareRadarAnomaly']) {
      expect(types, t).not.toMatch(new RegExp(`\\b(interface|type) ${t}\\b`));
    }
  });
});
