// src/services/situation-notes.ts : lecture des notes de situation archivées par la VM (/api/situation-notes, 26/10/2026). Jamais de
// rejet : liste vide ou null sur une erreur, la fiche France dit alors simplement qu'aucune note n'est disponible.
import type { VigilanceLevel } from './vigilance.ts';
import type { SituationReportData } from './situation-report.ts';

export const SITUATION_NOTES_URL = '/api/situation-notes';

export interface ArchivedNoteSummary {
  id: string;
  capturedAt: string;
  score: number | null;
  level: VigilanceLevel | null;
  situations: number;
  coverage: { read: number; total: number } | null;
}

export interface ArchivedNote {
  capturedAt: string;
  score: number | null;
  report: SituationReportData;
}

const LEVELS: ReadonlySet<unknown> = new Set(['vert', 'jaune', 'orange', 'rouge']);

function isSummary(v: unknown): v is ArchivedNoteSummary {
  if (typeof v !== 'object' || v === null) return false;
  const r = v as Record<string, unknown>;
  return typeof r.id === 'string' && typeof r.capturedAt === 'string' && (r.score === null || typeof r.score === 'number')
    && (r.level === null || LEVELS.has(r.level)) && typeof r.situations === 'number';
}

export async function fetchArchivedNotes(fetchImpl: typeof fetch = fetch): Promise<ArchivedNoteSummary[]> {
  try {
    const resp = await fetchImpl(SITUATION_NOTES_URL, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) return [];
    const body = await resp.json() as { notes?: unknown };
    return Array.isArray(body.notes) ? body.notes.filter(isSummary) : [];
  } catch {
    return [];
  }
}

export async function fetchArchivedNote(id: string, fetchImpl: typeof fetch = fetch): Promise<ArchivedNote | null> {
  try {
    const resp = await fetchImpl(`${SITUATION_NOTES_URL}?id=${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) return null;
    const body = await resp.json() as { note?: { capturedAt?: unknown; score?: unknown; report?: unknown } };
    const n = body.note;
    if (!n || typeof n.capturedAt !== 'string' || typeof n.report !== 'object' || n.report === null) return null;
    return { capturedAt: n.capturedAt, score: typeof n.score === 'number' ? n.score : null, report: n.report as SituationReportData };
  } catch {
    return null;
  }
}
