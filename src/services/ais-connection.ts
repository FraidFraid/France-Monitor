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

/**
 * URL du relais AIS WebSocket.
 * - Dev  : VITE_AIS_RELAY_URL si défini, sinon ws://localhost:8090.
 * - Prod : VITE_AIS_RELAY_URL si défini, sinon null → layer maritime désactivé silencieusement.
 */
export const AIS_RELAY_URL: string | null =
  import.meta.env.VITE_AIS_RELAY_URL ||
  (import.meta.env.DEV ? 'ws://localhost:8090' : null);

const STALE_THRESHOLD_MS = 2 * 60 * 1000;   // 2 min sans message → STALE
const INITIAL_TIMEOUT_MS = 10_000;            // 10s pour le 1er message après open
const STALE_CHECK_INTERVAL_MS = 15_000;       // Vérifie l'état toutes les 15s

let _status: AisConnectionStatus = 'disconnected';
let _lastMessageTs = 0;
let _reconnectAttempt = 0;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _staleCheckTimer: ReturnType<typeof setInterval> | null = null;
let _initialTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
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
    if (!AIS_RELAY_URL) {
        console.info('[AIS] Pas de relais configuré (VITE_AIS_RELAY_URL non défini) — layer maritime désactivé');
        return;
    }
    if (_ws && (_ws.readyState === WebSocket.CONNECTING || _ws.readyState === WebSocket.OPEN)) return;

    _setStatus('connecting');

    try {
        _ws = new WebSocket(AIS_RELAY_URL);

        // Si aucun message reçu dans les 10s après open, passer en STALE
        _initialTimeoutTimer = setTimeout(() => {
            _initialTimeoutTimer = null;
            if (_status === 'connecting' || (_status === 'connected' && _lastMessageTs === 0)) {
                _setStatus('stale');
            }
        }, INITIAL_TIMEOUT_MS);

        _ws.onopen = () => {
            if (_initialTimeoutTimer) { clearTimeout(_initialTimeoutTimer); _initialTimeoutTimer = null; }
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
            // Note: onclose always fires after onerror per WebSocket spec — reconnect is scheduled there
            if (_initialTimeoutTimer) { clearTimeout(_initialTimeoutTimer); _initialTimeoutTimer = null; }
            _setStatus('disconnected');
        };

        _ws.onclose = () => {
            if (_initialTimeoutTimer) { clearTimeout(_initialTimeoutTimer); _initialTimeoutTimer = null; }
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
    if (_initialTimeoutTimer) { clearTimeout(_initialTimeoutTimer); _initialTimeoutTimer = null; }
    if (_ws) { _ws.onclose = null; _ws.close(); _ws = null; }
    _setStatus('disconnected');
    _reconnectAttempt = 0;
}
