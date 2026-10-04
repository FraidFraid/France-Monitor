// tests/sovereignty-collectors.test.ts : relève serveur du lot Souveraineté (spec 2026-10-04 souveraineté § 2 ; contrats, arbitrage 3 ;
// amendement 7, O14) : collecteurs ajoutés à ceux des Trafics et de l'Environnement, mêmes fonctions que les routes.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SOVEREIGNTY_COLLECTORS } from '../server/prod/sovereignty-collectors.mjs';
import { ensureMilitaryFresh } from '../api/_lib/military-collect.js';
import { ensureCablesWatchFresh } from '../api/_lib/cable-watch.js';
import { ensureCyberFresh } from '../api/_lib/cyber-collect.js';
import { loadSpaceWeather } from '../api/_lib/noaa-swpc.js';
import { ensureGnssFresh } from '../api/_lib/gnss-collect.js';
import { ensureRipeFresh } from '../api/_lib/ripestat.js';
import { ensureGelsFresh } from '../api/_lib/gels-avoirs.js';
import { ensureVigipirateFresh } from '../api/_lib/vigipirate-page.js';

describe('collecteurs Souveraineté (phases A et B)', () => {
  it('vols militaires, veille des câbles, vigilance cyber et relecture de la page Vigipirate, mêmes fonctions que les routes', () => {
    expect(SOVEREIGNTY_COLLECTORS.map((c) => c.name)).toEqual(['military', 'cables-watch', 'cyber', 'noaa', 'gnss', 'ripestat', 'gels', 'vigipirate']);
    expect(SOVEREIGNTY_COLLECTORS.map((c) => c.run)).toEqual([
      ensureMilitaryFresh, ensureCablesWatchFresh, ensureCyberFresh, loadSpaceWeather, ensureGnssFresh, ensureRipeFresh, ensureGelsFresh, ensureVigipirateFresh,
    ]);
  });
  it('le serveur de production les lance avec ceux des Trafics et de l’Environnement', () => {
    const server = readFileSync(new URL('../server/prod/http-server.mjs', import.meta.url), 'utf8');
    expect(server).toContain("import { SOVEREIGNTY_COLLECTORS } from './sovereignty-collectors.mjs';");
    expect(server).toContain('startTrafficCollectors({ collectors: [...COLLECTORS, ...ENVIRONMENT_COLLECTORS, ...SOVEREIGNTY_COLLECTORS] })');
  });
});
