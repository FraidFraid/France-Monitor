// api/_lib/situation-notes.js : notes de situation archivées par l'enregistreur de la VM (scripts/score-recorder.mjs, 26/10/2026), une
// ligne JSON par note : { capturedAt, slotKey, score, coverage, report } (report : SituationReportData, rendu par
// src/services/situation-report.ts). Une note par créneau de 6 h, 90 jours. Lecture et résumés, pour /api/situation-notes.
import { readFile } from 'node:fs/promises';
import { levelOf } from './alerts.js';

export const SITUATION_NOTES_FILES = Object.freeze([
  process.env.SITUATION_NOTES_FILE,
  '/var/lib/francemonitor/data/situation-notes.jsonl',
].filter(Boolean));

/** Notes lisibles, des plus récentes aux plus anciennes ; une ligne coupée ou sans note est ignorée. */
export function parseNotes(text) {
  const notes = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const n = JSON.parse(line);
      if (typeof n?.capturedAt === 'string' && Number.isFinite(Date.parse(n.capturedAt)) && n.report && typeof n.report === 'object') notes.push(n);
    } catch {
      // ligne coupée
    }
  }
  return notes.sort((a, b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
}

/** Identifiant d'une note : son heure de relevé. */
export function noteId(note) {
  return note.capturedAt;
}

/** Résumé d'une note pour la liste (sans le contenu). */
export function noteSummary(note) {
  const score = Number.isFinite(note.score) ? note.score : null;
  return {
    id: noteId(note),
    capturedAt: note.capturedAt,
    score,
    level: score === null ? null : levelOf(score),
    situations: Array.isArray(note.report?.situations) ? note.report.situations.length + (Number(note.report.moreSituationsCount) || 0) : 0,
    coverage: note.coverage && Number.isFinite(note.coverage.read) && Number.isFinite(note.coverage.total)
      ? { read: note.coverage.read, total: note.coverage.total }
      : null,
  };
}

export async function readNotes() {
  for (const file of SITUATION_NOTES_FILES) {
    try {
      return parseNotes(await readFile(file, 'utf8'));
    } catch {
      // fichier suivant
    }
  }
  return [];
}

export const NOTES_KEEP_MS = 90 * 24 * 3_600_000;

/** Créneau de 6 h (UTC) d'un relevé : « 2026-10-17T18:00 ». */
export function noteSlotKey(iso) {
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 11)}${String(Math.floor(d.getUTCHours() / 6) * 6).padStart(2, '0')}:00`;
}

/**
 * Ajoute une note à l'archive (scripts/score-recorder.mjs) : une par créneau de 6 h, la plus couvrante en sources (à couverture égale,
 * la première gardée) ; notes de plus de 90 jours retirées. Renvoie la liste à écrire, de la plus ancienne à la plus récente.
 */
export function mergeNote(notes, entry, nowMs) {
  const kept = notes.filter((n) => nowMs - Date.parse(n.capturedAt) < NOTES_KEEP_MS);
  const slot = noteSlotKey(entry.capturedAt);
  const next = { ...entry, slotKey: slot };
  const read = (n) => n?.coverage?.read ?? -1;
  const same = kept.findIndex((n) => (n.slotKey ?? noteSlotKey(n.capturedAt)) === slot);
  if (same === -1) kept.push(next);
  else if (read(next) > read(kept[same])) kept[same] = next;
  return kept.sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
}
