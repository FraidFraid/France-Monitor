// Types de navires (arbitrage du contrôleur, tâche 15 des Trafics) : la teinte de la carte, la légende et ses comptes suivent le
// classement du serveur (`typeCategory`, api/_lib/ais-snapshot.js, qui remplit `MaritimeSnapshot.byType`). La carte en garde une
// copie client (`vesselCategory`, traffic-legend.ts) : chaque code de 0 à 99 doit tomber dans la même catégorie des deux côtés.
import { describe, expect, it } from 'vitest';
import { typeCategory } from '../api/_lib/ais-snapshot.js';
import { VESSEL_TYPE_HEX, vesselCategory } from '../src/components/layer-panel/traffic-legend.ts';

describe('classement des types AIS : carte et serveur identiques', () => {
  it('chaque code de 0 à 99 tombe dans la même catégorie sur la carte que dans les comptes du serveur', () => {
    const differ = Array.from({ length: 100 }, (_, code) => code)
      .filter((code) => vesselCategory(code) !== typeCategory(code))
      .map((code) => `${code} : carte ${vesselCategory(code)}, serveur ${typeCategory(code)}`);
    expect(differ).toEqual([]);
  });
  it('valeurs hors codes : absentes, illisibles, négatives ou au-delà de 99, même catégorie', () => {
    for (const code of [null, undefined, Number.NaN, -1, 30.5, '35', '', 100, 255]) expect(vesselCategory(code)).toBe(typeCategory(code));
  });
  it('chaque catégorie du serveur a sa teinte sur la carte', () => {
    const categories = new Set(Array.from({ length: 100 }, (_, code) => String(typeCategory(code))));
    for (const c of categories) expect(Object.keys(VESSEL_TYPE_HEX)).toContain(c);
    expect(categories.size).toBe(Object.keys(VESSEL_TYPE_HEX).length);
  });
});
