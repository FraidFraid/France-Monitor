// tests/sovereignty-outbound.test.ts : appels sortants honnêtes du lot Souveraineté (spec 2026-10-04 souveraineté, règle « chaque appel
// serveur se présente comme FranceMonitor » ; contrats § 2). Aucun module serveur du lot n'appelle `fetch` directement ni ne pose
// d'User-Agent : tout passe par api/_lib/source-http.js, qui impose « FranceMonitor/1.0 (+https://www.francemonitor.com) ».
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SOURCE_USER_AGENT } from '../api/_lib/source-http.js';

const FILES = [
  'api/_lib/adsb-lol.js', 'api/_lib/icao-country.js', 'api/_lib/territory.js', 'api/_lib/military-collect.js', 'api/_lib/route-budget.js',
  'api/_lib/subsea-cables.js', 'api/_lib/shom-cables.js', 'api/_lib/cable-watch.js', 'api/_lib/certfr.js', 'api/_lib/cisa-kev.js',
  'api/_lib/ransomware-live.js', 'api/_lib/hibp.js', 'api/_lib/cybermalveillance.js', 'api/_lib/cyber-collect.js', 'api/_lib/vigipirate-page.js',
  'api/_handlers/sovereignty/military.js', 'api/_handlers/sovereignty/cables-watch.js', 'api/_handlers/sovereignty/cyber.js',
  'api/_handlers/sovereignty/vigipirate.js', 'api/_lib/gnss-grid.js', 'api/_lib/gnss-collect.js', 'api/_lib/noaa-swpc.js',
  'api/_lib/ripestat.js', 'api/_lib/peeringdb.js', 'api/_lib/gels-avoirs.js', 'api/_lib/drone-zones.js', 'api/_handlers/sovereignty/gnss.js',
  'api/_handlers/sovereignty/connectivity.js', 'api/_handlers/sovereignty/sanctions.js', 'scripts/fetch-subsea-cables.mjs', 'scripts/fetch-france-military.mjs',
  'server/prod/sovereignty-collectors.mjs',
];
const read = (rel: string): string => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

describe('appels sortants du lot Souveraineté', () => {
  it('aucun `fetch` direct, aucun en-tête User-Agent posé ni imité', () => {
    for (const rel of FILES) {
      const text = read(rel);
      expect([rel, /\bfetch\s*\(/.test(text)]).toEqual([rel, false]);
      expect([rel, /['"]user-agent['"]|mozilla\/|chrome\/\d/i.test(text)]).toEqual([rel, false]);
    }
  });
  it('les modules qui lisent une source passent par api/_lib/source-http.js', () => {
    const readers = FILES.filter((rel) => /fetchStrict(?:Json|Text|Xml|Html|Response)\(/.test(read(rel)));
    expect(readers.length).toBeGreaterThanOrEqual(9);
    for (const rel of readers) expect(read(rel)).toMatch(/from '(?:\.\.\/)*(?:\.\/|api\/_lib\/|_lib\/)?source-http\.js'/);
  });
  it('en-tête imposé : FranceMonitor, jamais un navigateur', () => {
    expect(SOURCE_USER_AGENT).toBe('FranceMonitor/1.0 (+https://www.francemonitor.com)');
  });
});
