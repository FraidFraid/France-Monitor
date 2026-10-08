import { existsSync, readFileSync } from 'node:fs';
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

  it('plus de « PDL hors réseau » ni de total de PDL fabriqué dans le code des pannes', () => {
    for (const p of ['src/App.ts', 'src/components/DeckGLMap.ts', 'src/components/MapContainer.ts', 'src/components/OutagesPanel.ts']) {
      const t = read(p);
      expect(t, p).not.toContain('offGridCount');
      expect(t, p).not.toContain('totalPDL');
      expect(t, p).not.toContain('PDL hors réseau');
    }
  });

  it('jamais de badge « TEMPS RÉEL » dans le code des pannes (S1)', () => {
    for (const p of [
      'src/App.ts', 'src/components/DeckGLMap.ts', 'src/components/MapContainer.ts', 'src/components/OutagesPanel.ts',
      'src/components/OutagesTelecomPanel.ts', 'src/components/OutagesPowerPanel.ts', 'src/components/deckgl/outages-map.ts',
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

  it('la route IIP, son service et le plugin de développement restent pour le parc nucléaire (R22)', () => {
    for (const p of ['api/_handlers/rte-iip.js', 'src/services/rte-iip.ts', 'src/plugins/rte-iip-proxy.ts']) expect(exists(p), p).toBe(true);
    expect(read('api/_routes.js')).toContain("'/api/rte-iip'");
  });
});
