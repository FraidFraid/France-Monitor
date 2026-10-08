/**
 * ais-anomalies.ts — Détection d'anomalies AIS.
 *
 * Détecte :
 *  1. Radio silence : navire civil à risque élevé absent du flux AIS trop longtemps
 *  2. Rendezvous suspect : deux navires (dont un à risque élevé) < 2 km hors port
 *
 * Bâtiments de la Marine nationale jamais retenus (revue finale I1) : reconnus par un registre public ou leur propre message
 * (NAVY_MMSI_SET), ou sous pavillon français de type AIS 35 ou nommés « FRENCH WARSHIP » (isFrenchWarship, même règle que la
 * veille des câbles). Un bâtiment de guerre qui coupe son AIS est un usage courant, pas un signal (V1 : une absence n'est pas un
 * événement) ; un ravitaillement à la mer n'est pas un rendez-vous suspect ; et suivre l'heure où un bâtiment nommé se tait irait
 * contre la discrétion d'O10 et O11. Aucune anomalie, donc jamais de situation « Anomalie maritime » ni de plafond du score.
 *
 * Détecteur stateful — appeler à chaque cycle de polling AIS avec getAllLiveTraffic().
 *
 * Convention coordonnées : [lng, lat] (GeoJSON, cohérent avec le reste du projet).
 * Convention timestamps   : milliseconds Unix (Date.now()).
 */

import { NAVY_MMSI_SET, type MilitaryShip } from './military-ships.ts';
import { isFrenchWarship } from './french-warship.js';
import { FRENCH_PORTS } from '../config/french-ports.ts';
import type { AisAnomaly } from '../types/index.ts';

// ─── Seuils ──────────────────────────────────────────────────────────────────

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
/** MMSI vus comme bâtiment de la Marine nationale (type 35 ou nom « FRENCH WARSHIP » sous pavillon français), gardés pour le silence. */
const navySeen = new Set<string>();

/** Bâtiment de la Marine nationale : registre public ou propre message AIS (NAVY_MMSI_SET), sinon règle FX2 (isFrenchWarship). */
function isNavy(mmsi: string): boolean {
    return NAVY_MMSI_SET.has(mmsi) || navySeen.has(mmsi);
}

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
            navySeen.delete(mmsi);
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
        if (isFrenchWarship({ mmsi: ship.mmsi, name: ship.name, typeCode: ship.shipType ?? null })) navySeen.add(ship.mmsi);
        if (ship.riskLevel) {
            lastSeenRisk.set(ship.mmsi, ship.riskLevel);
        }
        // Si le navire réapparaît après un silence : effacer son alerte
        // pour permettre une nouvelle alerte lors d'une prochaine disparition
        if (seenSilenceAlerts.has(ship.mmsi)) {
            seenSilenceAlerts.delete(ship.mmsi);
        }
    }

    // ── 1. Radio silence (civils à risque élevé seulement ; jamais la Marine nationale) ──
    for (const [mmsi, lastTs] of lastSeenTs) {
        const elapsed = nowMs - lastTs;
        if (isNavy(mmsi)) continue;

        const cachedRisk = lastSeenRisk.get(mmsi);
        if (cachedRisk !== 'high' && cachedRisk !== 'critical') continue;

        if (elapsed < SILENCE_RISK_MS) continue;
        if (seenSilenceAlerts.has(mmsi)) continue;

        const pos = lastSeenPos.get(mmsi);
        if (!pos) continue;

        seenSilenceAlerts.add(mmsi);
        const idx = anomalies.length;
        anomalies.push({
            id: `silence-${mmsi}-${nowSec}-${idx}`,
            type: 'radio_silence',
            severity: 'medium',
            position: pos,
            timestamp: nowMs,
            mmsis: [mmsi],
            description: `Silence radio · MMSI ${mmsi} · ${formatElapsedMin(elapsed)}`,
        });
    }

    // ── 2. Rendezvous suspects (navire à risque élevé ; aucune paire qui compte un bâtiment de la Marine nationale) ──
    const watchedShips = ships.filter(s =>
        s.mmsi && !isNavy(s.mmsi) && (s.riskLevel === 'high' || s.riskLevel === 'critical')
    );

    for (const watched of watchedShips) {
        if (!watched.mmsi) continue;
        if ((watched.speed ?? 0) < RENDEZVOUS_MIN_SPEED) continue;
        if (isNearFrenchPort(watched.lat, watched.lon)) continue;

        for (const other of ships) {
            if (!other.mmsi || other.mmsi === watched.mmsi) continue;
            if (isNavy(other.mmsi)) continue;
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
    navySeen.clear();
}
