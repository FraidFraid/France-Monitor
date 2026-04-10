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

`computeTrend(code, currentScore)` lit `arr[arr.length - 1]` (avant-dernier) au lieu d'un scalaire — comportement identique.

À la fin de chaque tick `computeISNR`, pour chaque département :
```ts
const arr = previousScores.get(code) ?? [];
arr.push(score);
if (arr.length > 12) arr.shift();
previousScores.set(code, arr);
// history exposé dans ISNRScore = [...arr]
```

---

## Section 2 — `computeInfraFromOutages()`

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
| + `trend === 'worsening'`   | +10 (plafonné à 80) |

- `topDriver.label` : `"⚠️ Blackout Zone"`
- `topDriver.source` : `"Enedis"`

### Scoring TelecomOutage

Matching en deux temps :
1. **Coordonnées** : `findDepartmentByCoords(lon, lat)` (fonction existante)
2. **Fallback** : comparaison normalisée `department.toLowerCase()` vs noms de `DEPARTMENTS`

Seuils sur les sites HS dans le département :

| Condition                                  | Score |
|--------------------------------------------|-------|
| ≥ 3 sites HS (voice ou data dégradé)       | 50    |
| ≥ 5 sites avec `voiceStatus/dataStatus: 'HS'` | 65 |

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

Dans `fetchAndProcessRSS()`, après la mise à jour de `this.newsItems`, appeler `this.updateISNR()`.

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

- N'est rendue que si `history.length >= 2`
- Conteneur : `<div style="display:flex;align-items:flex-end;gap:1px;height:14px;padding:3px 0">`
- Chaque barre : `width:2px`, `height: Math.max(1, (val/100)*14)px`, `background: scoreToColor(val)`, `opacity: 0.7`
- Dernière barre (point courant) : `width:3px`, `opacity:1`, `box-shadow: 0 0 3px <color>`
- Placement dans le rendu dept : entre les dim-badges et le bloc `topDriver`

---

## Contraintes

- TypeScript strict — aucun `any` non justifié
- Vanilla DOM uniquement
- Pas de lib externe (Chart.js interdit)
- `npm run build` + `npm run typecheck` doivent passer avant de marquer la tâche terminée
