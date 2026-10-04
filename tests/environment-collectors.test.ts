// Relève serveur du lot Environnement (spec 2026-10-04 environnement § 2.4, E5) : collecteurs ajoutés à ceux des Trafics.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENVIRONMENT_COLLECTORS } from '../server/prod/environment-collectors.mjs';
import { ensureFiresFresh } from '../api/_lib/fires-collect.js';
import { ensureVigilanceArchiveFresh } from '../api/_lib/vigilance-archive.js';

describe('collecteurs Environnement', () => {
  it('FIRMS et archive de la vigilance, mêmes fonctions que les routes', () => {
    expect(ENVIRONMENT_COLLECTORS.map((c) => c.name)).toEqual(['firms', 'vigilance-archive']);
    expect(ENVIRONMENT_COLLECTORS[0].run).toBe(ensureFiresFresh);
    expect(ENVIRONMENT_COLLECTORS[1].run).toBe(ensureVigilanceArchiveFresh);
  });
  it('le serveur de production les lance avec ceux des Trafics', () => {
    const server = readFileSync(new URL('../server/prod/http-server.mjs', import.meta.url), 'utf8');
    expect(server).toContain("import { COLLECTORS, startTrafficCollectors } from './traffic-collectors.mjs';");
    expect(server).toContain("import { ENVIRONMENT_COLLECTORS } from './environment-collectors.mjs';");
    expect(server).toContain('startTrafficCollectors({ collectors: [...COLLECTORS, ...ENVIRONMENT_COLLECTORS] })');
  });
});
