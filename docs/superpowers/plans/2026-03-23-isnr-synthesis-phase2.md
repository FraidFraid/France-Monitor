# ISNR Synthesis Phase 2 — Multi-layer Correlation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the national ISNR stability score to the AI synthesis prompt and display the returned `stabilityImpact` as a shimmering progress bar in the BarometerWidget.

**Architecture:** `App.ts` passes `currentISNRData?.nationalScore` to `fetchISNRSynthesis`, which forwards it in the POST body to the synthesis endpoint. Both `synthesis.js` (prod Edge function) and `synthesis-proxy.ts` (dev Vite plugin) incorporate it into the `buildPrompt`. `BarometerWidget` renders the score as a thin bar below the briefing text.

**Tech Stack:** Vanilla TypeScript, Vite 6, Vercel Edge Functions (no Express), Groq `llama-3.3-70b-versatile`, CSS animations.

> **No test runner in this project.** All verification is: `npm run typecheck && npm run build` from `/Users/fraid/Desktop/FranceMonitor`. Both must pass with zero errors before committing any task.

---

## File Map

| File | Change |
|------|--------|
| `api/intelligence/v1/synthesis.js` | Accept `isnrNationalScore` in request body; update `buildPrompt` |
| `src/plugins/synthesis-proxy.ts` | Same `buildPrompt` update for dev environment |
| `src/services/isnr-synthesis.ts` | Add `isnrNationalScore?: number` third param; forward in POST body |
| `src/App.ts` | Pass `this.currentISNRData?.nationalScore` at call site (line 1354) |
| `src/components/BarometerWidget.ts` | Add stability bar UI, extend `updateBriefing`, `destroy` |
| `src/styles/main.css` | Add `@keyframes stability-shimmer` + `.stability-shimmer` class |

---

## Task 1: Update synthesis.js — accept ISNR score in prompt

**Files:**
- Modify: `api/intelligence/v1/synthesis.js:14-38` (`buildPrompt` function)
- Modify: `api/intelligence/v1/synthesis.js:53` (request body destructure)

**Context:** The Edge function currently builds its prompt from `(scores, headlines)`. We need to accept the optional `isnrNationalScore` and inject it into the prompt template. The clarification line at the end of the prompt is also being added here.

- [ ] **Step 1: Update `buildPrompt` signature and prompt template**

Replace lines 14–39 of `api/intelligence/v1/synthesis.js`:

```js
function buildPrompt(scores, headlines, isnrNationalScore) {
  const { details, score, status } = scores;
  const headlineList = headlines.length > 0
    ? headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')
    : '(aucune actualité significative détectée)';

  const isnrLine = isnrNationalScore != null
    ? `Score ISNR (stabilité sociale & sécuritaire nationale) : ${isnrNationalScore}/100`
    : `Score ISNR (stabilité sociale & sécuritaire nationale) : indisponible`;

  return `Tu es un analyste OSINT spécialisé dans la résilience des infrastructures françaises.

Voici les scores techniques actuels du Baromètre Réseau France :
- Électricité (Ecowatt) : ${details.elec ?? 'N/A'}/100
- Internet/BGP (IODA) : ${details.bgp ?? 'N/A'}/100
- Télécom (ARCEP) : ${details.telecom ?? 'N/A'}/100
- Météo Spatiale : ${details.space ?? 'N/A'}/100
- Cyber (CERT-FR) : ${details.cyber ?? 'N/A'}/100
Score composite : ${score}/100 (${status})

${isnrLine}

Actualités récentes à impact (filtrées medium/high) :
${headlineList}

Instructions :
1. Détecte les CONVERGENCES entre les scores techniques, le score ISNR et les actualités (ex: chute BGP + ISNR bas + news câble sous-marin).
2. Rédige un "Situation Briefing" en exactement 2 phrases, en français, concis et factuel.
3. Fournis un score d'impact sur la stabilité de 0 à 100.

IMPORTANT : Un score stabilityImpact élevé (proche de 100) signifie une INSTABILITÉ ou un DANGER élevé pour la résilience nationale. Un score bas (proche de 0) signifie une situation stable et nominale.

Réponds UNIQUEMENT en JSON valide, sans texte avant ou après : {"briefing": "...", "stabilityImpact": 42}`;
}
```

- [ ] **Step 2a: Extend the `let` declaration on line 51**

```js
// Before (line 51):
  let scores, headlines;
// After:
  let scores, headlines, isnrNationalScore;
```

- [ ] **Step 2b: Extend the destructure on line 53**

```js
// Before (line 53):
    ({ scores, headlines } = await request.json());
// After:
    ({ scores, headlines, isnrNationalScore } = await request.json());
```

Both edits are required. The `let` declaration must include `isnrNationalScore` or the assignment on line 53 will throw a JS reference error.

- [ ] **Step 3: Pass `isnrNationalScore` to `buildPrompt`**

On line 91 (the `buildPrompt` call), change:

```js
// Before:
            messages: [{ role: 'user', content: buildPrompt(scores, headlines) }],
// After:
            messages: [{ role: 'user', content: buildPrompt(scores, headlines, isnrNationalScore) }],
```

- [ ] **Step 4: Verify**

```bash
cd /Users/fraid/Desktop/FranceMonitor
npm run typecheck && npm run build
```

Expected: 0 errors. Note: `synthesis.js` is plain JS so typecheck won't cover it; build should complete cleanly.

- [ ] **Step 5: Commit**

```bash
git add api/intelligence/v1/synthesis.js
git commit -m "feat(synthesis): inject isnrNationalScore into AI prompt (prod edge function)"
```

---

## Task 2: Update synthesis-proxy.ts — same prompt update for dev

**Files:**
- Modify: `src/plugins/synthesis-proxy.ts:13-39` (`buildPrompt` function)
- Modify: `src/plugins/synthesis-proxy.ts:75` (body destructure)
- Modify: `src/plugins/synthesis-proxy.ts:88` (`buildPrompt` call)

**Context:** The Vite dev plugin mirrors the Edge function exactly. Same changes as Task 1, but in TypeScript with typed parameters.

- [ ] **Step 1: Update `buildPrompt` signature and prompt template**

Replace lines 13–40 of `src/plugins/synthesis-proxy.ts`:

```ts
function buildPrompt(scores: Record<string, unknown>, headlines: string[], isnrNationalScore?: number): string {
  const details = scores.details as Record<string, number | null> ?? {};
  const score = scores.score as number ?? 0;
  const status = scores.status as string ?? 'unknown';
  const headlineList = headlines.length > 0
    ? headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')
    : '(aucune actualité significative détectée)';

  const isnrLine = isnrNationalScore != null
    ? `Score ISNR (stabilité sociale & sécuritaire nationale) : ${isnrNationalScore}/100`
    : `Score ISNR (stabilité sociale & sécuritaire nationale) : indisponible`;

  return `Tu es un analyste OSINT spécialisé dans la résilience des infrastructures françaises.

Voici les scores techniques actuels du Baromètre Réseau France :
- Électricité (Ecowatt) : ${details['elec'] ?? 'N/A'}/100
- Internet/BGP (IODA) : ${details['bgp'] ?? 'N/A'}/100
- Télécom (ARCEP) : ${details['telecom'] ?? 'N/A'}/100
- Météo Spatiale : ${details['space'] ?? 'N/A'}/100
- Cyber (CERT-FR) : ${details['cyber'] ?? 'N/A'}/100
Score composite : ${score}/100 (${status})

${isnrLine}

Actualités récentes à impact (filtrées medium/high) :
${headlineList}

Instructions :
1. Détecte les CONVERGENCES entre les scores techniques, le score ISNR et les actualités (ex: chute BGP + ISNR bas + news câble sous-marin).
2. Rédige un "Situation Briefing" en exactement 2 phrases, en français, concis et factuel.
3. Fournis un score d'impact sur la stabilité de 0 à 100.

IMPORTANT : Un score stabilityImpact élevé (proche de 100) signifie une INSTABILITÉ ou un DANGER élevé pour la résilience nationale. Un score bas (proche de 0) signifie une situation stable et nominale.

Réponds UNIQUEMENT en JSON valide, sans texte avant ou après : {"briefing": "...", "stabilityImpact": 42}`;
}
```

- [ ] **Step 2: Update body destructure**

Replace line 75 of `src/plugins/synthesis-proxy.ts`:

```ts
// Before:
            const { scores, headlines } = JSON.parse(body) as {
              scores: Record<string, unknown>;
              headlines: string[];
            };
```

```ts
// After:
            const { scores, headlines, isnrNationalScore } = JSON.parse(body) as {
              scores: Record<string, unknown>;
              headlines: string[];
              isnrNationalScore?: number;
            };
```

- [ ] **Step 3: Pass `isnrNationalScore` to `buildPrompt`**

Replace line 88 (the `buildPrompt` call inside the `messages` array):

```ts
// Before:
                messages: [{ role: 'user', content: buildPrompt(scores, headlines) }],
// After:
                messages: [{ role: 'user', content: buildPrompt(scores, headlines, isnrNationalScore) }],
```

- [ ] **Step 4: Verify**

```bash
cd /Users/fraid/Desktop/FranceMonitor
npm run typecheck && npm run build
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/plugins/synthesis-proxy.ts
git commit -m "feat(synthesis): inject isnrNationalScore into AI prompt (dev proxy)"
```

---

## Task 3: Wire isnrNationalScore through isnr-synthesis.ts and App.ts

**Files:**
- Modify: `src/services/isnr-synthesis.ts:19-22` (function signature)
- Modify: `src/services/isnr-synthesis.ts:36` (POST body)
- Modify: `src/App.ts:1354` (call site)

**Context:** `fetchISNRSynthesis` currently takes `(barometer, newsItems)`. We add `isnrNationalScore?: number` as a third param and include it in the POST body only when defined. In `App.ts`, the existing `this.currentISNRData` field (line 817) holds the ISNR data — we pass its `nationalScore`.

- [ ] **Step 1: Add `isnrNationalScore` param and conditional body key**

Replace lines 19–37 of `src/services/isnr-synthesis.ts`:

```ts
export async function fetchISNRSynthesis(
  barometer: NetworkBarometerResult,
  newsItems: NewsItem[],
  isnrNationalScore?: number,
): Promise<ISNRSynthesisResult | null> {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) {
    return _cache.data;
  }

  // Extract headlines: title + source name
  const headlines = newsItems.map(item =>
    item.source ? `[${item.source}] ${item.title}` : item.title,
  );

  try {
    const body: Record<string, unknown> = { scores: barometer, headlines };
    if (isnrNationalScore !== undefined) {
      body.isnrNationalScore = isnrNationalScore;
    }

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
```

(The rest of the function from line 39 onward is unchanged — `if (!res.ok)` through the `catch` block.)

- [ ] **Step 2: Pass `isnrNationalScore` in App.ts**

Replace line 1354 of `src/App.ts`:

```ts
// Before:
      const synthesis = await fetchISNRSynthesis(result, headlines).catch(() => null);
// After:
      const synthesis = await fetchISNRSynthesis(result, headlines, this.currentISNRData?.nationalScore).catch(() => null);
```

- [ ] **Step 3: Verify**

```bash
cd /Users/fraid/Desktop/FranceMonitor
npm run typecheck && npm run build
```

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/services/isnr-synthesis.ts src/App.ts
git commit -m "feat(synthesis): forward isnrNationalScore from App.ts through fetch service"
```

---

## Task 4: Add stability bar to BarometerWidget + CSS

**Files:**
- Modify: `src/components/BarometerWidget.ts`
- Modify: `src/styles/main.css:1389-1391` (after `.barometer-pulse` block)

**Context:** `BarometerWidget` already has `briefingContainerEl`, `briefingTextEl`, `briefingTimeEl`. We add `stabilityBarContainerEl` and `stabilityBarFillEl`, build the bar in `_buildBriefing()`, update it in `updateBriefing()`, and null them in `destroy()`.

BarometerWidget.ts current structure:
- Line 23: last private field (`briefingTimeEl`)
- Line 169: `_buildBriefing()` — builds the container, appends label + `briefingTextEl` + `briefingTimeEl`, returns the container
- Line 262: `updateBriefing(result)` — updates text/time from result
- Line 316: `destroy()` — nulls all refs

- [ ] **Step 1: Add two private fields**

After line 25 in `src/components/BarometerWidget.ts` (after `private briefingTimeEl`):

```ts
// Before:
  private briefingTimeEl: HTMLElement | null = null;

  constructor(container: HTMLElement) {
```

```ts
// After:
  private briefingTimeEl: HTMLElement | null = null;
  private stabilityBarContainerEl: HTMLElement | null = null;
  private stabilityBarFillEl: HTMLElement | null = null;

  constructor(container: HTMLElement) {
```

- [ ] **Step 2: Build the stability bar in `_buildBriefing()`**

In `_buildBriefing()`, before the final `return this.briefingContainerEl`:

```ts
// Before (last 3 lines of _buildBriefing):
    this.briefingContainerEl.appendChild(label);
    this.briefingContainerEl.appendChild(this.briefingTextEl);
    this.briefingContainerEl.appendChild(this.briefingTimeEl);
    return this.briefingContainerEl;
```

```ts
// After:
    this.briefingContainerEl.appendChild(label);
    this.briefingContainerEl.appendChild(this.briefingTextEl);
    this.briefingContainerEl.appendChild(this.briefingTimeEl);
    this.briefingContainerEl.appendChild(this._buildStabilityBar());
    return this.briefingContainerEl;
```

Add the `_buildStabilityBar()` helper method just before `_buildBriefing()` (or after it — place it alongside the other `_build*` methods):

```ts
  private _buildStabilityBar(): HTMLElement {
    this.stabilityBarContainerEl = document.createElement('div');
    this.stabilityBarContainerEl.style.cssText = `
      display: none;
      margin-top: 6px;
      padding-top: 6px;
      border-top: 1px solid rgba(255,255,255,0.07);
    `;

    const headerRow = document.createElement('div');
    headerRow.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    `;

    const stabilityLabel = document.createElement('span');
    stabilityLabel.style.cssText = `
      font-size: 8px;
      font-weight: 700;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--text-muted);
    `;
    stabilityLabel.textContent = 'STABILITÉ SYSTÉMIQUE';

    const stabilityValue = document.createElement('span');
    stabilityValue.style.cssText = `
      font-size: 8px;
      font-family: monospace;
      color: var(--text-muted);
    `;
    stabilityValue.className = 'stability-value';

    headerRow.appendChild(stabilityLabel);
    headerRow.appendChild(stabilityValue);

    const track = document.createElement('div');
    track.style.cssText = `
      height: 3px;
      background: rgba(255,255,255,0.08);
      border-radius: 2px;
      overflow: hidden;
    `;

    this.stabilityBarFillEl = document.createElement('div');
    this.stabilityBarFillEl.style.cssText = `
      height: 100%;
      width: 0%;
      border-radius: 2px;
      transition: width 0.6s ease;
    `;

    track.appendChild(this.stabilityBarFillEl);
    this.stabilityBarContainerEl.appendChild(headerRow);
    this.stabilityBarContainerEl.appendChild(track);
    return this.stabilityBarContainerEl;
  }
```

- [ ] **Step 3: Update `updateBriefing()` to render the bar**

Replace the existing `updateBriefing` method (lines 262–280 of `src/components/BarometerWidget.ts`):

```ts
  updateBriefing(result: ISNRSynthesisResult | null): void {
    if (!this.briefingTextEl || !this.briefingTimeEl || !this.stabilityBarContainerEl || !this.stabilityBarFillEl) return;

    if (!result || !result.briefing) {
      this.briefingTextEl.textContent = 'IA indisponible';
      this.briefingTextEl.style.color = 'var(--text-muted)';
      this.briefingTextEl.style.fontStyle = 'italic';
      this.briefingTimeEl.textContent = '';
      this.stabilityBarContainerEl.style.display = 'none';
      return;
    }

    this.briefingTextEl.textContent = result.briefing;
    this.briefingTextEl.style.color = 'var(--text-secondary)';
    this.briefingTextEl.style.fontStyle = 'normal';

    const mins = Math.round((Date.now() - result.computedAt.getTime()) / 60_000);
    const cacheLabel = result.fromCache ? ' · cache' : '';
    this.briefingTimeEl.textContent = `Llama · il y a ${mins} min${cacheLabel}`;

    // Stability bar
    if (result.stabilityImpact == null) {
      this.stabilityBarContainerEl.style.display = 'none';
      return;
    }

    this.stabilityBarContainerEl.style.display = 'block';

    const impact = result.stabilityImpact;
    const color = impact >= 70 ? '#ff2d55'
                : impact >= 40 ? '#ffcc00'
                :                '#34c759';

    this.stabilityBarFillEl.style.width = `${impact}%`;
    this.stabilityBarFillEl.style.background = color;

    if (impact > 60) {
      this.stabilityBarFillEl.classList.add('stability-shimmer');
    } else {
      this.stabilityBarFillEl.classList.remove('stability-shimmer');
    }

    const valueEl = this.stabilityBarContainerEl.querySelector('.stability-value') as HTMLElement | null;
    if (valueEl) {
      valueEl.textContent = `${impact}/100`;
      valueEl.style.color = color;
    }
  }
```

- [ ] **Step 4: Null the new fields in `destroy()`**

In `destroy()`, after `this.briefingTimeEl = null;` (line 329):

```ts
// Before:
    this.briefingContainerEl = null;
    this.briefingTextEl = null;
    this.briefingTimeEl = null;
  }
```

```ts
// After:
    this.briefingContainerEl = null;
    this.briefingTextEl = null;
    this.briefingTimeEl = null;
    this.stabilityBarContainerEl = null;
    this.stabilityBarFillEl = null;
  }
```

- [ ] **Step 5: Add CSS animation to `main.css`**

Insert after line 1391 (`.barometer-pulse` closing brace) in `src/styles/main.css`:

```css
@keyframes stability-shimmer {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.5; }
}

.stability-shimmer {
  animation: stability-shimmer 1.5s ease-in-out infinite;
}
```

- [ ] **Step 6: Verify**

```bash
cd /Users/fraid/Desktop/FranceMonitor
npm run typecheck && npm run build
```

Expected: 0 errors, clean build.

- [ ] **Step 7: Commit**

```bash
git add src/components/BarometerWidget.ts src/styles/main.css
git commit -m "feat(ui): add stabilityImpact progress bar to BarometerWidget"
```
