# France Intel Panel — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a floating "France Intelligence Card" panel that shows a composite instability index, active signals, a Groq-generated bilingual brief, and top news — triggered by clicking France on the map or a fixed navbar button.

**Architecture:** Wrapper over existing App.ts in-memory state (ISNRData, CyberState, MeteoAlert[], NewsItem[]). New panel `FranceIntelPanel.ts` follows the exact same floating modal pattern as `CyberPanel.ts`. A new Vercel Edge function `api/intelligence/v1/france-intel-brief.js` generates the bilingual brief via Groq, mirroring the existing `synthesis.js`. A Vite dev proxy mirrors the Edge function for local development.

**Tech Stack:** TypeScript strict, Vanilla DOM, Vite 6, Vercel Edge, Upstash Redis, Groq API (llama-3.3-70b-versatile), existing Plugin/Panel patterns.

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `api/intelligence/v1/france-intel-brief.js` | Create | Vercel Edge function — Groq brief generation, Redis cache, sanitization |
| `src/plugins/france-intel-proxy.ts` | Create | Vite dev proxy — mirrors `/api/intelligence/v1/france-intel-brief` |
| `vite.config.ts` | Modify | Import + register `franceIntelProxyPlugin()` |
| `src/types/index.ts` | Modify | Add `FranceIntelData` interface |
| `src/services/france-intel-brief.ts` | Create | Client-side fetch + 2h memory cache |
| `src/components/FranceIntelPanel.ts` | Create | Floating modal UI — all 4 sections |
| `src/App.ts` | Modify | Instantiate panel, binding map click + FAB button, wire `open-france-intel` event, hide-others |
| `index.html` | No change | FAB button replaces the navbar button — both triggers are implemented in App.ts (FAB + map click) |

---

## Task 1: Backend Edge Function

**Files:**
- Create: `api/intelligence/v1/france-intel-brief.js`

This is the server-side Groq call. The key lives in `process.env.GROQ_API_KEY` — never exposed to the client.

- [ ] **Step 1.1: Create the Edge function**

```javascript
// api/intelligence/v1/france-intel-brief.js
export const config = { runtime: 'edge' };

import { redisGet, redisSet } from '../../utils/redis.js';

const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const CACHE_TTL  = 900; // 15 minutes — global cache (not per-snapshot), acceptable at this TTL

function sanitizeHeadlines(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, 6)
    .map(h => String(h).replace(/[\r\n]+/g, ' ').slice(0, 120));
}

function buildPrompt(isnrScore, isnrComponents, cyberScore, meteoAlertCount, headlines, lang) {
  const headlineList = headlines.length > 0
    ? headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')
    : lang === 'fr' ? '(aucune actualité significative)' : '(no significant news)';

  if (lang === 'en') {
    return `You are a senior intelligence analyst specializing in France's national security and stability.

Current situation data:
- National Instability Index (CII): ${isnrScore}/100
- Social dimension (protests, strikes): ${isnrComponents.social}/100
- Security dimension (incidents, interventions): ${isnrComponents.security}/100
- Infrastructure dimension (weather, floods, outages): ${isnrComponents.infra}/100
- Cyber dimension (CERT-FR, ransomware, CVE): ${cyberScore}/100
- Active weather alerts: ${meteoAlertCount}

Recent significant headlines:
${headlineList}

Write a 3-4 paragraph intelligence brief (250-350 words) covering:
1. Current Situation — key active signals and their convergence
2. Security & Stability Posture — dominant threats
3. Infrastructure & Risk Factors — energy, transport, cyber, weather
4. Outlook — short-term trajectory

Be analytical, specific, and factual. No speculation.

Respond with valid JSON only: {"brief": "..."}`;
  }

  return `Tu es un analyste senior en renseignement spécialisé dans la sécurité nationale et la stabilité française.

Données situationnelles actuelles :
- Indice d'Instabilité Composite (CII) : ${isnrScore}/100
- Dimension sociale (protestations, grèves) : ${isnrComponents.social}/100
- Dimension sécurité (incidents, interventions) : ${isnrComponents.security}/100
- Dimension infrastructure (météo, crues, pannes) : ${isnrComponents.infra}/100
- Dimension cyber (CERT-FR, ransomware, CVE) : ${cyberScore}/100
- Alertes météo actives : ${meteoAlertCount}

Actualités récentes significatives :
${headlineList}

Rédige un brief de renseignement en 3-4 paragraphes (250-350 mots) couvrant :
1. Situation actuelle — signaux actifs et convergences
2. Posture sécuritaire et stabilité — menaces dominantes
3. Facteurs de risque — énergie, transport, cyber, météo
4. Perspectives — trajectoire à court terme

Sois analytique, précis et factuel. Pas de spéculation.

Réponds en JSON valide uniquement : {"brief": "..."}`;
}

const FALLBACK = { brief: null, fromCache: false };

export default async function handler(request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate & sanitize inputs
  const lang = body.lang === 'en' ? 'en' : 'fr';
  const isnrScore  = typeof body.isnrScore === 'number'  ? Math.round(body.isnrScore)  : 0;
  const cyberScore = typeof body.cyberScore === 'number' ? Math.round(body.cyberScore) : 0;
  const meteoAlertCount = typeof body.meteoAlertCount === 'number' ? body.meteoAlertCount : 0;
  const isnrComponents = {
    social:   typeof body.isnrComponents?.social   === 'number' ? Math.round(body.isnrComponents.social)   : 0,
    security: typeof body.isnrComponents?.security === 'number' ? Math.round(body.isnrComponents.security) : 0,
    infra:    typeof body.isnrComponents?.infra    === 'number' ? Math.round(body.isnrComponents.infra)    : 0,
  };
  const headlines = sanitizeHeadlines(body.topHeadlines);

  // Try Redis cache (global key — acceptable at 15-min TTL)
  const cacheKey = `france-intel:brief:${lang}:v1`;
  const cached = await redisGet(cacheKey);
  if (cached) {
    try {
      return new Response(JSON.stringify({ ...JSON.parse(cached), fromCache: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch { /* corrupted — fall through */ }
  }

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
        messages: [{ role: 'user', content: buildPrompt(isnrScore, isnrComponents, cyberScore, meteoAlertCount, headlines, lang) }],
        temperature: 0.4,
        max_tokens: 700,
      }),
    });

    if (!groqRes.ok) {
      return new Response(JSON.stringify({ ...FALLBACK, computedAt: new Date().toISOString() }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const groqData = await groqRes.json();
    const raw = groqData.choices?.[0]?.message?.content ?? '';
    const clean = raw.replace(/```json|```/g, '').trim();
    const { brief } = JSON.parse(clean);

    const result = {
      brief: typeof brief === 'string' ? brief : null,
      fromCache: false,
      computedAt: new Date().toISOString(),
    };

    await redisSet(cacheKey, JSON.stringify(result), CACHE_TTL);

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[france-intel-brief]', err);
    return new Response(JSON.stringify({ ...FALLBACK, computedAt: new Date().toISOString() }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
```

- [ ] **Step 1.2: Verify typecheck still passes (JS file, no TS errors expected)**

```bash
cd /Users/fraid/Desktop/FranceMonitor && npm run typecheck
```
Expected: no errors.

- [ ] **Step 1.3: Commit**

```bash
git add api/intelligence/v1/france-intel-brief.js
git commit -m "feat(intel): add france-intel-brief Vercel Edge function"
```

---

## Task 2: Vite Dev Proxy Plugin

**Files:**
- Create: `src/plugins/france-intel-proxy.ts`
- Modify: `vite.config.ts`

Mirrors the Edge function for local dev. Pattern is identical to `src/plugins/synthesis-proxy.ts`.

- [ ] **Step 2.1: Create the proxy plugin**

```typescript
// src/plugins/france-intel-proxy.ts
import type { Plugin } from 'vite';

const GROQ_URL   = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const CACHE_TTL  = 900_000; // 15 min in ms

let _devCache: { value: string; expiresAt: number } | null = null;

function sanitizeHeadlines(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[])
    .slice(0, 6)
    .map(h => String(h).replace(/[\r\n]+/g, ' ').slice(0, 120));
}

function buildPrompt(
  isnrScore: number,
  isnrComponents: { social: number; security: number; infra: number },
  cyberScore: number,
  meteoAlertCount: number,
  headlines: string[],
  lang: 'fr' | 'en',
): string {
  const headlineList = headlines.length > 0
    ? headlines.map((h, i) => `${i + 1}. ${h}`).join('\n')
    : lang === 'fr' ? '(aucune actualité significative)' : '(no significant news)';

  if (lang === 'en') {
    return `You are a senior intelligence analyst specializing in France's national security and stability.

Current situation data:
- National Instability Index (CII): ${isnrScore}/100
- Social dimension (protests, strikes): ${isnrComponents.social}/100
- Security dimension (incidents, interventions): ${isnrComponents.security}/100
- Infrastructure dimension (weather, floods, outages): ${isnrComponents.infra}/100
- Cyber dimension (CERT-FR, ransomware, CVE): ${cyberScore}/100
- Active weather alerts: ${meteoAlertCount}

Recent significant headlines:
${headlineList}

Write a 3-4 paragraph intelligence brief (250-350 words) covering:
1. Current Situation
2. Security & Stability Posture
3. Infrastructure & Risk Factors
4. Outlook

Be analytical, specific, factual. No speculation.
Respond with valid JSON only: {"brief": "..."}`;
  }

  return `Tu es un analyste senior en renseignement spécialisé dans la sécurité nationale et la stabilité française.

Données situationnelles actuelles :
- Indice d'Instabilité Composite (CII) : ${isnrScore}/100
- Dimension sociale (protestations, grèves) : ${isnrComponents.social}/100
- Dimension sécurité (incidents, interventions) : ${isnrComponents.security}/100
- Dimension infrastructure (météo, crues, pannes) : ${isnrComponents.infra}/100
- Dimension cyber (CERT-FR, ransomware, CVE) : ${cyberScore}/100
- Alertes météo actives : ${meteoAlertCount}

Actualités récentes significatives :
${headlineList}

Rédige un brief en 3-4 paragraphes (250-350 mots) : Situation actuelle / Posture sécuritaire / Facteurs de risque / Perspectives.
Factuel, précis, pas de spéculation.
Réponds en JSON valide uniquement : {"brief": "..."}`;
}

export function franceIntelProxyPlugin(): Plugin {
  return {
    name: 'france-intel-proxy',
    configureServer(server) {
      server.middlewares.use('/api/intelligence/v1/france-intel-brief', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', async () => {
          res.setHeader('Content-Type', 'application/json');

          if (_devCache && Date.now() < _devCache.expiresAt) {
            res.end(JSON.stringify({ ...JSON.parse(_devCache.value), fromCache: true }));
            return;
          }

          const GROQ_API_KEY = process.env['GROQ_API_KEY'];
          if (!GROQ_API_KEY) {
            res.end(JSON.stringify({ brief: null, fromCache: false, computedAt: new Date().toISOString() }));
            return;
          }

          try {
            const parsed = JSON.parse(body) as {
              lang?: unknown;
              isnrScore?: unknown;
              cyberScore?: unknown;
              meteoAlertCount?: unknown;
              isnrComponents?: { social?: unknown; security?: unknown; infra?: unknown };
              topHeadlines?: unknown;
            };

            const lang: 'fr' | 'en'   = parsed.lang === 'en' ? 'en' : 'fr';
            const isnrScore            = typeof parsed.isnrScore === 'number'  ? Math.round(parsed.isnrScore)  : 0;
            const cyberScore           = typeof parsed.cyberScore === 'number' ? Math.round(parsed.cyberScore) : 0;
            const meteoAlertCount      = typeof parsed.meteoAlertCount === 'number' ? parsed.meteoAlertCount : 0;
            const isnrComponents = {
              social:   typeof parsed.isnrComponents?.social   === 'number' ? Math.round(parsed.isnrComponents.social)   : 0,
              security: typeof parsed.isnrComponents?.security === 'number' ? Math.round(parsed.isnrComponents.security) : 0,
              infra:    typeof parsed.isnrComponents?.infra    === 'number' ? Math.round(parsed.isnrComponents.infra)    : 0,
            };
            const headlines = sanitizeHeadlines(parsed.topHeadlines);

            const groqRes = await fetch(GROQ_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${GROQ_API_KEY}`,
              },
              body: JSON.stringify({
                model: GROQ_MODEL,
                messages: [{ role: 'user', content: buildPrompt(isnrScore, isnrComponents, cyberScore, meteoAlertCount, headlines, lang) }],
                temperature: 0.4,
                max_tokens: 700,
              }),
            });

            if (!groqRes.ok) {
              res.end(JSON.stringify({ brief: null, fromCache: false, computedAt: new Date().toISOString() }));
              return;
            }

            const groqData = await groqRes.json() as { choices: Array<{ message: { content: string } }> };
            const raw = groqData.choices?.[0]?.message?.content ?? '';
            const clean = raw.replace(/```json|```/g, '').trim();
            const { brief } = JSON.parse(clean) as { brief: string };

            const result = {
              brief: typeof brief === 'string' ? brief : null,
              fromCache: false,
              computedAt: new Date().toISOString(),
            };

            _devCache = { value: JSON.stringify(result), expiresAt: Date.now() + CACHE_TTL };
            res.end(JSON.stringify(result));
          } catch (err) {
            console.error('[france-intel-proxy]', err);
            res.end(JSON.stringify({ brief: null, fromCache: false, computedAt: new Date().toISOString() }));
          }
        });
      });
    },
  };
}
```

- [ ] **Step 2.2: Register plugin in `vite.config.ts`**

Add the import at line 28 (after `synthesisProxyPlugin` import):
```typescript
import { franceIntelProxyPlugin } from './src/plugins/france-intel-proxy';
```

Add the plugin call at line 85 (after `synthesisProxyPlugin()`):
```typescript
      franceIntelProxyPlugin(),
```

- [ ] **Step 2.3: Typecheck**

```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 2.4: Commit**

```bash
git add src/plugins/france-intel-proxy.ts vite.config.ts
git commit -m "feat(intel): add france-intel-brief Vite dev proxy"
```

---

## Task 3: Types — `FranceIntelData`

**Files:**
- Modify: `src/types/index.ts`

Add the new interface after the `CyberState` block (around line 1206).

- [ ] **Step 3.1: Add `FranceIntelData` to `src/types/index.ts`**

Find the end of the `CyberState` interface block (look for the closing `}` after `topCVEs`) and add after it:

```typescript
// ═══ France Intelligence Card ═══

export interface FranceIntelData {
  /** ISNRData — full national stability data. NOTE: does NOT have national-level dimensions.
   *  Compute social/security/infra by averaging scores[].dimensions across all departments. */
  stability: ISNRData;
  /** Full cyber state — use cyber.meta.globalScore for the composite score bar. */
  cyber: CyberState;
  /** Active météo vigilance alerts. */
  meteo: MeteoAlert[];
  /** Top 6 news items sorted by severity descending. */
  topNews: NewsItem[];
  /** LLM-generated brief. undefined while loading, null if unavailable. */
  brief?: string | null;
  /** Default: 'fr' */
  briefLang: 'fr' | 'en';
  /** Mapped from API's fromCache boolean. */
  briefFreshness?: 'fresh' | 'cached';
}
```

- [ ] **Step 3.2: Typecheck**

```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 3.3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(intel): add FranceIntelData type"
```

---

## Task 4: Client-side Brief Service

**Files:**
- Create: `src/services/france-intel-brief.ts`

Fetches the brief from the backend and caches it in memory for 2 hours.

- [ ] **Step 4.1: Create the service**

```typescript
// src/services/france-intel-brief.ts
import type { FranceIntelData, ISNRDimensionScores } from '../types/index.ts';

interface BriefCacheEntry {
  brief: string | null;
  freshness: 'fresh' | 'cached';
  expiresAt: number;
}

// In-memory cache keyed by lang
const _cache = new Map<'fr' | 'en', BriefCacheEntry>();
const CACHE_TTL_MS = 2 * 60 * 60 * 1000; // 2h

/** Compute national average of an ISNR dimension across all departments. */
function avgDim(
  scores: FranceIntelData['stability']['scores'],
  key: keyof ISNRDimensionScores,
): number {
  if (scores.length === 0) return 0;
  const sum = scores.reduce((acc, s) => acc + (s.dimensions?.[key] ?? 0), 0);
  return Math.round(sum / scores.length);
}

export interface FranceBriefResult {
  brief: string | null;
  freshness: 'fresh' | 'cached';
}

export async function fetchFranceIntelBrief(
  data: FranceIntelData,
  lang: 'fr' | 'en' = 'fr',
): Promise<FranceBriefResult> {
  // Check client-side cache
  const cached = _cache.get(lang);
  if (cached && Date.now() < cached.expiresAt) {
    return { brief: cached.brief, freshness: 'cached' };
  }

  const isnrScore = data.stability.nationalScore;
  const isnrComponents = {
    social:   avgDim(data.stability.scores, 'social'),
    security: avgDim(data.stability.scores, 'security'),
    infra:    avgDim(data.stability.scores, 'infra'),
  };
  const cyberScore      = data.cyber.meta.globalScore;
  const meteoAlertCount = data.meteo.filter(a => a.level === 'orange' || a.level === 'red' || a.level === 'violet').length;
  const topHeadlines    = data.topNews.slice(0, 6).map(n => n.title);

  try {
    const res = await fetch('/api/intelligence/v1/france-intel-brief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isnrScore, isnrComponents, cyberScore, meteoAlertCount, topHeadlines, lang }),
    });

    if (!res.ok) return { brief: null, freshness: 'fresh' };

    const payload = await res.json() as { brief: string | null; fromCache: boolean };
    const result: FranceBriefResult = {
      brief: payload.brief ?? null,
      freshness: payload.fromCache ? 'cached' : 'fresh',
    };

    _cache.set(lang, { brief: result.brief, freshness: result.freshness, expiresAt: Date.now() + CACHE_TTL_MS });
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

- [ ] **Step 4.2: Typecheck**

```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 4.3: Commit**

```bash
git add src/services/france-intel-brief.ts
git commit -m "feat(intel): add france-intel-brief client service"
```

---

## Task 5: Panel UI — `FranceIntelPanel.ts`

**Files:**
- Create: `src/components/FranceIntelPanel.ts`

Floating modal draggable, identical lifecycle to `CyberPanel.ts`. Four sections: instability index + bars, active signals, brief, top news.

> **⚠️ IMPORTANT — do NOT call `super.mount()`:** `Panel.mount()` calls `render()` and appends its own container. `FranceIntelPanel.mount()` fully overrides it with a custom modal element. Calling `super.mount()` would produce duplicate DOM nodes. Always override `mount()` completely, never chain with `super.mount()`.

- [ ] **Step 5.1: Create the panel**

```typescript
// src/components/FranceIntelPanel.ts
import { Panel } from './Panel.ts';
import type { FranceIntelData, ISNRDimensionScores, MeteoVigilanceLevel } from '../types/index.ts';

const LEVEL_COLORS: Record<string, string> = {
  critical: '#e74c3c',
  high:     '#e67e22',
  medium:   '#f1c40f',
  low:      '#3498db',
  info:     '#95a5a6',
};

const VIGILANCE_EMOJI: Record<MeteoVigilanceLevel, string> = {
  red:    '🔴',
  violet: '🟣',
  orange: '🟠',
  yellow: '🟡',
  green:  '🟢',
};

const THREAT_LABELS: Record<string, string> = {
  critical: 'CRITIQUE',
  high:     'ÉLEVÉ',
  medium:   'MODÉRÉ',
  low:      'BAS',
  info:     'INFO',
};

function ciiColor(score: number): string {
  if (score >= 70) return '#e74c3c';
  if (score >= 55) return '#e67e22';
  if (score >= 40) return '#f1c40f';
  if (score >= 25) return '#3498db';
  return '#2ecc71';
}

function ciiLabel(score: number): string {
  if (score >= 70) return 'Critique';
  if (score >= 55) return 'Élevé';
  if (score >= 40) return 'Modéré';
  if (score >= 25) return 'Normal';
  return 'Bas';
}

function avgDim(
  scores: FranceIntelData['stability']['scores'],
  key: keyof ISNRDimensionScores,
): number {
  if (scores.length === 0) return 0;
  const sum = scores.reduce((acc, s) => acc + (s.dimensions?.[key] ?? 0), 0);
  return Math.round(sum / scores.length);
}

function computeCII(data: FranceIntelData): number {
  const social   = avgDim(data.stability.scores, 'social');
  const security = avgDim(data.stability.scores, 'security');
  const infra    = avgDim(data.stability.scores, 'infra');
  const cyber    = data.cyber.meta.globalScore;
  return Math.round(social * 0.25 + security * 0.30 + infra * 0.20 + cyber * 0.25);
}

function scoreBar(value: number, color: string): string {
  const pct = Math.min(100, Math.max(0, value));
  return `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <div style="flex:1;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:2px;transition:width 0.4s;"></div>
      </div>
      <span style="font-size:11px;color:#aaa;font-variant-numeric:tabular-nums;min-width:26px;text-align:right;">${value}</span>
    </div>`;
}

function timeAgo(date: Date, lang: 'fr' | 'en'): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  const hrs  = Math.floor(mins / 60);
  if (lang === 'en') {
    if (mins < 2)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (hrs < 24)  return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }
  if (mins < 2)  return 'à l\'instant';
  if (mins < 60) return `il y a ${mins} min`;
  if (hrs < 24)  return `il y a ${hrs} h`;
  return `il y a ${Math.floor(hrs / 24)} j`;
}

export class FranceIntelPanel extends Panel {
  private modalEl!: HTMLElement;
  private contentEl: HTMLElement | null = null;
  private onClose?: () => void;
  private isDragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private boundMouseMove: (e: MouseEvent) => void;
  private boundMouseUp: () => void;
  /** Tracks the currently displayed language so reopening restores it. */
  private currentLang: 'fr' | 'en' = 'fr';

  constructor(container: HTMLElement) {
    super(container, { title: 'France Intelligence', icon: '🇫🇷', collapsible: false });
    this.boundMouseMove = (e: MouseEvent) => this.onMouseMove(e);
    this.boundMouseUp  = () => this.onMouseUp();
  }

  mount(): void {
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'france-intel-panel-modal';
    this.modalEl.style.cssText = `
      position: absolute;
      top: var(--right-panel-top, 60px);
      right: 20px;
      width: 380px;
      max-height: calc(100vh - var(--right-panel-top, 60px) - 20px);
      background: var(--bg-surface, #13131a);
      border: 1px solid var(--border-color, rgba(255,255,255,0.1));
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      z-index: 1000;
      display: none;
      flex-direction: column;
      backdrop-filter: blur(10px);
      cursor: grab;
      overflow: hidden;
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px 10px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      flex-shrink: 0;
    `;
    header.innerHTML = `
      <div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:20px;">🇫🇷</span>
          <span style="font-size:15px;font-weight:700;color:#f0f0f0;letter-spacing:0.2px;">France</span>
        </div>
        <div style="font-size:10px;color:#666;letter-spacing:0.08em;text-transform:uppercase;margin-top:2px;">Country Intelligence</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button class="fi-lang-toggle" style="
          background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);
          color:#aaa;font-size:10px;font-weight:700;padding:3px 8px;border-radius:6px;
          cursor:pointer;letter-spacing:0.06em;">FR</button>
        <button class="fi-close" style="
          background:transparent;border:none;color:#666;font-size:16px;
          cursor:pointer;padding:2px 6px;line-height:1;">×</button>
      </div>
    `;

    this.contentEl = document.createElement('div');
    this.contentEl.className = 'france-intel-content';
    this.contentEl.style.cssText = `
      overflow-y: auto;
      flex: 1;
      padding: 0 16px 16px;
    `;

    this.modalEl.appendChild(header);
    this.modalEl.appendChild(this.contentEl);
    this.container.appendChild(this.modalEl);

    // Close button
    const closeBtn = header.querySelector('.fi-close') as HTMLElement;
    closeBtn.onclick = () => this.hide();

    // Lang toggle — stored as data attr, re-render on toggle
    const langBtn = header.querySelector('.fi-lang-toggle') as HTMLElement;
    langBtn.onclick = () => {
      const current = langBtn.textContent?.trim() ?? 'FR';
      const next    = current === 'FR' ? 'EN' : 'FR';
      langBtn.textContent = next;
      // Dispatch to App.ts to re-fetch brief with new lang
      document.dispatchEvent(new CustomEvent('france-intel-lang-toggle', { detail: { lang: next.toLowerCase() as 'fr' | 'en' } }));
    };

    // Drag
    this.modalEl.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('.fi-close')) return;
      if ((e.target as HTMLElement).closest('.fi-lang-toggle')) return;
      if ((e.target as HTMLElement).closest('.france-intel-content')) return;
      this.isDragging = true;
      const rect = this.modalEl.getBoundingClientRect();
      this.dragOffsetX = e.clientX - rect.left;
      this.dragOffsetY = e.clientY - rect.top;
      this.modalEl.style.cursor = 'grabbing';
    });

    document.addEventListener('mousemove', this.boundMouseMove);
    document.addEventListener('mouseup', this.boundMouseUp);
  }

  private onMouseMove(e: MouseEvent): void {
    if (!this.isDragging) return;
    const x = Math.max(0, Math.min(e.clientX - this.dragOffsetX, window.innerWidth  - this.modalEl.offsetWidth));
    const y = Math.max(0, Math.min(e.clientY - this.dragOffsetY, window.innerHeight - this.modalEl.offsetHeight));
    this.modalEl.style.left   = `${x}px`;
    this.modalEl.style.top    = `${y}px`;
    this.modalEl.style.right  = 'auto';
    this.modalEl.style.bottom = 'auto';
  }

  private onMouseUp(): void {
    if (this.isDragging) {
      this.isDragging = false;
      this.modalEl.style.cursor = 'grab';
    }
  }

  protected render(): void { /* populated by show() */ }

  setOnClose(handler: () => void): void {
    this.onClose = handler;
  }

  /** Returns the lang currently displayed — App.ts should pass this back when re-opening. */
  getCurrentLang(): 'fr' | 'en' {
    return this.currentLang;
  }

  show(data: FranceIntelData): void {
    if (!this.contentEl) return;
    this.currentLang = data.briefLang ?? 'fr';
    // Sync the toggle button text to match currentLang
    const langBtn = this.modalEl.querySelector('.fi-lang-toggle') as HTMLElement | null;
    if (langBtn) langBtn.textContent = this.currentLang.toUpperCase();
    this.renderContent(data);
    this.modalEl.style.display = 'flex';
  }

  showBriefLoading(): void {
    const briefEl = this.modalEl.querySelector('.fi-brief-text');
    if (briefEl) {
      briefEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;color:#666;font-size:12px;">
        <span class="fi-spinner" style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.1);border-top-color:#4a9eff;border-radius:50%;animation:fi-spin 0.8s linear infinite;"></span>
        Génération du brief…
      </div>`;
    }
  }

  updateBrief(brief: string | null, freshness: 'fresh' | 'cached'): void {
    const briefEl = this.modalEl.querySelector('.fi-brief-text');
    const badgeEl = this.modalEl.querySelector('.fi-brief-badge');
    if (briefEl) {
      briefEl.innerHTML = brief
        ? brief.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n\n/g, '<br><br>')
        : `<span style="color:#555;font-size:12px;font-style:italic;">Brief indisponible</span>`;
    }
    if (badgeEl) {
      badgeEl.textContent = freshness === 'fresh' ? 'Fresh' : 'Cached';
      (badgeEl as HTMLElement).style.color = freshness === 'fresh' ? '#2ecc71' : '#f39c12';
    }
  }

  hide(): void {
    if (this.modalEl) this.modalEl.style.display = 'none';
    this.onClose?.();
  }

  isVisible(): boolean {
    return this.modalEl?.style.display === 'flex';
  }

  destroy(): void {
    document.removeEventListener('mousemove', this.boundMouseMove);
    document.removeEventListener('mouseup', this.boundMouseUp);
    this.modalEl?.remove();
  }

  private renderContent(data: FranceIntelData): void {
    if (!this.contentEl) return;

    const cii     = computeCII(data);
    const color   = ciiColor(cii);
    const social  = avgDim(data.stability.scores, 'social');
    const security = avgDim(data.stability.scores, 'security');
    const infra   = avgDim(data.stability.scores, 'infra');
    const cyber   = data.cyber.meta.globalScore;
    const lang    = data.briefLang ?? 'fr';

    // Active signals: non-green meteo alerts grouped by risk
    const activeAlerts = data.meteo.filter(a => a.level !== 'green');
    const signalMap = new Map<string, { level: MeteoVigilanceLevel; count: number }>();
    for (const a of activeAlerts) {
      for (const risk of a.risks) {
        const existing = signalMap.get(risk);
        if (!existing || ['red','violet'].includes(a.level)) {
          signalMap.set(risk, { level: a.level, count: (existing?.count ?? 0) + 1 });
        } else {
          signalMap.set(risk, { level: existing.level, count: existing.count + 1 });
        }
      }
    }

    const RISK_LABELS: Record<string, string> = {
      'wind': 'Vent',
      'rain-flood': 'Pluie',
      'thunderstorm': 'Orages',
      'flood': 'Crues',
      'snow-ice': 'Neige',
      'heat': 'Canicule',
      'cold': 'Grand froid',
      'avalanche': 'Avalanches',
      'wave-surge': 'Vagues',
    };

    // Severity order for news sort
    const SEV: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
    const sortedNews = [...data.topNews]
      .sort((a, b) => (SEV[b.threat?.level ?? 'info'] ?? 0) - (SEV[a.threat?.level ?? 'info'] ?? 0))
      .slice(0, 6);

    const signalChips = [...signalMap.entries()]
      .map(([risk, { level, count }]) => {
        const emoji = VIGILANCE_EMOJI[level] ?? '⚪';
        const label = RISK_LABELS[risk] ?? risk;
        return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);font-size:11px;color:#ccc;margin:2px;">${emoji} ${label}${count > 1 ? ` ×${count}` : ''}</span>`;
      }).join('');

    const updatedTime = new Date(data.stability.timestamp).toLocaleTimeString(lang === 'fr' ? 'fr-FR' : 'en-US', { hour: '2-digit', minute: '2-digit' });

    // Inject spinner keyframe once
    if (!document.getElementById('fi-spin-style')) {
      const style = document.createElement('style');
      style.id = 'fi-spin-style';
      style.textContent = '@keyframes fi-spin { to { transform: rotate(360deg); } }';
      document.head.appendChild(style);
    }

    this.contentEl.innerHTML = `
      <!-- Section 1: Instability Index -->
      <div style="margin-top:14px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <span style="font-size:10px;color:#666;letter-spacing:0.1em;text-transform:uppercase;">${lang === 'fr' ? 'Indice d\'instabilité' : 'Instability Index'}</span>
          <span style="font-size:10px;color:#555;">${lang === 'fr' ? 'Mis à jour' : 'Updated'} ${updatedTime}</span>
        </div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
          <div style="font-size:32px;font-weight:800;color:${color};font-variant-numeric:tabular-nums;line-height:1;">${cii}</div>
          <div>
            <div style="font-size:12px;color:#aaa;">/ 100</div>
            <div style="font-size:11px;color:${color};font-weight:600;margin-top:2px;">→ ${ciiLabel(cii)}</div>
          </div>
        </div>
        <div style="font-size:11px;color:#666;margin-bottom:4px;">${lang === 'fr' ? 'Social' : 'Social'}</div>
        ${scoreBar(social, '#e74c3c')}
        <div style="font-size:11px;color:#666;margin-bottom:4px;">${lang === 'fr' ? 'Sécurité' : 'Security'}</div>
        ${scoreBar(security, '#e67e22')}
        <div style="font-size:11px;color:#666;margin-bottom:4px;">${lang === 'fr' ? 'Infrastructure' : 'Infrastructure'}</div>
        ${scoreBar(infra, '#f1c40f')}
        <div style="font-size:11px;color:#666;margin-bottom:4px;">Cyber</div>
        ${scoreBar(cyber, '#9b59b6')}
      </div>

      <!-- Section 2: Active Signals -->
      <div style="margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.06);">
        <div style="font-size:10px;color:#666;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px;">${lang === 'fr' ? 'Signaux Actifs' : 'Active Signals'}</div>
        <div style="line-height:1.8;">
          ${signalChips || `<span style="font-size:12px;color:#555;font-style:italic;">${lang === 'fr' ? 'Aucun signal actif' : 'No active signals'}</span>`}
        </div>
      </div>

      <!-- Section 3: Intelligence Brief -->
      <div style="margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.06);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <span style="font-size:10px;color:#666;letter-spacing:0.1em;text-transform:uppercase;">${lang === 'fr' ? 'Brief Renseignement' : 'Intelligence Brief'}</span>
          <span class="fi-brief-badge" style="font-size:10px;color:#666;font-weight:600;"></span>
        </div>
        <div class="fi-brief-text" style="font-size:12px;color:#bbb;line-height:1.65;"></div>
      </div>

      <!-- Section 4: Top News -->
      <div style="margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.06);">
        <div style="font-size:10px;color:#666;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:10px;">${lang === 'fr' ? 'Actualités Principales' : 'Key Headlines'}</div>
        ${sortedNews.map(item => {
          const level = item.threat?.level ?? 'info';
          const col   = LEVEL_COLORS[level] ?? '#666';
          const ago   = timeAgo(item.pubDate, lang);
          const escaped = item.title.replace(/</g, '&lt;').replace(/>/g, '&gt;');
          return `
            <div style="display:flex;gap:8px;margin-bottom:10px;align-items:flex-start;">
              <span style="display:inline-block;padding:2px 6px;border-radius:4px;background:${col}22;border:1px solid ${col}44;color:${col};font-size:9px;font-weight:700;letter-spacing:0.06em;white-space:nowrap;flex-shrink:0;">${THREAT_LABELS[level]}</span>
              <div style="flex:1;min-width:0;">
                <div style="font-size:11px;color:#ccc;line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${escaped}</div>
                <div style="font-size:10px;color:#555;margin-top:2px;">${item.source} • ${ago}</div>
              </div>
            </div>`;
        }).join('')}
        ${sortedNews.length === 0 ? `<span style="font-size:12px;color:#555;font-style:italic;">${lang === 'fr' ? 'Aucune actualité récente' : 'No recent news'}</span>` : ''}
      </div>
    `;

    // Show loading state for brief (populated async by App.ts)
    this.showBriefLoading();
  }
}
```

- [ ] **Step 5.2: Typecheck**

```bash
npm run typecheck
```
Expected: no errors.

- [ ] **Step 5.3: Commit**

```bash
git add src/components/FranceIntelPanel.ts
git commit -m "feat(intel): add FranceIntelPanel UI component"
```

---

## Task 6: Wire Everything in App.ts

**Files:**
- Modify: `src/App.ts`

Three changes:
1. Import the panel and service
2. Instantiate panel in the floating container block (with other panels)
3. Add FAB button + map click trigger + `open-france-intel` event listener

- [ ] **Step 6.1: Add imports to `App.ts`**

Near the top of App.ts, after the existing panel imports (around line 24), add:

```typescript
import { FranceIntelPanel } from './components/FranceIntelPanel.ts';
import { fetchFranceIntelBrief, clearFranceBriefCache } from './services/france-intel-brief.ts';
import type { FranceIntelData } from './types/index.ts';
```

- [ ] **Step 6.2: Add private field to App class**

Find the private field declarations block (around line 1127) and add:

```typescript
  private franceIntelPanel: FranceIntelPanel | null = null;
```

- [ ] **Step 6.3: Instantiate panel and add FAB button**

Find the barometerBtn block in the `buildUI` method (around line 1698) and add after `mapArea.appendChild(barometerBtn)`:

```typescript
    // ── Bouton flottant "France Intelligence" ──
    const franceIntelBtn = document.createElement('button');
    franceIntelBtn.id = 'france-intel-fab';
    franceIntelBtn.innerHTML = '🇫🇷 Intelligence France';
    franceIntelBtn.style.cssText = `
      position: absolute;
      top: 110px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 900;
      background: linear-gradient(135deg, rgba(30,30,50,0.92), rgba(20,20,40,0.95));
      border: 1px solid rgba(255,255,255,0.18);
      color: #e8e8ec;
      padding: 8px 18px;
      border-radius: 24px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      backdrop-filter: blur(12px);
      transition: all 0.2s;
      white-space: nowrap;
      letter-spacing: 0.2px;
    `;
    franceIntelBtn.onmouseover = () => {
      franceIntelBtn.style.borderColor = 'rgba(255,255,255,0.3)';
      franceIntelBtn.style.transform = 'translateX(-50%) scale(1.04)';
    };
    franceIntelBtn.onmouseout = () => {
      franceIntelBtn.style.borderColor = 'rgba(255,255,255,0.18)';
      franceIntelBtn.style.transform = 'translateX(-50%) scale(1)';
    };
    franceIntelBtn.onclick = () => {
      document.dispatchEvent(new CustomEvent('open-france-intel'));
    };
    mapArea.appendChild(franceIntelBtn);
```

- [ ] **Step 6.4: Instantiate panel in the float container block**

Find the `this.cyberPanel = new CyberPanel(floatContainer)` block (around line 2079) and add after it:

```typescript
    this.franceIntelPanel = new FranceIntelPanel(floatContainer);
    this.franceIntelPanel.setOnClose(() => { /* nothing to clean up */ });
    this.franceIntelPanel.mount();
```

- [ ] **Step 6.5: Add event listener for `open-france-intel`**

Add after the `open-health-barometer` listener (around line 2012), a new listener:

```typescript
    document.addEventListener('open-france-intel', () => {
      const stability = this.currentISNRData;
      const cyber     = this.currentCyberData;
      if (!stability || !cyber) return;

      // Restore the last lang the user selected (defaults to 'fr' on first open)
      const lang = this.franceIntelPanel?.getCurrentLang() ?? 'fr';

      const data: FranceIntelData = {
        stability,
        cyber,
        meteo:    this.currentMeteoAlerts,
        topNews:  this.newsItems.slice(0, 20), // panel will sort+slice to 6
        briefLang: lang,
      };

      this.franceIntelPanel?.show(data);

      // Fetch brief async, update panel when ready
      void fetchFranceIntelBrief(data, lang).then(({ brief, freshness }) => {
        this.franceIntelPanel?.updateBrief(brief, freshness);
      });
    });

    // Handle lang toggle from panel header
    document.addEventListener('france-intel-lang-toggle', (e: Event) => {
      const { lang } = (e as CustomEvent<{ lang: 'fr' | 'en' }>).detail;
      const stability = this.currentISNRData;
      const cyber     = this.currentCyberData;
      if (!stability || !cyber) return;

      const data: FranceIntelData = {
        stability,
        cyber,
        meteo:    this.currentMeteoAlerts,
        topNews:  this.newsItems.slice(0, 20),
        briefLang: lang,
      };

      // Re-render panel content with new lang (brief shows loading)
      this.franceIntelPanel?.show(data);

      void fetchFranceIntelBrief(data, lang).then(({ brief, freshness }) => {
        this.franceIntelPanel?.updateBrief(brief, freshness);
      });
    });
```

- [ ] **Step 6.6: Add `franceIntelPanel?.hide()` to all hide-others blocks**

Every existing panel open event hides the others. Grep for `this.environmentPanel?.hide()` in `src/App.ts` to find all hide-others blocks (there are ~4). In each block that currently calls `.hide()` on other panels (e.g. around lines 2002-2008, 2293-2301, and in the health/energy/transport/isnr open paths), add:

```typescript
      this.franceIntelPanel?.hide();
```

alongside the existing `.hide()` calls. Also add the reverse: in the `open-france-intel` listener (Step 6.5), before `this.franceIntelPanel?.show(data)`, hide other modal panels:

```typescript
      this.environmentPanel?.hide();
      this.energyPanel?.hide();
      this.isnrPanel?.hide();
      this.cyberPanel?.hide();
      this.healthBarometerPanel?.hide();
      this.firesPanel?.hide();
      this.transportPanel?.hide();
      this.trafficPanel?.hide();
```

- [ ] **Step 6.8: Add map click trigger for France**

Find the `setOnRawMapClick` handler (around line 2730):

```typescript
    this.mapContainer.setOnRawMapClick((lat, lon) => {
      void lat;
      void lon;
      if (this.activeLayers.elus) this.elusPanel?.showPlaceholder();
    });
```

Replace with:

```typescript
    this.mapContainer.setOnRawMapClick((lat, lon) => {
      // If click is within rough France bounding box and elus layer is not active → open intel panel
      const inFrance = lat >= 41.3 && lat <= 51.2 && lon >= -5.2 && lon <= 9.6;
      if (inFrance && !this.activeLayers.elus) {
        document.dispatchEvent(new CustomEvent('open-france-intel'));
        return;
      }
      if (this.activeLayers.elus) this.elusPanel?.showPlaceholder();
    });
```

- [ ] **Step 6.9: Full typecheck + build**

```bash
npm run typecheck && npm run build
```
Expected: no TypeScript errors, build succeeds.

- [ ] **Step 6.10: Commit**

```bash
git add src/App.ts
git commit -m "feat(intel): wire FranceIntelPanel into App — FAB, map click, event listeners, hide-others"
```

---

## Task 7: Final Verification

- [ ] **Step 7.1: Run `npm run dev` and smoke-test manually**

```bash
npm run dev
```

Verify:
1. `🇫🇷 Intelligence France` FAB button appears on the map
2. Clicking it opens the panel with CII score and 4 bars
3. Brief spinner shows, then brief text appears (may take 2-5s)
4. Toggle FR/EN re-fetches brief in the other language
5. Panel is draggable by its header
6. Close button works
7. Clicking France on the map (when no layer is active) also opens the panel

- [ ] **Step 7.2: Final build**

```bash
npm run build && npm run typecheck
```
Expected: clean build, no errors.

- [ ] **Step 7.3: Final commit**

```bash
git add -A
git commit -m "feat(intel): France Intel Panel V1 — CII, signals, brief IA, actualités"
```
