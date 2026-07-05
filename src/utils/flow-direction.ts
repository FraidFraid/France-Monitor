/**
 * flow-direction.ts — Utilitaire de direction flux électrique FR ↔ voisins.
 *
 * Convention éCO2mix (source unique de vérité) :
 *   flowMW > 0  → France IMPORTE depuis le pays voisin  (arc frontière → France)
 *   flowMW < 0  → France EXPORTE vers le pays voisin    (arc France → frontière)
 *   |flowMW| ≤ 200 → flux équilibré (seuil bruit de mesure)
 */

const FRANCE_CENTER: [number, number] = [2.5, 46.5]; // [lon, lat]

export type FlowDirection = 'export' | 'import' | 'balanced';

export interface FlowDirectionInfo {
  isImport:   boolean;
  direction:  FlowDirection;
  color:      string;
  glowColor:  string;
  /** Point de départ de l'arc (lon, lat) */
  arcFrom:    [number, number];
  /** Point d'arrivée de l'arc (lon, lat) */
  arcTo:      [number, number];
  /** Ex : "Espagne → France" ou "France → Espagne" */
  title:      string;
}

// Couleurs canoniques flux gaz (synchronisées avec GAS_FLOW_STYLE dans DeckGLMap.ts)
const GAS_IMPORT_COLOR      = '#A855F7'; // violet
const GAS_EXPORT_COLOR      = '#06B6D4'; // cyan
const GAS_GLOW_IMPORT_COLOR = '#7C3AED';
const GAS_GLOW_EXPORT_COLOR = '#0891B2';

export interface GasFlowDirectionInfo {
  direction:        import('../types/index.ts').GasDirection;
  originLabel:      string; // ex. 'Espagne'
  destinationLabel: string; // ex. 'France'
  color:            string;
  glowColor:        string;
  title:            string; // 'Espagne → France'
}

/**
 * Résout la direction d'un flux gaz côté France.
 *
 * Convention ODRÉ / GRTgaz :
 *   flowGWhDay > 0  → France IMPORTE (arc frontière → France)
 *   flowGWhDay < 0  → France EXPORTE (arc France → frontière)
 *
 * Seuil bruit : ±1 GWh/j (pipeline, moins bruité qu'électrique).
 */
export function resolveGasFlowDirection(
  flowGWhDay:    number,
  neighborLabel: string,
): GasFlowDirectionInfo {
  const isImport  = flowGWhDay >  1;
  const isExport  = flowGWhDay < -1;
  const direction = isImport ? 'import' : 'export' as import('../types/index.ts').GasDirection;
  const color     = isImport ? GAS_IMPORT_COLOR  : GAS_EXPORT_COLOR;
  const glowColor = isImport ? GAS_GLOW_IMPORT_COLOR : GAS_GLOW_EXPORT_COLOR;

  return {
    direction,
    originLabel:      isExport ? 'France'        : neighborLabel,
    destinationLabel: isExport ? neighborLabel   : 'France',
    color,
    glowColor,
    title: isImport ? `${neighborLabel} → France` : `France → ${neighborLabel}`,
  };
}

/**
 * Résout la direction, les couleurs et la géométrie d'arc d'un flux électrique.
 *
 * @param flowMW        Valeur brute éCO2mix (positif = import INTO France, négatif = export FROM France)
 * @param neighborLabel Nom du pays voisin, ex : "Espagne"
 * @param borderCoords  Coordonnées [lon, lat] du point frontière
 * @param exportColor   Couleur ligne export (CSS hex)
 * @param importColor   Couleur ligne import (CSS hex)
 * @param glowExportColor Couleur glow export
 * @param glowImportColor Couleur glow import
 */
export function resolveFlowDirection(
  flowMW:          number,
  neighborLabel:   string,
  borderCoords:    [number, number],
  exportColor:     string,
  importColor:     string,
  glowExportColor: string,
  glowImportColor: string,
): FlowDirectionInfo {
  const isImport  = flowMW >  200;
  const isExport  = flowMW < -200;
  const direction: FlowDirection = isImport ? 'import' : isExport ? 'export' : 'balanced';

  const color     = isImport ? importColor  : isExport ? exportColor  : '#8e8e93';
  const glowColor = isImport ? glowImportColor : isExport ? glowExportColor : '#666666';

  return {
    isImport,
    direction,
    color,
    glowColor,
    // Import : arc frontière → France ; Export : arc France → frontière
    arcFrom: isImport ? borderCoords  : FRANCE_CENTER,
    arcTo:   isImport ? FRANCE_CENTER : borderCoords,
    title:   isImport  ? `${neighborLabel} → France`
           : isExport  ? `France → ${neighborLabel}`
           :             `France ↔ ${neighborLabel}`,
  };
}
