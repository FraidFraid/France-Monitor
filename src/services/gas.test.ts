import { describe, expect, it } from 'vitest';
import { agsiNetFlowGWhDay, applyAlsiTerminals, applyPirPoints, parseAlsiTerminals } from './gas.ts';
import { GAS_INTERCONNECTIONS, GAS_TERMINALS } from '../config/gas-infrastructure';

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

describe('GIE ALSI par terminal', () => {
  // Réponse de /api/gie/alsi : deux terminaux réels (jour gazier 26/09/2026) + deux entrées mal formées.
  const response = {
    terminals: [
      { eic: '63W631527814486R', gasDayStart: '2026-09-26', sendOutGWhDay: 331.7, inventoryGWh: 1609.41, inventoryMaxGWh: 2400.01, referenceSendOutGWhDay: 337 },
      { eic: '63W179356656691A', gasDayStart: '2026-09-26', sendOutGWhDay: 0, inventoryGWh: 319.37, inventoryMaxGWh: 533.28, referenceSendOutGWhDay: 49.3 },
      { eic: 42, gasDayStart: '2026-09-26' },
      { eic: 'X', sendOutGWhDay: 1 },
    ],
    errors: [{ eic: '21W0000000000451', error: 'HTTP 500' }],
  };

  it('parseAlsiTerminals ignore les entrées mal formées et les réponses inattendues', () => {
    expect(parseAlsiTerminals(response).map((d) => d.eic)).toEqual(['63W631527814486R', '63W179356656691A']);
    expect(parseAlsiTerminals({ data: [{ name: 'France' }] })).toEqual([]);
    expect(parseAlsiTerminals(null)).toEqual([]);
    expect(parseAlsiTerminals({ terminals: [{ eic: 'A', gasDayStart: '2026-09-26', sendOutGWhDay: '12' }] })[0]?.sendOutGWhDay).toBeNull();
  });

  it('applyAlsiTerminals apparie par code EIC, sans toucher à la configuration', () => {
    const before = JSON.stringify(GAS_TERMINALS);
    const terminals = applyAlsiTerminals(GAS_TERMINALS, parseAlsiTerminals(response));
    expect(JSON.stringify(GAS_TERMINALS)).toBe(before);

    const montoir = terminals.find((t) => t.id === 'lng-montoir');
    expect(montoir?.capacityGWh).toBe(337);
    expect(montoir?.currentSendOut).toBe(331.7);
    expect(montoir?.utilizationPct).toBeCloseTo(98.43, 2);
    expect(montoir?.inventory).toBe(1609.41);
    expect(montoir?.inventoryCapacity).toBe(2400.01);
    expect(montoir?.inventoryPct).toBeCloseTo(67.06, 2);
    expect(montoir?.dataDate).toBe('2026-09-26');

    const tonkin = terminals.find((t) => t.id === 'lng-fos-tonkin');
    expect(tonkin?.currentSendOut).toBe(0);
    expect(tonkin?.utilizationPct).toBe(0);

    // Dunkerque absent de la réponse : valeurs de configuration, pas de date GIE.
    const dunkerque = terminals.find((t) => t.id === 'lng-dunkerque');
    expect(dunkerque?.currentSendOut).toBeUndefined();
    expect(dunkerque?.dataDate).toBeUndefined();
    expect(dunkerque?.capacityGWh).toBe(575);
  });

  it('chaque terminal configuré a un code EIC GIE distinct', () => {
    const eics = GAS_TERMINALS.map((t) => t.gieEic);
    expect(eics.every((e) => typeof e === 'string' && e.length === 16)).toBe(true);
    expect(new Set(eics).size).toBe(eics.length);
  });
});

describe('flux ENTSOG par interconnexion', () => {
  it('réponse partielle : le point absent est marqué manquant (jamais un flux nul), les autres gardent leur valeur', () => {
    const [first, ...others] = GAS_INTERCONNECTIONS;
    const res = applyPirPoints([{ pointKey: first?.entsogKey ?? '', flowGWhDay: 123 }]);
    expect(res[0]).toMatchObject({ flowGWhDay: 123 });
    expect(res[0]?.flowMissing).toBeUndefined();
    expect(res.slice(1).every((i) => i.flowMissing === true && i.flowGWhDay === 0)).toBe(true);
    expect(res).toHaveLength(others.length + 1);
  });
});
