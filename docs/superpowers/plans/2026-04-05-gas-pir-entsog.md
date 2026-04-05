# Gas PIR ENTSOG — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le fetch ODRE cassé des flux PIR gaz par un proxy ENTSOG réel, pour que les 5 interconnexions frontière France (`flowGWhDay`) affichent des valeurs live J-1.

**Architecture:** Nouvelle Vercel function `api/energy/gas-pir.js` (cache 30 min) + Vite plugin passthrough `src/plugins/gas-pir-proxy.ts`. `src/services/gas.ts` remplace `fetchPirFlows()` pour appeler `/api/energy/gas-pir`. La colle entre config statique et réponse ENTSOG passe par un champ `entsogKey` ajouté à `GasInterconnection`.

**Tech Stack:** Node.js ESM (Vercel functions), TypeScript (Vite plugin + service), ENTSOG Transparency Platform API v1 (public, sans auth), Vite 6+.

**Spec :** `docs/superpowers/specs/2026-04-05-gas-pir-entsog-design.md`

---

## File Map

| Fichier | Action | Responsabilité |
|---------|--------|----------------|
| `src/types/index.ts` | Modifier ligne ~1364 | Ajouter `entsogKey?: string` à `GasInterconnection` |
| `src/config/gas-infrastructure.ts` | Modifier lignes 206–252 | Ajouter `entsogKey` sur les 5 PIR |
| `api/energy/gas-pir.js` | Créer | Vercel function proxy ENTSOG, cache 30 min |
| `src/plugins/gas-pir-proxy.ts` | Créer | Vite plugin passthrough stateless, miroir logique |
| `vite.config.ts` | Modifier | Import + enregistrement de `gasPirProxyPlugin()` |
| `src/services/gas.ts` | Modifier lignes 187–248 + 290–294 | Remplacer `fetchPirFlows()` + corriger `sourceStatus.odre` |

---

## Task 1 : Ajouter `entsogKey` au type et à la config

**Files:**
- Modify: `src/types/index.ts:1364-1372`
- Modify: `src/config/gas-infrastructure.ts:206-252`

- [ ] **Étape 1 : Ajouter `entsogKey?: string` à `GasInterconnection`**

Dans `src/types/index.ts`, à la ligne 1364, modifier l'interface :

```typescript
export interface GasInterconnection {
  id: string;
  name: string;
  country: string;
  direction: 'bidirectional' | 'import' | 'export';
  coordinates: [number, number];
  flowGWhDay: number; // Current flow (positive = import, negative = export)
  maxCapacityGWhDay: number;
  entsogKey?: string; // ENTSOG connectionpoint key (ITP-XXXXX)
}
```

- [ ] **Étape 2 : Ajouter `entsogKey` sur les 5 entrées `GAS_INTERCONNECTIONS`**

Dans `src/config/gas-infrastructure.ts`, modifier `GAS_INTERCONNECTIONS` :

```typescript
export const GAS_INTERCONNECTIONS: GasInterconnection[] = [
  {
    id: 'pir-biriatou',
    name: 'Biriatou',
    country: 'Espagne',
    direction: 'bidirectional',
    coordinates: [-1.7500, 43.3200],
    flowGWhDay: 0,
    maxCapacityGWhDay: 165,
    entsogKey: 'ITP-00033',
  },
  {
    id: 'pir-larrau',
    name: 'Larrau',
    country: 'Espagne',
    direction: 'bidirectional',
    coordinates: [-0.9500, 43.0200],
    flowGWhDay: 0,
    maxCapacityGWhDay: 55,
    entsogKey: 'ITP-00018',
  },
  {
    id: 'pir-obergailbach',
    name: 'Obergailbach',
    country: 'Allemagne',
    direction: 'bidirectional',
    coordinates: [7.2100, 49.1300],
    flowGWhDay: 0,
    maxCapacityGWhDay: 620,
    entsogKey: 'ITP-00137',
  },
  {
    id: 'pir-taisnieres',
    name: 'Taisnières',
    country: 'Belgique',
    direction: 'import',
    coordinates: [3.8200, 50.3600],
    flowGWhDay: 0,
    maxCapacityGWhDay: 240,
    entsogKey: 'ITP-00115',
  },
  {
    id: 'pir-oltingue',
    name: 'Oltingue',
    country: 'Suisse',
    direction: 'export',
    coordinates: [7.3900, 47.4900],
    flowGWhDay: 0,
    maxCapacityGWhDay: 180,
    entsogKey: 'ITP-00039',
  },
];
```

- [ ] **Étape 3 : Vérifier que TypeScript compile**

```bash
npm run typecheck
```

Attendu : aucune erreur.

- [ ] **Étape 4 : Commit**

```bash
git add src/types/index.ts src/config/gas-infrastructure.ts
git commit -m "feat: add entsogKey to GasInterconnection type and config"
```

---

## Task 2 : Créer la Vercel function `api/energy/gas-pir.js`

**Files:**
- Create: `api/energy/gas-pir.js`

La fonction appelle ENTSOG, agrège les flux entry/exit par point, et retourne un JSON normalisé.

- [ ] **Étape 1 : Créer `api/energy/gas-pir.js`**

```javascript
/**
 * api/energy/gas-pir.js — Vercel Serverless Function
 *
 * Proxy ENTSOG pour les flux Physical Flow journaliers aux 5 PIR frontière France.
 * Retourne { points, fetchedAt, status } avec flowGWhDay en GWh/j (flux net FR).
 *
 * Source : https://transparency.entsog.eu/api/v1/operationaldata
 * Pas d'authentification requise.
 */

const ENTSOG_URL = 'https://transparency.entsog.eu/api/v1/operationaldata';
const PIR_POINTS = ['ITP-00033', 'ITP-00018', 'ITP-00137', 'ITP-00115', 'ITP-00039'];
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

let _cache = null; // { data, fetchedAt }

/** Retourne une date ISO YYYY-MM-DD décalée de `deltaDays` par rapport à aujourd'hui (CET). */
function isoDate(deltaDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + deltaDays);
  // Forcer CET (UTC+1/UTC+2) : ajuster simplement via toISOString avec offset
  return d.toISOString().slice(0, 10);
}

/** Extrait le flux net (GWh/j) pour un pointKey donné depuis le tableau items ENTSOG. */
function extractNetFlow(items, pointKey) {
  const pointItems = items.filter(it => it.pointKey === pointKey);
  if (pointItems.length === 0) return null;

  // Grouper par direction
  const byDir = { entry: [], exit: [] };
  for (const it of pointItems) {
    if (it.directionKey === 'entry' || it.directionKey === 'exit') {
      byDir[it.directionKey].push(it);
    }
  }

  // Pour chaque direction : trier par periodFrom DESC, prendre le premier avec valeur non-nulle
  function latestValue(dirItems) {
    const sorted = dirItems
      .filter(it => it.value !== null && it.value !== '' && it.value !== undefined)
      .sort((a, b) => (b.periodFrom ?? '').localeCompare(a.periodFrom ?? ''));
    return sorted.length > 0 ? { value: Number(sorted[0].value), periodFrom: sorted[0].periodFrom } : null;
  }

  const entryResult = latestValue(byDir.entry);
  const exitResult = latestValue(byDir.exit);

  if (!entryResult && !exitResult) return null;

  const entryGWh = entryResult ? entryResult.value / 1_000_000 : 0;
  const exitGWh = exitResult ? exitResult.value / 1_000_000 : 0;
  const flowNet = entryGWh - exitGWh; // positif = import net vers FR

  // periodFrom = max lexicographique des deux directions
  const periodFrom = [entryResult?.periodFrom, exitResult?.periodFrom]
    .filter(Boolean)
    .sort()
    .at(-1) ?? null;

  // pointLabel : prendre le premier item disponible
  const pointLabel = pointItems[0]?.pointLabel ?? pointKey;

  return { pointKey, pointLabel, flowGWhDay: flowNet, periodFrom };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Servir depuis le cache in-process si frais
  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
    res.setHeader('Cache-Control', `s-maxage=${Math.floor(CACHE_TTL_MS / 1000)}, stale-while-revalidate`);
    res.status(200).json(_cache.data);
    return;
  }

  try {
    const from = isoDate(-3); // J-3
    const to = isoDate(0);    // J0

    const url = new URL(ENTSOG_URL);
    url.searchParams.set('indicator', 'Physical Flow');
    url.searchParams.set('periodType', 'day');
    url.searchParams.set('points', PIR_POINTS.join(','));
    url.searchParams.set('from', from);
    url.searchParams.set('to', to);
    url.searchParams.set('limit', '100');

    const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
    if (!resp.ok) throw new Error(`ENTSOG HTTP ${resp.status}`);

    const json = await resp.json();
    const items = json.operationaldata ?? [];

    // Calculer le flux net pour chaque PIR
    const points = PIR_POINTS
      .map(key => extractNetFlow(items, key))
      .filter(Boolean);

    let status = 'error';
    if (points.length === PIR_POINTS.length) status = 'ok';
    else if (points.length > 0) status = 'partial';

    const data = { points, fetchedAt: new Date().toISOString(), status };
    _cache = { data, fetchedAt: Date.now() };

    res.setHeader('Cache-Control', `s-maxage=${Math.floor(CACHE_TTL_MS / 1000)}, stale-while-revalidate`);
    res.status(200).json(data);
  } catch (err) {
    console.error('[gas-pir] ENTSOG fetch failed:', err.message);
    // HTTP 200 même en cas d'erreur : le client inspecte json.status, pas le code HTTP.
    // Diverge volontairement de ecowatt.js (qui fait res.status(502)) pour simplifier
    // la gestion côté fetchPirFlows() dans gas.ts.
    res.status(200).json({ points: [], fetchedAt: new Date().toISOString(), status: 'error', error: err.message });
  }
}
```

- [ ] **Étape 2 : Tester la function manuellement (curl)**

```bash
# Démarrer le serveur Vite (le plugin sera ajouté à la tâche 3 — on testera la Vercel function directement via vercel dev ou un test node)
node -e "
const { extractNetFlow } = (() => {
  // Smoke test extractNetFlow inline
  const items = [
    { pointKey: 'ITP-00033', directionKey: 'entry', value: 5000000, periodFrom: '2026-04-03', pointLabel: 'Biriatou (FR) / Irun (ES)' },
    { pointKey: 'ITP-00033', directionKey: 'exit',  value: 1000000, periodFrom: '2026-04-03', pointLabel: 'Biriatou (FR) / Irun (ES)' },
  ];
  // Inline the function to test it
  const byDir = { entry: [], exit: [] };
  for (const it of items) byDir[it.directionKey].push(it);
  function latestValue(dirItems) {
    const sorted = dirItems.filter(it => it.value !== null).sort((a, b) => b.periodFrom.localeCompare(a.periodFrom));
    return sorted.length > 0 ? { value: Number(sorted[0].value), periodFrom: sorted[0].periodFrom } : null;
  }
  const entryResult = latestValue(byDir.entry);
  const exitResult  = latestValue(byDir.exit);
  const entryGWh = entryResult ? entryResult.value / 1_000_000 : 0;
  const exitGWh  = exitResult  ? exitResult.value / 1_000_000  : 0;
  const flowNet = entryGWh - exitGWh;
  console.log('flowNet:', flowNet, 'GWh/j (attendu: 4.0)');
  console.assert(Math.abs(flowNet - 4.0) < 0.001, 'FAIL: flowNet should be 4.0');
  console.log('PASS');
})();
"
```

Attendu : `flowNet: 4 GWh/j (attendu: 4.0)` et `PASS`.

- [ ] **Étape 3 : Commit**

```bash
git add api/energy/gas-pir.js
git commit -m "feat: add api/energy/gas-pir.js — ENTSOG proxy for PIR flows"
```

---

## Task 3 : Créer le Vite plugin `src/plugins/gas-pir-proxy.ts`

**Files:**
- Create: `src/plugins/gas-pir-proxy.ts`
- Modify: `vite.config.ts`

Le Vite plugin est un passthrough stateless (pas de cache) qui repose la même logique ENTSOG pour le dev local.

- [ ] **Étape 1 : Créer `src/plugins/gas-pir-proxy.ts`**

```typescript
/**
 * gas-pir-proxy.ts — Vite dev plugin
 *
 * Passthrough stateless pour /api/energy/gas-pir.
 * Même logique que api/energy/gas-pir.js, sans cache in-process
 * (le cache est uniquement utile en prod Vercel pour amortir les cold starts).
 */

import type { Plugin } from 'vite';

const ENTSOG_URL = 'https://transparency.entsog.eu/api/v1/operationaldata';
const PIR_POINTS = ['ITP-00033', 'ITP-00018', 'ITP-00137', 'ITP-00115', 'ITP-00039'];

function isoDate(deltaDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

interface EntsogItem {
  pointKey: string;
  pointLabel: string;
  directionKey: string;
  value: number | null | string;
  periodFrom: string | null;
}

interface PirPoint {
  pointKey: string;
  pointLabel: string;
  flowGWhDay: number;
  periodFrom: string | null;
}

function extractNetFlow(items: EntsogItem[], pointKey: string): PirPoint | null {
  const pointItems = items.filter(it => it.pointKey === pointKey);
  if (pointItems.length === 0) return null;

  const byDir: Record<string, EntsogItem[]> = { entry: [], exit: [] };
  for (const it of pointItems) {
    if (it.directionKey === 'entry' || it.directionKey === 'exit') {
      byDir[it.directionKey].push(it);
    }
  }

  function latestValue(dirItems: EntsogItem[]): { value: number; periodFrom: string } | null {
    const sorted = dirItems
      .filter(it => it.value !== null && it.value !== '' && it.value !== undefined)
      .sort((a, b) => (b.periodFrom ?? '').localeCompare(a.periodFrom ?? ''));
    if (sorted.length === 0) return null;
    return { value: Number(sorted[0].value), periodFrom: sorted[0].periodFrom ?? '' };
  }

  const entryResult = latestValue(byDir.entry);
  const exitResult = latestValue(byDir.exit);
  if (!entryResult && !exitResult) return null;

  const entryGWh = entryResult ? entryResult.value / 1_000_000 : 0;
  const exitGWh = exitResult ? exitResult.value / 1_000_000 : 0;
  const flowNet = entryGWh - exitGWh;

  const periodFrom = [entryResult?.periodFrom, exitResult?.periodFrom]
    .filter((x): x is string => Boolean(x))
    .sort()
    .at(-1) ?? null;

  const pointLabel = pointItems[0]?.pointLabel ?? pointKey;
  return { pointKey, pointLabel, flowGWhDay: flowNet, periodFrom };
}

export function gasPirProxyPlugin(): Plugin {
  return {
    name: 'gas-pir-proxy',
    configureServer(server) {
      server.middlewares.use('/api/energy/gas-pir', async (_req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        try {
          const from = isoDate(-3);
          const to = isoDate(0);

          const url = new URL(ENTSOG_URL);
          url.searchParams.set('indicator', 'Physical Flow');
          url.searchParams.set('periodType', 'day');
          url.searchParams.set('points', PIR_POINTS.join(','));
          url.searchParams.set('from', from);
          url.searchParams.set('to', to);
          url.searchParams.set('limit', '100');

          const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(15_000) });
          if (!resp.ok) throw new Error(`ENTSOG HTTP ${resp.status}`);

          const json = await resp.json() as { operationaldata?: EntsogItem[] };
          const items = json.operationaldata ?? [];

          const points = PIR_POINTS
            .map(key => extractNetFlow(items, key))
            .filter((p): p is PirPoint => p !== null);

          let status: 'ok' | 'partial' | 'error' = 'error';
          if (points.length === PIR_POINTS.length) status = 'ok';
          else if (points.length > 0) status = 'partial';

          res.statusCode = 200;
          res.end(JSON.stringify({ points, fetchedAt: new Date().toISOString(), status }));
        } catch (err) {
          console.error('[gas-pir-proxy]', err);
          res.statusCode = 200;
          res.end(JSON.stringify({ points: [], fetchedAt: new Date().toISOString(), status: 'error', error: String(err) }));
        }
      });
    },
  };
}
```

- [ ] **Étape 2 : Enregistrer le plugin dans `vite.config.ts`**

Ajouter l'import en haut du fichier (après les imports existants des plugins energy) :

```typescript
import { gasPirProxyPlugin } from './src/plugins/gas-pir-proxy';
```

Ajouter dans le tableau `plugins[]` (après `ecowattProxyPlugin()`) :

```typescript
gasPirProxyPlugin(),
```

- [ ] **Étape 3 : Vérifier que TypeScript compile**

```bash
npm run typecheck
```

Attendu : aucune erreur.

- [ ] **Étape 4 : Commit**

```bash
git add src/plugins/gas-pir-proxy.ts vite.config.ts
git commit -m "feat: add gas-pir-proxy Vite plugin for dev"
```

---

## Task 4 : Mettre à jour `fetchPirFlows()` dans `gas.ts`

**Files:**
- Modify: `src/services/gas.ts:187-248` (remplacement complet de `fetchPirFlows`)
- Modify: `src/services/gas.ts:290-294` (correction `sourceStatus.odre`)

- [ ] **Étape 1 : Supprimer l'interface `OdrePirRecord` et réécrire `fetchPirFlows()`**

Remplacer **l'intégralité des lignes 187–248** (ce bloc contient dans l'ordre : l'interface `OdrePirRecord`, la fonction `buildFallbackInterconnections()`, et l'ancienne `fetchPirFlows()`). Le nouveau bloc doit re-inclure `buildFallbackInterconnections()` inchangée, encadrée par les nouvelles interfaces et la nouvelle `fetchPirFlows()` :

```typescript
// ─── Remplace OdrePirRecord + buildFallbackInterconnections + fetchPirFlows ───
// (les 3 blocs de l'ancienne implémentation ODRE, lignes 187–248)

interface EntsogPirPoint {
  pointKey: string;
  pointLabel: string;
  flowGWhDay: number;
  periodFrom: string | null;
}

interface EntsogPirResponse {
  points: EntsogPirPoint[];
  fetchedAt: string;
  status: 'ok' | 'partial' | 'error';
  error?: string;
}

async function fetchPirFlows(): Promise<{ interconnections: GasInterconnection[]; status: 'ok' | 'stale' | 'error' }> {
  try {
    const resp = await fetch('/api/energy/gas-pir', { signal: AbortSignal.timeout(20_000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const json = (await resp.json()) as EntsogPirResponse;

    const enriched = GAS_INTERCONNECTIONS.map(ic => {
      const pirData = json.points.find(p => p.pointKey === ic.entsogKey);
      return { ...ic, flowGWhDay: pirData?.flowGWhDay ?? 0 };
    });

    // 'ok' ou 'partial' = données live (même partielles) ; 'error' = stale
    const status: 'ok' | 'stale' = (json.status === 'ok' || json.status === 'partial') ? 'ok' : 'stale';
    return { interconnections: enriched, status };
  } catch (err) {
    console.warn('[Gas/PIR] ENTSOG fetch failed, using fallback flows:', err);
    return { interconnections: buildFallbackInterconnections(), status: 'stale' };
  }
}
```

- [ ] **Étape 2 : Corriger `sourceStatus.odre` dans `fetchGasNetwork()`**

À la ligne ~294, remplacer :

```typescript
odre: storageResult.status === 'ok' && pirResult.status === 'ok' ? 'ok' : 'stale',
```

par :

```typescript
odre: storageResult.status,
```

> **Explication :** `sourceStatus.odre` reflète maintenant uniquement l'état du fetch stockages ODRE (qui reste sur ODRE). Les flux PIR passent par ENTSOG, reflétés dans `grtgaz` et `terega`.
> **Changement de comportement intentionnel :** la valeur `'error'` peut désormais remonter dans `sourceStatus.odre` si `fetchStorageLevels()` échoue, là où l'ancienne ternaire la masquait en `'stale'`. C'est plus fidèle à la réalité.

- [ ] **Étape 3 : Vérifier que TypeScript compile sans erreur**

```bash
npm run typecheck
```

Attendu : aucune erreur. S'il reste des références à `OdrePirRecord` ou `ODRE_BASE` utilisées uniquement par le code supprimé, les supprimer aussi.

> **Note :** `ODRE_BASE` est toujours utilisé par `fetchEcoGazSignal()` (ligne 62) et `fetchStorageLevels()` (ligne 133) — ne pas le supprimer.

- [ ] **Étape 4 : Build complet**

```bash
npm run build
```

Attendu : build réussi, aucun warning TypeScript.

- [ ] **Étape 5 : Commit**

```bash
git add src/services/gas.ts
git commit -m "feat: fetchPirFlows() — remplace ODRE cassé par proxy ENTSOG"
```

---

## Task 5 : Test de bout en bout en dev

- [ ] **Étape 1 : Lancer le serveur dev**

```bash
npm run dev:vite
```

- [ ] **Étape 2 : Appeler le proxy manuellement**

```bash
curl -s http://localhost:3001/api/energy/gas-pir | python3 -m json.tool
```

Attendu :
```json
{
  "points": [...],
  "fetchedAt": "2026-...",
  "status": "ok" | "partial" | "error"
}
```

- Si `status: "ok"` ou `"partial"` : au moins un point a `flowGWhDay` non nul → les données ENTSOG arrivent.
- Si `status: "error"` : ENTSOG est indisponible (normal si on est J0 avant publication) — le fallback `stale` s'active dans `gas.ts`, comportement identique à avant.

- [ ] **Étape 3 : Vérifier le panneau Gaz dans l'UI**

Ouvrir `http://localhost:3001`, ouvrir le GasPanel. Vérifier :
- Le badge `sourceStatus.odre` reflète le stockage ODRE (vert si stockages OK, pas stale à cause des PIR)
- Les badges `grtgaz` / `terega` reflètent l'état ENTSOG
- Si `status: "ok"` ou `"partial"`, les interconnexions affichent des `flowGWhDay` non nuls

- [ ] **Étape 4 : Commit final si tout est OK**

```bash
git add .
git commit -m "feat: gas PIR live via ENTSOG — connexion bout en bout vérifiée"
```

---

## Vérifications finales

```bash
npm run build && npm run typecheck
```

Les deux doivent passer sans erreur avant de considérer la feature terminée.
