// src/services/webcam-wall.ts : état pur du mur de webcams (fenêtre flottante sur la carte) : webcams épinglées dans l'ordre,
// disposition (colonnes), position et taille, ouvert ou replié. Gardé dans localStorage, relu avec une garde stricte : un état
// abîmé repart des valeurs par défaut. Aucun accès réseau ; les images restent chez leur diffuseur et ne sont jamais enregistrées.
import type { Webcam, WebcamsDataset } from '../types/index.ts';
import { webcamEmbedUrl, webcamThumbnailUrl } from './webcams.ts';

export const WALL_STORAGE_KEY = 'fm.webcams.wall';
/** Au-delà, le mur devient illisible et charge trop d'images à chaque rafraîchissement. */
export const WALL_MAX_TILES = 12;
/** Rafraîchissement des images : les caméras Criter (Lyon) et Loire-Atlantique se renouvellent à la minute environ. */
export const WALL_REFRESH_MS = 60_000;
/** 0 = automatique (selon la largeur de la fenêtre). */
export const WALL_LAYOUTS = [0, 1, 2, 3, 4] as const;
export type WallLayout = (typeof WALL_LAYOUTS)[number];

export const WALL_MIN_W = 280;
export const WALL_MIN_H = 200;

export interface WallRect { x: number; y: number; w: number; h: number }

export interface WallState {
  ids: string[];
  layout: WallLayout;
  open: boolean;
  minimized: boolean;
  /** Tuile agrandie (seule affichée) ; null = mosaïque. */
  focusId: string | null;
  rect: WallRect | null;
}

export const DEFAULT_WALL: Readonly<WallState> = { ids: [], layout: 0, open: false, minimized: false, focusId: null, rect: null };

interface WallStorage { getItem(key: string): string | null; setItem(key: string, value: string): void }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function readRect(v: unknown): WallRect | null {
  if (!isRecord(v) || !isNum(v['x']) || !isNum(v['y']) || !isNum(v['w']) || !isNum(v['h'])) return null;
  return { x: v['x'], y: v['y'], w: Math.max(WALL_MIN_W, v['w']), h: Math.max(WALL_MIN_H, v['h']) };
}

/** Relecture stricte : identifiants dédoublonnés et plafonnés, disposition connue, sinon valeurs par défaut. */
export function parseWallState(raw: string | null): WallState {
  if (raw === null) return { ...DEFAULT_WALL, ids: [] };
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_WALL, ids: [] };
  }
  if (!isRecord(v)) return { ...DEFAULT_WALL, ids: [] };
  const ids = Array.isArray(v['ids'])
    ? [...new Set(v['ids'].filter((x): x is string => typeof x === 'string' && x.length > 0))].slice(0, WALL_MAX_TILES)
    : [];
  const layout = (WALL_LAYOUTS as readonly unknown[]).includes(v['layout']) ? v['layout'] as WallLayout : 0;
  const focusId = typeof v['focusId'] === 'string' && ids.includes(v['focusId']) ? v['focusId'] : null;
  return {
    ids, layout, focusId, rect: readRect(v['rect']),
    open: v['open'] === true, minimized: v['minimized'] === true,
  };
}

export function loadWallState(storage: WallStorage | null): WallState {
  try {
    return parseWallState(storage?.getItem(WALL_STORAGE_KEY) ?? null);
  } catch {
    return { ...DEFAULT_WALL, ids: [] };
  }
}

export function saveWallState(storage: WallStorage | null, s: WallState): void {
  try {
    storage?.setItem(WALL_STORAGE_KEY, JSON.stringify(s));
  } catch {
    // stockage plein ou interdit : le mur fonctionne pour la session
  }
}

// ─── Transitions pures ───

export function isOnWall(s: WallState, id: string): boolean {
  return s.ids.includes(id);
}

/** Ajout en fin de mur, qui s'ouvre ; déjà présente : le mur s'ouvre seulement ; mur plein : état inchangé. */
export function addToWall(s: WallState, id: string): WallState {
  if (s.ids.includes(id)) return { ...s, open: true, minimized: false };
  if (s.ids.length >= WALL_MAX_TILES) return s;
  return { ...s, ids: [...s.ids, id], open: true, minimized: false };
}

export function removeFromWall(s: WallState, id: string): WallState {
  return { ...s, ids: s.ids.filter((x) => x !== id), focusId: s.focusId === id ? null : s.focusId };
}

export function toggleOnWall(s: WallState, id: string): WallState {
  return isOnWall(s, id) ? removeFromWall(s, id) : addToWall(s, id);
}

/** Déplace une tuile d'un cran (-1 = avant, +1 = après) ; sans effet aux bords. */
export function moveOnWall(s: WallState, id: string, delta: -1 | 1): WallState {
  const i = s.ids.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= s.ids.length) return s;
  const ids = [...s.ids];
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return { ...s, ids };
}

/** Garde la fenêtre dans la zone visible (au moins l'en-tête attrapable) et pas plus grande qu'elle. */
export function clampRect(r: WallRect, viewW: number, viewH: number): WallRect {
  const w = Math.min(Math.max(WALL_MIN_W, r.w), Math.max(WALL_MIN_W, viewW - 16));
  const h = Math.min(Math.max(WALL_MIN_H, r.h), Math.max(WALL_MIN_H, viewH - 16));
  const x = Math.min(Math.max(0, r.x), Math.max(0, viewW - w));
  const y = Math.min(Math.max(0, r.y), Math.max(0, viewH - 40));
  return { x, y, w, h };
}

/** Nombre de colonnes : choisi, sinon selon la largeur (environ 260 px par image) et le nombre de tuiles. */
export function wallColumns(layout: WallLayout, tiles: number, width: number): number {
  if (tiles <= 1) return 1;
  if (layout !== 0) return Math.min(layout, tiles);
  return Math.max(1, Math.min(tiles, 4, Math.floor(width / 260)));
}

// ─── Lecture des tuiles ───

export interface WallTile {
  id: string;
  /** null : webcam disparue du recensement (gardée pour que l'utilisateur la retire lui-même). */
  webcam: Webcam | null;
  /** Image affichable (licence ouverte, image directe vivante) ; null = pas d'image. */
  imageUrl: string | null;
  /** Lecteur vidéo (direct YouTube intégrable) ; null = pas de vidéo. Sans image ni vidéo : lien seulement. */
  embedUrl: string | null;
}

export function wallTiles(ds: WebcamsDataset | null, s: WallState): WallTile[] {
  return s.ids.map((id) => {
    const webcam = ds?.webcams.find((w) => w.id === id) ?? null;
    return { id, webcam, imageUrl: webcam ? webcamThumbnailUrl(webcam) : null, embedUrl: webcam ? webcamEmbedUrl(webcam) : null };
  });
}

/** Webcams proposées dans « Ajouter » : vidéos en direct et images affichables, absentes du mur, triées par commune puis nom. */
export function wallCandidates(ds: WebcamsDataset | null, s: WallState): Webcam[] {
  if (!ds) return [];
  return ds.webcams
    .filter((w) => (webcamThumbnailUrl(w) !== null || webcamEmbedUrl(w) !== null) && !s.ids.includes(w.id))
    .sort((a, b) => (a.commune ?? '').localeCompare(b.commune ?? '', 'fr') || a.name.localeCompare(b.name, 'fr'));
}

/** URL rafraîchie : paramètre « fm_t » ajouté pour contourner le cache du navigateur (les serveurs l'ignorent). */
export function refreshedImageUrl(url: string, nowMs: number): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}fm_t=${Math.floor(nowMs / 1000)}`;
}
