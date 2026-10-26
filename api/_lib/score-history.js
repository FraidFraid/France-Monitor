// api/_lib/score-history.js : relevés de la note nationale pris par l'enregistreur de la VM (scripts/score-recorder.mjs, minuteur
// fm-score-recorder toutes les 15 min), une ligne JSON par relevé. Fonctions pures, lues par api/_handlers/situation-history.js.

export const SCORE_HISTORY_FILES = Object.freeze([
  process.env.SCORE_HISTORY_FILE,
  '/var/lib/francemonitor/data/score-history.jsonl',
].filter(Boolean));

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/** Lignes du fichier en relevés ; une ligne illisible (écriture coupée) est ignorée. */
export function parseRecords(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec && typeof rec.capturedAt === 'string' && Number.isFinite(rec.score)) out.push(rec);
    } catch {
      // ligne coupée : ignorée
    }
  }
  return out;
}

function coverageRead(rec) {
  return Number.isFinite(rec?.coverage?.read) ? rec.coverage.read : 0;
}

/** Le relevé reçu remplace celui du créneau s'il couvre plus de sources (le premier reçu ne fige plus la note). */
export function preferSnapshot(stored, incoming) {
  if (!stored) return true;
  return coverageRead(incoming) > coverageRead(stored);
}

/**
 * Relevé retenu pour chaque créneau de 6 h de la grille : le premier relevé complet du créneau, sinon le plus couvrant (le plus tôt
 * à égalité). Le relevé est rendu sous la clé du créneau, son heure réelle restant dans capturedAt.
 */
export function slotsFromRecords(grid, records) {
  const bySlot = new Map();
  for (const slotKey of grid) {
    const start = Date.parse(`${slotKey}:00.000Z`);
    const inSlot = records
      .filter((r) => { const t = Date.parse(r.capturedAt); return t >= start && t < start + SIX_HOURS_MS; })
      .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
    if (inSlot.length === 0) continue;
    const complete = inSlot.find((r) => r.coverage && r.coverage.read >= r.coverage.total);
    const best = complete ?? inSlot.reduce((acc, r) => (coverageRead(r) > coverageRead(acc) ? r : acc), inSlot[0]);
    bySlot.set(slotKey, { ...best, slotKey });
  }
  return bySlot;
}

/** Relevés des `days` derniers jours, du plus ancien au plus récent (courbe au quart d'heure). */
export function recentRecords(records, days, nowMs = Date.now()) {
  const from = nowMs - days * 24 * 60 * 60 * 1000;
  return records
    .filter((r) => Date.parse(r.capturedAt) >= from)
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
}
