# Design: Citizen Scraping Hardening

**Date:** 2026-04-05  
**Status:** Approved  
**Scope:** `api/outages/citizen.js`, `src/plugins/citizen-outages-proxy.ts`, `package.json`

---

## Problem

Three specific fragility points remain in the citizen outage scraping stack:

1. **Cheerio absent from `package.json`** — `await import('cheerio')` fails silently in the Vercel serverless environment, causing the entire `coupure-elec.fr` source to be skipped with only a `console.warn`. The `coupure-elec.fr` source covers 5 high-density departments (~35% of metropolitan population).

2. **Missing structure validation in dev proxy** — `parseDeptArticles` in `citizen-outages-proxy.ts` (Vite plugin) has no IS_WORDPRESS check. If InfoCoupure.fr returns a Cloudflare error page or maintenance page, the function silently returns 0 articles — indistinguishable from "no outages reported today".

3. **Dev/prod clustering divergence undocumented** — The Vite plugin uses `buildDevZones` (simple grid, ~0.1° cells) while Vercel uses Turf DBSCAN (10km radius, min 3 points). Zone shapes differ, which is acceptable for dev but should be explicitly documented so future developers don't confuse dev output with prod.

---

## Approach: Minimal Fix (Approach A)

Three targeted changes, no refactoring.

### Change 1 — Install Cheerio as a proper dependency

**File:** `package.json`  
**Action:** `npm install cheerio`  
**Why `dependencies`, not `devDependencies`:** Cheerio runs in the Vercel Node.js serverless runtime at request time. Dev-only deps are not bundled by Vercel.  
**Side effect:** Remove the manual installation comment from `citizen.js` lines 22–24.

### Change 2 — Add IS_WORDPRESS validation to dev proxy

**File:** `src/plugins/citizen-outages-proxy.ts`  
**Function:** `parseDeptArticles(html, code)`  
**Action:** Add the same structure validation already present in `api/outages/citizen.js`:

```typescript
const IS_WORDPRESS =
  /<article[^>]+class="[^"]*post[^"]*"[^>]*>/i.test(html) ||
  /<h2[^>]+class="[^"]*entry-title[^"]*"/i.test(html) ||
  /<div[^>]+class="[^"]*entry-content[^"]*"/i.test(html);

if (!IS_WORDPRESS) {
  console.warn(
    `[infocoupure] /departement-${code}/ : structure HTML inattendue — ` +
    'marqueurs WordPress absents. Le scraper est peut-être cassé.'
  );
  return [];
}
```

**Insert position:** At the top of `parseDeptArticles`, before the regex matching loop.

**Note:** The warning string must match the prod string exactly (byte-for-byte) to allow cross-environment log correlation: `'marqueurs WordPress absents. Le scraper est peut-\u00eatre cass\u00e9.'`

### Change 3 — Document clustering divergence

**File:** `src/plugins/citizen-outages-proxy.ts`  
**Function:** `buildDevZones`  
**Action:** Add a comment block at the top of `buildDevZones` explaining:
- This is a simplified grid (quantised to 0.1°, asymmetric: ~11km lat / ~7.6km lng at French latitudes) used only in dev
- Each cell becomes an 8 km radius circle centred on the cluster centroid
- Prod uses Turf DBSCAN (10km radius, min 3 points) which produces polygon-shaped zones
- Importing Turf in a Vite Node.js middleware causes ESM/CJS interop issues — not worth fixing
- Zone shapes and sizes will differ between dev and prod — expected and acceptable

---

## What Is NOT Changed

- `clusterZones()` and `deduplicateReports()` in `citizen.js` — already correct
- HTML parsers in prod (`parseDeptArticles`, `parseCityComments`) — already have validation
- `coupure-elec.fr` scraper logic — correct, only needs Cheerio available
- Timeouts, rate limits, geocoding — untouched

---

## Success Criteria

1. `npm run build` and `npm run typecheck` pass with no new errors
2. In prod (Vercel), the `coupure-elec` source no longer fails due to a module import error — confirmed by the absence of `[coupure-elec] cheerio indisponible` in Vercel function logs after deploy
3. In dev, an unexpected HTML response from InfoCoupure.fr logs a visible warning instead of silently returning 0 articles
4. `buildDevZones` has a comment block explaining the divergence

---

## Files Modified

| File | Change |
|---|---|
| `package.json` | Add `cheerio` to `dependencies` |
| `api/outages/citizen.js` | Remove manual install comment (lines 22–24) |
| `src/plugins/citizen-outages-proxy.ts` | Add IS_WORDPRESS check in `parseDeptArticles`; add comment in `buildDevZones` |
| `package-lock.json` | Updated automatically by `npm install cheerio` — must be committed |
