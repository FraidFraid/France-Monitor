// src/components/deckgl/transport-callouts.ts : points de vigilance de l'onglet Transports sur la carte (lots 1 et 2, 25/10/2026).
// Étiquettes numérotées, ancrées sur le lieu par un rond pulsant qui porte l'icône du mode (train, voiture, avion, navire) : route et
// rail se distinguent d'un coup d'œil. Même numéro que l'En bref. Gabarit HTML pur (texte échappé) ; DeckGLMap pose les marqueurs.
import type { TransportMode, TransportVigilancePoint } from '../layer-panel/transport-vigilance.ts';
import { fmIcon, type IconName } from '../shared/icons.ts';
import { escapeHtml } from './format-utils.ts';

export const TRANSPORT_MODE_ICON: Readonly<Record<TransportMode, IconName>> = {
  trafficRail: 'train-front', trafficRoad: 'car-front', trafficAir: 'plane', trafficMaritime: 'ship',
};

/** Extrémité du trait, posée sur le lieu : un point de la couleur du niveau, pulsant. */
export function calloutAnchorHtml(p: TransportVigilancePoint): string {
  return `<span class="tv-dot tv-dot--${p.level}" aria-hidden="true"></span>`;
}

/**
 * Étiquette : pastille à l'icône du mode (train, voiture, avion, navire) pour comprendre d'un coup d'œil, puis numéro (celui de
 * l'En bref), titre et ligne courte ; posée par layoutCallouts, reliée au point par un trait.
 */
export function calloutLabelHtml(p: TransportVigilancePoint): string {
  return `<div class="tv-callout tv-callout--${p.level}" data-n="${p.n}"><span class="tv-mode">${fmIcon(TRANSPORT_MODE_ICON[p.mode])}</span>`
    + `<div><b><span class="tv-n">${p.n}.</span>${escapeHtml(p.title)}</b><span>${escapeHtml(p.short)}</span></div></div>`;
}

/** Infobulle au survol : phrase complète, cause en bloc (annoncée ou à vérifier), qui est concerné ; fond opaque (.tv-tip). */
export function calloutTooltipHtml(p: TransportVigilancePoint): string {
  const tag = p.causeTag === 'annoncée' ? '<i class="tv-tag tv-tag--ok">cause annoncée</i>' : '<i class="tv-tag">à vérifier</i>';
  const routes = p.routes && p.routes.length > 0 ? `<p class="tv-tip-hint">Trajets des ${p.routes.length} trains allumés sur la carte.</p>` : '';
  return `<div class="tv-tip tv-tip--${p.level}"><b>${p.n}. ${escapeHtml(p.title)}</b><span class="tv-tip-sub">${escapeHtml(p.short)}</span>`
    + `<p>${escapeHtml(p.detail)}</p>`
    + `<p><em>Cause</em> ${escapeHtml(p.cause ?? 'non précisée par la source')} ${tag}</p>`
    + `<p><em>Concerne</em> ${escapeHtml(p.who)}</p>${routes}</div>`;
}

/** Trajets des trains d'un point (survol) : une ligne par train, couleur du niveau du point. */
export function calloutRoutesFeatures(p: TransportVigilancePoint | null): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: (p?.routes ?? []).map((coords) => ({
      type: 'Feature', properties: { level: p?.level ?? 'orange' }, geometry: { type: 'LineString', coordinates: coords.map(([x, y]) => [x, y]) },
    })),
  };
}

/** Signature d'un ensemble de points : les marqueurs ne sont reposés que si elle change. */
export function calloutsSignature(points: readonly TransportVigilancePoint[]): string {
  return points.map((p) => `${p.id}|${p.n}|${p.level}|${p.short}|${p.lon}|${p.lat}`).join(';');
}

/** Étiquette tamisée : une pastille Transports est mise en avant et ce n'est pas celle du mode du point. */
export function calloutDimmed(mode: TransportMode, focus: readonly string[]): boolean {
  return focus.length > 0 && !focus.includes(mode);
}

// ─── Disposition des étiquettes (25/10/2026) : colonnes propres de chaque côté, aucun chevauchement, trait courbe vers le lieu ───

/** Ancre projetée à l'écran (px) et taille mesurée de son étiquette. */
export interface CalloutBox { x: number; y: number; w: number; h: number }
/** Étiquette posée : coin haut gauche (px), côté, et tracé SVG du trait de l'ancre au bord de l'étiquette. */
export interface CalloutPlacement { left: number; top: number; side: 'right' | 'left'; path: string }

/** Écart horizontal minimal entre l'ancre et le bord de l'étiquette (px). */
const LEADER_GAP_PX = 46;
/** Espace vertical entre deux étiquettes empilées (px). */
const LABEL_GAP_PX = 6;
/** Marge au bord de la carte (px). */
const EDGE_PX = 8;
/** Rayon du point d'extrémité : le trait part de son bord. */
const ANCHOR_R_PX = 5;

/** Lieux plus proches que ce rayon à l'écran (px) : leurs étiquettes forment une même colonne. */
const CLUSTER_PX = 110;

/**
 * Pose les étiquettes. Les lieux proches à l'écran (moins de CLUSTER_PX, de proche en proche) forment une grappe : ses étiquettes
 * s'empilent en une colonne alignée à droite de la grappe (à gauche faute de place), dans l'ordre des numéros quand les lieux se
 * confondent, centrée sur leur hauteur moyenne. Une colonne qui en chevauche une autre déjà posée descend sous elle (remonte si elle
 * sort de la carte). Un lieu isolé garde son étiquette juste à côté de lui : jamais de trait qui traverse la carte. Trait : courbe
 * douce du lieu au milieu du bord de l'étiquette. Pur : testé sans carte.
 */
export function layoutCallouts(boxes: readonly CalloutBox[], width: number, height: number): CalloutPlacement[] {
  const out: CalloutPlacement[] = boxes.map(() => ({ left: 0, top: 0, side: 'right', path: '' }));
  // Grappes : liaison simple sous CLUSTER_PX.
  const parent = boxes.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = 0; j < i; j += 1) if (Math.hypot(boxes[i].x - boxes[j].x, boxes[i].y - boxes[j].y) < CLUSTER_PX) parent[root(i)] = root(j);
  }
  const clusters = new Map<number, number[]>();
  boxes.forEach((_, i) => clusters.set(root(i), [...(clusters.get(root(i)) ?? []), i]));
  const placed: Array<{ l: number; t: number; r: number; b: number }> = [];
  const ordered = [...clusters.values()].sort((a, b) => Math.min(...a.map((i) => boxes[i].y)) - Math.min(...b.map((i) => boxes[i].y)));
  for (const members of ordered) {
    // Ancres quasi confondues (moins de 24 px) : ordre des numéros, pour une colonne qui se lit de haut en bas.
    const idx = [...members].sort((a, b) => (Math.abs(boxes[a].y - boxes[b].y) < 24 ? a - b : boxes[a].y - boxes[b].y));
    const colW = Math.max(...idx.map((i) => boxes[i].w));
    const colH = idx.reduce((acc, i) => acc + boxes[i].h, 0) + LABEL_GAP_PX * (idx.length - 1);
    const maxX = Math.max(...idx.map((i) => boxes[i].x));
    const minX = Math.min(...idx.map((i) => boxes[i].x));
    const side: 'right' | 'left' = maxX + LEADER_GAP_PX + colW <= width - EDGE_PX || minX - LEADER_GAP_PX - colW < EDGE_PX ? 'right' : 'left';
    const colL = side === 'right' ? Math.min(maxX + LEADER_GAP_PX, width - EDGE_PX - colW) : Math.max(EDGE_PX, minX - LEADER_GAP_PX - colW);
    const meanY = idx.reduce((acc, i) => acc + boxes[i].y, 0) / idx.length;
    let top = Math.max(EDGE_PX, Math.min(meanY - colH / 2, height - EDGE_PX - colH));
    // Colonne qui chevauche une colonne déjà posée : elle descend sous elle, puis remonte si elle sort de la carte.
    for (let guard = 0; guard < placed.length + 1; guard += 1) {
      const hit = placed.find((p) => colL < p.r + LABEL_GAP_PX && colL + colW > p.l - LABEL_GAP_PX && top < p.b + LABEL_GAP_PX && top + colH > p.t - LABEL_GAP_PX);
      if (!hit) break;
      top = hit.b + LABEL_GAP_PX;
    }
    if (top + colH > height - EDGE_PX) top = Math.max(EDGE_PX, height - EDGE_PX - colH);
    placed.push({ l: colL, t: top, r: colL + colW, b: top + colH });
    let y = top;
    for (const i of idx) {
      const b = boxes[i];
      const left = side === 'right' ? colL : colL + colW - b.w;
      out[i] = { left, top: y, side, path: leaderPath(b, left, y, side) };
      y += b.h + LABEL_GAP_PX;
    }
  }
  return out;
}

/** Courbe douce du bord du point au milieu du bord de l'étiquette. */
function leaderPath(b: CalloutBox, left: number, top: number, side: 'right' | 'left'): string {
  const ex = side === 'right' ? left : left + b.w;
  const ey = top + b.h / 2;
  const dx = ex - b.x;
  const dy = ey - b.y;
  const len = Math.hypot(dx, dy) || 1;
  const sx = b.x + (dx / len) * ANCHOR_R_PX;
  const sy = b.y + (dy / len) * ANCHOR_R_PX;
  const c = Math.max(12, Math.abs(ex - sx) * 0.55) * (side === 'right' ? 1 : -1);
  const r = (v: number): string => v.toFixed(1);
  return `M${r(sx)} ${r(sy)}C${r(sx + c)} ${r(sy)} ${r(ex - c)} ${r(ey)} ${r(ex)} ${r(ey)}`;
}
