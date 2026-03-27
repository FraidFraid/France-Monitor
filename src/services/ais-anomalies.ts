/**
 * ais-anomalies.ts — Détection d'anomalies AIS.
 *
 * Détecte :
 *  1. Radio silence : navire militaire absent du flux AIS trop longtemps
 *  2. Rendezvous suspect : deux navires (dont un militaire/risque) < 2 km hors port
 *
 * Détecteur stateful — appeler à chaque cycle de polling AIS avec getAllLiveTraffic().
 *
 * Convention coordonnées : [lng, lat] (GeoJSON, cohérent avec le reste du projet).
 * Convention timestamps   : milliseconds Unix (Date.now()).
 */

import { NAVY_MMSI_SET, type MilitaryShip } from './military-ships.ts';
import { FRENCH_PORTS } from '../config/french-ports.ts';
import type { AisAnomaly } from '../types/index.ts';

// ─── Seuils ──────────────────────────────────────────────────────────────────

const SILENCE_MILITARY_MS  = 10 * 60 * 1000;  // 10 min pour navire militaire
const SILENCE_RISK_MS = 20 * 60 * 1000;  // 20 min pour navire civil à risque élevé
const RENDEZVOUS_DIST_KM   = 2;               // Distance max rendezvous (km)
const RENDEZVOUS_MIN_SPEED = 1;               // Vitesse min des deux navires (kts)
const RENDEZVOUS_COOLDOWN_MS = 30 * 60 * 1000; // 30 min entre deux alertes pour la même paire
const LAST_SEEN_MAX_AGE_MS = 60 * 60 * 1000;  // 1h — purge navires disparus du state

// ─── State interne ──────────────────────────────────────────────────────────

/** Dernier timestamp de message AIS par MMSI (ms Unix). */
const lastSeenTs  = new Map<string, number>();
/** Dernière position connue par MMSI (pour renseigner AisAnomaly.position quand disparu). */
const lastSeenPos = new Map<string, [number, number]>();
/** MMSIs pour lesquels une alerte de silence a déjà été émise (évite le spam). */
const seenSilenceAlerts = new Set<string>();
/** Dernier riskLevel connu par MMSI (pour radio silence civils à risque). */
const lastSeenRisk = new Map<string, 'none' | 'low' | 'medium' | 'high' | 'critical'>();
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

    // ── Purge state mort (navires disparus depuis > 1h) ───────────────────────
    for (const [mmsi, ts] of lastSeenTs) {
        if (nowMs - ts > LAST_SEEN_MAX_AGE_MS) {
            lastSeenTs.delete(mmsi);
            lastSeenPos.delete(mmsi);
            lastSeenRisk.delete(mmsi);
            seenSilenceAlerts.delete(mmsi);
        }
    }
    // Purge cooldowns rendezvous expirés
    for (const [key, expiry] of rendezvousCooldowns) {
        if (nowMs > expiry) rendezvousCooldowns.delete(key);
    }

    // ── Mise à jour de l'état lastSeen ────────────────────────────────────────
    for (const ship of ships) {
        if (!ship.mmsi) continue;
        lastSeenTs.set(ship.mmsi, ship.lastSeen ?? nowMs);
        lastSeenPos.set(ship.mmsi, [ship.lon, ship.lat]);
        if (ship.riskLevel) {
            lastSeenRisk.set(ship.mmsi, ship.riskLevel);
        }
        // Si le navire réapparaît après un silence : effacer son alerte
        // pour permettre une nouvelle alerte lors d'une prochaine disparition
        if (seenSilenceAlerts.has(ship.mmsi)) {
            seenSilenceAlerts.delete(ship.mmsi);
        }
    }

    // ── 1. Radio silence (militaires + civils à risque élevé) ────────────────
    for (const [mmsi, lastTs] of lastSeenTs) {
        const elapsed = nowMs - lastTs;
        const isMilitary = NAVY_MMSI_SET.has(mmsi);

        const cachedRisk = lastSeenRisk.get(mmsi);
        const isHighRiskCivilian = !isMilitary && (cachedRisk === 'high' || cachedRisk === 'critical');

        if (!isMilitary && !isHighRiskCivilian) continue;

        const thresholdMs = isMilitary ? SILENCE_MILITARY_MS : SILENCE_RISK_MS;
        if (elapsed < thresholdMs) continue;
        if (seenSilenceAlerts.has(mmsi)) continue;

        const pos = lastSeenPos.get(mmsi);
        if (!pos) continue;

        seenSilenceAlerts.add(mmsi);
        const idx = anomalies.length;
        anomalies.push({
            id: `silence-${mmsi}-${nowSec}-${idx}`,
            type: 'radio_silence',
            severity: isMilitary ? 'high' : 'medium',
            position: pos,
            timestamp: nowMs,
            mmsis: [mmsi],
            description: `Silence radio · MMSI ${mmsi} · ${formatElapsedMin(elapsed)}`,
        });
    }

    // ── 2. Rendezvous suspects ────────────────────────────────────────────────
    const watchedShips = ships.filter(s =>
        s.mmsi && (NAVY_MMSI_SET.has(s.mmsi) || s.riskLevel === 'high' || s.riskLevel === 'critical')
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
                severity: 'medium',
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
    lastSeenRisk.clear();
    seenSilenceAlerts.clear();
    rendezvousCooldowns.clear();
}
