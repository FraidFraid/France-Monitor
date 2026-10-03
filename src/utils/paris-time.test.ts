import { describe, it, expect } from 'vitest';
import { parisLocalToIso } from './paris-time.ts';

describe('parisLocalToIso', () => {
  it('heure d\'été (UTC+2)', () => {
    expect(parisLocalToIso('2026-09-15 15:42:13')).toBe('2026-09-15T13:42:13.000Z');
  });
  it('heure d\'hiver (UTC+1), secondes facultatives', () => {
    expect(parisLocalToIso('2026-01-23 18:06')).toBe('2026-01-23T17:06:00.000Z');
  });
  it('autour des changements d\'heure', () => {
    expect(parisLocalToIso('2026-03-29 01:59:00')).toBe('2026-03-29T00:59:00.000Z');
    expect(parisLocalToIso('2026-03-29 03:00:00')).toBe('2026-03-29T01:00:00.000Z');
    expect(parisLocalToIso('2026-10-25 03:00:00')).toBe('2026-10-25T02:00:00.000Z');
  });
  it('null si absent ou illisible', () => {
    expect(parisLocalToIso(null)).toBeNull();
    expect(parisLocalToIso('')).toBeNull();
    expect(parisLocalToIso('hier')).toBeNull();
  });
});
