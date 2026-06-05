import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSnapshot, buildActiveClusterTemplates } from '../api/health/hantavirus.js';

test('buildSnapshot defaults align with latest official hantavirus baseline', () => {
  const snapshot = buildSnapshot();

  assert.equal(snapshot.asOf, '2026-05-26T00:00:00.000Z');
  assert.equal(snapshot.franceConfirmedCases, 1);
  assert.equal(snapshot.franceContactsMonitored, 25);
  assert.equal(snapshot.globalConfirmed, 11);
  assert.equal(snapshot.globalProbable, 2);
  assert.equal(snapshot.deaths, 3);
});

test('buildActiveClusterTemplates uses the refreshed official fallback counts', () => {
  const events = buildActiveClusterTemplates();
  const shipCluster = events.find((event) => event.id === 'hanta-cluster-hondius');
  const franceContacts = events.find((event) => event.id === 'hanta-france-contact-monitoring');

  assert.ok(shipCluster);
  assert.equal(shipCluster.reportedCounts.confirmed, 11);
  assert.equal(shipCluster.reportedCounts.probable, 2);

  assert.ok(franceContacts);
  assert.equal(franceContacts.reportedCounts.contacts, 25);
});
