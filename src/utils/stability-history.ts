/**
 * stability-history.ts — Historique local (7 j) de l'indice de stabilité national.
 * Ring buffer localStorage : Δ24h, deltas par pilier, sparkline, score précédent
 * pour le lissage EMA du moteur v3. Cœur pur (testé) + wrapper localStorage.
 */

export interface StabilityPillarValues {
  continuity: number;
  security: number;
  signal: number;
  defense: number;
}

export interface StabilityHistoryEntry {
  ts: number;
  score: number;
  pillars: StabilityPillarValues;
}

const STORAGE_KEY = 'fm_stability_history_v1';
export const MIN_INTERVAL_MS = 30 * 60 * 1000;
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_ENTRIES = 400;
const DELTA_TARGET_MS = 24 * 60 * 60 * 1000;
const DELTA_TOLERANCE_MS = 6 * 60 * 60 * 1000;
const SMOOTHING_WINDOW_MS = 2 * 60 * 60 * 1000;
const SPARKLINE_MAX_POINTS = 28;

// ─── Cœur pur ────────────────────────────────────────────────────────────────

export function pruneEntries(entries: StabilityHistoryEntry[], now: number): StabilityHistoryEntry[] {
  return entries
    .filter((e) => now - e.ts <= MAX_AGE_MS)
    .slice(-MAX_ENTRIES);
}

/** Ajoute une entrée si la dernière date de ≥ 30 min, sinon retourne le tableau inchangé. */
export function appendEntry(
  entries: StabilityHistoryEntry[],
  entry: StabilityHistoryEntry,
): StabilityHistoryEntry[] {
  const last = entries[entries.length - 1];
  if (last && entry.ts - last.ts < MIN_INTERVAL_MS) return entries;
  return pruneEntries([...entries, entry], entry.ts);
}

function findClosestTo(
  entries: StabilityHistoryEntry[],
  targetTs: number,
  toleranceMs: number,
): StabilityHistoryEntry | null {
  let best: StabilityHistoryEntry | null = null;
  let bestDist = Infinity;
  for (const e of entries) {
    const dist = Math.abs(e.ts - targetTs);
    if (dist <= toleranceMs && dist < bestDist) {
      best = e;
      bestDist = dist;
    }
  }
  return best;
}

export function computeDelta24h(entries: StabilityHistoryEntry[], now: number): number | null {
  if (entries.length < 2) return null;
  const latest = entries[entries.length - 1];
  const reference = findClosestTo(
    entries.slice(0, -1),
    now - DELTA_TARGET_MS,
    DELTA_TOLERANCE_MS,
  );
  if (!reference) return null;
  return latest.score - reference.score;
}

export function computePillarDeltas24h(
  entries: StabilityHistoryEntry[],
  now: number,
): StabilityPillarValues | null {
  if (entries.length < 2) return null;
  const latest = entries[entries.length - 1];
  const reference = findClosestTo(
    entries.slice(0, -1),
    now - DELTA_TARGET_MS,
    DELTA_TOLERANCE_MS,
  );
  if (!reference) return null;
  return {
    continuity: latest.pillars.continuity - reference.pillars.continuity,
    security: latest.pillars.security - reference.pillars.security,
    signal: latest.pillars.signal - reference.pillars.signal,
    defense: latest.pillars.defense - reference.pillars.defense,
  };
}

export function selectSparkline(entries: StabilityHistoryEntry[], now: number): number[] {
  const valid = pruneEntries(entries, now);
  if (valid.length < 2) return [];
  if (valid.length <= SPARKLINE_MAX_POINTS) return valid.map((e) => e.score);
  const step = valid.length / SPARKLINE_MAX_POINTS;
  const series: number[] = [];
  for (let i = 0; i < SPARKLINE_MAX_POINTS; i++) {
    series.push(valid[Math.min(valid.length - 1, Math.floor(i * step))].score);
  }
  series[series.length - 1] = valid[valid.length - 1].score;
  return series;
}

/**
 * Retourne la dernière entrée si elle date de ≤ windowMs, sinon null.
 * Précondition : entrées triées chronologiquement (invariant maintenu par
 * appendEntry/loadEntries) — la dernière entrée est donc la plus récente.
 */
export function findLastWithin(
  entries: StabilityHistoryEntry[],
  now: number,
  windowMs: number,
): StabilityHistoryEntry | null {
  const last = entries[entries.length - 1];
  if (last && now - last.ts <= windowMs) return last;
  return null;
}

// ─── Wrapper localStorage ────────────────────────────────────────────────────

/** Valide que chaque pilier est un number — évite des deltas NaN silencieux sur données corrompues. */
function isPillarValues(value: unknown): value is StabilityPillarValues {
  if (typeof value !== 'object' || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.continuity === 'number'
    && typeof p.security === 'number'
    && typeof p.signal === 'number'
    && typeof p.defense === 'number'
  );
}

function loadEntries(): StabilityHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e): e is StabilityHistoryEntry =>
      typeof e === 'object' && e !== null
      && typeof (e as StabilityHistoryEntry).ts === 'number'
      && typeof (e as StabilityHistoryEntry).score === 'number'
      && isPillarValues((e as StabilityHistoryEntry).pillars),
    );
  } catch {
    return [];
  }
}

function saveEntries(entries: StabilityHistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // stockage indisponible (quota, navigation privée) : dégradation silencieuse
  }
}

export function recordStabilitySnapshot(
  score: number,
  pillars: StabilityPillarValues,
  now: number = Date.now(),
): void {
  const entries = loadEntries();
  const next = appendEntry(entries, { ts: now, score, pillars });
  if (next !== entries) saveEntries(next);
}

export function getDelta24h(now: number = Date.now()): number | null {
  return computeDelta24h(loadEntries(), now);
}

export function getPillarDeltas24h(now: number = Date.now()): StabilityPillarValues | null {
  return computePillarDeltas24h(loadEntries(), now);
}

export function getSparklineSeries(now: number = Date.now()): number[] {
  return selectSparkline(loadEntries(), now);
}

/** Score le plus récent enregistré il y a ≤ 2 h — alimente le lissage EMA du moteur v3. */
export function getPreviousScoreForSmoothing(now: number = Date.now()): number | null {
  return findLastWithin(loadEntries(), now, SMOOTHING_WINDOW_MS)?.score ?? null;
}
