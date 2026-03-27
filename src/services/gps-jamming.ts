/**
 * gps-jamming.ts — Détection heuristique de brouillage GPS / guerre électronique.
 *
 * Produit des signaux OSINT plausibles à partir d'anomalies ADS-B observées sur
 * plusieurs aéronefs militaires. Ce module n'est pas un proof-of-concept de
 * brouillage réel — c'est un indicateur de situation à confirmer.
 *
 * Sources d'anomalies utilisées :
 *   1. NAC-P faible ou en chute brutale (si disponible via adsb.fi)
 *   2. Vitesse implicite aberrante entre deux positions successives
 *   3. Ghost track : trail figé malgré une vitesse significative
 *   4. Vitesse sol anormalement basse en vol (gate conservateur vs hélicos)
 *   5. Cluster spatio-temporel : 3+ aéronefs affectés dans la même zone
 *
 * Limitation connue : NAC-P absent sur les données issues du proxy serverless.
 * Dans ce cas le module fonctionne en mode best-effort (heuristiques 2–5 seulement).
 *
 * Convention coordonnées : [lng, lat] (GeoJSON, cohérent avec le reste du projet).
 * Convention timestamps   : secondes Unix (cohérent avec MilitaryFlight.lastContact).
 */

import type { MilitaryFlight, GpsJammingSignal, ThreatLevel } from '../types/index.ts';

// ─── Seuils (ajustables) ────────────────────────────────────────────────────

/** NAC-P en dessous duquel on considère la précision GPS suspecte (0–11). */
const NACP_SUSPICIOUS = 3;

/**
 * Chute soudaine de NAC-P déclenchant une alerte (delta entre lecture précédente
 * et lecture courante). Une chute de 5 niveaux ou plus est rare en opération normale.
 */
const NACP_DROP_THRESHOLD = 5;

/**
 * Vitesse implicite maximale entre deux positions consécutives (km/h).
 * 1800 km/h ≈ Mach 1.5 + marge ; dépasser ce seuil sur des militaires tactiques
 * est un fort signal de saut de position (spoofing ou GPS perdu + position figée).
 */
const MAX_IMPLAUSIBLE_SPEED_KMH = 1800;

/** Rayon en km pour détecter un "ghost track" (trail figé). */
const GHOST_TRACK_RADIUS_KM = 3;

/** Nombre minimal de points dans le trail pour tenter la détection ghost track. */
const GHOST_TRACK_MIN_POINTS = 4;

/** Vitesse sol minimale (kts) exigée pour qu'une position figée soit suspecte. */
const GHOST_TRACK_MIN_SPEED_KTS = 50;

/** Altitude minimale (ft) en dessous de laquelle on ne déclenche pas l'anomalie vitesse-sol. */
const AIRBORNE_MIN_ALT_FT = 500;

/**
 * Vitesse sol seuil (kts) en dessous de laquelle un appareil en vol est suspect.
 * Gate conservateur : non applicable si l'appareil vole à < 50 kts (hélico, drone lent).
 * La combinaison AIRBORNE_MIN_ALT_FT + ce seuil évite les faux positifs sur hélicos.
 */
const STALL_SPEED_KTS = 15;

/** Rayon en km pour regrouper plusieurs aéronefs affectés dans un cluster. */
const CLUSTER_RADIUS_KM = 100;

/** Nombre minimal d'aéronefs avec anomalies pour former un cluster. */
const CLUSTER_MIN_AIRCRAFT = 3;

/** Multiplicateur de confiance pour un cluster spatio-temporel confirmé. */
const CLUSTER_MULTIPLIER = 1.4;

/** Score minimal pour rapporter un signal individuel. */
const REPORT_INDIVIDUAL_MIN = 0.35;

/** Score minimal pour rapporter un signal de cluster. */
const REPORT_CLUSTER_MIN = 0.50;

// ─── State interne ──────────────────────────────────────────────────────────

interface FlightSnapshot {
    lon: number;
    lat: number;
    timestampSec: number;  // Unix seconds
    nacP: number | undefined;
    speedKts: number;
}

/** Historique des N dernières observations par ICAO24. */
const flightSnapshots = new Map<string, FlightSnapshot[]>();
const SNAPSHOT_HISTORY = 3;

/**
 * TTL de rétention pour les aéronefs disparus du flux ADS-B.
 * Après ce délai sans observation, l'entrée est purgée pour éviter
 * l'accumulation de state mort sur les sessions longues.
 */
const SNAPSHOT_MAX_AGE_SEC = 5 * 60;

// ─── Utilitaires ────────────────────────────────────────────────────────────

/** Distance haversine en kilomètres entre deux points [lng, lat]. */
function haversineKm(
    lon1: number, lat1: number,
    lon2: number, lat2: number
): number {
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

function severityFromConfidence(c: number): ThreatLevel {
    if (c >= 0.70) return 'high';
    if (c >= 0.45) return 'medium';
    return 'low';
}

// ─── Analyse par aéronef ────────────────────────────────────────────────────

interface AircraftAnomalyResult {
    icao24: string;
    lon: number;
    lat: number;
    score: number;
    reasons: string[];
}

function analyseAircraft(flight: MilitaryFlight): AircraftAnomalyResult | null {
    const icao24 = flight.id.toUpperCase();
    const lon = flight.longitude;
    const lat = flight.latitude;
    const nowSec = flight.lastContact > 0 ? flight.lastContact : Date.now() / 1000;

    const current: FlightSnapshot = {
        lon,
        lat,
        timestampSec: nowSec,
        nacP: flight.nacP,
        speedKts: flight.speed,
    };

    const history = flightSnapshots.get(icao24) ?? [];

    let score = 0;
    const reasons: string[] = [];

    // ── Signal 1 : NAC-P faible ──────────────────────────────────────────
    if (current.nacP !== undefined && current.nacP < NACP_SUSPICIOUS && flight.altitude > AIRBORNE_MIN_ALT_FT) {
        score += 0.40;
        reasons.push(`NAC-P faible (${current.nacP}/11) en vol`);
    }

    // ── Signal 2 : NAC-P chute brutale ───────────────────────────────────
    if (current.nacP !== undefined && history.length > 0) {
        const prevWithNacp = history.filter(s => s.nacP !== undefined);
        if (prevWithNacp.length > 0) {
            const prev = prevWithNacp[prevWithNacp.length - 1];
            const drop = (prev.nacP as number) - current.nacP;
            if (drop >= NACP_DROP_THRESHOLD) {
                score += 0.25;
                reasons.push(`Chute NAC-P ${prev.nacP}→${current.nacP} (−${drop})`);
            }
        }
    }

    // ── Signal 3 : Vitesse implicite aberrante ───────────────────────────
    if (history.length > 0) {
        const prev = history[history.length - 1];
        const distKm = haversineKm(prev.lon, prev.lat, lon, lat);
        const dtSec = nowSec - prev.timestampSec;

        if (dtSec > 0 && dtSec < 300) {  // ignorer si delta trop grand (données stale)
            const impliedSpeedKmh = (distKm / dtSec) * 3600;
            if (impliedSpeedKmh > MAX_IMPLAUSIBLE_SPEED_KMH) {
                score += 0.35;
                reasons.push(
                    `Saut de position : vitesse implicite ${Math.round(impliedSpeedKmh)} km/h` +
                    ` sur ${distKm.toFixed(1)} km`
                );
            }
        }
    }

    // ── Signal 4 : Ghost track (trail figé + vitesse significative) ──────
    const trail = flight.trail ?? [];
    if (trail.length >= GHOST_TRACK_MIN_POINTS && flight.speed >= GHOST_TRACK_MIN_SPEED_KTS) {
        const refLon = trail[0][0];
        const refLat = trail[0][1];
        const allClose = trail.every(([tLon, tLat]) =>
            haversineKm(refLon, refLat, tLon, tLat) <= GHOST_TRACK_RADIUS_KM
        );
        if (allClose) {
            score += 0.35;
            reasons.push(
                `Trail figé sur ${GHOST_TRACK_RADIUS_KM} km radius` +
                ` malgré ${flight.speed} kts`
            );
        }
    }

    // ── Signal 5 : Vitesse sol anormalement basse en vol ─────────────────
    // Exclu pour les hélicoptères (vol stationnaire normal) et les drones (profils lents).
    // Poids faible car faux positifs possibles sur appareils à profil atypique.
    if (
        flight.altitude > AIRBORNE_MIN_ALT_FT &&
        flight.speed > 0 &&
        flight.speed < STALL_SPEED_KTS &&
        flight.aircraftType !== 'helicopter' &&
        flight.aircraftType !== 'drone'
    ) {
        score += 0.15;
        reasons.push(`Vitesse sol anormale en vol : ${flight.speed} kts à ${flight.altitude} ft`);
    }

    // ── Mise à jour historique ───────────────────────────────────────────
    history.push(current);
    if (history.length > SNAPSHOT_HISTORY) history.shift();
    flightSnapshots.set(icao24, history);

    if (score === 0 || reasons.length === 0) return null;

    return { icao24, lon, lat, score, reasons };
}

// ─── Clustering spatio-temporel ─────────────────────────────────────────────

/**
 * Groupe les anomalies individuelles par zones géographiques.
 * Retourne des groupes si au moins CLUSTER_MIN_AIRCRAFT aéronefs sont concernés.
 */
function clusterAnomalies(
    anomalies: AircraftAnomalyResult[]
): Array<{ centronLon: number; centronLat: number; members: AircraftAnomalyResult[] }> {
    if (anomalies.length < CLUSTER_MIN_AIRCRAFT) return [];

    const clusters: Array<{ centronLon: number; centronLat: number; members: AircraftAnomalyResult[] }> = [];
    const assigned = new Set<string>();

    for (const anchor of anomalies) {
        if (assigned.has(anchor.icao24)) continue;

        const group = anomalies.filter(a =>
            haversineKm(anchor.lon, anchor.lat, a.lon, a.lat) <= CLUSTER_RADIUS_KM
        );

        if (group.length >= CLUSTER_MIN_AIRCRAFT) {
            const centronLon = group.reduce((s, a) => s + a.lon, 0) / group.length;
            const centronLat = group.reduce((s, a) => s + a.lat, 0) / group.length;
            for (const m of group) assigned.add(m.icao24);
            clusters.push({ centronLon, centronLat, members: group });
        }
    }

    return clusters;
}

// ─── API publique ────────────────────────────────────────────────────────────

/**
 * Détecteur stateful : appeler à chaque cycle de polling avec la liste de vols courante.
 *
 * Analyse chaque aéronef en comparant avec ses snapshots précédents, puis cherche
 * des clusters spatio-temporels. Retourne les signaux dépassant le seuil de confiance.
 *
 * @param flights  Liste de vols militaires courants (output de fetchMilitaryFlights)
 * @returns        Signaux de suspicion de brouillage GPS
 */
export function detectGpsJammingSignals(flights: MilitaryFlight[]): GpsJammingSignal[] {
    const nowSec = Date.now() / 1000;
    const signals: GpsJammingSignal[] = [];
    const anomalies: AircraftAnomalyResult[] = [];

    // Purger les aéronefs dont le dernier snapshot dépasse le TTL.
    // Évite l'accumulation de state mort sur les sessions longues.
    for (const [icao24, snapshots] of flightSnapshots) {
        const lastSeen = snapshots[snapshots.length - 1]?.timestampSec ?? 0;
        if (nowSec - lastSeen > SNAPSHOT_MAX_AGE_SEC) {
            flightSnapshots.delete(icao24);
        }
    }

    // Analyser chaque aéronef
    for (const flight of flights) {
        const result = analyseAircraft(flight);
        if (result) anomalies.push(result);
    }

    // Chercher des clusters
    const clusters = clusterAnomalies(anomalies);
    const clusteredIcao24s = new Set<string>();

    for (const cluster of clusters) {
        const avgScore = cluster.members.reduce((s, m) => s + m.score, 0) / cluster.members.length;
        const boosted = Math.min(avgScore * CLUSTER_MULTIPLIER, 1.0);

        if (boosted < REPORT_CLUSTER_MIN) continue;

        // Calculer le rayon réel du cluster
        const maxRadiusKm = Math.max(
            ...cluster.members.map(m =>
                haversineKm(cluster.centronLon, cluster.centronLat, m.lon, m.lat)
            )
        );

        // Fusionner les raisons en dédupliquant
        const allReasons = [...new Set(cluster.members.flatMap(m => m.reasons))];

        const idx = signals.length;
        signals.push({
            id: `jamming-${Math.round(nowSec)}-${idx}`,
            position: [cluster.centronLon, cluster.centronLat],
            timestamp: nowSec,
            severity: severityFromConfidence(boosted),
            confidence: Math.round(boosted * 100) / 100,
            reasons: allReasons,
            affectedIcao24s: cluster.members.map(m => m.icao24),
            clusterRadius: Math.round(maxRadiusKm),
        });

        for (const m of cluster.members) clusteredIcao24s.add(m.icao24);
    }

    // Signaux individuels non couverts par un cluster
    for (const anomaly of anomalies) {
        if (clusteredIcao24s.has(anomaly.icao24)) continue;
        if (anomaly.score < REPORT_INDIVIDUAL_MIN) continue;

        const idx = signals.length;
        signals.push({
            id: `jamming-${Math.round(nowSec)}-${idx}`,
            position: [anomaly.lon, anomaly.lat],
            timestamp: nowSec,
            severity: severityFromConfidence(anomaly.score),
            confidence: Math.round(anomaly.score * 100) / 100,
            reasons: anomaly.reasons,
            affectedIcao24s: [anomaly.icao24],
        });
    }

    return signals;
}
