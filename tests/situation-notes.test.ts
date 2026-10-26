// tests/situation-notes.test.ts : notes de situation archivées (26/10/2026) : archive de la VM (api/_lib/situation-notes.js), lecture
// côté page (src/services/situation-notes.ts), section « Notes archivées » de la fiche France et mention dans la note A4.
import { describe, expect, it } from 'vitest';
import { mergeNote, noteSlotKey, noteSummary, parseNotes, NOTES_KEEP_MS } from '../api/_lib/situation-notes.js';
import { fetchArchivedNote, fetchArchivedNotes, type ArchivedNoteSummary } from '../src/services/situation-notes.ts';
import { buildSituationReportHtml, type SituationReportData } from '../src/services/situation-report.ts';

const NOW = Date.parse('2026-10-17T20:00:00Z');
const report = (n = 2): SituationReportData => ({
  generatedAtLabel: '17 octobre 2026 à 20:00', periodLabel: 'dernières 24 h', permalink: 'https://www.francemonitor.com/?view=app',
  situations: Array.from({ length: n }, (_, i) => ({ title: `S${i}`, level: 'orange', since: 'constatée à 19:00', zone: 'France', summary: 'x' })),
  moreSituationsCount: 1, stability: null, domainSignals: [], events: [], newsCacheAvailable: true, sources: [], version: null,
}) as SituationReportData;
const note = (capturedAt: string, read: number, score = 65) => ({ capturedAt, score, coverage: { read, total: 14, missing: [] }, report: report() });

describe('archive de la VM', () => {
  it('créneau de 6 h UTC', () => {
    expect(noteSlotKey('2026-10-17T18:09:41.611Z')).toBe('2026-10-17T18:00');
    expect(noteSlotKey('2026-10-17T05:59:00Z')).toBe('2026-10-17T00:00');
  });
  it('une note par créneau : la plus couvrante ; à couverture égale, la première ; plus de 90 jours retirée', () => {
    let notes = mergeNote([], note('2026-10-17T18:02:00Z', 12), NOW);
    notes = mergeNote(notes, note('2026-10-17T18:17:00Z', 14), NOW);
    notes = mergeNote(notes, note('2026-10-17T18:32:00Z', 14), NOW);
    notes = mergeNote(notes, note('2026-10-17T12:02:00Z', 13), NOW);
    expect(notes.map((n) => n.capturedAt)).toEqual(['2026-10-17T12:02:00Z', '2026-10-17T18:17:00Z']);
    const old = { ...note('2026-07-01T12:00:00Z', 14), slotKey: '2026-07-01T12:00' };
    expect(mergeNote([old], note('2026-10-17T18:02:00Z', 14), NOW).map((n) => n.capturedAt)).toEqual(['2026-10-17T18:02:00Z']);
    expect(NOTES_KEEP_MS).toBe(90 * 86_400_000);
  });
  it('lecture : plus récentes d’abord, lignes coupées ou sans note ignorées ; résumé avec couleur et nombre de situations', () => {
    const text = [JSON.stringify(note('2026-10-17T12:02:00Z', 13, 78)), '{"capturedAt":"2026-10', JSON.stringify({ capturedAt: '2026-10-17T13:00:00Z' }),
      JSON.stringify(note('2026-10-17T18:17:00Z', 14, 65))].join('\n');
    const notes = parseNotes(text);
    expect(notes.map((n) => n.capturedAt)).toEqual(['2026-10-17T18:17:00Z', '2026-10-17T12:02:00Z']);
    expect(noteSummary(notes[0])).toEqual({ id: '2026-10-17T18:17:00Z', capturedAt: '2026-10-17T18:17:00Z', score: 65, level: 'orange', situations: 3, coverage: { read: 14, total: 14 } });
  });
});

describe('lecture côté page', () => {
  const respond = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it('liste : entrées mal formées écartées ; erreur : liste vide', async () => {
    const ok: ArchivedNoteSummary = { id: 'a', capturedAt: '2026-10-17T18:17:00Z', score: 65, level: 'orange', situations: 3, coverage: null };
    expect(await fetchArchivedNotes(respond(200, { notes: [ok, { id: 1 }] }))).toEqual([ok]);
    expect(await fetchArchivedNotes(respond(503, {}))).toEqual([]);
  });
  it('note : contenu rendu tel quel ; inconnue : null', async () => {
    const n = await fetchArchivedNote('x', respond(200, { note: { capturedAt: '2026-10-17T18:17:00Z', score: 65, report: report() } }));
    expect(n?.report.situations).toHaveLength(2);
    expect(await fetchArchivedNote('x', respond(404, { error: 'x' }))).toBeNull();
  });
});

describe('note A4 archivée', () => {
  it('« Note archivée du … » dans l’en-tête ; absente pour la note du moment', () => {
    expect(buildSituationReportHtml({ ...report(), archiveLabel: 'Note archivée du 17 octobre 2026 à 20:17, indice 65/100' }))
      .toContain('<span>Note archivée du 17 octobre 2026 à 20:17, indice 65/100</span>');
    expect(buildSituationReportHtml(report())).not.toContain('Note archivée');
  });
});
