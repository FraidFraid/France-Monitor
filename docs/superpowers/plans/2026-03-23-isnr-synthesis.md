# ISNR Synthesis & AI Briefing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Llama/Groq AI synthesis layer to the Network Barometer widget that correlates infrastructure scores with news headlines, caches results in Upstash Redis (15 min TTL), and displays a 2-sentence "Situation Briefing" in the sidebar.

**Architecture:** A new Vercel Edge Function (`api/intelligence/v1/synthesis.js`) receives POST requests with barometer scores + news headlines, checks Redis cache, calls Groq on cache miss, and returns a structured briefing. The frontend service `src/services/isnr-synthesis.ts` calls this endpoint, and `BarometerWidget.ts` displays the result in a glassmorphism panel below the existing arc gauge. `App.ts` wires everything into the existing 5-minute refresh loop.

**Tech Stack:** Vanilla TypeScript + Vite, Vercel Edge Functions (ESM), Upstash Redis REST API (plain fetch), Groq API (`llama-3.3-70b-versatile`), existing CSS variables for theming.

**Note on testing:** This project has no test runner configured. Verification uses `npm run typecheck` (strict TypeScript) and `npm run build` as the safety net after each task.

---

## File Map

| File | Status | Responsibility |
|------|--------|----------------|
| `api/utils/redis.js` | **Create** | Upstash REST helper — `redisGet`, `redisSet` |
| `api/intelligence/v1/synthesis.js` | **Create** | Edge Function — Redis cache + Groq call |
| `src/services/isnr-synthesis.ts` | **Create** | Frontend service — calls endpoint, in-memory cache |
| `src/plugins/synthesis-proxy.ts` | **Create** | Vite dev plugin — proxies POST in local dev |
| `src/components/BarometerWidget.ts` | **Modify** | Add AI BRIEFING section + `updateBriefing()` |
| `src/App.ts` | **Modify** | Wire synthesis into `refreshNetworkBarometer` |
| `src/components/OutagesPanel.ts` | **Modify** | Update 2 DataFair label strings |
| `vite.config.ts` | **Modify** | Register `synthesisProxyPlugin` |
| `.env` | **Modify** | Add `GROQ_API_KEY` |

---

## Task 1: Redis utility (`api/utils/redis.js`)

**Files:**
- Create: `api/utils/redis.js`

This file provides two functions that talk to the Upstash Redis REST API over plain HTTP. It reads credentials from `process.env` (available in Edge and Node runtimes). Never throws — returns `null` on any error.

- [ ] **Step 1.1: Create the file**

```js
// api/utils/redis.js
// Upstash Redis REST helper — works in Edge (fetch) and Node runtimes.
// Never throws: returns null on any network or parse error.

const BASE_URL   = process.env.UPSTASH_REDIS_REST_URL;
const AUTH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

/**
 * @param {string} key
 * @returns {Promise<string | null>}
 */
export async function redisGet(key) {
  if (!BASE_URL || !AUTH_TOKEN) return null;
  try {
    const res = await fetch(`${BASE_URL}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.result ?? null;
  } catch {
    return null;
  }
}

/**
 * @param {string} key
 * @param {string} value  — must already be JSON.stringify'd
 * @param {number} ttlSec
 * @returns {Promise<void>}
 */
export async function redisSet(key, value, ttlSec) {
  if (!BASE_URL || !AUTH_TOKEN) return;
  try {
    await fetch(`${BASE_URL}/set/${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify([value, 'EX', ttlSec]),
    });
  } catch {
    // fire-and-forget: cache failure never propagates
  }
}
```

- [ ] **Step 1.2: Verify build still passes**

```bash
npm run typecheck && npm run build
```

Expected: no new errors (this is a JS file, TypeScript ignores it).

- [ ] **Step 1.3: Commit**

```bash
git add api/utils/redis.js
git commit -m "feat: add Upstash Redis REST helper"
```

---

## Task 2: Synthesis serverless function (`api/intelligence/v1/synthesis.js`)

**Files:**
- Create: `api/intelligence/v1/synthesis.js`
- Depends on: `api/utils/redis.js` (Task 1)

This is a Vercel Edge Function. It:
1. Parses the POST body as JSON (`request.json()` — Web API, not `req.body`)
2. Checks Redis for a cached result (key: `isnr:synthesis:fr`, TTL: 900s)
3. On cache miss, calls Groq with the OSINT analyst prompt
4. Parses the JSON response from Groq
5. Caches and returns the result
6. On any failure, returns `{ briefing: null, stabilityImpact: null }` — never throws a 500

- [ ] **Step 2.1: Create the file**

```js
// api/intelligence/v1/synthesis.js — Vercel Edge Function
// POST { scores: NetworkBarometerResult, headlines: string[] }
// → { briefing: string|null, stabilityImpact: number|null, fromCache: bool, computedAt: string }

export const config = { runtime: 'edge' };

import { redisGet, redisSet } from '../../utils/redis.js';

const CACHE_KEY = 'isnr:synthesis:fr';
const CACHE_TTL = 900; // 15 minutes
const GROQ_URL  = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

function buildPrompt(scores, headlines) {
  const { details, score, status } = scores;
  const headlineList = headlines.length > 0
    ? headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')
    : '(aucune actualité significative détectée)';

  return `Tu es un analyste OSINT spécialisé dans la résilience des infrastructures françaises.

Voici les scores techniques actuels du Baromètre Réseau France :
- Électricité (Ecowatt) : ${details.elec ?? 'N/A'}/100
- Internet/BGP (IODA) : ${details.bgp ?? 'N/A'}/100
- Télécom (ARCEP) : ${details.telecom ?? 'N/A'}/100
- Météo Spatiale : ${details.space ?? 'N/A'}/100
- Cyber (CERT-FR) : ${details.cyber ?? 'N/A'}/100
Score composite : ${score}/100 (${status})

Actualités récentes à impact (filtrées medium/high) :
${headlineList}

Instructions :
1. Détecte les CONVERGENCES entre les scores techniques et les actualités (ex: chute BGP + news câble sous-marin).
2. Rédige un "Situation Briefing" en exactement 2 phrases, en français, concis et factuel.
3. Fournis un score d'impact sur la stabilité de 0 à 100 (0 = aucun impact, 100 = crise majeure).

Réponds UNIQUEMENT en JSON valide, sans texte avant ou après : {"briefing": "...", "stabilityImpact": 42}`;
}

const FALLBACK = { briefing: null, stabilityImpact: null, fromCache: false };

export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let scores, headlines;
  try {
    ({ scores, headlines } = await request.json());
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // 1. Try Redis cache
  const cached = await redisGet(CACHE_KEY);
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      return new Response(JSON.stringify({ ...parsed, fromCache: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch {
      // corrupted cache entry — fall through to AI call
    }
  }

  // 2. Call Groq
  const GROQ_API_KEY = process.env.GROQ_API_KEY;
  if (!GROQ_API_KEY) {
    return new Response(JSON.stringify({ ...FALLBACK, computedAt: new Date().toISOString() }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const groqRes = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: buildPrompt(scores, headlines) }],
        temperature: 0.3,
        max_tokens: 300,
      }),
    });

    if (!groqRes.ok) {
      console.error('[synthesis] Groq error', groqRes.status);
      return new Response(
        JSON.stringify({ ...FALLBACK, computedAt: new Date().toISOString() }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    }

    const groqData = await groqRes.json();
    const raw = groqData.choices?.[0]?.message?.content ?? '';

    // Parse the JSON response from Groq (strip any accidental markdown fences)
    const clean = raw.replace(/```json|```/g, '').trim();
    const { briefing, stabilityImpact } = JSON.parse(clean);

    const result = {
      briefing: typeof briefing === 'string' ? briefing : null,
      stabilityImpact: typeof stabilityImpact === 'number' ? stabilityImpact : null,
      fromCache: false,
      computedAt: new Date().toISOString(),
    };

    // 3. Store in Redis (fire-and-forget)
    await redisSet(CACHE_KEY, JSON.stringify(result), CACHE_TTL);

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[synthesis] error', err);
    return new Response(
      JSON.stringify({ ...FALLBACK, computedAt: new Date().toISOString() }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  }
}
```

- [ ] **Step 2.2: Verify build**

```bash
npm run typecheck && npm run build
```

Expected: no new errors.

- [ ] **Step 2.3: Commit**

```bash
git add api/intelligence/v1/synthesis.js
git commit -m "feat: add ISNR AI synthesis serverless function (Groq + Redis cache)"
```

---

## Task 3: Frontend service (`src/services/isnr-synthesis.ts`)

**Files:**
- Create: `src/services/isnr-synthesis.ts`
- Depends on: Task 2 (endpoint must exist)

This TypeScript service calls `POST /api/intelligence/v1/synthesis`. It has a 5-minute in-memory cache to avoid redundant calls within the same session, and always returns `null` on any network failure.

- [ ] **Step 3.1: Create the file**

```typescript
// src/services/isnr-synthesis.ts
// Frontend service: calls /api/intelligence/v1/synthesis and caches the result.

import type { NetworkBarometerResult } from './network-barometer.ts';
import type { NewsItem } from '../types/index.ts';

export interface ISNRSynthesisResult {
  briefing: string | null;
  stabilityImpact: number | null;
  fromCache: boolean;
  computedAt: Date;  // parsed from ISO string returned by the endpoint
}

const ENDPOINT = '/api/intelligence/v1/synthesis';
const CACHE_TTL_MS = 5 * 60_000;

let _cache: { data: ISNRSynthesisResult; ts: number } | null = null;

export async function fetchISNRSynthesis(
  barometer: NetworkBarometerResult,
  newsItems: NewsItem[],
): Promise<ISNRSynthesisResult | null> {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) {
    return _cache.data;
  }

  // Extract headlines: title + source name when available
  const headlines = newsItems.map(item =>
    item.source ? `[${item.source}] ${item.title}` : item.title,
  );

  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scores: barometer, headlines }),
    });

    if (!res.ok) {
      console.warn(`[isnr-synthesis] endpoint returned ${res.status}`);
      return null;
    }

    const data = await res.json() as {
      briefing: string | null;
      stabilityImpact: number | null;
      fromCache: boolean;
      computedAt: string;
    };

    const result: ISNRSynthesisResult = {
      briefing: data.briefing,
      stabilityImpact: data.stabilityImpact,
      fromCache: data.fromCache,
      computedAt: new Date(data.computedAt),  // ISO string → Date
    };

    _cache = { data: result, ts: Date.now() };
    return result;
  } catch (err) {
    console.warn('[isnr-synthesis] fetch failed', err);
    return null;
  }
}
```

- [ ] **Step 3.2: Verify typecheck**

```bash
npm run typecheck
```

Expected: 0 errors. If `NewsItem.source` doesn't exist on the type, change to `item.feedRegion ?? item.title` as fallback.

- [ ] **Step 3.3: Commit**

```bash
git add src/services/isnr-synthesis.ts
git commit -m "feat: add isnr-synthesis frontend service"
```

---

## Task 4: Vite dev plugin (`src/plugins/synthesis-proxy.ts`)

**Files:**
- Create: `src/plugins/synthesis-proxy.ts`
- Modify: `vite.config.ts` (add import + register plugin)

The plugin intercepts `POST /api/intelligence/v1/synthesis` in local dev. It replicates the serverless function logic using Node middleware (`req`/`res` — no `request.json()`). Body must be collected manually via `data`/`end` events.

- [ ] **Step 4.1: Create the plugin file**

```typescript
// src/plugins/synthesis-proxy.ts
import type { Plugin } from 'vite';

const CACHE_KEY = 'isnr:synthesis:fr';
const CACHE_TTL = 900;
const GROQ_URL  = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

// Simple in-process memory cache for dev (mirrors Redis TTL behaviour)
let _devCache: { value: string; expiresAt: number } | null = null;

function buildPrompt(scores: Record<string, unknown>, headlines: string[]): string {
  const details = scores.details as Record<string, number | null> ?? {};
  const score = scores.score as number ?? 0;
  const status = scores.status as string ?? 'unknown';
  const headlineList = headlines.length > 0
    ? headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')
    : '(aucune actualité significative détectée)';

  return `Tu es un analyste OSINT spécialisé dans la résilience des infrastructures françaises.

Voici les scores techniques actuels du Baromètre Réseau France :
- Électricité (Ecowatt) : ${details['elec'] ?? 'N/A'}/100
- Internet/BGP (IODA) : ${details['bgp'] ?? 'N/A'}/100
- Télécom (ARCEP) : ${details['telecom'] ?? 'N/A'}/100
- Météo Spatiale : ${details['space'] ?? 'N/A'}/100
- Cyber (CERT-FR) : ${details['cyber'] ?? 'N/A'}/100
Score composite : ${score}/100 (${status})

Actualités récentes à impact (filtrées medium/high) :
${headlineList}

Instructions :
1. Détecte les CONVERGENCES entre les scores techniques et les actualités.
2. Rédige un "Situation Briefing" en exactement 2 phrases, en français, concis et factuel.
3. Fournis un score d'impact sur la stabilité de 0 à 100.

Réponds UNIQUEMENT en JSON valide, sans texte avant ou après : {"briefing": "...", "stabilityImpact": 42}`;
}

export function synthesisProxyPlugin(): Plugin {
  return {
    name: 'synthesis-proxy',
    configureServer(server) {
      server.middlewares.use('/api/intelligence/v1/synthesis', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', async () => {
          res.setHeader('Content-Type', 'application/json');

          // Dev in-process cache
          if (_devCache && Date.now() < _devCache.expiresAt) {
            const cached = JSON.parse(_devCache.value);
            res.end(JSON.stringify({ ...cached, fromCache: true }));
            return;
          }

          const GROQ_API_KEY = process.env['GROQ_API_KEY'];
          if (!GROQ_API_KEY) {
            res.end(JSON.stringify({
              briefing: null, stabilityImpact: null, fromCache: false,
              computedAt: new Date().toISOString(),
            }));
            return;
          }

          try {
            const { scores, headlines } = JSON.parse(body) as {
              scores: Record<string, unknown>;
              headlines: string[];
            };

            const groqRes = await fetch(GROQ_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${GROQ_API_KEY}`,
              },
              body: JSON.stringify({
                model: GROQ_MODEL,
                messages: [{ role: 'user', content: buildPrompt(scores, headlines) }],
                temperature: 0.3,
                max_tokens: 300,
              }),
            });

            if (!groqRes.ok) {
              res.end(JSON.stringify({
                briefing: null, stabilityImpact: null, fromCache: false,
                computedAt: new Date().toISOString(),
              }));
              return;
            }

            const groqData = await groqRes.json() as {
              choices: Array<{ message: { content: string } }>;
            };
            const raw = groqData.choices?.[0]?.message?.content ?? '';
            const clean = raw.replace(/```json|```/g, '').trim();
            const { briefing, stabilityImpact } = JSON.parse(clean) as {
              briefing: string;
              stabilityImpact: number;
            };

            const result = {
              briefing: typeof briefing === 'string' ? briefing : null,
              stabilityImpact: typeof stabilityImpact === 'number' ? stabilityImpact : null,
              fromCache: false,
              computedAt: new Date().toISOString(),
            };

            _devCache = { value: JSON.stringify(result), expiresAt: Date.now() + CACHE_TTL * 1000 };
            res.end(JSON.stringify(result));
          } catch (err) {
            console.error('[synthesis-proxy]', err);
            res.end(JSON.stringify({
              briefing: null, stabilityImpact: null, fromCache: false,
              computedAt: new Date().toISOString(),
            }));
          }
        });
      });
    },
  };
}
```

- [ ] **Step 4.2: Register plugin in `vite.config.ts`**

Add the import at the top of `vite.config.ts` alongside the other plugin imports (after line 21):

```typescript
import { synthesisProxyPlugin } from './src/plugins/synthesis-proxy';
```

Then register it in the `plugins` array. Find the block that lists plugins like `ecowattProxyPlugin()`, `arcepProxyPlugin()` etc., and add `synthesisProxyPlugin()` at the end of that group:

```typescript
synthesisProxyPlugin(),
```

- [ ] **Step 4.3: Verify typecheck + build**

```bash
npm run typecheck && npm run build
```

Expected: 0 errors.

- [ ] **Step 4.4: Commit**

```bash
git add src/plugins/synthesis-proxy.ts vite.config.ts
git commit -m "feat: add synthesis Vite dev proxy plugin"
```

---

## Task 5: BarometerWidget — AI BRIEFING section

**Files:**
- Modify: `src/components/BarometerWidget.ts`

Add three things:
1. A new private field `briefingEl` pointing to the text area
2. A new private method `_buildBriefing()` that returns the glassmorphism container
3. A new public method `updateBriefing(result)` that updates the text

The new section appears below the existing arc+labels row. It uses `backdrop-filter: blur(12px)` and `background: rgba(0,0,0,0.4)`. The status dot already has `barometer-pulse` applied when `score < 60` (existing code at line 192) — no change needed there.

- [ ] **Step 5.1: Add `ISNRSynthesisResult` import and new private fields**

At the top of `BarometerWidget.ts`, after the existing import:

```typescript
import type { ISNRSynthesisResult } from '../services/isnr-synthesis.ts';
```

In the class body, after `private tooltipEl: HTMLElement | null = null;`, add:

```typescript
private briefingContainerEl: HTMLElement | null = null;
private briefingTextEl: HTMLElement | null = null;
private briefingTimeEl: HTMLElement | null = null;
```

- [ ] **Step 5.2: Add `_buildBriefing()` private method**

Add this method to the class, after `_buildTooltip()`:

```typescript
private _buildBriefing(): HTMLElement {
  this.briefingContainerEl = document.createElement('div');
  this.briefingContainerEl.style.cssText = `
    margin-top: 6px;
    padding: 8px 10px;
    background: rgba(0,0,0,0.4);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 8px;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  `;

  const label = document.createElement('div');
  label.style.cssText = `
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-bottom: 5px;
  `;
  label.textContent = 'AI BRIEFING';

  this.briefingTextEl = document.createElement('div');
  this.briefingTextEl.style.cssText = `
    font-size: 10px;
    color: var(--text-secondary);
    line-height: 1.5;
    font-family: monospace;
    min-height: 28px;
  `;
  this.briefingTextEl.textContent = '—';

  this.briefingTimeEl = document.createElement('div');
  this.briefingTimeEl.style.cssText = `
    font-size: 9px;
    color: var(--text-muted);
    margin-top: 4px;
    opacity: 0.6;
  `;
  this.briefingTimeEl.textContent = '';

  this.briefingContainerEl.appendChild(label);
  this.briefingContainerEl.appendChild(this.briefingTextEl);
  this.briefingContainerEl.appendChild(this.briefingTimeEl);
  return this.briefingContainerEl;
}
```

- [ ] **Step 5.3: Update `mount()` to add the briefing section**

In `mount()`, after `this.el.appendChild(this._buildTooltip());`, add:

```typescript
this.el.appendChild(this._buildBriefing());
```

- [ ] **Step 5.4: Add `updateBriefing()` public method**

Add this method to the class, after the `update()` method:

```typescript
updateBriefing(result: ISNRSynthesisResult | null): void {
  if (!this.briefingTextEl || !this.briefingTimeEl) return;

  if (!result || !result.briefing) {
    this.briefingTextEl.textContent = 'IA indisponible';
    this.briefingTextEl.style.color = 'var(--text-muted)';
    this.briefingTextEl.style.fontStyle = 'italic';
    this.briefingTimeEl.textContent = '';
    return;
  }

  this.briefingTextEl.textContent = result.briefing;
  this.briefingTextEl.style.color = 'var(--text-secondary)';
  this.briefingTextEl.style.fontStyle = 'normal';

  const mins = Math.round((Date.now() - result.computedAt.getTime()) / 60_000);
  const cacheLabel = result.fromCache ? ' · cache' : '';
  this.briefingTimeEl.textContent = `Llama · il y a ${mins} min${cacheLabel}`;
}
```

- [ ] **Step 5.5: Update `destroy()` to null-out new fields**

In the `destroy()` method, after `this.tooltipEl = null;`, add:

```typescript
this.briefingContainerEl = null;
this.briefingTextEl = null;
this.briefingTimeEl = null;
```

- [ ] **Step 5.6: Verify typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 5.7: Commit**

```bash
git add src/components/BarometerWidget.ts
git commit -m "feat: add AI BRIEFING section to BarometerWidget"
```

---

## Task 6: App.ts — wire synthesis into barometer refresh

**Files:**
- Modify: `src/App.ts`

Two changes:
1. Add import for `fetchISNRSynthesis`
2. Extend the `refreshNetworkBarometer` closure to filter headlines and call synthesis

- [ ] **Step 6.1: Add import**

In `src/App.ts`, after the last `import` line (currently line 82), add:

```typescript
import { fetchISNRSynthesis } from './services/isnr-synthesis.ts';
```

- [ ] **Step 6.2: Replace the `refreshNetworkBarometer` closure**

Find this existing block (around line 1332):

```typescript
const refreshNetworkBarometer = async (): Promise<void> => {
  const result = await fetchNetworkBarometer();
  this.networkBarometerWidget?.update(result);
};
```

Replace it with:

```typescript
const refreshNetworkBarometer = async (): Promise<void> => {
  const result = await fetchNetworkBarometer();
  this.networkBarometerWidget?.update(result);

  // Headline filtering: medium/high first (dense signal), fallback to low
  // to confirm stability when no high-impact events are present
  const medium = this.newsItems
    .filter(n => ['medium', 'high', 'critical'].includes(n.threat?.level ?? ''))
    .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
    .slice(0, 10);

  const headlines = medium.length >= 3
    ? medium
    : [
        ...medium,
        ...this.newsItems
          .filter(n => n.threat?.level === 'low')
          .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
          .slice(0, 10 - medium.length),
      ];

  const synthesis = await fetchISNRSynthesis(result, headlines).catch(() => null);
  this.networkBarometerWidget?.updateBriefing(synthesis);
};
```

- [ ] **Step 6.3: Verify typecheck + build**

```bash
npm run typecheck && npm run build
```

Expected: 0 errors and clean build.

- [ ] **Step 6.4: Commit**

```bash
git add src/App.ts
git commit -m "feat: wire ISNR synthesis into barometer refresh loop"
```

---

## Task 7: OutagesPanel — label update

**Files:**
- Modify: `src/components/OutagesPanel.ts`

Two text substitutions.

- [ ] **Step 7.1: Update line 311**

Find:
```
Source Enedis DataFair · Ecowatt RTE
```

Replace with:
```
Indicateurs Historiques DataFair · Ecowatt RTE
```

- [ ] **Step 7.2: Update line 353**

Find:
```
⚡ Enedis DataFair · Ecowatt RTE · Signalements citoyens
```

Replace with:
```
⚡ Indicateurs Historiques DataFair · Ecowatt RTE · Signalements citoyens
```

- [ ] **Step 7.3: Verify typecheck**

```bash
npm run typecheck
```

Expected: 0 errors.

- [ ] **Step 7.4: Commit**

```bash
git add src/components/OutagesPanel.ts
git commit -m "fix: update OutagesPanel DataFair labels"
```

---

## Task 8: Environment variables

**Files:**
- Modify: `.env`

- [ ] **Step 8.1: Add `GROQ_API_KEY` to `.env`**

Open `.env` and add the following (after the existing `SNCF_API_KEY` line):

```
# Groq (synthesis AI + fallback IA cloud)
GROQ_API_KEY=<your groq key from console.groq.com>
VITE_GROQ_API_KEY=<same key — used by src/services/summarization.ts in browser>
```

Both can hold the same key. `GROQ_API_KEY` is used by the serverless function and the Vite dev plugin. `VITE_GROQ_API_KEY` is used by `src/services/summarization.ts` via `import.meta.env`.

- [ ] **Step 8.2: Verify dev server starts and synthesis works**

```bash
npm run dev
```

Open the app at http://localhost:3001. After the barometer's first load (~5s), the "AI BRIEFING" section should populate below the arc gauge. Check the browser console for any `[isnr-synthesis]` warnings.

If Groq key is not yet available: the widget shows "IA indisponible" (expected fallback behaviour).

- [ ] **Step 8.3: Final build verification**

```bash
npm run typecheck && npm run build
```

Expected: 0 errors, clean build.

---

## Completion Checklist

- [ ] `api/utils/redis.js` created and committed
- [ ] `api/intelligence/v1/synthesis.js` created and committed
- [ ] `src/services/isnr-synthesis.ts` created and committed
- [ ] `src/plugins/synthesis-proxy.ts` created, `vite.config.ts` updated, committed
- [ ] `BarometerWidget.ts` has `updateBriefing()` and AI BRIEFING panel, committed
- [ ] `App.ts` wired with filtered headlines + synthesis call, committed
- [ ] `OutagesPanel.ts` labels updated, committed
- [ ] `.env` has `GROQ_API_KEY` (and optionally `VITE_GROQ_API_KEY`)
- [ ] `npm run typecheck` → 0 errors
- [ ] `npm run build` → clean build
- [ ] AI BRIEFING visible in the sidebar with real or fallback text
