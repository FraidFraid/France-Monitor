// src/components/layer-panel/cyber-watch.test.ts : veille cyber élargie dans le panneau Vigilance cyber (18/10/2026) : synthèse « En bref »,
// deux niveaux de lecture, rapprochement d'une cible des hacktivistes avec la sonde de son site, routage montré seulement avec une victime
// française, domaines imitateurs jamais cliquables.
import { describe, expect, it } from 'vitest';
import type { CyberWatchResponse, DdosiaHost } from '../../types/index.ts';
import { CYBER_FIXTURE, SOV_FIXTURE_NOW } from './sovereignty.fixture.ts';
import { buildCyberView } from './cyber.ts';
import { defang, frenchHijacks, hacktivistLevel, targetText } from './cyber-watch.ts';

const NOW = SOV_FIXTURE_NOW;
const ISO = (ms: number): string => new Date(ms).toISOString();
const HOUR = 3_600_000;

const host = (over: Partial<DdosiaHost> = {}): DdosiaHost => ({
  host: 'www.gers.gouv.fr', first: ISO(NOW - 30 * HOUR), last: ISO(NOW - 2 * HOUR), configs: 3, kind: 'préfecture',
  place: { dept: '32', name: 'Préfecture Gers', how: 'préfecture', lon: null, lat: null }, ...over,
});

function watch(over: Partial<CyberWatchResponse> = {}): CyberWatchResponse {
  return {
    readAt: ISO(NOW), radar: null, abuse: null, lookalikes: { readAt: ISO(NOW), domains: [{ domain: 'ameli-remboursement.info', brand: 'Assurance maladie (ameli)', day: '2026-10-03' }], perDay: [] },
    cnil: null, epss: null, euvd: null,
    ddosia: { readAt: ISO(NOW), lastConfig: null, hosts: [host(), host({ host: 'brest.fr', kind: 'collectivité', place: { dept: '29', name: 'Brest', how: 'commune', lon: -4.5, lat: 48.4 } })], days: [] },
    services: { readAt: ISO(NOW), items: [{ id: 'ameli', name: 'ameli.fr', url: 'https://www.ameli.fr/', ok: true, status: 200, ms: 300, error: null, downSince: null, uptime24: 100, medianMs: 280, hours: [] }] },
    targets: { readAt: ISO(NOW), items: [
      { host: 'www.gers.gouv.fr', ok: false, status: null, ms: null, error: 'délai dépassé', medianMs: 400, state: 'injoignable', since: ISO(NOW - HOUR) },
      { host: 'brest.fr', ok: true, status: 200, ms: 350, error: null, medianMs: 330, state: 'joignable', since: null },
    ] },
    errors: [], ...over,
  };
}

const view = (w: CyberWatchResponse | null) => buildCyberView({ cyber: CYBER_FIXTURE(), cyberError: null, now: NOW, open: (_id, byDefault) => byDefault, watch: w });

describe('veille cyber élargie dans le panneau', () => {
  it('deux niveaux de lecture : synthèse et décision en haut, détails techniques repliés au-dessous', () => {
    const ids = view(watch()).sections.map((s) => s.id);
    expect(ids.slice(0, 6)).toEqual(['enbref', 'certfr', 'hacktivistes', 'services', 'ddos', 'revendications']);
    expect(ids.indexOf('technique')).toBeLessThan(ids.indexOf('kev'));
    expect(ids.indexOf('technique')).toBeLessThan(ids.indexOf('imitations'));
    expect(view(watch()).sections.find((s) => s.id === 'kev')?.open).toBe(false);
  });
  it('« En bref » : niveau de la menace, indice plafonné, ce qui change, qui est visé, qui contacter', () => {
    const html = view(watch()).sections[0]?.html ?? '';
    expect(html).toContain('Niveau de la menace cyber');
    expect(html).toContain('jamais critique');
    expect(html).toContain('2 sites français visés par les hacktivistes pro-russes NoName057(16), dont 1 lent ou injoignable : www.gers.gouv.fr');
    expect(html).toContain('préfecture visé : Gers');
    expect(html).toContain('CSIRT régional');
    expect(html).toContain('17Cyber');
  });
  it('sans veille lue : la synthèse reste, sans section de la veille', () => {
    const ids = view(null).sections.map((s) => s.id);
    expect(ids[0]).toBe('enbref');
    expect(ids).not.toContain('hacktivistes');
  });
  it('rapprochement : visé en 24 h et injoignable orange, visé et joignable jaune, plus ancien sans niveau', () => {
    const w = watch();
    expect(hacktivistLevel(host(), NOW, w)).toBe('orange');
    expect(hacktivistLevel(host({ host: 'brest.fr' }), NOW, w)).toBe('jaune');
    expect(hacktivistLevel(host({ host: 'inconnu.fr' }), NOW, w)).toBe('jaune');
    expect(hacktivistLevel(host({ last: ISO(NOW - 30 * HOUR) }), NOW, w)).toBeNull();
    expect(targetText(w.targets?.items[0] ?? null, NOW)).toMatch(/^injoignable depuis .+ \(délai dépassé\)$/);
  });
  it('routage montré seulement quand un réseau français est victime', () => {
    const radar = {
      readAt: ISO(NOW), dataUntil: ISO(NOW), l7: [], l3: [], l7Ratio: 1, l3Ratio: 1, industries: [], targetRank: 10, targetShare: 1.5,
      hijacks: [{ id: '1', start: ISO(NOW), end: ISO(NOW), hijacker: { asn: 1, name: 'A', cc: 'FR' }, victims: [{ asn: 2, name: 'B', cc: 'DE' }], prefixes: 1, confidence: 4, ongoing: true }],
      hijackCount: 1, leaks: [], leakCount: 0,
    };
    expect(frenchHijacks(watch({ radar }))).toBe(0);
    expect(view(watch({ radar })).sections.map((s) => s.id)).not.toContain('bgp');
    const victim = { ...radar, hijacks: [{ ...radar.hijacks[0], victims: [{ asn: 3215, name: 'Orange', cc: 'FR' }] }] };
    expect(view(watch({ radar: victim })).sections.map((s) => s.id)).toContain('bgp');
  });
  it('domaines imitateurs jamais cliquables', () => {
    expect(defang('ameli-remboursement.info')).toBe('ameli-remboursement[.]info');
    const html = view(watch()).sections.find((s) => s.id === 'imitations')?.html ?? '';
    expect(html).toContain('ameli-remboursement[.]info');
    expect(html).not.toContain('href="http://ameli-remboursement');
  });
});
