# ISNR Synthesis Phase 2 — Multi-layer Correlation Design Spec
**Date**: 2026-03-23
**Project**: France Monitor v5
**Phase**: 2 — Cross-layer AI analysis (infra + social/security stability)

---

## 1. Objective

Enhance the existing AI Synthesis layer (Phase 1) with:
1. **Data injection**: Pass the national ISNR stability score to the AI alongside the existing infrastructure scores
2. **Prompt update**: Cross-reference social/security stability with infra scores; clarify that high `stabilityImpact` = high danger
3. **UI display**: Show the `stabilityImpact` score (0-100) as a thin progress bar in `BarometerWidget` below the briefing text, with shimmer animation when > 60

No new files. Three modified files, one wiring change in App.ts.

---

## 2. Files Modified

| File | Change |
|------|--------|
| `src/services/isnr-synthesis.ts` | Add optional `isnrNationalScore?: number` param to `fetchISNRSynthesis` |
| `api/intelligence/v1/synthesis.js` | Accept `isnrNationalScore` from request body, inject into prompt |
| `src/plugins/synthesis-proxy.ts` | Same prompt update as synthesis.js |
| `src/App.ts` | Pass `this.currentISNRData?.nationalScore` to `fetchISNRSynthesis` |
| `src/components/BarometerWidget.ts` | Add `stabilityImpact` progress bar in `_buildBriefing()` |

---

## 3. Component Details

### 3.1 `src/services/isnr-synthesis.ts`

Add `isnrNationalScore` as a third optional parameter:

```typescript
export async function fetchISNRSynthesis(
  barometer: NetworkBarometerResult,
  newsItems: NewsItem[],
  isnrNationalScore?: number,
): Promise<ISNRSynthesisResult | null>
```

Forward in POST body (omit key if undefined to keep payloads clean):

```typescript
const body: Record<string, unknown> = { scores: barometer, headlines };
if (isnrNationalScore !== undefined) {
  body.isnrNationalScore = isnrNationalScore;
}
```

In-memory cache key does not need to change (ISNR score changes with the same 5-min cycle).

### 3.2 `api/intelligence/v1/synthesis.js` — prompt update

Destructure from request body:

```js
const { scores, headlines, isnrNationalScore } = await request.json();
```

Updated prompt template — add ISNR block after infra scores and clarification at the end:

```
Tu es un analyste OSINT spécialisé dans la résilience des infrastructures françaises.

Voici les scores techniques actuels du Baromètre Réseau France :
- Électricité (Ecowatt) : {elec}/100
- Internet/BGP (IODA) : {bgp}/100
- Télécom (ARCEP) : {telecom}/100
- Météo Spatiale : {space}/100
- Cyber (CERT-FR) : {cyber}/100
Score composite : {score}/100 ({status})

Score ISNR (stabilité sociale & sécuritaire nationale) : {isnrNationalScore}/100

Actualités récentes à impact (filtrées medium/high) :
{headlines}

Instructions :
1. Détecte les CONVERGENCES entre les scores techniques, le score ISNR et les actualités.
2. Rédige un "Situation Briefing" en exactement 2 phrases, en français, concis et factuel.
3. Fournis un score d'impact sur la stabilité de 0 à 100.

IMPORTANT : Un score stabilityImpact élevé (proche de 100) signifie une INSTABILITÉ
ou un DANGER élevé pour la résilience nationale. Un score bas (proche de 0) signifie
une situation stable et nominale.

Réponds UNIQUEMENT en JSON : {"briefing": "...", "stabilityImpact": 42}
```

If `isnrNationalScore` is undefined/null, replace the ISNR line with:
`Score ISNR (stabilité sociale & sécuritaire nationale) : indisponible`

### 3.3 `src/plugins/synthesis-proxy.ts`

Same prompt update as `synthesis.js`. Destructure `isnrNationalScore` from `JSON.parse(body)`.

### 3.4 `src/App.ts`

In `refreshNetworkBarometer`, pass the national score:

```typescript
const synthesis = await fetchISNRSynthesis(
  result,
  headlines,
  this.currentISNRData?.nationalScore,
).catch(() => null);
```

`this.currentISNRData` is the existing `ISNRData | null` field (populated by the ISNR refresh loop).

### 3.5 `src/components/BarometerWidget.ts` — stability bar

Add two private fields:

```typescript
private stabilityBarContainerEl: HTMLElement | null = null;
private stabilityBarFillEl: HTMLElement | null = null;
```

In `_buildBriefing()`, after `briefingTimeEl`, append a stability bar section:

```
┌─────────────────────────────────┐
│  STABILITÉ SYSTÉMIQUE           │
│  ████████░░░░  72/100           │
└─────────────────────────────────┘
```

Structure:
```typescript
const stabilityContainer = document.createElement('div');
// margin-top: 6px; border-top: 1px solid rgba(255,255,255,0.07); padding-top: 6px

const stabilityLabel = document.createElement('div');
// font-size: 8px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase;
// color: var(--text-muted); margin-bottom: 4px; display: flex; justify-content: space-between

// label left: "STABILITÉ SYSTÉMIQUE"
// label right: score value (e.g. "72/100"), monospace

const stabilityTrack = document.createElement('div');
// height: 3px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden

this.stabilityBarFillEl = document.createElement('div');
// height: 100%; width: 0%; border-radius: 2px; transition: width 0.6s ease
```

Color logic in `updateBriefing`:
- `stabilityImpact < 40` → `#34c759` (green, nominal)
- `stabilityImpact < 70` → `#ffcc00` (orange, degraded)
- `stabilityImpact >= 70` → `#ff2d55` (red, critical)

Shimmer when `stabilityImpact > 60`: add CSS class `stability-shimmer` to `stabilityBarFillEl`. Define in `main.css`:

```css
@keyframes stability-shimmer {
  0%   { opacity: 1; }
  50%  { opacity: 0.5; }
  100% { opacity: 1; }
}
.stability-shimmer {
  animation: stability-shimmer 1.5s ease-in-out infinite;
}
```

In `updateBriefing`:
- Guard both new refs at the top of the method alongside the existing guard:
  `if (!this.briefingTextEl || !this.briefingTimeEl || !this.stabilityBarContainerEl || !this.stabilityBarFillEl) return;`
- Null/unavailable `stabilityImpact`: hide the stability bar container (`display: none`)
- Available: show container, set fill width to `${stabilityImpact}%`, apply color, toggle shimmer class

Shimmer threshold is intentionally `> 60` (not aligned with the red threshold of `>= 70`). Shimmer signals elevated tension from the upper-yellow range onward — before it becomes critical. A bar that is orange-high and pulsing draws more attention than a static red bar.

In `destroy()`: null out the two new fields.

---

## 4. Graceful Degradation

| Scenario | Behaviour |
|----------|-----------|
| `currentISNRData` is null | `isnrNationalScore` omitted from POST body; prompt shows "indisponible" |
| `stabilityImpact` is null (AI failure) | Stability bar hidden (`display: none`) |
| Phase 1 failures unchanged | All Phase 1 fallbacks remain identical |

---

## 5. Out of Scope

- Per-department synthesis (national score only)
- Historical stabilityImpact trend chart
- Changing the Redis cache key or TTL
