import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import {
  ALL_PRESETABLE_LAYER_KEYS,
  DEFAULT_PRESET_ID,
  LAYER_PRESETS,
  layersForPreset,
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
  it('expose exactement 5 vues nommées', () => {
    const ids = LAYER_PRESETS.map((p) => p.id).sort();
    assert.deepEqual(ids, ['energy', 'environment', 'general', 'health', 'security'].sort());
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

  it('layersForPreset("general") active uniquement news/powerGrid/environmental', () => {
    const result = layersForPreset('general');
    assert.equal(result.news, true);
    assert.equal(result.powerGrid, true);
    assert.equal(result.environmental, true);
    assert.equal(result.military, false);
    assert.equal(result.cyber, false);
    assert.equal(result.fires, false);
  });

  it('layersForPreset("energy") active le jeu énergie attendu', () => {
    const result = layersForPreset('energy');
    for (const key of ['powerGrid', 'nuclearFleet', 'gasNetwork', 'oilNetwork', 'windMonitor', 'hydroBackbone', 'outagesElec'] as const) {
      assert.equal(result[key], true, `${key} devrait être actif`);
    }
    assert.equal(result.news, false);
    assert.equal(result.military, false);
  });

  it('layersForPreset("security") active défense/cyber/télécom sans toucher santé', () => {
    const result = layersForPreset('security');
    for (const key of ['news', 'military', 'cyber', 'subseaCables', 'outagesTelecom', 'outagesInternet'] as const) {
      assert.equal(result[key], true, `${key} devrait être actif`);
    }
    assert.equal(result.health, false);
    assert.equal(result.hospitals, false);
  });

  it('layersForPreset("health") active le jeu santé attendu', () => {
    const result = layersForPreset('health');
    for (const key of ['health', 'healthOscour', 'healthApl', 'hospitals'] as const) {
      assert.equal(result[key], true, `${key} devrait être actif`);
    }
    assert.equal(result.powerGrid, false);
  });

  it('layersForPreset("environment") active le jeu environnement/transports attendu', () => {
    const result = layersForPreset('environment');
    for (const key of ['environmental', 'weatherRadar', 'fires', 'trafficRoad', 'trafficRail'] as const) {
      assert.equal(result[key], true, `${key} devrait être actif`);
    }
    assert.equal(result.trafficAir, false);
    assert.equal(result.trafficMaritime, false);
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
