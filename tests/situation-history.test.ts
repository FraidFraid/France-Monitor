import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { currentSlotKey, buildSlotGrid } from '../api/utils/slots.js';

describe('api/utils/slots · currentSlotKey', () => {
  it('mappe chaque heure UTC vers son créneau de 6 h', () => {
    // 00:00 UTC → slot 00:00
    assert.equal(currentSlotKey(new Date('2026-04-10T00:00:00Z')), '2026-04-10T00:00');
    // 05:59 UTC → still slot 00:00
    assert.equal(currentSlotKey(new Date('2026-04-10T05:59:59Z')), '2026-04-10T00:00');
    // 06:00 UTC → slot 06:00
    assert.equal(currentSlotKey(new Date('2026-04-10T06:00:00Z')), '2026-04-10T06:00');
    // 11:59 UTC → still slot 06:00
    assert.equal(currentSlotKey(new Date('2026-04-10T11:59:59Z')), '2026-04-10T06:00');
    // 12:00 UTC → slot 12:00
    assert.equal(currentSlotKey(new Date('2026-04-10T12:00:00Z')), '2026-04-10T12:00');
    // 17:59 UTC → still slot 12:00
    assert.equal(currentSlotKey(new Date('2026-04-10T17:59:59Z')), '2026-04-10T12:00');
    // 18:00 UTC → slot 18:00
    assert.equal(currentSlotKey(new Date('2026-04-10T18:00:00Z')), '2026-04-10T18:00');
    // 23:59 UTC → still slot 18:00
    assert.equal(currentSlotKey(new Date('2026-04-10T23:59:59Z')), '2026-04-10T18:00');
  });
});

describe('api/utils/slots · buildSlotGrid', () => {
  it('construit une fenêtre glissante de créneaux', () => {
    const grid = buildSlotGrid('2026-04-10T12:00', 3);
    assert.equal(grid.length, 3);
    assert.equal(grid[0], '2026-04-10T00:00');
    assert.equal(grid[1], '2026-04-10T06:00');
    assert.equal(grid[2], '2026-04-10T12:00');
  });

  it('gère le passage de minuit', () => {
    const grid = buildSlotGrid('2026-04-10T00:00', 2);
    assert.equal(grid[0], '2026-04-09T18:00');
    assert.equal(grid[1], '2026-04-10T00:00');
  });

  it('produit une grille de 28 créneaux sur 7 jours', () => {
    const grid = buildSlotGrid('2026-04-10T12:00', 28);
    assert.equal(grid.length, 28);
    assert.equal(grid[grid.length - 1], '2026-04-10T12:00');
  });
});
