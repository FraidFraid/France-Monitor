import assert from 'node:assert/strict';

import {
  getFrenchMaritimeTerritory,
  isInFrenchMaritimeArea,
  type FrenchMaritimeTerritoryCode,
} from './frenchMaritimeTerritories.ts';

function assertTerritory(lat: number, lon: number, expectedCode: FrenchMaritimeTerritoryCode): void {
  const territory = getFrenchMaritimeTerritory(lat, lon);
  assert.equal(territory?.code, expectedCode);
  assert.equal(isInFrenchMaritimeArea(lat, lon, expectedCode), true);
}

export function runFrenchMaritimeTerritoryTests(): void {
  assertTerritory(-20.9, 55.35, 'RE');
  assertTerritory(-12.78, 45.25, 'YT');
  assertTerritory(16.23, -61.55, 'GP');
  assertTerritory(14.6, -61.08, 'MQ');
  assertTerritory(4.85, -52.28, 'GF');
  assertTerritory(43.3, 5.35, 'FR-METRO');

  assert.equal(getFrenchMaritimeTerritory(40.0, -20.0), null);
  assert.equal(isInFrenchMaritimeArea(-20.9, 55.35, 'YT'), false);
  assert.equal(isInFrenchMaritimeArea(-21.9, 56.5, 'RE'), false);
  assert.equal(isInFrenchMaritimeArea(-21.9, 56.5, 'RE', 'wide'), true);
}
