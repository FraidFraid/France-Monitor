// tests/anticipation-replay.test.ts : rejeu du moteur d'anticipation sur une source injectée (aucun réseau), 04/11/2026.
import { describe, expect, it } from 'vitest';
// @ts-expect-error module JS sans déclaration
import { replayAt, renderReport } from '../scripts/anticipation-replay/replay.mjs';

const AT = '2026-10-17T10:00:00Z';
// 17/10 : heure d'été (UTC+2). Après-midi de Paris 14 h à 22 h = 12:00Z à 20:00Z.
const rally = (id: string, source: string) => ({ id, source, status: 'annonce', title: `Rassemblement ${id}`, startsAt: '2026-10-17T15:00:00Z', allDay: false, dept: '69', lat: 45.76, lon: 4.84 });
const strike = { id: 9001, eventId: 77, feedName: 'Le Progrès', title: 'Grève à la SNCF : trains supprimés dans le Rhône', link: 'https://exemple.test/a', publishedAt: '2026-10-17T08:00:00Z', category: 'social', severity: 'medium', lat: 45.76, lon: 4.84 };

interface Out { at: string; scenarios: Array<{ ruleId: string; word: string; window: { from: string; to: string } }>; kinds: Record<string, number>; rules: string[]; stats: { news: number | null; feeds: number | null }; unknown: string[]; errors: string[]; limits: string[] }

describe('replayAt', () => {
  it('replay opens rule 1 scenario at 17/10 fixture', async () => {
    const out: Out[] = await replayAt([AT], {
      news: async () => [strike],
      protests: async () => ({ readAt: AT, items: [rally('a', 'demosphere'), rally('b', 'cgt'), rally('c', 'giletsjaunes')] }),
    });
    expect(out).toHaveLength(1);
    expect(out[0].at).toBe(AT);
    expect(out[0].scenarios.map((s) => s.ruleId)).toContain('mobilisation-transports');
    const s = out[0].scenarios.find((x) => x.ruleId === 'mobilisation-transports');
    expect(s?.word).toBe('possibilite_reelle');
    expect(s?.window).toEqual({ from: '2026-10-17T12:00:00.000Z', to: '2026-10-17T20:00:00.000Z' });
    expect(out[0].kinds.rassemblement_annonce).toBe(3);
    // Tout ce qui n'est pas fourni est inconnu et nommé dans les limites.
    expect(out[0].unknown).toContain('Météo-France non lue');
    expect(out[0].limits.some((l) => l.includes('vigilance'))).toBe(true);
  });

  it('missing sources never throw and yield unknown', async () => {
    const out: Out[] = await replayAt([AT], {});
    expect(out[0].scenarios).toEqual([]);
    expect(out[0].unknown).toContain('Presse non lue');
  });

  it('null source names the limit and the rules deprived of an input', async () => {
    const out: Out[] = await replayAt([AT], { news: async () => null, protests: async () => null });
    expect(out[0].limits).toContain('presse : non archivé à cet instant');
    expect(out[0].rules.some((r) => r.includes('mobilisation-transports'))).toBe(true);
    expect(out[0].limits.some((l) => l.includes('archive des signaux'))).toBe(true);
  });

  it('flags an anomalous press volume', async () => {
    const big = Array.from({ length: 10 }, (_, i) => ({ ...strike, id: i, eventId: i, feedId: `f${i}` }));
    const out = await replayAt([AT, '2026-10-18T10:00:00Z', '2026-10-19T10:00:00Z'], { news: async (at: string) => (at.startsWith('2026-10-19') ? big.slice(0, 2) : big) });
    expect(renderReport(out)).toContain('volume de presse anormal');
  });

  it('a failing source is a named limit, not a crash', async () => {
    const out: Out[] = await replayAt([AT], { news: async () => { throw new Error('HTTP 502'); } });
    expect(out[0].unknown).toContain('Presse non lue');
    expect(out[0].limits.join(' ')).toContain('HTTP 502');
  });

  it('renderReport writes a table per instant without em dash', async () => {
    const out = await replayAt([AT], { news: async () => [strike], protests: async () => ({ readAt: AT, items: [rally('a', 'demosphere')] }) });
    const md: string = renderReport(out);
    expect(md).toContain(AT);
    expect(md).toContain('Limites');
    expect(md).not.toContain('—');
  });
});
