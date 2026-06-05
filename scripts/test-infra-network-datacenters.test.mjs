import test from 'node:test';
import assert from 'node:assert/strict';

import { mergeDatacenters } from '../api/_shared/infra-network-datacenters.js';

test('mergeDatacenters normalizes official IDF datacenters and keeps static national backbone', () => {
  const staticDatacenters = [
    {
      id: 'ovh-rbx',
      name: 'OVH Roubaix',
      provider: 'OVH',
      region: 'Roubaix',
      coordinates: [3.17, 50.694],
    },
    {
      id: 'scw-par',
      name: 'Scaleway Paris',
      provider: 'Scaleway',
      region: 'Paris',
      coordinates: [2.359, 48.863],
    },
  ];

  const providerStatus = {
    OVH: { status: 'operational', incidents: [] },
    Scaleway: { status: 'degraded', incidents: [{ title: 'Latency', severity: 'minor', startedAt: '2026-06-05T00:00:00.000Z' }] },
  };

  const officialIdfDatacenters = [
    {
      id_dc: 8,
      nom: 'DATA4 DC01',
      nom_site: 'PAR1',
      operateur: 'DATA4 Group',
      nom_com: 'Marcoussis',
      adresse: 'Route de Nozay, 91460 Marcoussis',
      etat_av: 'en exploitation',
      bornes_mw: 'entre 40 et 100 MW',
      coordinates: [2.231884, 48.635492],
    },
    {
      id_dc: 42,
      nom: 'Scaleway DC5',
      nom_site: 'DC5',
      operateur: 'Scaleway',
      nom_com: 'Saint-Ouen-l\'Aumone',
      adresse: '1 avenue du fond de vaux',
      etat_av: 'en construction',
      bornes_mw: 'entre 10 et 40 MW',
      coordinates: [2.10234, 49.04678],
    },
  ];

  const merged = mergeDatacenters({
    staticDatacenters,
    officialIdfDatacenters,
    providerStatus,
    now: '2026-06-05T07:30:00.000Z',
  });

  assert.equal(merged.length, 3);

  const data4 = merged.find((dc) => dc.id === 'idf-8');
  assert.ok(data4);
  assert.equal(data4.provider, 'DATA4 Group');
  assert.equal(data4.region, 'Marcoussis');
  assert.equal(data4.status, 'unknown');
  assert.equal(data4.operationalState, 'en exploitation');
  assert.equal(data4.powerBand, 'entre 40 et 100 MW');
  assert.equal(data4.source, 'data.gouv.fr DRIEAT IDF WFS');
  assert.deepEqual(data4.coordinates, [2.231884, 48.635492]);

  const scaleway = merged.find((dc) => dc.id === 'idf-42');
  assert.ok(scaleway);
  assert.equal(scaleway.status, 'degraded');
  assert.equal(scaleway.incidents.length, 1);
  assert.equal(scaleway.operationalState, 'en construction');

  assert.ok(!merged.some((dc) => dc.id === 'scw-par'));
  assert.ok(merged.some((dc) => dc.id === 'ovh-rbx'));
});
