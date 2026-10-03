// Retraits de la phase B (spec 2026-10-03 § 2.9) : anciens panneaux, baromètre, services, routes, miroirs de dev et types.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const at = (p: string): URL => new URL(`../${p}`, import.meta.url);
const read = (p: string): string => readFileSync(at(p), 'utf8');

const REMOVED_FILES = [
  'src/components/NationalHealthPanel.ts', 'src/components/HealthBarometerPanel.ts', 'src/services/health-barometer.ts',
  'src/services/health.ts', 'src/services/hantavirus.ts', 'src/services/hantavirus.test.ts', 'src/services/epidemiology-monitor.ts',
  'src/services/sentinelles-ingestion.ts', 'src/services/sentinellesService.ts', 'src/api/sentinellesApiClient.ts',
  'src/services/hospitals.ts', 'src/config/hospitals-db.ts', 'src/plugins/health-proxy.ts', 'src/types/api-health-modules.d.ts',
  'api/_handlers/health/oscour-sos.js', 'api/_handlers/health/departmental.js', 'api/_handlers/health/epidemiology.js',
  'api/_handlers/health/epidemic-alerts.js', 'api/_handlers/health/epidemiology-monitor.js', 'api/_handlers/health/sentinelles.js',
  'api/_handlers/health/sentinelles-ingestion.js', 'api/_handlers/health/hantavirus.js', 'api/_handlers/health/apl.js',
  'api/_shared/apl-departements-snapshot.js', 'api/_shared/health-utils.js', 'public/data/apl-departements.json',
  'scripts/fetch-apl.mjs', 'scripts/generate-apl-snapshot.mjs', 'tests/hantavirus-api.test.ts', 'tests/hantavirus-freshness.test.ts',
];
const OLD_ROUTES = ['oscour-sos', 'departmental', 'epidemiology', 'epidemic-alerts', 'epidemiology-monitor', 'sentinelles', 'sentinelles-ingestion', 'hantavirus', 'apl'];
const NEW_ROUTES = ['syndromic', 'alert-levels', 'sentinelles-national', 'wastewater', 'international', 'dgs-messages', 'drug-shortages', 'recalls'];

describe('retraits Santé (spec 2026-10-03 § 2.9)', () => {
  it('fichiers retirés', () => {
    for (const f of REMOVED_FILES) expect(existsSync(at(f)), f).toBe(false);
  });
  it('routes : les neuf anciennes retirées, les huit de la phase A servies', () => {
    const routes = read('api/_routes.js');
    for (const r of OLD_ROUTES) expect(routes).not.toContain(`'/api/health/${r}'`);
    for (const r of NEW_ROUTES) expect(routes).toContain(`'/api/health/${r}'`);
  });
  it('dev : plus de miroir santé ; plus de script de l’ancien instantané APL', () => {
    expect(read('vite.config.ts')).not.toContain('healthProxyPlugin');
    expect(read('package.json')).not.toContain('generate:apl-snapshot');
  });
  it('types : anciens types santé retirés, contrats de la phase A gardés', () => {
    const types = read('src/types/index.ts');
    for (const gone of ['ISSLevel', 'ISS_LEVELS', 'APLCategory', 'APL_LEVELS', 'OSCOUR_LEVELS', 'HealthDataSource', 'HealthDepartmentMetric',
      'HealthRegionMetric', 'HealthFeatures', 'LegacySentinellesIndicator', 'AlerteEpidemique', 'StatutEpidemique', 'PathologieEpidemique',
      'HantavirusEvent', 'HantavirusSource', 'TerritoireNiveau', 'HeatmapPoint']) {
      expect(types).not.toMatch(new RegExp(`\\b${gone}\\b`));
    }
    for (const kept of ['interface SyndromicResponse', 'interface AlertLevelsResponse', 'interface SentinellesIndicator', 'interface DrugShortagesV2',
      'interface AplDataset', 'interface HospitalsDataset', 'type DataFreshness']) {
      expect(types).toContain(kept);
    }
    expect(types).not.toContain('tâche 19');
  });
  it('ANSM : réponse réduite aux champs DrugShortagesV2', () => {
    const ansm = read('api/_handlers/health/drug-shortages.js');
    expect(ansm).not.toMatch(/const shortages\b|\bshortages,|last_update|metadata|historicStatus|'normalisation'|tâche 19/);
  });
  it('styles : pastille du baromètre et mentions des anciens panneaux retirées', () => {
    const css = read('src/styles/main.css');
    expect(css).not.toContain('barometer-fab');
    expect(css).not.toContain('--v2-switcher-bottom');
    expect(css).not.toMatch(/NationalHealthPanel|HealthBarometerPanel/);
    expect(read('src/App.ts')).not.toMatch(/--v2-switcher-bottom|Baromètre Santé/);
  });
  it('code mort : opensModulePanel et l’étiquette « SPF / DREES » retirés', () => {
    expect(read('src/services/ui-mode.ts')).not.toContain('opensModulePanel');
    expect(read('src/components/deckgl/format-utils.ts')).not.toContain('SPF / DREES');
  });
  it('hantavirus : zones historiques gardées en configuration, épisode 2026 (établissements, navire) retiré', () => {
    const cfg = read('src/config/hantavirus.ts');
    expect(cfg).toContain('HANTAVIRUS_HISTORICAL_DEPARTMENTS');
    expect(cfg).toContain('HANTAVIRUS_HISTORICAL_REFERENCE');
    expect(cfg).not.toMatch(/HANTAVIRUS_NAVIRES|HANTAVIRUS_REFERENCE_FACILITIES|resolveHantavirusTerritoryCenter|Hondius/);
  });
});
