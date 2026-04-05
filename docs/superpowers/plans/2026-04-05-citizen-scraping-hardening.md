# Citizen Scraping Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 3 fragility points in the citizen outage scraping stack so `coupure-elec.fr` actually works in prod, the dev proxy fails loudly on unexpected HTML, and the clustering divergence is documented.

**Architecture:** Three independent, targeted changes — no refactoring. (1) Add Cheerio to `dependencies` so the dynamic import succeeds in Vercel. (2) Copy the IS_WORDPRESS structure guard from prod into the Vite dev proxy. (3) Add an explanatory comment in `buildDevZones`.

**Tech Stack:** Node.js, Vercel serverless (CommonJS), Vite plugin (TypeScript ESM), `cheerio`, `@turf/turf` (already installed), `npm`

**Spec:** `docs/superpowers/specs/2026-04-05-citizen-scraping-hardening-design.md`

---

## File Map

| File | Role | Change |
|---|---|---|
| `package.json` | Project dependencies | Add `cheerio` to `dependencies` |
| `package-lock.json` | Lockfile | Auto-updated by `npm install` — must be committed |
| `api/outages/citizen.js` | Vercel serverless handler | Remove manual-install comment (lines 22–24) |
| `src/plugins/citizen-outages-proxy.ts` | Vite dev proxy | Add IS_WORDPRESS guard in `parseDeptArticles`; add comment in `buildDevZones` |

---

## Task 1: Install Cheerio as a proper dependency

**Files:**
- Modify: `package.json` (dependencies section)
- Modify: `package-lock.json` (auto)
- Modify: `api/outages/citizen.js` lines 22–24

### Verification baseline (run before any change)

- [ ] **Step 1.1: Confirm Cheerio is absent**

```bash
grep cheerio package.json
```

Expected output: nothing (no match). If it already appears, stop — this task is already done.

### Install

- [ ] **Step 1.2: Install Cheerio**

```bash
npm install cheerio
```

Expected: resolves without errors, `package.json` now contains a `cheerio` entry in `dependencies` (not `devDependencies`).

- [ ] **Step 1.3: Verify the entry is in `dependencies`, not `devDependencies`**

```bash
grep -A2 '"cheerio"' package.json
```

Expected: the entry appears under the `"dependencies"` block, not `"devDependencies"`.

- [ ] **Step 1.4: Remove the manual-install comment in `api/outages/citizen.js`**

Remove lines 22–24 (the comment block that says "npm install --save-dev cheerio (ou dans les deps serverless)"):

```js
// Note: cheerio doit être installé côté serveur uniquement.
// npm install --save-dev cheerio   (ou dans les deps serverless)
// Si non disponible, les parseurs HTML tombent en mode dégradé.
```

After removal, line 22 should be the blank line before `// ── Constants ──`.

- [ ] **Step 1.5: Verify Cheerio loads correctly in Node**

```bash
node -e "const cheerio = require('cheerio'); console.log('cheerio ok:', typeof cheerio.load)"
```

Expected: `cheerio ok: function`

- [ ] **Step 1.6: Typecheck + build**

```bash
npm run typecheck && npm run build
```

Expected: both pass with no new errors.

- [ ] **Step 1.7: Commit**

```bash
git add package.json package-lock.json api/outages/citizen.js
git commit -m "fix: install cheerio as proper dep — enables coupure-elec.fr source in prod"
```

---

## Task 2: Add IS_WORDPRESS structure validation to dev proxy

**Files:**
- Modify: `src/plugins/citizen-outages-proxy.ts` — function `parseDeptArticles`

### Context

`parseDeptArticles` in the dev proxy currently jumps straight into regex matching without checking if the HTML is actually a WordPress page. The prod version (`api/outages/citizen.js`, function `parseDeptArticles`) already has this guard at lines 334–344. We're copying it exactly.

### The guard to add

Insert this block at the **top of `parseDeptArticles`**, immediately after `const results: Array<...> = [];` and before the `articleRe` declaration:

```typescript
// ── Validation de structure ──
// Vérifier que la page ressemble à du WordPress (infocoupure est un site WP).
// Si absente, une réponse Cloudflare / erreur / maintenance est silencieusement
// interprétée comme "zéro panne" — ce guard rend l'échec visible.
const IS_WORDPRESS =
    /<article[^>]+class="[^"]*post[^"]*"[^>]*>/i.test(html) ||
    /<h2[^>]+class="[^"]*entry-title[^"]*"/i.test(html) ||
    /<div[^>]+class="[^"]*entry-content[^"]*"/i.test(html);

if (!IS_WORDPRESS) {
    console.warn(
        `[infocoupure] /departement-${code}/ : structure HTML inattendue — ` +
        'marqueurs WordPress absents. Le scraper est peut-\u00eatre cass\u00e9.'
    );
    return [];
}
```

Note: the warning string uses `\u00ea` and `\u00e9` to match the prod string byte-for-byte.

- [ ] **Step 2.1: Add the IS_WORDPRESS guard**

Open `src/plugins/citizen-outages-proxy.ts`. Find `parseDeptArticles`. The current opening looks like:

```typescript
function parseDeptArticles(html: string, code: string): Array<{ city: string; href: string }> {
    const results: Array<{ city: string; href: string }> = [];

    const articleRe = new RegExp(
```

Insert the guard block between `const results...` and `const articleRe...`:

```typescript
function parseDeptArticles(html: string, code: string): Array<{ city: string; href: string }> {
    const results: Array<{ city: string; href: string }> = [];

    // ── Validation de structure ──
    const IS_WORDPRESS =
        /<article[^>]+class="[^"]*post[^"]*"[^>]*>/i.test(html) ||
        /<h2[^>]+class="[^"]*entry-title[^"]*"/i.test(html) ||
        /<div[^>]+class="[^"]*entry-content[^"]*"/i.test(html);

    if (!IS_WORDPRESS) {
        console.warn(
            `[infocoupure] /departement-${code}/ : structure HTML inattendue — ` +
            'marqueurs WordPress absents. Le scraper est peut-\u00eatre cass\u00e9.'
        );
        return [];
    }

    const articleRe = new RegExp(
```

- [ ] **Step 2.2: Typecheck**

```bash
npm run typecheck
```

Expected: passes with no new errors.

- [ ] **Step 2.3: Commit**

```bash
git add src/plugins/citizen-outages-proxy.ts
git commit -m "fix: add IS_WORDPRESS structure validation to dev proxy parseDeptArticles"
```

---

## Task 3: Document clustering divergence in buildDevZones

**Files:**
- Modify: `src/plugins/citizen-outages-proxy.ts` — function `buildDevZones`

### The comment to add

Insert this block at the **very top of `buildDevZones`**, immediately after the opening `{`:

```typescript
// ── Dev-only simplified clustering ───────────────────────────────────────────
// This function is intentionally different from the Turf DBSCAN clustering
// used in prod (api/outages/citizen.js → clusterZones).
//
// Grid: quantised to 0.1° (~11 km lat / ~7.6 km lng at French latitudes).
// Each grid cell → an 8 km radius circle centred on the cluster centroid.
//
// Prod: Turf DBSCAN, 10 km radius, min 3 points → convex hull polygons.
//
// Why not use Turf here?
//   @turf/turf uses ESM exports. Importing it inside a Vite configureServer()
//   Node.js middleware causes CJS/ESM interop issues that are not worth fixing
//   for a dev-only code path. Turf is available in package.json if this
//   ever becomes a priority.
//
// Zone shapes and sizes WILL differ between dev and prod — this is expected.
// ─────────────────────────────────────────────────────────────────────────────
```

- [ ] **Step 3.1: Find the opening of `buildDevZones`**

In `src/plugins/citizen-outages-proxy.ts`, locate:

```typescript
function buildDevZones(reports: CitizenReportRaw[]) {
    const grid = new Map<string, { reports: CitizenReportRaw[]; total: number }>();
```

- [ ] **Step 3.2: Add the comment block**

Insert the comment between the opening `{` and the `const grid` line:

```typescript
function buildDevZones(reports: CitizenReportRaw[]) {
    // ── Dev-only simplified clustering ───────────────────────────────────────────
    // This function is intentionally different from the Turf DBSCAN clustering
    // used in prod (api/outages/citizen.js → clusterZones).
    //
    // Grid: quantised to 0.1° (~11 km lat / ~7.6 km lng at French latitudes).
    // Each grid cell → an 8 km radius circle centred on the cluster centroid.
    //
    // Prod: Turf DBSCAN, 10 km radius, min 3 points → convex hull polygons.
    //
    // Why not use Turf here?
    //   @turf/turf uses ESM exports. Importing it inside a Vite configureServer()
    //   Node.js middleware causes CJS/ESM interop issues that are not worth fixing
    //   for a dev-only code path. Turf is available in package.json if this
    //   ever becomes a priority.
    //
    // Zone shapes and sizes WILL differ between dev and prod — this is expected.
    // ─────────────────────────────────────────────────────────────────────────────
    const grid = new Map<string, { reports: CitizenReportRaw[]; total: number }>();
```

- [ ] **Step 3.3: Typecheck + build**

```bash
npm run typecheck && npm run build
```

Expected: both pass.

- [ ] **Step 3.4: Commit**

```bash
git add src/plugins/citizen-outages-proxy.ts
git commit -m "docs: document dev/prod clustering divergence in buildDevZones"
```

---

## Final verification

- [ ] **Step F.1: Full typecheck + build**

```bash
npm run typecheck && npm run build
```

Expected: clean pass.

- [ ] **Step F.2: Confirm all 3 changes are in git**

```bash
git log --oneline -4
```

Expected: the 3 commits from Tasks 1, 2, 3 are visible.

- [ ] **Step F.3: Confirm cheerio in dependencies**

```bash
grep '"cheerio"' package.json
```

Expected: a line like `"cheerio": "^X.Y.Z"` appears in the output.
