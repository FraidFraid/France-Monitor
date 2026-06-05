import test from 'node:test';
import assert from 'node:assert/strict';

import { getDatacenterVisualMeta, normalizeOperationalState } from '../src/utils/infra-network-visuals.js';

test('normalizeOperationalState standardizes official lifecycle labels', () => {
  assert.equal(normalizeOperationalState('En PROJET'), 'en projet');
  assert.equal(normalizeOperationalState(' en construction '), 'en construction');
  assert.equal(normalizeOperationalState('En exploitation'), 'en exploitation');
});

test('getDatacenterVisualMeta prioritizes project lifecycle colors over provider status', () => {
  const projectMeta = getDatacenterVisualMeta({ status: 'operational', operationalState: 'en projet' });
  const buildMeta = getDatacenterVisualMeta({ status: 'outage', operationalState: 'en construction' });
  const liveMeta = getDatacenterVisualMeta({ status: 'degraded', operationalState: 'en exploitation' });

  assert.equal(projectMeta.color, '#EAB308');
  assert.equal(projectMeta.label, 'En projet');
  assert.equal(buildMeta.color, '#F97316');
  assert.equal(buildMeta.label, 'En construction');
  assert.equal(liveMeta.color, '#3B82F6');
  assert.equal(liveMeta.label, 'Dégradé');
});
