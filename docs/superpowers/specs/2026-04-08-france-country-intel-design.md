# France Country Intel Engine — Design Spec
**Date:** 2026-04-08
**Status:** Approved — ready for implementation plan
**Scope:** 7 files, migration en une passe, zero UX regression

---

## 1. Contexte & Problème

### État actuel

| Fichier | Rôle actuel | Problème |
|---|---|---|
| `FranceIntelPanel.ts` | UI + calcul CII + calcul axes | Logique métier dans le renderer |
| `App.ts` `buildFranceIntelData()` | Agrège ~110 lignes de comptages bruts | Pas de typing structuré sur axes/score |
| `france-intel-brief.ts` | Re-extrait ses propres métriques depuis `FranceIntelData` | Duplication de calculs |
| `FranceIntelData` (type) | Sac hétérogène de toutes les données | Pas de distinction raw / calculé |

### Objectif

Reproduire l'architecture `country-intel` de WorldMonitor (moteur → snapshot → renderer pur) adaptée à la stack Vanilla TS de FranceMonitor, avec **App.ts comme orchestrateur** (option B).

```
App.ts
  → collecte raw data (variables privées existantes)
  → appelle buildFranceCountrySnapshot(raw, options?)  ← MOTEUR
  → FranceCountrySnapshot (unique source de vérité)
       ├── FranceIntelPanel.show(snapshot)             ← renderer pur
       └── fetchFranceIntelBrief(snapshot.briefContext) ← brief LLM
```

---

## 2. Fichiers touchés (7, migration en une passe)

1. `src/types/index.ts`
2. `src/services/france-country-intel.ts` ← **nouveau**
3. `src/App.ts`
4. `src/components/FranceIntelPanel.ts`
5. `src/services/france-intel-brief.ts`
6. `src/plugins/france-intel-proxy.ts`
7. `api/intelligence/v1/france-intel-brief.js`

---

## 3. Types (`src/types/index.ts`)

### Nouveaux types publics (tous `export interface`)

```typescript
export interface FranceCountrySignals {
  // News
  criticalNews: number;
  highNews: number;
  topNewsCount: number;   // min(newsItems.length, 20) — utilisé dans la formule information
  // Météo / crues / feux  (filtrés : niveaux sévères uniquement)
  meteoAlerts: number;    // orange | red | violet uniquement
  floodAlerts: number;    // orange | red uniquement
  fireDetections: number;
  // Transports
  railDisruptions: number;
  railSevere: number;
  roadIncidents: number;
  // Réseaux / infra
  powerOutages: number;
  telecomOutages: number;
  // Cyber
  cyberAlerts: number;
  cyberCritical: number;
  // Défense / renseignement
  militaryFlights: number;
  maritimeTrafficFrance: number;
  defenseAlerts: number;
  defenseHigh: number;
  jammingSignals: number;
  // Finance (signal faible)
  marketStress: number;
}

export interface FranceCountryAxes {
  troubles: number;    // 0–100 — agitation civile intérieure
  conflict: number;    // 0–100 — posture militaire / confrontation
  security: number;    // 0–100 — gravité sécuritaire
  information: number; // 0–100 — pression informationnelle multi-source
}

export interface FranceBriefContext {
  score: number;
  axes: FranceCountryAxes;
  signals: FranceCountrySignals;
  topHeadlines: string[];         // max 6 titres normalisés
  ecowattSignal: string | null;
  meteoMaxLevel: string | null;
  cyberScore: number;
  isnrComponents: { social: number; security: number; infra: number };
  energySummary: FranceIntelEnergySummary | null; // pour le prompt LLM
}

export interface FranceCountrySnapshot {
  // Calculé par le moteur
  signals: FranceCountrySignals;
  axes: FranceCountryAxes;
  score: number;                    // CII 0–100
  briefContext: FranceBriefContext;

  // Données brutes passées au renderer (anciens champs FranceIntelData)
  stability: ISNRData;
  cyber: CyberState;
  meteo: MeteoAlert[];
  topNews: NewsItem[];
  energy: FranceIntelEnergySummary | null;
  timeline: { days: string[]; lanes: FranceIntelTimelineLane[] };
  brief?: string | null;
  briefLang: 'fr' | 'en';
  briefFreshness?: 'fresh' | 'cached';
}
```

### Types supprimés des exports publics

- `FranceIntelData` — retiré des exports
- `FranceIntelOperationalSummary` — absorbé dans `FranceCountrySignals`

### Types conservés sans changement

- `FranceIntelEnergySummary` (champs `shares`, `ecowattSignal`, `totalMw`, etc.)
- `FranceIntelTimelineLane`
- Tous les autres types existants

---

## 4. Moteur (`src/services/france-country-intel.ts`)

Nouveau fichier. Contient toute la logique métier de calcul.

### Type interne d'input

```typescript
// Non exporté — usage interne au moteur uniquement
interface FranceRawData {
  newsItems: NewsItem[];
  isnrData: ISNRData | null;
  cyberData: CyberState | null;
  meteoAlerts: MeteoAlert[];
  floodSegments: FloodSegment[];
  sncfDisruptions: SncfDisruption[];
  trafficIncidents: TrafficIncident[];
  powerOutages: PowerOutage[];
  telecomOutages: TelecomOutage[];
  defenseAlerts: DefenseAlert[];
  jammingSignals: JammingSignal[];
  militaryFlightsCount: number;
  maritimeCount: number;
  activeFires: ActiveFire[];
  marketData: MarketData[];           // tableau, pas null
  ecowattResponse: EcowattResponse | null;
  nuclearState: NuclearState | null;
  eolienLive: EolienLive | null;
  timeline: { days: string[]; lanes: FranceIntelTimelineLane[] };
  briefLang: 'fr' | 'en';
}
```

### Pipeline (4 fonctions exportées)

```typescript
export function buildFranceSignals(raw: FranceRawData): FranceCountrySignals
```
Comptage normalisé de chaque source. Retourne des zéros pour les sources absentes.
- `criticalNews` / `highNews` : filtrer `raw.newsItems` par severity
- `topNewsCount` : `Math.min(raw.newsItems.length, 20)` — plafond identique au prod actuel
- `meteoAlerts` : `raw.meteoAlerts.filter(a => ['orange','red','violet'].includes(a.level)).length`
- `floodAlerts` : `raw.floodSegments.filter(s => ['orange','red'].includes(s.level)).length`
- `fireDetections` : `raw.activeFires.length`
- `railDisruptions` : `raw.sncfDisruptions.length`
- `railSevere` : disruptions avec severity critique ou haute
- `roadIncidents` : `raw.trafficIncidents.length`
- `powerOutages` : `raw.powerOutages.length`
- `telecomOutages` : `raw.telecomOutages.length`
- `cyberAlerts` : depuis `raw.cyberData`
- `cyberCritical` : alertes cyber critiques
- `militaryFlights` : `raw.militaryFlightsCount`
- `maritimeTrafficFrance` : `raw.maritimeCount`
- `defenseAlerts` : `raw.defenseAlerts.length`
- `defenseHigh` : alertes défense haute sévérité
- `jammingSignals` : `raw.jammingSignals.length`
- `marketStress` : nombre de lignes `raw.marketData` avec variation négative significative

---

```typescript
export function computeFranceAxes(
  signals: FranceCountrySignals,
  isnr: ISNRData | null,
): FranceCountryAxes
```

Formules **exactes du prod** (portées depuis `FranceIntelPanel.ts`, zéro drift), toutes clampées à [0, 100] :

| Axe | Formule (identique prod) |
|---|---|
| `troubles` | `max(isnrSocial, highNews×5 + railDisruptions×2 + roadIncidents + (powerOutages + telecomOutages)×3)` |
| `conflict` | `defenseAlerts×18 + jammingSignals×16 + min(militaryFlights, 20)×2 + min(maritimeTrafficFrance, 20)` |
| `security` | `max(isnrSecurity, criticalNews×18 + highNews×8 + defenseHigh×18 + jammingSignals×10)` |
| `information` | `topNewsCount + highNews×4 + criticalNews×10 + marketStress×5` |

`isnrSocial` et `isnrSecurity` : moyennes nationales `avgDim()` sur `isnr.scores` (calcul porté tel quel depuis le panel).
`topNewsCount` = `signals.topNewsCount` = `min(newsItems.length, 20)`.

---

```typescript
export function computeFranceRiskScore(
  isnrComponents: { social: number; security: number; infra: number },
  cyberScore: number,
): number
```

CII **exact du prod** (porté depuis `computeCII()` dans `FranceIntelPanel.ts`) :
```
score = social×0.25 + security×0.30 + infra×0.20 + cyber×0.25
```
Aucun changement de pondération. `isnrComponents` et `cyberScore` sont déjà calculés dans `buildFranceBriefContext` — le moteur les passe directement.

Note : la signature prend `isnrComponents + cyberScore` (et non `axes`) car le CII actuel est basé sur les dimensions ISNR/cyber, pas sur les axes dérivés des signaux opérationnels.

---

```typescript
export function buildFranceBriefContext(
  signals: FranceCountrySignals,
  axes: FranceCountryAxes,
  raw: FranceRawData,
): Omit<FranceBriefContext, 'score'>
```

Calcule tous les champs du contexte LLM sauf `score` (calculé ensuite par `computeFranceRiskScore`) :
- `topHeadlines` : `raw.newsItems.slice(0, 6).map(n => n.title)` (normalisé, max 120 chars)
- `ecowattSignal` : depuis `raw.ecowattResponse` (même logique que prod App.ts l.4748–4754)
- `meteoMaxLevel` : niveau max parmi `raw.meteoAlerts` (rouge > orange > jaune > vert)
- `cyberScore` : `raw.cyberData?.meta.globalScore ?? 0`
- `isnrComponents` : calcul `avgDim` sur `raw.isnrData?.scores` (social, security, infra)
- `energySummary` : assemblé depuis `raw.ecowattResponse`, `raw.nuclearState`, `raw.eolienLive`

`buildFranceCountrySnapshot` injecte ensuite `score` dans le context avant d'assembler le snapshot final.

---

```typescript
export function buildFranceCountrySnapshot(
  raw: FranceRawData,
  options?: { brief?: string | null; briefFreshness?: 'fresh' | 'cached' }
): FranceCountrySnapshot
```

Orchestre le pipeline :
1. `signals = buildFranceSignals(raw)`
2. `axes = computeFranceAxes(signals, raw.isnrData)`
3. `briefContext = buildFranceBriefContext(signals, axes, raw)`  ← calcule aussi `isnrComponents` + `cyberScore`
4. `score = computeFranceRiskScore(briefContext.isnrComponents, briefContext.cyberScore)`
5. Assemble `FranceCountrySnapshot` avec toutes les données brutes + calculées

Note : l'étape 3 précède l'étape 4 car `isnrComponents` et `cyberScore` (nécessaires au CII) sont calculés dans `buildFranceBriefContext`. Le score final est ensuite injecté dans `briefContext.score`.

---

## 5. App.ts

### Changement minimal

`buildFranceIntelData(lang)` est remplacée par un wrapper mince qui construit `FranceRawData` et appelle le moteur :

```typescript
// Avant (~110 lignes avec calcul CII, axes, comptages)
private buildFranceIntelData(lang: 'fr' | 'en'): FranceIntelData { ... }

// Après (~30 lignes, assemblage raw uniquement)
private buildFranceCountrySnapshot(
  lang: 'fr' | 'en',
  options?: { brief?: string | null; briefFreshness?: 'fresh' | 'cached' }
): FranceCountrySnapshot {
  const raw: FranceRawData = {
    newsItems:            this.newsItems,
    isnrData:             this.currentISNRData,
    cyberData:            this.currentCyberData,
    meteoAlerts:          this.currentMeteoAlerts,
    floodSegments:        this.currentFloodSegments,
    sncfDisruptions:      this.currentSncfDisruptions,
    trafficIncidents:     this.currentTrafficIncidents,
    powerOutages:         this.currentPowerOutages,
    telecomOutages:       this.currentTelecomOutages,
    defenseAlerts:        this.currentDefenseAlerts,
    jammingSignals:       this.currentJammingSignals,
    militaryFlightsCount: this.currentMilitaryFlightsCount,
    maritimeCount:        this.currentMaritimeTrafficFranceCount,
    activeFires:          this.currentActiveFires,
    marketData:           this.currentMarketData ?? [],
    ecowattResponse:      this.currentEcowattResponse,
    nuclearState:         this.currentNuclearState,
    eolienLive:           this.currentEolienLive,
    timeline:             this.buildFranceTimeline(),
    briefLang:            lang,
  };
  return buildFranceCountrySnapshot(raw, options);
}
```

`refreshFranceIntelPanel()` et `openFranceIntelPanel()` passent le snapshot au panel sans changement structurel. Le brief est injecté via `options.brief` lors du retour LLM.

Import ajouté : `import { buildFranceCountrySnapshot as buildEngine } from '@/services/france-country-intel'`
Import retiré : `FranceIntelData`

---

## 6. FranceIntelPanel.ts

### Fonctions supprimées

Les 4 helpers de calcul présents dans le fichier actuel sont **supprimés** :
- `computeCII(data: FranceIntelData): number`
- `computeNationalPostureAxes(data: FranceIntelData, lang): Array<...>`
- `avgDim(scores, key): number`
- `clampScore(value): number`

### Signature `show()` mise à jour

```typescript
// Avant
show(data: FranceIntelData): void

// Après
show(snapshot: FranceCountrySnapshot): void
```

Le renderer lit directement :
- `snapshot.score` → index d'instabilité
- `snapshot.axes` → barres de posture nationale (troubles / conflict / security / information)
- `snapshot.signals` → chips de signaux actifs
- `snapshot.topNews` → headlines
- `snapshot.meteo` → alertes météo
- `snapshot.energy` → profil énergie
- `snapshot.stability` → données ISNR pour la carte de posture
- `snapshot.cyber` → données cyber
- `snapshot.brief` + `snapshot.briefFreshness` → brief LLM

`updateBrief(brief, freshness)` reste inchangé — App.ts continue de l'appeler après retour LLM.

---

## 7. france-intel-brief.ts

### Signature mise à jour

```typescript
// Avant
export async function fetchFranceIntelBrief(
  data: FranceIntelData,
  lang: 'fr' | 'en',
): Promise<FranceBriefResult>

// Après
export async function fetchFranceIntelBrief(
  ctx: FranceBriefContext,
  lang: 'fr' | 'en',
): Promise<FranceBriefResult>
```

### Logique interne

Supprimées : `getActiveScores()`, `avgDim()` (déplacées dans le moteur).

Payload HTTP construit depuis `ctx` :
```typescript
body: JSON.stringify({
  isnrScore:        ctx.score,
  isnrComponents:   ctx.isnrComponents,
  cyberScore:       ctx.cyberScore,
  meteoAlertCount:  ctx.signals.meteoAlerts,
  topHeadlines:     ctx.topHeadlines,
  signalCounts: {
    criticalNews:          ctx.signals.criticalNews,
    highNews:              ctx.signals.highNews,
    weatherAlerts:         ctx.signals.meteoAlerts,   // ← mapping nom interne→API existant
    floodAlerts:           ctx.signals.floodAlerts,
    fireDetections:        ctx.signals.fireDetections,
    railDisruptions:       ctx.signals.railDisruptions,
    roadIncidents:         ctx.signals.roadIncidents,
    powerOutages:          ctx.signals.powerOutages,
    telecomOutages:        ctx.signals.telecomOutages,
    cyberAlerts:           ctx.signals.cyberAlerts,
    militaryFlights:       ctx.signals.militaryFlights,
    maritimeTrafficFrance: ctx.signals.maritimeTrafficFrance,
    defenseAlerts:         ctx.signals.defenseAlerts,
    jammingSignals:        ctx.signals.jammingSignals,
    marketStress:          ctx.signals.marketStress,
  },
  energy: ctx.energySummary ? {
    ecowattSignal: ctx.energySummary.ecowattSignal,
    nuclearShare:  ctx.energySummary.shares.nuclear,
    gasShare:      ctx.energySummary.shares.gas,
    hydroShare:    ctx.energySummary.shares.hydro,
    windShare:     ctx.energySummary.shares.wind,
    solarShare:    ctx.energySummary.shares.solar,
    totalMw:       ctx.energySummary.totalMw,
  } : null,
  lang,
})
```

**Point clé** : `meteoAlerts` (nom interne) est envoyé à la fois comme `meteoAlertCount` et comme `signalCounts.weatherAlerts` pour préserver le contrat API existant côté proxy et serverless.

Cache et `clearFranceBriefCache()` : inchangés.

App.ts appelle `fetchFranceIntelBrief(snapshot.briefContext, lang)`.

---

## 8. france-intel-proxy.ts & api/intelligence/v1/france-intel-brief.js

### Changement : aucun changement structurel

Le payload HTTP reçu est **identique** à aujourd'hui : `isnrScore`, `isnrComponents`, `cyberScore`, `meteoAlertCount`, `topHeadlines`, `signalCounts`, `energy`, `lang`.

La source du payload change (vient de `FranceBriefContext` au lieu de `FranceIntelData`), mais la forme JSON envoyée est la même.

**Seul ajustement** : mettre à jour les commentaires dans ces fichiers pour référencer `FranceBriefContext` plutôt que `FranceIntelData`. Pas de changement logique.

---

## 9. Invariants à respecter

- **TypeScript strict** : aucun `any`, pas de `!` non justifié
- **Zéro impact UX** : drawer latéral, bouton sidebar, `updateBrief()` — inchangés
- **Pas de régression** : tous les panels autres que `FranceIntelPanel` ignorent ces changements
- **Validation** : `npm run typecheck && npm run build` doit passer en fin de migration

---

## 10. Ce qui n'est PAS dans ce scope

- Évolution vers un moteur auto-piloté (option A) — laissé pour plus tard
- Modification des formules des axes ou du CII — refactor pur, zéro drift fonctionnel
- Rapprochement du scoring vers WorldMonitor — chantier séparé explicite
- Refactor du handler Redis côté API
- Modification d'autres panels

---

## 11. Flux de données final (référence)

```
App.ts
  this.newsItems, this.currentISNRData, etc.
      │
      ▼
  FranceRawData  (assemblé dans buildFranceCountrySnapshot)
      │
      ▼
  france-country-intel.ts
    buildFranceSignals(raw)                      → FranceCountrySignals
    computeFranceAxes(sig, isnr)                 → FranceCountryAxes
    buildFranceBriefContext(sig, axes, raw)       → Omit<FranceBriefContext, 'score'>
    computeFranceRiskScore(isnrComponents, cyber) → number (CII — formule prod inchangée)
    ← score injecté dans briefContext
      │
      ▼
  FranceCountrySnapshot
      │
      ├──► FranceIntelPanel.show(snapshot)    [renderer pur]
      │
      └──► fetchFranceIntelBrief(snapshot.briefContext, lang)
               │
               ▼
           POST /api/intelligence/v1/france-intel-brief
               │
               ▼
           { brief: string | null }
               │
               ▼
           App.ts → panel.updateBrief(brief, freshness)
```
