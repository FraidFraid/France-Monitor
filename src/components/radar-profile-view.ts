/**
 * Profil vertical radar (phase 0 « radar 3D ») — rendu pur, testable.
 * DÉMONSTRATION assumée : réflectivité PAM brute, aucun diagnostic.
 * Palette alignée sur services/radar-worker/render.py (PALETTE 2D).
 */
import type { RadarColumnResult, RadarColumnProfile } from '../types/index.ts';

const WIDTH = 260;
const HEIGHT = 150;
const MARGIN = { top: 10, right: 12, bottom: 22, left: 34 };
const MAX_ALTITUDE_M = 12_000;
const DBZ_MIN = -10;
const DBZ_MAX = 70;

const DBZ_COLORS: readonly (readonly [number, string])[] = [
  [-9, '#5ed3ff'], [0, '#39abff'], [10, '#228be6'], [20, '#26c56a'],
  [30, '#f5dc42'], [40, '#f78f2d'], [50, '#e74848'], [60, '#ae3bc4'], [70, '#ffffff'],
];

function dbzColor(dbz: number): string {
  let selected = DBZ_COLORS[0][1];
  for (const [threshold, color] of DBZ_COLORS) {
    if (dbz < threshold) break;
    selected = color;
  }
  return selected;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function x(dbz: number): number {
  const clamped = Math.min(DBZ_MAX, Math.max(DBZ_MIN, dbz));
  const inner = WIDTH - MARGIN.left - MARGIN.right;
  return MARGIN.left + ((clamped - DBZ_MIN) / (DBZ_MAX - DBZ_MIN)) * inner;
}

function y(altitudeM: number): number {
  const clamped = Math.min(MAX_ALTITUDE_M, Math.max(0, altitudeM));
  const inner = HEIGHT - MARGIN.top - MARGIN.bottom;
  return HEIGHT - MARGIN.bottom - (clamped / MAX_ALTITUDE_M) * inner;
}

function svg(profile: RadarColumnProfile): string {
  const gridLines = [0, 3_000, 6_000, 9_000, 12_000]
    .map((altitude) => {
      const py = y(altitude).toFixed(1);
      return `<line x1="${MARGIN.left}" y1="${py}" x2="${WIDTH - MARGIN.right}" y2="${py}" stroke="rgba(255,255,255,0.08)"/>`
        + `<text x="${MARGIN.left - 4}" y="${py}" text-anchor="end" dominant-baseline="middle" fill="var(--text-muted)" font-size="8">${altitude / 1000} km</text>`;
    })
    .join('');
  const axis = [0, 20, 40, 60]
    .map((dbz) => `<text x="${x(dbz).toFixed(1)}" y="${HEIGHT - 8}" text-anchor="middle" fill="var(--text-muted)" font-size="8">${dbz}</text>`)
    .join('');
  const marks = profile.levels
    .map((level) => {
      const py = y(level.altitudeM).toFixed(1);
      if (level.dbz === null) {
        return `<circle data-empty="1" cx="${MARGIN.left.toFixed(1)}" cy="${py}" r="2.5" fill="none" stroke="var(--text-muted)" stroke-width="1"/>`;
      }
      const px = x(level.dbz).toFixed(1);
      const color = dbzColor(level.dbz);
      return `<line x1="${MARGIN.left}" y1="${py}" x2="${px}" y2="${py}" stroke="${color}" stroke-opacity="0.35" stroke-width="3"/>`
        + `<circle data-dbz="${level.dbz}" cx="${px}" cy="${py}" r="3.5" fill="${color}"/>`;
    })
    .join('');
  return `<svg viewBox="0 0 ${WIDTH} ${HEIGHT}" width="100%" style="display:block;" role="img" aria-label="Profil vertical de réflectivité radar">`
    + gridLines + axis + marks
    + `<text x="${WIDTH - MARGIN.right}" y="${HEIGHT - 8}" text-anchor="end" fill="var(--text-muted)" font-size="8">dBZ</text>`
    + `</svg>`;
}

const BADGE = `<span style="background:rgba(255,214,10,0.15);color:#ffd60a;border:1px solid rgba(255,214,10,0.4);border-radius:4px;padding:1px 6px;font-size:9px;font-weight:700;letter-spacing:0.5px;">DÉMONSTRATION</span>`;

export function radarProfileLoadingHtml(): string {
  return `<div style="padding:10px 14px;color:var(--text-muted);font-size:10px;">Chargement du profil radar…</div>`;
}

export function radarProfileErrorHtml(): string {
  return `<div style="padding:10px 14px;color:var(--text-muted);font-size:10px;">Profil radar indisponible pour le moment.</div>`;
}

export function radarProfileHtml(result: RadarColumnResult): string {
  if (result.kind === 'hors-couverture') {
    return `<div style="padding:10px 14px;color:var(--text-muted);font-size:10px;">${BADGE} Foyer hors de portée des radars métropole (&gt; 160 km).</div>`;
  }
  const { profile } = result;
  const observed = new Date(profile.observedAt);
  const time = Number.isFinite(observed.getTime())
    ? new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(observed)
    : profile.observedAt;
  return `<div style="padding:8px 14px;display:flex;flex-direction:column;gap:6px;">`
    + `<div style="display:flex;align-items:center;gap:6px;font-size:10px;color:var(--text-muted);">${BADGE}`
    + `<span>Radar ${escapeHtml(profile.station.name)} · ${profile.distanceKm} km · obs. ${time} · ${profile.levels.length} élévation${profile.levels.length > 1 ? 's' : ''}</span></div>`
    + svg(profile)
    + `<div style="font-size:9px;color:var(--text-muted);">Réflectivité brute (échos fixes non corrigés) · sans diagnostic automatique · Météo-France DPRadar, Licence Ouverte 2.0</div>`
    + `</div>`;
}
