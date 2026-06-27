// Extracted from DeckGLMap.ts — pure formatting / labelling / conversion helpers.
import { ISS_LEVELS } from '../../types/index.ts';
import type { ISSLevel } from '../../types/index.ts';
import { WEATHER_RISK_EMOJIS, ISNR_COLORS } from './constants.ts';

export function getWeatherRadarSourceId(regionId: string): string {
  return `weather-radar-src-${regionId}`;
}

export function getWeatherRadarLayerId(regionId: string): string {
  return `weather-radar-${regionId}`;
}
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

/** Get emoji for primary risk */
export function getWeatherRiskEmoji(risks: string[]): string {
  if (risks.length === 0) return '⚠️';
  return WEATHER_RISK_EMOJIS[risks[0]] ?? '⚠️';
}

// ─── ISS (Indice de Stress Sanitaire) → color helpers ───

export function issToFillColor(iss: number): string {
  const lvl = ISS_LEVELS.find(l => iss >= l.range[0] && iss <= l.range[1]) ?? ISS_LEVELS[0];
  return lvl.fillColor;
}

export function issToLineColor(iss: number): string {
  const lvl = ISS_LEVELS.find(l => iss >= l.range[0] && iss <= l.range[1]) ?? ISS_LEVELS[0];
  return lvl.lineColor;
}

export function issToColor(iss: number): string {
  const lvl = ISS_LEVELS.find(l => iss >= l.range[0] && iss <= l.range[1]) ?? ISS_LEVELS[0];
  return lvl.color;
}

export function getISSSemio(iss: number): { icon: string; name: string; label: string; color: string; level: ISSLevel } {
  const lvl = ISS_LEVELS.find(l => iss >= l.range[0] && iss <= l.range[1]) ?? ISS_LEVELS[0];
  return { icon: lvl.icon, name: lvl.name, label: lvl.label, color: lvl.color, level: lvl.level };
}

export function getHealthSourceLabel(source: string): string {
  switch (source) {
    case 'spf-epid': return 'Santé Publique France';
    case 'drees': return 'DREES';
    case 'sentinelles': return 'Sentinelles';
    case 'composite': return 'Multi-sources';
    case 'ansm': return 'ANSM';
    case 'oscour': return 'OSCOUR';
    case 'sos-medecins': return 'SOS Médecins';
    default: return 'SPF / DREES';
  }
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
