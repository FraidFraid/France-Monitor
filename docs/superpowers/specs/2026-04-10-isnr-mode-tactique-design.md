# Design — ISNR Mode Tactique (Pannes + Sparklines)

**Date :** 2026-04-10  
**Statut :** Approuvé  
**Fichiers impactés :** `src/types/index.ts`, `src/services/stability-index.ts`, `src/components/ISNRPanel.ts`, `src/App.ts`

---

## Objectif

Enrichir le layer ISNR avec deux nouvelles capacités OSINT hyper-locales :

1. **Intégration des pannes Enedis/ARCEP à la composante Infra** — le score infrastructure d'un département monte jusqu'à 80 pts si des pannes électriques ou télécom significatives y sont détectées.
2. **Sparklines CSS** — chaque département affiche une mini timeline (10-12 snapshots) de son score ISNR, colorée par criticité, alimentée par le tick RSS (toutes les ~5 min).

---

## Section 1 — Types & cache histoire

### `src/types/index.ts`

Ajout d'un champ optionnel à `ISNRScore` :

```ts
export interface ISNRScore {
  // ... champs existants ...
  history?: number[];  // sliding window max 12 snapshots (scores 0-100)
}
```

### `src/services/stability-index.ts`

Le cache module-level change de type :

```ts
// avant
const previousScores: Map<string, number> = new Map();

// après
const previousScores: Map<string, number[]> = new Map();
```

`computeTrend(code, currentScore)` doit être mis à jour pour lire le dernier élément du tableau :

```ts
// avant
function computeTrend(code: string, currentScore: number): 'up' | 'down' | 'stable' {
  const prev = previousScores.get(code);
  if (prev === undefined) return 'stable';
  const diff = currentScore - prev;
  ...
}

// après
function computeTrend(code: string, currentScore: number): 'up' | 'down' | 'stable' {
  const arr = previousScores.get(code);
  if (!arr || arr.length === 0) return 'stable';
  const diff = currentScore - arr[arr.length - 1];
  ...
}
```

De même, le calcul du `momentum` (line ~448 de `stability-index.ts`) doit être mis à jour :

```ts
// avant
const prevScore = previousScores.get(code);
const momentum = prevScore !== undefined ? score - prevScore : 0;

// après
const prevArr = previousScores.get(code);
const momentum = prevArr && prevArr.length > 0 ? score - prevArr[prevArr.length - 1] : 0;
```

À la fin de chaque tick `computeISNR`, pour chaque département, **après** avoir lu `momentum` et `trend` (qui lisent l'ancien tableau) :
```ts
const prev = previousScores.get(code) ?? [];
const next = [...prev, score].slice(-12);  // append non-mutatif, fenêtre glissante
previousScores.set(code, next);
// history exposé dans ISNRScore = next (référence stable, pas de mutation)
```

---

## Section 2 — `computeInfraFromOutages()`

### Placement

`computeInfraFromOutages` est définie dans **`src/services/stability-index.ts`** (même fichier que `computeISNR`). Elle peut ainsi appeler `findDepartmentByCoords` directement — cette fonction reste privée (non exportée), aucune modification d'export requise.

Les types `TelecomOutage` et `PowerOutage` sont importés depuis `src/types/index.ts` (pas depuis `outages.ts`), ce qui évite toute dépendance circulaire (`outages.ts` → `stability-index.ts` → `types/index.ts`).

### Signature

```ts
function computeInfraFromOutages(
  deptCode: string,
  telecom: TelecomOutage[],
  power: PowerOutage[],
): { score: number; label: string; source: string } | null
```

Retourne `null` si le département n'est pas affecté.

### Scoring PowerOutage

Match sur `PowerOutage.departmentCode === deptCode`.

| Ratio offGridCount/totalPDL | Score |
|-----------------------------|-------|
| ≥ 5%                        | 50    |
| ≥ 15%                       | 70    |
| ≥ 30%                       | 80    |
| + `trend === 'worsening'`   | +10 (total plafonné à 80 — le bonus s'applique uniquement aux tiers inférieurs à 70 ; à 80, il est sans effet) |

- `topDriver.label` : `"⚠️ Blackout Zone"`
- `topDriver.source` : `"Enedis"`

### Scoring TelecomOutage

Matching en deux temps :
1. **Coordonnées** : `findDepartmentByCoords(lon, lat)` (fonction existante)
2. **Fallback** : helper privée `normalizeDepartmentName(s: string): string` — `trim + toLowerCase + suppression accents (normalize NFD + /[\u0300-\u036f]/g) + suppression tirets/apostrophes/espaces multiples` — appliquée aux deux côtés de la comparaison (`outage.department` vs chaque `DEPARTMENTS[code].name`). Les cas particuliers type "Côtes-d'Armor", "Puy-de-Dôme", "Territoire de Belfort" sont couverts par cette normalisation.

Seuils sur les sites HS dans le département :

| Condition                                                          | Score |
|--------------------------------------------------------------------|-------|
| ≥ 3 sites avec au moins un statut `'Degraded'` **ou** `'HS'`      | 50    |
| ≥ 5 sites avec au moins un statut strictement `'HS'` (voice ou data) | 65 |

Règle de progression explicite : dégradation significative (≥ 3 sites) → panne lourde (≥ 5 sites strictement HS). Les deux conditions sont mutuellement exclusives dans le code (la plus haute s'applique si remplie).

- `topDriver.label` : `"⚠️ Panne Réseau"`
- `topDriver.source` : `"ARCEP"`

### Intégration dans `computeISNR`

Le résultat s'insère dans le `Math.max` existant :

```ts
const infraFromOutages = computeInfraFromOutages(code, telecomOutages, powerOutages);
const infra = Math.round(Math.min(100, Math.max(
  infraFromEvents,
  infraFromMeteo,
  infraFromFlood,
  infraFromEcowatt,
  infraFromOutages?.score ?? 0,
)));
```

Le `topDriver` outage est prioritaire si son score est le plus élevé parmi toutes les sources infra.

### Nouvelle signature `computeISNR`

```ts
export function computeISNR(
  newsItems: NewsItem[],
  meteoAlerts: MeteoAlert[],
  floodSegments: FloodSegment[],
  ecowatt: EcowattResponse | null,
  timeRange: TimeRange,
  telecomOutages: TelecomOutage[],  // nouveau
  powerOutages: PowerOutage[],      // nouveau
): ISNRData
```

---

## Section 3 — Tick RSS & Sparkline UI

### Tick couplage (`App.ts`)

`updateISNR()` est un point d'entrée unique — mettre à jour son corps suffit à corriger tous les call sites (appel initial dans `loadAll()` et appel lazy dans `openFranceIntelPanel()`).

Dans `fetchAndProcessRSS()`, appeler `this.updateISNR()` **après** la mise à jour de `this.newsItems` et **après** le return anticipé sur `rawItems.length === 0` (comportement intentionnel : pas de nouveau snapshot si le RSS ne ramène rien).

`updateISNR()` passe les deux nouveaux arguments déjà disponibles sur la classe :

```ts
this.currentISNRData = computeISNR(
  this.newsItems,
  this.currentMeteoAlerts,
  this.currentFloodSegments,
  this.currentEcowattResponse,
  '24h',
  this.currentTelecomOutages,
  this.currentPowerOutages,
);
```

### Sparkline (`ISNRPanel.ts`)

Nouvelle fonction pure :

```ts
function renderSparkline(history: number[]): string
```

- N'est rendue que si `score.history != null && score.history.length >= 2` (champ optionnel, guard complet requis pour TypeScript strict)
- Conteneur : `<div title="Historique ISNR (${history.length} ticks)" style="display:flex;align-items:flex-end;gap:1px;height:14px;padding:3px 0">`
- Chaque barre : `width:2px`, `height: Math.max(1, (val/100)*14)px`, `background: scoreToColor(val)`, `opacity: 0.7`, `title="Tick ${i+1}: ${val}"`
- Dernière barre (point courant) : `width:3px`, `opacity:1`, `box-shadow: 0 0 3px <color>`
- Placement dans le rendu dept : entre les dim-badges et le bloc `topDriver`

---

## Contraintes

- TypeScript strict — aucun `any` non justifié
- Vanilla DOM uniquement
- Pas de lib externe (Chart.js interdit)
- `npm run build` + `npm run typecheck` doivent passer avant de marquer la tâche terminée
