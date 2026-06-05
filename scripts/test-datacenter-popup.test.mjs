import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDatacenterPopupHtml } from '../src/utils/infra-network-popup.js';

test('buildDatacenterPopupHtml renders enriched OSINT fields for official datacenter records', () => {
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
  assert.match(html, /Inconnu/);
});
