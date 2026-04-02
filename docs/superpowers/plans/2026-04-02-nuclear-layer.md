# Nuclear Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un module de veille nucléaire OSINT à France Monitor : statut quasi temps réel RTE (OAuth2), timeline des indisponibilités, ingestion REMIT/UMM depuis l'IIP, détection des écarts REMIT vs RTE, score de tension nucléaire.

**Architecture:** Module standalone calqué sur le pattern gas/oil/cyber. Couche `nuclear` enfant de `energyGroup`. Layer 1 = RTE Open Data API (OAuth2). Layer 2 = IIP REMIT RSS existant (`rte-iip.ts`) filtré pour le nucléaire. Layer 3 = corrélation + score tension.

**Tech Stack:** TypeScript strict, Vanilla DOM, MapLibre GL, Vite plugins, Vercel serverless functions, RTE OAuth2

**Spec:** `docs/superpowers/specs/2026-04-02-nuclear-layer-design.md`

---

## File Map

**Créés :**
- `api/nuclear/rte-unavailability.js`
- `src/plugins/nuclear-proxy.ts`
- `src/services/nuclear-rte.ts`
- `src/services/nuclear-remit.ts`
- `src/services/nuclear-correlation.ts`
- `src/components/NuclearPanel.ts`

**Modifiés :**
- `src/types/index.ts` — 7 ajouts
- `vite.config.ts` — register nuclear proxy
- `src/components/DeckGLMap.ts` — colorOverride + setLayerVisibility nuclear
- `src/App.ts` — 4 places obligatoires + wiring complet
- `src/components/LayerPanel.ts` — 1 entrée

---

## Task 1: Types

**Files:**
- Modify: `src/types/index.ts`

- [ ] **Step 1: Ajouter `nuclear: boolean` dans l'interface `MapLayers`**

Dans `src/types/index.ts`, après la ligne `oil: boolean;` (ligne ~91) et avant `dayNight?:` :

```ts
  nuclear: boolean;
```

- [ ] **Step 2: Ajouter `colorOverride?` dans `InfrastructurePoint`**

Dans l'interface `InfrastructurePoint` (ligne ~428), après `notes?: string;` :

```ts
  /** Couleur CSS override (ex. pour statut nucléaire dynamique RTE). */
  colorOverride?: string;
```

- [ ] **Step 3: Ajouter les 6 types nucléaires**

Après le bloc `// ═══ Nuclear Sites (RTE / ASN) ═══` (ligne ~444), remplacer ce qui existe (NuclearStatus, NuclearSiteStats) sans les supprimer, et AJOUTER après `NuclearSiteStats` :

```ts
// ═══ Nuclear Module (RTE Layer 1 + REMIT Layer 2 + Correlation Layer 3) ═══

export type ReactorAvailabilityStatus =
  | 'AVAILABLE'
  | 'REDUCED'
  | 'OUTAGE_PLANNED'
  | 'OUTAGE_UNPLANNED'
  | 'UNKNOWN';

/** Indisponibilité structurée RTE (Layer 1 — OAuth2 API) */
export interface NuclearUnavailability {
  id: string;
  plantName: string;          // ex. "Gravelines"
  unitName: string;           // ex. "GRAVELINES-1" (nom RTE normalisé)
  nominalPowerMW: number;
  availablePowerMW: number;
  status: ReactorAvailabilityStatus;
  startDate: Date;
  endDate: Date | null;
  type: 'PLANNED' | 'UNPLANNED' | 'FORCE_MAJEURE';
  updatedAt: Date;
}

/** Signal REMIT filtré pour le nucléaire (Layer 2 — IIP RSS) */
export interface NuclearRemitSignal {
  id: string;
  plantName: string;
  unitName: string | null;
  classifiedAs:
    | 'UNPLANNED_OUTAGE'
    | 'PLANNED_MAINTENANCE'
    | 'RESTART'
    | 'EXTENSION'
    | 'OTHER';
  capacityMW: number | null;
  publishedAt: Date;
  title: string;
  link: string;
  /** false par défaut dans nuclear-remit.ts, résolu dans nuclear-correlation.ts */
  confirmedByRTE: boolean;
  matchConfidence: number; // 0–1
}

/** Signal REMIT non reflété dans les données RTE structurées */
export interface UnconfirmedRemitSignal {
  remitSignal: NuclearRemitSignal;
  reason: string;
  confidence: number;
}

/** Score de tension nucléaire (Layer 3) */
export interface NuclearStressScore {
  installedCapacityMW: number;
  availableCapacityMW: number;
  stressRatio: number;  // (installed - available) / installed
  level: 'NORMAL' | 'TENSION' | 'CRITIQUE'; // <10% / 10–25% / >25%
  gridTensionRisk: boolean;
  updatedAt: Date;
  freshness: 'quasi-realtime' | 'stale' | 'unavailable';
}

/** État global du module nucléaire */
export interface NuclearState {
  unavailabilities: NuclearUnavailability[];
  remitSignals: NuclearRemitSignal[];
  unconfirmedSignals: UnconfirmedRemitSignal[];
  stress: NuclearStressScore | null;
  rteAvailable: boolean;
  remitAvailable: boolean;
  fetchedAt: Date;
}
```

- [ ] **Step 4: Vérifier typecheck**

```bash
npm run typecheck
```
Expected: 0 errors sur les types ajoutés (d'autres erreurs peuvent apparaître car les types ne sont pas encore utilisés — c'est normal).

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(nuclear): add nuclear types to types/index.ts"
```

---

## Task 2: Vercel function `api/nuclear/rte-unavailability.js`

**Files:**
- Create: `api/nuclear/rte-unavailability.js`

- [ ] **Step 1: Créer le répertoire et le fichier**

```bash
mkdir -p api/nuclear
```

- [ ] **Step 2: Écrire la Vercel function**

```js
/**
 * api/nuclear/rte-unavailability.js — Vercel Serverless Function
 *
 * OAuth2 flow inline + GET unavailabilities RTE pour le nucléaire.
 * Renvoie un tableau d'indisponibilités normalisées.
 *
 * Env vars requises : RTE_CLIENT_ID, RTE_CLIENT_SECRET
 * Env var optionnelle : RTE_API_VERSION (défaut: v4)
 *
 * Source : https://digital.iservices.rte-france.com/open_api/unavailability_additional_information/
 */

const RTE_TOKEN_URL = 'https://digital.iservices.rte-france.com/token/oauth/token';
const API_VERSION   = process.env.RTE_API_VERSION ?? 'v4';
const RTE_UNAV_URL  =
  `https://digital.iservices.rte-france.com/open_api/unavailability_additional_information/${API_VERSION}/generation_unavailabilities`;

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 min
let _cache = null; // { data, fetchedAt }

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const clientId     = process.env.RTE_CLIENT_ID;
  const clientSecret = process.env.RTE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    res.status(503).json({
      error: 'RTE_CLIENT_ID or RTE_CLIENT_SECRET not configured',
      available: false,
    });
    return;
  }

  // Serve from cache if fresh
  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', `public, max-age=${Math.floor(CACHE_TTL_MS / 1000)}`);
    res.status(200).json(_cache.data);
    return;
  }

  try {
    // ── Step 1: Obtain OAuth2 token ───────────────────────────────────────
    const tokenResp = await fetch(RTE_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
      },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(10_000),
    });

    if (!tokenResp.ok) {
      const body = await tokenResp.text().catch(() => '');
      console.error('[nuclear-rte] Token error:', tokenResp.status, body);
      res.status(502).json({ error: `OAuth token failed: ${tokenResp.status}`, available: false });
      return;
    }

    const { access_token } = await tokenResp.json();

    // ── Step 2: Fetch unavailabilities ────────────────────────────────────
    const params = new URLSearchParams({
      resource_type: 'NUCLEAR',
      status: 'ACTIVE',
    });

    const unavResp = await fetch(`${RTE_UNAV_URL}?${params}`, {
      headers: { Authorization: `Bearer ${access_token}` },
      signal: AbortSignal.timeout(15_000),
    });

    if (!unavResp.ok) {
      console.error('[nuclear-rte] Unavailability API error:', unavResp.status);
      res.status(502).json({ error: `RTE API error: ${unavResp.status}`, available: false });
      return;
    }

    const raw = await unavResp.json();

    // Normaliser la réponse vers un tableau plat
    const items = Array.isArray(raw)
      ? raw
      : (raw.generation_unavailabilities ?? raw.unavailabilities ?? []);

    const payload = { items, available: true, fetchedAt: new Date().toISOString() };
    _cache = { data: payload, fetchedAt: Date.now() };

    res.setHeader('Cache-Control', `public, max-age=${Math.floor(CACHE_TTL_MS / 1000)}`);
    res.status(200).json(payload);
  } catch (err) {
    console.error('[nuclear-rte] Unexpected error:', err);
    res.status(500).json({ error: String(err), available: false });
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add api/nuclear/rte-unavailability.js
git commit -m "feat(nuclear): add RTE OAuth2 Vercel function"
```

---

## Task 3: Vite proxy `src/plugins/nuclear-proxy.ts` + `vite.config.ts`

**Files:**
- Create: `src/plugins/nuclear-proxy.ts`
- Modify: `vite.config.ts`

- [ ] **Step 1: Créer le plugin proxy**

```ts
/**
 * nuclear-proxy.ts — Vite dev proxy pour /api/nuclear/rte-unavailability
 *
 * Reproduit la logique OAuth2 en local pour le développement.
 * Les credentials sont passés depuis vite.config.ts via loadEnv.
 */

import type { Plugin } from 'vite';

const RTE_TOKEN_URL = 'https://digital.iservices.rte-france.com/token/oauth/token';
const API_VERSION   = process.env.RTE_API_VERSION ?? 'v4';
const RTE_UNAV_URL  =
  `https://digital.iservices.rte-france.com/open_api/unavailability_additional_information/${API_VERSION}/generation_unavailabilities`;

const CACHE_TTL_MS = 15 * 60_000;
let _devCache: { data: unknown; fetchedAt: number } | null = null;

export function nuclearProxyPlugin(opts: { clientId: string; clientSecret: string }): Plugin {
  return {
    name: 'nuclear-proxy',
    configureServer(server) {
      server.middlewares.use('/api/nuclear/rte-unavailability', async (_req, res) => {
        if (!opts.clientId || !opts.clientSecret) {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'RTE credentials not set in .env', available: false }));
          return;
        }

        if (_devCache && Date.now() - _devCache.fetchedAt < CACHE_TTL_MS) {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(_devCache.data));
          return;
        }

        try {
          const tokenResp = await fetch(RTE_TOKEN_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Authorization:
                'Basic ' + Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString('base64'),
            },
            body: 'grant_type=client_credentials',
            signal: AbortSignal.timeout(10_000),
          });

          if (!tokenResp.ok) {
            const body = await tokenResp.text().catch(() => '');
            console.error('[nuclear-proxy] Token error:', tokenResp.status, body);
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `OAuth token failed: ${tokenResp.status}`, available: false }));
            return;
          }

          const { access_token } = (await tokenResp.json()) as { access_token: string };

          const params = new URLSearchParams({ resource_type: 'NUCLEAR', status: 'ACTIVE' });
          const unavResp = await fetch(`${RTE_UNAV_URL}?${params}`, {
            headers: { Authorization: `Bearer ${access_token}` },
            signal: AbortSignal.timeout(15_000),
          });

          if (!unavResp.ok) {
            console.error('[nuclear-proxy] API error:', unavResp.status);
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: `RTE API ${unavResp.status}`, available: false }));
            return;
          }

          const raw = await unavResp.json();
          const items = Array.isArray(raw)
            ? raw
            : ((raw as Record<string, unknown>).generation_unavailabilities ??
              (raw as Record<string, unknown>).unavailabilities ?? []);

          const payload = { items, available: true, fetchedAt: new Date().toISOString() };
          _devCache = { data: payload, fetchedAt: Date.now() };

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(payload));
        } catch (err) {
          console.error('[nuclear-proxy]', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: String(err), available: false }));
        }
      });
    },
  };
}
```

- [ ] **Step 2: Enregistrer dans `vite.config.ts`**

Ajouter l'import en haut (après les imports existants) :
```ts
import { nuclearProxyPlugin } from './src/plugins/nuclear-proxy';
```

Dans le tableau `plugins:`, après `sentinelNdwiProxyPlugin()` :
```ts
      nuclearProxyPlugin({
        clientId: env.RTE_CLIENT_ID ?? '',
        clientSecret: env.RTE_CLIENT_SECRET ?? '',
      }),
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: 0 nouvelles erreurs.

- [ ] **Step 4: Commit**

```bash
git add src/plugins/nuclear-proxy.ts vite.config.ts
git commit -m "feat(nuclear): add Vite dev proxy for RTE unavailability"
```

---

## Task 4: Service `src/services/nuclear-rte.ts`

**Files:**
- Create: `src/services/nuclear-rte.ts`

- [ ] **Step 1: Écrire le service**

```ts
/**
 * nuclear-rte.ts — Layer 1 : RTE OAuth2 Unavailability API
 *
 * Récupère les indisponibilités de production nucléaire depuis l'API
 * RTE Open Data via le Vercel function /api/nuclear/rte-unavailability.
 *
 * Temporalité : QUASI TEMPS RÉEL (cache applicatif 15 min)
 */

import type { NuclearUnavailability, ReactorAvailabilityStatus } from '../types/index.ts';
import { NUCLEAR_PLANTS } from '../config/infrastructure.ts';

const API_URL = import.meta.env.PROD
  ? '/api/nuclear/rte-unavailability'
  : '/api/nuclear/rte-unavailability'; // Vite proxy same path

const CACHE_TTL_MS = 15 * 60_000;
let _cache: { items: NuclearUnavailability[]; fetchedAt: number } | null = null;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Retourne les indisponibilités nucléaires actives depuis RTE.
 * Retourne [] si l'API est indisponible (pas de données fictives).
 */
export async function fetchNuclearUnavailabilities(): Promise<NuclearUnavailability[]> {
  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
    return _cache.items;
  }

  try {
    const resp = await fetch(API_URL, { signal: AbortSignal.timeout(20_000) });

    if (!resp.ok) {
      console.warn('[nuclear-rte] HTTP error:', resp.status);
      return [];
    }

    const json = (await resp.json()) as {
      available?: boolean;
      items?: unknown[];
      error?: string;
    };

    if (!json.available || !Array.isArray(json.items)) {
      console.warn('[nuclear-rte] Unavailable or malformed response:', json.error ?? 'no items');
      return [];
    }

    const items = json.items.map(normalizeItem).filter((u): u is NuclearUnavailability => u !== null);
    _cache = { items, fetchedAt: Date.now() };
    return items;
  } catch (err) {
    console.warn('[nuclear-rte] Fetch failed:', err);
    return [];
  }
}

export function invalidateNuclearRTECache(): void {
  _cache = null;
}

/**
 * Pour un nom de centrale, retourne le statut le plus grave parmi ses tranches actives.
 * Utilisé pour colorier la carte.
 */
export function getPlantWorstStatus(
  plantName: string,
  unavailabilities: NuclearUnavailability[],
): ReactorAvailabilityStatus {
  const norm = normalizeText(plantName);
  const now = Date.now();

  const active = unavailabilities.filter(
    (u) =>
      normalizeText(u.plantName).includes(norm) &&
      u.startDate.getTime() <= now &&
      (u.endDate === null || u.endDate.getTime() >= now),
  );

  if (active.length === 0) return 'AVAILABLE';

  const priority: ReactorAvailabilityStatus[] = [
    'OUTAGE_UNPLANNED',
    'OUTAGE_PLANNED',
    'REDUCED',
    'AVAILABLE',
    'UNKNOWN',
  ];

  for (const p of priority) {
    if (active.some((u) => u.status === p)) return p;
  }
  return 'UNKNOWN';
}

/**
 * Construit une map plantName → couleur CSS pour la carte.
 */
export function buildNuclearColorMap(
  unavailabilities: NuclearUnavailability[],
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const plant of NUCLEAR_PLANTS) {
    if (plant.status === 'shutdown') continue;
    const status = getPlantWorstStatus(plant.name, unavailabilities);
    map[plant.name] = NUCLEAR_STATUS_COLORS[status];
  }
  return map;
}

// ── Color map ─────────────────────────────────────────────────────────────────

export const NUCLEAR_STATUS_COLORS: Record<ReactorAvailabilityStatus, string> = {
  AVAILABLE: '#2ECC71',
  REDUCED: '#F59E0B',
  OUTAGE_PLANNED: '#7B8CDE',
  OUTAGE_UNPLANNED: '#E74C3C',
  UNKNOWN: '#6B7280',
};

/** Couleur pour un signal REMIT non confirmé par RTE */
export const NUCLEAR_REMIT_UNCONFIRMED_COLOR = '#111827';

// ── Normalizer ────────────────────────────────────────────────────────────────

function normalizeItem(raw: unknown): NuclearUnavailability | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  // L'API RTE peut renvoyer unit.name ou asset_name selon la version
  const unit = (r['unit'] as Record<string, unknown> | undefined) ?? {};
  const unitName  = String(unit['name'] ?? r['asset_name'] ?? r['unit_name'] ?? '').trim();
  const plantName = derivePlantName(unitName);
  if (!plantName) return null;

  const nominalPowerMW   = toNumber(r['installed_capacity'] ?? r['nominal_capacity'] ?? 0);
  const availablePowerMW = toNumber(r['available_capacity'] ?? 0);
  const startDate        = parseDate(r['start_date'] as string | undefined);
  const endDate          = r['end_date'] ? parseDate(r['end_date'] as string) : null;

  if (!startDate) return null;

  const rawType   = String(r['unavailability_type'] ?? r['type'] ?? '').toUpperCase();
  const type: NuclearUnavailability['type'] =
    rawType.includes('FORCED') || rawType.includes('UNPLANNED') ? 'UNPLANNED'
    : rawType.includes('FORCE_MAJEURE') ? 'FORCE_MAJEURE'
    : 'PLANNED';

  const status = deriveStatus(nominalPowerMW, availablePowerMW, type);

  return {
    id: String(r['id'] ?? r['eic_code'] ?? unitName + '-' + startDate.toISOString()),
    plantName,
    unitName,
    nominalPowerMW,
    availablePowerMW,
    status,
    startDate,
    endDate,
    type,
    updatedAt: parseDate(r['updated_date'] as string | undefined) ?? new Date(),
  };
}

function deriveStatus(
  nominal: number,
  available: number,
  type: NuclearUnavailability['type'],
): ReactorAvailabilityStatus {
  if (nominal <= 0) return 'UNKNOWN';
  const ratio = available / nominal;
  if (ratio >= 0.95) return 'AVAILABLE';
  if (ratio > 0) return type === 'UNPLANNED' ? 'OUTAGE_UNPLANNED' : 'REDUCED';
  return type === 'UNPLANNED' ? 'OUTAGE_UNPLANNED' : 'OUTAGE_PLANNED';
}

/** Extrait le nom de centrale depuis le nom d'unité RTE (ex. "GRAVELINES-1" → "Gravelines") */
function derivePlantName(unitName: string): string {
  // Cherche un match dans NUCLEAR_PLANTS par comparaison normalisée
  const norm = normalizeText(unitName);
  for (const plant of NUCLEAR_PLANTS) {
    if (norm.includes(normalizeText(plant.name))) return plant.name;
  }
  // Fallback : strip le numéro de tranche (GRAVELINES-1 → Gravelines)
  const base = unitName.replace(/-\d+$/, '').replace(/_\d+$/, '').trim();
  return base || unitName;
}

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function toNumber(v: unknown): number {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function parseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: 0 nouvelles erreurs.

- [ ] **Step 3: Commit**

```bash
git add src/services/nuclear-rte.ts
git commit -m "feat(nuclear): add nuclear-rte service (Layer 1 RTE OAuth2)"
```

---

## Task 5: Service `src/services/nuclear-remit.ts`

**Files:**
- Create: `src/services/nuclear-remit.ts`

- [ ] **Step 1: Écrire le service**

```ts
/**
 * nuclear-remit.ts — Layer 2 : REMIT / UMM filtré pour le nucléaire
 *
 * Consomme l'état IIP RTE déjà fetchté (rte-iip.ts) et extrait
 * les signaux de production nucléaire avec matching plant name + classification.
 *
 * Temporalité : QUASI TEMPS RÉEL (hérite du cache rte-iip.ts ~12 min)
 * Aucun appel réseau propre.
 */

import type { NuclearRemitSignal } from '../types/index.ts';
import type { RTEIIPState } from './rte-iip.ts';
import { NUCLEAR_PLANTS } from '../config/infrastructure.ts';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Filtre un RTEIIPState pour ne garder que les incidents nucléaires.
 * Chaque signal a confirmedByRTE = false (résolu dans nuclear-correlation.ts).
 */
export function extractNuclearRemitSignals(iipState: RTEIIPState): NuclearRemitSignal[] {
  return iipState.incidents
    .filter((inc) => inc.type === 'production')
    .map((inc) => {
      const { plantName, matchConfidence } = matchPlant(inc.title + ' ' + inc.description);
      if (matchConfidence < 0.4) return null;

      return {
        id: inc.id,
        plantName,
        unitName: extractUnitName(inc.title),
        classifiedAs: classifyText(inc.title + ' ' + inc.description),
        capacityMW: inc.capacityMW,
        publishedAt: inc.publishedAt,
        title: inc.title,
        link: inc.link,
        confirmedByRTE: false,
        matchConfidence,
      } satisfies NuclearRemitSignal;
    })
    .filter((s): s is NuclearRemitSignal => s !== null);
}

// ── Plant matching ────────────────────────────────────────────────────────────

function matchPlant(text: string): { plantName: string; matchConfidence: number } {
  const norm = normalizeText(text);

  // Exact match
  for (const plant of NUCLEAR_PLANTS) {
    if (plant.status === 'shutdown') continue;
    const plantNorm = normalizeText(plant.name);
    if (norm.includes(plantNorm)) {
      return { plantName: plant.name, matchConfidence: 1.0 };
    }
  }

  // Partial match: Levenshtein distance ≤ 2 sur les 6 premiers chars
  for (const plant of NUCLEAR_PLANTS) {
    if (plant.status === 'shutdown') continue;
    const plantNorm = normalizeText(plant.name);
    const prefix = plantNorm.slice(0, 6);
    // Find any word in the text that starts similarly
    const words = norm.split(/\s+/);
    for (const word of words) {
      if (word.length >= 4 && levenshtein(word.slice(0, 6), prefix) <= 2) {
        return { plantName: plant.name, matchConfidence: 0.7 };
      }
    }
  }

  return { plantName: '', matchConfidence: 0 };
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// ── Text classification ────────────────────────────────────────────────────────

function classifyText(text: string): NuclearRemitSignal['classifiedAs'] {
  const t = text.toLowerCase();
  if (/unplanned outage|avarie|arrêt fortuit|forced outage/.test(t)) return 'UNPLANNED_OUTAGE';
  if (/restart|remise en service|reconnection/.test(t)) return 'RESTART';
  if (/extension|prolongation/.test(t)) return 'EXTENSION';
  if (/maintenance|arrêt programmé|planned outage|révision/.test(t)) return 'PLANNED_MAINTENANCE';
  return 'OTHER';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractUnitName(title: string): string | null {
  // Ex: "GRAVELINES-3 unavailability" → "GRAVELINES-3"
  const m = title.match(/([A-Z][A-Z0-9\-]{3,}(?:-\d+)?)\b/);
  return m ? m[1] : null;
}

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: 0 nouvelles erreurs.

- [ ] **Step 3: Commit**

```bash
git add src/services/nuclear-remit.ts
git commit -m "feat(nuclear): add nuclear-remit service (Layer 2 REMIT filter)"
```

---

## Task 6: Service `src/services/nuclear-correlation.ts`

**Files:**
- Create: `src/services/nuclear-correlation.ts`

- [ ] **Step 1: Écrire le service**

```ts
/**
 * nuclear-correlation.ts — Layer 3 : Diff REMIT vs RTE + Score tension
 *
 * Croise les signaux REMIT nucléaires avec les indisponibilités RTE structurées.
 * Produit : UnconfirmedRemitSignal[], NuclearStressScore, NuclearState complet.
 *
 * Temporalité : calculé à chaque fetch (hérite du freshness le plus dégradé).
 */

import type {
  NuclearUnavailability,
  NuclearRemitSignal,
  UnconfirmedRemitSignal,
  NuclearStressScore,
  NuclearState,
} from '../types/index.ts';
import type { RTEIIPState } from './rte-iip.ts';
import type { EnergyMix } from '../types/index.ts';
import { NUCLEAR_PLANTS } from '../config/infrastructure.ts';
import { extractNuclearRemitSignals } from './nuclear-remit.ts';
import { invalidateNuclearRTECache } from './nuclear-rte.ts';

// Re-export pour App.ts
export { invalidateNuclearRTECache };

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Construit l'état complet du module nucléaire.
 *
 * @param unavailabilities  Résultat de fetchNuclearUnavailabilities()
 * @param iipState          Résultat de fetchRTEIIPIncidents()
 * @param nationalMix       Mix national éCO2mix (optionnel, pour gridTensionRisk)
 */
export function buildNuclearState(
  unavailabilities: NuclearUnavailability[],
  iipState: RTEIIPState,
  nationalMix?: Pick<EnergyMix, 'nuclear' | 'total'>,
): NuclearState {
  const rteAvailable  = unavailabilities.length > 0 || iipState.available;
  const remitAvailable = iipState.available;

  const remitSignals    = extractNuclearRemitSignals(iipState);
  const { confirmed, unconfirmed } = correlate(remitSignals, unavailabilities);

  // Marquer les signaux confirmés
  const enrichedRemit = remitSignals.map((s) => ({
    ...s,
    confirmedByRTE: confirmed.has(s.id),
  }));

  const stress = buildStressScore(unavailabilities, nationalMix, rteAvailable);

  return {
    unavailabilities,
    remitSignals: enrichedRemit,
    unconfirmedSignals: unconfirmed,
    stress,
    rteAvailable,
    remitAvailable,
    fetchedAt: new Date(),
  };
}

// ── Correlation ───────────────────────────────────────────────────────────────

function correlate(
  remit: NuclearRemitSignal[],
  rte: NuclearUnavailability[],
): { confirmed: Set<string>; unconfirmed: UnconfirmedRemitSignal[] } {
  const confirmed  = new Set<string>();
  const unconfirmed: UnconfirmedRemitSignal[] = [];

  for (const signal of remit) {
    const match = rte.find((u) => {
      const sameOrSimilarPlant =
        normalizeText(u.plantName).includes(normalizeText(signal.plantName)) ||
        normalizeText(signal.plantName).includes(normalizeText(u.plantName));
      if (!sameOrSimilarPlant) return false;

      // Overlap temporel : le signal REMIT publishedAt doit être proche de la fenêtre RTE
      const pub  = signal.publishedAt.getTime();
      const start = u.startDate.getTime();
      const end   = u.endDate?.getTime() ?? Infinity;
      const WINDOW_MS = 48 * 60 * 60_000; // ±48h de tolérance
      return pub >= start - WINDOW_MS && pub <= end + WINDOW_MS;
    });

    if (match) {
      confirmed.add(signal.id);
    } else {
      unconfirmed.push({
        remitSignal: signal,
        reason: 'Aucune indisponibilité RTE correspondante',
        confidence: signal.matchConfidence,
      });
    }
  }

  return { confirmed, unconfirmed };
}

// ── Stress score ──────────────────────────────────────────────────────────────

function buildStressScore(
  unavailabilities: NuclearUnavailability[],
  nationalMix: Pick<EnergyMix, 'nuclear' | 'total'> | undefined,
  rteAvailable: boolean,
): NuclearStressScore {
  const now = Date.now();

  const installedCapacityMW = NUCLEAR_PLANTS
    .filter((p) => p.status !== 'shutdown')
    .reduce((sum, p) => sum + (p.capacity ?? 0), 0);

  // Capacité indisponible = somme des (nominal - available) pour les tranches actives
  const indispoMW = unavailabilities
    .filter((u) => u.startDate.getTime() <= now && (u.endDate === null || u.endDate.getTime() >= now))
    .reduce((sum, u) => sum + Math.max(0, u.nominalPowerMW - u.availablePowerMW), 0);

  const availableCapacityMW = Math.max(0, installedCapacityMW - indispoMW);
  const stressRatio = installedCapacityMW > 0
    ? (installedCapacityMW - availableCapacityMW) / installedCapacityMW
    : 0;

  const level: NuclearStressScore['level'] =
    stressRatio > 0.25 ? 'CRITIQUE'
    : stressRatio > 0.10 ? 'TENSION'
    : 'NORMAL';

  // heuristique produit v1 : nucléaire < 35% du mix national
  const gridTensionRisk =
    stressRatio > 0.10 &&
    nationalMix != null &&
    nationalMix.total > 0 &&
    nationalMix.nuclear < nationalMix.total * 0.35;

  const freshness: NuclearStressScore['freshness'] = !rteAvailable
    ? 'unavailable'
    : 'quasi-realtime'; // fetchedAt est évalué dans App.ts si stale

  return {
    installedCapacityMW,
    availableCapacityMW,
    stressRatio,
    level,
    gridTensionRisk,
    updatedAt: new Date(),
    freshness,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: 0 nouvelles erreurs.

- [ ] **Step 3: Commit**

```bash
git add src/services/nuclear-correlation.ts
git commit -m "feat(nuclear): add nuclear-correlation service (Layer 3 diff + stress)"
```

---

## Task 7: Panel `src/components/NuclearPanel.ts`

**Files:**
- Create: `src/components/NuclearPanel.ts`

- [ ] **Step 1: Écrire le panel**

```ts
/**
 * NuclearPanel.ts — Panneau flottant Veille Nucléaire
 *
 * 4 onglets : STATUS · TIMELINE · REMIT · STRESS
 * Affiche clairement la qualité de la donnée (fraîcheur, disponibilité).
 */

import { Panel } from './Panel.ts';
import type { NuclearState, NuclearUnavailability, NuclearRemitSignal } from '../types/index.ts';
import { NUCLEAR_STATUS_COLORS, NUCLEAR_REMIT_UNCONFIRMED_COLOR } from '../services/nuclear-rte.ts';

type ActiveTab = 'status' | 'timeline' | 'remit' | 'stress';

export class NuclearPanel extends Panel {
  private modalEl!: HTMLElement;
  private contentEl!: HTMLElement;
  private activeTab: ActiveTab = 'status';
  private currentState: NuclearState | null = null;
  private onCloseCallback?: () => void;

  constructor(container: HTMLElement) {
    super(container, { title: 'Veille Nucléaire', icon: '⚛', collapsible: false });
  }

  mount(): void {
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'nuclear-panel-modal';
    this.modalEl.style.cssText = `
      position: absolute;
      top: var(--right-panel-top, 70px);
      right: 20px;
      width: 400px;
      max-height: calc(100vh - var(--right-panel-top, 70px) - 20px);
      background: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      z-index: 1000;
      display: none;
      flex-direction: column;
      backdrop-filter: blur(10px);
      overflow: hidden;
    `;

    this.modalEl.innerHTML = `
      <div class="nuclear-panel-header" style="
        padding: 14px 16px 0;
        display: flex;
        justify-content: space-between;
        align-items: center;
        flex-shrink: 0;
      ">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:18px;">⚛</span>
          <span style="font-size:13px;font-weight:600;color:var(--text-primary);letter-spacing:0.05em;">
            VEILLE NUCLÉAIRE
          </span>
        </div>
        <button class="nuclear-panel-close" style="
          background:rgba(255,255,255,0.1);border:none;color:var(--text-muted);
          cursor:pointer;font-size:14px;width:28px;height:28px;border-radius:14px;
          display:flex;align-items:center;justify-content:center;
        ">✕</button>
      </div>
      <div class="nuclear-panel-tabs" style="
        display:flex;gap:4px;padding:10px 16px 0;flex-shrink:0;border-bottom:1px solid var(--border-color);
      ">
        ${(['status','timeline','remit','stress'] as ActiveTab[]).map(tab => `
          <button data-tab="${tab}" class="nuclear-tab-btn" style="
            background:none;border:none;cursor:pointer;
            padding:6px 10px;font-size:11px;font-weight:600;
            letter-spacing:0.06em;text-transform:uppercase;
            color:var(--text-muted);border-bottom:2px solid transparent;
            transition:color 0.15s,border-color 0.15s;
          ">${tab === 'status' ? 'STATUS' : tab === 'timeline' ? 'TIMELINE' : tab === 'remit' ? 'REMIT ⚑' : 'STRESS'}</button>
        `).join('')}
      </div>
      <div class="nuclear-panel-content" style="
        flex:1;overflow-y:auto;padding:12px 16px;min-height:0;
      "></div>
    `;

    this.contentEl = this.modalEl.querySelector('.nuclear-panel-content')!;

    // Close button
    this.modalEl.querySelector('.nuclear-panel-close')!.addEventListener('click', () => {
      this.hide();
      this.onCloseCallback?.();
    });

    // Tab buttons
    this.modalEl.querySelectorAll<HTMLButtonElement>('.nuclear-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.activeTab = btn.dataset['tab'] as ActiveTab;
        this._syncTabStyles();
        this._renderContent();
      });
    });

    this.container.appendChild(this.modalEl);
    this._syncTabStyles();
  }

  setOnClose(cb: () => void): void {
    this.onCloseCallback = cb;
  }

  show(state: NuclearState | null = null): void {
    if (state) this.currentState = state;
    if (this.modalEl) {
      this.modalEl.style.display = 'flex';
      this._renderContent();
    }
  }

  update(state: NuclearState): void {
    this.currentState = state;
    if (this.modalEl?.style.display !== 'none') {
      this._renderContent();
    }
  }

  hide(): void {
    if (this.modalEl) this.modalEl.style.display = 'none';
  }

  isVisible(): boolean {
    return this.modalEl?.style.display !== 'none';
  }

  destroy(): void {
    this.modalEl?.remove();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _syncTabStyles(): void {
    this.modalEl.querySelectorAll<HTMLButtonElement>('.nuclear-tab-btn').forEach((btn) => {
      const isActive = btn.dataset['tab'] === this.activeTab;
      btn.style.color = isActive ? 'var(--text-primary)' : 'var(--text-muted)';
      btn.style.borderBottomColor = isActive ? '#8FC8E8' : 'transparent';
    });
  }

  private _renderContent(): void {
    if (!this.contentEl) return;
    const state = this.currentState;

    if (!state) {
      this.contentEl.innerHTML = this._renderUnavailable('Chargement…');
      return;
    }

    switch (this.activeTab) {
      case 'status':   this.contentEl.innerHTML = this._renderStatus(state);   break;
      case 'timeline': this.contentEl.innerHTML = this._renderTimeline(state); break;
      case 'remit':    this.contentEl.innerHTML = this._renderRemit(state);    break;
      case 'stress':   this.contentEl.innerHTML = this._renderStress(state);   break;
    }
  }

  // ── STATUS tab ──────────────────────────────────────────────────────────────

  private _renderStatus(state: NuclearState): string {
    if (!state.rteAvailable) {
      return this._renderUnavailable('API RTE indisponible — données non chargées.');
    }

    const freshnessBadge = this._freshnessBadge(state.stress?.freshness ?? 'unavailable');

    const byPlant = new Map<string, NuclearUnavailability[]>();
    for (const u of state.unavailabilities) {
      if (!byPlant.has(u.plantName)) byPlant.set(u.plantName, []);
      byPlant.get(u.plantName)!.push(u);
    }

    if (byPlant.size === 0) {
      return `
        ${freshnessBadge}
        <div style="color:var(--text-muted);font-size:12px;margin-top:8px;">
          Aucune indisponibilité active. Toutes les centrales disponibles.
        </div>`;
    }

    const cards = Array.from(byPlant.entries()).map(([plant, units]) => {
      const worstStatus = units.reduce<string>((worst, u) => {
        const order = ['OUTAGE_UNPLANNED','OUTAGE_PLANNED','REDUCED','AVAILABLE','UNKNOWN'];
        return order.indexOf(u.status) < order.indexOf(worst) ? u.status : worst;
      }, 'AVAILABLE');
      const color = (NUCLEAR_STATUS_COLORS as Record<string, string>)[worstStatus] ?? '#6B7280';
      const totalNominal   = units.reduce((s, u) => s + u.nominalPowerMW, 0);
      const totalAvailable = units.reduce((s, u) => s + u.availablePowerMW, 0);
      return `
        <div style="
          background:rgba(255,255,255,0.04);border-radius:8px;
          padding:10px 12px;margin-bottom:8px;border-left:3px solid ${color};
        ">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:12px;font-weight:600;color:var(--text-primary);">${plant}</span>
            <span style="font-size:10px;padding:2px 7px;border-radius:10px;background:${color}22;color:${color};font-weight:700;">
              ${worstStatus.replace('_', ' ')}
            </span>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">
            ${totalAvailable.toLocaleString('fr-FR')} / ${totalNominal.toLocaleString('fr-FR')} MW disponibles
            · ${units.length} tranche${units.length > 1 ? 's' : ''} en indisponibilité
          </div>
        </div>`;
    });

    return `${freshnessBadge}<div style="margin-top:8px;">${cards.join('')}</div>`;
  }

  // ── TIMELINE tab ────────────────────────────────────────────────────────────

  private _renderTimeline(state: NuclearState): string {
    if (!state.rteAvailable) return this._renderUnavailable('API RTE indisponible.');

    const now = new Date();
    const sorted = [...state.unavailabilities].sort(
      (a, b) => a.startDate.getTime() - b.startDate.getTime(),
    );

    if (sorted.length === 0) {
      return `
        ${this._freshnessBadge(state.stress?.freshness ?? 'unavailable')}
        <div style="color:var(--text-muted);font-size:12px;margin-top:8px;">
          Aucune indisponibilité planifiée.
        </div>`;
    }

    const rows = sorted.map((u) => {
      const isActive = u.startDate <= now && (u.endDate === null || u.endDate >= now);
      const color = (NUCLEAR_STATUS_COLORS as Record<string, string>)[u.status] ?? '#6B7280';
      const endStr = u.endDate ? fmtDate(u.endDate) : 'Indéterminée';
      return `
        <div style="
          display:grid;grid-template-columns:1fr auto;gap:4px;
          padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.06);
          opacity:${isActive ? 1 : 0.7};
        ">
          <div>
            <div style="font-size:12px;font-weight:600;color:var(--text-primary);">${u.unitName}</div>
            <div style="font-size:10px;color:var(--text-muted);">
              ${fmtDate(u.startDate)} → ${endStr}
            </div>
            <div style="font-size:10px;color:var(--text-muted);">
              ${u.availablePowerMW} / ${u.nominalPowerMW} MW · ${u.type}
            </div>
          </div>
          <span style="
            font-size:9px;padding:2px 6px;border-radius:8px;height:fit-content;
            background:${color}22;color:${color};font-weight:700;white-space:nowrap;align-self:start;
          ">${isActive ? '● EN COURS' : '◌ PLANIFIÉ'}</span>
        </div>`;
    });

    return `${this._freshnessBadge(state.stress?.freshness ?? 'unavailable')}
      <div style="margin-top:8px;">${rows.join('')}</div>`;
  }

  // ── REMIT tab ───────────────────────────────────────────────────────────────

  private _renderRemit(state: NuclearState): string {
    if (!state.remitAvailable) return this._renderUnavailable('Flux IIP RTE indisponible.');

    const freshnessBadge = this._freshnessBadge('quasi-realtime');

    if (state.unconfirmedSignals.length === 0 && state.remitSignals.length === 0) {
      return `${freshnessBadge}
        <div style="color:var(--text-muted);font-size:12px;margin-top:8px;">
          Aucun signal REMIT nucléaire détecté.
        </div>`;
    }

    const unconfirmed = state.unconfirmedSignals.map(({ remitSignal: s, confidence }) => `
      <div style="
        background:rgba(17,24,39,0.8);border-radius:8px;padding:10px 12px;
        margin-bottom:8px;border-left:3px solid ${NUCLEAR_REMIT_UNCONFIRMED_COLOR};
      ">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
          <span style="font-size:11px;font-weight:600;color:var(--text-primary);line-height:1.4;">${s.title.slice(0, 80)}${s.title.length > 80 ? '…' : ''}</span>
          <span style="font-size:9px;padding:2px 6px;border-radius:8px;background:#11182722;
            color:#9CA3AF;font-weight:700;white-space:nowrap;flex-shrink:0;">NON CONFIRMÉ RTE</span>
        </div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:4px;">
          ${s.plantName} · ${s.classifiedAs.replace('_', ' ')}
          ${s.capacityMW ? ` · ${s.capacityMW} MW` : ''}
          · confiance ${Math.round(confidence * 100)}%
        </div>
        <div style="font-size:10px;color:var(--text-muted);">${fmtDate(s.publishedAt)}</div>
      </div>`);

    const confirmed = state.remitSignals
      .filter((s) => s.confirmedByRTE)
      .map((s) => `
        <div style="
          background:rgba(255,255,255,0.03);border-radius:8px;padding:8px 12px;
          margin-bottom:6px;border-left:3px solid #374151;
        ">
          <div style="font-size:11px;color:var(--text-primary);">${s.title.slice(0, 80)}${s.title.length > 80 ? '…' : ''}</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">
            ${s.plantName} · ${s.classifiedAs.replace('_', ' ')} · <span style="color:#6EE7B7;">✓ confirmé RTE</span>
          </div>
        </div>`);

    return `
      ${freshnessBadge}
      ${unconfirmed.length > 0 ? `
        <div style="font-size:10px;font-weight:700;color:#9CA3AF;letter-spacing:0.08em;
          text-transform:uppercase;margin:10px 0 6px;">
          Signal REMIT détecté · Non reflété RTE (${unconfirmed.length})
        </div>
        ${unconfirmed.join('')}` : ''}
      ${confirmed.length > 0 ? `
        <div style="font-size:10px;font-weight:700;color:#9CA3AF;letter-spacing:0.08em;
          text-transform:uppercase;margin:10px 0 6px;">
          Confirmés dans RTE (${confirmed.length})
        </div>
        ${confirmed.join('')}` : ''}`;
  }

  // ── STRESS tab ──────────────────────────────────────────────────────────────

  private _renderStress(state: NuclearState): string {
    const stress = state.stress;
    if (!stress) return this._renderUnavailable('Score de tension non calculé.');

    const levelColor =
      stress.level === 'CRITIQUE' ? '#E74C3C'
      : stress.level === 'TENSION' ? '#F59E0B'
      : '#2ECC71';

    const pct = Math.round(stress.stressRatio * 100);
    const gaugeWidth = Math.min(100, pct);

    return `
      ${this._freshnessBadge(stress.freshness)}
      <div style="margin-top:12px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <span style="font-size:12px;font-weight:600;color:var(--text-primary);">Score tension nucléaire</span>
          <span style="font-size:13px;font-weight:700;color:${levelColor};">${pct}%</span>
        </div>
        <div style="background:rgba(255,255,255,0.1);border-radius:4px;height:8px;overflow:hidden;">
          <div style="
            width:${gaugeWidth}%;height:100%;
            background:${levelColor};border-radius:4px;
            transition:width 0.4s ease;
          "></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:4px;">
          <span style="font-size:10px;color:var(--text-muted);">Normal</span>
          <span style="font-size:10px;color:var(--text-muted);">Tension (10%)</span>
          <span style="font-size:10px;color:var(--text-muted);">Critique (25%)</span>
        </div>
      </div>

      <div style="
        margin-top:12px;padding:10px 12px;border-radius:8px;
        background:${levelColor}15;border:1px solid ${levelColor}40;
      ">
        <div style="font-size:13px;font-weight:700;color:${levelColor};">NIVEAU : ${stress.level}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">
          ${stress.availableCapacityMW.toLocaleString('fr-FR')} MW disponibles
          / ${stress.installedCapacityMW.toLocaleString('fr-FR')} MW installés
        </div>
      </div>

      ${stress.gridTensionRisk ? `
        <div style="
          margin-top:10px;padding:8px 12px;border-radius:8px;
          background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);
        ">
          <div style="font-size:11px;font-weight:700;color:#EF4444;">⚡ GRID_TENSION_RISK</div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:2px;">
            Production nucléaire &lt; 35% du mix national · heuristique produit v1
          </div>
        </div>` : ''}

      <div style="margin-top:12px;font-size:10px;color:var(--text-muted);">
        Mise à jour : ${fmtDate(stress.updatedAt)}
      </div>`;
  }

  // ── Shared helpers ───────────────────────────────────────────────────────────

  private _renderUnavailable(msg: string): string {
    return `
      <div style="
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        min-height:80px;gap:6px;
      ">
        <span style="font-size:20px;opacity:0.4;">⚛</span>
        <span style="font-size:12px;color:var(--text-muted);text-align:center;">${msg}</span>
        <span style="
          font-size:9px;padding:2px 8px;border-radius:8px;
          background:rgba(107,114,128,0.2);color:#6B7280;font-weight:700;
        ">INDISPONIBLE</span>
      </div>`;
  }

  private _freshnessBadge(freshness: string): string {
    const label =
      freshness === 'quasi-realtime' ? 'QUASI TEMPS RÉEL'
      : freshness === 'stale' ? 'HISTORIQUE'
      : 'INDISPONIBLE';
    const color =
      freshness === 'quasi-realtime' ? '#2ECC71'
      : freshness === 'stale' ? '#F59E0B'
      : '#6B7280';
    return `<span style="
      font-size:9px;padding:2px 8px;border-radius:8px;
      background:${color}22;color:${color};font-weight:700;
    ">${label}</span>`;
  }
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtDate(d: Date): string {
  return d.toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: 0 nouvelles erreurs.

- [ ] **Step 3: Commit**

```bash
git add src/components/NuclearPanel.ts
git commit -m "feat(nuclear): add NuclearPanel UI (4 tabs: Status/Timeline/REMIT/Stress)"
```

---

## Task 8: `DeckGLMap.ts` — colorOverride + setLayerVisibility nuclear

**Files:**
- Modify: `src/components/DeckGLMap.ts`

- [ ] **Step 1: Activer `colorOverride` dans `updateInfrastructure`**

Dans `updateInfrastructure` (ligne ~10076), remplacer :
```ts
        let color = INFRA_COLORS[p.type] ?? '#8e8e93';
        const isElectricGeneration = p.type === 'nuclear' || p.type === 'thermal' || p.type === 'hydro';
        // ...
        if (p.type === 'nuclear' && p.status === 'maintenance') color = '#B7D6E7';
```
par :
```ts
        let color = p.colorOverride ?? INFRA_COLORS[p.type] ?? '#8e8e93';
        const isElectricGeneration = p.type === 'nuclear' || p.type === 'thermal' || p.type === 'hydro';
        // ...
        // colorOverride prend le dessus sur la logique de statut maintenance
        if (!p.colorOverride && p.type === 'nuclear' && p.status === 'maintenance') color = '#B7D6E7';
```

- [ ] **Step 2: Mettre à jour `setLayerVisibility` pour le layer nuclear**

Dans `setLayerVisibility` (ligne ~10805), remplacer :
```ts
    this.setVis(LYR_INFRA_VITAL_HALO, vis(layers.infrastructure));
    this.setVis(LYR_INFRA_NUCLEAR_RING, vis(layers.infrastructure));
    this.setVis(LYR_INFRA_CIRCLE, vis(layers.infrastructure));
    this.setVis(LYR_INFRA_LABEL, vis(layers.infrastructure));
```
par :
```ts
    this.setVis(LYR_INFRA_VITAL_HALO, vis(layers.infrastructure));
    this.setVis(LYR_INFRA_NUCLEAR_RING, vis(layers.nuclear ?? false));
    this.setVis(LYR_INFRA_CIRCLE, vis(layers.infrastructure || (layers.nuclear ?? false)));
    this.setVis(LYR_INFRA_LABEL, vis(layers.infrastructure || (layers.nuclear ?? false)));
```

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: 0 nouvelles erreurs.

- [ ] **Step 4: Commit**

```bash
git add src/components/DeckGLMap.ts
git commit -m "feat(nuclear): DeckGLMap - colorOverride support + nuclear layer visibility"
```

---

## Task 9: `App.ts` — wiring complet

**Files:**
- Modify: `src/App.ts`

- [ ] **Step 1: Imports**

Ajouter après la ligne `import { fetchRTEIIPIncidents } from './services/rte-iip.ts';` :

```ts
import { fetchNuclearUnavailabilities, buildNuclearColorMap } from './services/nuclear-rte.ts';
import { buildNuclearState } from './services/nuclear-correlation.ts';
import { NuclearPanel } from './components/NuclearPanel.ts';
import type { NuclearState } from './types/index.ts';
```

- [ ] **Step 2: Champs privés**

Dans la section des champs privés (vers la ligne ~908, après `private currentEcowattResponse`), ajouter :

```ts
  private currentNuclearState: NuclearState | null = null;
  private nuclearPanel: NuclearPanel | null = null;
```

- [ ] **Step 3: Légende nucléaire**

Avant la constante `LAYER_CONFIGS` (ligne ~606), ajouter :

```ts
const NUCLEAR_LEGEND: LegendCategory = {
  id: 'nuclear',
  title: 'Nucléaire — Indisponibilités RTE',
  items: [
    { id: 'nuc-available',  label: 'Disponible',          color: '#2ECC71', shape: 'circle' },
    { id: 'nuc-reduced',    label: 'Production réduite',  color: '#F59E0B', shape: 'circle' },
    { id: 'nuc-planned',    label: 'Arrêt planifié',      color: '#7B8CDE', shape: 'circle' },
    { id: 'nuc-unplanned',  label: 'Arrêt non planifié',  color: '#E74C3C', shape: 'circle' },
    { id: 'nuc-unknown',    label: 'Inconnu',             color: '#6B7280', shape: 'circle' },
    { id: 'nuc-remit',      label: 'Signal REMIT (alpha)', color: '#111827', shape: 'circle' },
  ],
  source: {
    label: 'RTE Open Data · IIP REMIT',
    year: new Date().getFullYear(),
  },
  refresh: { label: 'Cache applicatif 15 min' },
  notes: ['REMIT = signal anticipatoire non confirmé par données structurées RTE.'],
};
```

- [ ] **Step 4: DEFAULT_LAYERS** (place 1/4)

Dans `DEFAULT_LAYERS` (ligne ~94), après `oil: false,` :

```ts
  nuclear: false,
```

- [ ] **Step 5: LAYER_CONFIGS** (place 2/4)

Dans `LAYER_CONFIGS`, après le bloc `metropoles` (ligne ~714) et avant `// ─── Health Group ───` :

```ts
  {
    id: 'nuclear',
    groupId: 'energy',
    role: 'child',
    dependsOnGroup: true,
    label: 'Nucléaire (RTE)',
    legend: NUCLEAR_LEGEND,
  },
```

- [ ] **Step 6: `onLayerToggle` energyGroup sync** (place 3/4)

Dans `onLayerToggle`, la condition qui sync `energyGroup` (ligne ~1988) :

```ts
    if (key === 'energy' || key === 'gas' || key === 'oil' || key === 'infrastructure' || key === 'metropoles') {
```
→ ajouter `|| key === 'nuclear'` :
```ts
    if (key === 'energy' || key === 'gas' || key === 'oil' || key === 'infrastructure' || key === 'metropoles' || key === 'nuclear') {
```

Et la ligne qui calcule `energyGroup` :
```ts
      this.activeLayers.energyGroup =
        this.activeLayers.energy ||
        this.activeLayers.gas ||
        this.activeLayers.oil ||
        this.activeLayers.infrastructure ||
        this.activeLayers.metropoles;
```
→ ajouter `|| (this.activeLayers.nuclear ?? false)` :
```ts
      this.activeLayers.energyGroup =
        this.activeLayers.energy ||
        this.activeLayers.gas ||
        this.activeLayers.oil ||
        this.activeLayers.infrastructure ||
        this.activeLayers.metropoles ||
        (this.activeLayers.nuclear ?? false);
```

- [ ] **Step 7: Handler nuclear dans `onLayerToggle`** (place 3/4 suite)

Après le bloc `else if (key === 'oil')` (ligne ~2178), ajouter :

```ts
    } else if (key === 'nuclear') {
      if (this.activeLayers.nuclear) {
        if (!this.currentNuclearState) {
          void this.loadNuclear();
        }
        this.nuclearPanel?.show(this.currentNuclearState);
        this.layoutEnergyFloatingPanels();
      } else {
        this.nuclearPanel?.hide();
        this.layoutEnergyFloatingPanels();
      }
```

- [ ] **Step 8: `getEffectiveLayers`** (place 4/4)

`getEffectiveLayers` utilise `LAYER_CONFIGS` dynamiquement — rien à modifier si nuclear est bien dans LAYER_CONFIGS avec `role: 'child'` et `dependsOnGroup: true`. Vérifier que la logique existante couvre nuclear :

```ts
  private getEffectiveLayers(): MapLayers {
    const effective: MapLayers = { ...this.activeLayers };
    effective.traffic = ...;
    const groupsOn = new Set(LAYER_CONFIGS.filter(l => l.role === "groupMaster" && effective[l.id]).map(l => l.groupId));
    for (const config of LAYER_CONFIGS) {
      if (this.activeLayers[config.id] && config.role === 'child' && config.dependsOnGroup) {
        effective[config.id] = groupsOn.has(config.groupId);
      }
    }
    return effective;
  }
```

`nuclear` est `role: 'child'` avec `dependsOnGroup: true` dans `energyGroup` → géré automatiquement. ✓

- [ ] **Step 9: Initialiser NuclearPanel dans le constructeur / `init()`**

Dans la méthode `init()` (ou là où GasPanel est instancié), ajouter après la ligne qui crée `this.gasPanel` :

```ts
    this.nuclearPanel = new NuclearPanel(document.getElementById('app') ?? document.body);
    this.nuclearPanel.mount();
    this.nuclearPanel.setOnClose(() => {
      this.activeLayers.nuclear = false;
      this.layerPanel?.setState({ ...this.activeLayers });
      this.mapContainer?.setLayerVisibility(this.getEffectiveLayers());
    });
```

- [ ] **Step 10: Ajouter `loadNuclear()`**

Ajouter la méthode `loadNuclear()` après `loadInfrastructure()` (ligne ~3073) :

```ts
  private async loadNuclear(): Promise<void> {
    this.statusPanel?.updateSource('Nucléaire RTE', { status: 'loading', lastUpdate: null });
    try {
      const [unavailabilities, iipState] = await Promise.all([
        fetchNuclearUnavailabilities(),
        fetchRTEIIPIncidents(),
      ]);

      const nationalMix = this.currentEcowattResponse?.national;
      const nuclearState = buildNuclearState(
        unavailabilities,
        iipState,
        nationalMix ? { nuclear: nationalMix.nuclear, total: nationalMix.total } : undefined,
      );

      this.currentNuclearState = nuclearState;

      // Mise à jour panel
      if (this.activeLayers.nuclear && this.nuclearPanel?.isVisible()) {
        this.nuclearPanel.update(nuclearState);
      }

      // Mise à jour couleurs carte (NUCLEAR_PLANTS importé statiquement en tête de App.ts)
      const colorMap = buildNuclearColorMap(unavailabilities);
      const staticInfra = ALL_INFRASTRUCTURE.filter((p) => p.type !== 'nuclear');
      const enrichedNuclear = NUCLEAR_PLANTS
        .filter((p) => p.status !== 'shutdown')
        .map((p) => ({ ...p, colorOverride: colorMap[p.name] ?? '#6B7280' }));
      this.mapContainer?.updateInfrastructure([...enrichedNuclear, ...staticInfra]);

      this.statusPanel?.updateSource('Nucléaire RTE', {
        status: nuclearState.rteAvailable ? 'ok' : 'stale',
        lastUpdate: new Date(),
        detail: nuclearState.rteAvailable
          ? `RTE · ${unavailabilities.length} indisponibilités · ${nuclearState.unconfirmedSignals.length} signaux REMIT non confirmés`
          : 'API RTE indisponible',
      });
    } catch (err) {
      console.error('[App] loadNuclear failed:', err);
      this.statusPanel?.updateSource('Nucléaire RTE', { status: 'error', lastUpdate: new Date() });
    }
  }
```

**Note :** Ajouter l'import statique en tête de App.ts (avec les autres imports d'infrastructure, ligne ~40) :
```ts
import { NUCLEAR_PLANTS } from './config/infrastructure.ts';
```

- [ ] **Step 11: Refresh périodique**

Dans la méthode `startPeriodicRefresh()` ou l'équivalent (chercher `setInterval` ou le bloc de refresh périodique), ajouter le refresh nucléaire toutes les 15 min :

```ts
    setInterval(() => {
      if (this.activeLayers.nuclear) {
        void this.loadNuclear();
      }
    }, 15 * 60_000);
```

- [ ] **Step 12: Typecheck**

```bash
npm run typecheck
```
Expected: 0 erreurs.

- [ ] **Step 13: Commit**

```bash
git add src/App.ts
git commit -m "feat(nuclear): wire NuclearPanel + loadNuclear() into App.ts"
```

---

## Task 10: `LayerPanel.ts` — entrée nuclear

**Files:**
- Modify: `src/components/LayerPanel.ts`

- [ ] **Step 1: Ajouter nuclear dans `LAYER_DEFS`**

Dans le tableau `LAYER_DEFS` (ligne ~16), après la ligne `metropoles` :

```ts
  { key: 'nuclear', label: 'NUCLÉAIRE (RTE)', icon: '&#9883;', sublayerOf: 'energyGroup' },
```

*(&#9883; = ☢ en HTML entity)*

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: 0 erreurs.

- [ ] **Step 3: Commit**

```bash
git add src/components/LayerPanel.ts
git commit -m "feat(nuclear): add nuclear layer entry to LayerPanel"
```

---

## Task 11: Build final + vérification

**Files:** —

- [ ] **Step 1: Build complet**

```bash
npm run build
```
Expected: BUILD SUCCESS, 0 erreurs TypeScript, 0 erreurs Vite. Avertissements chunk size acceptables.

- [ ] **Step 2: Typecheck strict**

```bash
npm run typecheck
```
Expected: 0 erreurs.

- [ ] **Step 3: Vérification manuelle en dev**

```bash
npm run dev
```
Checklist visuelle :
- [ ] Layer "NUCLÉAIRE (RTE)" visible dans le LayerPanel sous ÉNERGIE
- [ ] Activer le layer → NuclearPanel apparaît
- [ ] Onglet STATUS : si RTE disponible, cartes centrales avec couleurs dynamiques ; sinon badge INDISPONIBLE
- [ ] Onglet TIMELINE : liste des indisponibilités chronologique
- [ ] Onglet REMIT : signaux avec badge noir "NON CONFIRMÉ RTE"
- [ ] Onglet STRESS : jauge + niveau NORMAL/TENSION/CRITIQUE
- [ ] Carte : cercles nucléaires colorés selon statut RTE (non gris statique)
- [ ] Désactiver le layer → NuclearPanel disparaît
- [ ] Si RTE_CLIENT_ID absent → badge INDISPONIBLE sans crash

- [ ] **Step 4: Commit final**

```bash
git add -A
git commit -m "feat(nuclear): complete nuclear layer - RTE Layer1 + REMIT Layer2 + correlation Layer3"
```

---

## Notes d'implémentation

**API RTE shape :** La normalisation dans `nuclear-rte.ts` est défensive (`raw.generation_unavailabilities ?? raw.unavailabilities ?? []`). Si la v4 de l'API renvoie une structure différente, ajuster `normalizeItem()` et les clés `unit.name`, `installed_capacity`, `available_capacity`.

**NUCLEAR_PLANTS import dans App.ts :** Vérifier si `NUCLEAR_PLANTS` est déjà importable via `import { NUCLEAR_PLANTS } from './config/infrastructure.ts'` (il l'est). Préférer import statique à dynamique.

**`layoutEnergyFloatingPanels` :** Vérifier que cette méthode existe dans App.ts (elle est utilisée pour gas/oil). Si elle gère la disposition des panneaux flottants, NuclearPanel s'y branche naturellement.

**MapPopup + NuclearState :** La méthode `showNuclearSite()` dans `MapPopup.ts` accepte un `NuclearSiteStats`. Si on veut enrichir les popups avec des données `NuclearUnavailability[]` réelles, passer `this.currentNuclearState?.unavailabilities` dans le wiring au click sur une centrale (dans DeckGLMap ou App.ts). C'est une amélioration optionnelle, non bloquante pour le MVP.
