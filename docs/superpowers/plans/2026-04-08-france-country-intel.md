# France Country Intel Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract all CII/axes computation from `FranceIntelPanel.ts` into a central engine `france-country-intel.ts`, wire `App.ts` to call it, and make `FranceIntelPanel` a pure renderer of the resulting `FranceCountrySnapshot`.

**Architecture:** App.ts assembles `FranceRawData` and calls `buildFranceCountrySnapshot(raw)` → receives a `FranceCountrySnapshot` with pre-computed `signals`, `axes`, `score`, and `briefContext` → passes it directly to the panel and to `fetchFranceIntelBrief`. Zero behavioral change: formulas and CII ponderation are identical to prod.

**Tech Stack:** TypeScript strict, Vanilla DOM, Vite 6, no test framework (validation = `npm run typecheck && npm run build`).

---

## File Map

| Action | Path | What changes |
|---|---|---|
| Modify | `src/types/index.ts` | Add 4 new exports; remove `FranceIntelData` + `FranceIntelOperationalSummary` |
| Create | `src/services/france-country-intel.ts` | New engine — all computation lives here |
| Modify | `src/App.ts` | Replace `buildFranceIntelData` with thin wrapper; fix 4 callsites |
| Modify | `src/components/FranceIntelPanel.ts` | Remove 4 compute funcs; update `show()` + `renderContent()` |
| Modify | `src/services/france-intel-brief.ts` | New signature `fetchFranceIntelBrief(ctx, lang)` |
| Modify | `src/plugins/france-intel-proxy.ts` | Comment-only update |
| Modify | `api/intelligence/v1/france-intel-brief.js` | Comment-only update |

---

## Task 1 — Add new types + remove old ones (`src/types/index.ts`)

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Read the current type definitions to locate line numbers**

```bash
grep -n "FranceIntelOperationalSummary\|FranceIntelData\|export interface FranceIntel" src/types/index.ts
```

Expected: lines for `FranceIntelOperationalSummary` (~1210) and `FranceIntelData` (~1254).

- [ ] **Step 2: Replace `FranceIntelOperationalSummary` with `FranceCountrySignals`**

Find the block:
```typescript
export interface FranceIntelOperationalSummary {
  criticalNews: number;
  highNews: number;
  weatherAlerts: number;
  floodAlerts: number;
  fireDetections: number;
  railDisruptions: number;
  railSevere: number;
  roadIncidents: number;
  powerOutages: number;
  telecomOutages: number;
  cyberAlerts: number;
  cyberCritical: number;
  militaryFlights: number;
  maritimeTrafficFrance: number;
  defenseAlerts: number;
  defenseHigh: number;
  jammingSignals: number;
  marketStress: number;
}
```

Replace entirely with:
```typescript
export interface FranceCountrySignals {
  // News
  criticalNews: number;
  highNews: number;
  topNewsCount: number;      // min(newsItems.length, 20) — used in information axis formula
  // Météo / crues / feux (severe levels only)
  meteoAlerts: number;       // orange | red | violet
  floodAlerts: number;       // orange | red
  fireDetections: number;
  // Transport
  railDisruptions: number;
  railSevere: number;
  roadIncidents: number;
  // Infrastructure
  powerOutages: number;
  telecomOutages: number;
  // Cyber
  cyberAlerts: number;
  cyberCritical: number;
  // Defense / intelligence
  militaryFlights: number;
  maritimeTrafficFrance: number;
  defenseAlerts: number;
  defenseHigh: number;
  jammingSignals: number;
  // Finance (weak signal)
  marketStress: number;
}

export interface FranceCountryAxes {
  troubles: number;    // 0–100 — civil unrest / perturbation
  conflict: number;    // 0–100 — military posture / confrontation
  security: number;    // 0–100 — security severity
  information: number; // 0–100 — multi-source signal pressure
}

export interface FranceBriefContext {
  score: number;
  axes: FranceCountryAxes;
  signals: FranceCountrySignals;
  topHeadlines: string[];              // max 6 normalized titles
  ecowattSignal: string | null;
  meteoMaxLevel: string | null;
  cyberScore: number;
  isnrComponents: { social: number; security: number; infra: number };
  energySummary: FranceIntelEnergySummary | null;
}

export interface FranceCountrySnapshot {
  // Computed by the engine
  signals: FranceCountrySignals;
  axes: FranceCountryAxes;
  score: number;                       // CII 0–100
  briefContext: FranceBriefContext;
  // Raw data for the renderer (mirrors old FranceIntelData fields)
  stability: ISNRData;
  cyber: CyberState;
  meteo: MeteoAlert[];
  topNews: NewsItem[];
  energy: FranceIntelEnergySummary | null;
  timeline: { days: string[]; lanes: FranceIntelTimelineLane[] };
  brief?: string | null;
  briefLang: 'fr' | 'en';
  briefFreshness?: 'fresh' | 'cached';
}
```

- [ ] **Step 3: Replace `FranceIntelData` with a deprecated alias (keeps it buildable during migration)**

Find the block:
```typescript
export interface FranceIntelData {
  /** ISNRData — full national stability data. ...
```

Replace entirely with:
```typescript
/** @deprecated Use FranceCountrySnapshot instead. Removed after migration. */
export type FranceIntelData = FranceCountrySnapshot;
```

This alias lets the build pass while the panel and App.ts are being updated. It will be fully deleted in Task 4.

- [ ] **Step 4: Verify typecheck still passes**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck 2>&1 | head -40
```

Expected: zero new errors (or only errors about `operational` field no longer existing — those will be fixed in Tasks 3 and 4).

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts
git commit -m "feat: add FranceCountrySignals/Axes/Snapshot types, deprecate FranceIntelData"
```

---

## Task 2 — Create the engine (`src/services/france-country-intel.ts`)

**Files:**
- Create: `src/services/france-country-intel.ts`

- [ ] **Step 1: Create the file with all imports and the `FranceRawData` input type**

```typescript
// src/services/france-country-intel.ts
// Central country-intel engine for FranceMonitor.
// Inspired by WorldMonitor's country-intel.ts pattern.
// App.ts assembles FranceRawData and calls buildFranceCountrySnapshot().
// FranceIntelPanel and france-intel-brief consume the resulting FranceCountrySnapshot.

import type {
  NewsItem,
  ISNRData,
  ISNRScore,
  ISNRDimensionScores,
  CyberState,
  MeteoAlert,
  FloodSegment,
  SncfDisruption,
  TrafficIncident,
  PowerOutage,
  TelecomOutage,
  DefenseAlert,
  GpsJammingSignal,
  ActiveFire,
  MarketData,
  EcowattResponse,
  NuclearState,
  EolienLive,
  FranceIntelEnergySummary,
  FranceIntelTimelineLane,
  FranceCountrySignals,
  FranceCountryAxes,
  FranceBriefContext,
  FranceCountrySnapshot,
} from '@/types/index.ts';

/**
 * All raw data App.ts passes to the engine.
 * Exported so App.ts can type its local variable; otherwise internal to this module.
 */
export interface FranceRawData {
  newsItems: NewsItem[];
  isnrData: ISNRData | null;
  cyberData: CyberState | null;
  meteoAlerts: MeteoAlert[];
  floodSegments: FloodSegment[];
  sncfDisruptions: SncfDisruption[];
  trafficIncidents: TrafficIncident[];
  powerOutages: PowerOutage[];
  telecomOutages: TelecomOutage[];
  defenseAlerts: DefenseAlert[];
  jammingSignals: GpsJammingSignal[];
  militaryFlightsCount: number;
  maritimeCount: number;
  activeFires: ActiveFire[];
  marketData: MarketData[];            // array, never null
  ecowattResponse: EcowattResponse | null;
  nuclearState: NuclearState | null;
  eolienLive: EolienLive | null;
  timeline: { days: string[]; lanes: FranceIntelTimelineLane[] };
  briefLang: 'fr' | 'en';
}
```

- [ ] **Step 2: Add the private `avgDim` helper (ported from `FranceIntelPanel.ts`)**

Append after the imports block:

```typescript
// ─── Private helpers ────────────────────────────────────────────────────────

/** Average of one ISNR dimension across active departments only. */
function avgDim(scores: ISNRScore[], key: keyof ISNRDimensionScores): number {
  const active = scores.filter((s) => s.score > 0 || s.eventCount > 0);
  if (active.length === 0) return 0;
  const sum = active.reduce((acc, s) => acc + (s.dimensions?.[key] ?? 0), 0);
  return Math.round(sum / active.length);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Build FranceIntelEnergySummary from raw energy sources. */
function buildEnergySnapshot(raw: FranceRawData): FranceIntelEnergySummary | null {
  const nationalMix = raw.ecowattResponse?.national ?? null;
  if (!nationalMix) return null;
  const totalMw = nationalMix.total > 0 ? Math.round(nationalMix.total) : null;
  const share = (value: number): number => {
    if (!totalMw || totalMw <= 0) return 0;
    return Math.round((value / nationalMix.total) * 100);
  };
  const signalValues = Object.values(raw.ecowattResponse?.signals ?? {});
  const ecowattSignal: 'red' | 'orange' | 'green' | null =
    signalValues.includes('red') ? 'red'
    : signalValues.includes('orange') ? 'orange'
    : signalValues.includes('green') ? 'green'
    : null;
  return {
    ecowattSignal,
    totalMw,
    shares: {
      nuclear: share(nationalMix.nuclear),
      gas:     share(nationalMix.gas),
      hydro:   share(nationalMix.hydro),
      wind:    share(nationalMix.wind),
      solar:   share(nationalMix.solar),
      other:   share(nationalMix.other),
    },
    nuclearStress: raw.nuclearState?.stress
      ? Math.round(raw.nuclearState.stress.stressRatio * 100)
      : null,
    windGw:         raw.eolienLive?.production_gw ?? null,
    windLoadFactor: raw.eolienLive
      ? Math.round(raw.eolienLive.facteur_charge * 100)
      : null,
  };
}
```

- [ ] **Step 3: Add `buildFranceSignals` (pipeline step 1)**

```typescript
// ─── Pipeline ────────────────────────────────────────────────────────────────

/**
 * Step 1 — normalize raw sources into typed signal counts.
 * All filtering semantics match what App.ts buildFranceIntelData() does today.
 */
export function buildFranceSignals(raw: FranceRawData): FranceCountrySignals {
  const criticalNews = raw.newsItems.filter((i) => i.threat?.level === 'critical').length;
  const highNews     = raw.newsItems.filter((i) => i.threat?.level === 'high').length;
  const topNewsCount = Math.min(raw.newsItems.length, 20);

  const cyber = raw.cyberData ?? null;

  const railSevere  = raw.sncfDisruptions.filter(
    (d) => d.severity === 'critical' || d.severity === 'high',
  ).length;
  const defenseHigh = raw.defenseAlerts.filter((a) => a.severity === 'high').length;
  const marketStress = raw.marketData.filter((m) => m.changePercent <= -1).length;

  return {
    criticalNews,
    highNews,
    topNewsCount,
    meteoAlerts:  raw.meteoAlerts.filter(
      (a) => a.level === 'orange' || a.level === 'red' || a.level === 'violet',
    ).length,
    floodAlerts:  raw.floodSegments.filter(
      (s) => s.level === 'orange' || s.level === 'red',
    ).length,
    fireDetections:        raw.activeFires.length,
    railDisruptions:       raw.sncfDisruptions.length,
    railSevere,
    roadIncidents:         raw.trafficIncidents.length,
    powerOutages:          raw.powerOutages.length,
    telecomOutages:        raw.telecomOutages.length,
    cyberAlerts:           cyber?.alerts.count30d ?? 0,
    cyberCritical:         cyber?.vulnerabilities.criticalCount ?? 0,
    militaryFlights:       raw.militaryFlightsCount,
    maritimeTrafficFrance: raw.maritimeCount,
    defenseAlerts:         raw.defenseAlerts.length,
    defenseHigh,
    jammingSignals:        raw.jammingSignals.length,
    marketStress,
  };
}
```

- [ ] **Step 4: Add `computeFranceAxes` (pipeline step 2)**

Exact prod formulas ported from `FranceIntelPanel.ts computeNationalPostureAxes()`:

```typescript
/**
 * Step 2 — compute the 4 national posture axes (0–100 each).
 * Formulas identical to prod FranceIntelPanel.ts — zero behavioral change.
 */
export function computeFranceAxes(
  signals: FranceCountrySignals,
  isnr: ISNRData | null,
): FranceCountryAxes {
  const scores = isnr?.scores ?? [];
  const isnrSocial    = avgDim(scores, 'social');
  const isnrSecurity  = avgDim(scores, 'security');

  const troubles = clamp(Math.max(
    isnrSocial,
    signals.highNews * 5
      + signals.railDisruptions * 2
      + signals.roadIncidents
      + (signals.powerOutages + signals.telecomOutages) * 3,
  ));

  const conflict = clamp(
    signals.defenseAlerts * 18
      + signals.jammingSignals * 16
      + Math.min(signals.militaryFlights, 20) * 2
      + Math.min(signals.maritimeTrafficFrance, 20),
  );

  const security = clamp(Math.max(
    isnrSecurity,
    signals.criticalNews * 18
      + signals.highNews * 8
      + signals.defenseHigh * 18
      + signals.jammingSignals * 10,
  ));

  const information = clamp(
    signals.topNewsCount
      + signals.highNews * 4
      + signals.criticalNews * 10
      + signals.marketStress * 5,
  );

  return { troubles, conflict, security, information };
}
```

- [ ] **Step 5: Add `buildFranceBriefContext` (pipeline step 3)**

```typescript
/**
 * Step 3 — build the LLM brief context.
 * Returns everything except `score` (computed in step 4 from isnrComponents + cyberScore).
 */
export function buildFranceBriefContext(
  signals: FranceCountrySignals,
  axes: FranceCountryAxes,
  raw: FranceRawData,
): Omit<FranceBriefContext, 'score'> {
  const scores = raw.isnrData?.scores ?? [];
  const isnrComponents = {
    social:   avgDim(scores, 'social'),
    security: avgDim(scores, 'security'),
    infra:    avgDim(scores, 'infra'),
  };
  const cyberScore = raw.cyberData?.meta.globalScore ?? 0;

  const METEO_ORDER: Record<string, number> = { violet: 4, red: 3, orange: 2, yellow: 1, green: 0 };
  const meteoMaxLevel = raw.meteoAlerts.reduce<string | null>((max, a) => {
    if (max === null) return a.level;
    return (METEO_ORDER[a.level] ?? 0) > (METEO_ORDER[max] ?? 0) ? a.level : max;
  }, null);

  const topHeadlines = raw.newsItems
    .slice(0, 6)
    .map((n) => n.title.replace(/[\r\n]+/g, ' ').slice(0, 120));

  const energySummary = buildEnergySnapshot(raw);

  const signalValues = Object.values(raw.ecowattResponse?.signals ?? {});
  const ecowattSignal: string | null =
    signalValues.includes('red') ? 'red'
    : signalValues.includes('orange') ? 'orange'
    : signalValues.includes('green') ? 'green'
    : null;

  return {
    axes,
    signals,
    topHeadlines,
    ecowattSignal,
    meteoMaxLevel,
    cyberScore,
    isnrComponents,
    energySummary,
  };
}
```

- [ ] **Step 6: Add `computeFranceRiskScore` (pipeline step 4)**

Exact prod formula ported from `FranceIntelPanel.ts computeCII()`:

```typescript
/**
 * Step 4 — compute the CII (Composite Instability Index) 0–100.
 * Formula identical to prod FranceIntelPanel.ts computeCII() — zero behavioral change.
 * Based on ISNR dimensions + cyber score (NOT on the operational axes).
 */
export function computeFranceRiskScore(
  isnrComponents: { social: number; security: number; infra: number },
  cyberScore: number,
): number {
  return Math.round(
    isnrComponents.social    * 0.25
    + isnrComponents.security * 0.30
    + isnrComponents.infra    * 0.20
    + cyberScore              * 0.25,
  );
}
```

- [ ] **Step 7: Add the main orchestrator `buildFranceCountrySnapshot`**

```typescript
/**
 * Main entry point — assembles the full FranceCountrySnapshot from raw data.
 * Orchestrates the 4-step pipeline.
 *
 * @param raw    All raw data collected by App.ts
 * @param options  Optional brief text + freshness injected after LLM returns
 */
export function buildFranceCountrySnapshot(
  raw: FranceRawData,
  options?: { brief?: string | null; briefFreshness?: 'fresh' | 'cached' },
): FranceCountrySnapshot {
  // Step 1 — signals
  const signals = buildFranceSignals(raw);

  // Step 2 — axes
  const axes = computeFranceAxes(signals, raw.isnrData);

  // Step 3 — brief context (also computes isnrComponents + cyberScore needed for CII)
  const partialCtx = buildFranceBriefContext(signals, axes, raw);

  // Step 4 — score (CII)
  const score = computeFranceRiskScore(partialCtx.isnrComponents, partialCtx.cyberScore);

  const briefContext: FranceBriefContext = { ...partialCtx, score };

  // Step 5 — assemble snapshot
  const stability = raw.isnrData ?? { scores: [], nationalScore: 0, timestamp: new Date() };
  const cyber = raw.cyberData ?? {
    meta: { globalScore: 0, trend: 'stable' as const, sources: [], lastUpdate: new Date() },
    alerts: { count30d: 0, latest: [] },
    ransomware: { total30d: 0, topSectors: [] },
    vulnerabilities: { criticalCount: 0, topCVEs: [] },
  };

  return {
    signals,
    axes,
    score,
    briefContext,
    stability,
    cyber,
    meteo:          raw.meteoAlerts,
    topNews:        raw.newsItems.slice(0, 20),
    energy:         buildEnergySnapshot(raw),
    timeline:       raw.timeline,
    briefLang:      raw.briefLang,
    brief:          options?.brief,
    briefFreshness: options?.briefFreshness,
  };
}
```

- [ ] **Step 8: Run typecheck**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck 2>&1 | head -60
```

Expected: errors only in App.ts and FranceIntelPanel.ts (not yet updated) — not in the new engine file itself.

If you see errors in `france-country-intel.ts` itself (e.g. unknown type names like `ActiveFire`, `FloodSegment`), look up the correct type names:
```bash
grep -n "export.*interface.*Fire\|export.*interface.*Flood\|export.*interface.*Telecom\|export.*interface.*PowerOut" src/types/index.ts
```
Then fix the import in the engine accordingly.

- [ ] **Step 9: Commit**

```bash
git add src/services/france-country-intel.ts
git commit -m "feat: add france-country-intel engine (buildFranceCountrySnapshot pipeline)"
```

---

## Task 3 — Swap `buildFranceIntelData` in App.ts

**Files:**
- Modify: `src/App.ts`

Context: There are 4 callsites to update, all found by:
```bash
grep -n "buildFranceIntelData\|fetchFranceIntelBrief\|FranceIntelData" src/App.ts
```
Expected lines: 26, 27, 2069, 2071, 4661, 4778, 4795, 4797.

- [ ] **Step 1: Update the import block (lines ~25–27)**

Find:
```typescript
import { FranceIntelPanel } from './components/FranceIntelPanel.ts';
import { fetchFranceIntelBrief } from './services/france-intel-brief.ts';
import type { FranceIntelData } from './types/index.ts';
```

Replace with:
```typescript
import { FranceIntelPanel } from './components/FranceIntelPanel.ts';
import { fetchFranceIntelBrief } from './services/france-intel-brief.ts';
import {
  buildFranceCountrySnapshot as buildFranceEngine,
  type FranceRawData,
} from './services/france-country-intel.ts';
import type { FranceCountrySnapshot } from './types/index.ts';
```

- [ ] **Step 2: Replace `buildFranceIntelData` (~line 4661) with a thin wrapper**

Find the entire `private buildFranceIntelData(lang: 'fr' | 'en'): FranceIntelData { ... }` method (lines 4661–4773) and replace it with two methods:

```typescript
/**
 * Extracts the 7-day signal timeline from news items and today's live data.
 * Kept in App.ts because it accesses private state (newsItems, currentX).
 */
private buildFranceTimeline(lang: 'fr' | 'en'): { days: string[]; lanes: FranceIntelTimelineLane[] } {
  const now = new Date();
  const days = Array.from({ length: 7 }, (_, index) => {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - (6 - index));
    return day;
  });
  const dayKeys = days.map((d) => d.toISOString().slice(0, 10));
  const laneMap = {
    social:    { key: 'social'    as const, label: lang === 'fr' ? 'Social'    : 'Social',    color: '#ef4444', counts: Array(7).fill(0) as number[] },
    security:  { key: 'security'  as const, label: lang === 'fr' ? 'Sécurité'  : 'Security',  color: '#f97316', counts: Array(7).fill(0) as number[] },
    weather:   { key: 'weather'   as const, label: lang === 'fr' ? 'Météo'     : 'Weather',   color: '#facc15', counts: Array(7).fill(0) as number[] },
    transport: { key: 'transport' as const, label: lang === 'fr' ? 'Transport' : 'Transport', color: '#60a5fa', counts: Array(7).fill(0) as number[] },
    cyber:     { key: 'cyber'     as const, label: 'Cyber',                                   color: '#a855f7', counts: Array(7).fill(0) as number[] },
  };

  const cyber = this.currentCyberData ?? null;

  for (const item of this.newsItems) {
    const key = item.pubDate.toISOString().slice(0, 10);
    const dayIndex = dayKeys.indexOf(key);
    if (dayIndex === -1) continue;
    const category = item.threat?.category;
    if (category === 'social') laneMap.social.counts[dayIndex] += 1;
    else if (category === 'security') laneMap.security.counts[dayIndex] += 1;
    else if (
      category === 'weather' || category === 'floods' || category === 'fires' ||
      category === 'energy' || category === 'infrastructure'
    ) laneMap.weather.counts[dayIndex] += 1;
    else if (category === 'transport') laneMap.transport.counts[dayIndex] += 1;
    else if (category === 'cyber') laneMap.cyber.counts[dayIndex] += 1;
  }

  const todayIndex = dayKeys.length - 1;
  laneMap.weather.counts[todayIndex]   += this.currentMeteoAlerts.filter((a) => a.level !== 'green').length;
  laneMap.weather.counts[todayIndex]   += this.currentFloodSegments.filter((a) => a.level !== 'green').length;
  laneMap.transport.counts[todayIndex] += this.currentSncfDisruptions.length + this.currentTrafficIncidents.length;
  laneMap.security.counts[todayIndex]  += this.currentDefenseAlerts.length + this.currentJammingSignals.length;
  laneMap.cyber.counts[todayIndex]     += cyber?.alerts.latest.filter((a) => {
    const ts = new Date(a.date);
    return Number.isFinite(ts.getTime()) && (now.getTime() - ts.getTime()) <= 7 * 24 * 60 * 60 * 1000;
  }).length ?? 0;

  return {
    days: days.map((d) =>
      d.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'en-US', { month: 'short', day: 'numeric' }),
    ),
    lanes: Object.values(laneMap),
  };
}

/**
 * Assembles FranceRawData and delegates all computation to the engine.
 * Replaces the old buildFranceIntelData() (~110 lines of inline computation).
 */
private buildFranceSnapshot(
  lang: 'fr' | 'en',
  options?: { brief?: string | null; briefFreshness?: 'fresh' | 'cached' },
): FranceCountrySnapshot {
  const raw: FranceRawData = {
    newsItems:            this.newsItems,
    isnrData:             this.currentISNRData,
    cyberData:            this.currentCyberData,
    meteoAlerts:          this.currentMeteoAlerts,
    floodSegments:        this.currentFloodSegments,
    sncfDisruptions:      this.currentSncfDisruptions,
    trafficIncidents:     this.currentTrafficIncidents,
    powerOutages:         this.currentPowerOutages,
    telecomOutages:       this.currentTelecomOutages,
    defenseAlerts:        this.currentDefenseAlerts,
    jammingSignals:       this.currentJammingSignals,
    militaryFlightsCount: this.currentMilitaryFlightsCount,
    maritimeCount:        this.currentMaritimeTrafficFranceCount,
    activeFires:          this.currentActiveFires,
    marketData:           this.currentMarketData,
    ecowattResponse:      this.currentEcowattResponse,
    nuclearState:         this.currentNuclearState,
    eolienLive:           this.currentEolienLive,
    timeline:             this.buildFranceTimeline(lang),
    briefLang:            lang,
  };
  return buildFranceEngine(raw, options);
}
```

> **Note:** `currentMarketData` is typed as `MarketData[]` in App.ts (line 1161: `private currentMarketData: MarketData[] = []`). No `?? []` needed.

- [ ] **Step 3: Update `refreshFranceIntelPanel` (~line 4775)**

Find:
```typescript
private refreshFranceIntelPanel(): void {
  if (!this.franceIntelPanel?.isVisible()) return;
  const lang = this.franceIntelPanel.getCurrentLang();
  this.franceIntelPanel.show(this.buildFranceIntelData(lang));
}
```

Replace with:
```typescript
private refreshFranceIntelPanel(): void {
  if (!this.franceIntelPanel?.isVisible()) return;
  const lang = this.franceIntelPanel.getCurrentLang();
  this.franceIntelPanel.show(this.buildFranceSnapshot(lang));
}
```

- [ ] **Step 4: Update `openFranceIntelPanel` (~line 4783)**

Find:
```typescript
const lang = this.franceIntelPanel?.getCurrentLang() ?? 'fr';
const data = this.buildFranceIntelData(lang);
this.franceIntelPanel?.show(data);
void fetchFranceIntelBrief(data, lang).then(({ brief, freshness }) => {
  this.franceIntelPanel?.updateBrief(brief, freshness);
});
```

Replace with:
```typescript
const lang = this.franceIntelPanel?.getCurrentLang() ?? 'fr';
const snapshot = this.buildFranceSnapshot(lang);
this.franceIntelPanel?.show(snapshot);
void fetchFranceIntelBrief(snapshot.briefContext, lang).then(({ brief, freshness }) => {
  this.franceIntelPanel?.updateBrief(brief, freshness);
});
```

- [ ] **Step 5: Update the lang-toggle handler (~line 2069)**

Find:
```typescript
const data = this.buildFranceIntelData(lang);
```
(inside the `france-intel-lang-toggle` event listener)

Replace that whole inline block with:
```typescript
const snapshot = this.buildFranceSnapshot(lang);
this.franceIntelPanel?.show(snapshot);
void fetchFranceIntelBrief(snapshot.briefContext, lang).then(({ brief, freshness }) => {
  this.franceIntelPanel?.updateBrief(brief, freshness);
});
```

Confirm by running:
```bash
grep -n "buildFranceIntelData\|FranceIntelData" src/App.ts
```
Expected: zero remaining occurrences.

- [ ] **Step 6: Run typecheck**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck 2>&1 | head -60
```

Expected: errors only in `FranceIntelPanel.ts` (not yet updated) and `france-intel-brief.ts` (not yet updated). Zero errors in `App.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/App.ts
git commit -m "refactor: replace buildFranceIntelData with buildFranceSnapshot engine wrapper"
```

---

## Task 4 — Make `FranceIntelPanel.ts` a pure renderer

**Files:**
- Modify: `src/components/FranceIntelPanel.ts`

- [ ] **Step 1: Update imports (lines 1–7)**

Find:
```typescript
import type {
  FranceIntelData,
  FranceIntelTimelineLane,
  ISNRDimensionScores,
  MeteoVigilanceLevel,
} from '../types/index.ts';
```

Replace with:
```typescript
import type {
  FranceCountrySnapshot,
  FranceIntelTimelineLane,
  MeteoVigilanceLevel,
} from '../types/index.ts';
```

(`ISNRDimensionScores` was only used by `avgDim`. `FranceIntelData` → `FranceCountrySnapshot`.)

- [ ] **Step 2: Delete the 4 compute functions (lines 63–126)**

Delete entirely (including blank lines):
- `function getActiveScores(scores, ...): ...` (line ~63)
- `function avgDim(scores, key): number` (line ~67)
- `function computeCII(data: FranceIntelData): number` (line ~74)
- `function clampScore(value: number): number` (line ~82)
- `function computeNationalPostureAxes(data: FranceIntelData, lang): Array<...>` (lines ~86–126)

Also delete the local `getActiveScores` helper at line ~63 if present.

- [ ] **Step 3: Update `show()` signature and body (line ~280)**

Find:
```typescript
show(data: FranceIntelData): void {
  if (!this.contentEl) return;
  this.currentLang = data.briefLang;
  const langBtn = this.modalEl.querySelector('.fi-lang-toggle');
  if (langBtn) langBtn.textContent = this.currentLang.toUpperCase();
  this.renderContent(data);
  this.isOpen = true;
  this.modalEl.classList.add('active');
  this.modalEl.setAttribute('aria-hidden', 'false');
}
```

Replace with:
```typescript
show(snapshot: FranceCountrySnapshot): void {
  if (!this.contentEl) return;
  this.currentLang = snapshot.briefLang;
  const langBtn = this.modalEl.querySelector('.fi-lang-toggle');
  if (langBtn) langBtn.textContent = this.currentLang.toUpperCase();
  this.renderContent(snapshot);
  this.isOpen = true;
  this.modalEl.classList.add('active');
  this.modalEl.setAttribute('aria-hidden', 'false');
}
```

- [ ] **Step 4: Update `renderContent()` — signature and CII/axes lines**

Find:
```typescript
private renderContent(data: FranceIntelData): void {
  if (!this.contentEl) return;

  const lang = data.briefLang;
  const cii = computeCII(data);
  const ciiBandLabel = ciiLabel(cii, lang);
  const ciiTint = ciiColor(cii);
  const postureAxes = computeNationalPostureAxes(data, lang);
  const updatedTime = new Date(data.stability.timestamp).toLocaleString(
```

Replace with:
```typescript
private renderContent(snapshot: FranceCountrySnapshot): void {
  if (!this.contentEl) return;

  const lang = snapshot.briefLang;
  const cii = snapshot.score;
  const ciiBandLabel = ciiLabel(cii, lang);
  const ciiTint = ciiColor(cii);
  const postureAxes = [
    { label: t(lang, 'Troubles',     'Troubles'),   value: snapshot.axes.troubles,    color: '#7ddc6f' },
    { label: t(lang, 'Conflit',      'Conflict'),   value: snapshot.axes.conflict,    color: '#9ca3af' },
    { label: t(lang, 'Sécurité',     'Security'),   value: snapshot.axes.security,    color: '#ff6b35' },
    { label: t(lang, 'Information',  'Information'), value: snapshot.axes.information, color: '#7ddc6f' },
  ];
  const updatedTime = new Date(snapshot.stability.timestamp).toLocaleString(
```

- [ ] **Step 5: Update `renderContent()` — `news`, `dominantRisk`, `riskMap`, `signalChips`, `totalSignals`, `energy`**

These are all inside `renderContent`. Replace every `data.` reference:

**`news` block** (line ~333):
```typescript
// Find:
const news = [...data.topNews]
// Replace:
const news = [...snapshot.topNews]
```

**`dominantRisk` block** (lines ~341–347):
```typescript
// Find:
const dominantRisk = [
  { label: t(lang, 'Cyber', 'Cyber'), value: data.operational.cyberAlerts + data.operational.cyberCritical },
  { label: t(lang, 'Transport', 'Transport'), value: data.operational.railDisruptions + data.operational.roadIncidents },
  { label: t(lang, 'Pannes', 'Outages'), value: data.operational.powerOutages + data.operational.telecomOutages },
  { label: t(lang, 'Météo', 'Weather'), value: data.operational.weatherAlerts + data.operational.floodAlerts },
  { label: t(lang, 'Défense', 'Defense'), value: data.operational.defenseAlerts + data.operational.jammingSignals },
].sort((a, b) => b.value - a.value)[0];

// Replace:
const dominantRisk = [
  { label: t(lang, 'Cyber', 'Cyber'), value: snapshot.signals.cyberAlerts + snapshot.signals.cyberCritical },
  { label: t(lang, 'Transport', 'Transport'), value: snapshot.signals.railDisruptions + snapshot.signals.roadIncidents },
  { label: t(lang, 'Pannes', 'Outages'), value: snapshot.signals.powerOutages + snapshot.signals.telecomOutages },
  { label: t(lang, 'Météo', 'Weather'), value: snapshot.signals.meteoAlerts + snapshot.signals.floodAlerts },
  { label: t(lang, 'Défense', 'Defense'), value: snapshot.signals.defenseAlerts + snapshot.signals.jammingSignals },
].sort((a, b) => b.value - a.value)[0];
```

**`riskMap` block** (line ~349):
```typescript
// Find:
for (const alert of data.meteo.filter((item) => item.level !== 'green')) {
// Replace:
for (const alert of snapshot.meteo.filter((item) => item.level !== 'green')) {
```

**`signalChips` block** (lines ~360–373) — replace every `data.operational.` with `snapshot.signals.` and `weatherAlerts` → `meteoAlerts`:
```typescript
// Find and replace ALL occurrences in this block:
// data.operational.criticalNews       → snapshot.signals.criticalNews
// data.operational.militaryFlights    → snapshot.signals.militaryFlights
// data.operational.maritimeTrafficFrance → snapshot.signals.maritimeTrafficFrance
// data.operational.defenseAlerts      → snapshot.signals.defenseAlerts
// data.operational.jammingSignals     → snapshot.signals.jammingSignals
// data.operational.cyberCritical      → snapshot.signals.cyberCritical
// data.operational.railSevere         → snapshot.signals.railSevere
// data.operational.fireDetections     → snapshot.signals.fireDetections
// data.operational.marketStress       → snapshot.signals.marketStress
// data.operational.powerOutages       → snapshot.signals.powerOutages
// data.operational.telecomOutages     → snapshot.signals.telecomOutages
```

**`totalSignals` block** (lines ~375–387):
```typescript
// Find:
const totalSignals = data.operational.criticalNews
  + data.operational.highNews
  + data.operational.weatherAlerts
  + data.operational.floodAlerts
  + data.operational.railDisruptions
  + data.operational.roadIncidents
  + data.operational.powerOutages
  + data.operational.telecomOutages
  + data.operational.fireDetections
  + data.operational.militaryFlights
  + data.operational.maritimeTrafficFrance
  + data.operational.defenseAlerts
  + data.operational.jammingSignals;

// Replace:
const totalSignals = snapshot.signals.criticalNews
  + snapshot.signals.highNews
  + snapshot.signals.meteoAlerts
  + snapshot.signals.floodAlerts
  + snapshot.signals.railDisruptions
  + snapshot.signals.roadIncidents
  + snapshot.signals.powerOutages
  + snapshot.signals.telecomOutages
  + snapshot.signals.fireDetections
  + snapshot.signals.militaryFlights
  + snapshot.signals.maritimeTrafficFrance
  + snapshot.signals.defenseAlerts
  + snapshot.signals.jammingSignals;
```

**`energy` assignment** (line ~389):
```typescript
// Find:
const energy = data.energy;
// Replace:
const energy = snapshot.energy;
```

- [ ] **Step 6: Update the 7 stat tile lines in the HTML template (lines ~424–430)**

```typescript
// Find:
${this.renderStatTile(t(lang, 'Cyber', 'Cyber'), data.operational.cyberAlerts.toString(), t(lang, 'alertes 30j', '30d alerts'))}
${this.renderStatTile(t(lang, 'Rail', 'Rail'), data.operational.railDisruptions.toString(), t(lang, 'perturbations', 'disruptions'))}
${this.renderStatTile(t(lang, 'Militaire', 'Military'), data.operational.militaryFlights.toString(), t(lang, 'vols actifs', 'active flights'))}
${this.renderStatTile(t(lang, 'Maritime', 'Maritime'), data.operational.maritimeTrafficFrance.toString(), t(lang, 'navires en zone FR', 'ships in FR waters'))}
${this.renderStatTile(t(lang, 'Pannes', 'Outages'), (data.operational.powerOutages + data.operational.telecomOutages).toString(), t(lang, 'élec + télécom', 'power + telecom'))}
${this.renderStatTile(t(lang, 'Défense', 'Defense'), data.operational.defenseAlerts.toString(), t(lang, 'alertes câbles', 'cable alerts'))}
${this.renderStatTile(t(lang, 'Météo', 'Weather'), (data.operational.weatherAlerts + data.operational.floodAlerts + data.operational.fireDetections).toString(), t(lang, 'vigies + feux', 'watches + fires'))}

// Replace:
${this.renderStatTile(t(lang, 'Cyber', 'Cyber'), snapshot.signals.cyberAlerts.toString(), t(lang, 'alertes 30j', '30d alerts'))}
${this.renderStatTile(t(lang, 'Rail', 'Rail'), snapshot.signals.railDisruptions.toString(), t(lang, 'perturbations', 'disruptions'))}
${this.renderStatTile(t(lang, 'Militaire', 'Military'), snapshot.signals.militaryFlights.toString(), t(lang, 'vols actifs', 'active flights'))}
${this.renderStatTile(t(lang, 'Maritime', 'Maritime'), snapshot.signals.maritimeTrafficFrance.toString(), t(lang, 'navires en zone FR', 'ships in FR waters'))}
${this.renderStatTile(t(lang, 'Pannes', 'Outages'), (snapshot.signals.powerOutages + snapshot.signals.telecomOutages).toString(), t(lang, 'élec + télécom', 'power + telecom'))}
${this.renderStatTile(t(lang, 'Défense', 'Defense'), snapshot.signals.defenseAlerts.toString(), t(lang, 'alertes câbles', 'cable alerts'))}
${this.renderStatTile(t(lang, 'Météo', 'Weather'), (snapshot.signals.meteoAlerts + snapshot.signals.floodAlerts + snapshot.signals.fireDetections).toString(), t(lang, 'vigies + feux', 'watches + fires'))}
```

- [ ] **Step 7: Update timeline and energy references in the HTML template**

```typescript
// Find (timeline):
${data.timeline.days.map((day) => `<span>${escapeHtml(day)}</span>`).join('')}
// Replace:
${snapshot.timeline.days.map((day) => `<span>${escapeHtml(day)}</span>`).join('')}

// Find:
${data.timeline.lanes.map(renderTimelineLane).join('')}
// Replace:
${snapshot.timeline.lanes.map(renderTimelineLane).join('')}
```

- [ ] **Step 8: Verify no remaining `data.operational` or `data.topNews` etc. references**

```bash
grep -n "data\." src/components/FranceIntelPanel.ts
```

Expected: zero occurrences (all should now be `snapshot.*`).

Also remove the deprecated alias from types if you added it in Task 1:
```bash
grep -n "FranceIntelData" src/types/index.ts
```
Now delete the `/** @deprecated */ export type FranceIntelData = FranceCountrySnapshot;` line.

- [ ] **Step 9: Run typecheck**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck 2>&1 | head -60
```

Expected: errors only in `france-intel-brief.ts` (not yet updated). Zero errors in the panel.

- [ ] **Step 10: Commit**

```bash
git add src/components/FranceIntelPanel.ts src/types/index.ts
git commit -m "refactor: FranceIntelPanel becomes pure renderer of FranceCountrySnapshot"
```

---

## Task 5 — Update `france-intel-brief.ts` to consume `FranceBriefContext`

**Files:**
- Modify: `src/services/france-intel-brief.ts`

- [ ] **Step 1: Rewrite the file**

Replace the entire file content with:

```typescript
// src/services/france-intel-brief.ts
// Fetches the LLM-generated national brief from /api/intelligence/v1/france-intel-brief.
// Input is now FranceBriefContext (pre-computed by france-country-intel.ts engine).
// The outgoing HTTP payload shape is unchanged — preserves existing proxy/API contract.

import type { FranceBriefContext } from '../types/index.ts';

interface BriefCacheEntry {
  brief: string | null;
  freshness: 'fresh' | 'cached';
  expiresAt: number;
}

const _cache = new Map<'fr' | 'en', BriefCacheEntry>();
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2 h

export interface FranceBriefResult {
  brief: string | null;
  freshness: 'fresh' | 'cached';
}

export async function fetchFranceIntelBrief(
  ctx: FranceBriefContext,
  lang: 'fr' | 'en' = 'fr',
): Promise<FranceBriefResult> {
  const cached = _cache.get(lang);
  if (cached && Date.now() < cached.expiresAt) {
    return { brief: cached.brief, freshness: 'cached' };
  }

  try {
    const res = await fetch('/api/intelligence/v1/france-intel-brief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Payload shape identical to previous version — proxy/API contract unchanged.
        isnrScore:       ctx.score,
        isnrComponents:  ctx.isnrComponents,
        cyberScore:       ctx.cyberScore,
        meteoAlertCount: ctx.signals.meteoAlerts,
        topHeadlines:    ctx.topHeadlines,
        signalCounts: {
          criticalNews:          ctx.signals.criticalNews,
          highNews:              ctx.signals.highNews,
          weatherAlerts:         ctx.signals.meteoAlerts,   // API uses "weatherAlerts"
          floodAlerts:           ctx.signals.floodAlerts,
          fireDetections:        ctx.signals.fireDetections,
          railDisruptions:       ctx.signals.railDisruptions,
          roadIncidents:         ctx.signals.roadIncidents,
          powerOutages:          ctx.signals.powerOutages,
          telecomOutages:        ctx.signals.telecomOutages,
          cyberAlerts:           ctx.signals.cyberAlerts,
          militaryFlights:       ctx.signals.militaryFlights,
          maritimeTrafficFrance: ctx.signals.maritimeTrafficFrance,
          defenseAlerts:         ctx.signals.defenseAlerts,
          jammingSignals:        ctx.signals.jammingSignals,
          marketStress:          ctx.signals.marketStress,
        },
        energy: ctx.energySummary ? {
          ecowattSignal: ctx.energySummary.ecowattSignal,
          nuclearShare:  ctx.energySummary.shares.nuclear,
          gasShare:      ctx.energySummary.shares.gas,
          hydroShare:    ctx.energySummary.shares.hydro,
          windShare:     ctx.energySummary.shares.wind,
          solarShare:    ctx.energySummary.shares.solar,
          totalMw:       ctx.energySummary.totalMw,
        } : null,
        lang,
      }),
    });

    if (!res.ok) return { brief: null, freshness: 'fresh' };

    const payload = await res.json() as { brief: string | null; fromCache: boolean };
    const result: FranceBriefResult = {
      brief:     payload.brief ?? null,
      freshness: payload.fromCache ? 'cached' : 'fresh',
    };

    if (result.brief !== null) {
      _cache.set(lang, { ...result, expiresAt: Date.now() + CACHE_TTL_MS });
    }
    return result;
  } catch {
    return { brief: null, freshness: 'fresh' };
  }
}

/** Clear client-side brief cache (e.g. on lang toggle to force refetch). */
export function clearFranceBriefCache(lang?: 'fr' | 'en'): void {
  if (lang) {
    _cache.delete(lang);
  } else {
    _cache.clear();
  }
}
```

- [ ] **Step 2: Run typecheck — expect zero errors now**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck 2>&1 | head -60
```

Expected: **zero errors** across all files.

- [ ] **Step 3: Commit**

```bash
git add src/services/france-intel-brief.ts
git commit -m "refactor: france-intel-brief now consumes FranceBriefContext instead of FranceIntelData"
```

---

## Task 6 — Update comments in proxy and API handler

**Files:**
- Modify: `src/plugins/france-intel-proxy.ts`
- Modify: `api/intelligence/v1/france-intel-brief.js`

- [ ] **Step 1: Update the comment at the top of `france-intel-proxy.ts`**

Add or update the top comment block to read:
```typescript
// src/plugins/france-intel-proxy.ts
// Dev proxy for /api/intelligence/v1/france-intel-brief (Vite dev server only).
// Receives the same JSON payload shape as the Vercel handler (unchanged after migration):
//   { isnrScore, isnrComponents, cyberScore, meteoAlertCount, topHeadlines,
//     signalCounts, energy, lang }
// Source of that payload is now FranceBriefContext (built by france-country-intel.ts).
// No structural changes required here.
```

- [ ] **Step 2: Update the comment at the top of `api/intelligence/v1/france-intel-brief.js`**

```javascript
// api/intelligence/v1/france-intel-brief.js
// Vercel Edge Function — generates a national intelligence brief via Groq.
// Input payload (unchanged after client-side migration):
//   { isnrScore, isnrComponents, cyberScore, meteoAlertCount, topHeadlines,
//     signalCounts, energy, lang }
// Payload is now built from FranceBriefContext by france-intel-brief.ts (client).
// No changes required to parsing or prompt logic.
```

- [ ] **Step 3: Commit**

```bash
git add src/plugins/france-intel-proxy.ts api/intelligence/v1/france-intel-brief.js
git commit -m "docs: update proxy/API comments to reference FranceBriefContext source"
```

---

## Task 7 — Final validation

**Files:** none modified

- [ ] **Step 1: Full typecheck**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck
```

Expected: **zero errors**.

- [ ] **Step 2: Full build**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npm run build
```

Expected: **build succeeds** with no TypeScript errors. Vite bundle output should be normal.

- [ ] **Step 3: Verify zero remaining old references**

```bash
grep -rn "FranceIntelData\|FranceIntelOperationalSummary\|data\.operational\.\|buildFranceIntelData" src/ api/
```

Expected: **zero results**. If any remain, fix and re-run typecheck + build.

- [ ] **Step 4: Manual smoke test**

```bash
npm run dev
```

Open the app → click the 🇫🇷 France button in the sidebar → verify:
- Drawer opens ✅
- CII score displays (same value as before) ✅
- 4 posture bars (Troubles / Conflict / Security / Information) display ✅
- Signal chips appear (or "Aucun signal dominant" if none) ✅
- Brief section shows loading state then content ✅
- Language toggle (FR/EN) works ✅
- Timeline grid renders ✅
- Energy profile renders ✅

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: france-country-intel engine complete — FranceIntelPanel is now a pure renderer

Implements the country-intel architecture pattern from WorldMonitor:
- buildFranceCountrySnapshot() orchestrates signals → axes → CII → briefContext
- FranceIntelPanel reads pre-computed snapshot (zero compute logic)
- fetchFranceIntelBrief() reads snapshot.briefContext (no re-extraction)
- CII formula and all axis formulas are identical to prod (zero behavioral change)
- 7 files changed, FranceIntelData type removed from public API

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|---|---|
| `FranceCountrySignals` type | Task 1 Step 2 |
| `FranceCountryAxes` type | Task 1 Step 2 |
| `FranceBriefContext` type | Task 1 Step 2 |
| `FranceCountrySnapshot` type | Task 1 Step 2 |
| `FranceIntelData` removed | Task 1 Step 3, Task 4 Step 8 |
| `buildFranceSignals()` | Task 2 Step 3 |
| `computeFranceAxes()` — exact prod formulas | Task 2 Step 4 |
| `buildFranceBriefContext()` | Task 2 Step 5 |
| `computeFranceRiskScore()` — exact CII formula | Task 2 Step 6 |
| `buildFranceCountrySnapshot()` orchestrator | Task 2 Step 7 |
| `FranceRawData` exported for App.ts | Task 2 Step 1 |
| App.ts thin wrapper + correct field names | Task 3 Step 2 |
| App.ts timeline extracted to helper | Task 3 Step 2 |
| 4 callsites updated in App.ts | Task 3 Steps 3–5 |
| Panel removes compute funcs | Task 4 Steps 2 |
| Panel `show(FranceCountrySnapshot)` | Task 4 Steps 3–7 |
| `meteoAlerts` → `weatherAlerts` mapping in brief | Task 5 Step 1 |
| Brief service signature `(ctx, lang)` | Task 5 Step 1 |
| Proxy + API comment updates | Task 6 |
| Typecheck + build passing | Task 7 |

**No gaps found.**
