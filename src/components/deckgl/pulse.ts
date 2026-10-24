// src/components/deckgl/pulse.ts : anneau pulsant des points urgents (catastrophes, séismes ; 20/10/2026). Pur.
// Chaque point porte `radius`, `amp` (élargissement en px), `period` (ms ; 0 = pas d'anneau), `offset` (désynchronise les voisins)
// et `alpha`. Un calque d'anneau par couche, sous ses points, filtré sur `period > 0`, repeint à chaque image par DeckGLMap.
import type { LayerSpecification } from 'maplibre-gl';
import type { VigilanceLevel } from '../../services/vigilance.ts';

/** Pulsation par urgence : plus large et plus rapide quand c'est grave. */
export const PULSE_BY_LEVEL: Readonly<Record<VigilanceLevel, { period: number; amp: number }>> = {
  rouge: { period: 1400, amp: 14 }, orange: { period: 2200, amp: 10 }, jaune: { period: 2800, amp: 8 }, vert: { period: 3400, amp: 6 },
};

/** Anneaux réservés à l'onglet Pannes (24/10/2026) : en Vue générale, les antennes coupées ne pulsent pas. */
const ROOM_ONLY_PULSES: ReadonlySet<string> = new Set(['telecomOutage']);

/** Anneau autorisé pour la couche `key`, selon que la salle des pannes est ouverte. */
export function pulseAllowed(key: string, roomActive: boolean): boolean {
  return roomActive || !ROOM_ONLY_PULSES.has(key);
}

/** Décalage stable de la pulsation d'un point (points voisins désynchronisés). */
export function pulseOffset(id: string, period: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return period > 0 ? h % period : 0;
}

/**
 * Peinture de l'anneau à l'instant `t` (ms) : phase = ((t + décalage) mod période) / période ; l'anneau part du bord du point,
 * s'élargit de `amp` et s'efface. `dim` : facteur de tamisage de la couche (1 vive, 0,15 tamisée par une autre pastille).
 */
export function pulsePaint(t: number, dim: number): { radius: unknown; opacity: unknown } {
  const phase = ['/', ['%', ['+', t % 1_000_000, ['get', 'offset']], ['max', ['get', 'period'], 1]], ['max', ['get', 'period'], 1]];
  return {
    radius: ['+', ['get', 'radius'], 1, ['*', ['get', 'amp'], phase]],
    opacity: ['*', 0.85 * dim, ['coalesce', ['get', 'alpha'], 1], ['-', 1, phase]],
  };
}

/** Calque d'anneau d'une source de points (masqué au départ). */
export function pulseLayerSpec(id: string, source: string): LayerSpecification {
  return {
    id, type: 'circle', source, filter: ['>', ['get', 'period'], 0], layout: { visibility: 'none' },
    paint: {
      'circle-color': 'rgba(0,0,0,0)', 'circle-radius': ['get', 'radius'], 'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': 1.6, 'circle-stroke-opacity': 0,
    },
  };
}
