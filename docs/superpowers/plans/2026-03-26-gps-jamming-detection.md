# GPS Jamming Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect GPS jamming / electronic warfare signals from ADS-B anomalies, surfaced as toast notifications following the military surges pattern.

**Architecture:** New stateful `GpsJammingDetector` in `src/services/gps-jamming.ts` — maintains per-hex NAC-P and position history, scores heuristics per aircraft, clusters spatiotemporally. Called from `startMilitaryPolling()` in `App.ts` after `detectMilitarySurges`. ToastNotification receives a `showJammingSignals()` method mirroring `showMilitarySurges`.

**Tech Stack:** Vanilla TypeScript strict, no external libs, haversine distance computation inline.

---

### Task 1: Add types

**Files:**
- Modify: `src/types/index.ts` (end of MilitaryFlight section + new section)

- [ ] Add `nacP?: number` field to `MilitaryFlight` interface (after `squawkAlert`)

- [ ] Add new `GpsJammingSignal` interface in a new `// ═══ GPS Jamming ═══` section:

```typescript
export interface GpsJammingSignal {
  id: string;                       // jamming-${timestamp}-${idx}
  position: [number, number];       // [lng, lat] centroïde zone
  timestamp: number;                // Unix seconds (Date.now() / 1000)
  severity: ThreatLevel;            // 'high' | 'medium' | 'low'
  confidence: number;               // 0.0–1.0
  reasons: string[];                // indicateurs déclencheurs
  affectedIcao24s: string[];        // ICAO24 des aéronefs impliqués
  clusterRadius?: number;           // km, si signal multi-aéronefs
}
```

---

### Task 2: NAC-P passthrough in military-flights.ts

**Files:**
- Modify: `src/services/military-flights.ts`

- [ ] Add `nac_p?: number` to `AdsbFiAircraft` interface (after `seen`)

- [ ] In `parseFlight`: add `nacP: ac.nac_p` in the returned `MilitaryFlight` object

- [ ] In `parseProxyAircraft`: add `nacP: undefined` (proxy doesn't expose NAC-P yet — best-effort mode documented)

---

### Task 3: Create gps-jamming.ts

**Files:**
- Create: `src/services/gps-jamming.ts`

Heuristics implemented (6 signals):
1. **NAC-P faible** — nacP < 4 while airborne → +0.40
2. **NAC-P chute brutale** — drop ≥ 5 levels vs previous reading → +0.25
3. **Vitesse implicite aberrante** — haversine(prev, curr) > MAX_IMPLAUSIBLE_SPEED_KMH × elapsed → +0.35
4. **Ghost track** — ≥ 4 trail points all within 3 km radius + speed > 50 kts → +0.35
5. **Vitesse sol anormale** — airborne (alt > 500 ft) + gs < 15 kts AND NOT helicopter-like → +0.15 (low weight to avoid helo FP)
6. **Cluster spatiotemporel** — ≥ 3 aircraft with score > 0 within 100 km in current snapshot → multiplier ×1.4, cap 1.0

Thresholds (named constants):
```typescript
const NACP_SUSPICIOUS = 3;
const NACP_DROP_THRESHOLD = 5;
const MAX_IMPLAUSIBLE_SPEED_KMH = 1800;  // supersonic + margin
const GHOST_TRACK_RADIUS_KM = 3;
const GHOST_TRACK_MIN_POINTS = 4;
const GHOST_TRACK_MIN_SPEED_KTS = 50;
const AIRBORNE_MIN_ALT_FT = 500;
const STALL_SPEED_KTS = 15;              // gate: low-speed anomaly
const CLUSTER_RADIUS_KM = 100;
const CLUSTER_MIN_AIRCRAFT = 3;
const CLUSTER_MULTIPLIER = 1.4;
const REPORT_INDIVIDUAL_MIN = 0.35;
const REPORT_CLUSTER_MIN = 0.50;
```

Severity mapping:
- confidence ≥ 0.70 → `high`
- confidence ≥ 0.45 → `medium`
- else → `low`

State retained per hex: nacP history (last 3 readings), last position + timestamp for speed computation.

- [ ] Implement the full module (see code below in execution)

---

### Task 4: Add showJammingSignals() to ToastNotification.ts

**Files:**
- Modify: `src/components/ToastNotification.ts`

Pattern: identical to `showMilitarySurges` / `showMilitarySurge`.
- Import `GpsJammingSignal` from types
- `seenJammingSignals: Set<string>` for dedup by position+severity
- `jammingCooldownMs = 3 * 60_000` (3 min)
- Icon: `📡` for all levels
- levelClass mapped from severity: high→`critical`, medium→`high`, low→`medium`
- Auto-dismiss: 12s for high, 8s otherwise

---

### Task 5: Wire into App.ts

**Files:**
- Modify: `src/App.ts`

- [ ] Import `detectGpsJammingSignals` from `./services/gps-jamming.ts`
- [ ] In `startMilitaryPolling()`, after the `detectMilitarySurges` block:

```typescript
const jammingSignals = detectGpsJammingSignals(flights);
if (jammingSignals.length > 0) {
  this.toastNotification?.showJammingSignals(jammingSignals);
}
```

---

### Task 6: Verify

- [ ] `npm run typecheck` — must pass with 0 errors
- [ ] `npm run build` — must produce clean output
