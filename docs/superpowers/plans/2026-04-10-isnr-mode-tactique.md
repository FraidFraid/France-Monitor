# ISNR Mode Tactique Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrichir l'ISNR avec le scoring des pannes Enedis/ARCEP dans la composante Infra, et afficher une sparkline CSS de l'historique (10-12 ticks) par département.

**Architecture:** Toutes les modifications restent dans les 4 fichiers existants — aucun fichier créé. Le service `stability-index.ts` reçoit la logique de scoring outage et la gestion de l'historique ; `ISNRPanel.ts` reçoit la fonction de rendu sparkline ; `App.ts` cable le tick RSS et passe les nouveaux arguments ; `types/index.ts` étend `ISNRScore`. Pas de test runner disponible — `npm run typecheck` + `npm run build` sont les gates qualité.

**Tech Stack:** TypeScript strict, Vanilla DOM, Vite 6+. Pas de lib externe.

**Spec de référence:** `docs/superpowers/specs/2026-04-10-isnr-mode-tactique-design.md`

---

## File Map

| Fichier | Modification |
|---------|-------------|
| `src/types/index.ts` | Ajouter `history?: number[]` à `ISNRScore` |
| `src/services/stability-index.ts` | Import types, refactor `previousScores`, update `computeTrend` + `momentum`, ajouter `normalizeDepartmentName` + `computeInfraFromOutages`, mettre à jour `computeISNR` (signature + boucle + history write) |
| `src/App.ts` | Mettre à jour `updateISNR()` (2 nouveaux args) + appel dans `fetchAndProcessRSS()` |
| `src/components/ISNRPanel.ts` | Ajouter `renderSparkline()` + injection dans le rendu dept |

---

## Task 1: ISNRScore — champ history

**Files:**
- Modify: `src/types/index.ts` (interface `ISNRScore`, ligne ~1137)

- [ ] **Step 1: Ajouter `history?: number[]` à `ISNRScore`**

Dans `src/types/index.ts`, trouver l'interface `ISNRScore` (~ligne 1137) et ajouter le champ après `lastUpdate`:

```ts
export interface ISNRScore {
  code: string;
  name: string;
  score: number;
  status: 'stable' | 'elevated' | 'critical';
  dimensions: ISNRDimensionScores;
  trend: 'up' | 'down' | 'stable';
  momentum?: number;
  topDriver?: {
    dimension: keyof ISNRDimensionScores;
    label: string;
    score: number;
    source: string;
  };
  eventCount: number;
  lastUpdate: Date;
  history?: number[];  // sliding window max 12 snapshots (scores 0-100)
}
```

- [ ] **Step 2: Vérifier typecheck**

```bash
npm run typecheck
```

Attendu : aucune erreur.

- [ ] **Step 3: Commit**

```bash
git add src/types/index.ts
git commit -m "feat(isnr): add history sliding window to ISNRScore type"
```

---

## Task 2: Refactor `previousScores` + `computeTrend` + `momentum`

**Files:**
- Modify: `src/services/stability-index.ts` (lignes ~220, ~248-255, ~446-451)

- [ ] **Step 1: Changer le type de `previousScores` (ligne ~220)**

```ts
// avant
const previousScores: Map<string, number> = new Map();

// après
const previousScores: Map<string, number[]> = new Map();
```

- [ ] **Step 2: Mettre à jour `computeTrend` (ligne ~248)**

Remplacer le corps de la fonction :

```ts
function computeTrend(code: string, currentScore: number): 'up' | 'down' | 'stable' {
  const arr = previousScores.get(code);
  if (!arr || arr.length === 0) return 'stable';
  const diff = currentScore - arr[arr.length - 1];
  if (diff > 5) return 'up';
  if (diff < -5) return 'down';
  return 'stable';
}
```

- [ ] **Step 3: Mettre à jour `momentum` et le write dans la boucle `computeISNR` (lignes ~446-451)**

Remplacer le bloc existant (entre `const trend = computeTrend(...)` et `scores.push(...)`) :

```ts
const trend = computeTrend(code, score);
const prevArr = previousScores.get(code);
const momentum = prevArr && prevArr.length > 0 ? score - prevArr[prevArr.length - 1] : 0;

// Stocker pour la prochaine comparaison (append non-mutatif, fenêtre glissante de 12)
const next = [...(prevArr ?? []), score].slice(-12);
previousScores.set(code, next);
```

Puis dans `scores.push({...})` (ligne ~453), ajouter le champ `history` juste avant la fermeture `}` :

```ts
scores.push({
  code,
  name: dept.name,
  score,
  status,
  dimensions: { social, security, infra, velocity },
  trend,
  momentum,
  topDriver: topDriver as any,
  eventCount: items.length,
  lastUpdate: now,
  history: next,   // ← nouveau
});
```

- [ ] **Step 4: Vérifier typecheck**

```bash
npm run typecheck
```

Attendu : aucune erreur. Si TypeScript signale que `history` n'est pas dans `ISNRScore`, vérifier que Task 1 est bien commité.

- [ ] **Step 5: Commit**

```bash
git add src/services/stability-index.ts
git commit -m "feat(isnr): refactor previousScores to Map<string, number[]>, add history write"
```

---

## Task 3: `normalizeDepartmentName` + `computeInfraFromOutages`

**Files:**
- Modify: `src/services/stability-index.ts` (importer les types + ajouter 2 fonctions avant `computeISNR`)

- [ ] **Step 1: Ajouter `TelecomOutage` et `PowerOutage` aux imports (ligne ~8)**

```ts
import type {
  NewsItem,
  MeteoAlert,
  FloodSegment,
  EcowattResponse,
  TimeRange,
  ThreatLevel,
  EventCategory,
  ISNRData,
  ISNRScore,
  TelecomOutage,   // ← nouveau
  PowerOutage,     // ← nouveau
} from '../types/index.ts';
```

- [ ] **Step 2: Ajouter `normalizeDepartmentName` juste avant `computeISNR` (~ligne 364)**

```ts
// ═══ Normalisation nom département (pour matching ARCEP fallback) ═══

function normalizeDepartmentName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
```

- [ ] **Step 3: Ajouter `computeInfraFromOutages` juste après `normalizeDepartmentName`**

```ts
// ═══ Scoring pannes Enedis/ARCEP → composante Infra ═══

function computeInfraFromOutages(
  deptCode: string,
  telecom: TelecomOutage[],
  power: PowerOutage[],
): { score: number; label: string; source: string } | null {
  let bestScore = 0;
  let bestLabel = '';
  let bestSource = '';

  // ── PowerOutage (Enedis) ──
  const po = power.find(p => p.departmentCode === deptCode);
  if (po && po.totalPDL > 0) {
    const ratio = po.offGridCount / po.totalPDL;
    let poScore = 0;
    if (ratio >= 0.30) poScore = 80;
    else if (ratio >= 0.15) poScore = 70;
    else if (ratio >= 0.05) poScore = 50;

    if (poScore > 0 && po.trend === 'worsening') {
      poScore = Math.min(80, poScore + 10);
    }

    if (poScore > bestScore) {
      bestScore = poScore;
      bestLabel = '⚠️ Blackout Zone';
      bestSource = 'Enedis';
    }
  }

  // ── TelecomOutage (ARCEP) ──
  const deptNorm = normalizeDepartmentName(DEPARTMENTS[deptCode]?.name ?? '');

  const sitesByDept = telecom.filter(t => {
    // 1. Matching par coordonnées (primaire)
    if (t.coordinates[0] !== 0 || t.coordinates[1] !== 0) {
      const resolved = findDepartmentByCoords(t.coordinates[0], t.coordinates[1]);
      if (resolved !== null) return resolved === deptCode;
    }
    // 2. Fallback : matching normalisé sur le nom du département
    return normalizeDepartmentName(t.department) === deptNorm;
  });

  const hsCount = sitesByDept.filter(
    t => t.voiceStatus === 'HS' || t.dataStatus === 'HS',
  ).length;
  const degradedOrHsCount = sitesByDept.filter(
    t => t.voiceStatus !== 'OK' || t.dataStatus !== 'OK',
  ).length;

  let telecomScore = 0;
  if (hsCount >= 5) telecomScore = 65;
  else if (degradedOrHsCount >= 3) telecomScore = 50;

  if (telecomScore > bestScore) {
    bestScore = telecomScore;
    bestLabel = '⚠️ Panne Réseau';
    bestSource = 'ARCEP';
  }

  if (bestScore === 0) return null;
  return { score: bestScore, label: bestLabel, source: bestSource };
}
```

- [ ] **Step 4: Vérifier typecheck**

```bash
npm run typecheck
```

Attendu : aucune erreur. Si `findDepartmentByCoords` est marqué inaccessible, vérifier que les deux fonctions sont bien dans le même fichier (`stability-index.ts`).

- [ ] **Step 5: Commit**

```bash
git add src/services/stability-index.ts
git commit -m "feat(isnr): add normalizeDepartmentName + computeInfraFromOutages (Enedis/ARCEP)"
```

---

## Task 4: Mettre à jour `computeISNR` — signature + boucle infra + topDriver outage

**Files:**
- Modify: `src/services/stability-index.ts` (signature ~ligne 366, boucle ~lignes 394-423)

- [ ] **Step 1: Mettre à jour la signature de `computeISNR`**

```ts
export function computeISNR(
  newsItems: NewsItem[],
  meteoAlerts: MeteoAlert[],
  floodSegments: FloodSegment[],
  ecowatt: EcowattResponse | null,
  timeRange: TimeRange,
  telecomOutages: TelecomOutage[],   // ← nouveau
  powerOutages: PowerOutage[],       // ← nouveau
): ISNRData {
```

- [ ] **Step 2: Intégrer `computeInfraFromOutages` dans la boucle infra (lignes ~394-399)**

Remplacer :
```ts
// Infra = max(météo, crues, ecowatt) + events infra
const infraFromEvents = computeDimensionScore(items, INFRA_CATEGORIES);
const infraFromMeteo = computeInfraFromMeteo(meteoAlerts, code);
const infraFromFlood = computeInfraFromFloods(floodSegments);
const infraFromEcowatt = computeInfraFromEcowatt(ecowatt, code);
const infra = Math.round(Math.min(100, Math.max(infraFromEvents, infraFromMeteo, infraFromFlood, infraFromEcowatt)));
```

Par :
```ts
// Infra = max(météo, crues, ecowatt, pannes) + events infra
const infraFromEvents = computeDimensionScore(items, INFRA_CATEGORIES);
const infraFromMeteo = computeInfraFromMeteo(meteoAlerts, code);
const infraFromFlood = computeInfraFromFloods(floodSegments);
const infraFromEcowatt = computeInfraFromEcowatt(ecowatt, code);
const infraFromOutages = computeInfraFromOutages(code, telecomOutages, powerOutages);
const infra = Math.round(Math.min(100, Math.max(
  infraFromEvents, infraFromMeteo, infraFromFlood, infraFromEcowatt,
  infraFromOutages?.score ?? 0,
)));
```

- [ ] **Step 3: Mettre à jour le bloc `topDriver` infra (lignes ~408-415)**

Remplacer :
```ts
if (maxDimScore === infra) {
  let source = 'Infrastructures';
  let label = 'Tension Infrastructure';
  if (infra === infraFromMeteo) { source = 'Météo France'; label = 'Alerte Météo'; }
  else if (infra === infraFromEcowatt) { source = 'Ecowatt'; label = 'Tension Électrique'; }
  else if (infra === infraFromFlood) { source = 'Vigicrues'; label = 'Risque Crues'; }
  else if (infra === infraFromEvents) { source = 'Signal Réseau'; label = 'Incidents Infra'; }
  topDriver = { dimension: 'infra', label, score: infra, source };
}
```

Par :
```ts
if (maxDimScore === infra) {
  let source = 'Infrastructures';
  let label = 'Tension Infrastructure';
  // Priorité : pannes > météo > ecowatt > crues > events réseau
  if (infraFromOutages && infra === infraFromOutages.score) {
    source = infraFromOutages.source;
    label = infraFromOutages.label;
  } else if (infra === infraFromMeteo) { source = 'Météo France'; label = 'Alerte Météo'; }
  else if (infra === infraFromEcowatt) { source = 'Ecowatt'; label = 'Tension Électrique'; }
  else if (infra === infraFromFlood) { source = 'Vigicrues'; label = 'Risque Crues'; }
  else if (infra === infraFromEvents) { source = 'Signal Réseau'; label = 'Incidents Infra'; }
  topDriver = { dimension: 'infra', label, score: infra, source };
}
```

- [ ] **Step 4: Vérifier typecheck**

```bash
npm run typecheck
```

Attendu : erreur sur les call sites de `computeISNR` dans `App.ts` (2 args manquants) — c'est normal, on les fixe en Task 5.

- [ ] **Step 5: Commit**

```bash
git add src/services/stability-index.ts
git commit -m "feat(isnr): integrate outage scoring into computeISNR (Enedis/ARCEP → Infra dimension)"
```

---

## Task 5: App.ts — câblage `updateISNR` + tick RSS

**Files:**
- Modify: `src/App.ts` (`updateISNR()` ~ligne 5101, `fetchAndProcessRSS()` ~ligne 3346)

- [ ] **Step 1: Mettre à jour le corps de `updateISNR()`**

Dans `App.ts`, trouver la méthode `updateISNR()` (~ligne 5101) et passer les deux nouveaux arguments :

```ts
private updateISNR(): void {
  this.currentISNRData = computeISNR(
    this.newsItems,
    this.currentMeteoAlerts,
    this.currentFloodSegments,
    this.currentEcowattResponse,
    '24h',
    this.currentTelecomOutages,   // ← nouveau
    this.currentPowerOutages,     // ← nouveau
  );

  // Update map layer
  this.mapContainer?.updateISNR(this.currentISNRData.scores);

  // Update ISNR panel if visible
  if (this.isnrPanel?.isVisible()) {
    this.isnrPanel.show(this.currentISNRData);
  }

  this.refreshFranceIntelPanel();   // ← présent dans le corps original, à conserver
}
```

- [ ] **Step 2: Ajouter l'appel `updateISNR` dans `fetchAndProcessRSS()` (~ligne 3347)**

Après `this.refreshFranceIntelPanel()` et **avant** le bloc `augmentItemsInBackground`, ajouter :

```ts
// Snapshot ISNR sur chaque tick RSS (alimente l'historique sparkline)
this.updateISNR();
```

Le code final de la section doit ressembler à :

```ts
this.mapContainer?.updateNews(this.newsItems);
this.newsPanel?.updateItems(this.newsItems);
this.searchModal?.updateNewsItems(this.newsItems);
this.statusPanel?.updateSource('RSS PQR', { status: 'ok', lastUpdate: new Date() });
this.refreshFranceIntelPanel();

// Snapshot ISNR sur chaque tick RSS (alimente l'historique sparkline)
this.updateISNR();

// 2. Background processing for AI & Geocoding
this.augmentItemsInBackground([...this.newsItems]);
```

- [ ] **Step 3: Vérifier typecheck**

```bash
npm run typecheck
```

Attendu : aucune erreur.

- [ ] **Step 4: Commit**

```bash
git add src/App.ts
git commit -m "feat(isnr): wire outage args to updateISNR + call on each RSS tick"
```

---

## Task 6: ISNRPanel — `renderSparkline`

**Files:**
- Modify: `src/components/ISNRPanel.ts` (ajouter fonction + injection dans le rendu dept)

- [ ] **Step 1: Ajouter `renderSparkline` juste après `renderDimBadge` (~ligne 47)**

```ts
function renderSparkline(history: number[]): string {
  const bars = history.map((val, i) => {
    const color = scoreToColor(val);
    const h = Math.max(1, Math.round((val / 100) * 14));
    const isLast = i === history.length - 1;
    return `<div title="Tick ${i + 1}: ${val}" style="` +
      `width:${isLast ? 3 : 2}px;` +
      `height:${h}px;` +
      `background:${color};` +
      `border-radius:1px;` +
      `opacity:${isLast ? 1 : 0.7};` +
      `${isLast ? `box-shadow:0 0 3px ${color};` : ''}` +
      `flex-shrink:0;` +
      `"></div>`;
  }).join('');
  return `<div title="Historique ISNR (${history.length} ticks)" ` +
    `style="display:flex;align-items:flex-end;gap:1px;height:14px;padding:3px 0;margin-top:4px;">` +
    `${bars}</div>`;
}
```

- [ ] **Step 2: Injecter la sparkline dans le rendu dept (méthode `show()`, dans la boucle `for (const dept of topDepts)`)**

Trouver le bloc qui rend les dim-badges :
```ts
<div style="display: flex; gap: 4px; flex-wrap: wrap;">
  ${renderDimBadge('Soc', dept.dimensions.social)}
  ...
</div>
```

Ajouter la sparkline juste après ce `</div>` de dim-badges, avant le bloc `topDriver` :

```ts
<div style="display: flex; gap: 4px; flex-wrap: wrap;">
  ${renderDimBadge('Soc', dept.dimensions.social)}
  ${renderDimBadge('Sec', dept.dimensions.security)}
  ${renderDimBadge('Inf', dept.dimensions.infra)}
  ${renderDimBadge('Vel', dept.dimensions.velocity)}
</div>
${dept.history != null && dept.history.length >= 2 ? renderSparkline(dept.history) : ''}
${dept.topDriver ? `
  <div style="font-size: 11px; ...">
```

- [ ] **Step 3: Vérifier typecheck**

```bash
npm run typecheck
```

Attendu : aucune erreur.

- [ ] **Step 4: Commit**

```bash
git add src/components/ISNRPanel.ts
git commit -m "feat(isnr): add CSS sparkline (history bars) to department rows in ISNRPanel"
```

---

## Task 7: Build final + vérification visuelle

**Files:** Aucun

- [ ] **Step 1: Build complet**

```bash
npm run build
```

Attendu : build sans erreurs TypeScript ni Vite.

- [ ] **Step 2: Typecheck clean**

```bash
npm run typecheck
```

Attendu : 0 erreurs.

- [ ] **Step 3: Smoke test en dev**

```bash
npm run dev:vite
```

Ouvrir le dashboard, activer le layer "Stabilité" (ISNR). Vérifier :
- Le panel ISNR s'ouvre sans erreur console
- Au premier chargement : aucune sparkline (1 seul snapshot — comportement attendu)
- Après un second tick RSS (~5 min, ou forcer via `this.updateISNR()` en console) : sparklines visibles
- Pour forcer un second tick sans attendre 5 min : activer puis désactiver rapidement le layer "Stabilité" (ce qui appelle `updateISNR()` via `openFranceIntelPanel`) ou recharger la page après un premier affichage du panel
- Si des `PowerOutage` ou `TelecomOutage` existent dans les données chargées : vérifier que le `topDriver` affiche "⚠️ Blackout Zone" / "⚠️ Panne Réseau" avec la bonne source

- [ ] **Step 4: Commit final si tout est clean**

```bash
git add -A
git commit -m "feat(isnr): Mode Tactique — outage scoring + CSS sparklines (Enedis/ARCEP)"
```
