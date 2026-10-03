import { describe, expect, it } from 'vitest';
import { mapLimit } from '../api/_lib/map-limit.js';

describe('mapLimit (lectures parallèles bornées, routes Trafics)', () => {
  it('résultats dans l’ordre des éléments, au plus `limit` appels à la fois, une panne n’arrête jamais les autres', async () => {
    let running = 0;
    let peak = 0;
    const results = await mapLimit([5, 1, 4, 2, 3, 0], 2, async (n: number) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => { setTimeout(resolve, n); });
      running -= 1;
      if (n === 4) throw new Error('HTTP 500');
      return n * 10;
    });
    expect(peak).toBe(2);
    expect(results.map((r) => (r.ok ? r.value : (r.error as Error).message))).toEqual([50, 10, 'HTTP 500', 20, 30, 0]);
  });
  it('erreur levée sans promesse et liste vide : jamais de rejet', async () => {
    expect(await mapLimit([1], 4, () => { throw new TypeError('boum'); })).toEqual([{ ok: false, error: new TypeError('boum') }]);
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });
  it('un seul exemplaire : road-national et tomtom-urban importent le helper partagé', async () => {
    const { readFileSync } = await import('node:fs');
    for (const file of ['../api/_handlers/traffic/road-national.js', '../api/_lib/tomtom-urban.js']) {
      const src = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(src).toContain("import { mapLimit } from ");
      expect(src).not.toMatch(/function mapLimit/);
    }
  });
});
