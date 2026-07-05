import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { mergeDatacenters } from '../api/_shared/infra-network-datacenters.js';

describe('api/_shared/infra-network-datacenters · mergeDatacenters', () => {
  it('normalizes official IDF datacenters and keeps static national backbone', () => {
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
      osmDatacenters: [],
      manualDatacenters: [],
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

  it('folds national OSM backbone and removes duplicate static sites', () => {
    const merged = mergeDatacenters({
      staticDatacenters: [
        {
          id: 'ovh-sbg',
          name: 'OVH Strasbourg',
          provider: 'OVH',
          region: 'Strasbourg',
          city: 'Strasbourg',
          address: '',
          coordinates: [7.75, 48.574],
        },
        {
          id: 'cf-par',
          name: 'Cloudflare Paris',
          provider: 'Cloudflare',
          region: 'Paris',
          city: 'Paris',
          address: '',
          coordinates: [2.36, 48.86],
        },
      ],
      officialIdfDatacenters: [],
      providerStatus: {
        OVH: { status: 'operational', incidents: [] },
        Cloudflare: { status: 'degraded', incidents: [{ title: 'PoP issue', severity: 'minor', startedAt: '2026-06-08T00:00:00.000Z' }] },
      },
      osmDatacenters: [
        {
          id: 'osm-way-1',
          name: 'OVH Strasbourg',
          provider: 'OVH',
          region: 'Strasbourg',
          city: 'Strasbourg',
          address: '1 rue du Havre',
          coordinates: [7.7504, 48.5741],
        },
        {
          id: 'osm-way-2',
          name: 'Marseille MRS Campus',
          provider: 'Digital Realty',
          region: 'Marseille',
          city: 'Marseille',
          address: '13015 Marseille',
          coordinates: [5.347, 43.338],
        },
      ],
      manualDatacenters: [],
      now: '2026-06-08T09:00:00.000Z',
    });

    assert.equal(merged.filter((dc) => dc.provider === 'OVH').length, 1);
    assert.ok(merged.some((dc) => dc.id === 'osm-way-2' && dc.source === 'OpenStreetMap France datacenters snapshot'));
    assert.ok(merged.some((dc) => dc.id === 'cf-par'));
    assert.ok(!merged.some((dc) => dc.id === 'osm-way-1' && dc.region === 'Paris'));
  });

  it('prioritizes national project layer over overlapping OSM existing site', () => {
    const merged = mergeDatacenters({
      staticDatacenters: [],
      officialIdfDatacenters: [],
      providerStatus: {},
      manualDatacenters: [],
      osmDatacenters: [
        {
          id: 'osm-way-10',
          name: 'Data4 Nozay',
          provider: 'Data4',
          region: 'Nozay',
          city: 'Nozay',
          address: '',
          coordinates: [2.245, 48.67],
        },
      ],
      umapProjectDatacenters: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [2.2452, 48.6701] },
            properties: {
              name: 'Data4 (France) - Nozay',
              description: 'En cours de construction\\n250 MW\\nSource : Data4',
              'icon-color': '#ff5252',
            },
          },
        ],
      },
      now: '2026-06-08T10:30:00.000Z',
    });

    assert.equal(merged.length, 1);
    assert.equal(merged[0].source, 'uMap projets data centers France');
    assert.equal(merged[0].operationalState, 'en construction');
    assert.equal(merged[0].powerBand, 'entre 250 et 500 MW');
    assert.equal(merged[0].powerDetail, '250 MW');
    assert.match(merged[0].detailSummary, /250 MW/);
  });

  it('keeps same-provider campus sites and removes low-quality foreign OSM rows', () => {
    const merged = mergeDatacenters({
      staticDatacenters: [],
      officialIdfDatacenters: [],
      providerStatus: {
        OVH: { status: 'operational', incidents: [] },
      },
      manualDatacenters: [
        {
          id: 'manual-gra1',
          name: 'OVHcloud GRA1',
          provider: 'OVH',
          region: 'Gravelines',
          city: 'Gravelines',
          address: 'Rue des Trois Fermes 59820 Gravelines',
          coordinates: [2.115325, 51.00438],
          operationalState: 'en exploitation',
        },
        {
          id: 'manual-gra2',
          name: 'OVHcloud GRA2',
          provider: 'OVH',
          region: 'Gravelines',
          city: 'Gravelines',
          address: 'Rue des Trois Fermes 59820 Gravelines',
          coordinates: [2.115331, 51.004381],
          operationalState: 'en exploitation',
        },
      ],
      osmDatacenters: [
        {
          id: 'osm-way-generic',
          name: 'Datacenter',
          provider: 'OSM',
          region: 'France',
          city: '',
          address: '',
          coordinates: [8.450178, 49.974888],
        },
        {
          id: 'osm-way-zurich',
          name: 'Datacenter',
          provider: 'OSM',
          region: 'Zürich',
          city: 'Zürich',
          address: '10d Aargauerstrasse',
          coordinates: [8.499651, 47.392958],
        },
      ],
      umapProjectDatacenters: { type: 'FeatureCollection', features: [] },
      now: '2026-06-10T07:00:00.000Z',
    });

    assert.equal(merged.length, 2);
    assert.ok(merged.some((dc) => dc.id === 'manual-gra1'));
    assert.ok(merged.some((dc) => dc.id === 'manual-gra2'));
    assert.ok(!merged.some((dc) => dc.id === 'osm-way-generic'));
    assert.ok(!merged.some((dc) => dc.id === 'osm-way-zurich'));
  });
});
