import { describe, it, expect } from 'vitest';
import { floorToBucket, HOUR_MS } from './time-bucket';

describe('floorToBucket', () => {
  it("arrondit au début de l'heure", () => {
    const ms = Date.parse('2026-10-25T14:37:12.345Z');
    expect(new Date(floorToBucket(ms, HOUR_MS)).toISOString()).toBe('2026-10-25T14:00:00.000Z');
  });
  it('deux visiteurs dans la même heure obtiennent la même borne', () => {
    const a = floorToBucket(Date.parse('2026-10-25T14:01:00Z') - 7 * 86_400_000, HOUR_MS);
    const b = floorToBucket(Date.parse('2026-10-25T14:59:59Z') - 7 * 86_400_000, HOUR_MS);
    expect(a).toBe(b);
  });
});
