// scripts/test-situation-history.mjs
// Run with: node scripts/test-situation-history.mjs

import assert from 'node:assert/strict';

// ── Inline the functions under test (avoid bundling for this simple module) ──
// Copy the exact implementations from api/utils/slots.js once it exists.
// For now this file will fail with "Cannot find module" — that's expected.

const { currentSlotKey, buildSlotGrid } = await import('../api/utils/slots.js');

// ─── currentSlotKey ───────────────────────────────────────────────────────────

{
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
  console.log('✓ currentSlotKey: all cases pass');
}

// ─── buildSlotGrid ────────────────────────────────────────────────────────────

{
  const grid = buildSlotGrid('2026-04-10T12:00', 3);
  assert.equal(grid.length, 3);
  assert.equal(grid[0], '2026-04-10T00:00');
  assert.equal(grid[1], '2026-04-10T06:00');
  assert.equal(grid[2], '2026-04-10T12:00');
  console.log('✓ buildSlotGrid: 3-slot window');
}
{
  // Cross-day boundary: 1 slot into previous day
  const grid = buildSlotGrid('2026-04-10T00:00', 2);
  assert.equal(grid[0], '2026-04-09T18:00');
  assert.equal(grid[1], '2026-04-10T00:00');
  console.log('✓ buildSlotGrid: cross-day boundary');
}
{
  // 7-day grid has 28 entries
  const grid = buildSlotGrid('2026-04-10T12:00', 28);
  assert.equal(grid.length, 28);
  assert.equal(grid[grid.length - 1], '2026-04-10T12:00');
  console.log('✓ buildSlotGrid: 28-slot 7-day grid');
}

console.log('\nAll situation-history tests passed.');
