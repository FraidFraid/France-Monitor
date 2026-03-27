---
name: AIS Maritime Robuste v2
description: Robustesse connexion WebSocket AIS, état dégradé panel, search/filtres MaritimePanel, détection anomalies (radio silence + rendezvous)
type: spec
date: 2026-03-27
---

# Spec — AIS Maritime Robuste v2

## Contexte

`MaritimePanel.ts` et `military-ships.ts` existent et fonctionnent. Le flux AIS arrive via WebSocket sur `ws://localhost:8090` (relais local → aisstream.io). Trois lacunes à combler :

1. **Robustesse** — le relais est un single point of failure ; aucune reconnexion intelligente, panel silencieux si le relais tombe
2. **UX** — pas de search ni de filtres dans le panel (100+ navires non filtrables)
3. **OSINT** — aucune détection d'anomalies (radio silence, rendezvous suspects)

---

## 1. Architecture — Option B retenue

Séparation des responsabilités en trois couches :

| Couche | Fichier | Responsabilité |
|--------|---------|----------------|
| Connexion | `src/services/ais-connection.ts` (nouveau) | WebSocket lifecycle, reconnexion, statut |
| Data / Risk | `src/services/military-ships.ts` (existant, modifié) | Parse AIS, risk score, stores navires |
| Anomalies | `src/services/ais-anomalies.ts` (nouveau) | Radio silence + rendezvous |
| Panel | `src/components/MaritimePanel.ts` (existant, modifié) | Search, filtres, bannière stale |
| Toasts | `src/App.ts` (existant, modifié) | Câblage anomalies → toasts |

---

## 2. Connection Manager (`ais-connection.ts`)

### États

```
CONNECTING → CONNECTED → STALE → DISCONNECTED
                ↑______________|
```

- **CONNECTED** : messages reçus dans les dernières 2 min
- **STALE** : aucun message depuis > 2 min (relais silencieux)
- **DISCONNECTED** : WebSocket fermé ou erreur, en attente de reconnexion

### Reconnexion exponentielle

Formule : `delay = Math.min(1000 * 2 ** attempt, 30_000)` où `attempt` commence à 0 et s'incrémente à chaque échec. Reset à 0 au CONNECTED. Séquence : 1s → 2s → 4s → 8s → 16s → 30s (plafond).

**Note de migration** : remplace la formule existante dans `military-ships.ts` (`5000 * 1.5 ** attempt`) — changement délibéré pour un démarrage plus réactif (1s vs 5s).

### Timeout initial

Si aucun message dans les 10s après ouverture du WebSocket → passe en STALE immédiatement.

### Interface exportée

```typescript
// Défini et exporté depuis ais-connection.ts uniquement (pas re-exporté depuis types/index.ts)
export type AisConnectionStatus = 'connecting' | 'connected' | 'stale' | 'disconnected';

export function connectAis(): void;
export function disconnectAis(): void;
export function getAisConnectionStatus(): AisConnectionStatus;
export function getAisLastMessageTs(): number;       // Unix ms
export function onAisMessage(handler: (raw: string) => void): () => void;  // retourne unsubscribe
```

### Migration military-ships.ts

`military-ships.ts` cesse de gérer le WebSocket directement. Il s'abonne via `onAisMessage()` au démarrage et parse les messages comme avant. `getAisStatus()` délègue à `getAisConnectionStatus()`.

**Séquence de démarrage (App.ts)** :
1. `connectAis()` — ouvre le WebSocket (doit être appelé en premier)
2. `initMilitaryShips()` — appelle `onAisMessage(handler)` pour s'abonner; retourne l'unsubscribe
3. Les deux appelés dans `App.init()`, dans cet ordre

**Teardown** : `military-ships.ts` stocke le retour de `onAisMessage()` dans une variable module-level `_unsubscribeAis: (() => void) | null`. Exposer `destroyMilitaryShips()` qui appelle `_unsubscribeAis?.()` pour nettoyage propre.

---

## 3. MaritimePanel — État de connexion

Quand `getAisConnectionStatus()` retourne `stale` ou `disconnected` :

- Header du panel : opacité réduite (0.6)
- Bannière en haut des onglets :
  ```
  ⚠ AIS indisponible · dernier contact il y a X min
  ```
  Style : fond `#1a1a2e`, bordure gauche `#F59E0B`, texte `#FCD34D`
- Les ships en mémoire restent affichés avec badge "données figées" sur chaque item
- Retour à CONNECTED : bannière disparaît, opacité restaurée

---

## 4. Search + Filtres MaritimePanel

### Positionnement

Barre de recherche + chips insérées entre le header stats et les onglets (présentes sur les 3 onglets).

### Search

- Input text, placeholder : `Nom, MMSI…`
- Filtre client-side (sur la liste en mémoire) : `name` (contains), `mmsi` (startsWith)
- Case-insensitive, debounce 150ms
- Icône loupe, bouton ✕ pour effacer
- Note : le champ `country` de `MilitaryShip` contient `"ISO2|CountryName"` (ex: `"PA|Panama"`). Pour v2, la recherche ne porte pas sur le pavillon (le chip "Pavillon suspect" couvre ce cas via `riskLevel`).

### Filter chips

```
[Tous]  [Militaire]  [Risque élevé]  [Pavillon suspect]
```

- `Militaire` : navires dans `NAVY_MMSI_SET`
- `Risque élevé` : `riskLevel === 'high' || riskLevel === 'critical'` (champ `MilitaryShip.riskLevel`)
- `Pavillon suspect` : pavillon extrait de `country.split('|')[0]` dans `BLACK_LIST_FLAGS ∪ GREY_LIST_FLAGS ∪ SANCTIONED_FLAGS` (les trois sets de `risk-flags.ts`). Guard : `if (!ship.country || !ship.country.includes('|')) continue` — exclut les entrées sans country ou au format non-pipe (static Navy entries)
- Un seul chip actif à la fois (toggle, retour à `Tous` si re-clic)
- Search + chip combinables (ET logique)

### État

Persisté en session uniquement (pas localStorage). Réinitialisé à la fermeture du panel.

---

## 5. Détection d'anomalies (`ais-anomalies.ts`)

Détecteur stateful appelé à chaque cycle de polling (3s), pattern identique à `gps-jamming.ts`.

### 5.1 Radio silence

Seuils :
- Navire militaire (`NAVY_MMSI_SET`) absent > **10 min** → alerte
- Navire `riskLevel === 'high' || 'critical'` absent > **20 min** → alerte

Logique :
- `lastSeenTs: Map<string, number>` — timestamp Unix ms par MMSI, mis à jour à chaque message AIS valide
- `lastSeenPos: Map<string, [number, number]>` — dernière position `[lng, lat]` connue par MMSI (pour `AisAnomaly.position` quand le navire a disparu)
- Guard : `if (!ship.mmsi) continue` — les entrées sans MMSI (sous-marins statiques, etc.) sont ignorées
- Seuls les navires ayant émis au moins un message AIS live sont trackés (`lastSeenTs` est peuplé uniquement depuis les messages reçus). Les entrées statiques sans MMSI sont ignorées.
- Alerte émise une seule fois par événement (dedup `seenSilenceAlerts: Set<string>` avec clé = MMSI)
- Quand le navire réapparaît : supprimer son MMSI de `seenSilenceAlerts` pour permettre une nouvelle alerte à la prochaine disparition

### 5.2 Rendezvous suspects

Critères :
- Au moins un des deux navires est militaire (`NAVY_MMSI_SET`) ou `riskLevel === 'high' || 'critical'`
- Distance < **2 km** (haversine)
- Les deux en mouvement : `speed > 1 kt`
- Aucun des deux dans le rayon d'un port FR (`FRENCH_PORTS` config)

Complexité : O(n × m) avec n = navires militaires/risque (≤ ~30), m = trafic total.

Dedup : clé `${[mmsiA, mmsiB].sort().join('-')}` (ordre lexicographique pour éviter les doublons A-B / B-A), cooldown **30 min**.

### Interface exportée

**Localisation** : `AisAnomaly` est défini dans `src/types/index.ts` (source canonique). `ais-anomalies.ts` l'importe depuis `'../types/index.ts'`.

**Note sur les types** : les guards de filtrage (`riskLevel === 'high' || riskLevel === 'critical'`) opèrent sur `RiskLevel` (type local de `military-ships.ts`, valeurs : `'none'|'low'|'medium'|'high'|'critical'`). Le champ `AisAnomaly.severity` utilise `ThreatLevel` (de `types/index.ts`). Les deux types ont des valeurs communes mais ne sont pas identiques — `RiskLevel` a `'none'`, `ThreatLevel` a `'info'`. Ne pas les interchanger dans les guards TypeScript.

```typescript
// Dans src/types/index.ts
export interface AisAnomaly {
  id: string;                          // silence-${mmsi}-${ts} | rendez-${mmsiA}-${mmsiB}-${ts}
  type: 'radio_silence' | 'rendezvous';
  // severity assignée : radio_silence militaire → 'high' ; radio_silence risque → 'medium' ; rendezvous → 'medium'
  severity: ThreatLevel;               // ThreatLevel de types/index.ts
  position: [number, number];          // [lng, lat] — lastSeenPos pour radio_silence, centroïde pour rendezvous
  timestamp: number;                   // Unix milliseconds (Date.now()), convention codebase
  mmsis: string[];                     // 1 MMSI pour radio_silence, 2 pour rendezvous
  description: string;                 // texte FR pour toast, ex: "Silence radio · Dixmude · 14 min"
}

// Dans src/services/ais-anomalies.ts
import type { MilitaryShip, AisAnomaly } from '../types/index.ts';
export function detectAisAnomalies(ships: MilitaryShip[]): AisAnomaly[];
export function clearAisAnomalyState(): void;
```

### Intégration App.ts

À chaque cycle de polling AIS (3s) :
```typescript
const anomalies = detectAisAnomalies(getAllLiveTraffic());
anomalies.forEach(a => this.toastNotification?.showAisAnomaly(a));
```

Toast cliquable : flyTo position + ouverture onglet Alertes du MaritimePanel.

### `showAisAnomaly()` — contrat ToastNotification

```typescript
// Méthode d'abonnement (pattern identique à setOnJammingSignalClick)
setOnAisAnomalyClick(handler: (anomaly: AisAnomaly) => void): void;

// Affichage toast
showAisAnomaly(anomaly: AisAnomaly): void;
```

- **Icône/couleur** : `radio_silence` → `🔇` + bordure `#EF4444` (rouge) ; `rendezvous` → `⚓` + bordure `#F59E0B` (ambre)
- **Durée** : 10s (auto-dismiss), sauf si l'utilisateur survole (pause au hover)
- **Dedup** : une seule toast active par `anomaly.id` — si `seenAnomalyIds.has(id)`, ignorer
- **Corps** : `anomaly.description`
- **Bouton "Voir"** : déclenche le handler enregistré via `setOnAisAnomalyClick()`
- **Handler payload (App.ts)** : `flyTo(anomaly.position[0], anomaly.position[1], 10)` + `maritimePanel?.openAlertsTab()`

### `openAlertsTab()` — contrat MaritimePanel

```typescript
openAlertsTab(): void;
```

Bascule programmatiquement l'onglet actif vers "Alertes" (3ème onglet). Identique au clic utilisateur sur le tab "Alertes". Utilisé par le handler de toast AIS.

---

## 6. Fichiers créés/modifiés

| Fichier | Action |
|---------|--------|
| `src/services/ais-connection.ts` | CRÉÉ — WebSocket manager |
| `src/services/ais-anomalies.ts` | CRÉÉ — détection radio silence + rendezvous |
| `src/services/military-ships.ts` | MODIFIÉ — délègue WebSocket à ais-connection |
| `src/components/MaritimePanel.ts` | MODIFIÉ — bannière stale, search, filter chips |
| `src/components/ToastNotification.ts` | MODIFIÉ — `showAisAnomaly()` |
| `src/App.ts` | MODIFIÉ — câblage anomalies, handler toast click |
| `src/types/index.ts` | MODIFIÉ — `AisAnomaly` uniquement (`AisConnectionStatus` reste dans `ais-connection.ts`) |

---

## 7. Ce qui n'est PAS dans cette spec

- Fallback API REST (aisstream.io HTTP) — hors scope v2
- Clustering carte pour 100+ navires — hors scope v2
- Modification de DeckGLMap — hors scope v2
