// api/_handlers/situation-notes.js : notes de situation archivées (26/10/2026).
//   GET /api/situation-notes          → { notes: [{ id, capturedAt, score, level, situations, coverage }] } (plus récentes d'abord)
//   GET /api/situation-notes?id=<ISO> → { note: { capturedAt, score, coverage, report } }, 404 si inconnue
// Fichier absent (hors VM, aucune note encore) : liste vide, jamais une erreur.
import { noteId, noteSummary, readNotes } from '../_lib/situation-notes.js';

export const CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=300';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'method not allowed' });
    return;
  }
  const id = new URL(req.url ?? '/', 'http://localhost').searchParams.get('id');
  const notes = await readNotes();
  res.setHeader('Cache-Control', CACHE_CONTROL);
  if (id === null) {
    res.status(200).json({ notes: notes.map(noteSummary) });
    return;
  }
  const note = notes.find((n) => noteId(n) === id);
  if (!note) {
    res.status(404).json({ error: 'note inconnue ou plus ancienne que 90 jours' });
    return;
  }
  res.status(200).json({ note: { capturedAt: note.capturedAt, score: note.score ?? null, coverage: note.coverage ?? null, report: note.report } });
}
