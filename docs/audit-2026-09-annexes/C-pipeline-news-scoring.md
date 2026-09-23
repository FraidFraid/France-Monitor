# Audit — News classification & scoring pipeline (France Monitor)

Read-only audit. All references are `file:line` against the working tree at the time of audit (branch `main`, includes uncommitted changes to `src/App.ts`, `src/types/index.ts`, `src/config/military.ts`).

---

## 1. Data contract

### `NewsItem` — the in-memory/client type (`src/types/index.ts:86-102`)
```ts
export interface NewsItem {
  id: string;                 // `rss-${hash(link)}` — 32-bit rolling hash, not cryptographic
  source: string;              // feed display name, e.g. "Le Monde"
  title: string;
  link: string;
  pubDate: Date;
  isAlert: boolean;            // always false at ingestion (rss.ts) — set true elsewhere (out of scope)
  tier?: number;                // feed reliability tier 1-4, from Feed config
  feedRegion?: string;          // e.g. "Bretagne" — geocoding fallback
  threat?: ThreatClassification;
  lat?: number;
  lon?: number;
  locationName?: string;
  summary?: string;             // raw RSS description, truncated to 200 chars
  aiSummary?: string;           // LLM/T5-generated 1-sentence summary
  aiSummaryStatus?: 'pending' | 'done' | 'failed';
}
```

### `ThreatClassification` — the classification/score payload (`src/types/index.ts:21-26`)
```ts
export interface ThreatClassification {
  level: ThreatLevel;          // severity
  category: EventCategory;
  confidence: number;          // 0.0–1.0
  source: 'keyword' | 'ml' | 'llm';
}
```
**Note:** `'llm'` is declared but never actually produced anywhere in the audited pipeline. The keyword classifier emits `'keyword'`; the browser zero-shot classifier emits `'ml'`; the server Groq pass writes only `category`/`severity`/`confidence` columns to Postgres and does **not** set any `source`/`classifier_version`-derived value that the client maps to `'llm'` — the client always reconstructs `source: 'keyword'` for any server-classified item regardless of whether keyword or Groq actually produced it (`src/services/rss.ts:330-340`, `buildServerClassification`). So today there is no way for the UI to tell a Groq-classified article apart from a keyword-classified one.

`EventCategory` (12 values, `src/types/index.ts:7-19`): `social, security, energy, weather, transport, infrastructure, health, general, finance, floods, fires, cyber`.

`ThreatLevel` (5 values, ordered, `src/types/index.ts:5`): `critical > high > medium > low > info`.

`Feed` config type (`src/types/index.ts:78-84`): `{ name, url, type?: 'general'|'economy'|'tech'|'sport'|'politics', region?, tier }`.

### Fields that do **not** exist on `NewsItem` (relevant to the requester's question)
- **No `entities` field.** `detectEntities()` (`src/services/classifier.ts:94-123`) computes institution/location matches transiently inside the keyword classifier to *decide* category/level, then discards them — nothing is persisted to `NewsItem` or to Postgres.
- **No `sourceQuality` field on the article.** There is a separate, unrelated subsystem — `src/services/qualityMeta.ts`, `qualityMappers.ts`, `sources-quality-dashboard.ts` (see `MEMORY.md` → `project_source_quality_scoring.md`) — that scores **feed/source** reliability (40% static "nature" baseline + 60% observed success/uptime/fallback rate, 14-day local history). It is not attached to individual articles and was not designed as an input to article scoring.
- **No `score` (numeric) field** anywhere on `NewsItem`/`news_items` — only categorical `severity` + a scalar `confidence`.
- **No geo precision/scope field** beyond `lat`/`lon`/`locationName` (client) or `lat`/`lon`/`geocode_source` (DB) — no "geographic scope" (local/regional/national) typed field exists today.

### Neon Postgres schema (`scripts/init-db.mjs:18-58`, idempotent `CREATE TABLE IF NOT EXISTS`)
```sql
feeds (
  id text PRIMARY KEY, url text, name text, region text, tier smallint,
  poll_interval_s int DEFAULT 300, next_poll_at timestamptz DEFAULT now(),
  consecutive_failures int DEFAULT 0, cooldown_until timestamptz,
  last_success_at timestamptz, enabled boolean DEFAULT true
)

news_items (
  id bigserial PRIMARY KEY,
  content_hash text UNIQUE NOT NULL,        -- sha256(feedId|link|title)
  feed_id text REFERENCES feeds(id),
  title text NOT NULL, link text NOT NULL, description text,
  published_at timestamptz, collected_at timestamptz DEFAULT now(),
  category text, severity text, confidence real, classifier_version text,
  lat double precision, lon double precision, geocode_source text
)
-- indexes: (collected_at desc), (category,severity,collected_at desc), (published_at desc)

situation_snapshots (   -- unrelated to per-article scoring; national-score history
  id bigserial PRIMARY KEY, taken_at timestamptz DEFAULT now(),
  kind text NOT NULL, payload jsonb NOT NULL
)
```
`classifier_version` is currently either `'kw-1'` (keyword pass) or `'groq-1'` (after the optional Groq re-pass overwrites it) — this is the only place a per-article "which engine produced this" marker survives, and it isn't surfaced to the client at all (`api/news.js`'s SELECT, `api/news.js:125-134`, does not select `classifier_version`).

---

## 2. Current scoring flow, step by step

There are **two independent classification pipelines** that both write into the same `NewsItem.threat` shape: a server cron (writes to Neon) and a client-side pipeline (runs in the browser on whatever `NewsItem[]` it has, whether server-provided or not).

### A. Server ingest cron — `api/ingest/news.ts`, Vercel Cron
Schedule: **`*/30 * * * *`** (`vercel.json:5`) — every 30 minutes. *(The file's own header comment at `api/ingest/news.ts:2` still says "toutes les 5 min" — stale; the schedule was changed to 30 min in commit `84a2c81`.)* `maxDuration: 300`s (`vercel.json:9`, also `api/ingest/news.ts:29`); internal soft deadline `TIME_BUDGET_MS = 240_000` (`api/ingest/news.ts:88`).

1. Auth: `Authorization: Bearer ${CRON_SECRET}` or 401 (`api/ingest/news.ts:336-341`).
2. 503 if `DATABASE_URL` unset (`api/ingest/news.ts:343-346`).
3. Upstash Redis lock `SET ingest_lock NX EX 280` (best-effort; continues without lock if Redis unavailable) (`api/ingest/news.ts:349-362`).
4. `syncFeeds()` upserts the `feeds` table from `api/_lib/feeds-snapshot.js` (generated from `src/config/feeds.ts` by `scripts/sync-feeds.mjs`, `npm run sync:feeds`) — **38 feeds** today (`grep '"id":' api/_lib/feeds-snapshot.js` → 38).
5. Select ≤ `MAX_FEEDS_PER_TICK = 40` due feeds (`api/ingest/news.ts:86,375-383`), concurrency 6 (`FEED_CONCURRENCY`, `api/ingest/news.ts:87,276-296`).
6. Per feed (`processFeed`, `api/ingest/news.ts:158-272`): `fetch` (10 s timeout, spoofed desktop-Chrome UA) → `parseRssXml` (`api/_lib/parse-rss.js`) → per item: `contentHash = sha256(feedId|link|title)` (`api/_lib/db.js:40-42`), intra-tick dedup via `Set`, then **`classify(title, description)`** = the server keyword classifier — `api/_lib/server-classifier.js`, an esbuild-bundled copy of `src/services/classifier.ts` (banner: *"GENERATED FILE — DO NOT EDIT"*, regenerated via `npm run generate:server-libs` / `scripts/generate-server-classifier.mjs`). Bulk `INSERT ... ON CONFLICT (content_hash) DO NOTHING` (`api/ingest/news.ts:243-259`) — this is the second, persistent dedup layer.
7. **Optional Groq LLM re-classification** (`api/ingest/news.ts:395-439`), gated on `process.env.GROQ_API_KEY`:
   - Candidates = rows just inserted this tick, `WHERE confidence < 0.60 AND classifier_version = 'kw-1'`, `ORDER BY confidence ASC`, `LIMIT GROQ_BUDGET_PER_TICK` (constant = **15**, `api/ingest/news.ts:31` — the file's own header comment at line 13 says "max 5/tick", a doc/code mismatch).
   - One HTTP call per candidate, **sequential** (not batched/parallelized) — `classifyWithGroq()` (`api/_lib/groq-classifier.js`), model `llama-3.3-70b-versatile`, 5 s timeout, `temperature: 0.1`, JSON-mode response `{"category":..,"severity":..}` validated against the fixed 12-category/5-severity enums (`api/_lib/groq-classifier.js:9-16,89-95`).
   - On success: `UPDATE ... SET category=…, severity=…, confidence=0.75 (fixed constant, not model-reported), classifier_version='groq-1'` (`api/ingest/news.ts:420-428`, `GROQ_CONFIDENCE = 0.75` at line 32).
   - On HTTP error (429/500/etc.) the classifier **throws** and the whole Groq pass `break`s for that tick (`api/_lib/groq-classifier.js:68-75`, `api/ingest/news.ts:431-434`). On timeout/network error it returns `null` and the loop just continues to the next candidate.
8. Best-effort geocoding of ≤ `MAX_GEOCODES_PER_TICK = 30` newly-inserted items (`api/ingest/news.ts:90,300-323`) via `geocodeNewsItem()` (`api/_lib/server-geocoder.js`, generated from `src/services/geocoder.ts` + `src/config/geo.ts`): known-city/region dict → `api-adresse.data.gouv.fr` (3 s timeout) → feed-region fallback at confidence 0.3.
9. Retention: `DELETE FROM news_items WHERE collected_at < now() - interval '90 days'` every tick (`api/ingest/news.ts:445`).
10. Lock release; tick summary JSON persisted to Redis key `ingest:last-tick` (24 h TTL) for `/api/health-check` (`api/ingest/news.ts:475-485`).

Read APIs consuming this table:
- `GET /api/news` (`api/news.js`) — used by the client (see below). `since`/`until`/`before`/`category`/`severity` (comma-list)/`region` filters, `limit` ≤ 1000 (default 500). Response cached `s-maxage=60, stale-while-revalidate=300`. **Does not return `classifier_version`.**
- `GET /api/news/history` (`api/news/history.js`) — `date_trunc(bucket, published_at)` GROUP BY `(bucket, category, severity)` → feeds `NewsHeatmap`. Cached `s-maxage=300`.

### B. Client pipeline — `src/App.ts` `fetchAndProcessRSS()` (`src/App.ts:4337-4378`)
1. `fetchAllFeeds(ALL_FEEDS)` (`src/services/rss.ts:551-589`):
   - **Primary path**: `fetchFromIngestApi()` → `GET /api/news?since=<now-24h>&limit=1000` (`src/services/rss.ts:374-393`) — i.e. it reads the *already server-classified* rows from Neon. Items whose `category`/`severity` are valid enum values get `threat` built directly with `source: 'keyword'` and `confidence` from the DB row (`buildServerClassification`, `src/services/rss.ts:330-340`); otherwise `threat` is left `undefined` and re-classified client-side in step 2.
   - **Fallback path** (ingest API down/empty/dev without the Vercel plugin/timeout): direct fetch of all 38 (default) / 41 (with `VITE_USE_LOCAL_RSS_PROXY=true`, adds 3 Cloudflare-gated feeds) configured feeds, concurrency 8 (`MAX_CONCURRENT_FEEDS`, `src/services/rss.ts:516-546`), each behind a per-feed circuit breaker (opens after 2 consecutive failures, exponential backoff 2→5→10 min, `src/services/rss.ts:64-96`), via `/api/rss` (server JSON-pre-parsed) then `/api/rss-proxy` (raw XML + `DOMParser`) as second fallback. Dedup by `link` (`Set`) in both paths.
2. `classifyByKeywords(title, summary)` synchronously for any item still missing `.threat` (`src/App.ts:4349-4355`) — same keyword logic as the server, browser copy (`src/services/classifier.ts`), source of truth for the generated server file.
3. **First paint**: `applyNewsItems()` sorts desc by `pubDate`, slices to `MAX_NEWS_ITEMS = 500` (`src/App.ts:177,4380-4383`), pushes to map/news panel/search modal, refreshes `FranceIntelPanel` — **before** AI classification, geocoding or summarization run. So the score/UI briefly reflects keyword-only classification.
4. Background, in parallel, on a shallow clone (`src/App.ts:4392-4398`):
   - **AI classification** (`runAIClassification`, `src/App.ts:4417-4434+`): only items where `!it.threat` (keyword classifier found **nothing at all** — items downgraded to `general/info` by the PQR/domestic-accident mitigations still count as "classified" and are **not** re-run here) — batches of `AI_CLASSIFY_BATCH_SIZE = 5` (`src/App.ts:184`) → `classifyWithAI()` (`src/services/ai-classifier.ts:74-88`), a zero-shot classifier in a Web Worker (`src/services/ai-worker.ts`) using `Xenova/mobilebert-uncased-mnli` (~100 MB, downloaded client-side), 9 French candidate labels (`src/services/ai-classifier.ts:41-51`). In-memory result cache keyed by `title|summary`, capped at 300 entries (`src/services/ai-classifier.ts:67-87`). If top label is `'général'`/`'politique'` or `topScore < 0.3` → treated as no threat. Confidence→level heuristic: `>0.8→high, >0.5→medium, else low` — **the ML path can never emit `'critical'`**, by design comment (`src/services/ai-classifier.ts:113-121`); only the keyword path can. PQR-noise mitigation (`isFaitDiversNoise`) is re-applied here too (`src/services/ai-classifier.ts:141-146`).
   - **Geocoding** (`runGeocoding`, not read in full — out of narrow scope but runs in parallel, doesn't block AI).
   - **Summarization** (`runSummarization` → `summarizeWithFallback()`, `src/services/summarization.ts:53-131`): Ollama local (only if `VITE_USE_OLLAMA=true`, **disabled by default in prod**, 5 s timeout) → `POST /api/intelligence/v1/summarize` (Groq server proxy, 10 s timeout) → browser T5 (`Xenova/t5-small`) Web Worker as ultimate fallback. In-flight de-dup by normalized text, 60 s safety-purge TTL.
5. Re-`applyNewsItems()` with the augmented set; `saveNewsToCache()` persists to `localStorage` (`fm_news_cache_v3`, 30 min max age, `src/utils/newsCache.ts`).

### Categories & severities as used in code
- Categories (12): `social, security, energy, weather, transport, infrastructure, health, general, finance, floods, fires, cyber` — dictionaries of French keywords per category × level in `src/services/classifier.ts:166-241` (`KEYWORDS`).
- Severities (5, ordered): `critical > high > medium > low > info`.
- Base confidence by keyword-list tier: high=0.8, medium=0.65, low=0.5 (`src/services/classifier.ts:355,368,381`); +0.1 if ≥3 keywords match, capped at 0.95 (`:394`).
- `CRITICAL_KEYWORDS` (11 unambiguous single terms) and `CRITICAL_COMPOUND_PHRASES` (18 multi-word phrases) short-circuit straight to `level: 'critical'`, confidence 0.85–0.92, **before** the generic per-category scoring loop (`src/services/classifier.ts:249-321`).
- **PQR noise mitigation** (documented in `MEMORY.md` → *"Classifier: Mitigation Bruit PQR"*, confirmed at `src/services/classifier.ts:82-162,403-418`): `detectEntities()` matches two fixed French keyword lists — `INSTITUTIONS` (~60 terms) and `LOCATION_TYPES` (~35 terms) — via word-boundary regex on accent-stripped, lower-cased text. `isFaitDiversNoise()` = true iff a `FAITS_DIVERS_KEYWORDS` term (19 terms: vol, cambriolage, rixe, agression…) matches **and** no institution term is present (a bare location does not save it). Effect: `security/low` + noise → forced to `{level:'info', category:'general', confidence:0.2}`; `security/medium` + noise → downgraded (not suppressed) to `{level:'low', category:'security', confidence:0.3}`.
- Domestic-accident de-escalation (`isDomesticAccident`, `src/services/classifier.ts:268-277`): barbecue/chaudière/etc. context forces `security`/`infrastructure` hits to `info/general/0.2`.
- **Two independently-maintained copies of the keyword classifier exist** — `src/services/classifier.ts` (source of truth) and the generated `api/_lib/server-classifier.js`. Nothing in CI enforces regeneration; it relies on developer discipline (`npm run generate:server-libs`) and an explicit do-not-edit banner. Same pattern for feeds: `src/config/feeds.ts` → generated `api/_lib/feeds-snapshot.js` via `npm run sync:feeds`.

---

## 3. Consumers of the scores

| Consumer | File:line | Fields read | How |
|---|---|---|---|
| Map markers (desktop) | `src/components/DeckGLMap.ts:12619-12666` | `threat.level`, `threat.category`, `isAlert` | Splits into a never-clustered GeoJSON source for `level==='critical'` vs. a clusterable source for everything else; `level`+`category` carried as feature properties for icon/color. Cheap-diff hash at `:12624-12627` includes `id:level:category:isAlert:lon,lat`. |
| Map pulse/alert layer | `src/components/DeckGLMap.ts:8242,8279` | `threat.level` | Filters `critical`/`high` for a highlighted layer (default `'high'` if missing). |
| Map (mobile fallback) | `src/components/Map.ts:170-193` | `threat.level` | D3/SVG dot color via `LEVEL_COLORS`; separate `critical`/`high` highlight list. |
| Map popup | `src/components/MapPopup.ts:171-196,239,251` | `level`, `category`, `confidence`, `source` | Renders level class, category label, confidence %, and a bot icon iff `source==='ml'`. |
| `SituationMonitor` (full incident panel) | `src/components/SituationMonitor.ts:211-212,416-419,444-447` | `DetectedSituation.severity`, `.confidence` | Not `NewsItem` directly — consumes situations (10-rule engine output **plus** synthetic `NEWS_ALERT` situations, see below). Confidence rendered as rounded %. |
| `SituationBrief` ("Convergences 24h" banner) | `src/services/situation-brief.ts:128-160`, `src/components/SituationBrief.ts:255` | `severity` only (+ precomputed `severityLabel`) | Pure `selectBriefItems()`: active situations sorted severity DESC then oldest-active-first, filled with resolved-in-last-24h sorted most-recent-first; hard cap `BRIEF_MAX_ITEMS = 3`. |
| National stability score (`FranceCountrySignals`/pillars) | `src/services/france-country-intel.ts:442-456` (`buildFranceSignals`), `:223-237` (`headlinePressure`/`signalPressure`), `:239-290` (pillars), `:324-355` (`scoreFromPillars`) | `threat.level` **only** (category/confidence not read here) | `criticalNews`/`highNews` = raw counts of `level==='critical'`/`'high'` across **all** `newsItems` (no time window applied at this step — filtering happens upstream at fetch, "last 24h" from the ingest API). Feeds `headlinePressure()` into the `security` pillar (weight 25%) and `shock`; feeds `signalPressure()` into the `signal` pillar (weight 40%). Final score = baseline 95 − Σ(pillar weight × `pillarResponse(pillar value)`) − shock-extra, EMA-smoothed, then capped by `situationCap` (55 if any `critical` situation, 65 if ≥2 `high`, 78 if 1 `high`). **Calibration is locked by fixtures in `france-country-intel.test.ts`** — comment explicitly forbids adjusting test targets to fit a formula change (matches `CLAUDE.md` and `MEMORY.md → project_score_v3_engine.md`). |
| `FranceCountrySnapshot.topNews` | `src/services/france-country-intel.ts:357-382` (`selectDiverseNews`), used at `:709` | `.source` only | Cap 2 items per feed `source`, in whatever order `newsItems` already has (severity/recency ordering happens upstream in `App.ts`) — exposed for `FranceIntelPanel`'s headline list. |
| `FranceIntelPanel` situations card | `src/components/FranceIntelPanel.ts:392-413` | `DetectedSituation.severity`, `.confidence` | Color + `"SEVERITY · CONF 0.xx"` label. |
| `FranceIntelPanel` brief judgments | `src/components/FranceIntelPanel.ts:698,711` | `StructuredBrief.judgments[].confidence` (`BriefConfidence`: `'high'\|'moderate'\|'low'`, categorical, **not** the same field as `ThreatClassification.confidence`) | Confidence pill per judgment line. |
| `UnderMapNewsFeed` (full list/filter panel) | `src/components/UnderMapNewsFeed.ts:134-145` (`compareNewsPriority`, confirmed call sites `:347,439`), `:421-427` (filtering), `:466-469` (re-render diff key), `:489-490` (header counts), `:530-575` (render) | `isAlert`, `threat.level`, `threat.category`, `threat.confidence`, `threat.source`, `locationName`, `pubDate` | **Sort** = `isAlert` DESC → `level` DESC (via `LEVEL_PRIORITY`) → has-`locationName` DESC → `pubDate` DESC. **Filter** = user-selected category/level sets against `threat.category`/`threat.level` (default `'general'`/`'info'`). Confidence shown as rounded %; source badge text differs for `'llm'`/`'ml'`/`'keyword'`. |
| `NewsHeatmap` | `src/components/NewsHeatmap.ts` (whole file) | `HistoryBucket.category`, `.date`, `.count` — **not `NewsItem` directly**, consumes pre-aggregated `/api/news/history` rows | Day × category grid, cell opacity = count normalized to dataset max. **Severity is not read anywhere in this component** — confirmed by full-file read, it only groups by category+date. |
| Alert toasts | `src/components/ToastNotification.ts:92,121,353` | `threat.level` | Gates which incoming items trigger a toast popup and picks icon/color (default `'high'` if missing at `:353`). |
| Search modal | `src/components/SearchModal.ts:188` | `threat.level` | Critical-dot icon vs. generic newspaper icon. |
| ISNR department dimensions (parallel scoring path) | `src/services/stability-index.ts:32-38` (`THREAT_WEIGHTS`), `:312-325` (`computeDimensionScore`) | `threat.level`, `threat.category` | **Separate weighting from the national score above**: `critical=100, high=50, medium=25, low=10, info=0`, summed per department (news geolocated to depts) after filtering by category-list per ISNR dimension, normalized against a fixed ceiling of 1200 (≈12 critical-equivalent events). Feeds `isnr.scores[].dimensions.social/security` which in turn feeds `detectSocialEscalation()` (`src/services/situation-engine.ts:362-403`) → a `SOCIAL_ESCALATION` `DetectedSituation`. |
| `NEWS_ALERT` synthetic situations | `src/App.ts:6382-6413` (`buildAlertMonitorSituations`) | `threat.level`, `threat.confidence`, `threat.category`, `locationName`/`feedRegion`/`source`, `pubDate` | The **only** place `SituationType.NEWS_ALERT` (declared in `src/types/index.ts:2421`) is actually produced — `situation-engine.ts`'s 10 rules never emit it. Filters `newsItems` to `level ∈ {critical, high}`, maps to `SituationSeverity` via `threatLevelToSituationSeverity()`, passes `threat.confidence` straight through (default 0.8 if missing) as `DetectedSituation.confidence`, caps at `ALERT_MONITOR_LIMIT = 2` (`src/App.ts:196`), sorted by `pubDate` desc. These synthetic situations are merged with the 10-rule-engine output and flow into `SituationMonitor`/`SituationBrief` identically. |
| LLM synthesis / narrative brief (Groq, server) | `src/services/isnr-synthesis.ts:60-94` → `api/intelligence/v1/synthesis.js` (whole file) | `threat.category`, `threat.level`, `.title`, `.source` (as formatted strings) | Headlines list is pre-selected in `src/App.ts:6660-6680` (`refreshNetworkBarometerWidget`): up to 10 items with `level ∈ {medium,high,critical}` sorted by recency, backfilled with `level==='low'` items if fewer than 3 qualify. Formatted as `"[category/level] title (source)"` strings (`src/services/isnr-synthesis.ts:74-80`) and POSTed to a Groq-backed Vercel **Edge** function (`llama-3.3-70b-versatile`) that returns a narrative `briefing` string + a numeric `stabilityImpact`; Redis-cached 15 min (`api/intelligence/v1/synthesis.js:9-10`). This is a **second, independent LLM call**, distinct from the ingest-cron Groq classification pass — it synthesizes across a batch of already-classified headlines rather than classifying individual articles. It is the closest existing precedent in the codebase for "send a text + structured context to an LLM, get structured output back." |
| CSV/data export | `src/services/data-export.ts:230-231` | `threat.level` (as `gravite`), `threat.category` (as `categorie`) | At minimum these two columns are exported verbatim; did not verify whether `confidence`/`source` are also exported. |

---

## 4. Volumes & timing

- **Feeds configured**: 38 active by default (`api/_lib/feeds-snapshot.js`, generated from `src/config/feeds.ts`); 41 total definitions, +3 gated behind `VITE_USE_LOCAL_RSS_PROXY=true` (Cloudflare-protected: Les Échos, La Voix du Nord, Paris Normandie — `src/config/feeds.ts:43-47`).
  - By tier: Tier 1 (national agencies) = 4; Tier 2 (national + economy + tech) = 15; Tier 3 (PQR regional + DOM-TOM) = 15; Tier 4 (secondary regional/opinion) = 4.
  - By declared `type`: `general` = 33 (includes all PQR/national/DOM-TOM), `economy` = 2, `tech` = 4. There is no `type: 'institutional'` in the feed config — **no government/préfecture RSS feeds exist in the source list**; "institutional" signal only comes from the classifier's `INSTITUTIONS` keyword list matched against article text (préfecture, police, EDF, SNCF…), not from feed provenance.
- **Ingest cron cadence**: every 30 min (`vercel.json:5`), ≤ 40 feeds per tick (`MAX_FEEDS_PER_TICK`), concurrency 6, 300 s function timeout / 240 s internal budget.
- **Groq LLM re-classification budget**: ≤ 15 articles per tick (`GROQ_BUDGET_PER_TICK`), only those with `confidence < 0.60`, sequential HTTP calls, 5 s timeout each → worst case ~75 s of the 240 s budget if all 15 succeed slowly, and the pass aborts early on any HTTP error.
- **Geocoding budget**: ≤ 30 newly-inserted items per tick.
- **Client fetch window**: `GET /api/news?since=<now-24h>&limit=1000` (`src/services/rss.ts:376-377`) — the client only ever sees a rolling 24 h window, up to 1000 rows (API hard cap `MAX_LIMIT`).
- **Client retained/displayed**: sorted by `pubDate` desc, sliced to `MAX_NEWS_ITEMS = 500` (`src/App.ts:177`) in memory; `FranceCountrySnapshot.topNews` further narrows to 20 (`selectDiverseNews(raw.newsItems, 20, 2)`, max 2 per source); the ISNR/Groq-synthesis headline selection further narrows to ≤10 (`src/App.ts:6660-6680`).
- **Dedup keys**: three layers — (a) intra-tick `Set<contentHash>` where `contentHash = sha256(feedId|link|title)` (`api/_lib/db.js:40-42`); (b) Postgres `UNIQUE(content_hash)` with `ON CONFLICT DO NOTHING` (persistent, cross-tick); (c) client-side dedup by `link` alone (`Set<string>`, both in the ingest-API path and the direct-feed fallback path, `src/services/rss.ts:559-563,576-581`) — note this is a *different* key than the server's hash (title is not part of the client dedup key).
- **Re-classification caching**: Postgres rows are classified **once** at insert time and only re-touched by the optional Groq pass (which also flips `classifier_version` so it won't be picked up again, since the Groq candidate query filters `classifier_version = CLASSIFIER_VERSION` i.e. `'kw-1'`). On the client, the in-memory AI-classifier cache is keyed by `` `${title}|${summary}`.slice(0,200) `` (`src/services/ai-classifier.ts:75`), capped at 300 entries — this is a session-lifetime cache, not persisted; a page reload starts cold (though `localStorage` `newsCache.ts` restores the *previously computed* `threat` field for up to 30 min, so a same-session reload doesn't force re-classification of items still in that cache). Items with a server-provided valid `category`/`severity` never get client-reclassified at all (`buildServerClassification` short-circuits `App.ts:4349-4355`'s `if (!item.threat)` check).
- **Retention**: Postgres `news_items` purged after 90 days, every tick.

---

## 5. Known weaknesses (from comments, tests, docs, memory)

- **PQR false positives / noise** — the documented reason the entity-gating mitigation exists at all (`MEMORY.md → "Classifier: Mitigation Bruit PQR"`, `src/services/classifier.ts:1-7`). It is a **binary institution-presence gate** on a fixed ~60-term keyword list; anything phrased without one of those exact terms (e.g. a named but unlisted local business, an unlisted smaller agency, an institution referred to indirectly) still reads as noise regardless of actual strategic relevance. This is exactly the kind of judgment a calibrated external classifier could replace with a probability instead of a hard keyword gate.
- **Confidence is not a calibrated probability.** Every confidence value in the keyword path is one of a small fixed set (0.2, 0.3, 0.5, 0.65, 0.72, 0.8, 0.85, 0.88, 0.9, 0.92, 0.95, capped) determined purely by which keyword tier matched — it is a rule-engine tag, not a statistically meaningful probability. The Groq server confidence is a **hardcoded constant 0.75** regardless of what the model actually returned (`GROQ_CONFIDENCE`, `api/ingest/news.ts:32`) — the LLM's own certainty is discarded entirely, only its category/severity choice is kept.
- **The ML (Transformers.js) path structurally cannot emit `'critical'`** (`src/services/ai-classifier.ts:119-121`, explicit design comment: "L'IA manque de contexte factuel pour garantir cette sévérité") — only the keyword path can produce the top severity. Any true "critical" event whose title doesn't hit one of the ~30 hardcoded critical keywords/phrases will never surface as critical unless/until an institution-gated medium/high keyword also matches.
- **`source: 'llm'` is dead code** — declared in the type (`ThreatClassification.source`) but never actually set by anything reachable from the client, since server-classified rows (keyword or Groq) both surface as `'keyword'` client-side (see §1). The UI's `'llm'`-branch styling (`UnderMapNewsFeed.ts` source badge, `MapPopup.ts:196`'s `'ml'` bot-icon check) is effectively partly unreachable/mislabeled for Groq-classified articles.
- **Two doc/code drifts found during this audit** (worth fixing regardless of the scoring-API project): (1) `api/ingest/news.ts:2`'s header comment says the cron runs "toutes les 5 min" — it's actually every 30 min per `vercel.json`. (2) `api/ingest/news.ts:13`'s header comment says the Groq pass handles "max 5/tick" — the actual constant `GROQ_BUDGET_PER_TICK` is 15 (`api/ingest/news.ts:31`).
- **Generated-file drift risk**: `api/_lib/server-classifier.js` and `api/_lib/feeds-snapshot.js` are manually-regenerated snapshots of `src/services/classifier.ts` / `src/config/feeds.ts`. No test or CI check was found in the audited files that fails the build if they've drifted out of sync with their source — a classifier change could ship client-side without ever reaching the server ingest path (or vice versa) if a developer forgets `npm run generate:server-libs` / `npm run sync:feeds`.
- **Two parallel, independently-weighted scoring paths read the exact same `threat.level`/`threat.category`** and can diverge: the national score's `criticalNews`/`highNews` counters (`france-country-intel.ts`, flat count, no category filter) vs. `stability-index.ts`'s `THREAT_WEIGHTS`-based per-department ISNR dimension score (weighted 100/50/25/10/0, category-filtered, geolocation-dependent). Both ultimately influence the same final national score (the latter indirectly via `detectSocialEscalation` → a `DetectedSituation` → the `situationCap`), but neither is aware of the other's normalization.
- **Score calibration is fixture-locked** (`src/services/france-country-intel.test.ts`, comment: *"Fixtures-contrat du §4.4 de la spec — toute retouche des constantes doit les faire passer"*) and duplicated across 4 files per `CLAUDE.md` (severity band thresholds in `FranceIntelPanel.ts`, `france-intel-brief.ts`, `api/intelligence/v1/france-intel-brief.js`, `src/plugins/france-intel-proxy.ts`) — any new scoring input that feeds the national score must be threaded through this locked formula carefully, not just added as a new pillar term.
- **Sequential, budget-capped Groq calls** mean under heavy news volume most low-confidence articles never get an LLM look — only the 15 lowest-confidence per 30-minute tick are attempted, and a single rate-limit response aborts the rest of that tick's pass.
- **Privacy constraint** (explicit in `FranceMonitor/CLAUDE.md` §1/§4 and `.env.example`): "aucun PII ne doit partir vers le cloud" / local-AI-first (Ollama → Groq → browser model fallback chain) and `.env.example`'s explicit warning to never expose `VITE_GROQ_API_KEY` client-side, "clé jamais exposée côté client" (`src/services/summarization.ts:107`). News article text (title/description, public press content) is already sent to Groq today in two places (ingest-cron classification, isnr-synthesis briefing) — so sending the same public article text to a third external API is consistent with existing practice, but any future PII-bearing field (e.g. named individuals extracted as entities) would need to stay server-side/local per this rule.

---

## 6. Insertion points

### (a) Server-side, in the ingest cron, before writing to Neon
- **`api/ingest/news.ts:210-229`** (inside `processFeed`'s per-item loop) — this is where `category`/`severity`/`confidence`/`version` are currently computed via the local `classify()` call and pushed into the bulk-insert arrays (`hashes`, `feedIds`, …, `categories`, `severities`, `confidences`, `versions`, `api/ingest/news.ts:231-240`). An external scorer call would slot in here, or as an additional pass mirroring the existing **optional Groq re-classification block** (`api/ingest/news.ts:395-439`) — that block is already the template for "call an external classifier on a budget-capped subset of just-inserted rows and `UPDATE` the row." Constraints already encoded there to respect: `maxDuration: 300` (`vercel.json:9`, `api/ingest/news.ts:29`) and the `240_000 ms` internal `deadline` (`api/ingest/news.ts:88,369`) that every loop in the handler checks (`Date.now() >= deadline`); a per-tick budget constant analogous to `GROQ_BUDGET_PER_TICK`; sequential-call pattern (no `Promise.all` fan-out to the LLM today — would need to be added deliberately if the new API supports concurrency); the existing "abort the pass on HTTP error, continue on timeout" error-handling convention (`api/_lib/groq-classifier.js:62-75`).
- **New Postgres columns would be needed** on `news_items` (schema owned by `scripts/init-db.mjs:32-48`, additive migration is safe since ingestion is idempotent/`IF NOT EXISTS`-based) to store typed judgments beyond the current flat `category text, severity text, confidence real` — e.g. per-category probability distribution (`jsonb`), a separate strategic-relevance probability (`real`), a geographic-scope classification (`text`/enum), or a raw judgment payload (`jsonb`) for forward-compatibility. None of these exist today; `api/news.js:125-134`'s SELECT would also need updating to expose new columns to the client, and `IngestApiItem`/`mapIngestItem` (`src/services/rss.ts:287-367`) would need matching fields to carry them into `NewsItem`.

### (b) Client-side, in the classification path
- **`src/App.ts:4417-4434`** (`runAIClassification`) is the existing seam for "call an async classifier on items lacking `.threat`" — an external API call could replace or supplement `classifyWithAI()` here, reusing the existing batching (`AI_CLASSIFY_BATCH_SIZE = 5`, `src/App.ts:184`) and the `requestId`-based staleness guard (abort if a newer RSS fetch superseded this one, `src/App.ts:4424`).
- **`src/services/classifier.ts:283-426`** (`classifyByKeywords`) and its 1:1 mirror **`api/_lib/server-classifier.js`** are the synchronous fallback/primary path; an external typed-judgment API is inherently async and network-bound, so it does not fit here directly, but its *output shape* (`ThreatClassification`) is what any new path must ultimately produce to be consumed by the ~15 downstream consumers listed in §3 without touching every one of them.
- **`src/services/ai-classifier.ts:66-88`** already has the caching pattern (in-memory `Map`, key = `title|summary`, capped size, LRU-ish eviction) that a new client-side external-API path should reuse to avoid re-billing the same article across re-renders.

### (c) New fields / DB columns needed to store typed judgments
Minimum to preserve today's consumers unchanged: keep `ThreatClassification.level`/`category`/`confidence` populated (every consumer in §3 reads at least one of these) — an external scorer's output must be reducible to this shape even if it also stores richer data. To store the richer typed-judgment output itself (category probabilities, an ordered-level score, yes/no probabilities e.g. "is this strategically relevant"), nothing analogous exists on `NewsItem`/`ThreatClassification`/`news_items` today — every extra signal currently gets collapsed immediately into the single `level`+`category`+`confidence` triple. Candidates, none currently present:
  - `NewsItem`/`ThreatClassification`: an optional richer payload field, e.g. `judgment?: { categoryProbs?: Record<EventCategory, number>; severityProb?: Record<ThreatLevel, number>; strategicRelevance?: number; geoScope?: 'local'|'regional'|'national' }` (`src/types/index.ts`, next to `ThreatClassification` at line 21-26).
  - `news_items` table: additive columns, e.g. `judgment jsonb`, `strategic_relevance real`, `geo_scope text` (`scripts/init-db.mjs`).
  - `classifier_version` (`news_items.classifier_version`, currently `'kw-1'`/`'groq-1'`) is the natural place to add a new version tag (e.g. `'typed-judgment-1'`) so the existing "only re-classify low-confidence rows not yet touched by X" pattern (`api/ingest/news.ts:401-407`, filters on `classifier_version = CLASSIFIER_VERSION`) can be reused for the new API without colliding with the Groq pass.
- **Feature-flag precedent to follow**: three existing AI/data modules are gated behind `VITE_ENABLE_*` env flags (`VITE_ENABLE_GAS_PANEL`, `VITE_ENABLE_CYBER_PANEL`, `VITE_ENABLE_OIL_LAYER` — `src/services/gas.ts:383`, `src/services/cyber.ts:461`, `src/services/oil.ts:143`) and Ollama is gated behind `VITE_USE_OLLAMA` (`src/services/summarization.ts:51`). A new external scorer would fit the same convention, e.g. server-side `<PROVIDER>_API_KEY` (never `VITE_`-prefixed, per the explicit `.env.example` warning) plus an opt-in flag.
- **No existing feature flag currently gates the Groq classification pass or the ML web-worker pass** — both are unconditionally "on" if `GROQ_API_KEY` is set / always attempted respectively; only Ollama has an explicit on/off flag.
