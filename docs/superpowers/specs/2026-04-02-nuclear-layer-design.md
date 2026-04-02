# Nuclear Layer — France Monitor
**Date :** 2026-04-02  
**Statut :** Approuvé  
**Auteur :** FraidFraid × Claude

---

## 1. Objectif produit

Ajouter un module de **veille nucléaire OSINT** à France Monitor :

1. Afficher les centrales et tranches nucléaires françaises avec leur **statut quasi temps réel** (RTE OAuth2).
2. Afficher une **timeline des indisponibilités** et maintenances à venir.
3. Intégrer le flux **REMIT / UMM** comme signal faible / anticipation.
4. **Détecter les écarts** entre signaux REMIT et données RTE structurées → signal analyste.

Différenciateur produit : l'avance informationnelle REMIT + la comparaison explicite REMIT vs RTE + l'honnêteté sur la qualité de la donnée.

---

## 2. Architecture générale

**Approche : module standalone**, calqué sur le pattern `gas` / `oil` / `cyber` du projet. Couche `nuclear` enfant de `energyGroup`. Zéro couplage avec `energy.ts`.

### Couches de données

| Layer | Source | Auth | Fréquence |
|---|---|---|---|
| 0 — Référentiel | `NUCLEAR_PLANTS` (config/infrastructure.ts) | Aucune | Statique |
| 1 — Temps réel structuré | RTE Open Data API `unavailability_additional_information/v4` | OAuth2 (RTE_CLIENT_ID / RTE_CLIENT_SECRET) | 15 min |
| 2 — Signal faible REMIT | IIP RTE RSS via `rte-iip.ts` existant | Aucune (RSS public) | 10–12 min |
| 3 — Enrichissement analytique | Corrélation Layer 1 + Layer 2 + éCO2mix national | Hérite | Calculé à chaque fetch |

---

## 3. Fichiers créés

| Fichier | Rôle |
|---|---|
| `src/services/nuclear-rte.ts` | Layer 1 : fetch RTE OAuth2 unavailability, normalise → `NuclearUnavailability[]` |
| `src/services/nuclear-remit.ts` | Layer 2 : filtre `RTEIIPState` → `NuclearRemitSignal[]` classifiés |
| `src/services/nuclear-correlation.ts` | Layer 3 : diff REMIT/RTE, `UnconfirmedRemitSignal[]`, `NuclearStressScore` |
| `src/components/NuclearPanel.ts` | Panel UI : 4 sections (Status · Timeline · REMIT · Stress) |
| `api/nuclear/rte-unavailability.js` | Vercel function : OAuth2 flow + GET unavailabilities |
| `src/plugins/nuclear-proxy.ts` | Vite dev proxy : forward `/api/nuclear/*` |

## 4. Fichiers modifiés

| Fichier | Changement |
|---|---|
| `src/types/index.ts` | `nuclear: boolean` dans `MapLayers` + 6 nouveaux types |
| `src/App.ts` | 4 endroits obligatoires (DEFAULT_LAYERS, LAYER_CONFIGS, onLayerToggle, getEffectiveLayers) + wiring panel/service |
| `src/components/LayerPanel.ts` | Ajout `nuclear` dans `LAYER_DEFS` (enfant `energyGroup`) |
| `src/components/DeckGLMap.ts` | Couleurs dynamiques cercles nucléaires depuis `NuclearState` |

**Non modifiés (structure) :** `rte-iip.ts` (consommé tel quel), `energy.ts` (garde son mock en fallback). `MapPopup.ts` : la méthode `showNuclearSite()` existe déjà mais n'est câblée qu'avec des données statiques. Le wiring dans `App.ts` devra lui passer les données du `NuclearState` réel — c'est une tâche d'implémentation, pas un fichier à modifier structurellement.

---

## 5. Types TypeScript

```ts
// Statut d'une tranche
export type ReactorAvailabilityStatus =
  | 'AVAILABLE'
  | 'REDUCED'
  | 'OUTAGE_PLANNED'
  | 'OUTAGE_UNPLANNED'
  | 'UNKNOWN';

// Indisponibilité RTE structurée (Layer 1)
export interface NuclearUnavailability {
  id: string;
  plantName: string;          // ex. "Gravelines"
  unitName: string;           // ex. "GRAVELINES-1" (nom RTE)
  nominalPowerMW: number;
  availablePowerMW: number;
  status: ReactorAvailabilityStatus;
  startDate: Date;
  endDate: Date | null;
  type: 'PLANNED' | 'UNPLANNED' | 'FORCE_MAJEURE';
  updatedAt: Date;
}

// Signal REMIT filtré pour le nucléaire (Layer 2)
export interface NuclearRemitSignal {
  id: string;
  plantName: string;          // centrale déduite du titre IIP
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
  confirmedByRTE: boolean;    // initialisé à false dans nuclear-remit.ts, passé à true dans nuclear-correlation.ts si une NuclearUnavailability correspondante est trouvée
  matchConfidence: number;    // 0–1
}

// Signal non confirmé RTE = diff REMIT vs RTE (Layer 3)
export interface UnconfirmedRemitSignal {
  remitSignal: NuclearRemitSignal;
  reason: string;
  confidence: number;
}

// Score de tension nucléaire (Layer 3)
export interface NuclearStressScore {
  installedCapacityMW: number;
  availableCapacityMW: number;
  stressRatio: number;          // (installed - available) / installed
  level: 'NORMAL' | 'TENSION' | 'CRITIQUE'; // 0–10% / 10–25% / >25%
  gridTensionRisk: boolean;     // stressRatio > 0.10 + consommation nationale élevée
  updatedAt: Date;
  freshness: 'realtime' | 'quasi-realtime' | 'stale' | 'unavailable';
}

// État global du module
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

---

## 6. Services

### `nuclear-rte.ts`
- Appelle `/api/nuclear/rte-unavailability` (Vercel) ou proxy Vite en dev.
- Cache in-memory 15 min.
- Fallback : retourne `[]` si HTTP error ou timeout, log warning.
- Normalise la réponse RTE vers `NuclearUnavailability[]` (déduit `ReactorAvailabilityStatus` depuis les champs RTE).

### `nuclear-remit.ts`
- Accepte un `RTEIIPState` (déjà fetchté par `fetchRTEIIPIncidents()`).
- Filtre `incidents` de type `production`.
- **Matching plant name** — algorithme sans dépendance externe : normalisation lowercase + suppression accents, puis `includes()` entre le titre IIP et chaque `plant.name` de `NUCLEAR_PLANTS`. Si match exact → `matchConfidence: 1.0`. Si match partiel (Levenshtein distance ≤ 2 sur les 6 premiers chars) → `matchConfidence: 0.7`. Score < 0.4 → signal ignoré. Pas de lib tierce — implémentation inline (~20 lignes).
- `confirmedByRTE` initialisé à `false` ; sera résolu par `nuclear-correlation.ts`.
- **NUCLEAR_PLANTS shape** (depuis `config/infrastructure.ts`) :
  ```ts
  { id: string; name: string; coordinates: [number, number]; status: 'active' | 'shutdown'; capacity: number /* MW installés */; operator: string }
  ```
- Classification heuristique du texte :
  - `unplanned outage` / `avarie` / `arrêt fortuit` → `UNPLANNED_OUTAGE`
  - `maintenance` / `arrêt programmé` → `PLANNED_MAINTENANCE`
  - `restart` / `remise en service` → `RESTART`
  - `extension` / `prolongation` → `EXTENSION`
  - Sinon → `OTHER`
- Aucun appel réseau propre.

### `nuclear-correlation.ts`
Signature complète :
```ts
buildNuclearState(
  unavailabilities: NuclearUnavailability[],
  iipState: RTEIIPState,
  nationalMix?: { nuclear: number; total: number; timestamp: Date }
): NuclearState
```
`nationalMix` est un sous-ensemble de `EnergyMix` (déjà défini dans `types/index.ts`) — seuls `nuclear` (MW) et `total` (MW) sont nécessaires.

- Pour chaque `NuclearRemitSignal` : cherche une `NuclearUnavailability` correspondante (même `plantName` normalisé, overlap temporel `startDate–endDate`).
  - Trouvée → `confirmedByRTE: true`
  - Non trouvée → `UnconfirmedRemitSignal { reason: "Aucune indisponibilité RTE correspondante", confidence: remitSignal.matchConfidence }`
- `NuclearStressScore` :
  - `installedCapacityMW` = somme `capacity` des `NUCLEAR_PLANTS` où `status !== 'shutdown'`
  - `availableCapacityMW` = `installedCapacityMW` − somme `(nominalPowerMW − availablePowerMW)` des `unavailabilities` actives (dont `endDate` est null ou dans le futur)
  - `stressRatio` = `(installedCapacityMW − availableCapacityMW) / installedCapacityMW`
  - `gridTensionRisk` = `stressRatio > 0.10 && nationalMix != null && nationalMix.nuclear < nationalMix.total * 0.35` (production nucléaire < 35% du mix national, seuil typique de tension)
  - `avgNuclear` n'est pas utilisé — remplacé par le seuil absolu 35% du mix ci-dessus
- **Règles `freshness`** :
  - `rteAvailable && fetchedAt < 15 min` → `'quasi-realtime'`
  - `rteAvailable && fetchedAt 15–30 min` → `'stale'`
  - `!rteAvailable` → `'unavailable'`
  - `'realtime'` non utilisé (aucune source n'est truly temps-réel push)

### `api/nuclear/rte-unavailability.js` (Vercel)
```
POST https://digital.iservices.rte-france.com/token/oauth/token
  body: grant_type=client_credentials, client_id=RTE_CLIENT_ID, client_secret=RTE_CLIENT_SECRET
  → { access_token, token_type, expires_in }

GET https://digital.iservices.rte-france.com/open_api/unavailability_additional_information/v4/generation_unavailabilities
  ?resource_type=NUCLEAR&status=ACTIVE
  Authorization: Bearer <access_token>
  → JSON
```
- OAuth flow **réimplémenté inline** dans ce fichier (pas de helper partagé — pattern cohérent avec `api/energy/ecowatt.js` qui n'utilise pas OAuth non plus). Aucune dépendance sur d'autres Vercel functions.
- Si `RTE_CLIENT_ID` absent → 503 avec message explicite (aucun mock silencieux).
- Cache Upstash 15 min si `UPSTASH_REDIS_REST_URL` dispo.

---

## 7. Panel UI — `NuclearPanel.ts`

Classe étendant `Panel.ts`. 4 sections :

**STATUS** — grid de cards par centrale :
- Nom, MW disponible / installé, badge statut coloré, badge fraîcheur.

**TIMELINE** — liste chronologique des indisponibilités en cours et à venir :
- Tranche · début · fin · MW · type (PLANNED / UNPLANNED).
- Triée par date de début.

**REMIT ALPHA** — signaux non confirmés RTE :
- Badge `Signal REMIT détecté · Non reflété RTE` en noir.
- Niveau de confiance affiché.
- Badge fraîcheur `QUASI TEMPS RÉEL` ou `INDISPONIBLE`.

**STRESS** — score de tension :
- Jauge `nuclearStress%` (0–100%).
- Badge niveau : `NORMAL` / `TENSION` / `CRITIQUE`.
- Flag `GRID_TENSION_RISK` si activé.

Chaque section affiche un badge de fraîcheur selon le `freshness` du state :
`QUASI TEMPS RÉEL` · `HISTORIQUE` · `RECONSTRUIT / ESTIMÉ` · `INDISPONIBLE`

---

## 8. Layer map

**Clé** : `nuclear: boolean` dans `MapLayers`, enfant de `energyGroup`.  
**Label LayerPanel** : `⚛ NUCLÉAIRE`

**Couleurs dynamiques dans `DeckGLMap.ts`** (cercles des centrales) :

| Statut | Couleur | Code hex |
|---|---|---|
| AVAILABLE | Vert | `#2ECC71` |
| REDUCED | Orange | `#F59E0B` |
| OUTAGE_PLANNED | Bleu-ardoise discret | `#7B8CDE` |
| OUTAGE_UNPLANNED | Rouge crise | `#E74C3C` |
| UNKNOWN | Gris | `#6B7280` |
| Signal REMIT non confirmé | Noir analyste | `#111827` |

La couche `nuclear` est indépendante de la couche `infrastructure` (peuvent coexister).

---

## 9. Fallbacks & circuit breaker

| Source | Si down | Comportement UI |
|---|---|---|
| RTE OAuth API | `rteAvailable: false` | Cercles → gris UNKNOWN, badge `INDISPONIBLE`, aucun mock |
| IIP REMIT RSS | `remitAvailable: false` | Section REMIT masquée, badge `INDISPONIBLE` |
| Token OAuth expiré | Retry une fois, puis 502 | Log serveur, 502 propre vers frontend |
| Corrélation sans `nationalMix` | `nationalMix` absent | `gridTensionRisk: false`, pas de GRID_TENSION_RISK |

---

## 10. Limites connues

1. **Granularité tranche** : le `unitName` RTE n'est pas toujours normalisé. Le matching sur `NUCLEAR_PLANTS` peut être approximatif (`matchConfidence < 1.0`).
2. **REMIT fuzzy matching** : les noms courts ("Blayais") peuvent produire des faux positifs. `matchConfidence` exposé dans l'UI.
3. **Précision temporelle** : données RTE en plages horaires, pas en minutes.
4. **Fessenheim** : filtrée silencieusement (`status: 'shutdown'`), non affichée.
5. **Credentials manquants** : si `RTE_CLIENT_ID` absent en prod, le Vercel function retourne `503` explicite — aucune donnée fictive.

---

## 11. Ordre d'implémentation

1. Types (`types/index.ts`)
2. Vercel function + proxy Vite (`api/nuclear/rte-unavailability.js`, `plugins/nuclear-proxy.ts`)
3. `nuclear-rte.ts`
4. `nuclear-remit.ts`
5. `nuclear-correlation.ts`
6. `NuclearPanel.ts`
7. `DeckGLMap.ts` — couleurs dynamiques
8. `App.ts` — wiring (4 endroits + panel + service calls)
9. `LayerPanel.ts` — entrée nuclear
10. `npm run build && npm run typecheck`
