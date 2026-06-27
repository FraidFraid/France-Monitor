# Sources & qualité - Design

Date: 2026-06-27
Status: approved for implementation planning

## Goal

Add a separate product page at `/sources-quality` named **Sources & qualité**.

The page makes France Monitor's existing source, freshness, status, confidence, criticality and score indicators visible in a didactic way without changing or overloading the main map experience.

The page is not a portfolio, CV, or recruiter page. It is a useful OSINT/dashboard page for users, and secondarily demonstrates technical quality through source governance and traceability.

## Constraints

- Keep the main map as the primary experience.
- Preserve the existing app UI/UX and visual language.
- Use Vanilla TypeScript and Vite only.
- Do not introduce React, Vue, Angular, or a heavy dependency.
- Do not rewrite existing scoring or business models.
- Prefer lightweight adapters that read existing indicators.
- Do not invent unavailable values. Show `N/D`, `Non renseigné`, `Inconnu`, or `Non disponible`.
- No visible production mock data.
- Keep code typed, scoped, and compatible with `npm run build` and `npm run typecheck`.

## Existing Context

France Monitor already has several source-quality building blocks:

- `StatusPanel` displays source status in the app header.
- `Watchdog` centralizes source observability snapshots with status, cache age, failures, fallbacks and response time.
- `DataSourceStatus` already models status, freshness, cache age, fetch count, failure count and fallback count.
- `App.ts` keeps many current domain states in memory: news, weather, floods, Ecowatt, Hub'Eau hydrometry, cyber, outages, network, health, maritime, aviation, finance and others.
- Hub'Eau hydrometry already exposes `source`, `sourceStatus`, `fetchedAt`, `lastUpdated`, `maxObservationAgeMinutes`, freshness, confidence and measured support fields.
- `network-barometer.ts` already computes a global infrastructure score and source sub-scores.
- Several map popups already display source, freshness, confidence, criticality or score fields where available.

The new page should harmonize these existing indicators rather than replace them.

## Chosen Approach

Use a true dedicated route mounted from `main.ts`.

`main.ts` will detect `/sources-quality` and render a new `SourcesQualityPage`, separate from `App`. This keeps the page lightweight and avoids adding another mode to the already large app orchestrator.

The page will use a declarative source registry plus lightweight adapters. It can enrich its display from `Watchdog.getSnapshot()` when the page session has source statuses available, but it must still render cleanly when opened directly and no live snapshot has been produced yet.

This approach favors clarity and safety over full live parity with the map page. Values that require the full app runtime or active map polling can remain `N/D` until a safe adapter exists.

## Routing And Navigation

### Route

- `/sources-quality` renders the dedicated page.
- The existing landing behavior remains unchanged for `/`.
- `/?view=app#live` continues to open the map app.

### Navigation

Add visible **Sources & qualité** links in:

- landing page navigation or action area;
- app header, near source/status controls;
- app bottom links;
- about modal info links, if it fits the existing link group without crowding.

The dedicated page includes a clear **Retour carte** action linking to `/?view=app#live`.

Navigation must work on desktop and mobile without hiding the return path to the map.

## Data Model

Create a flexible common model in `src/services/qualityMeta.ts`.

```ts
export type QualityMeta = {
  sourceName?: string;
  sourceType?: "official" | "media" | "open_data" | "technical" | "internal" | "unknown";
  sourceUrl?: string;
  freshnessScore?: number;
  freshnessLabel?: "fresh" | "acceptable" | "stale" | "unknown";
  collectedAt?: string;
  publishedAt?: string;
  observedAt?: string;
  ageMinutes?: number;
  reliabilityScore?: number;
  confidenceScore?: number;
  confidenceLabel?: "high" | "medium" | "low" | "unknown";
  severity?: "low" | "medium" | "high" | "critical" | "unknown";
  domainScore?: number;
  status?: "active" | "cached" | "degraded" | "error" | "unknown";
  statusMessage?: string;
  explanation?: string;
  limits?: string[];
  reasons?: string[];
};
```

Additional page-specific types:

- `QualitySummaryMetric`
- `QualitySourceRow`
- `ModuleQualityRow`
- `SignalToReview`
- `SourcesQualityDashboardData`

These types should stay display-oriented. Existing domain models remain the source of truth.

## Data Flow

1. `SourcesQualityPage` mounts.
2. It calls `getSourcesQualityDashboardData()`.
3. The aggregator reads a declarative registry of known project sources.
4. It merges available `Watchdog.getSnapshot()` source statuses.
5. It applies lightweight mappers where safe and available.
6. It computes summary cards and lists sources/signals to review.
7. It renders the page with graceful unavailable states.

No mapper should make network calls unless explicitly designed as a small, safe page refresh. The initial implementation should avoid broad refetching and prefer registry plus current observability snapshots.

## Source Registry

Create a small declarative registry in the quality service layer.

Each entry can contain:

- source id;
- display name;
- domain;
- source type;
- optional URL;
- expected cadence or freshness expectation;
- known limits;
- known mapped indicators;
- related `Watchdog` label or source id.

Include only sources that really exist in the project, such as:

- Flux RSS actualités;
- Météo-France;
- Vigicrues;
- Hub'Eau hydrométrie;
- RTE / Ecowatt;
- Nucléaire RTE / RTE IIP;
- SNCF;
- Cyber;
- Finance;
- NASA FIRMS;
- Vols militaires;
- AIS maritime;
- Trafic aérien;
- Télécoms / ARCEP;
- IODA Internet;
- SPF / DREES;
- Éolien France;
- Gaz;
- Pétrole.

If a listed source cannot be confirmed in code during implementation, omit it from the shipped registry.

## Page Structure

### 1. Header

Title: `Sources & qualité`

Subtitle:

`Cette page rend visibles les indicateurs utilisés par France Monitor pour évaluer l’origine, la fraîcheur, la disponibilité et le niveau de confiance des signaux publics.`

Prudence text:

`France Monitor ne remplace pas les sources officielles ni l’analyse humaine. Il agrège, qualifie et rend vérifiables des signaux publics.`

### 2. Summary Cards

Cards:

- Sources suivies
- Sources actives
- Sources en erreur ou dégradées
- Fraîcheur moyenne
- Signaux qualifiés
- Signaux à vérifier
- Dernière mise à jour

Use `N/D` when global values cannot be computed.

### 3. Sources suivies

Table columns:

- Source
- Domaine
- Type
- Statut
- Fraîcheur
- Confiance / fiabilité
- Dernière collecte
- Limites connues

The table should be horizontally scrollable on tablet if needed. On narrow mobile it may remain scrollable or use compact card rows, whichever fits the existing CSS style best.

### 4. Briques déjà qualifiées par module

Show a table or dense grid with:

- Module
- Indicateurs déjà disponibles
- Données mappées
- Statut d'harmonisation
- Commentaire

Expected rows where supported by existing code:

- Hub'Eau: source, freshness, observation age, confidence, measured support.
- Météo: source, vigilance, date, criticality.
- Réseau: sub-scores, global score, status.
- Transport: source, status, cache, date.
- Cyber: source, category, criticality, global score.
- Actualités: source, date, classification.
- Énergie: source, freshness, status.

The status should clearly distinguish:

- `mappé`;
- `partiel`;
- `à harmoniser`.

### 5. Signaux à vérifier

Display real items only when they can be derived from available data:

- low or medium confidence;
- unknown source;
- stale freshness;
- degraded/error source status;
- uncertain location;
- high criticality requiring human review.

Columns:

- Signal
- Domaine
- Source
- Score / confiance
- Raison
- Action recommandée

If none are available, show:

`Aucun signal à vérifier actuellement.`

Do not create production mock signals.

### 6. Comment lire les scores

Short explanation panel:

- Fraîcheur: age or recency of the signal.
- Fiabilité source: confidence in the origin.
- Confiance signal: combines quality, freshness, location, classification or domain score when available.
- Criticité: operational or domain importance.
- Statut: active, cached, degraded or error.

Scale:

- 70-100: exploitable
- 40-69: à vérifier
- 0-39: faible confiance
- N/D: donnée non disponible

### 7. Limites

State clearly:

- France Monitor ne remplace pas les sources officielles.
- France Monitor ne remplace pas les services d'urgence.
- France Monitor ne remplace pas les journalistes.
- France Monitor ne remplace pas les analystes humains.
- Les scores orientent la lecture; ils ne produisent pas une vérité automatique.

## Components

Use Vanilla TypeScript classes/functions:

- `src/SourcesQualityPage.ts`
- `src/services/qualityMeta.ts`
- `src/services/qualityMappers.ts`
- `src/services/sources-quality-dashboard.ts`

Optional internal render helpers can stay inside `SourcesQualityPage.ts` at first. Split into separate component files only if the page becomes hard to read.

Avoid adding many tiny files prematurely. The page is static/didactic enough that one page module plus service mappers should be sufficient for the first iteration.

## Visual Design

Use the existing dark dashboard style:

- CSS variables from `main.css`;
- existing header proportions;
- compact cards with 8px radius or less;
- restrained badges with text labels;
- dense but readable tables;
- no hero marketing layout;
- no portfolio language;
- no large decorative gradients or unrelated visuals.

The page should feel like an operational dashboard documentation surface, not a landing page.

Responsive behavior:

- Desktop: summary grid and full tables.
- Tablet: scrollable tables where needed.
- Mobile: cards stacked, tables scroll cleanly, no text overflow.

Accessibility:

- semantic headings;
- visible link labels;
- badges include text, not color alone;
- sufficient contrast using existing theme variables;
- no information conveyed only by color.

## Error Handling

- If registry data exists but live status is unavailable, render `unknown` / `N/D`.
- If `Watchdog` has no snapshot for a source, keep the registry row and show status as `Inconnu`.
- If mapper input is missing, do not throw; return a partial row with a limit/reason.
- Avoid console noise.

## Testing And Verification

Implementation must verify:

- `/sources-quality` opens directly.
- `/?view=app#live` still opens the map.
- Landing page still renders at `/`.
- Header/menu links navigate correctly.
- Mobile width has no obvious overflow or overlapping text.
- `npm run typecheck` passes.
- `npm run build` passes.

If a dev server is used for visual QA, test both desktop and mobile viewport sizes.

## Acceptance Criteria

- Opening `/sources-quality` shows a true separate page.
- The page uses the existing France Monitor visual style.
- The page is accessible from the main app and from non-app pages.
- The page explains source origin, freshness, confidence, status and limits.
- The source table includes only real project sources.
- Missing values are represented honestly.
- No production mock signals are shown.
- The main map UI remains unchanged and readable.
- TypeScript and build checks pass.

## Out Of Scope

- New scoring algorithm across every domain.
- Database-backed source registry.
- Full live parity with the map app.
- RAG assistant.
- Human validation workflow persistence.
- Refactoring `App.ts` beyond navigation links needed for this route.
