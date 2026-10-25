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
  return `<div class="tv-callout tv-callout--${p.level}"><span class="tv-mode">${fmIcon(TRANSPORT_MODE_ICON[p.mode])}</span>`
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

/**
 * Pose les étiquettes : à droite de leur ancre, à gauche quand la place manque. Sur chaque côté, triées par hauteur, elles sont
 * poussées vers le bas pour ne jamais se chevaucher puis remontées si elles sortent de la carte ; les étiquettes qui se touchent
 * forment une colonne alignée (même bord, à distance de l'ancre la plus avancée). Le trait est une courbe douce de l'ancre au
 * milieu du bord de l'étiquette. Pur : testé sans carte.
 */
export function layoutCallouts(boxes: readonly CalloutBox[], width: number, height: number): CalloutPlacement[] {
  const out: CalloutPlacement[] = boxes.map(() => ({ left: 0, top: 0, side: 'right', path: '' }));
  const sides: Record<'right' | 'left', number[]> = { right: [], left: [] };
  boxes.forEach((b, i) => sides[b.x + LEADER_GAP_PX + b.w <= width - EDGE_PX || b.x - LEADER_GAP_PX - b.w < EDGE_PX ? 'right' : 'left'].push(i));
  for (const side of ['right', 'left'] as const) {
    // Ancres quasi confondues (moins de 24 px) : ordre des numéros, pour une colonne qui se lit de haut en bas.
    const idx = sides[side].sort((a, b) => (Math.abs(boxes[a].y - boxes[b].y) < 24 ? a - b : boxes[a].y - boxes[b].y));
    const top = idx.map((i) => boxes[i].y - boxes[i].h / 2);
    const h = (k: number): number => boxes[idx[k]].h;
    const touches = (k: number): boolean => top[k] <= top[k - 1] + h(k - 1) + LABEL_GAP_PX + 0.5;
    const sweep = (): void => {
      for (let k = 1; k < idx.length; k += 1) top[k] = Math.max(top[k], top[k - 1] + h(k - 1) + LABEL_GAP_PX);
      for (let k = idx.length - 1; k >= 0; k -= 1) {
        const limit = k === idx.length - 1 ? height - EDGE_PX : top[k + 1] - LABEL_GAP_PX;
        top[k] = Math.max(EDGE_PX, Math.min(top[k], limit - h(k)));
      }
    };
    sweep();
    // Une colonne poussée vers le bas est recentrée sur ses ancres, puis les colonnes sont de nouveau écartées.
    for (let pass = 0; pass < 2; pass += 1) {
      let s0 = 0;
      for (let k = 1; k <= idx.length; k += 1) {
        if (k < idx.length && touches(k)) continue;
        const span = top[k - 1] + h(k - 1) - top[s0];
        const mean = idx.slice(s0, k).reduce((acc, i) => acc + boxes[i].y, 0) / (k - s0);
        const shift = mean - (top[s0] + span / 2);
        for (let g = s0; g < k; g += 1) top[g] += shift;
        s0 = k;
      }
      sweep();
    }
    // Colonnes : étiquettes consécutives qui se touchent.
    let start = 0;
    for (let k = 1; k <= idx.length; k += 1) {
      if (k < idx.length && touches(k)) continue;
      const group = idx.slice(start, k);
      const edge = side === 'right'
        ? Math.max(...group.map((i) => boxes[i].x)) + LEADER_GAP_PX
        : Math.min(...group.map((i) => boxes[i].x)) - LEADER_GAP_PX;
      group.forEach((i, g) => {
        const b = boxes[i];
        const t = top[start + g];
        const left = side === 'right' ? Math.min(edge, width - EDGE_PX - b.w) : Math.max(EDGE_PX, edge - b.w);
        const ex = side === 'right' ? left : left + b.w;
        const ey = t + b.h / 2;
        const dir = side === 'right' ? 1 : -1;
        const dx = ex - b.x;
        const dy = ey - b.y;
        const len = Math.hypot(dx, dy) || 1;
        const sx = b.x + (dx / len) * ANCHOR_R_PX;
        const sy = b.y + (dy / len) * ANCHOR_R_PX;
        const c = Math.max(12, Math.abs(ex - sx) * 0.55) * dir;
        const r = (v: number): string => v.toFixed(1);
        out[i] = { left, top: t, side, path: `M${r(sx)} ${r(sy)}C${r(sx + c)} ${r(sy)} ${r(ex - c)} ${r(ey)} ${r(ex)} ${r(ey)}` };
      });
      start = k;
    }
  }
  return out;
}
