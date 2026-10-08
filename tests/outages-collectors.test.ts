import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OUTAGES_COLLECTORS } from '../server/prod/outages-collectors.mjs';
import { ensureTelecomFresh } from '../api/_lib/outages-telecom.js';
import { ensurePowerFresh } from '../api/_lib/outages-power.js';

describe('collecteurs Pannes réseau', () => {
  it('Télécoms et Électricité, mêmes fonctions que les routes', () => {
    expect(OUTAGES_COLLECTORS.map((c) => c.name)).toEqual(['outages-telecom', 'outages-power']);
    expect(OUTAGES_COLLECTORS.map((c) => c.run)).toEqual([ensureTelecomFresh, ensurePowerFresh]);
  });
  it('le serveur de production les lance avec les autres', () => {
    const server = readFileSync(new URL('../server/prod/http-server.mjs', import.meta.url), 'utf8');
    expect(server).toContain("import { OUTAGES_COLLECTORS } from './outages-collectors.mjs';");
    expect(server).toContain('startTrafficCollectors({ collectors: [...COLLECTORS, ...ENVIRONMENT_COLLECTORS, ...SOVEREIGNTY_COLLECTORS, ...OUTAGES_COLLECTORS] })');
  });
});
