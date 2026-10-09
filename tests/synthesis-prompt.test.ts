// tests/synthesis-prompt.test.ts : invite de la synthèse du baromètre (api/_handlers/intelligence/v1/synthesis.js) ; la composante
// « bgp » vient de RIPEstat (visibilité minimale des grands réseaux français, src/services/network-barometer.ts), jamais d'IODA (m2).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../api/_handlers/intelligence/v1/synthesis.js';

describe('invite de synthèse : libellé de la composante Internet', () => {
  it('m2 : la valeur « bgp » est attribuée à RIPEstat, jamais à IODA', () => {
    const prompt = buildPrompt({ details: { elec: 90, bgp: 97, telecom: 80, space: 100, cyber: 70, wind: null }, score: 85, status: 'nominal' }, [], null, [], null, null, null);
    expect(prompt).toContain('- Internet, visibilité BGP des grands réseaux (RIPEstat) : 97/100');
    expect(prompt).not.toContain('IODA');
  });
  it('m2 : le miroir de développement (src/plugins/synthesis-proxy.ts) dit le même libellé', () => {
    const plugin = readFileSync(new URL('../src/plugins/synthesis-proxy.ts', import.meta.url), 'utf8');
    expect(plugin).toContain("- Internet, visibilité BGP des grands réseaux (RIPEstat) : ${details['bgp'] ?? 'N/A'}/100");
    expect(plugin).not.toContain('IODA');
  });
});
