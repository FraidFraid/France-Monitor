/**
 * sparkline.ts — Génère un SVG sparkline inline pour les tooltips.
 * Aucune dépendance externe.
 *
 * Convention : valeur > 0 = export FR (vert), < 0 = import FR (rouge).
 */

const COLOR_EXPORT  = '#00C896';
const COLOR_IMPORT  = '#FF4B4B';
const COLOR_ZERO    = 'rgba(255,255,255,0.15)';
const COLOR_AREA_EX = 'rgba(0,200,150,0.18)';
const COLOR_AREA_IM = 'rgba(255,75,75,0.18)';

export interface SparklineOptions {
  width?:  number;  // px, défaut 200
  height?: number;  // px, défaut 48
}

/**
 * Construit un SVG sparkline à partir d'une série de valeurs MW.
 * Retourne une chaîne SVG prête à être injectée dans du HTML.
 */
export function buildSparklineSVG(
  series: number[],
  opts:   SparklineOptions = {},
): string {
  const W = opts.width  ?? 200;
  const H = opts.height ?? 48;

  if (!series.length) return '';

  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;

  // Y=0 en coordonnées SVG (axe Y inversé)
  const yZero = H - ((0 - min) / range) * H;
  const yZeroClamped = Math.max(0, Math.min(H, yZero));

  const toX = (i: number) => (i / (series.length - 1)) * W;
  const toY = (v: number) => H - ((v - min) / range) * H;

  // Points de la polyligne
  const pts = series.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');

  // Zone colorée export (au-dessus de zéro)
  const areaExPts = [
    `0,${yZeroClamped.toFixed(1)}`,
    ...series.map((v, i) => `${toX(i).toFixed(1)},${toY(Math.max(0, v)).toFixed(1)}`),
    `${W},${yZeroClamped.toFixed(1)}`,
  ].join(' ');

  // Zone colorée import (en-dessous de zéro)
  const areaImPts = [
    `0,${yZeroClamped.toFixed(1)}`,
    ...series.map((v, i) => `${toX(i).toFixed(1)},${toY(Math.min(0, v)).toFixed(1)}`),
    `${W},${yZeroClamped.toFixed(1)}`,
  ].join(' ');

  // Couleur de la ligne selon le dernier point
  const lastVal  = series[series.length - 1];
  const lineColor = lastVal >= 0 ? COLOR_EXPORT : COLOR_IMPORT;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;overflow:visible;">
  <polygon points="${areaExPts}" fill="${COLOR_AREA_EX}" stroke="none"/>
  <polygon points="${areaImPts}" fill="${COLOR_AREA_IM}" stroke="none"/>
  <line x1="0" y1="${yZeroClamped.toFixed(1)}" x2="${W}" y2="${yZeroClamped.toFixed(1)}"
        stroke="${COLOR_ZERO}" stroke-width="0.8" stroke-dasharray="3,3"/>
  <polyline points="${pts}" fill="none" stroke="${lineColor}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
  <circle cx="${toX(series.length - 1).toFixed(1)}" cy="${toY(lastVal).toFixed(1)}" r="2.5"
          fill="${lineColor}" stroke="#161b22" stroke-width="1"/>
</svg>`;
}
