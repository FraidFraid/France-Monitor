import { describe, it, expect } from 'vitest';

import { computeHealthStatus } from '../api/_handlers/health-check.js';

// Le cron d'ingestion tourne toutes les 30 min (Upstash QStash) : les seuils
// doivent tolérer un tick manqué sans déclarer 'down' à tort.
describe('api/health-check · computeHealthStatus', () => {
  it('ok quand le tick et les articles sont frais', () => {
    expect(computeHealthStatus(5 * 60_000, 10 * 60_000)).toBe('ok');
  });

  it('ok jusqu’à 44 min de tick (marge sur le cron de 30 min)', () => {
    expect(computeHealthStatus(44 * 60_000, 10 * 60_000)).toBe('ok');
  });

  it('degraded quand le tick est frais mais les articles vieux', () => {
    expect(computeHealthStatus(5 * 60_000, 91 * 60_000)).toBe('degraded');
  });

  it('down quand le tick dépasse 45 min', () => {
    expect(computeHealthStatus(46 * 60_000, 10 * 60_000)).toBe('down');
  });

  it('down quand le tick ou les articles sont inconnus (null)', () => {
    expect(computeHealthStatus(null, 10 * 60_000)).toBe('down');
    expect(computeHealthStatus(5 * 60_000, null)).toBe('degraded');
    expect(computeHealthStatus(null, null)).toBe('down');
  });
});
