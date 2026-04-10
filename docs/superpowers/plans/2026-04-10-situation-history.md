# Situation History — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a multi-day history of France's national situation (CII score + active situations) stored in Upstash Redis and displayed in a new `SituationHistoryPanel`.

**Architecture:** Client-push model — `App.ts` pushes a compact `SituationSnapshot` to `POST /api/situation-history` after each `buildFranceSnapshot()` tick; the server stores it idempotently via `SET NX`. `GET /api/situation-history?days=7|30` returns the canonical slot grid with missing slots explicit. The client service caches responses in localStorage (`fm:situation-history:v1:7j|30j`, 20-min TTL). The panel renders a bar timeline with hover tooltip and inline click-detail.

**Architecture note — why client-push, not server-pull:** The spec assumed server-side Redis caches per source. In practice, most proxies (`api/energy/ecowatt.js`, `api/transport/`, etc.) use in-process memory caches — not Redis. Only `synthesis.js` and `finance/market.js` write to Redis. Building a snapshot server-side from Redis alone would produce mostly-null snapshots. The client-push approach is equivalent in intent (server is source of truth, history is shared), and mirrors the existing `api/intelligence/v1/france-intel-brief.js` pattern exactly.

**Tech Stack:** TypeScript strict (client), vanilla JS (Vercel functions), Upstash Redis REST API, localStorage, Vite, Node.js assert for tests.

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `src/types/index.ts` | Add `SituationSnapshot`, `SnapshotSituation`, `SituationSnapshotAxes`, `HistoryResponse`, `HistorySlot`, `HistoryResult` |
| Modify | `api/utils/redis.js` | Add `redisSetNX`, `redisMGet`, `redisRPush`, `redisLTrim` |
| **Create** | `api/utils/slots.js` | Pure slot-key utilities: `currentSlotKey`, `buildSlotGrid` |
| **Create** | `api/situation-history.js` | Vercel function: `POST` (push + SET NX) + `GET` (canonical grid + MGET) |
| **Create** | `src/services/situation-history.ts` | `buildSnapshotPayload`, `pushHistorySnapshot`, `getHistory`, localStorage cache |
| **Create** | `src/components/SituationHistoryPanel.ts` | Floating panel: bar timeline, toggle 7j/30j, tooltip, inline detail |
| Modify | `src/components/SituationMonitor.ts` | Add "Historique" button in header |
| Modify | `src/App.ts` | Instantiate panel, call `pushHistorySnapshot` on each snapshot tick, wire open/close |
| Modify | `src/styles/main.css` | Panel and timeline CSS |
| **Create** | `scripts/test-situation-history.mjs` | Unit tests for slot utilities |

---

## Task 1 — Types

**Files:** Modify `src/types/index.ts`

- [ ] **Add types after the `DetectedSituation` block** (around line 2000):

```typescript
// ─── Situation History ────────────────────────────────────────────────────────

export interface SituationSnapshotAxes {
  continuity: number | null;  // FranceCountryAxes.continuity — infra/ops
  defense:    number | null;  // FranceCountryAxes.defense — military posture
  security:   number | null;  // FranceCountryAxes.security — security severity
  signal:     number | null;  // FranceCountryAxes.signal — multi-source pressure
  cyber:      number | null;  // CyberState.meta.globalScore
  social:     number | null;  // ISNRData.nationalScore
}

export interface SnapshotSituation {
  id:            string;
  type:          string;
  severity:      SituationSeverity;
  title:         string;
  topDriver:     string;          // first driver, max 80 chars
  affectedZones: string[];        // max 3
  confidence:    number;
}

export interface SituationSnapshot {
  version:     1;
  slotKey:     string;            // "2026-04-10T12:00" — UTC, canonical slot
  capturedAt:  string;            // ISO8601 actual push time
  score:       number;            // CII 0–100
  axes:        SituationSnapshotAxes;
  situations:  SnapshotSituation[];
  meta: {
    totalSituations: number;
    maxSeverity:     SituationSeverity | null;
    avgConfidence:   number;
  };
  dataStatus: {
    overall:  'ok' | 'degraded';
    sources: {
      countryAxes: 'ok' | 'missing';
      cyber:       'ok' | 'missing';
      social:      'ok' | 'missing';
    };
  };
}

export type HistorySlot = SituationSnapshot | { slotKey: string; status: 'missing' };

export interface HistoryResponse {
  requestedRange: { from: string; to: string };
  slotCount: {
    expected: number;
    captured: number;
    missing:  number;
    degraded: number;
  };
  slots: HistorySlot[];
}

export interface HistoryResult {
  data:                    HistoryResponse;
  source:                  'fresh' | 'cached' | 'stale';
  fetchedAt:               string;
  isDegraded:              boolean;
  errorRecoveredFromCache: boolean;
}
```

- [ ] **Run typecheck:**
  ```bash
  npm run typecheck
  ```
  Expected: no errors.

- [ ] **Commit:**
  ```bash
  git add src/types/index.ts
  git commit -m "feat(history): add SituationSnapshot and HistoryResult types"
  ```

---

## Task 2 — Redis helpers

**Files:** Modify `api/utils/redis.js`

The existing file has `redisGet` and `redisSet`. Add four new helpers at the bottom of the file.

- [ ] **Append to `api/utils/redis.js`:**

```javascript
/**
 * SET key value NX EX ttlSec.
 * Returns true if written (key was absent), false if key already existed.
 * @param {string} key
 * @param {string} value — must already be JSON.stringify'd
 * @param {number} ttlSec
 * @returns {Promise<boolean>}
 */
export async function redisSetNX(key, value, ttlSec) {
  if (!BASE_URL || !AUTH_TOKEN) return false;
  try {
    const res = await fetch(
      `${BASE_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}/NX/EX/${ttlSec}`,
      { method: 'POST', headers: { Authorization: `Bearer ${AUTH_TOKEN}` } },
    );
    if (!res.ok) return false;
    const json = await res.json();
    return json.result === 'OK';
  } catch {
    return false;
  }
}

/**
 * MGET — fetches multiple keys in one pipeline call.
 * Returns an array of the same length as keys; absent keys are null.
 * @param {string[]} keys
 * @returns {Promise<Array<string | null>>}
 */
export async function redisMGet(keys) {
  if (!BASE_URL || !AUTH_TOKEN || keys.length === 0) return keys.map(() => null);
  try {
    const res = await fetch(`${BASE_URL}/pipeline`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([['MGET', ...keys]]),
    });
    if (!res.ok) return keys.map(() => null);
    const json = await res.json();
    return json[0]?.result ?? keys.map(() => null);
  } catch {
    return keys.map(() => null);
  }
}

/**
 * RPUSH — append value to a Redis list.
 * @param {string} key
 * @param {string} value
 * @returns {Promise<void>}
 */
export async function redisRPush(key, value) {
  if (!BASE_URL || !AUTH_TOKEN) return;
  try {
    await fetch(
      `${BASE_URL}/rpush/${encodeURIComponent(key)}/${encodeURIComponent(value)}`,
      { method: 'POST', headers: { Authorization: `Bearer ${AUTH_TOKEN}` } },
    );
  } catch {}
}

/**
 * LTRIM — trim a Redis list to the range [start, stop].
 * @param {string} key
 * @param {number} start
 * @param {number} stop
 * @returns {Promise<void>}
 */
export async function redisLTrim(key, start, stop) {
  if (!BASE_URL || !AUTH_TOKEN) return;
  try {
    await fetch(
      `${BASE_URL}/ltrim/${encodeURIComponent(key)}/${start}/${stop}`,
      { method: 'POST', headers: { Authorization: `Bearer ${AUTH_TOKEN}` } },
    );
  } catch {}
}
```

- [ ] **Commit:**
  ```bash
  git add api/utils/redis.js
  git commit -m "feat(history): add redisSetNX, redisMGet, redisRPush, redisLTrim helpers"
  ```

---

## Task 3 — Slot utilities + tests

**Files:** Create `api/utils/slots.js`, create `scripts/test-situation-history.mjs`

- [ ] **Write the failing test first** — create `scripts/test-situation-history.mjs`:

```javascript
// scripts/test-situation-history.mjs
// Run with: node scripts/test-situation-history.mjs

import assert from 'node:assert/strict';

// ── Inline the functions under test (avoid bundling for this simple module) ──
// Copy the exact implementations from api/utils/slots.js once it exists.
// For now this file will fail with "Cannot find module" — that's expected.

const { currentSlotKey, buildSlotGrid } = await import('../api/utils/slots.js');

// ─── currentSlotKey ───────────────────────────────────────────────────────────

{
  // 00:00 UTC → slot 00:00
  assert.equal(currentSlotKey(new Date('2026-04-10T00:00:00Z')), '2026-04-10T00:00');
  // 05:59 UTC → still slot 00:00
  assert.equal(currentSlotKey(new Date('2026-04-10T05:59:59Z')), '2026-04-10T00:00');
  // 06:00 UTC → slot 06:00
  assert.equal(currentSlotKey(new Date('2026-04-10T06:00:00Z')), '2026-04-10T06:00');
  // 11:59 UTC → still slot 06:00
  assert.equal(currentSlotKey(new Date('2026-04-10T11:59:59Z')), '2026-04-10T06:00');
  // 12:00 UTC → slot 12:00
  assert.equal(currentSlotKey(new Date('2026-04-10T12:00:00Z')), '2026-04-10T12:00');
  // 17:59 UTC → still slot 12:00
  assert.equal(currentSlotKey(new Date('2026-04-10T17:59:59Z')), '2026-04-10T12:00');
  // 18:00 UTC → slot 18:00
  assert.equal(currentSlotKey(new Date('2026-04-10T18:00:00Z')), '2026-04-10T18:00');
  // 23:59 UTC → still slot 18:00
  assert.equal(currentSlotKey(new Date('2026-04-10T23:59:59Z')), '2026-04-10T18:00');
  console.log('✓ currentSlotKey: all cases pass');
}

// ─── buildSlotGrid ────────────────────────────────────────────────────────────

{
  const grid = buildSlotGrid('2026-04-10T12:00', 3);
  assert.equal(grid.length, 3);
  assert.equal(grid[0], '2026-04-10T00:00');
  assert.equal(grid[1], '2026-04-10T06:00');
  assert.equal(grid[2], '2026-04-10T12:00');
  console.log('✓ buildSlotGrid: 3-slot window');
}
{
  // Cross-day boundary: 1 slot into previous day
  const grid = buildSlotGrid('2026-04-10T00:00', 2);
  assert.equal(grid[0], '2026-04-09T18:00');
  assert.equal(grid[1], '2026-04-10T00:00');
  console.log('✓ buildSlotGrid: cross-day boundary');
}
{
  // 7-day grid has 28 entries
  const grid = buildSlotGrid('2026-04-10T12:00', 28);
  assert.equal(grid.length, 28);
  assert.equal(grid[grid.length - 1], '2026-04-10T12:00');
  console.log('✓ buildSlotGrid: 28-slot 7-day grid');
}

console.log('\nAll situation-history tests passed.');
```

- [ ] **Run it — expect failure** (module not found):
  ```bash
  node scripts/test-situation-history.mjs
  ```
  Expected: error `Cannot find module '../api/utils/slots.js'`

- [ ] **Create `api/utils/slots.js`:**

```javascript
// api/utils/slots.js
// Pure UTC slot-key utilities. No external dependencies.
// Slots are fixed UTC anchors: 00:00, 06:00, 12:00, 18:00.

const SLOT_HOURS = [0, 6, 12, 18];
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

/**
 * Returns the canonical slotKey for the most recent past slot at or before `now`.
 * Format: "YYYY-MM-DDTHH:MM" (always HH = 00, 06, 12, or 18; MM = 00).
 * @param {Date} [now]
 * @returns {string}
 */
export function currentSlotKey(now = new Date()) {
  const h = now.getUTCHours();
  const slotHour = h < 6 ? 0 : h < 12 ? 6 : h < 18 ? 12 : 18;
  const d = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    slotHour, 0, 0, 0,
  ));
  return d.toISOString().slice(0, 16); // "2026-04-10T12:00"
}

/**
 * Returns the ordered list of `count` slotKeys ending at (and including) `currentSlot`.
 * @param {string} currentSlot — slotKey, e.g. "2026-04-10T12:00"
 * @param {number} count — number of slots to return (28 for 7d, 120 for 30d)
 * @returns {string[]}
 */
export function buildSlotGrid(currentSlot, count) {
  const base = new Date(currentSlot + ':00.000Z').getTime();
  const slots = [];
  for (let i = count - 1; i >= 0; i--) {
    const ms = base - i * SIX_HOURS_MS;
    const d = new Date(ms);
    slots.push(d.toISOString().slice(0, 16));
  }
  return slots;
}
```

- [ ] **Run tests — expect pass:**
  ```bash
  node scripts/test-situation-history.mjs
  ```
  Expected:
  ```
  ✓ currentSlotKey: all cases pass
  ✓ buildSlotGrid: 3-slot window
  ✓ buildSlotGrid: cross-day boundary
  ✓ buildSlotGrid: 28-slot 7-day grid

  All situation-history tests passed.
  ```

- [ ] **Commit:**
  ```bash
  git add api/utils/slots.js scripts/test-situation-history.mjs
  git commit -m "feat(history): add slot utilities + tests"
  ```

---

## Task 4 — API endpoint

**Files:** Create `api/situation-history.js`

- [ ] **Create `api/situation-history.js`:**

```javascript
// api/situation-history.js
// Vercel Node function — situation history store + read.
//
// POST /api/situation-history
//   Body: SituationSnapshot (JSON)
//   Stores the snapshot in Redis with SET NX (idempotent per slot).
//   Returns: { stored: boolean }
//
// GET /api/situation-history?days=7|30
//   Builds the canonical UTC slot grid, fetches all slots via MGET,
//   returns missing slots explicitly as { slotKey, status: "missing" }.

import { redisSetNX, redisMGet, redisRPush, redisLTrim } from '../utils/redis.js';
import { currentSlotKey, buildSlotGrid } from '../utils/slots.js';

const SNAP_TTL    = 31 * 24 * 60 * 60; // 31 days in seconds
const INDEX_KEY   = 'france:history:index';
const SLOT_RE     = /^\d{4}-\d{2}-\d{2}T(?:00|06|12|18):00$/;
const snapKey = (slot) => `france:history:${slot}`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'POST')   return handlePush(req, res);
  if (req.method === 'GET')    return handleRead(req, res);
  res.status(405).end();
}

// ─── POST ─────────────────────────────────────────────────────────────────────

async function handlePush(req, res) {
  const payload = req.body;
  if (
    !payload
    || typeof payload !== 'object'
    || typeof payload.slotKey !== 'string'
    || !SLOT_RE.test(payload.slotKey)
    || typeof payload.score !== 'number'
    || payload.version !== 1
  ) {
    return res.status(400).json({ error: 'invalid_payload' });
  }

  const key = snapKey(payload.slotKey);
  const written = await redisSetNX(key, JSON.stringify(payload), SNAP_TTL);

  // Only update the index when this client won the SET NX race.
  if (written) {
    await redisRPush(INDEX_KEY, payload.slotKey);
    await redisLTrim(INDEX_KEY, 0, 119);
  }

  res.status(200).json({ stored: written });
}

// ─── GET ──────────────────────────────────────────────────────────────────────

async function handleRead(req, res) {
  const daysParam = Number(req.query.days);
  if (daysParam !== 7 && daysParam !== 30) {
    return res.status(400).json({ error: 'days must be 7 or 30' });
  }

  const count   = daysParam * 4;
  const current = currentSlotKey();
  const grid    = buildSlotGrid(current, count);
  const keys    = grid.map(snapKey);

  const raw = await redisMGet(keys);

  const slots = grid.map((slotKey, i) => {
    if (raw[i] === null) return { slotKey, status: 'missing' };
    try {
      return JSON.parse(raw[i]);
    } catch {
      return { slotKey, status: 'missing' };
    }
  });

  const captured = slots.filter(s => !('status' in s));
  const missing  = slots.filter(s => 'status' in s);
  const degraded = captured.filter(s => s.dataStatus?.overall === 'degraded');

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    requestedRange: {
      from: grid[0] + ':00.000Z',
      to:   grid[grid.length - 1] + ':00.000Z',
    },
    slotCount: {
      expected: count,
      captured: captured.length,
      missing:  missing.length,
      degraded: degraded.length,
    },
    slots,
  });
}
```

- [ ] **Run typecheck (catches any TS usage errors in `.ts` files that import types):**
  ```bash
  npm run typecheck
  ```

- [ ] **Manual test (dev server must be running):**
  ```bash
  # In a second terminal with dev server running: npm run dev
  # Push a synthetic snapshot:
  curl -s -X POST http://localhost:3001/api/situation-history \
    -H "Content-Type: application/json" \
    -d '{"version":1,"slotKey":"2026-04-10T12:00","capturedAt":"2026-04-10T12:05:00Z","score":42,"axes":{"continuity":60,"defense":20,"security":35,"signal":40,"cyber":55,"social":30},"situations":[],"meta":{"totalSituations":0,"maxSeverity":null,"avgConfidence":0},"dataStatus":{"overall":"ok","sources":{"countryAxes":"ok","cyber":"ok","social":"ok"}}}' \
    | python3 -m json.tool
  ```
  Expected: `{ "stored": true }` first call, `{ "stored": false }` second call (same slotKey).

  ```bash
  # Read 7-day history:
  curl -s http://localhost:3001/api/situation-history?days=7 | python3 -m json.tool
  ```
  Expected: response with `slotCount.expected: 28`, one `captured`, rest `missing`.

- [ ] **Commit:**
  ```bash
  git add api/situation-history.js
  git commit -m "feat(history): add situation-history API endpoint (POST push + GET read)"
  ```

---

## Task 5 — Client service

**Files:** Create `src/services/situation-history.ts`

- [ ] **Create `src/services/situation-history.ts`:**

```typescript
/**
 * situation-history.ts — Client service for the multi-day history feature.
 *
 * pushHistorySnapshot(): fire-and-forget push after each snapshot tick.
 * getHistory(): fetch or return cached HistoryResult.
 */

import type {
  FranceCountrySnapshot,
  HistoryResponse,
  HistoryResult,
  SituationSnapshot,
  SituationSeverity,
} from '../types/index.ts';

// ─── Constants ────────────────────────────────────────────────────────────────

const SCHEMA_VERSION = 1 as const;
const CACHE_PREFIX   = `fm:situation-history:v${SCHEMA_VERSION}`;
const PUSH_FLAG_KEY  = `${CACHE_PREFIX}:last-pushed-slot`;
const CACHE_FRESH_MS = 20 * 60 * 1000; // 20 minutes
const SNAP_TTL_SEC   = 31 * 24 * 60 * 60;

// ─── Slot key (mirrors api/utils/slots.js) ────────────────────────────────────

function currentSlotKey(now = new Date()): string {
  const h = now.getUTCHours();
  const slotHour = h < 6 ? 0 : h < 12 ? 6 : h < 18 ? 12 : 18;
  const d = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    slotHour, 0, 0, 0,
  ));
  return d.toISOString().slice(0, 16);
}

// ─── Snapshot builder ─────────────────────────────────────────────────────────

function buildSnapshotPayload(
  snapshot: FranceCountrySnapshot,
  slotKey: string,
): SituationSnapshot {
  const cyberScore  = snapshot.cyber?.meta?.globalScore   ?? null;
  const socialScore = snapshot.stability?.nationalScore    ?? null;

  const sevOrder: Record<SituationSeverity, number> = {
    critical: 4, high: 3, medium: 2, watch: 1,
  };
  const maxSev: SituationSeverity | null = snapshot.situations.length > 0
    ? snapshot.situations.reduce((best, s) =>
        sevOrder[s.severity] > sevOrder[best] ? s.severity : best,
      snapshot.situations[0].severity)
    : null;

  const avgConf = snapshot.situations.length > 0
    ? snapshot.situations.reduce((sum, s) => sum + s.confidence, 0) / snapshot.situations.length
    : 0;

  return {
    version:    SCHEMA_VERSION,
    slotKey,
    capturedAt: new Date().toISOString(),
    score:      snapshot.score,
    axes: {
      continuity: snapshot.axes?.continuity ?? null,
      defense:    snapshot.axes?.defense    ?? null,
      security:   snapshot.axes?.security   ?? null,
      signal:     snapshot.axes?.signal     ?? null,
      cyber:      cyberScore,
      social:     socialScore,
    },
    situations: snapshot.situations.slice(0, 10).map(s => ({
      id:            s.id,
      type:          s.type,
      severity:      s.severity,
      title:         s.title,
      topDriver:     (s.drivers[0] ?? '').slice(0, 80),
      affectedZones: s.affectedZones.slice(0, 3),
      confidence:    s.confidence,
    })),
    meta: {
      totalSituations: snapshot.situations.length,
      maxSeverity:     maxSev,
      avgConfidence:   Math.round(avgConf * 100) / 100,
    },
    dataStatus: {
      overall: (cyberScore === null || socialScore === null) ? 'degraded' : 'ok',
      sources: {
        countryAxes: snapshot.axes ? 'ok' : 'missing',
        cyber:       cyberScore  !== null ? 'ok' : 'missing',
        social:      socialScore !== null ? 'ok' : 'missing',
      },
    },
  };
}

// ─── Push (fire-and-forget) ───────────────────────────────────────────────────

/**
 * Called after each buildFranceSnapshot() tick in App.ts.
 * Pushes a compact snapshot to the server if this slot hasn't been pushed yet.
 * Never throws — silently ignores errors.
 */
export async function pushHistorySnapshot(snapshot: FranceCountrySnapshot): Promise<void> {
  const slotKey = currentSlotKey();
  try {
    const lastPushed = localStorage.getItem(PUSH_FLAG_KEY);
    if (lastPushed === slotKey) return; // already pushed this slot from this tab
  } catch {
    // localStorage unavailable — still try the push
  }

  try {
    const payload = buildSnapshotPayload(snapshot, slotKey);
    const res = await fetch('/api/situation-history', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    if (res.ok) {
      localStorage.setItem(PUSH_FLAG_KEY, slotKey);
    }
  } catch {
    // fire-and-forget: silently ignore network errors
  }
}

// ─── Read (cache-aware) ───────────────────────────────────────────────────────

interface CacheEntry {
  fetchedAt:     string;
  schemaVersion: number;
  days:          7 | 30;
  response:      HistoryResponse;
}

function cacheKey(days: 7 | 30): string {
  return `${CACHE_PREFIX}:${days}j`;
}

function readCache(days: 7 | 30): CacheEntry | null {
  try {
    const raw = localStorage.getItem(cacheKey(days));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (entry.schemaVersion !== SCHEMA_VERSION) {
      localStorage.removeItem(cacheKey(days));
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function writeCache(days: 7 | 30, response: HistoryResponse): void {
  const entry: CacheEntry = {
    fetchedAt:     new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
    days,
    response,
  };
  try {
    localStorage.setItem(cacheKey(days), JSON.stringify(entry));
  } catch {
    // quota exceeded — ignore, degrade gracefully
  }
}

/**
 * Returns the history for the given number of days.
 * Source priority: fresh cache → network → stale cache.
 * Pass force=true to bypass cache freshness and force a network call.
 */
export async function getHistory(
  days: 7 | 30,
  force = false,
): Promise<HistoryResult> {
  const cached = readCache(days);
  const now    = Date.now();
  const isFresh = cached !== null
    && (now - new Date(cached.fetchedAt).getTime()) < CACHE_FRESH_MS;

  if (!force && isFresh && cached) {
    const degraded = cached.response.slots.some(
      s => 'status' in s || (s as SituationSnapshot).dataStatus?.overall === 'degraded',
    );
    return {
      data:                    cached.response,
      source:                  'cached',
      fetchedAt:               cached.fetchedAt,
      isDegraded:              degraded || cached.response.slotCount.missing > 0,
      errorRecoveredFromCache: false,
    };
  }

  try {
    const res  = await fetch(`/api/situation-history?days=${days}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: HistoryResponse = await res.json();
    writeCache(days, data);
    const fetchedAt = new Date().toISOString();
    const degraded  = data.slotCount.missing > 0 || data.slotCount.degraded > 0;
    return {
      data,
      source:                  'fresh',
      fetchedAt,
      isDegraded:              degraded,
      errorRecoveredFromCache: false,
    };
  } catch {
    // Network failed — fall back to stale cache if available
    if (cached) {
      const degraded = cached.response.slotCount.missing > 0 || cached.response.slotCount.degraded > 0;
      return {
        data:                    cached.response,
        source:                  'stale',
        fetchedAt:               cached.fetchedAt,
        isDegraded:              degraded,
        errorRecoveredFromCache: true,
      };
    }
    // No cache at all — return empty
    const empty: HistoryResponse = {
      requestedRange: { from: '', to: '' },
      slotCount: { expected: days * 4, captured: 0, missing: days * 4, degraded: 0 },
      slots: [],
    };
    return {
      data:                    empty,
      source:                  'stale',
      fetchedAt:               new Date().toISOString(),
      isDegraded:              true,
      errorRecoveredFromCache: true,
    };
  }
}
```

- [ ] **Run typecheck:**
  ```bash
  npm run typecheck
  ```
  Expected: no errors.

- [ ] **Commit:**
  ```bash
  git add src/services/situation-history.ts
  git commit -m "feat(history): add situation-history client service (push + cache-aware read)"
  ```

---

## Task 6 — SituationHistoryPanel

**Files:** Create `src/components/SituationHistoryPanel.ts`, modify `src/styles/main.css`

- [ ] **Add CSS to `src/styles/main.css`** (append to end):

```css
/* ─── SituationHistoryPanel ─────────────────────────────────────────── */

.sit-hist {
  position: fixed;
  bottom: 80px;
  left: 16px;
  width: 340px;
  background: var(--surface-2, #1a1a2e);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px;
  padding: 12px;
  z-index: 500;
  font-family: var(--font-mono, monospace);
  font-size: 11px;
  color: var(--text-primary, #e2e8f0);
  display: none;
}

.sit-hist.is-open { display: block; }

.sit-hist__header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.sit-hist__title {
  flex: 1;
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: var(--text-muted, #94a3b8);
}

.sit-hist__toggle-btn,
.sit-hist__refresh-btn,
.sit-hist__close-btn {
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.10);
  border-radius: 4px;
  color: var(--text-muted, #94a3b8);
  cursor: pointer;
  font-size: 10px;
  padding: 2px 7px;
  font-family: inherit;
}

.sit-hist__toggle-btn.is-active {
  background: rgba(99,102,241,0.2);
  border-color: rgba(99,102,241,0.4);
  color: #a5b4fc;
}

.sit-hist__timeline {
  display: flex;
  align-items: flex-end;
  gap: 1px;
  height: 60px;
  margin-bottom: 6px;
  position: relative;
}

.sit-hist__day-group {
  display: flex;
  align-items: flex-end;
  gap: 1px;
  margin-right: 3px;
}

.sit-hist__bar {
  width: 5px;
  border-radius: 2px 2px 0 0;
  cursor: pointer;
  transition: opacity 0.1s;
  position: relative;
  flex-shrink: 0;
}

.sit-hist__bar:hover { opacity: 0.75; }

.sit-hist__bar.is-current {
  width: 7px;
  box-shadow: 0 0 4px currentColor;
}

.sit-hist__bar.is-degraded::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: repeating-linear-gradient(90deg, rgba(255,255,255,0.3) 0px, rgba(255,255,255,0.3) 2px, transparent 2px, transparent 4px);
}

.sit-hist__missing {
  width: 5px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.sit-hist__missing-dot {
  width: 1px;
  height: 20px;
  border-left: 1px dashed rgba(255,255,255,0.15);
}

.sit-hist__day-labels {
  display: flex;
  font-size: 9px;
  color: var(--text-muted, #94a3b8);
  margin-bottom: 8px;
  overflow: hidden;
}

.sit-hist__day-label {
  flex-shrink: 0;
  margin-right: 3px;
  width: 23px; /* 4 bars × 5px + 3 gaps × 1px + margin */
  white-space: nowrap;
  overflow: hidden;
}

.sit-hist__tooltip {
  position: fixed;
  background: rgba(15,15,25,0.95);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 11px;
  max-width: 220px;
  pointer-events: none;
  z-index: 9999;
  display: none;
}

.sit-hist__tooltip.is-visible { display: block; }

.sit-hist__tooltip-date {
  font-weight: 700;
  margin-bottom: 4px;
  color: #e2e8f0;
}

.sit-hist__tooltip-score { color: var(--text-muted, #94a3b8); margin-bottom: 4px; }

.sit-hist__tooltip-situ {
  display: flex;
  gap: 4px;
  margin-top: 3px;
  align-items: baseline;
}

.sit-hist__detail {
  border-top: 1px solid rgba(255,255,255,0.06);
  margin-top: 8px;
  padding-top: 8px;
}

.sit-hist__detail-title {
  font-weight: 700;
  margin-bottom: 6px;
  color: var(--text-muted, #94a3b8);
  font-size: 10px;
  letter-spacing: 0.05em;
}

.sit-hist__detail-item {
  display: flex;
  gap: 6px;
  align-items: baseline;
  margin-bottom: 5px;
  font-size: 11px;
}

.sit-hist__detail-sev {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 3px;
  flex-shrink: 0;
}

.sit-hist__footer {
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px solid rgba(255,255,255,0.05);
  color: var(--text-muted, #94a3b8);
  font-size: 9px;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.sit-hist__footer-warn { color: #f97316; }
```

- [ ] **Create `src/components/SituationHistoryPanel.ts`:**

```typescript
/**
 * SituationHistoryPanel.ts — Multi-day history of France's national situation.
 *
 * Floating panel, opened on demand. Renders a bar timeline (7j or 30j).
 * Each bar = one 6h slot. Missing slots shown as dashed markers.
 * Hover = tooltip. Click bar = inline detail.
 */

import type {
  HistoryResult,
  SituationSnapshot,
  SituationSeverity,
  HistorySlot,
} from '../types/index.ts';
import { getHistory } from '../services/situation-history.ts';

// ─── Colors ───────────────────────────────────────────────────────────────────

const SEV_COLOR: Record<SituationSeverity, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#eab308',
  watch:    '#3b82f6',
};

const SEV_LABEL: Record<SituationSeverity, string> = {
  critical: 'CRIT',
  high:     'ÉLEVÉ',
  medium:   'MOYEN',
  watch:    'VEILLE',
};

const TYPE_ICON: Record<string, string> = {
  ENERGY_STRESS:           '⚡',
  IMPORT_DEPENDENCY_RISK:  '🔌',
  FLOOD_CRISIS:            '🌊',
  WILDFIRE_ESCALATION:     '🔥',
  CYBER_PRESSURE:          '🛡️',
  SOCIAL_ESCALATION:       '📢',
  TELECOM_DISRUPTION:      '📡',
  MARITIME_ANOMALY:        '⚓',
  DEFENSE_SIGNAL_ELEVATED: '✈️',
  FUEL_SUPPLY_RISK:        '⛽',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function slotKeyToLabel(slotKey: string): string {
  // "2026-04-10T12:00" → "10 avr. 12h"
  const d = new Date(slotKey + ':00.000Z');
  const months = ['jan.','fév.','mar.','avr.','mai','juin','juil.','août','sep.','oct.','nov.','déc.'];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2,'0')}h`;
}

function dayLabelFromSlotKey(slotKey: string): string {
  // "2026-04-10T00:00" → "10/04"
  const [datePart] = slotKey.split('T');
  const [, m, d] = datePart.split('-');
  return `${d}/${m}`;
}

/** Group contiguous slots by UTC day for rendering. */
function groupByDay(slots: HistorySlot[]): HistorySlot[][] {
  const groups: HistorySlot[][] = [];
  let current: HistorySlot[] = [];
  let currentDay = '';
  for (const slot of slots) {
    const day = slot.slotKey.split('T')[0];
    if (day !== currentDay) {
      if (current.length) groups.push(current);
      current = [slot];
      currentDay = day;
    } else {
      current.push(slot);
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

/** Aggregate a day group for 30d view. */
function aggregateDay(group: HistorySlot[]): {
  slotKey: string;
  avgScore: number;
  maxSeverity: SituationSeverity | null;
  captured: number;
  total: number;
  hasDegraded: boolean;
} {
  const captured = group.filter(s => !('status' in s)) as SituationSnapshot[];
  const total    = group.length;
  if (captured.length === 0) {
    return { slotKey: group[0].slotKey, avgScore: 0, maxSeverity: null, captured: 0, total, hasDegraded: false };
  }
  const avgScore = captured.reduce((sum, s) => sum + s.score, 0) / captured.length;
  const sevOrder: Record<SituationSeverity, number> = { critical: 4, high: 3, medium: 2, watch: 1 };
  const maxSeverity: SituationSeverity | null = captured.reduce<SituationSeverity | null>((best, s) => {
    const msev = s.meta.maxSeverity;
    if (!msev) return best;
    if (!best) return msev;
    return sevOrder[msev] > sevOrder[best] ? msev : best;
  }, null);
  const hasDegraded = captured.some(s => s.dataStatus.overall === 'degraded');
  return { slotKey: group[0].slotKey, avgScore: Math.round(avgScore), maxSeverity, captured: captured.length, total, hasDegraded };
}

// ─── Component ────────────────────────────────────────────────────────────────

export class SituationHistoryPanel {
  private el: HTMLElement;
  private tooltipEl: HTMLElement;
  private historyResult: HistoryResult | null = null;
  private currentDays: 7 | 30 = 7;
  private selectedSlotKey: string | null = null;
  private loading = false;
  private onOpenHistory?: () => void;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'sit-hist';
    container.appendChild(this.el);

    // Global tooltip element
    this.tooltipEl = document.createElement('div');
    this.tooltipEl.className = 'sit-hist__tooltip';
    document.body.appendChild(this.tooltipEl);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  open(): void {
    this.el.classList.add('is-open');
    if (!this.historyResult) {
      this.load(false);
    }
  }

  close(): void {
    this.el.classList.remove('is-open');
    this.hideTooltip();
  }

  isOpen(): boolean {
    return this.el.classList.contains('is-open');
  }

  destroy(): void {
    this.tooltipEl.remove();
    this.el.remove();
  }

  // ── Internal ────────────────────────────────────────────────────────────────

  private async load(force: boolean): Promise<void> {
    this.loading = true;
    this.renderShell(); // show loading state immediately
    try {
      this.historyResult = await getHistory(this.currentDays, force);
    } catch {
      // getHistory never throws, but be safe
    }
    this.loading = false;
    this.selectedSlotKey = null;
    this.render();
  }

  private renderShell(): void {
    this.el.innerHTML = `
      ${this.renderHeader()}
      <div style="padding: 12px 0; text-align: center; color: var(--text-muted, #94a3b8); font-size: 10px;">
        Chargement…
      </div>
    `;
    this.attachHeaderListeners();
  }

  private render(): void {
    if (!this.historyResult) { this.renderShell(); return; }
    this.el.innerHTML = `
      ${this.renderHeader()}
      ${this.renderTimeline()}
      ${this.renderDayLabels()}
      ${this.selectedSlotKey ? this.renderDetail() : ''}
      ${this.renderFooter()}
    `;
    this.attachHeaderListeners();
    this.attachBarListeners();
  }

  private renderHeader(): string {
    return `
      <div class="sit-hist__header">
        <span class="sit-hist__title">Historique situation</span>
        <button class="sit-hist__toggle-btn ${this.currentDays === 7 ? 'is-active' : ''}" data-days="7" type="button">7j</button>
        <button class="sit-hist__toggle-btn ${this.currentDays === 30 ? 'is-active' : ''}" data-days="30" type="button">30j</button>
        <button class="sit-hist__refresh-btn" type="button" title="Actualiser">↺</button>
        <button class="sit-hist__close-btn" type="button" title="Fermer">✕</button>
      </div>
    `;
  }

  private renderTimeline(): string {
    if (!this.historyResult) return '';
    const slots = this.historyResult.data.slots;

    if (this.currentDays === 7) {
      return this.renderTimeline7j(slots);
    } else {
      return this.renderTimeline30j(slots);
    }
  }

  private renderTimeline7j(slots: HistorySlot[]): string {
    const groups = groupByDay(slots);
    const dayGroups = groups.map(group => {
      const bars = group.map((slot, slotIdx) => {
        const globalIdx = slots.indexOf(slot);
        return this.renderBar(slot, globalIdx, slotIdx === group.length - 1 && groups.indexOf(group) === groups.length - 1);
      }).join('');
      return `<div class="sit-hist__day-group">${bars}</div>`;
    }).join('');
    return `<div class="sit-hist__timeline">${dayGroups}</div>`;
  }

  private renderTimeline30j(slots: HistorySlot[]): string {
    const groups = groupByDay(slots);
    const bars = groups.map((group, gi) => {
      const agg = aggregateDay(group);
      if (agg.captured === 0) {
        return `<div class="sit-hist__missing" data-slot="${escapeHtml(agg.slotKey)}" data-idx="${gi}"><div class="sit-hist__missing-dot"></div></div>`;
      }
      const barH    = Math.max(3, Math.round((agg.avgScore / 100) * 56));
      const color   = agg.maxSeverity ? SEV_COLOR[agg.maxSeverity] : 'rgba(255,255,255,0.15)';
      const partial = agg.captured < agg.total;
      const isSel   = this.selectedSlotKey === agg.slotKey;
      return `
        <div class="sit-hist__bar ${partial ? 'is-degraded' : ''} ${agg.hasDegraded ? 'is-degraded' : ''}"
          style="height:${barH}px;background:${color};${isSel ? `outline:1px solid ${color};` : ''}"
          data-slot="${escapeHtml(agg.slotKey)}"
          data-idx="${gi}"
          data-score="${agg.avgScore}"
          data-sev="${agg.maxSeverity ?? ''}"
          data-partial="${agg.captured}/${agg.total}">
        </div>`;
    }).join('');
    return `<div class="sit-hist__timeline" style="gap:2px;">${bars}</div>`;
  }

  private renderBar(slot: HistorySlot, idx: number, isCurrent: boolean): string {
    if ('status' in slot) {
      return `<div class="sit-hist__missing" data-slot="${escapeHtml(slot.slotKey)}" data-idx="${idx}"><div class="sit-hist__missing-dot"></div></div>`;
    }
    const snap   = slot as SituationSnapshot;
    const barH   = Math.max(3, Math.round((snap.score / 100) * 56));
    const color  = snap.meta.maxSeverity ? SEV_COLOR[snap.meta.maxSeverity] : 'rgba(255,255,255,0.2)';
    const isSel  = this.selectedSlotKey === snap.slotKey;
    const isDeg  = snap.dataStatus.overall === 'degraded';
    return `
      <div class="sit-hist__bar ${isCurrent ? 'is-current' : ''} ${isDeg ? 'is-degraded' : ''}"
        style="height:${barH}px;background:${color};color:${color};${isSel ? `outline:1px solid ${color};` : ''}"
        data-slot="${escapeHtml(snap.slotKey)}"
        data-idx="${idx}">
      </div>`;
  }

  private renderDayLabels(): string {
    if (!this.historyResult) return '';
    const slots = this.historyResult.data.slots;
    const groups = groupByDay(slots);

    // Show label for every Nth day to avoid crowding
    const showEvery = this.currentDays === 7 ? 1 : 5;
    const labels = groups.map((group, i) => {
      const text = i % showEvery === 0 ? dayLabelFromSlotKey(group[0].slotKey) : '';
      return `<div class="sit-hist__day-label">${escapeHtml(text)}</div>`;
    }).join('');
    return `<div class="sit-hist__day-labels">${labels}</div>`;
  }

  private renderDetail(): string {
    if (!this.historyResult || !this.selectedSlotKey) return '';
    const slot = this.historyResult.data.slots.find(s => s.slotKey === this.selectedSlotKey);
    if (!slot || 'status' in slot) return '';
    const snap = slot as SituationSnapshot;

    if (snap.situations.length === 0) {
      return `<div class="sit-hist__detail"><div class="sit-hist__detail-title">${escapeHtml(slotKeyToLabel(snap.slotKey))} — Aucune situation active</div></div>`;
    }

    const items = snap.situations.map(s => {
      const color   = SEV_COLOR[s.severity];
      const icon    = TYPE_ICON[s.type] ?? '⚠️';
      const sevLbl  = SEV_LABEL[s.severity];
      const zones   = s.affectedZones.join(', ');
      return `
        <div class="sit-hist__detail-item">
          <span class="sit-hist__detail-sev" style="background:${color}22;color:${color};border:1px solid ${color}44;">${escapeHtml(sevLbl)}</span>
          <span>${icon} ${escapeHtml(s.title)}${zones ? ` — <span style="color:var(--text-muted)">${escapeHtml(zones)}</span>` : ''}</span>
        </div>`;
    }).join('');

    return `
      <div class="sit-hist__detail">
        <div class="sit-hist__detail-title">${escapeHtml(slotKeyToLabel(snap.slotKey))} — CII ${snap.score}/100</div>
        ${items}
      </div>`;
  }

  private renderFooter(): string {
    if (!this.historyResult) return '';
    const r = this.historyResult;
    const age  = Math.round((Date.now() - new Date(r.fetchedAt).getTime()) / 60_000);
    const src  = r.source === 'fresh' ? `Serveur · il y a ${age} min`
               : r.source === 'cached' ? `Cache local · ${age} min`
               : `Réseau indisponible — données locales`;

    const warn = r.isDegraded
      ? `<span class="sit-hist__footer-warn">⚠ ${r.data.slotCount.missing} slots non capturés</span>`
      : '';

    return `
      <div class="sit-hist__footer">
        <span>${escapeHtml(src)}</span>
        ${warn}
      </div>`;
  }

  // ── Event listeners ─────────────────────────────────────────────────────────

  private attachHeaderListeners(): void {
    this.el.querySelector('.sit-hist__close-btn')?.addEventListener('click', () => this.close());
    this.el.querySelector('.sit-hist__refresh-btn')?.addEventListener('click', () => this.load(true));
    this.el.querySelectorAll<HTMLElement>('[data-days]').forEach(btn => {
      btn.addEventListener('click', () => {
        const days = Number(btn.dataset.days) as 7 | 30;
        if (days === this.currentDays) return;
        this.currentDays = days;
        this.historyResult = null;
        this.selectedSlotKey = null;
        this.load(false);
      });
    });
  }

  private attachBarListeners(): void {
    this.el.querySelectorAll<HTMLElement>('.sit-hist__bar, .sit-hist__missing').forEach(bar => {
      bar.addEventListener('mouseenter', e => this.showTooltip(e, bar));
      bar.addEventListener('mouseleave', () => this.hideTooltip());
      bar.addEventListener('click', () => {
        const slotKey = bar.dataset.slot ?? null;
        this.selectedSlotKey = this.selectedSlotKey === slotKey ? null : slotKey;
        this.render();
      });
    });
  }

  private showTooltip(e: MouseEvent, bar: HTMLElement): void {
    const slotKey = bar.dataset.slot;
    if (!slotKey || !this.historyResult) return;

    const slot = this.historyResult.data.slots.find(s => s.slotKey === slotKey);
    if (!slot) return;

    let content: string;
    if ('status' in slot) {
      content = `<div class="sit-hist__tooltip-date">${escapeHtml(slotKeyToLabel(slotKey))}</div><div style="color:var(--text-muted)">Non capturé</div>`;
    } else {
      const snap     = slot as SituationSnapshot;
      const sevLbl   = snap.meta.maxSeverity ? SEV_LABEL[snap.meta.maxSeverity] : '—';
      const sevColor = snap.meta.maxSeverity ? SEV_COLOR[snap.meta.maxSeverity] : 'inherit';
      const situations = snap.situations.slice(0, 2).map(s =>
        `<div class="sit-hist__tooltip-situ">${TYPE_ICON[s.type] ?? '⚠️'} ${escapeHtml(s.title)}</div>`
      ).join('');
      const more = snap.situations.length > 2 ? `<div style="color:var(--text-muted);margin-top:2px;">+${snap.situations.length - 2} autres</div>` : '';
      content = `
        <div class="sit-hist__tooltip-date">${escapeHtml(slotKeyToLabel(slotKey))}</div>
        <div class="sit-hist__tooltip-score">CII : ${snap.score}/100 · <span style="color:${sevColor}">${escapeHtml(sevLbl)}</span></div>
        ${situations}${more}`;
    }

    this.tooltipEl.innerHTML = content;
    this.tooltipEl.classList.add('is-visible');
    const x = Math.min(e.clientX + 12, window.innerWidth - 240);
    const y = Math.min(e.clientY - 10, window.innerHeight - 120);
    this.tooltipEl.style.left = `${x}px`;
    this.tooltipEl.style.top  = `${y}px`;
  }

  private hideTooltip(): void {
    this.tooltipEl.classList.remove('is-visible');
  }
}
```

- [ ] **Run typecheck:**
  ```bash
  npm run typecheck
  ```
  Expected: no errors.

- [ ] **Commit:**
  ```bash
  git add src/components/SituationHistoryPanel.ts src/styles/main.css
  git commit -m "feat(history): add SituationHistoryPanel component + CSS"
  ```

---

## Task 7 — Wiring

**Files:** Modify `src/components/SituationMonitor.ts`, modify `src/App.ts`

### 7a — Add history button to SituationMonitor

The footer of `SituationMonitor` currently shows the "voir tout" toggle. Add a persistent "Historique" button in the header, alongside the collapse toggle.

- [ ] **In `SituationMonitor.ts`, find the `private onHistoryOpen` callback and add it to the class:**

Add after the existing private fields (around line 88):
```typescript
private onHistoryOpen: (() => void) | null = null;

setOnHistoryOpen(handler: () => void): void {
  this.onHistoryOpen = handler;
}
```

- [ ] **In the header HTML inside `render()` (around line 159), add the history button:**

Replace:
```typescript
      <header class="sit-mon__header">
        <span class="sit-mon__dot" style="background:${worstColor};"></span>
        <span class="sit-mon__title">${headerLabel}</span>
        <span class="sit-mon__count">${total}</span>
        <button class="sit-mon__toggle" type="button" title="${collapseTitle}" aria-label="${collapseTitle}">
          ${this.collapsed ? '▲' : '▼'}
        </button>
      </header>
```

With:
```typescript
      <header class="sit-mon__header">
        <span class="sit-mon__dot" style="background:${worstColor};"></span>
        <span class="sit-mon__title">${headerLabel}</span>
        <span class="sit-mon__count">${total}</span>
        <button class="sit-mon__hist-btn" type="button" title="Historique" style="font-size:10px;padding:1px 5px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.10);border-radius:3px;color:#94a3b8;cursor:pointer;font-family:inherit;">hist.</button>
        <button class="sit-mon__toggle" type="button" title="${collapseTitle}" aria-label="${collapseTitle}">
          ${this.collapsed ? '▲' : '▼'}
        </button>
      </header>
```

- [ ] **After the header click listener in `render()` (around line 177), add:**

```typescript
    this.el.querySelector<HTMLElement>('.sit-mon__hist-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onHistoryOpen?.();
    });
```

### 7b — Wire up in App.ts

- [ ] **Add import at the top of `src/App.ts`** (with the other component imports):
```typescript
import { SituationHistoryPanel } from './components/SituationHistoryPanel.ts';
import { pushHistorySnapshot } from './services/situation-history.ts';
```

- [ ] **Add private field** (near the other panel fields, around line 1208):
```typescript
private situationHistoryPanel: SituationHistoryPanel | null = null;
```

- [ ] **In the method that initializes panels** (near where `situationMonitor` is created, around line 2895), add:
```typescript
    this.situationHistoryPanel?.destroy();
    this.situationHistoryPanel = new SituationHistoryPanel(mapEl);
    this.situationMonitor?.setOnHistoryOpen(() => {
      this.situationHistoryPanel?.open();
    });
```

- [ ] **In the method that calls `situationMonitor.update()` (around line 4999), add the push call after the update:**
```typescript
    this.situationMonitor?.update(snapshot.situations, lang);
    // Fire-and-forget history push — never blocks the UI tick
    void pushHistorySnapshot(snapshot);
```

- [ ] **Run build:**
  ```bash
  npm run build
  ```
  Expected: clean build, no TypeScript errors.

- [ ] **Run typecheck:**
  ```bash
  npm run typecheck
  ```
  Expected: no errors.

- [ ] **Commit:**
  ```bash
  git add src/components/SituationMonitor.ts src/App.ts
  git commit -m "feat(history): wire SituationHistoryPanel into App.ts + SituationMonitor"
  ```

---

## Manual Acceptance Test

With `npm run dev` running:

1. Open the app and let it load fully.
2. In DevTools → Network, confirm a `POST /api/situation-history` fires with a `SituationSnapshot` body.
3. Confirm the response is `{ stored: true }` on first load of a new slot, `{ stored: false }` on subsequent calls in the same slot.
4. Click the "hist." button in the SituationMonitor header — the history panel should open.
5. Confirm the 7j timeline renders (mostly `missing` slots on first day, some bars if Redis has data).
6. Click the 30j toggle — confirm the view switches.
7. Click Actualiser — confirm a network call to `GET /api/situation-history?days=30` fires.
8. Hover over a bar — confirm tooltip appears with date and CII score.
9. Click a captured bar — confirm inline detail appears below the timeline.
10. Kill network (DevTools → Offline) and click Actualiser — confirm the panel shows `Réseau indisponible — données locales` and still displays cached data.

---

## Spec Reference

[docs/superpowers/specs/2026-04-10-situation-history-design.md](../specs/2026-04-10-situation-history-design.md)
