/**
 * cable-threats.ts — Détection de comportements suspects près des câbles sous-marins
 *
 * Génère des alertes Défense lorsque des navires militaires (ou AIS suspects)
 * sont détectés à très faible vitesse à proximité de câbles sous-marins.
 *
 * Critères d'alerte :
 *  - Distance < maxDistanceMeters (défaut: 500m)
 *  - Vitesse < maxSpeedKnots (défaut: 2 nœuds = stationnaire ou dérive)
 *
 * Usage:
 *  const alerts = detectCableThreats(ships, cables);
 *  alerts.forEach(a => console.warn(`⚠️ ${a.message}`));
 */

import type { FeatureCollection, LineString } from 'geojson';
import { getCableProximity, formatProximityDistance, type AISShip } from '@/utils/cable-proximity';

/**
 * Alerte de défense pour activité suspecte près d'un câble
 */
export interface DefenseAlert {
  id: string;
  type: 'cable-threat';
  severity: 'low' | 'medium' | 'high';
  message: string;
  shipId: string;
  shipName: string;
  cableId: string;
  cableName: string;
  distanceMeters: number;
  speedKnots: number;
  coordinates: [number, number]; // [lng, lat]
  createdAt: string; // ISO 8601
}

/**
 * Options pour la détection de menaces câbles
 */
export interface CableThreatOptions {
  /** Distance maximale d'alerte en mètres (défaut: 500m) */
  maxDistanceMeters?: number;
  /** Vitesse maximale en nœuds pour déclencher l'alerte (défaut: 2 nœuds) */
  maxSpeedKnots?: number;
  /** Inclure uniquement les navires militaires (défaut: false) */
  militaryOnly?: boolean;
}

const DEFAULT_OPTIONS: Required<CableThreatOptions> = {
  maxDistanceMeters: 500,
  maxSpeedKnots: 2,
  militaryOnly: false,
};

/**
 * Détermine la sévérité de l'alerte en fonction de la distance et de la vitesse.
 *
 * - HIGH: très proche (<100m) ET quasi-stationnaire (<0.5 nœuds)
 * - MEDIUM: proche (<300m) ET lent (<1 nœud)
 * - LOW: autres cas dans le seuil
 */
function determineSeverity(distanceMeters: number, speedKnots: number): DefenseAlert['severity'] {
  if (distanceMeters < 100 && speedKnots < 0.5) {
    return 'high';
  }
  if (distanceMeters < 300 && speedKnots < 1) {
    return 'medium';
  }
  return 'low';
}

/**
 * Génère un message d'alerte lisible
 */
function generateAlertMessage(
  ship: AISShip,
  cableName: string,
  distanceMeters: number,
  speedKnots: number,
  severity: DefenseAlert['severity']
): string {
  const distStr = formatProximityDistance(distanceMeters);
  const speedStr = speedKnots.toFixed(1);
  const prefix = severity === 'high' ? '🔴' : severity === 'medium' ? '🟠' : '🟡';

  return `${prefix} ${ship.name} à ${distStr} du câble "${cableName}" (${speedStr} nœuds)`;
}

/**
 * Détecte les navires à comportement suspect près des câbles sous-marins.
 *
 * Un comportement suspect = navire lent (< maxSpeedKnots) à proximité
 * d'un câble (< maxDistanceMeters). Cela peut indiquer :
 *  - Reconnaissance / mapping
 *  - Mouillage sur zone
 *  - Opération sous-marine
 *
 * @param ships - Liste des navires AIS à vérifier
 * @param cables - GeoJSON FeatureCollection des câbles sous-marins
 * @param options - Options de détection (seuils distance/vitesse)
 * @returns Liste des alertes générées
 *
 * @example
 * import { getMilitaryShips } from '@/services/military-ships';
 * import { detectCableThreats } from '@/services/cable-threats';
 *
 * const ships = getMilitaryShips();
 * const cables = await fetch('/data/submarine-cables.json').then(r => r.json());
 * const alerts = detectCableThreats(ships, cables, { maxDistanceMeters: 500 });
 */
export function detectCableThreats(
  ships: AISShip[],
  cables: FeatureCollection<LineString>,
  options: CableThreatOptions = {}
): DefenseAlert[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const alerts: DefenseAlert[] = [];

  for (const ship of ships) {
    // Filtre militaryOnly si demandé
    if (opts.militaryOnly && !ship.isMilitary) {
      continue;
    }

    // Filtre par vitesse : on ne s'intéresse qu'aux navires lents
    if (ship.speed > opts.maxSpeedKnots) {
      continue;
    }

    // Vérification proximité câble
    const proximity = getCableProximity(ship, cables, opts.maxDistanceMeters);

    if (proximity.isNear && proximity.nearestCable) {
      const { nearestCable } = proximity;
      const severity = determineSeverity(nearestCable.distanceMeters, ship.speed);

      const alert: DefenseAlert = {
        id: `cable-threat-${ship.id}-${Date.now()}`,
        type: 'cable-threat',
        severity,
        message: generateAlertMessage(ship, nearestCable.name, nearestCable.distanceMeters, ship.speed, severity),
        shipId: ship.id,
        shipName: ship.name,
        cableId: nearestCable.id,
        cableName: nearestCable.name,
        distanceMeters: nearestCable.distanceMeters,
        speedKnots: ship.speed,
        coordinates: [ship.lon, ship.lat],
        createdAt: new Date().toISOString(),
      };

      alerts.push(alert);
    }
  }

  // Trier par sévérité (high > medium > low)
  const severityOrder: Record<DefenseAlert['severity'], number> = { high: 0, medium: 1, low: 2 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return alerts;
}

/**
 * Convertit un MilitaryShip en AISShip pour la détection de menaces.
 * Utilitaire pour l'intégration avec military-ships.ts
 */
export function militaryShipToAIS(ship: {
  id: string;
  name: string;
  lat: number;
  lon: number;
  speed?: number;
}): AISShip {
  return {
    id: ship.id,
    name: ship.name,
    lat: ship.lat,
    lon: ship.lon,
    speed: ship.speed ?? 0,
    isMilitary: true,
  };
}
