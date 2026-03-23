# Design — Baromètre Pannes Réseau France

**Date:** 2026-03-23
**Status:** Approved (rev 2 — post spec-review)
**Author:** Claude Code (brainstorming session)

---

## 1. Objectif

Ajouter un widget HUD permanent en haut à gauche de la carte qui affiche un score composite 0–100 de l'état de santé des infrastructures réseau françaises. Score 100 = tout nominal. Toujours visible, jamais masqué.

---

## 2. Architecture (Option A — Service + Widget standalone)

```
Existing services (caches indépendants)
  ecowatt.ts          → fetchEcowatt()          → EcowattResponse
  internet-outages.ts → fetchNetworkOutages()   → NetworkOutageState
  outages.ts          → fetchTelecomOutages()   → TelecomOutage[]
  space-weather.ts    → fetchSpaceWeather()     → SpaceWeatherData
  cyber.ts            → fetchCyberDashboard()   → CyberState

         ↓ reads cached data only (no new fetches)

src/services/network-barometer.ts
  → fetchNetworkBarometer()     ← public export, appelé par App.ts
  → calculateGlobalScore()      ← interne
  → NetworkBarometerResult      ← type exporté

         ↓ update(result)

src/components/BarometerWidget.ts
  → SVG arc + score + label (toujours visible, position fixed)
  → tooltip détaillé au hover
  → destroy()                   ← nettoyage des event listeners

         ↓ mount / 5-min setInterval

src/App.ts
```

---

## 3. Service — `src/services/network-barometer.ts`

### 3.1 Types exportés

```ts
export interface NetworkBarometerResult {
  score: number;                           // 0-100, 100 = fully nominal
  status: 'nominal' | 'degraded' | 'critical';
  details: Record<string, number | null>;  // scores par source (null = indisponible)
  computedAt: Date;
}
```

Seuils de statut : `score >= 85` → `nominal`, `60–84` → `degraded`, `< 60` → `critical`.

### 3.2 Fonction exportée principale

```ts
export async function fetchNetworkBarometer(): Promise<NetworkBarometerResult>
```

Cette fonction :
1. Appelle chaque service upstream dans un `try/catch` individuel (échec partiel → `null` pour cette source)
2. Normalise chaque résultat brut en score 0-100
3. Calcule le score global via `calculateGlobalScore()`
4. Met en cache le résultat 5 min (cache interne module-level)
5. En cas d'échec total → retourne dernier cache, ou score neutre `{ score: 75, status: 'degraded' }`

**Fiabilité minimale :** si `activeWeights < 30` (moins de 30% des poids disponibles), ajouter `reliable: false` au résultat (champ optionnel — non affiché dans le widget mais utile pour debug).

### 3.3 Pondérations

```ts
const WEIGHTS = {
  elec:    30,
  bgp:     25,
  telecom: 15,
  cloud:   15,  // toujours null — poids fantôme redistribué automatiquement
  space:   10,
  cyber:    5,
} as const;
```

### 3.4 Normalisation par source (→ health score 0-100, 100 = nominal)

#### `elec` — Ecowatt (30%)

**Source :** `fetchEcowatt()` → `EcowattResponse.signals: Record<string, EcowattSignal>`

`EcowattSignal` est `'green' | 'orange' | 'red'`. Les clés sont des codes INSEE région (ex. `"11"`, `"24"`).

```ts
const signalValues = Object.values(ecowattData.signals);
// green → 100, orange → 60, red → 20
const mapped = signalValues.map(s => s === 'green' ? 100 : s === 'orange' ? 60 : 20);
const elecScore = mapped.length > 0
  ? Math.round(mapped.reduce((a, b) => a + b, 0) / mapped.length)
  : null;
```

#### `bgp` — Internet/IODA (25%)

**Source :** `fetchNetworkOutages()` → `NetworkOutageState.nationalScore: number`

Déjà 0-100 (100 = réseau sain). Pas de transformation.

#### `telecom` — ARCEP (15%)

**Source :** `fetchTelecomOutages()` → `TelecomOutage[]`

`TelecomOutage` a : `voiceStatus: 'OK' | 'HS' | 'Degraded'`, `dataStatus: 'OK' | 'HS' | 'Degraded'`.

```ts
const totalSites = outages.length;
const hsSites = outages.filter(o => o.voiceStatus === 'HS' || o.dataStatus === 'HS').length;
// Si aucun site remonté (API vide), score neutre 100
const telecomScore = totalSites === 0
  ? 100
  : Math.round(Math.max(0, 100 - (hsSites / totalSites) * 200));
```

Plafonnement explicite à 0 via `Math.max(0, ...)` — le `* 200` amplifie les pannes rares significatives.

#### `cloud` — Non implémenté

Toujours `null`. Redistribué via normalisation des poids actifs (voir §3.5).

#### `space` — Météo spatiale (10%)

**Source :** `fetchSpaceWeather()` → `SpaceWeatherData.kpIndex: number`

**Import :** `import type { SpaceWeatherData } from './space-weather.ts'` (pas dans `types/index.ts`).

```ts
const spaceScore = Math.max(0, 100 - Math.min(kpIndex * 12, 100));
// kp=0 → 100, kp=5 → 40, kp=9 → 0 (effective floor)
```

#### `cyber` — Tension cyber (5%)

**Source :** `fetchCyberDashboard()` → `CyberState.meta.globalScore: number`

**Polarity confirmée :** score commence à 0, augmente avec les menaces (`certHighCount * 5 + ransomwareCount * 10 + ...`). Score ≤ 33 = vigilance normale (vert), > 66 = alerte (rouge). **Plus haut = pire.**

```ts
const cyberScore = 100 - cyberState.meta.globalScore;
// globalScore=0 (calme) → cyberHealthScore=100
// globalScore=100 (crise) → cyberHealthScore=0
```

### 3.5 Algorithme de score global

```ts
function calculateGlobalScore(scores: Partial<Record<keyof typeof WEIGHTS, number | null>>): number {
  let totalScore = 0;
  let activeWeights = 0;

  for (const [key, weight] of Object.entries(WEIGHTS) as [keyof typeof WEIGHTS, number][]) {
    const s = scores[key];
    if (s !== null && s !== undefined) {
      totalScore += s * weight;
      activeWeights += weight;
    }
  }
  // cloud est null → activeWeights = 85 (pas 100).
  // La division renormalise automatiquement sur 100.
  return activeWeights > 0 ? Math.round(totalScore / activeWeights) : 0;
}
```

---

## 4. Composant — `src/components/BarometerWidget.ts`

### 4.1 Layout HTML/SVG

```
┌──────────────────────────────────────────┐
│  [SVG arc 60×60]   92    INFRASTRUCTURES │
│   stroke animé     /100  FRANCE    [dot] │
└──────────────────────────────────────────┘
```

- **Arc SVG** : cercle 60×60px, `stroke-dasharray` / `stroke-dashoffset` animé, départ à 12h
- **Score** : `<span>` avec police monospace, mise à jour avec transition `opacity`
- **Label** : `INFRASTRUCTURES FRANCE` en `text-transform: uppercase; letter-spacing: 0.08em`
- **Status dot** : cercle 8px, couleur selon statut ; classe `barometer-pulse` quand `critical`

### 4.2 Couleurs par statut

| Status | Score | Couleur arc + dot |
|--------|-------|-------------------|
| `nominal` | ≥ 85 | `#34c759` (`--threat-low`) |
| `degraded` | 60–84 | `#ffcc00` (`--threat-medium`) |
| `critical` | < 60 | `#ff2d55` (`--threat-critical`) |

### 4.3 Positionnement

```css
position: fixed;
top: 64px;
left: 12px;
z-index: 900;
background: var(--bg-surface);
border: 1px solid rgba(255,255,255,0.1);
border-radius: 12px;
backdrop-filter: blur(12px);
```

z-index 900 : au-dessus de la carte, en-dessous des panneaux flottants (z-index ≥ 1000).

### 4.4 Tooltip hover

Div absolue positionnée à droite du widget, affichant :

```
BGP/Internet    :  98 / 100
Electricité     : 100 / 100
Telecom ARCEP   :  87 / 100
Météo Spatiale  :  88 / 100
Cyber (CERT-FR) :  72 / 100
Cloud/Web       : N/A (Intégration en cours)   ← opacity: 0.4
```

Apparaît au `mouseenter`, disparaît au `mouseleave`. Event listeners ajoutés dans `mount()`, retirés dans `destroy()`.

### 4.5 Animations CSS (ajouts dans `main.css`)

```css
/* Arc SVG — départ 12h via transform-box requis pour SVG */
.barometer-arc {
  transition: stroke-dashoffset 0.6s ease-in-out, stroke 0.3s ease;
  transform: rotate(-90deg);
  transform-origin: center;
  transform-box: fill-box;   /* REQUIS en SVG pour que transform-origin soit relatif à l'élément */
}

/* Pulsation critique — keyframe propre (alertPulse existant scale+fade inadapté pour un dot) */
@keyframes barometerPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%       { opacity: 0.4; transform: scale(1.3); }
}

.barometer-pulse {
  animation: barometerPulse 2s ease-in-out infinite;
}
```

Score number : `transition: opacity 0.3s ease` lors des mises à jour (flash 0→1).

**Note :** `alertPulse` (existant) anime `scale(0.5→1.5)` + `opacity → 0` — adapté aux anneaux expansifs, pas aux dots. `barometerPulse` est un nouveau keyframe dédié.

### 4.6 Méthodes publiques de `BarometerWidget`

```ts
class BarometerWidget {
  constructor(container: HTMLElement)
  mount(): void              // injecte le DOM dans container
  update(result: NetworkBarometerResult): void  // met à jour arc + score + statut
  destroy(): void            // retire event listeners mouseenter/mouseleave
}
```

---

## 5. Intégration — `src/App.ts`

```ts
// Imports à ajouter
import { BarometerWidget } from './components/BarometerWidget.ts';
import { fetchNetworkBarometer } from './services/network-barometer.ts';

// Déclarations de champs
private networkBarometerWidget: BarometerWidget | null = null;
private _intervalNetworkBarometer: ReturnType<typeof setInterval> | null = null;

// Dans initPanels() — monté sur this.container (même que DayNightPanel)
this.networkBarometerWidget = new BarometerWidget(this.container);
this.networkBarometerWidget.mount();

const refreshBarometer = async () => {
  const result = await fetchNetworkBarometer();
  this.networkBarometerWidget?.update(result);
};
void refreshBarometer();
this._intervalNetworkBarometer = setInterval(
  () => refreshBarometer().catch(err => console.error('[App] Barometer poll error', err)),
  5 * 60_000
);

// Dans destroy()
if (this._intervalNetworkBarometer) clearInterval(this._intervalNetworkBarometer);
this.networkBarometerWidget?.destroy();
```

---

## 6. Fix OutagesPanel — Labels Enedis

Dans `src/components/OutagesPanel.ts`, remplacer les occurrences de `'Bilan Enedis (historique annuel)'` par `'Indicateurs Historiques DataFair'`. Cette chaîne provient de `outages.ts` (ligne 154) et est injectée dans `eventCause` — vérifier aussi toute occurrence directe dans le template HTML du panneau. Changement purement cosmétique, aucune logique touchée.

---

## 7. Contraintes & non-objectifs

- **Pas de nouveaux appels réseau** dans `network-barometer.ts` — lecture de caches uniquement
- **Pas d'extension de `Panel`** — widget standalone toujours visible
- **Pas de React/Vue** — DOM natif, comme le reste du projet
- **Cloud/Web** : `null` pour l'instant, intégration future via statuspage.io APIs
- **Performance** : pas de re-render carte, uniquement `stroke-dashoffset` CSS + DOM minimal

---

## 8. Fichiers créés / modifiés

| Fichier | Action |
|---------|--------|
| `src/services/network-barometer.ts` | **Créer** |
| `src/components/BarometerWidget.ts` | **Créer** |
| `src/App.ts` | **Modifier** — imports, champs, mount, polling, destroy |
| `src/components/OutagesPanel.ts` | **Modifier** — label "Indicateurs Historiques DataFair" |
| `src/styles/main.css` | **Modifier** — `.barometer-arc`, `@keyframes barometerPulse`, `.barometer-pulse` |
