// tests/anticipation-arrete-doc.test.ts : arrêté préfectoral ouvert en un clic depuis la fiche (page du recueil, garde .gouv.fr), 04/11/2026.
import { describe, expect, it } from 'vitest';
import { toSignals } from '../api/_lib/anticipation/signals.js';
// @ts-expect-error module JS sans déclaration
import { splitActs } from '../api/_lib/arretes-prefectoraux.js';
// @ts-expect-error module JS sans déclaration
import { arreteBascule, officialDocUrl } from '../api/_lib/anticipation/rules/common.js';
import { docHtml, safeDocUrl, scenarioHtml } from '../src/components/anticipation/scenario-view.ts';
import type { AnticipationScenario } from '../src/types/index.ts';

type Inputs = Parameters<typeof toSignals>[0];
const NOW = Date.parse('2026-11-04T10:00:00Z');
const PDF = 'https://www.loiret.gouv.fr/contenu/telechargement/82665/631499/file/recueil-45-2026-353.pdf';

describe('arrêté préfectoral : document officiel', () => {
  it('splitActs gives the first page of each act (1-based, summary skipped)', () => {
    const pages = ['SOMMAIRE ...', 'texte\n45-2026-10-16-00001', 'suite\n45-2026-10-16-00001', 'autre\n45-2026-10-16-00002'];
    expect(splitActs(pages).map((a: { id: string; page: number }) => `${a.id}@${a.page}`)).toEqual(['45-2026-10-16-00001@2', '45-2026-10-16-00002@4']);
  });

  it('decree signal points to the PDF at the act page and carries the preview fields', () => {
    const protests = {
      readAt: new Date(NOW - 60_000).toISOString(),
      items: [{
        id: 'a1', source: 'prefecture', status: 'annonce', title: 'Interdiction', startsAt: '2026-11-05T08:00:00Z', allDay: false, city: 'Orléans', dept: '45',
        lat: null, lon: null, url: PDF, edition: 'Préfecture du Loiret',
        arrete: { kind: 'interdiction', act: '45-2026-10-16-00001', title: 'Arrêté portant interdiction de manifester', excerpt: 'Considérant…', hours: ['08:00', '20:00'], publishedOn: '2026-11-04', page: 7 },
      }],
    };
    const { signals } = toSignals({ protests } as unknown as Inputs, NOW);
    const arr = signals.find((s) => s.kind === 'arrete_prefectoral');
    expect(arr?.ref).toBe(`${PDF}#page=7`);
    const b = arreteBascule(arr);
    expect(b.state).toBe('atteint');
    expect(b.doc).toEqual({ url: `${PDF}#page=7`, act: '45-2026-10-16-00001', title: 'Arrêté portant interdiction de manifester', excerpt: 'Considérant…', issuer: 'Préfecture du Loiret', publishedOn: '2026-11-04', hours: ['08:00', '20:00'] });
  });

  it('no decree → watched bascule without document; a non-.gouv.fr address is never linked', () => {
    expect(arreteBascule(undefined)).toEqual({ id: 'arrete', label: 'Arrêté préfectoral publié', state: 'surveille', at: null });
    expect(arreteBascule({ id: 'x', kind: 'arrete_prefectoral', ref: 'https://evil.example/gouv.fr.pdf', publishedAt: '2026-11-04T00:00:00Z' }).doc).toBeUndefined();
    for (const bad of ['http://www.loiret.gouv.fr/a.pdf', 'javascript:alert(1)', 'https://loiret.gouv.fr.evil.com/a.pdf', '']) {
      expect(officialDocUrl(bad)).toBeNull();
      expect(safeDocUrl(bad)).toBeNull();
    }
    expect(safeDocUrl(`${PDF}#page=3`)).toBe(`${PDF}#page=3`);
  });

  it('preview escapes server text and opens the official PDF in a new tab', () => {
    const html = docHtml({ url: `${PDF}#page=7`, act: '45-2026-10-16-00001', title: '<b>Arrêté</b>', excerpt: 'a "b" <i>', issuer: 'Préfecture du Loiret', publishedOn: '2026-11-04', hours: ['08:00', '20:00'] });
    expect(html).toContain(`href="${PDF}#page=7"`);
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('&lt;b&gt;Arrêté&lt;/b&gt;');
    expect(html).toContain('n° 45-2026-10-16-00001 · Préfecture du Loiret · publié le 04/11/2026 · de 08:00 à 20:00');
    expect(html).not.toContain('<i>');
    expect(docHtml({ url: 'https://evil.example/x.pdf', act: null, title: null, excerpt: null, issuer: null, publishedOn: null, hours: null })).toBe('');
  });

  it('card shows the preview under a reached decree bascule only', () => {
    const base = {
      id: 's', ruleId: 'mobilisation-transports', ruleVersion: 1, zone: { dept: ['45'], communes: [] }, window: { from: '2026-11-05T07:00:00Z', to: '2026-11-05T13:00:00Z' },
      title: 't', chain: [], word: 'probable', why: '', unknowns: [], disconfirmers: [], verify: [], openedAt: '2026-11-04T09:00:00Z', revisedAt: '2026-11-04T09:00:00Z',
      status: 'ouvert', closedAt: null, outcomeNote: null, feedback: { utile: 0, deja_su: 0, faux: 0 },
    };
    const doc = { url: PDF, act: null, title: 'Arrêté', excerpt: null, issuer: null, publishedOn: null, hours: null };
    const hit = scenarioHtml({ ...base, bascules: [{ id: 'arrete', label: 'Arrêté préfectoral publié', state: 'atteint', at: '2026-11-04T09:00:00Z', doc }] } as unknown as AnticipationScenario, {}, { today: '2026-11-04', feedback: 'idle' } as never);
    expect(hit).toContain("Voir l'arrêté (PDF officiel)");
    const watched = scenarioHtml({ ...base, bascules: [{ id: 'arrete', label: 'Arrêté préfectoral publié', state: 'surveille', at: null, doc }] } as unknown as AnticipationScenario, {}, { today: '2026-11-04', feedback: 'idle' } as never);
    expect(watched).not.toContain('anr-doc');
  });
});
