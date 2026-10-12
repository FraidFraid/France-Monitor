import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import {
  ALL_PRESETABLE_LAYER_KEYS,
  DEFAULT_PRESET_ID,
  LAYER_PRESETS,
  THEME_LAYERS,
  hasPersistedLayers,
  presetShowsEvents,
  layersForPreset,
  migrateStoredLayers,
  themeLayers,
  v2StartupLayers,
  type LayerPresetId,
} from './layer-presets.ts';

const GROUP_KEYS = new Set([
  'newsGroup',
  'energySystems',
  'traffic',
  'sovereignty',
  'outages',
  'environmentGroup',
]);

describe('layer-presets', () => {
  it('expose exactement 6 vues nommées, dans l’ordre de la barre des thèmes', () => {
    assert.deepEqual(LAYER_PRESETS.map((p) => p.id), ['general', 'energy', 'security', 'health', 'environment', 'transport']);
  });

  it("n'inclut jamais une clé de groupe dans les couches d'une vue", () => {
    for (const preset of LAYER_PRESETS) {
      for (const key of preset.layers) {
        assert.equal(GROUP_KEYS.has(key), false, `${preset.id} ne doit pas référencer le groupe ${key}`);
      }
    }
  });

  it('DEFAULT_PRESET_ID pointe vers une vue existante', () => {
    assert.equal(DEFAULT_PRESET_ID, 'general');
    assert.ok(LAYER_PRESETS.some((p) => p.id === DEFAULT_PRESET_ID));
  });

  it('chaque couche appartient à exactement un thème', () => {
    const themed = Object.values(THEME_LAYERS).flat();
    assert.deepEqual([...themed].sort(), [...ALL_PRESETABLE_LAYER_KEYS].sort());
  });

  it('une vue thématique ne coche que des couches de son thème, 3 à 5 au plus (noyau essentiel)', () => {
    for (const preset of LAYER_PRESETS) {
      if (preset.id === 'general') continue;
      const theme = new Set(THEME_LAYERS[preset.id]);
      for (const key of preset.layers) assert.ok(theme.has(key), `${preset.id} : ${key} hors du thème`);
      assert.ok(preset.layers.length >= 3 && preset.layers.length <= 5, `${preset.id} : ${preset.layers.length} couches`);
    }
  });

  it('« Vue générale » : seulement des couches vides quand tout va bien, jamais une infrastructure toujours affichée', () => {
    const general = LAYER_PRESETS.find((p) => p.id === 'general');
    assert.deepEqual(general?.layers, ['environmental', 'floods', 'fires', 'outagesInternet']);
    assert.equal(general?.events, true);
    for (const key of ['news', 'stability', 'powerGrid', 'nuclearFleet', 'gasNetwork', 'military', 'health', 'hospitals', 'outagesElec', 'outagesTelecom', 'trafficRoad'] as const) {
      assert.equal(layersForPreset('general')[key], false, key);
    }
  });

  it('noyaux des thèmes (décision du 12/10/2026)', () => {
    const layersOf = (id: LayerPresetId) => LAYER_PRESETS.find((p) => p.id === id)?.layers;
    assert.deepEqual(layersOf('energy'), ['powerGrid', 'nuclearFleet', 'gasNetwork', 'oilNetwork', 'outagesElec']);
    assert.deepEqual(layersOf('security'), ['military', 'cyber', 'outagesTelecom', 'outagesInternet']);
    assert.deepEqual(layersOf('health'), ['health', 'healthOscour', 'hospitals']);
    assert.deepEqual(layersOf('environment'), ['environmental', 'floods', 'weatherRadar', 'fires', 'airQuality']);
    assert.deepEqual(layersOf('transport'), ['trafficRoad', 'trafficRail', 'trafficMaritime', 'trafficAir']);
  });

  it('« Événements en cours » : cochée par Vue générale et Sécurité & défense seulement', () => {
    const withEvents = LAYER_PRESETS.filter((p) => p.events).map((p) => p.id);
    assert.deepEqual(withEvents, ['general', 'security']);
    assert.deepEqual(LAYER_PRESETS.filter((p) => presetShowsEvents(p.id)).map((p) => p.id), ['general', 'security']);
  });

  it('remet toujours à false toutes les clés enfant hors de la vue sélectionnée', () => {
    for (const preset of LAYER_PRESETS) {
      const result = layersForPreset(preset.id as LayerPresetId);
      const active = new Set(preset.layers);
      for (const key of ALL_PRESETABLE_LAYER_KEYS) {
        assert.equal(result[key], active.has(key), `${preset.id}: ${key}`);
      }
    }
  });

  it('un identifiant de vue inconnu retourne tout à false', () => {
    // @ts-expect-error — vérifie le comportement défensif hors du système de types.
    const result = layersForPreset('unknown');
    for (const key of ALL_PRESETABLE_LAYER_KEYS) {
      assert.equal(result[key], false);
    }
  });
});

describe('couches v2 (spec 2026-09-29 § 5)', () => {
  it('une nouvelle visite v2 démarre sur « Vue générale »', () => {
    assert.deepEqual(v2StartupLayers(), { events: true, environmental: true, floods: true, fires: true, outagesInternet: true });
  });

  it('v2 : chaque vue coche ou décoche « Événements en cours »', () => {
    assert.equal(themeLayers(true, 'general').events, true);
    assert.equal(themeLayers(true, 'security').events, true);
    for (const id of ['energy', 'health', 'environment', 'transport'] as const) assert.equal(themeLayers(true, id).events, false, id);
  });

  it('v1 : les vues ne touchent pas « Événements en cours » (couche absente de la v1)', () => {
    assert.deepEqual(themeLayers(false, 'general'), layersForPreset('general'));
    assert.equal('events' in themeLayers(false, 'security'), false);
  });
});

describe('migration de l’état mémorisé (Vigilance météo et Crues séparées, Jour / Nuit retiré)', () => {
  it('ancien état { environmental: true } : Vigilance météo et Crues actives', () => {
    assert.deepEqual(migrateStoredLayers({ environmental: true, news: false }), { environmental: true, news: false, floods: true });
  });
  it('ancien état environmental éteint : Crues éteintes ; état récent : clé floods gardée telle quelle', () => {
    assert.equal(migrateStoredLayers({ environmental: false }).floods, false);
    assert.equal(migrateStoredLayers({ environmental: true, floods: false }).floods, false);
  });
  it('{ dayNight: true } seul : clé supprimée, donc aucune couche active et premier chargement (vue d’accueil)', () => {
    const migrated = migrateStoredLayers({ dayNight: true });
    assert.deepEqual(migrated, {});
    assert.equal(hasPersistedLayers(migrated), false);
  });
});

describe('hasPersistedLayers (un rechargement garde la couche Événements seule)', () => {
  it('events seul : vrai', () => assert.equal(hasPersistedLayers({ events: true, environmental: false }), true));
  it('tout éteint (events compris) : faux', () => assert.equal(hasPersistedLayers({ events: false, environmental: false, news: false }), false));
  it('null : faux', () => assert.equal(hasPersistedLayers(null), false));
  it('une couche des vues active : vrai', () => assert.equal(hasPersistedLayers({ powerGrid: true }), true));
});
