import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { buildDatacenterPopupHtml } from '../src/utils/infra-network-popup.js';

describe('src/utils/infra-network-popup · buildDatacenterPopupHtml', () => {
  it('renders enriched OSINT fields for official datacenter records', () => {
    const html = buildDatacenterPopupHtml({
      name: 'DATA4 DC01 PAR1',
      provider: 'DATA4 Group',
      region: 'Marcoussis',
      city: 'Marcoussis',
      address: 'Route de Nozay, 91460 Marcoussis',
      status: 'unknown',
      incidents: [],
      operationalState: 'en exploitation',
      powerBand: 'entre 40 et 100 MW',
      source: 'data.gouv.fr DRIEAT IDF WFS',
      lastUpdated: '2026-06-05T08:00:00.000Z',
      realLng: 2.231884,
      realLat: 48.635492,
      offsetMeters: 0,
    });

    assert.match(html, /DATA4 DC01 PAR1/);
    assert.match(html, /DATA4 Group · Marcoussis/);
    assert.match(html, /État du site/);
    assert.match(html, /en exploitation/);
    assert.match(html, /Puissance/);
    assert.match(html, /entre 40 et 100 MW/);
    assert.match(html, /Adresse/);
    assert.match(html, /Route de Nozay/);
    assert.match(html, /Source terrain/);
    assert.match(html, /data\.gouv\.fr DRIEAT IDF WFS/);
    assert.match(html, /Statut opérateur/);
    assert.match(html, /Non qualifié/);
  });

  it('renders project source, exact power and source link', () => {
    const html = buildDatacenterPopupHtml({
      name: 'Port of Dunkirk Data Centre',
      provider: 'Unknown Company',
      region: 'Dunkerque',
      city: 'Bourbourg',
      address: 'Route de Gravelines 59630 Bourbourg',
      status: 'unknown',
      incidents: [],
      operationalState: 'en projet',
      powerBand: 'plus de 500 MW',
      powerDetail: '700 MW',
      detailSummary: 'Projet IA de 700 MW sur 21 hectares.',
      rawSource: 'DataCenterMap',
      source: 'DataCenterMap live browser snapshot',
      sourceUrl: 'https://www.datacentermap.com/france/lille/',
      lastUpdated: '2026-06-10T07:00:00.000Z',
    });

    assert.match(html, /Puissance exacte/);
    assert.match(html, /700 MW/);
    assert.match(html, /Source projet/);
    assert.match(html, /DataCenterMap/);
    assert.match(html, /Projet IA de 700 MW/);
    assert.match(html, /Fiche source/);
  });
});
