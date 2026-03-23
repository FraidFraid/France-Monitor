# Baromètre Pannes Réseau France — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a permanent HUD widget (top-left of map) showing a composite 0-100 health score for French network infrastructure, aggregating Ecowatt, BGP/IODA, ARCEP, space weather, and cyber data.

**Architecture:** New service `network-barometer.ts` reads cached data from 5 existing services and computes a weighted score. New standalone component `BarometerWidget.ts` renders an SVG arc gauge + hover tooltip. Wired in `App.ts` with a 5-min polling interval. Cloud/Web dimension is null (phantom weight), redistributed automatically via active-weight normalization.

**Tech Stack:** Vanilla TypeScript (strict), Vite, SVG DOM APIs, CSS variables (`--bg-surface`, `--threat-*`), existing service cache pattern.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/services/network-barometer.ts` | **Create** | Score computation + caching |
| `src/components/BarometerWidget.ts` | **Create** | SVG arc gauge DOM component |
| `src/styles/main.css` | **Modify** | `.barometer-arc`, `barometerPulse` keyframe, `.barometer-pulse` |
| `src/App.ts` | **Modify** | Mount widget, polling loop, destroy cleanup |
| `src/services/outages.ts` | **Modify** | Label "Indicateurs Historiques DataFair" |

---

## Task 1: CSS — Arc animation + pulse keyframe

**Files:**
- Modify: `src/styles/main.css` (append near end of file, after existing keyframe definitions)

This task adds the two CSS rules needed by `BarometerWidget`. Do this first so the widget can reference them immediately on mount without a flash of unstyled content.

- [ ] **Step 1: Open `src/styles/main.css` and find the last `@keyframes` block**

Search for `alertPulse` — it's around line 1347. The new rules go **after** it.

- [ ] **Step 2: Append the barometer CSS rules**

Add after the `alertPulse` block:

```css
/* ── Baromètre Pannes Réseau ─────────────────────────────────────────────── */

.barometer-arc {
  transition: stroke-dashoffset 0.6s ease-in-out, stroke 0.3s ease;
  transform: rotate(-90deg);
  transform-origin: center;
  transform-box: fill-box; /* required in SVG: makes transform-origin relative to element */
}

@keyframes barometerPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.4; transform: scale(1.3); }
}

.barometer-pulse {
  animation: barometerPulse 2s ease-in-out infinite;
}
```

**Why `barometerPulse` and not `alertPulse`?** `alertPulse` animates `scale(0.5→1.5) + opacity→0` — it's an expanding ring that disappears. `barometerPulse` is a gentle breath (1→0.4→1 opacity) suitable for a filled dot.

- [ ] **Step 3: Verify typecheck passes**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck
```

Expected: no errors (CSS changes don't affect TS).

- [ ] **Step 4: Commit**

```bash
git add src/styles/main.css
git commit -m "feat: add barometer CSS — arc animation + barometerPulse keyframe"
```

---

## Task 2: Service — `src/services/network-barometer.ts`

**Files:**
- Create: `src/services/network-barometer.ts`

**What to know before starting:**
- `fetchEcowatt()` returns `EcowattResponse` — `signals: Record<string, EcowattSignal>` where `EcowattSignal = 'green' | 'orange' | 'red'` and keys are INSEE region codes (e.g. `"11"`, `"24"`). Use `Object.values()` to iterate.
- `fetchNetworkOutages()` returns `NetworkOutageState` — `nationalScore: number` already 0-100 (100 = healthy).
- `fetchTelecomOutages()` returns `TelecomOutage[]` — each has `voiceStatus: 'OK' | 'HS' | 'Degraded'` and `dataStatus: 'OK' | 'HS' | 'Degraded'`. Derive `hsSites` by filtering.
- `fetchSpaceWeather()` returns `SpaceWeatherData` — exported from `./space-weather.ts` (**not** from `../types/index.ts`). Has `kpIndex: number` (0–9).
- `fetchCyberDashboard()` returns `CyberState` — `meta.globalScore: number` where 0=calm, 100=crisis. **Must invert**: `100 - globalScore`.
- Cloud is always `null` — redistributed via active-weight normalization.
- Use `Promise.allSettled` so one failing service doesn't break the others.

- [ ] **Step 1: Create the service file**

Create `src/services/network-barometer.ts`:

```typescript
/**
 * network-barometer.ts — Baromètre composite santé infrastructure réseau France
 *
 * Agrège les caches existants (sans nouveaux appels réseau) :
 *  - Ecowatt (électricité)   30%
 *  - IODA/BGP (internet)     25%
 *  - ARCEP (télécom)         15%
 *  - Cloud/Web               15%  ← null (poids fantôme, redistribué)
 *  - Météo spatiale          10%
 *  - Tension cyber            5%
 */

import type { EcowattResponse, TelecomOutage } from '../types/index.ts';
import type { SpaceWeatherData } from './space-weather.ts';
import type { CyberState } from '../types/index.ts';
import { fetchEcowatt } from './ecowatt.ts';
import { fetchNetworkOutages } from './internet-outages.ts';
import { fetchTelecomOutages } from './outages.ts';
import { fetchSpaceWeather } from './space-weather.ts';
import { fetchCyberDashboard } from './cyber.ts';

// ── Types exportés ────────────────────────────────────────────────────────────

export interface NetworkBarometerResult {
  score: number;                              // 0-100, 100 = fully nominal
  status: 'nominal' | 'degraded' | 'critical';
  details: Record<string, number | null>;    // score normalisé par source (null = indisponible)
  computedAt: Date;
  reliable: boolean;                         // false si activeWeights < 30% du total
}

// ── Pondérations ──────────────────────────────────────────────────────────────

const WEIGHTS = {
  elec:    30,
  bgp:     25,
  telecom: 15,
  cloud:   15,  // toujours null — poids fantôme redistribué automatiquement
  space:   10,
  cyber:    5,
} as const;

type WeightKey = keyof typeof WEIGHTS;

// ── Cache interne ─────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 5 * 60_000;
let _cache: { data: NetworkBarometerResult; ts: number } | null = null;

// ── Normalisations par source (→ health score 0-100, 100 = nominal) ───────────

function normalizeElec(data: EcowattResponse): number {
  const signalValues = Object.values(data.signals);
  if (signalValues.length === 0) return 100;
  const mapped = signalValues.map(s => s === 'green' ? 100 : s === 'orange' ? 60 : 20);
  return Math.round(mapped.reduce((a, b) => a + b, 0) / mapped.length);
}

function normalizeTelecom(outages: TelecomOutage[]): number {
  const totalSites = outages.length;
  if (totalSites === 0) return 100;
  const hsSites = outages.filter(o => o.voiceStatus === 'HS' || o.dataStatus === 'HS').length;
  // * 200 : amplifie les pannes rares (même 5% de sites HS = score 0)
  return Math.max(0, Math.round(100 - (hsSites / totalSites) * 200));
}

function normalizeSpace(data: SpaceWeatherData): number {
  // kp=0 → 100 (calme), kp=5 → 40 (tempête G1), kp≥9 → 0 (extrême)
  return Math.max(0, 100 - Math.min(data.kpIndex * 12, 100));
}

function normalizeCyber(state: CyberState): number {
  // globalScore : 0=calme, 100=crise → inverser pour obtenir un score de santé
  return 100 - state.meta.globalScore;
}

// ── Score global ──────────────────────────────────────────────────────────────

function calculateGlobalScore(scores: Partial<Record<WeightKey, number | null>>): number {
  let totalScore = 0;
  let activeWeights = 0;

  for (const [key, weight] of Object.entries(WEIGHTS) as [WeightKey, number][]) {
    const s = scores[key];
    if (s !== null && s !== undefined) {
      totalScore += s * weight;
      activeWeights += weight;
    }
  }
  // cloud est null → activeWeights = 85 (pas 100).
  // La division renormalise automatiquement sur 100.
  return activeWeights > 0 ? Math.round(totalScore / activeWeights) : 0;
}

function toStatus(score: number): NetworkBarometerResult['status'] {
  if (score >= 85) return 'nominal';
  if (score >= 60) return 'degraded';
  return 'critical';
}

// ── Fonction principale ────────────────────────────────────────────────────────

export async function fetchNetworkBarometer(): Promise<NetworkBarometerResult> {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) return _cache.data;

  // Fetch toutes les sources en parallèle — échec partiel → null pour cette source
  const [ecowattRes, bgpRes, telecomRes, spaceRes, cyberRes] = await Promise.allSettled([
    fetchEcowatt(),
    fetchNetworkOutages(),
    fetchTelecomOutages(),
    fetchSpaceWeather(),
    fetchCyberDashboard(),
  ]);

  const scores: Partial<Record<WeightKey, number | null>> = {
    elec:    ecowattRes.status  === 'fulfilled' ? normalizeElec(ecowattRes.value)       : null,
    bgp:     bgpRes.status      === 'fulfilled' ? bgpRes.value.nationalScore            : null,
    telecom: telecomRes.status  === 'fulfilled' ? normalizeTelecom(telecomRes.value)    : null,
    cloud:   null,  // poids fantôme
    space:   spaceRes.status    === 'fulfilled' ? normalizeSpace(spaceRes.value)        : null,
    cyber:   cyberRes.status    === 'fulfilled' ? normalizeCyber(cyberRes.value)        : null,
  };

  const activeWeights = (Object.entries(WEIGHTS) as [WeightKey, number][])
    .filter(([k]) => scores[k] !== null && scores[k] !== undefined)
    .reduce((sum, [, w]) => sum + w, 0);

  const score = calculateGlobalScore(scores);

  // Fallback si tous les services sont tombés
  if (activeWeights === 0) {
    const fallback = _cache?.data ?? {
      score: 75,
      status: 'degraded' as const,
      details: { elec: null, bgp: null, telecom: null, cloud: null, space: null, cyber: null },
      computedAt: new Date(),
      reliable: false,
    };
    return fallback;
  }

  const result: NetworkBarometerResult = {
    score,
    status: toStatus(score),
    details: {
      elec:    scores.elec    ?? null,
      bgp:     scores.bgp     ?? null,
      telecom: scores.telecom ?? null,
      cloud:   null,
      space:   scores.space   ?? null,
      cyber:   scores.cyber   ?? null,
    },
    computedAt: new Date(),
    reliable: activeWeights >= 30, // 30 = 30% of total nominal weights (100). Cloud is always null, so max activeWeights = 85.
  };

  _cache = { data: result, ts: Date.now() };
  return result;
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck
```

Expected: no errors. If `CyberState` import conflicts, check that `CyberState` is exported from `src/types/index.ts` (it is — confirmed at line 796).

- [ ] **Step 3: Commit**

```bash
git add src/services/network-barometer.ts
git commit -m "feat: add network-barometer service with weighted health score"
```

---

## Task 3: Component — `src/components/BarometerWidget.ts`

**Files:**
- Create: `src/components/BarometerWidget.ts`

**What to know:**
- No `Panel` extension — standalone DOM class, always mounted, never hidden.
- SVG created via `document.createElementNS('http://www.w3.org/2000/svg', ...)`. The arc's `scoreEl` must be typed as `SVGTextElement`, not `HTMLElement`.
- `stroke-dasharray = circumference`, `stroke-dashoffset = circumference * (1 - score/100)`. At score=100: offset=0 (full arc). At score=0: offset=circumference (no arc).
- Arrow function event handlers (`_onMouseEnter`, `_onMouseLeave`) stored as class fields so they can be removed in `destroy()`. Using a regular function would create a new reference each time, making `removeEventListener` ineffective.
- `.barometer-arc` and `.barometer-pulse` CSS classes come from Task 1.

- [ ] **Step 1: Create the component file**

Create `src/components/BarometerWidget.ts`:

```typescript
/**
 * BarometerWidget.ts — Widget HUD permanent "Baromètre Pannes Réseau France"
 *
 * Affiche un score 0-100 sous forme d'arc SVG + tooltip détaillé au survol.
 * Toujours visible en haut à gauche de la carte. Pas de show/hide.
 */

import type { NetworkBarometerResult } from '../services/network-barometer.ts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const RADIUS = 22;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export class BarometerWidget {
  private container: HTMLElement;
  private el: HTMLElement | null = null;
  private arcEl: SVGCircleElement | null = null;
  private scoreTextEl: SVGTextElement | null = null;
  private dotEl: HTMLElement | null = null;
  private statusLabelEl: HTMLElement | null = null;
  private tooltipEl: HTMLElement | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    this.el = document.createElement('div');
    this.el.id = 'network-barometer-widget';
    this.el.style.cssText = `
      position: fixed;
      top: 64px;
      left: 12px;
      z-index: 900;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px 8px 8px;
      background: var(--bg-surface);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 12px;
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      cursor: default;
      user-select: none;
      font-family: system-ui, sans-serif;
    `;

    this.el.appendChild(this._buildArc());
    this.el.appendChild(this._buildLabels());
    this.el.appendChild(this._buildTooltip());

    this.el.addEventListener('mouseenter', this._onMouseEnter);
    this.el.addEventListener('mouseleave', this._onMouseLeave);

    this.container.appendChild(this.el);
  }

  // ── Builder helpers ──────────────────────────────────────────────────────────

  private _buildArc(): SVGSVGElement {
    const SIZE = 60;
    const CX = SIZE / 2;
    const CY = SIZE / 2;

    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    svg.setAttribute('width', String(SIZE));
    svg.setAttribute('height', String(SIZE));
    svg.style.flexShrink = '0';

    // Background track
    const track = document.createElementNS(SVG_NS, 'circle') as SVGCircleElement;
    track.setAttribute('cx', String(CX));
    track.setAttribute('cy', String(CY));
    track.setAttribute('r', String(RADIUS));
    track.setAttribute('fill', 'none');
    track.setAttribute('stroke', 'rgba(255,255,255,0.08)');
    track.setAttribute('stroke-width', '4');
    svg.appendChild(track);

    // Animated arc
    this.arcEl = document.createElementNS(SVG_NS, 'circle') as SVGCircleElement;
    this.arcEl.setAttribute('cx', String(CX));
    this.arcEl.setAttribute('cy', String(CY));
    this.arcEl.setAttribute('r', String(RADIUS));
    this.arcEl.setAttribute('fill', 'none');
    this.arcEl.setAttribute('stroke', '#34c759');
    this.arcEl.setAttribute('stroke-width', '4');
    this.arcEl.setAttribute('stroke-linecap', 'round');
    this.arcEl.setAttribute('stroke-dasharray', String(CIRCUMFERENCE));
    this.arcEl.setAttribute('stroke-dashoffset', String(CIRCUMFERENCE)); // starts empty
    this.arcEl.classList.add('barometer-arc');
    svg.appendChild(this.arcEl);

    // Score text centered in arc
    this.scoreTextEl = document.createElementNS(SVG_NS, 'text') as SVGTextElement;
    this.scoreTextEl.setAttribute('x', String(CX));
    this.scoreTextEl.setAttribute('y', String(CY + 1));
    this.scoreTextEl.setAttribute('text-anchor', 'middle');
    this.scoreTextEl.setAttribute('dominant-baseline', 'middle');
    this.scoreTextEl.setAttribute('fill', 'var(--text-primary)');
    this.scoreTextEl.setAttribute('font-size', '11');
    this.scoreTextEl.setAttribute('font-weight', '700');
    this.scoreTextEl.setAttribute('font-family', 'monospace');
    this.scoreTextEl.textContent = '—';
    svg.appendChild(this.scoreTextEl);

    return svg;
  }

  private _buildLabels(): HTMLElement {
    const group = document.createElement('div');
    group.style.cssText = 'display:flex;flex-direction:column;gap:2px;min-width:0;';

    const line1 = document.createElement('div');
    line1.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);line-height:1.3;';
    line1.textContent = 'INFRASTRUCTURES';

    const line2 = document.createElement('div');
    line2.style.cssText = 'font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:var(--text-muted);line-height:1.3;';
    line2.textContent = 'FRANCE';

    const statusRow = document.createElement('div');
    statusRow.style.cssText = 'display:flex;align-items:center;gap:5px;margin-top:3px;';

    this.dotEl = document.createElement('div');
    this.dotEl.style.cssText = 'width:8px;height:8px;border-radius:50%;background:#34c759;flex-shrink:0;';

    this.statusLabelEl = document.createElement('div');
    this.statusLabelEl.style.cssText = 'font-size:9px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.04em;';
    this.statusLabelEl.textContent = '—';

    statusRow.appendChild(this.dotEl);
    statusRow.appendChild(this.statusLabelEl);
    group.appendChild(line1);
    group.appendChild(line2);
    group.appendChild(statusRow);

    return group;
  }

  private _buildTooltip(): HTMLElement {
    this.tooltipEl = document.createElement('div');
    this.tooltipEl.style.cssText = `
      display: none;
      position: absolute;
      left: calc(100% + 8px);
      top: 0;
      background: var(--bg-surface);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 10px;
      padding: 10px 14px;
      min-width: 220px;
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      z-index: 901;
      font-size: 11px;
      color: var(--text-secondary);
      white-space: nowrap;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    `;
    return this.tooltipEl;
  }

  // ── Event handlers (stored as fields for removeEventListener) ────────────────

  private _onMouseEnter = (): void => {
    if (this.tooltipEl) this.tooltipEl.style.display = 'block';
  };

  private _onMouseLeave = (): void => {
    if (this.tooltipEl) this.tooltipEl.style.display = 'none';
  };

  // ── Public API ────────────────────────────────────────────────────────────────

  update(result: NetworkBarometerResult): void {
    if (!this.el || !this.arcEl || !this.dotEl || !this.statusLabelEl || !this.scoreTextEl) return;

    const { score, status, details } = result;

    const color = status === 'nominal'  ? '#34c759'
                : status === 'degraded' ? '#ffcc00'
                :                         '#ff2d55';

    // Arc dashoffset: 0 = full circle (score=100), CIRCUMFERENCE = empty (score=0)
    const offset = CIRCUMFERENCE * (1 - score / 100);
    this.arcEl.setAttribute('stroke-dashoffset', String(offset));
    this.arcEl.setAttribute('stroke', color);

    this.scoreTextEl.textContent = String(score);

    this.dotEl.style.background = color;
    if (status === 'critical') {
      this.dotEl.classList.add('barometer-pulse');
    } else {
      this.dotEl.classList.remove('barometer-pulse');
    }

    this.statusLabelEl.textContent =
      status === 'nominal'  ? 'Nominal'  :
      status === 'degraded' ? 'Dégradé'  : 'Critique';
    this.statusLabelEl.style.color = color;

    if (this.tooltipEl) {
      this.tooltipEl.innerHTML = this._renderTooltip(details);
    }
  }

  private _renderTooltip(details: Record<string, number | null>): string {
    const rows: [string, number | null][] = [
      ['BGP / Internet',   details.bgp    ?? null],
      ['Électricité',      details.elec   ?? null],
      ['Telecom ARCEP',    details.telecom ?? null],
      ['Météo Spatiale',   details.space  ?? null],
      ['Cyber (CERT-FR)',  details.cyber  ?? null],
    ];

    const rowsHtml = rows.map(([label, val]) => {
      const display = val !== null ? `${val} / 100` : '—';
      const color = val === null ? 'var(--text-muted)'
        : val >= 85 ? '#34c759'
        : val >= 60 ? '#ffcc00'
        : '#ff2d55';
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:16px;padding:2px 0;">
          <span style="color:var(--text-secondary);">${label}</span>
          <span style="font-weight:600;color:${color};font-family:monospace;">${display}</span>
        </div>`;
    }).join('');

    return `
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid rgba(255,255,255,0.06);">
        État Infrastructure France
      </div>
      ${rowsHtml}
      <div style="margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.06);opacity:0.4;display:flex;justify-content:space-between;gap:8px;">
        <span>Cloud / Web</span>
        <span style="font-style:italic;">N/A (intégration en cours)</span>
      </div>
    `;
  }

  destroy(): void {
    if (!this.el) return;
    this.el.removeEventListener('mouseenter', this._onMouseEnter);
    this.el.removeEventListener('mouseleave', this._onMouseLeave);
    this.el.remove();
    this.el = null;
    this.arcEl = null;
    this.scoreTextEl = null;
    this.dotEl = null;
    this.statusLabelEl = null;
    this.tooltipEl = null;
  }
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck
```

Expected: no errors. Common issue: SVG element types — all `createElementNS` calls use explicit `as SVGXxxElement` casts.

- [ ] **Step 3: Commit**

```bash
git add src/components/BarometerWidget.ts
git commit -m "feat: add BarometerWidget standalone SVG arc component"
```

---

## Task 4: App.ts — Mount, polling, destroy

**Files:**
- Modify: `src/App.ts`

Three changes needed:
1. Add imports (2 lines near top of import block)
2. Add field declarations (2 lines near other `private _interval*` declarations)
3. Add mount + polling in `initPanels()` — after `healthBarometerPanel` mount (around line 1316)
4. Add cleanup in `destroy()` (around line 836)

- [ ] **Step 1: Add imports**

Find the existing import block (around line 25–75). Add after the `HealthBarometerPanel` import:

```typescript
import { BarometerWidget } from './components/BarometerWidget.ts';
import { fetchNetworkBarometer } from './services/network-barometer.ts';
```

- [ ] **Step 2: Add field declarations**

Find the interval declarations block (around line 829–834):

```typescript
private _intervalRSS: ReturnType<typeof setInterval> | null = null;
private _intervalMilitaryFlights: ...
```

Add after them:

```typescript
private networkBarometerWidget: BarometerWidget | null = null;
private _intervalNetworkBarometer: ReturnType<typeof setInterval> | null = null;
```

- [ ] **Step 3: Add mount + polling in `initPanels()`**

Find the `healthBarometerPanel` mount block (around line 1315):

```typescript
this.healthBarometerPanel = new HealthBarometerPanel(floatContainer);
this.healthBarometerPanel.mount();
```

Add immediately **after** it:

```typescript
// Baromètre Pannes Réseau (widget HUD permanent)
this.networkBarometerWidget = new BarometerWidget(this.container);
this.networkBarometerWidget.mount();

const refreshNetworkBarometer = async (): Promise<void> => {
  const result = await fetchNetworkBarometer();
  this.networkBarometerWidget?.update(result);
};
void refreshNetworkBarometer();
this._intervalNetworkBarometer = setInterval(
  () => refreshNetworkBarometer().catch(err => console.error('[App] Network barometer poll error', err)),
  5 * 60_000
);
```

Note: mounted on `this.container` (not `floatContainer`) so the widget is positioned relative to the map root — same as `DayNightPanel`.

- [ ] **Step 4: Add cleanup in `destroy()`**

Find the `destroy()` method (around line 836):

```typescript
public destroy(): void {
```

Add at the end of the method body:

```typescript
if (this._intervalNetworkBarometer !== null) {
  clearInterval(this._intervalNetworkBarometer);
  this._intervalNetworkBarometer = null;
}
this.networkBarometerWidget?.destroy();
this.networkBarometerWidget = null;
```

- [ ] **Step 5: Run typecheck**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck
```

Expected: no errors.

- [ ] **Step 6: Run build**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 7: Commit**

```bash
git add src/App.ts
git commit -m "feat: mount BarometerWidget in App.ts with 5-min polling"
```

---

## Task 5: Label fix — `src/services/outages.ts`

**Files:**
- Modify: `src/services/outages.ts` (line ~153)

**Context:** `outages.ts` builds a string `eventCause` that includes `'Bilan Enedis (historique annuel)'` as a prefix. This label is misleading — it sounds like real-time Enedis data. Replace it with `'Indicateurs Historiques DataFair'` to clarify it is historical annual continuity data from the DataFair API.

**Note:** The spec says to edit `OutagesPanel.ts` but the string only exists in `outages.ts`. The plan is correct — edit `outages.ts`. Do not search in `OutagesPanel.ts`.

- [ ] **Step 1: Find and replace the label in `outages.ts`**

In `src/services/outages.ts`, find:

```typescript
const causePrefix = hasEnedisMetric
  ? 'Bilan Enedis (historique annuel)'
  : 'Risque tension réseau';
```

Replace with:

```typescript
const causePrefix = hasEnedisMetric
  ? 'Indicateurs Historiques DataFair'
  : 'Risque tension réseau';
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck
```

Expected: no errors (string-only change).

- [ ] **Step 3: Commit**

```bash
git add src/services/outages.ts
git commit -m "fix: clarify Enedis DataFair label as historical indicators"
```

---

## Task 6: Final verification

- [ ] **Step 1: Full typecheck + build**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck && npm run build
```

Expected: both pass with no errors.

- [ ] **Step 2: Start dev server and verify widget**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npm run dev:vite
```

Open browser at `http://localhost:3001`. Verify:
- Widget appears at top-left, below header
- Arc starts empty, animates to score on first load
- Hover shows tooltip with 5 rows + Cloud/Web N/A row at reduced opacity
- No console errors about missing CSS classes or undefined functions

- [ ] **Step 3: Verify critical pulse**

In browser console, temporarily override the barometer widget's update to force a critical score:

```js
// In browser console — force critical state to test pulse animation
document.querySelector('#network-barometer-widget')
  // The dot is the 8px circle in the status row
  ?.querySelectorAll('div')[5]
  ?.classList.add('barometer-pulse')
```

Expected: dot pulses with gentle opacity breath animation (not the expanding ring of `alertPulse`).

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: Baromètre Pannes Réseau France — widget HUD complet"
```
