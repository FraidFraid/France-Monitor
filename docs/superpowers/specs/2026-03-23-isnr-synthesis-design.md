# ISNR Synthesis & AI Briefing — Design Spec
**Date**: 2026-03-23
**Project**: France Monitor v5
**Approach**: World Monitor — correlate technical outages with news events via AI (Llama/Groq)

---

## 1. Objective

Add an AI synthesis layer to the existing Network Barometer widget. When the barometer refreshes every 5 minutes, the system:
1. Collects current infrastructure scores (electricity, BGP, telecom, space weather, cyber)
2. Collects the 10 most recent high-signal news headlines (threat.level >= medium)
3. Sends both to Llama via Groq (serverless function)
4. Caches the AI response in Upstash Redis (TTL 15 min)
5. Displays a 2-sentence "Situation Briefing" in the BarometerWidget

---

## 2. Architecture

```
App.ts (setInterval 5 min)
  ├─ fetchNetworkBarometer()         → NetworkBarometerResult (scores)
  ├─ headline filtering              → top 10 NewsItem (medium/high, fallback low)
  └─ fetchISNRSynthesis(scores, headlines)
       └─ POST /api/intelligence/v1/synthesis
            ├─ Redis GET isnr:synthesis:fr  → cache hit: return
            └─ cache miss: Groq call → Redis SET TTL 900s → return

networkBarometerWidget.update(result)          // always
networkBarometerWidget.updateBriefing(ai)      // if synthesis resolves, null-safe
```

---

## 3. Files

### New files

| File | Purpose |
|------|---------|
| `api/utils/redis.js` | Upstash REST helper: `redisGet(key)`, `redisSet(key, val, ttlSec)` |
| `api/intelligence/v1/synthesis.js` | Serverless function: Redis cache + Groq AI call |
| `src/plugins/synthesis-proxy.ts` | Vite dev plugin — proxies POST /api/intelligence/v1/synthesis |
| `src/services/isnr-synthesis.ts` | Frontend service — calls endpoint, 5-min in-memory cache |

### Modified files

| File | Change |
|------|--------|
| `src/components/BarometerWidget.ts` | Add "AI BRIEFING" section + `updateBriefing()` method |
| `src/App.ts` | Wire headline filtering + synthesis call in `refreshNetworkBarometer` |
| `src/components/OutagesPanel.ts` | Update DataFair labels (2 lines) |
| `vite.config.ts` | Register synthesisProxy plugin |

---

## 4. Component Details

### 4.1 `api/utils/redis.js`

```js
// Upstash Redis REST API — works in Edge/Node serverless
async function redisGet(key) { ... }          // GET /get/:key
async function redisSet(key, value, ttlSec) { ... }  // POST /set/:key with EX
export { redisGet, redisSet }
```

Reads `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from `process.env`.
Never throws — returns `null` on network error.

### 4.2 `api/intelligence/v1/synthesis.js`

- Runtime: `export const config = { runtime: 'edge' }` — consistent with other api functions
- Method: POST
- Body parsing: `const { scores, headlines } = await request.json()` (Web API, not `req.body`)
- Body: `{ scores: NetworkBarometerResult, headlines: string[] }`
- Cache key: `isnr:synthesis:fr`
- TTL: 900 seconds (15 min)
- AI model: `llama-3.3-70b-versatile` via Groq (`api.groq.com/openai/v1/chat/completions`)
- Response: `{ briefing: string, stabilityImpact: number, fromCache: boolean, computedAt: string }` — `computedAt` is an ISO string
- Fallback: `{ briefing: null, stabilityImpact: null, fromCache: false }` on any AI failure

**Prompt template:**
```
Tu es un analyste OSINT spécialisé dans la résilience des infrastructures françaises.

Voici les scores techniques actuels du Baromètre Réseau France :
- Électricité (Ecowatt) : {elec}/100
- Internet/BGP (IODA) : {bgp}/100
- Télécom (ARCEP) : {telecom}/100
- Météo Spatiale : {space}/100
- Cyber (CERT-FR) : {cyber}/100
Score composite : {score}/100 ({status})

Actualités récentes à impact (filtrées medium/high) :
{headlines}

Instructions :
1. Détecte les CONVERGENCES entre les scores techniques et les actualités.
2. Rédige un "Situation Briefing" en exactement 2 phrases, en français, concis et factuel.
3. Fournis un score d'impact sur la stabilité de 0 à 100.

Réponds UNIQUEMENT en JSON : {"briefing": "...", "stabilityImpact": 42}
```

### 4.3 `src/plugins/synthesis-proxy.ts`

Vite plugin intercepting `POST /api/intelligence/v1/synthesis` during dev.
Mirrors the serverless function logic (same Redis + Groq calls) using `UPSTASH_*` and `GROQ_API_KEY` from `.env`.

Body parsing note: unlike the Edge function which uses `request.json()`, the Vite plugin middleware uses Node's `http.IncomingMessage`. Body must be collected manually via `data`/`end` events and parsed with `JSON.parse()`:
```ts
server.middlewares.use('/api/intelligence/v1/synthesis', (req, res, next) => {
  if (req.method !== 'POST') return next();
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    const { scores, headlines } = JSON.parse(body);
    // ... same logic as serverless function
  });
});
```

### 4.4 `src/services/isnr-synthesis.ts`

```typescript
export interface ISNRSynthesisResult {
  briefing: string | null;
  stabilityImpact: number | null;
  fromCache: boolean;
  computedAt: Date;  // parsed from ISO string in the JSON response
}

export async function fetchISNRSynthesis(
  barometer: NetworkBarometerResult,
  newsItems: NewsItem[],
): Promise<ISNRSynthesisResult | null>
```

- In-memory cache: 5 min (avoids redundant calls within the same poll cycle)
- On network error: returns `null`, logs warning
- Headlines extraction: maps `NewsItem.title` (+ source if available)
- `computedAt` conversion: the endpoint returns ISO string; `fetchISNRSynthesis` must do `new Date(data.computedAt)` before returning the typed result

### 4.5 `BarometerWidget.ts` — AI BRIEFING section

Added below the existing arc+labels row:

```
┌─────────────────────────────────┐
│  [arc]  INFRASTRUCTURES FRANCE  │  ← existing
│         ● Nominal               │
├─────────────────────────────────┤
│  AI BRIEFING                    │  ← new section
│  "Les scores BGP et télécom     │
│   restent stables..."           │
│  [Llama · il y a 3 min]         │
└─────────────────────────────────┘
```

Styles:
- Container: `backdrop-filter: blur(12px); background: rgba(0,0,0,0.4); border-radius: 8px; padding: 8px 10px; margin-top: 6px;`
- Label: `font-size: 8px; font-weight: 700; letter-spacing: 0.1em; color: var(--text-muted); text-transform: uppercase`
- Text: `font-size: 10px; color: var(--text-secondary); line-height: 1.5; font-family: monospace`
- Alert pulse on status dot when `score < 60` (uses existing `barometer-pulse` CSS class, already applied in `BarometerWidget.update()` at line 192)

States:
- Loading: skeleton shimmer placeholder
- Null/error: "IA indisponible" in muted color
- Populated: briefing text + timestamp

New public method:
```typescript
updateBriefing(result: ISNRSynthesisResult | null): void
```

### 4.6 `App.ts` wiring

In `refreshNetworkBarometer()`:

```typescript
const refreshNetworkBarometer = async (): Promise<void> => {
  const result = await fetchNetworkBarometer();
  this.networkBarometerWidget?.update(result);

  // Headline filtering: medium/high first, fallback to low
  // `this.newsItems` is the private NewsItem[] field already populated by the RSS refresh loop
  const allNews = this.newsItems;
  const medium = allNews
    .filter(n => ['medium','high','critical'].includes(n.threat?.level ?? ''))
    .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
    .slice(0, 10);
  const headlines = medium.length >= 3 ? medium : [
    ...medium,
    ...allNews
      .filter(n => n.threat?.level === 'low')
      .sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime())
      .slice(0, 10 - medium.length),
  ];

  const synthesis = await fetchISNRSynthesis(result, headlines).catch(() => null);
  this.networkBarometerWidget?.updateBriefing(synthesis);
};
```

The existing `setInterval(..., 5 * 60_000)` is unchanged.

### 4.7 `OutagesPanel.ts` label update

- Line 311: `Source Enedis DataFair · Ecowatt RTE` → `Indicateurs Historiques DataFair · Ecowatt RTE`
- Line 353: `⚡ Enedis DataFair · Ecowatt RTE · Signalements citoyens` → `⚡ Indicateurs Historiques DataFair · Ecowatt RTE · Signalements citoyens`

---

## 5. Environment Variables

Server-side (no `VITE_` prefix, used in serverless functions and Vite plugin via `process.env`):
```
UPSTASH_REDIS_REST_URL=https://moving-mudfish-81683.upstash.io
UPSTASH_REDIS_REST_TOKEN=<token>
GROQ_API_KEY=<groq key>           # used by synthesis serverless function + Vite plugin
```

Note: `src/services/summarization.ts` uses `VITE_GROQ_API_KEY` (with `VITE_` prefix, exposed to browser bundle via `import.meta.env`). Both variables must be set in `.env` if both synthesis (serverless) and article summarization (frontend) are used simultaneously:
```
GROQ_API_KEY=<same groq key>
VITE_GROQ_API_KEY=<same groq key>
```
They can hold the same value but serve different runtimes (Node/Edge vs browser).

---

## 6. Graceful Degradation

| Failure scenario | Behaviour |
|-----------------|-----------|
| Redis GET fails | Proceeds to Groq call, logs warning |
| Redis SET fails | Returns AI result anyway, logs warning |
| Groq API error / timeout | Returns `{ briefing: null, stabilityImpact: null }` |
| `/api/synthesis` returns 500 | `fetchISNRSynthesis` returns `null` |
| All failures | `updateBriefing(null)` → "IA indisponible" in widget |
| Network barometer still shows | Raw scores always display, AI section is additive only |

---

## 7. Out of Scope

- Ollama local fallback (synthesis endpoint uses Groq only; Ollama path exists in `summarization.ts` for article summaries)
- Per-department AI synthesis (national only)
- Storing synthesis history (single cached value, no time series)
