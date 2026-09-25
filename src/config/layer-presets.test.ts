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

  it('layersForPreset("general") active une couche phare par thème', () => {
    const result = layersForPreset('general');
    for (const key of ['news', 'powerGrid', 'military', 'health', 'environmental'] as const) {
      assert.equal(result[key], true, `${key} devrait être actif`);
    }
    assert.equal(result.cyber, false);
    assert.equal(result.fires, false);
    assert.equal(result.nuclearFleet, false);
  });

  it('layersForPreset("energy") active tout le thème énergie (DROM et charge métropolitaine compris)', () => {
    const result = layersForPreset('energy');
    for (const key of ['dromEnergy', 'powerGrid', 'nuclearFleet', 'gasNetwork', 'hydroBackbone', 'oilNetwork', 'windMonitor', 'metroLoad', 'outagesElec'] as const) {
      assert.equal(result[key], true, `${key} devrait être actif`);
    }
    assert.equal(result.news, false);
    assert.equal(result.military, false);
  });

  it('layersForPreset("security") active tout le thème sécurité & défense sans toucher santé', () => {
    const result = layersForPreset('security');
    for (const key of ['news', 'stability', 'military', 'cyber', 'subseaCables', 'outagesTelecom', 'outagesInternet', 'outagesCloud'] as const) {
      assert.equal(result[key], true, `${key} devrait être actif`);
    }
    assert.equal(result.health, false);
    assert.equal(result.hospitals, false);
  });

  it('layersForPreset("health") active tout le thème santé', () => {
    const result = layersForPreset('health');
    for (const key of ['health', 'healthOscour', 'healthApl', 'hospitals'] as const) {
      assert.equal(result[key], true, `${key} devrait être actif`);
    }
    assert.equal(result.powerGrid, false);
  });

  it('layersForPreset("environment") active tout le thème environnement & transports', () => {
    const result = layersForPreset('environment');
    for (const key of ['environmental', 'weatherRadar', 'fires', 'dayNight', 'trafficRoad', 'trafficMaritime', 'trafficAir', 'trafficRail'] as const) {
      assert.equal(result[key], true, `${key} devrait être actif`);
    }
    assert.equal(result.powerGrid, false);
  });

  it('les quatre thèmes sont complets : chaque couche appartient à exactement un thème', () => {
    const themed = LAYER_PRESETS.filter((p) => p.id !== 'general').flatMap((p) => p.layers);
    assert.deepEqual([...themed].sort(), [...ALL_PRESETABLE_LAYER_KEYS].sort());
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
