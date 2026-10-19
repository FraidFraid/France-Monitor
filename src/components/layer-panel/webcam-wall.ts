// src/components/layer-panel/webcam-wall.ts : rendu pur du mur de webcams (fenêtre flottante, plusieurs images côte à côte).
// Image affichée seulement pour une image directe sous licence ouverte (countable) ; les autres webcams gardent une tuile avec le
// lien « Ouvrir la webcam ». Jamais d'iframe. Textes du fichier échappés ; aucun accès réseau ni DOM.
import type { WebcamsDataset } from '../../types/index.ts';
import {
  WALL_LAYOUTS, WALL_MAX_TILES, type WallLayout, type WallState, type WallTile, refreshedImageUrl, wallCandidates, wallTiles,
} from '../../services/webcam-wall.ts';
import { webcamOpenUrl, webcamPlace } from '../../services/webcams.ts';
import { escapeHtml, safeHref } from '../france-intel-events.ts';
import { fmIcon, type IconName } from '../shared/icons.ts';
import { NBSP } from './format.ts';

export interface WallViewInput {
  data: WebcamsDataset | null;
  state: WallState;
  columns: number;
  /** Heure du dernier rafraîchissement des images (ms) : sert aussi à contourner le cache du navigateur. */
  refreshedMs: number;
  /** « 08:21 » ; null tant qu'aucune image n'a été chargée. */
  refreshedLabel: string | null;
}

const LAYOUT_WORD: Readonly<Record<WallLayout, string>> = { 0: 'Auto', 1: '1', 2: '2', 3: '3', 4: '4' };

function iconButton(action: string, icon: IconName, label: string, extra = ''): string {
  return `<button type="button" class="wcw-btn" data-wall-action="${action}"${extra} title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">`
    + `${fmIcon(icon, { size: 14 })}</button>`;
}

function layoutSwitch(current: WallLayout): string {
  const items = WALL_LAYOUTS.map((l) => {
    const on = l === current;
    const label = l === 0 ? 'Disposition automatique' : `${l}${NBSP}colonne${l > 1 ? 's' : ''}`;
    return `<button type="button" class="wcw-seg${on ? ' is-on' : ''}" data-wall-action="layout" data-value="${l}"`
      + ` aria-pressed="${on}" title="${escapeHtml(label)}">${escapeHtml(LAYOUT_WORD[l])}</button>`;
  }).join('');
  return `<div class="wcw-segs" role="group" aria-label="Colonnes">${items}</div>`;
}

function addSelect(input: WallViewInput): string {
  const full = input.state.ids.length >= WALL_MAX_TILES;
  const candidates = wallCandidates(input.data, input.state);
  if (full) return `<span class="wcw-hint">Mur plein (${WALL_MAX_TILES}${NBSP}webcams) : retirer une image pour en ajouter une.</span>`;
  if (candidates.length === 0) return '<span class="wcw-hint">Toutes les images sous licence ouverte sont déjà sur le mur.</span>';
  const options = candidates.map((w) => `<option value="${escapeHtml(w.id)}">${escapeHtml(`${webcamPlace(w)} · ${w.name}`)}</option>`).join('');
  return `<label class="wcw-add"><span>Ajouter</span><select data-wall-action="add" aria-label="Ajouter une webcam au mur">`
    + `<option value="">Choisir une image (${candidates.length})</option>${options}</select></label>`;
}

function tileHtml(t: WallTile, index: number, count: number, input: WallViewInput): string {
  const w = t.webcam;
  const focused = input.state.focusId === t.id;
  const name = w ? w.name : 'Webcam retirée du recensement';
  const src = t.imageUrl ? safeHref(refreshedImageUrl(t.imageUrl, input.refreshedMs)) : null;
  const open = w ? safeHref(webcamOpenUrl(w) ?? '') : null;
  const openLink = open ? `<a class="wcw-open" href="${open}" target="_blank" rel="noopener noreferrer">Ouvrir la webcam</a>` : '';
  const media = src
    ? `<img src="${src}" alt="${escapeHtml(`Image de la webcam ${name}`)}" referrerpolicy="no-referrer" decoding="async" draggable="false">`
      + '<span class="wcw-broken">Image indisponible pour le moment</span>'
    : `<div class="wcw-noimg"><span>${w ? 'Pas d’image affichable ici (licence inconnue ou page web).' : 'Cette webcam n’est plus dans le recensement.'}</span>${openLink}</div>`;
  const id = escapeHtml(t.id);
  const tools = (index > 0 ? iconButton('left', 'chevron-left', 'Déplacer avant', ` data-id="${id}"`) : '')
    + (index < count - 1 ? iconButton('right', 'chevron-right', 'Déplacer après', ` data-id="${id}"`) : '')
    + (src ? iconButton('focus', focused ? 'minimize-2' : 'maximize-2', focused ? 'Revenir à la mosaïque' : 'Agrandir', ` data-id="${id}"`) : '')
    + iconButton('remove', 'x', 'Retirer du mur', ` data-id="${id}"`);
  const credit = w ? [w.attribution, w.license].filter((x): x is string => !!x).join(' · ') : '';
  return `<figure class="wcw-tile${src ? '' : ' is-link'}" data-id="${id}">`
    + `<div class="wcw-media">${media}</div>`
    + `<figcaption><span class="wcw-name">${escapeHtml(name)}</span>`
    + (w ? `<span class="wcw-place">${escapeHtml(webcamPlace(w))}</span>` : '')
    + (credit ? `<span class="wcw-credit">${escapeHtml(credit)}</span>` : '')
    + (src && openLink ? openLink : '')
    + `</figcaption><div class="wcw-tools">${tools}</div></figure>`;
}

/** Contenu complet de la fenêtre (l'enveloppe, sa position et sa taille sont gérées par le composant DOM). */
export function renderWebcamWall(input: WallViewInput): string {
  const { state } = input;
  const all = wallTiles(input.data, state);
  const tiles = state.focusId ? all.filter((t) => t.id === state.focusId) : all;
  const count = `${state.ids.length}${NBSP}/${NBSP}${WALL_MAX_TILES}`;
  const head = `<header class="wcw-head" data-wall-drag>`
    + `<span class="wcw-title">${fmIcon('camera', { size: 14 })}<span>Mur de webcams</span><span class="wcw-count">${count}</span></span>`
    + `<span class="wcw-tools-head">`
    + (input.refreshedLabel ? `<span class="wcw-time" title="Images rafraîchies chaque minute">${escapeHtml(input.refreshedLabel)}</span>` : '')
    + iconButton('refresh', 'rotate-ccw', 'Rafraîchir les images')
    + iconButton('minimize', state.minimized ? 'chevron-down' : 'minus', state.minimized ? 'Déplier' : 'Replier')
    + iconButton('close', 'x', 'Fermer le mur')
    + `</span></header>`;
  if (state.minimized) return head;
  const bar = `<div class="wcw-bar">${addSelect(input)}${layoutSwitch(state.layout)}</div>`;
  const body = tiles.length === 0
    ? '<p class="wcw-empty">Aucune webcam sur le mur. Choisir une image ci-dessus, ou cliquer une webcam sur la carte puis « Ajouter au mur ».</p>'
    : `<div class="wcw-grid${state.focusId ? ' is-focus' : ''}" style="--wcw-cols:${state.focusId ? 1 : input.columns}">`
      + tiles.map((t) => tileHtml(t, all.indexOf(t), all.length, input)).join('') + '</div>';
  return head + bar + `<div class="wcw-body">${body}</div>`
    + '<p class="wcw-foot">Images chargées chez leur diffuseur, rafraîchies chaque minute, jamais enregistrées. Seules les images sous licence ouverte s’affichent ; les autres webcams ouvrent leur site.</p>';
}
