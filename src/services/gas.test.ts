import { describe, expect, it } from 'vitest';
import { agsiNetFlowGWhDay } from './gas.ts';

describe('agsiNetFlowGWhDay', () => {
  it('prend la dernière journée publiée, pas le cumul des 30 jours (réponse réelle du 28/09/2026)', () => {
    const days = [
      { gasDayStart: '2026-09-26', injection: '633.12', withdrawal: '15.2' },
      { gasDayStart: '2026-09-25', injection: '640.00', withdrawal: '10.0' },
      { gasDayStart: '2026-08-28', injection: '700.00', withdrawal: '5.0' },
    ];
    expect(agsiNetFlowGWhDay(days)).toBeCloseTo(617.92, 2);
  });

  it('ne dépend pas de l’ordre des lignes', () => {
    const days = [
      { gasDayStart: '2026-09-24', injection: '10', withdrawal: '0' },
      { gasDayStart: '2026-09-26', injection: '5', withdrawal: '305' },
      { gasDayStart: '2026-09-25', injection: '20', withdrawal: '0' },
    ];
    expect(agsiNetFlowGWhDay(days)).toBe(-300);
  });

  it('renvoie undefined sans journée exploitable', () => {
    expect(agsiNetFlowGWhDay([])).toBeUndefined();
    expect(agsiNetFlowGWhDay([{ injection: '10', withdrawal: '0' }])).toBeUndefined();
    expect(agsiNetFlowGWhDay([{ gasDayStart: '2026-09-26', injection: 'n/a', withdrawal: '0' }])).toBeUndefined();
  });
});
