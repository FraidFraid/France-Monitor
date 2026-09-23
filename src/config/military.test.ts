import { describe, expect, it } from 'vitest';
import { detectMilitarySurges, type MilitarySurge } from './military.ts';

describe('detectMilitarySurges — cible des alertes d’urgence', () => {
  it('conserve les identifiants et le centre des avions en squawk critique', () => {
    // Régression visée : sans ces références, cliquer l’alerte agrégée ne peut
    // ni retrouver l’avion exact ni centrer la carte sur sa position.
    const flights = [
      {
        id: 'abc123',
        latitude: 48.1,
        longitude: 2.2,
        squawkAlert: { severity: 'critical' },
      },
      {
        id: 'def456',
        latitude: 48.3,
        longitude: 2.6,
        squawkAlert: { severity: 'critical' },
      },
      {
        id: 'normal',
        latitude: 47,
        longitude: 1,
        squawkAlert: { severity: 'info' },
      },
    ];

    const emergency = detectMilitarySurges(flights).find((surge) => surge.type === 'emergency') as
      | (MilitarySurge & { flightIds?: string[] })
      | undefined;

    expect(emergency?.flightIds).toEqual(['abc123', 'def456']);
    expect(emergency?.location?.lat).toBeCloseTo(48.2);
    expect(emergency?.location?.lon).toBeCloseTo(2.4);
  });
});
