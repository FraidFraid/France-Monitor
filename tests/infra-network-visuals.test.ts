import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { getDatacenterVisualMeta, normalizeOperationalState } from '../src/utils/infra-network-visuals.js';

describe('src/utils/infra-network-visuals', () => {
  it('normalizeOperationalState standardizes official lifecycle labels', () => {
    assert.equal(normalizeOperationalState('En PROJET'), 'en projet');
    assert.equal(normalizeOperationalState(' en construction '), 'en construction');
    assert.equal(normalizeOperationalState('En exploitation'), 'en exploitation');
  });

  it('getDatacenterVisualMeta prioritizes project lifecycle colors over provider status', () => {
    const fastTrackMeta = getDatacenterVisualMeta({ status: 'operational', operationalState: 'fast-track' });
    const projectMeta = getDatacenterVisualMeta({ status: 'operational', operationalState: 'en projet' });
    const buildMeta = getDatacenterVisualMeta({ status: 'outage', operationalState: 'en construction' });
    const existingMeta = getDatacenterVisualMeta({ status: 'unknown', operationalState: 'site existant' });
    const liveMeta = getDatacenterVisualMeta({ status: 'degraded', operationalState: 'en exploitation' });

    assert.equal(fastTrackMeta.color, '#9C27B0');
    assert.equal(fastTrackMeta.label, 'Fast-track');
    assert.equal(projectMeta.color, '#EAB308');
    assert.equal(projectMeta.label, 'En projet');
    assert.equal(buildMeta.color, '#F97316');
    assert.equal(buildMeta.label, 'En construction');
    assert.equal(existingMeta.color, '#60A5FA');
    assert.equal(existingMeta.label, 'Site existant');
    assert.equal(liveMeta.color, '#3B82F6');
    assert.equal(liveMeta.label, 'Dégradé');
  });
});
