// tests/outages-cascade.test.ts : pannes en cascade (control room, lot 3, 21/10/2026).
import { describe, expect, it } from 'vitest';
import { cascadesOf } from '../api/_lib/outages-cascade.js';

const o = (id: string, network: string, since: string, over: Record<string, unknown> = {}) => ({
  id, network, scope: 'departement', dept: '13', national: false, level: 'orange', since, ...over,
});

describe('pannes en cascade', () => {
  it('même département, deux réseaux ou plus, débuts à moins de 6 h : une cascade, dans l’ordre des débuts', () => {
    const c = cascadesOf([
      o('internet|dept:13', 'internet', '2026-10-21T10:55:00Z', { level: 'jaune' }),
      o('mobile|dept:13', 'mobile', '2026-10-21T10:40:00Z'),
      o('electricite|dept:13', 'electricite', '2026-10-21T10:12:00Z'),
      o('mobile|dept:60', 'mobile', '2026-10-21T10:00:00Z', { dept: '60' }),
    ]);
    expect(c).toEqual([{
      key: 'dept:13', dept: '13', national: false, level: 'orange',
      steps: [
        { id: 'electricite|dept:13', network: 'electricite', since: '2026-10-21T10:12:00Z' },
        { id: 'mobile|dept:13', network: 'mobile', since: '2026-10-21T10:40:00Z' },
        { id: 'internet|dept:13', network: 'internet', since: '2026-10-21T10:55:00Z' },
      ],
    }]);
  });
  it('débuts à plus de 6 h, ou un seul réseau : pas de cascade ; pays entier : électricité puis téléphone', () => {
    expect(cascadesOf([o('a', 'mobile', '2026-10-21T02:00:00Z'), o('b', 'internet', '2026-10-21T09:00:00Z')])).toEqual([]);
    expect(cascadesOf([o('a', 'mobile', '2026-10-21T09:00:00Z'), o('b', 'mobile', '2026-10-21T09:30:00Z')])).toEqual([]);
    const nat = cascadesOf([
      o('electricite|national', 'electricite', '2026-10-21T08:00:00Z', { scope: 'national', dept: null, national: true }),
      o('mobile|op:Orange', 'mobile', '2026-10-21T10:00:00Z', { scope: 'operateur', dept: null, national: true, level: 'rouge' }),
    ]);
    expect(nat).toEqual([expect.objectContaining({ key: 'national', national: true, level: 'rouge', steps: [expect.objectContaining({ network: 'electricite' }), expect.objectContaining({ network: 'mobile' })] })]);
  });
});
