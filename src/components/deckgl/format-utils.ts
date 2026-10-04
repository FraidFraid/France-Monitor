// Extracted from DeckGLMap.ts — pure formatting / labelling / conversion helpers.
import { ISNR_COLORS } from './constants.ts';

export const MTG_FRP_SOURCE_ID = 'fire-mtg-frp-source';
export const MTG_FRP_LAYER_ID = 'fire-mtg-frp-layer';
export const RADAR_2D_SOURCE_ID = 'fire-radar-2d-source';
export const RADAR_2D_LAYER_ID = 'fire-radar-2d-layer';
export const ECHO_TOPS_SOURCE_ID = 'fire-echo-tops-source';
export const ECHO_TOPS_LAYER_ID = 'fire-echo-tops-layer';

export function normalizeLandingPoints(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(v => String(v)).filter(Boolean);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(v => String(v)).filter(Boolean) : [value];
    } catch {
      return value.split(/[,;]+/).map(v => v.trim()).filter(Boolean);
    }
  }
  return [];
}

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}


export function scoreToISNRColor(score: number): string {
  if (score >= 80) return ISNR_COLORS.critical;
  if (score >= 60) return ISNR_COLORS.high;
  if (score >= 40) return ISNR_COLORS.medium;
  if (score >= 20) return ISNR_COLORS.low;
  return ISNR_COLORS.stable;
}

export function scoreToISNRLineColor(score: number): string {
  if (score >= 80) return 'rgba(255,59,48,0.8)';
  if (score >= 60) return 'rgba(255,149,0,0.7)';
  if (score >= 40) return 'rgba(255,204,0,0.6)';
  if (score >= 20) return 'rgba(52,199,89,0.5)';
  return 'rgba(52,199,89,0.3)';
}


export function deptCodeToId(code: string): number {
  if (code === '2A') return 200;
  if (code === '2B') return 201;
  const n = parseInt(code, 10);
  return isNaN(n) ? 999 : n;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
