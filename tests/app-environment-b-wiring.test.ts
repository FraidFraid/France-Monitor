// tests/app-environment-b-wiring.test.ts
// Câblage des couches de la phase B dans App.ts (contrats § 4.4 ; spec 2026-10-04 environnement § 3, § 5). App.ts ne s'instancie pas
// sous vitest : ces tests lisent sa source, comme tests/app-traffic-panels-wiring.test.ts.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ENVIRONMENT_ALWAYS_POLLED, ENVIRONMENT_LAYER_KEYS, ENVIRONMENT_LAYER_SOURCES, ENVIRONMENT_POLL_MS, hasActiveEnvironment,
} from '../src/config/environment-sources.ts';
import { ALL_PRESETABLE_LAYER_KEYS, LAYER_PRESETS } from '../src/config/layer-presets.ts';
import { DROUGHT_TTL_MS } from '../src/services/environment-drought.ts';
import { AIR_QUALITY_TTL_MS } from '../src/services/environment-air.ts';
import { EARTHQUAKES_TTL_MS } from '../src/services/environment-earthquakes.ts';
import { ENV_LAYER_KEYS } from '../src/components/deckgl/environment-map.ts';
import { ENV_B_LAYER_KEYS } from '../src/components/deckgl/environment-map-b.ts';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../src/App.ts');
const css = read('../src/styles/main.css');
const layerPanel = read('../src/components/LayerPanel.ts');
const urlState = read('../src/utils/urlState.ts');
const feed = read('../src/components/UnderMapNewsFeed.ts');
const quality = read('../src/services/sources-quality-dashboard.ts');
const vigilancePanel = read('../src/components/VigilancePanel.ts');

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

const PANELS = [
  ['drought', 'Sécheresse', 'sun', 'droughtPanel', 'ensureDroughtPanel', 'drought-panel-modal', 'loadDrought()', 'currentDrought', 'DROUGHT_LEGEND', 'SÉCHERESSE'],
  ['airQuality', 'Qualité de l’air', 'cloud', 'airQualityPanel', 'ensureAirQualityPanel', 'air-panel-modal', 'loadAirQuality()', 'currentAirQuality', 'AIR_QUALITY_LEGEND', 'QUALITÉ DE L’AIR'],
  ['earthquakes', 'Séismes', 'activity', 'earthquakesPanel', 'ensureEarthquakesPanel', 'quakes-panel-modal', 'loadEarthquakes()', 'currentEarthquakes', 'EARTHQUAKES_LEGEND', 'SÉISMES'],
] as const;

describe('liste de câblage des couches (contrats § 4.4) pour drought, airQuality, earthquakes', () => {
  it('groupe Environnement (normalizeLayerState, _syncGroupFlags, getEffectiveLayers par la constante commune), syncTrafficGroupState intact, onLayerToggle', () => {
    for (const key of ['drought', 'airQuality', 'earthquakes'] as const) expect(hasActiveEnvironment({ [key]: true })).toBe(true);
    for (const m of ['normalizeLayerState', '_syncGroupFlags', 'getEffectiveLayers']) expect(methodBody(m)).toContain('hasActiveEnvironment(');
    expect(methodBody('syncTrafficGroupState')).not.toMatch(/drought|airQuality|earthquakes/);
    expect(methodBody('onLayerToggle')).toContain('this.refreshEnvironmentLegend();');
  });
  it('clés : type, DEFAULT_LAYERS, objet complet du fil d’actualités, URL, vues de couches, restauration', () => {
    expect(ENVIRONMENT_LAYER_KEYS).toEqual(['environmental', 'floods', 'weatherRadar', 'fires', 'drought', 'airQuality', 'earthquakes']);
    expect(app).toMatch(/const DEFAULT_LAYERS[^]*?drought: false,[^]*?airQuality: false,[^]*?earthquakes: false,/);
    for (const key of ['drought', 'airQuality', 'earthquakes']) {
      expect(feed).toContain(`${key}: false,`);
      expect(urlState).toContain(`'${key}'`);
      expect(ALL_PRESETABLE_LAYER_KEYS).toContain(key);
      expect(LAYER_PRESETS.find((p) => p.id === 'environment')?.layers).toContain(key);
    }
    expect(methodBody('restoreActiveLayerPanelsAfterRefresh')).toContain("'fires',\n      'drought',\n      'airQuality',\n      'earthquakes',");
    expect(LAYER_PRESETS.find((p) => p.id === 'environment')?.description).toContain('sécheresse, qualité de l’air, séismes');
  });
  it('panneaux flottants, couches de la légende, tiroir des couches (sans badge LIVE), carte', () => {
    for (const [id, label, icon, , , , , , legend, drawer] of PANELS) {
      expect(app).toContain(`{ id: '${id}', label: '${label}', icon: '${icon}', layerKeys: ['${id}'] }`);
      expect(app).toMatch(new RegExp(`id: '${id}',\\s*groupId: 'environment',\\s*role: 'child',\\s*dependsOnGroup: true,\\s*label: '${drawer}',\\s*legend: ${legend},`));
      expect(layerPanel).toContain(`{ key: '${id}', label: '${drawer}', icon: fmIcon('${icon}'), sublayerOf: 'environmentGroup' }`);
      expect(ENV_LAYER_KEYS[id]).toEqual(ENV_B_LAYER_KEYS[id]);
    }
    expect(layerPanel).toMatch(/this\.helpItem\(fmIcon\('sun'\), 'Sécheresse', '[^']*'\)/);
    expect(layerPanel).toMatch(/this\.helpItem\(fmIcon\('cloud'\), 'Qualité de l’air', '[^']*'\)/);
    expect(layerPanel).toMatch(/this\.helpItem\(fmIcon\('activity'\), 'Séismes', '[^']*'\)/);
  });
  it('création paresseuse, instance, ouverture, lecture de la source ; croix qui éteint la couche', () => {
    for (const [id, , , field, ensure, , load, current] of PANELS) {
      expect(methodBody('ensureLazyPanelForLayer')).toContain(`case '${id}': return [this.${ensure}()];`);
      expect(methodBody('getFloatingPanelInstance')).toContain(`case '${id}': return this.${field};`);
      expect(methodBody('openEnvironmentPanel')).toContain(`case '${id}': this.${field}?.show(this.${current}); break;`);
      expect(methodBody('loadEnvironmentSource')).toContain(`case '${id}': return this.${load};`);
      expect(methodBody(ensure)).toContain(`this.closeEnvironmentLayer('${id}')`);
      expect(methodBody(ensure)).toContain(`panel.show(this.${current})`);
    }
    expect(methodBody('loadEnvironmentSource')).toContain("case 'environmental': return this.loadVigilanceAndSeaLevels();");
    expect(methodBody('ensureDroughtPanel')).toMatch(/if \(this\.mapContainer\?\.canFocusMap\(\)\) panel\.setOnFocusDepartment\(/);
    expect(methodBody('ensureEarthquakesPanel')).toMatch(/if \(this\.mapContainer\?\.canFocusMap\(\)\) panel\.setOnFocusQuake\(/);
    expect(methodBody('ensureVigilancePanel')).toContain('panel.setOnFocusGauge((id) => this.focusGauge(id));');
  });
  it('relèves : sécheresse 60 min, air 30 min, séismes 10 min ; air et séismes sans arrêt (situations), sécheresse jamais (E2) ; caches plus courts', () => {
    expect([ENVIRONMENT_POLL_MS.drought, ENVIRONMENT_POLL_MS.airQuality, ENVIRONMENT_POLL_MS.earthquakes]).toEqual([3_600_000, 1_800_000, 600_000]);
    expect([...ENVIRONMENT_ALWAYS_POLLED]).toEqual(expect.arrayContaining(['airQuality', 'earthquakes']));
    expect(ENVIRONMENT_ALWAYS_POLLED.has('drought')).toBe(false);
    expect(DROUGHT_TTL_MS).toBeLessThan(ENVIRONMENT_POLL_MS.drought);
    expect(AIR_QUALITY_TTL_MS).toBeLessThan(ENVIRONMENT_POLL_MS.airQuality);
    expect(EARTHQUAKES_TTL_MS).toBeLessThan(ENVIRONMENT_POLL_MS.earthquakes);
    expect(ENVIRONMENT_LAYER_SOURCES.drought).toEqual(['VigiEau']);
    expect(ENVIRONMENT_LAYER_SOURCES.airQuality).toEqual(['Atmo France']);
    expect(ENVIRONMENT_LAYER_SOURCES.earthquakes).toEqual(['BCSF-RéNaSS']);
    const secondary = methodBody('loadSecondaryLayers');
    expect(secondary).toContain("name: 'air-quality', task: this.loadAirQuality()");
    expect(secondary).toContain("name: 'earthquakes', task: this.loadEarthquakes()");
    expect(secondary).not.toContain('loadDrought');
  });
  it('chargeurs : même forme que ceux de la tâche 16 (services importés, readEnvironment, fusion à l’écriture, panneau, carte, légendes et historique communs, source datée par la donnée), jamais new Date()', () => {
    const loaders: Array<[string, string, string[]]> = [
      ['loadDrought', "from './services/environment-drought.ts';", ["this.readEnvironment('drought',", 'const incoming = await fetchDrought(this.currentDrought);',
        'this.currentDrought = mergeDrought(this.currentDrought, incoming);', 'this.droughtPanel?.update(this.currentDrought);',
        'this.mapContainer?.updateDroughtLayer(data, now)', "this.statusPanel?.updateSource('VigiEau', droughtStatus(this.currentDrought, now));"]],
      ['loadAirQuality', "from './services/environment-air.ts';", ["this.readEnvironment('airQuality',", 'const incoming = await fetchAirQuality(this.currentAirQuality);',
        'this.currentAirQuality = mergeAirQuality(this.currentAirQuality, incoming);', 'this.airQualityPanel?.update(this.currentAirQuality);',
        'this.mapContainer?.updateAirQualityLayer(data, now)', "this.statusPanel?.updateSource('Atmo France', airQualityStatus(this.currentAirQuality, now));",
        'this.refreshFranceIntelPanel();']],
      ['loadEarthquakes', "from './services/environment-earthquakes.ts';", ["this.readEnvironment('earthquakes',", 'const incoming = await fetchEarthquakes(this.currentEarthquakes);',
        'this.currentEarthquakes = mergeEarthquakes(this.currentEarthquakes, incoming);', 'this.earthquakesPanel?.update(this.currentEarthquakes);',
        'this.mapContainer?.updateEarthquakesLayer(data, now);', "this.statusPanel?.updateSource('BCSF-RéNaSS', earthquakesStatus(this.currentEarthquakes, now));",
        'this.refreshFranceIntelPanel();']],
      ['loadSeaLevels', "from './services/environment-sea-levels.ts';", ["dedupe('environment:seaLevels',", 'const incoming = await fetchSeaLevels(this.currentSeaLevels);',
        'this.currentSeaLevels = mergeSeaLevels(this.currentSeaLevels, incoming);',
        'this.vigilancePanel?.update({ vigilance: this.currentVigilance, seaLevels: this.currentSeaLevels });',
        'this.mapContainer?.updateSeaLevelsLayer(data, this.currentVigilance?.vigilance.data ?? null, now);',
        "this.statusPanel?.updateSource('Marégraphes SHOM', seaLevelsStatus(this.currentSeaLevels, now));"]],
    ];
    for (const [method, imp, parts] of loaders) {
      expect(app).toContain(imp);
      const body = methodBody(method);
      for (const p of parts) expect(body).toContain(p);
      expect(body).toContain('this.refreshEnvironmentLegend();');
      expect(body).toContain('this.recordEnvironmentSamples(now);');
      expect(body).not.toContain('new Date()');
      expect(body).not.toMatch(/import\('\.\/services\/environment-|mapLegend\??\.addCategory|recordStatusSamples\(/);
      expect(body).not.toMatch(/merge\w+\(this\.current\w+, await/);
    }
    expect(methodBody('loadDrought')).not.toContain('refreshFranceIntelPanel');
    const legend = methodBody('refreshEnvironmentLegend');
    for (const fn of ['droughtLegend(', 'airQualityLegend(', 'earthquakesLegend(', 'withTideGauges(']) expect(legend).toContain(fn);
  });
  it('marégraphes : lus avec la vigilance si la couche est active ou le panneau ouvert ; légende de la vigilance complétée', () => {
    expect(methodBody('seaLevelsWanted')).toContain('this.activeLayers.environmental || (this.vigilancePanel?.isVisible() ?? false)');
    const both = methodBody('loadVigilanceAndSeaLevels');
    expect(both).toContain('this.loadVigilance()');
    expect(both).toContain('this.seaLevelsWanted()');
    expect(methodBody('refreshEnvironmentLegend')).toContain('this.currentSeaLevels ? withTideGauges(vigilance, this.currentSeaLevels.seaLevels.data, now) : vigilance');
    expect(methodBody('loadVigilance')).toContain('if (this.currentSeaLevels) this.mapContainer?.updateSeaLevelsLayer(this.currentSeaLevels.seaLevels.data, data, now);');
  });
  it('marégraphes : une lecture qui lève garde les données, nomme l’échec dans le panneau (jamais « Chargement… » sans fin)', () => {
    const load = methodBody('loadSeaLevels');
    const failure = load.slice(load.indexOf('} catch (err) {'));
    expect(failure).toContain('seaLevels: { data: previous?.data ?? null, fetchedAt: previous?.fetchedAt ?? null, error }');
    expect(failure).toContain('this.vigilancePanel?.update({ vigilance: this.currentVigilance, seaLevels: this.currentSeaLevels });');
  });
  it('panneau des sources : clic sur les quatre lignes de la phase B ; panneau associé', () => {
    const click = methodBody('handleSourcePanelClick');
    expect(click).toContain("void this.ensureDroughtPanel().then(() => this.openEnvironmentPanel('drought'));");
    expect(click).toContain("void this.ensureAirQualityPanel().then(() => this.openEnvironmentPanel('airQuality'));");
    expect(click).toContain("void this.ensureEarthquakesPanel().then(() => this.openEnvironmentPanel('earthquakes'));");
    expect(click).toContain("void this.ensureVigilancePanel().then(() => this.openEnvironmentPanel('environmental'));");
    for (const [name, key] of [['VigiEau', 'drought'], ['Atmo France', 'airQuality'], ['BCSF-RéNaSS', 'earthquakes'], ['Marégraphes SHOM', 'environmental']]) {
      expect(app).toContain(`'${name}': '${key}',`);
      expect(quality).toContain(`watchdogNames: ['${name}']`);
    }
  });
  it('coquille Vigilance : marégraphes facultatifs, gardés quand un appel ne les donne pas', () => {
    expect(vigilancePanel).toContain('seaLevels?: SeaLevelsState | null');
    expect(vigilancePanel).toContain('seaLevels: this.state?.seaLevels?.seaLevels.data ?? null');
    expect(vigilancePanel).toContain('setOnFocusGauge(handler: (id: number) => void): void');
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
