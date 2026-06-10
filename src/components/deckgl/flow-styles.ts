// Extracted from DeckGLMap.ts — energy flow visual styles (electricity, gas, oil).

// ═══════════════════════════════════════════════════════════════════════════
// ENERGY FLOW STYLES — Distinct visual styles for electricity, gas, and oil
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Electric flow style: Red/green neon with pronounced glow effect
 * Continuous plasma-like appearance, bright and energetic
 */
export const ELECTRIC_FLOW_STYLE = {
  // Colors: OSINT style — red/orange import, green export
  importColor: '#FF4B4B',      // Rouge-orange for import (into France)
  exportColor: '#16A34A',      // Vert un peu plus fonce pour export (out of France)
  glowImportColor: '#FF6B6B',  // Softer red glow
  glowExportColor: '#15803D',  // Deeper green glow
  // Line properties
  minLineWidth: 3,
  maxLineWidth: 10,
  lineWidthDivisor: 600,       // flowMW / 600 for width scaling
  glowIntensity: 3.0,          // Glow width multiplier (configurable)
  glowOpacity: 0.4,
  glowBlur: 10,
  lineOpacity: 0.95,
  // Chevron animation
  chevronSpacing: 50,          // Distance between chevrons (px)
  chevronSpeed: 0.5,           // Animation speed (0.1 = slow, 1.0 = fast)
  chevronSize: 1.2,            // Base chevron size multiplier (bigger)
  // Arc geometry
  curvature: 0.25,
  steps: 50,
};

// Mutable config for runtime updates
let electricFlowConfig = { ...ELECTRIC_FLOW_STYLE };

/** Update electric flow config at runtime */
export function setElectricFlowConfig(config: Partial<typeof ELECTRIC_FLOW_STYLE>): void {
  electricFlowConfig = { ...electricFlowConfig, ...config };
}

/** Get current electric flow config */
export function getElectricFlowConfig(): typeof ELECTRIC_FLOW_STYLE {
  return electricFlowConfig;
}

/**
 * Gas flow style: Cyan/turquoise with softer glow
 * Thinner arcs, rapid dash animation to suggest pipeline flow
 */
export const GAS_FLOW_STYLE = {
  // Colors: import = violet électrique, export = cyan électrique
  importColor: '#A855F7',      // Purple-500 : import (FR reçoit)
  exportColor: '#06B6D4',      // Cyan-500   : export (FR envoie)
  glowImportColor: '#7C3AED',  // Violet-600 : halo import
  glowExportColor: '#0891B2',  // Cyan-600   : halo export
  // Line properties: Thinner than electricity
  minLineWidth: 4,
  maxLineWidth: 10,
  lineWidthDivisor: 80,        // flowGWhDay / 80 for width scaling
  glowMultiplier: 2.0,         // Softer glow (2x line width)
  glowOpacity: 0.25,
  glowBlur: 6,
  lineOpacity: 0.85,
  // Animation: chevron points (no dasharray)
  animationSpeed: 0.8,         // Faster than electricity
  animationCycle: 16,
  // Arc geometry
  curvature: 0.22,
  steps: 45,
} as const;

/**
 * Oil flow style: Brown/anthracite with amber glow
 * Thick arcs, slow dash animation to suggest viscous flow
 */
export const OIL_FLOW_STYLE = {
  // Colors: Amber lumineux (export) / Rouille sombre (import) — palette pétrole
  exportColor: '#F59E0B',      // Amber-500 — ambre chaud lumineux
  importColor: '#C2410C',      // Orange-700 — rouille sombre (distinct de l'élec rouge)
  glowExportColor: '#FCD34D',  // Amber-300 — glow doré léger
  glowImportColor: '#EA580C',  // Orange-600 — glow rouille
  // Line properties: Thicker than others (viscous feel)
  minLineWidth: 4,
  maxLineWidth: 12,
  lineWidthDivisor: 50,        // flowKbd / 50 for width scaling (thousands barrels/day)
  glowMultiplier: 2.2,
  glowOpacity: 0.3,
  glowBlur: 6,
  lineOpacity: 0.9,
  // Animation: Slow chevrons to suggest heavy/viscous flow
  animationSpeed: 0.45,        // Assez visible (arcs longs = peu de chevrons à l'écran)
  // Arc geometry
  curvature: 0.28,
  steps: 50,
} as const;
