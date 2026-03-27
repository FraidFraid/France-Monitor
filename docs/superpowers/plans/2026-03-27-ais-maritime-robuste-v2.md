# AIS Maritime Robuste v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extraire la gestion WebSocket AIS dans un module dédié, afficher l'état de connexion dans MaritimePanel, ajouter search/filtres, et détecter les anomalies AIS (radio silence + rendezvous) avec toasts cliquables.

**Architecture:** `ais-connection.ts` gère le lifecycle WebSocket (reconnexion exponentielle, état CONNECTING/CONNECTED/STALE/DISCONNECTED). `military-ships.ts` se désabonne de la gestion WS et s'abonne via `onAisMessage()`. `ais-anomalies.ts` détecte les anomalies en comparant les snapshots de `getAllLiveTraffic()`. MaritimePanel et ToastNotification sont mis à jour pour consommer ces nouvelles APIs.

**Tech Stack:** Vanilla TypeScript strict, Vite, pas de test runner — vérification par `npm run typecheck && npm run build`.

**Spec:** `docs/superpowers/specs/2026-03-27-ais-maritime-robuste-v2-design.md`

---

## File Map

| Fichier | Action | Responsabilité |
|---------|--------|----------------|
| `src/services/ais-connection.ts` | CRÉER | WebSocket lifecycle, pub/sub, statut |
| `src/services/military-ships.ts` | MODIFIER | Supprimer WS, s'abonner via onAisMessage |
| `src/types/index.ts` | MODIFIER | Ajouter interface `AisAnomaly` |
| `src/services/ais-anomalies.ts` | CRÉER | Détection radio silence + rendezvous |
| `src/components/MaritimePanel.ts` | MODIFIER | Bannière stale, search, filter chips, openAlertsTab |
| `src/components/ToastNotification.ts` | MODIFIER | showAisAnomaly + setOnAisAnomalyClick |
| `src/App.ts` | MODIFIER | connectAis() au démarrage, câblage anomalies |

---

## Task 1 — `ais-connection.ts` : Connection Manager

**Files:**
- Create: `src/services/ais-connection.ts`

### Contexte pour l'implémenteur

`military-ships.ts` gère actuellement lui-même le WebSocket (lignes 226–426). Ce module extrait cette responsabilité. Il expose un système pub/sub : n'importe quel subscriber peut appeler `onAisMessage(handler)` pour recevoir les messages bruts, et retourne une fonction d'unsubscribe.

La machine d'états :
- `'connecting'` → ouverture en cours
- `'connected'` → messages reçus dans les 2 dernières minutes
- `'stale'` → connecté mais aucun message depuis > 2 min
- `'disconnected'` → fermé, en attente de reconnexion

- [ ] **Step 1 : Créer `src/services/ais-connection.ts`**

```typescript
/**
 * ais-connection.ts — WebSocket lifecycle manager pour le relais AIS local.
 *
 * Gère la connexion à ws://localhost:8090 avec :
 *  - Machine d'états CONNECTING / CONNECTED / STALE / DISCONNECTED
 *  - Reconnexion exponentielle : delay = Math.min(1000 * 2 ** attempt, 30_000)
 *  - Timeout initial : si aucun message dans 10s → STALE
 *  - Pub/sub : onAisMessage() pour distribuer les messages bruts
 *
 * Note : AisConnectionStatus est défini ici (pas dans types/index.ts).
 * military-ships.ts importe ce type pour compatibilité.
 */

export type AisConnectionStatus = 'connecting' | 'connected' | 'stale' | 'disconnected';

export const AIS_RELAY_URL = 'ws://localhost:8090';

const STALE_THRESHOLD_MS = 2 * 60 * 1000;   // 2 min sans message → STALE
const INITIAL_TIMEOUT_MS = 10_000;            // 10s pour le 1er message après open
const STALE_CHECK_INTERVAL_MS = 15_000;       // Vérifie l'état toutes les 15s

let _status: AisConnectionStatus = 'disconnected';
let _lastMessageTs = 0;
let _reconnectAttempt = 0;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _staleCheckTimer: ReturnType<typeof setInterval> | null = null;
let _ws: WebSocket | null = null;

const _subscribers = new Set<(raw: string) => void>();

function _setStatus(s: AisConnectionStatus): void {
    _status = s;
}

/** Retourne l'état courant de la connexion AIS. */
export function getAisConnectionStatus(): AisConnectionStatus {
    return _status;
}

/** Retourne le timestamp (Unix ms) du dernier message AIS reçu. */
export function getAisLastMessageTs(): number {
    return _lastMessageTs;
}

/**
 * S'abonne aux messages AIS bruts.
 * Retourne une fonction d'unsubscribe — appelée lors du teardown.
 *
 * @example
 *   const unsub = onAisMessage(raw => parseAisMessage(raw));
 *   // Plus tard :
 *   unsub();
 */
export function onAisMessage(handler: (raw: string) => void): () => void {
    _subscribers.add(handler);
    return () => _subscribers.delete(handler);
}

function _startStaleCheck(): void {
    if (_staleCheckTimer) return;
    _staleCheckTimer = setInterval(() => {
        if (_status !== 'connected') return;
        if (Date.now() - _lastMessageTs > STALE_THRESHOLD_MS) {
            _setStatus('stale');
        }
    }, STALE_CHECK_INTERVAL_MS);
}

/** Ouvre le WebSocket. Idempotent si déjà en cours de connexion ou connecté. */
export function connectAis(): void {
    if (_ws && (_ws.readyState === WebSocket.CONNECTING || _ws.readyState === WebSocket.OPEN)) return;

    _setStatus('connecting');

    try {
        _ws = new WebSocket(AIS_RELAY_URL);

        // Si aucun message reçu dans les 10s après open, passer en STALE
        const initialTimeout = setTimeout(() => {
            if (_status === 'connecting' || (_status === 'connected' && _lastMessageTs === 0)) {
                _setStatus('stale');
            }
        }, INITIAL_TIMEOUT_MS);

        _ws.onopen = () => {
            clearTimeout(initialTimeout);
            _reconnectAttempt = 0;
            _setStatus('connected');
            _startStaleCheck();
            console.log('[AIS] ✅ Connecté au relais local', AIS_RELAY_URL);
        };

        _ws.onmessage = (evt: MessageEvent) => {
            _lastMessageTs = Date.now();
            // Récupération automatique depuis STALE si messages reprennent
            if (_status === 'stale') _setStatus('connected');
            for (const sub of _subscribers) {
                try { sub(evt.data as string); } catch { /* subscriber error — silencieux */ }
            }
        };

        _ws.onerror = () => {
            _setStatus('disconnected');
        };

        _ws.onclose = () => {
            _ws = null;
            if (_status !== 'disconnected') _setStatus('disconnected');
            // Reconnexion exponentielle : 1s → 2s → 4s → ... → 30s
            const delay = Math.min(1000 * (2 ** _reconnectAttempt), 30_000);
            _reconnectAttempt++;
            console.log(`[AIS] Reconnexion dans ${delay}ms (tentative ${_reconnectAttempt})`);
            _reconnectTimer = setTimeout(() => connectAis(), delay);
        };

    } catch (err) {
        console.error('[AIS] Échec critique connexion relais:', err);
        _setStatus('disconnected');
    }
}

/** Ferme le WebSocket et annule toute reconnexion planifiée. */
export function disconnectAis(): void {
    if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
    if (_staleCheckTimer) { clearInterval(_staleCheckTimer); _staleCheckTimer = null; }
    if (_ws) { _ws.onclose = null; _ws.close(); _ws = null; }
    _setStatus('disconnected');
    _reconnectAttempt = 0;
}
```

- [ ] **Step 2 : Vérifier le typecheck**

```bash
npm run typecheck
```

Attendu : PASS (0 erreur). Si erreur TypeScript, corriger avant de continuer.

- [ ] **Step 3 : Commit**

```bash
git add src/services/ais-connection.ts
git commit -m "feat(ais): add ais-connection.ts — WebSocket manager avec reconnexion exponentielle"
```

---

## Task 2 — Migrer `military-ships.ts`

**Files:**
- Modify: `src/services/military-ships.ts`

### Contexte pour l'implémenteur

`military-ships.ts` contient actuellement (lignes 226–447) :
- La fonction `connectAisStream()` avec toute la logique WebSocket (open/message/error/close)
- Des variables module-level : `wsConnected`, `reconnectAttempts`, `lastMessageTs`, `MAX_RECONNECT_DELAY`
- Un `if (typeof window !== 'undefined') { setTimeout(connectAisStream, 2000) }` auto-start

Tout cela doit être remplacé par une subscription à `onAisMessage()`. La logique de parsing (le corps de `ws.onmessage`) reste dans ce fichier, extraite dans une fonction `_handleAisMessage(raw: string)`.

`getAisStatus()` et `getAisConnectionState()` doivent déléguer au nouveau module.

L'auto-start (setTimeout) est supprimé — c'est `App.ts` qui appelle `connectAis()`.

- [ ] **Step 1 : Ajouter l'import ais-connection au début du fichier**

En haut de `src/services/military-ships.ts`, après les imports existants :

```typescript
import {
    onAisMessage,
    getAisConnectionStatus,
    getAisLastMessageTs,
    AIS_RELAY_URL as _AIS_RELAY_URL,
    type AisConnectionStatus,
} from './ais-connection.ts';
```

Supprimer la ligne actuelle qui déclare `AIS_RELAY_URL` :
```typescript
// SUPPRIMER cette ligne :
export const AIS_RELAY_URL = 'ws://localhost:8090';
```

Ajouter à la place une re-export pour que App.ts puisse continuer à l'importer depuis military-ships :
```typescript
export { AIS_RELAY_URL as AIS_RELAY_URL } from './ais-connection.ts';
```

Note : App.ts importe `AIS_RELAY_URL` depuis `'./services/military-ships.ts'` (ligne 50 de App.ts). Ce re-export maintient la compatibilité sans toucher App.ts dans cette tâche.

- [ ] **Step 2 : Supprimer les variables module-level WebSocket**

Supprimer ces 4 lignes (autour de la ligne 155 de military-ships.ts) :
```typescript
// SUPPRIMER :
let wsConnected = false;
let reconnectAttempts = 0;
let lastMessageTs: number | null = null;
const MAX_RECONNECT_DELAY = 30000;
```

Supprimer aussi `let wsMessageCount = 0;` (ligne 166).

- [ ] **Step 3 : Extraire la logique de parsing dans `_handleAisMessage`**

Supprimer toute la fonction `connectAisStream()` (lignes 226–426 environ). À sa place, créer la fonction `_handleAisMessage` en copiant le **corps du `ws.onmessage`** (la callback, sans le wrapper `ws.onmessage = (evt) => {}`). Elle prend le message brut en paramètre :

```typescript
// ─── Handler AIS messages (abonné via ais-connection.ts) ────────────────────

let _wsMessageCount = 0;

function _handleAisMessage(raw: string): void {
    _wsMessageCount++;
    if (_wsMessageCount === 1) {
        console.log('[AIS] 📡 Premier message reçu du relais');
    } else if (_wsMessageCount === 50) {
        console.log(`[AIS] 📡 50 messages reçus — ${livePositions.size} navires en cache`);
    }

    try {
        const msg = JSON.parse(raw) as Record<string, unknown>;
        // ... (coller ici le corps de l'ancien ws.onmessage, de "if (msg.MessageType..." à la fin)
        // Le code de parsing est identique — remplacer seulement "evt.data" par "raw"
    } catch { /* silencieux */ }
}
```

**Important** : dans le corps copié, remplacer `evt.data` par `raw`.

- [ ] **Step 4 : Supprimer l'auto-start et le reconnectAis export**

Supprimer le bloc auto-start (autour des lignes 428–434) :
```typescript
// SUPPRIMER ce bloc entier :
if (typeof window !== 'undefined') {
    setTimeout(() => {
        connectAisStream();
    }, 2000);
    // ... (le setInterval de nettoyage doit rester !)
}
```

**Garder uniquement le `setInterval` de nettoyage** des positions stale (toutes les 5 min) — supprimer seulement l'appel `connectAisStream()` dans le setTimeout. Le setInterval de nettoyage est une ligne séparée dans le même bloc `if (typeof window !== 'undefined')` et doit être conservé.

Supprimer la fonction `reconnectAis()` (lignes 511–515) — elle n'a plus de sens sans le WebSocket local.

- [ ] **Step 5 : Abonner military-ships au démarrage + exposer destroyMilitaryShips**

Après le bloc de nettoyage `setInterval`, ajouter l'abonnement et le teardown :

```typescript
// ─── Abonnement AIS messages ──────────────────────────────────────────────
// Le subscriber est enregistré au chargement du module.
// connectAis() doit être appelé par App.ts pour ouvrir le WebSocket.
let _unsubscribeAis: (() => void) | null = null;

if (typeof window !== 'undefined') {
    _unsubscribeAis = onAisMessage(_handleAisMessage);
}

/** Détache le subscriber AIS (appelé lors du teardown de l'app). */
export function destroyMilitaryShips(): void {
    _unsubscribeAis?.();
    _unsubscribeAis = null;
}
```

- [ ] **Step 6 : Mettre à jour `getAisStatus()` et `getAisConnectionState()`**

Remplacer le corps des deux fonctions pour déléguer à `ais-connection.ts` :

```typescript
export function getAisStatus(): { connected: boolean; shipCount: number; messageCount: number; hasApiKey: boolean } {
    return {
        connected: getAisConnectionStatus() === 'connected',
        shipCount: livePositions.size,
        messageCount: _wsMessageCount,
        hasApiKey: Boolean(AISSTREAM_KEY),
    };
}

export function getAisConnectionState(): {
    connected: boolean;
    shipCount: number;
    franceShipCount: number;
    reconnectAttempts: number;
    lastMessageAt: number | null;
    status: AisConnectionStatus;
} {
    const lastTs = getAisLastMessageTs();
    return {
        connected: getAisConnectionStatus() === 'connected',
        shipCount: livePositions.size,
        franceShipCount: Array.from(livePositions.values()).filter(p => isInFranceZone(p.lat, p.lon)).length,
        reconnectAttempts: 0,    // géré par ais-connection.ts — non exposé ici
        lastMessageAt: lastTs > 0 ? lastTs : null,
        status: getAisConnectionStatus(),
    };
}
```

- [ ] **Step 7 : Mettre à jour aisDebug dans window**

Dans le bloc `window.aisDebug`, remplacer `reconnect: () => reconnectAis()` par :

```typescript
reconnect: () => { void import('./ais-connection.ts').then(m => m.connectAis()); },
```

Ou plus simplement : supprimer l'entrée `reconnect` du debug object.

- [ ] **Step 8 : Typecheck**

```bash
npm run typecheck
```

Attendu : 0 erreur. Erreurs fréquentes à ce stade :
- `wsConnected` référencé quelque part → chercher avec grep et remplacer par `getAisConnectionStatus() === 'connected'`
- `reconnectAttempts` référencé → supprimer ou remplacer par 0
- `lastMessageTs` référencé → remplacer par `getAisLastMessageTs()`

- [ ] **Step 9 : Commit**

```bash
git add src/services/military-ships.ts src/services/ais-connection.ts
git commit -m "feat(ais): migrer military-ships.ts — délègue WebSocket à ais-connection.ts"
```

---

## Task 3 — `AisAnomaly` type + `ais-anomalies.ts`

**Files:**
- Modify: `src/types/index.ts`
- Create: `src/services/ais-anomalies.ts`

### Contexte pour l'implémenteur

Le détecteur est stateful (pattern identique à `src/services/gps-jamming.ts`). Il est appelé à chaque cycle de polling AIS (5s dans App.ts) avec la liste courante de navires. Il maintient des Maps internes pour tracer les timestamps de dernière vue et les cooldowns.

**Radio silence** : un navire militaire absent du flux AIS pendant > 10 min déclenche une alerte `'high'`. Un navire civil à risque (`riskLevel === 'high' || 'critical'`) absent > 20 min déclenche `'medium'`.

**Rendezvous** : deux navires dont au moins un est militaire/risque, à < 2 km, tous deux en mouvement (speed > 1 kt), hors port.

- [ ] **Step 1 : Ajouter `AisAnomaly` dans `src/types/index.ts`**

À la fin du fichier `src/types/index.ts`, après l'interface `GpsJammingSignal` existante, ajouter :

```typescript
// ═══ AIS Anomalies ═══

export interface AisAnomaly {
    id: string;                          // silence-${mmsi}-${ts} | rendez-${mmsiA}-${mmsiB}-${ts}
    type: 'radio_silence' | 'rendezvous';
    // severity : radio_silence militaire → 'high', radio_silence risque → 'medium', rendezvous → 'medium'
    severity: ThreatLevel;
    position: [number, number];          // [lng, lat] — lastSeenPos pour silence, centroïde pour rendezvous
    timestamp: number;                   // Unix milliseconds (Date.now())
    mmsis: string[];                     // 1 MMSI pour silence, 2 pour rendezvous
    description: string;                 // Texte FR pour toast, ex: "Silence radio · Dixmude · 14 min"
}
```

- [ ] **Step 2 : Vérifier typecheck après l'ajout du type**

```bash
npm run typecheck
```

Attendu : 0 erreur.

- [ ] **Step 3 : Créer `src/services/ais-anomalies.ts`**

```typescript
/**
 * ais-anomalies.ts — Détection d'anomalies AIS.
 *
 * Détecte :
 *  1. Radio silence : navire militaire / risque absent du flux AIS trop longtemps
 *  2. Rendezvous suspect : deux navires (dont un militaire/risque) < 2 km hors port
 *
 * Détecteur stateful — appeler à chaque cycle de polling AIS avec getAllLiveTraffic().
 *
 * Convention coordonnées : [lng, lat] (GeoJSON, cohérent avec le reste du projet).
 * Convention timestamps   : milliseconds Unix (Date.now()).
 */

import { NAVY_MMSI_SET, type MilitaryShip, type RiskLevel } from './military-ships.ts';
import { FRENCH_PORTS } from '../config/french-ports.ts';
import type { AisAnomaly, ThreatLevel } from '../types/index.ts';

// ─── Seuils ──────────────────────────────────────────────────────────────────

const SILENCE_MILITARY_MS  = 10 * 60 * 1000;  // 10 min pour navire militaire
const SILENCE_HIGH_RISK_MS = 20 * 60 * 1000;  // 20 min pour navire risque élevé
const RENDEZVOUS_DIST_KM   = 2;               // Distance max rendezvous (km)
const RENDEZVOUS_MIN_SPEED = 1;               // Vitesse min des deux navires (kts)
const RENDEZVOUS_COOLDOWN_MS = 30 * 60 * 1000; // 30 min entre deux alertes pour la même paire

// ─── State interne ──────────────────────────────────────────────────────────

/** Dernier timestamp de message AIS par MMSI (ms Unix). */
const lastSeenTs  = new Map<string, number>();
/** Dernière position connue par MMSI (pour renseigner AisAnomaly.position quand disparu). */
const lastSeenPos = new Map<string, [number, number]>();
/** MMSIs pour lesquels une alerte de silence a déjà été émise (évite le spam). */
const seenSilenceAlerts = new Set<string>();
/** Cooldowns actifs pour les paires de rendezvous : clé → timestamp d'expiry. */
const rendezvousCooldowns = new Map<string, number>();

// ─── Utilitaires ─────────────────────────────────────────────────────────────

/** Distance haversine en kilomètres entre deux points [lng, lat]. */
function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(a));
}

/** Retourne true si le point est dans le rayon d'un port français. */
function isNearFrenchPort(lat: number, lon: number): boolean {
    for (const port of FRENCH_PORTS) {
        if (haversineKm(lon, lat, port.lon, port.lat) <= port.radiusKm) return true;
    }
    return false;
}

function isHighRisk(riskLevel: RiskLevel | undefined): boolean {
    return riskLevel === 'high' || riskLevel === 'critical';
}

/** Formate un délai en minutes pour la description du toast. */
function formatElapsedMin(elapsedMs: number): string {
    return `${Math.round(elapsedMs / 60_000)} min`;
}

// ─── API publique ─────────────────────────────────────────────────────────────

/**
 * Détecte les anomalies AIS dans la liste courante de navires.
 * Appeler à chaque cycle de polling (tous les 5s dans App.ts).
 *
 * @param ships  Résultat de getAllLiveTraffic() — liste des navires AIS actifs
 * @returns      Anomalies à signaler (nouvelles uniquement, dédupliquées)
 */
export function detectAisAnomalies(ships: MilitaryShip[]): AisAnomaly[] {
    const nowMs = Date.now();
    const nowSec = Math.round(nowMs / 1000);
    const anomalies: AisAnomaly[] = [];

    // ── Mise à jour de l'état lastSeen ────────────────────────────────────────
    // Les navires présents dans le flux courant sont "vus maintenant"
    for (const ship of ships) {
        if (!ship.mmsi) continue;
        lastSeenTs.set(ship.mmsi, nowMs);
        lastSeenPos.set(ship.mmsi, [ship.lon, ship.lat]);
        // Si le navire réapparaît après un silence : effacer son alerte
        // pour permettre une nouvelle alerte lors d'une prochaine disparition
        if (seenSilenceAlerts.has(ship.mmsi)) {
            seenSilenceAlerts.delete(ship.mmsi);
        }
    }

    // ── 1. Radio silence ──────────────────────────────────────────────────────
    for (const [mmsi, lastTs] of lastSeenTs) {
        const elapsed = nowMs - lastTs;
        const isMilitary = NAVY_MMSI_SET.has(mmsi);

        // Récupérer le riskLevel depuis le dernier snapshot en mémoire
        // Note : si le navire a disparu du flux, on lit son riskLevel depuis la
        // liste courante (ne sera pas là) → utiliser la Map séparée ou ignorer.
        // Simplification : seuls les navires militaires sont surveillés ici,
        // car pour les civils on n'a pas de riskLevel persisté hors du flux.
        // Les civils à risque sont dans le flux courant — s'ils n'y sont plus,
        // on ne peut pas lire leur riskLevel. Pour v2 : surveiller seulement militaires.

        if (!isMilitary) continue;
        // ── v2 scope note ──────────────────────────────────────────────────────
        // La spec mentionne aussi les civils à risque élevé (riskLevel high/critical),
        // mais riskLevel n'est pas persisté hors du flux live — si le navire a disparu,
        // on n'a plus accès à son riskLevel. Radio silence pour civils reporté en v3.
        // ──────────────────────────────────────────────────────────────────────

        const threshold = SILENCE_MILITARY_MS;
        if (elapsed < threshold) continue;
        if (seenSilenceAlerts.has(mmsi)) continue;

        // Retrouver le nom du navire depuis la liste FRENCH_NAVY_SHIPS (via import indirect)
        // On utilise le MMSI pour trouver le nom dans lastSeenPos companion — on n'a pas le nom.
        // Simplification : utiliser le MMSI tronqué dans le label si pas de nom disponible.
        const pos = lastSeenPos.get(mmsi);
        if (!pos) continue;  // Jamais vu en position — ne pas alerter

        seenSilenceAlerts.add(mmsi);
        const idx = anomalies.length;
        anomalies.push({
            id: `silence-${mmsi}-${nowSec}-${idx}`,
            type: 'radio_silence',
            severity: 'high' as ThreatLevel,
            position: pos,
            timestamp: nowMs,
            mmsis: [mmsi],
            description: `Silence radio · MMSI ${mmsi} · ${formatElapsedMin(elapsed)}`,
        });
    }

    // ── 2. Rendezvous suspects ────────────────────────────────────────────────
    // Construire la liste des navires à surveiller (militaires + risque élevé)
    const watchedShips = ships.filter(s =>
        s.mmsi && (NAVY_MMSI_SET.has(s.mmsi) || isHighRisk(s.riskLevel))
    );

    for (const watched of watchedShips) {
        if (!watched.mmsi) continue;
        if ((watched.speed ?? 0) < RENDEZVOUS_MIN_SPEED) continue;
        if (isNearFrenchPort(watched.lat, watched.lon)) continue;

        for (const other of ships) {
            if (!other.mmsi || other.mmsi === watched.mmsi) continue;
            if ((other.speed ?? 0) < RENDEZVOUS_MIN_SPEED) continue;
            if (isNearFrenchPort(other.lat, other.lon)) continue;

            const distKm = haversineKm(watched.lon, watched.lat, other.lon, other.lat);
            if (distKm >= RENDEZVOUS_DIST_KM) continue;

            // Clé lexicographique pour éviter les doublons A-B / B-A
            const key = [watched.mmsi, other.mmsi].sort().join('-');
            const cooldownExpiry = rendezvousCooldowns.get(key) ?? 0;
            if (nowMs < cooldownExpiry) continue;

            rendezvousCooldowns.set(key, nowMs + RENDEZVOUS_COOLDOWN_MS);
            const centLon = (watched.lon + other.lon) / 2;
            const centLat = (watched.lat + other.lat) / 2;
            const idx = anomalies.length;
            anomalies.push({
                id: `rendez-${key}-${nowSec}-${idx}`,
                type: 'rendezvous',
                severity: 'medium' as ThreatLevel,
                position: [centLon, centLat],
                timestamp: nowMs,
                mmsis: [watched.mmsi, other.mmsi],
                description: `Rendezvous suspect · ${distKm.toFixed(1)} km · ${watched.name ?? watched.mmsi} / ${other.name ?? other.mmsi}`,
            });
        }
    }

    return anomalies;
}

/** Remet à zéro l'état interne (utile pour les tests ou un restart de session). */
export function clearAisAnomalyState(): void {
    lastSeenTs.clear();
    lastSeenPos.clear();
    seenSilenceAlerts.clear();
    rendezvousCooldowns.clear();
}
```

**Note importante sur le champ `name`** : dans `detectAisAnomalies`, quand on construit la description de radio silence, on n'a plus accès au nom du navire (il a disparu du flux). Pour v2 on utilise le MMSI. Si le nom est nécessaire dans une version future, il faudra une Map `lastSeenName` supplémentaire.

- [ ] **Step 4 : Vérifier typecheck**

```bash
npm run typecheck
```

Erreurs possibles :
- `FRENCH_PORTS` non exporté depuis `french-ports.ts` → vérifier avec grep : `grep -n "export" src/config/french-ports.ts`
- `RiskLevel` non importable depuis `military-ships.ts` → ajouter à l'import

- [ ] **Step 5 : Commit**

```bash
git add src/types/index.ts src/services/ais-anomalies.ts
git commit -m "feat(ais): add AisAnomaly type + ais-anomalies.ts — radio silence & rendezvous detection"
```

---

## Task 4 — Mettre à jour `MaritimePanel.ts`

**Files:**
- Modify: `src/components/MaritimePanel.ts`

### Contexte pour l'implémenteur

**Trois modifications indépendantes** dans ce fichier :

1. **Bannière stale** : un élément DOM persistant, visible uniquement quand `getAisConnectionStatus()` retourne `'stale'` ou `'disconnected'`. Il est inseré dans le panel après la tab bar et avant `bodyEl`.

2. **Search + filter chips** : une barre de recherche + 4 chips insérées entre le header et la tab bar dans `mount()`. La valeur du search et du chip actif sont stockés en propriétés privées et utilisés dans `_renderTraffic()`, `_renderNavy()`, `_renderAlerts()` pour filtrer les listes.

3. **`openAlertsTab()` public** : une ligne — appelle `_switchTab('alerts')`.

- [ ] **Step 1 : Ajouter les imports nécessaires**

En haut de `src/components/MaritimePanel.ts`, après l'import existant de `military-ships.ts` :

```typescript
import { getAisConnectionStatus, getAisLastMessageTs } from '../services/ais-connection.ts';
import { BLACK_LIST_FLAGS, GREY_LIST_FLAGS, SANCTIONED_FLAGS } from '../config/risk-flags.ts';
```

- [ ] **Step 2 : Ajouter les propriétés privées de filtrage**

Dans la classe `MaritimePanel`, après `private trafficBatchSize = 20;` :

```typescript
private _searchQuery = '';
private _activeFilter: 'all' | 'military' | 'high' | 'suspect' = 'all';
private _staleBannerEl: HTMLElement | null = null;
```

- [ ] **Step 3 : Ajouter `openAlertsTab()` public**

Après la méthode `openShipModal()` existante :

```typescript
/** Bascule programmatiquement vers l'onglet Alertes. Utilisé par les toasts AIS. */
openAlertsTab(): void {
    if (!this.containerEl) this.mount();
    this._switchTab('alerts');
    if (!this.isVisible) this.show();
}
```

- [ ] **Step 4 : Ajouter la barre search + filter chips dans `mount()`**

**Ordre DOM** : search → tabBar → bannière stale → bodyEl. Les steps 4 et 5 modifient tous deux `mount()` — appliquer Step 4 en premier (position avant tabBar dans le code), puis Step 5 (position après tabBar).

Dans la méthode `mount()`, **avant** le bloc qui crée `tabBar` (ligne ~137), insérer :

```typescript
// Search + filter chips (position DOM : avant tabBar)
const searchRow = document.createElement('div');
```

- [ ] **Step 5 : Ajouter la bannière stale dans `mount()`**

Dans la méthode `mount()`, **après** le bloc qui crée et appende `tabBar` (ligne ~153), **avant** la création de `bodyEl`, insérer :

```typescript
// Bannière état stale (cachée par défaut, position DOM : après tabBar)
this._staleBannerEl = document.createElement('div');
this._staleBannerEl.style.cssText = [
    'display:none',
    'padding:6px 12px',
    'background:#0f0f1a',
    'border-left:3px solid #F59E0B',
    'color:#FCD34D',
    'font-size:10px',
    'flex-shrink:0',
].join(';');
this.containerEl.appendChild(this._staleBannerEl);
```

```typescript
// Search + filter chips
const searchRow = document.createElement('div');
searchRow.style.cssText = 'padding:6px 12px 4px;display:flex;flex-direction:column;gap:4px;border-bottom:1px solid var(--border-color);flex-shrink:0;';

const searchWrap = document.createElement('div');
searchWrap.style.cssText = 'position:relative;';
const searchInput = document.createElement('input');
searchInput.type = 'text';
searchInput.placeholder = 'Nom, MMSI…';
searchInput.style.cssText = [
    'width:100%',
    'box-sizing:border-box',
    'background:rgba(255,255,255,0.06)',
    'border:1px solid var(--border-color)',
    'border-radius:6px',
    'color:var(--text-primary)',
    'font-size:11px',
    'padding:5px 28px 5px 8px',
    'outline:none',
].join(';');
const clearBtn = document.createElement('button');
clearBtn.textContent = '✕';
clearBtn.style.cssText = [
    'position:absolute',
    'right:6px',
    'top:50%',
    'transform:translateY(-50%)',
    'background:none',
    'border:none',
    'color:var(--text-muted)',
    'cursor:pointer',
    'font-size:10px',
    'display:none',
    'padding:0',
].join(';');
searchInput.addEventListener('input', () => {
    this._searchQuery = searchInput.value.trim().toLowerCase();
    clearBtn.style.display = this._searchQuery ? 'block' : 'none';
    this._renderCurrentTab();
});
clearBtn.addEventListener('click', () => {
    searchInput.value = '';
    this._searchQuery = '';
    clearBtn.style.display = 'none';
    this._renderCurrentTab();
});
searchWrap.appendChild(searchInput);
searchWrap.appendChild(clearBtn);

const chipsRow = document.createElement('div');
chipsRow.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;';
const chipDefs: Array<{ key: typeof this._activeFilter; label: string }> = [
    { key: 'all', label: 'Tous' },
    { key: 'military', label: 'Militaire' },
    { key: 'high', label: 'Risque élevé' },
    { key: 'suspect', label: 'Pavillon suspect' },
];
for (const { key, label } of chipDefs) {
    const chip = document.createElement('button');
    chip.id = `mchip-${key}`;
    chip.textContent = label;
    chip.style.cssText = [
        'background:rgba(255,255,255,0.06)',
        'border:1px solid var(--border-color)',
        'border-radius:12px',
        'color:var(--text-muted)',
        'cursor:pointer',
        'font-size:9px',
        'padding:2px 8px',
    ].join(';');
    chip.addEventListener('click', () => {
        this._activeFilter = this._activeFilter === key ? 'all' : key;
        this._updateChipStyles();
        this._renderCurrentTab();
    });
    chipsRow.appendChild(chip);
}
searchRow.appendChild(searchWrap);
searchRow.appendChild(chipsRow);
this.containerEl.appendChild(searchRow);

this._updateChipStyles();
```

- [ ] **Step 6 : Ajouter `_updateChipStyles()` et `_applyFilters()` privées**

Ajouter deux méthodes privées dans la classe (avant `_switchTab`) :

```typescript
private _updateChipStyles(): void {
    const chips: Array<typeof this._activeFilter> = ['all', 'military', 'high', 'suspect'];
    for (const key of chips) {
        const chip = this.containerEl?.querySelector(`#mchip-${key}`) as HTMLElement | null;
        if (!chip) continue;
        const active = this._activeFilter === key;
        chip.style.background = active ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.06)';
        chip.style.color = active ? 'var(--text-primary)' : 'var(--text-muted)';
        chip.style.borderColor = active ? 'rgba(255,255,255,0.3)' : 'var(--border-color)';
    }
}

private _applyFilters(ships: MilitaryShip[]): MilitaryShip[] {
    let result = ships;

    // Chip filter
    if (this._activeFilter === 'military') {
        result = result.filter(s => s.mmsi && NAVY_MMSI_SET.has(s.mmsi));
    } else if (this._activeFilter === 'high') {
        result = result.filter(s => s.riskLevel === 'high' || s.riskLevel === 'critical');
    } else if (this._activeFilter === 'suspect') {
        result = result.filter(s => {
            if (!s.country || !s.country.includes('|')) return false;
            const iso2 = s.country.split('|')[0] ?? '';
            return BLACK_LIST_FLAGS.has(iso2) || GREY_LIST_FLAGS.has(iso2) || SANCTIONED_FLAGS.has(iso2);
        });
    }

    // Search filter (name ou mmsi)
    if (this._searchQuery) {
        const q = this._searchQuery;
        result = result.filter(s =>
            s.name.toLowerCase().includes(q) ||
            (s.mmsi?.startsWith(q) ?? false)
        );
    }

    return result;
}
```

**Note** : `NAVY_MMSI_SET` est déjà importé de `military-ships.ts` dans `MaritimePanel.ts` — vérifier et ajouter à l'import existant si absent.

- [ ] **Step 7 : Appliquer les filtres dans les méthodes de rendu**

Dans `_renderTraffic()`, modifier la première ligne :

```typescript
// Avant :
const ships = getAllLiveTraffic(10 * 60 * 1000, true)
    .sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));

// Après :
const allShips = getAllLiveTraffic(10 * 60 * 1000, true)
    .sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
const ships = this._applyFilters(allShips);
```

Dans `_renderNavy()`, modifier la première ligne :

```typescript
// Avant :
const ships = getMilitaryShips();

// Après :
const ships = this._applyFilters(getMilitaryShips());
```

Dans `_renderAlerts()`, modifier les premières lignes :

```typescript
// Avant :
const all = getAllLiveTraffic(10 * 60 * 1000, true);
const alerts = all.filter(s => s.riskLevel && ['medium', 'high', 'critical'].includes(s.riskLevel));

// Après :
const allFiltered = this._applyFilters(getAllLiveTraffic(10 * 60 * 1000, true));
const alerts = allFiltered.filter(s => s.riskLevel && ['medium', 'high', 'critical'].includes(s.riskLevel));
```

- [ ] **Step 8 : Mettre à jour `_updateAisBadge()` et gérer la bannière stale**

Remplacer le corps de `_updateAisBadge()` par :

```typescript
private _updateAisBadge(): void {
    const badge = this.containerEl?.querySelector('#ais-status-badge') as HTMLElement | null;
    const status = getAisConnectionStatus();
    const lastTs = getAisLastMessageTs();

    // Badge header
    if (badge) {
        const state = getAisConnectionState();
        if (status === 'connected') {
            badge.style.cssText = 'color:#34c759;font-size:9px;';
            badge.textContent = `● ${state.franceShipCount} navires FR`;
        } else if (status === 'connecting' || status === 'stale') {
            badge.style.cssText = 'color:#ff9500;font-size:9px;';
            badge.textContent = status === 'stale' ? `○ données figées` : `○ connexion…`;
        } else {
            badge.style.cssText = 'color:#ff3b30;font-size:9px;';
            badge.textContent = `✗ hors ligne`;
        }
    }

    // Bannière stale
    if (this._staleBannerEl) {
        const isStale = status === 'stale' || status === 'disconnected';
        this._staleBannerEl.style.display = isStale ? 'block' : 'none';
        if (isStale && lastTs > 0) {
            const elapsedMin = Math.round((Date.now() - lastTs) / 60_000);
            this._staleBannerEl.textContent = `⚠ AIS indisponible · dernier contact il y a ${elapsedMin} min`;
        } else if (isStale) {
            this._staleBannerEl.textContent = `⚠ AIS indisponible`;
        }
    }

    // Opacité header (signaler données figées)
    const headerEl = this.containerEl?.querySelector('div:first-of-type') as HTMLElement | null;
    if (headerEl) {
        const isStale = status === 'stale' || status === 'disconnected';
        headerEl.style.opacity = isStale ? '0.6' : '1';
    }
}
```

Note : `getAisConnectionState` est toujours importé de `military-ships.ts` (sa signature a évolué pour inclure `status`). Vérifier que la ligne d'import existante en haut de `MaritimePanel.ts` inclut bien `getAisConnectionState` — si non, l'ajouter. Exemple attendu :
```typescript
import { getAllLiveTraffic, getMilitaryShips, getAisConnectionState, NAVY_MMSI_SET, type MilitaryShip, type RiskLevel } from '../services/military-ships.ts';
```

- [ ] **Step 9 : Typecheck**

```bash
npm run typecheck
```

Erreurs possibles :
- `NAVY_MMSI_SET` pas dans l'import de `MaritimePanel.ts` → ajouter à la ligne d'import
- `BLACK_LIST_FLAGS` etc. pas exportés → vérifier `src/config/risk-flags.ts`

- [ ] **Step 10 : Commit**

```bash
git add src/components/MaritimePanel.ts
git commit -m "feat(maritime): bannière stale AIS, search/filtres, openAlertsTab()"
```

---

## Task 5 — `ToastNotification.ts` + `App.ts`

**Files:**
- Modify: `src/components/ToastNotification.ts`
- Modify: `src/App.ts`

### Contexte pour l'implémenteur

**ToastNotification** : ajouter `showAisAnomaly()` et `setOnAisAnomalyClick()` suivant exactement le pattern de `showJammingSignals()` / `setOnJammingSignalClick()` déjà en place.

**App.ts** : trois changements :
1. Appeler `connectAis()` explicitement au démarrage (remplace l'auto-start supprimé dans military-ships.ts)
2. Ajouter `detectAisAnomalies` dans le cycle de polling ships
3. Enregistrer le handler de click sur les toasts AIS (`setOnAisAnomalyClick`)

- [ ] **Step 1 : Ajouter le type et les champs dans `ToastNotification.ts`**

En haut du fichier, ajouter à l'import existant des types :

```typescript
import type { NewsItem, GpsJammingSignal, AisAnomaly } from '../types/index.ts';
```

Après la ligne `export type GpsJammingSignalClickHandler = ...` :

```typescript
export type AisAnomalyClickHandler = (anomaly: AisAnomaly) => void;
```

Dans la classe, après `private onJammingSignalClick: GpsJammingSignalClickHandler | null = null;` :

```typescript
private onAisAnomalyClick: AisAnomalyClickHandler | null = null;
private seenAnomalyIds: Set<string> = new Set();
private anomalyCooldownMs = 30 * 60_000; // 30 min (idem rendezvous cooldown)
```

- [ ] **Step 2 : Ajouter `setOnAisAnomalyClick()` dans la classe**

Après la méthode `setOnJammingSignalClick()` :

```typescript
/** Register a click handler for AIS anomaly toasts */
setOnAisAnomalyClick(handler: AisAnomalyClickHandler): void {
    this.onAisAnomalyClick = handler;
}
```

- [ ] **Step 3 : Ajouter `showAisAnomaly()` dans la classe**

Après la méthode `showJammingSignals()` :

```typescript
/**
 * Affiche un toast pour une anomalie AIS (radio silence ou rendezvous suspect).
 * Déduplique par anomaly.id.
 */
showAisAnomaly(anomaly: AisAnomaly): void {
    // Dédup par id
    if (this.seenAnomalyIds.has(anomaly.id)) return;
    if (this.activeToasts.has(anomaly.id)) return;

    // Limiter le nombre de toasts simultanés
    if (this.activeToasts.size >= this.maxToasts) {
        const firstKey = this.activeToasts.keys().next().value;
        if (firstKey) this.dismissToast(firstKey, false);
    }

    const toast = this._createAisAnomalyToastElement(anomaly);
    this.container.appendChild(toast);
    this.activeToasts.set(anomaly.id, toast);
    this.seenAnomalyIds.add(anomaly.id);

    // Auto-dismiss : 10s
    setTimeout(() => {
        this.dismissToast(anomaly.id, true);
    }, 10_000);

    // Effacer de seenAnomalyIds après le cooldown
    setTimeout(() => {
        this.seenAnomalyIds.delete(anomaly.id);
    }, this.anomalyCooldownMs);
}

private _createAisAnomalyToastElement(anomaly: AisAnomaly): HTMLElement {
    const isRadioSilence = anomaly.type === 'radio_silence';
    const icon = isRadioSilence ? '🔇' : '⚓';
    const borderColor = isRadioSilence ? '#EF4444' : '#F59E0B';
    const label = isRadioSilence ? 'Silence AIS' : 'Rendezvous suspect';

    const toast = document.createElement('div');
    toast.style.cssText = [
        'background:var(--bg-surface,#1a1a2e)',
        `border-left:3px solid ${borderColor}`,
        'border-radius:8px',
        'box-shadow:0 4px 16px rgba(0,0,0,0.5)',
        'cursor:pointer',
        'display:flex',
        'flex-direction:column',
        'gap:4px',
        'margin-bottom:8px',
        'padding:10px 12px',
        'position:relative',
        'transition:opacity 0.3s',
    ].join(';');

    const header = document.createElement('div');
    header.style.cssText = 'align-items:center;display:flex;gap:6px;';
    header.innerHTML = `
        <span style="font-size:14px;">${icon}</span>
        <span style="color:var(--text-primary,#fff);font-size:11px;font-weight:600;">${escapeHtml(label)}</span>
        <span style="color:${borderColor};font-size:9px;margin-left:auto;font-weight:700;">${anomaly.severity.toUpperCase()}</span>
    `;

    const body = document.createElement('div');
    body.style.cssText = 'color:var(--text-muted,#888);font-size:10px;padding-left:20px;';
    body.textContent = anomaly.description;

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:6px;justify-content:flex-end;margin-top:4px;';

    const viewBtn = document.createElement('button');
    viewBtn.textContent = 'Voir';
    viewBtn.style.cssText = [
        'background:rgba(255,255,255,0.1)',
        'border:none',
        'border-radius:4px',
        'color:var(--text-primary,#fff)',
        'cursor:pointer',
        'font-size:10px',
        'padding:2px 8px',
    ].join(';');
    viewBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dismissToast(anomaly.id, false);
        this.onAisAnomalyClick?.(anomaly);
    });

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = [
        'background:none',
        'border:none',
        'color:var(--text-muted,#888)',
        'cursor:pointer',
        'font-size:10px',
        'padding:2px 6px',
    ].join(';');
    closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.dismissToast(anomaly.id, false);
    });

    // Clic sur le corps → même effet que "Voir"
    toast.addEventListener('click', () => {
        this.dismissToast(anomaly.id, false);
        this.onAisAnomalyClick?.(anomaly);
    });

    actions.appendChild(viewBtn);
    actions.appendChild(closeBtn);
    toast.appendChild(header);
    toast.appendChild(body);
    toast.appendChild(actions);
    return toast;
}
```

- [ ] **Step 4 : Mettre à jour `clearAll()` dans ToastNotification**

Dans la méthode `clearAll()`, ajouter après `this.seenJammingSignals.clear();` :

```typescript
this.seenAnomalyIds.clear();
```

- [ ] **Step 5 : Typecheck ToastNotification**

```bash
npm run typecheck
```

- [ ] **Step 6 : Modifier les imports dans `App.ts`**

En haut de `src/App.ts`, trouver la ligne qui importe depuis `military-ships.ts` :

```typescript
// Ligne existante (autour de la ligne 50) :
import { AIS_RELAY_URL, getAisStatus, getMilitaryShips, getAllLiveTraffic, NAVY_MMSI_SET, onFirstAisData } from './services/military-ships.ts';
```

Ajouter un import séparé pour `connectAis` depuis `ais-connection.ts` :

```typescript
import { connectAis } from './services/ais-connection.ts';
```

Ajouter l'import du détecteur d'anomalies (à mettre avec les autres imports services) :

```typescript
import { detectAisAnomalies } from './services/ais-anomalies.ts';
```

- [ ] **Step 7 : Appeler `connectAis()` dans `App.init()`**

Chercher la méthode `init()` dans `App.ts` (ou `startMilitaryPolling()`, là où le démarrage AIS est déclenché). Le commentaire indique que `military-ships.ts` ne s'auto-démarre plus.

Dans `startMilitaryPolling()`, en tout début (avant `updateShips`), ajouter :

```typescript
// Démarrer la connexion WebSocket AIS (military-ships.ts s'est abonné via onAisMessage au chargement)
connectAis();
```

- [ ] **Step 8 : Ajouter la détection d'anomalies dans le cycle de polling ships**

Dans `startMilitaryPolling()`, dans la fonction `updateShips` (async), après la mise à jour de la carte, ajouter :

```typescript
// Détection anomalies AIS (radio silence + rendezvous)
const aisAnomalies = detectAisAnomalies(getAllLiveTraffic());
for (const anomaly of aisAnomalies) {
    this.toastNotification?.showAisAnomaly(anomaly);
}
```

- [ ] **Step 9 : Enregistrer le handler de click AIS toast**

Dans `App.ts`, là où les autres handlers de toast sont enregistrés (chercher `setOnJammingSignalClick` — c'est dans une méthode d'init), ajouter **après** le handler jamming :

```typescript
this.toastNotification.setOnAisAnomalyClick((anomaly) => {
    // Ouvrir l'onglet Alertes du MaritimePanel
    this.maritimePanel?.openAlertsTab();
    // Fly to la position de l'anomalie
    const zoom = anomaly.type === 'rendezvous' ? 11 : 10;
    this.mapContainer?.flyTo(anomaly.position[0], anomaly.position[1], zoom);
    // Activer le layer maritime si pas déjà actif
    if (!this.activeLayers.maritime) {
        this.onLayerToggle('maritime', true);
        this.layerPanel?.updateLayers(this.activeLayers);
    }
});
```

- [ ] **Step 10 : Build complet**

```bash
npm run build
```

Attendu : build réussi (0 erreur TypeScript, bundle généré). Si erreur, corriger avant de continuer.

- [ ] **Step 11 : Commit final**

```bash
git add src/components/ToastNotification.ts src/App.ts
git commit -m "feat(ais): câblage anomalies AIS — toasts radio silence + rendezvous, connectAis() au démarrage"
```

---

## Vérification manuelle (post-build)

Après `npm run dev` :

1. **Connexion normale** : ouvrir MaritimePanel → badge `● N navires FR` en vert, pas de bannière stale
2. **Search** : taper un nom de navire → liste filtrée en temps réel
3. **Chip Militaire** : seuls les navires Marine Nationale apparaissent
4. **Chip Pavillon suspect** : seuls les navires avec pavillon dans les listes noires/grises
5. **Stale simulation** : dans la console dev → `import('/src/services/ais-connection.ts').then(m => m.disconnectAis())` → badge passe orange puis rouge, bannière apparaît
6. **Reconnexion** : `import('/src/services/ais-connection.ts').then(m => m.connectAis())` → bannière disparaît
7. **Toasts anomalies** : difficile à déclencher sans navires réels — vérifier via console : `import('/src/services/ais-anomalies.ts').then(m => console.log(m.detectAisAnomalies([])))`

---

## Checklist de validation TypeScript

Avant chaque commit, s'assurer que ces patterns sont corrects :

- `riskLevel === 'high' || riskLevel === 'critical'` → utiliser `RiskLevel` de `military-ships.ts`, pas `ThreatLevel`
- `anomaly.severity` → utiliser `ThreatLevel` de `types/index.ts`
- `anomaly.timestamp` → Unix **milliseconds** (pas secondes)
- `position: [lng, lat]` → ordre longitude d'abord (GeoJSON, convention projet)
- `country.split('|')[0]` → guard avec `!country.includes('|')` avant
