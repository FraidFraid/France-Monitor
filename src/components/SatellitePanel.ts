/**
 * SatellitePanel.ts — Floating satellite imagery overlay.
 * Instantiated in App.ts. Triggered via show(SatelliteViewRequest).
 * Displays Sentinel-2/1 STAC thumbnails or falls back to EO Browser deep-link.
 * STAC-S1-THUMBNAIL-RELIABILITY: S1 GRD items may not have thumbnails in AWS Earth Search.
 * In that case, the SAR tab shows EO Browser deep-link only.
 */

import type {
  SatelliteViewRequest,
  SatelliteViewState,
  CopernicusScene,
  SatelliteCollection,
} from '../types/index.ts';
import {
  fetchSentinel2Scenes,
  fetchSentinel1Scenes,
  buildEoBrowserUrl,
} from '../services/copernicus.ts';

function escapeHtml(s: string): string {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function formatDate(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleDateString('fr-FR', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch {
    return isoDate;
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class SatellitePanel {
  private element: HTMLElement;
  private abortController: AbortController | null = null;
  private state: SatelliteViewState = {
    visible: false,
    request: null,
    activeCollection: 'sentinel-2-l2a',
    s2Scenes: [],
    s1Scenes: [],
    activeSceneIndex: 0,
    loading: false,
    error: null,
    eoBrowserUrl: '',
  };

  /** Callback for Approach C upgrade: called when WMS URL is available from backend */
  onWmsRequested?: (wmsUrl: string, bbox: [number, number, number, number]) => void;

  constructor(parentEl: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'satellite-panel';
    this.element.style.display = 'none';
    parentEl.appendChild(this.element);
  }

  show(req: SatelliteViewRequest): void {
    // Cancel any in-flight fetch
    this.abortController?.abort();
    this.abortController = new AbortController();

    const coll: SatelliteCollection = req.preferredCollection ?? 'sentinel-2-l2a';
    this.state = {
      visible: true,
      request: req,
      activeCollection: coll,
      s2Scenes: [],
      s1Scenes: [],
      activeSceneIndex: 0,
      loading: true,
      error: null,
      eoBrowserUrl: buildEoBrowserUrl(req.bbox, coll, new Date()),
    };

    this.element.style.display = 'block';
    this.render();

    void this.loadScenes(req, this.abortController.signal);
  }

  private async loadScenes(req: SatelliteViewRequest, signal: AbortSignal): Promise<void> {
    try {
      const [s2Result, s1Result] = await Promise.allSettled([
        fetchSentinel2Scenes(req.bbox, undefined, signal),
        fetchSentinel1Scenes(req.bbox, signal),
      ]);

      if (signal.aborted) return;

      const s2Scenes = s2Result.status === 'fulfilled' ? s2Result.value : [];
      const s1Scenes = s1Result.status === 'fulfilled' ? s1Result.value : [];

      this.state = {
        ...this.state,
        s2Scenes,
        s1Scenes,
        loading: false,
        error: null,
      };
      this.render();
    } catch {
      if (signal.aborted) return;
      this.state = { ...this.state, loading: false, error: 'Erreur de chargement' };
      this.render();
    }
  }

  private getActiveScenes(): CopernicusScene[] {
    return this.state.activeCollection === 'sentinel-1-grd'
      ? this.state.s1Scenes
      : this.state.s2Scenes;
  }

  private buildThumbObjectPosition(
    requestBbox: [number, number, number, number],
    sceneBbox: [number, number, number, number],
  ): string {
    const reqCenterLng = (requestBbox[0] + requestBbox[2]) / 2;
    const reqCenterLat = (requestBbox[1] + requestBbox[3]) / 2;
    const sceneWidth = Math.max(sceneBbox[2] - sceneBbox[0], 0.000001);
    const sceneHeight = Math.max(sceneBbox[3] - sceneBbox[1], 0.000001);
    const xPct = clamp(((reqCenterLng - sceneBbox[0]) / sceneWidth) * 100, 0, 100);
    const yPct = clamp(((sceneBbox[3] - reqCenterLat) / sceneHeight) * 100, 0, 100);
    return `${xPct.toFixed(1)}% ${yPct.toFixed(1)}%`;
  }

  private replaceThumbWithPlaceholder(message = 'Aperçu indisponible'): void {
    const wrap = this.element.querySelector('.satellite-panel__thumb-wrap');
    if (!wrap) return;
    wrap.innerHTML = `
      <div class="satellite-panel__thumb satellite-panel__thumb--placeholder">
        <span class="satellite-panel__thumb-icon">🛰️</span>
        <span class="satellite-panel__thumb-note">${escapeHtml(message)}</span>
      </div>
    `;
  }

  private render(): void {
    const { state } = this;
    const req = state.request;
    const title = req?.title ?? 'Vue satellite';
    const scenes = this.getActiveScenes();
    const activeScene: CopernicusScene | null = scenes[state.activeSceneIndex] ?? null;
    const s2Active = state.activeCollection === 'sentinel-2-l2a';
    const s1Active = state.activeCollection === 'sentinel-1-grd';

    // Avant/Après only for S2 with 2+ scenes
    const showAvantApres = s2Active && state.s2Scenes.length >= 2;
    const eoBrowserUrl = state.eoBrowserUrl;

    // ─── Body ───
    let bodyHtml = '';

    if (state.loading) {
      bodyHtml = `
        <div class="satellite-panel__loading">
          <div class="satellite-panel__spinner"></div>
          <span>Recherche scènes Sentinel…</span>
        </div>`;
    } else if (state.error || scenes.length === 0) {
      const msg = scenes.length === 0
        ? 'Aucune scène disponible pour cette zone'
        : (state.error ?? 'Erreur');
      bodyHtml = `<div class="satellite-panel__empty">${escapeHtml(msg)}</div>`;
    } else if (activeScene) {
      const thumb = activeScene.thumbnailUrl;
      const dateStr = formatDate(activeScene.datetime);
      const cloudHtml = activeScene.cloudCover != null
        ? `<span class="satellite-panel__cloud">☁️ ${activeScene.cloudCover.toFixed(0)}%</span>`
        : '';
      const thumbPosition = req
        ? this.buildThumbObjectPosition(req.bbox, activeScene.bbox)
        : '50% 50%';

      bodyHtml = `
        <div class="satellite-panel__thumb-wrap">
          ${thumb
            ? `<img class="satellite-panel__thumb"
                    data-role="satellite-thumb"
                    src="${escapeHtml(thumb)}"
                    alt="Sentinel thumbnail"
                    loading="lazy"
                    style="object-position:${thumbPosition};"
               />`
            : `<div class="satellite-panel__thumb satellite-panel__thumb--placeholder">
                 <span class="satellite-panel__thumb-icon">🛰️</span>
                 <span class="satellite-panel__thumb-note">Aperçu indisponible</span>
               </div>`
          }
        </div>
        <div class="satellite-panel__meta">🗓️ ${escapeHtml(dateStr)} ${cloudHtml}</div>
        <div class="satellite-panel__hint">Aperçu de scène centré sur la zone demandée</div>`;

      if (showAvantApres) {
        const apresActive = state.activeSceneIndex === 0;
        const avantActive = state.activeSceneIndex === state.s2Scenes.length - 1;
        bodyHtml += `
          <div class="satellite-panel__toggle">
            <button class="satellite-panel__toggle-btn ${avantActive ? 'active' : ''}"
                    data-action="avant">◀ Avant</button>
            <button class="satellite-panel__toggle-btn ${apresActive ? 'active' : ''}"
                    data-action="apres">Après ▶</button>
          </div>`;
      }
    }

    this.element.innerHTML = `
      <div class="satellite-panel__header">
        <span class="satellite-panel__icon">🛰️</span>
        <span class="satellite-panel__title">${escapeHtml(title)}</span>
        <button class="satellite-panel__close" data-action="close" title="Fermer">✕</button>
      </div>
      <div class="satellite-panel__collections">
        <button class="satellite-panel__coll-btn ${s2Active ? 'active' : ''}" data-action="s2">
          Sentinel-2
        </button>
        <button class="satellite-panel__coll-btn ${s1Active ? 'active' : ''}" data-action="s1">
          SAR S-1
        </button>
      </div>
      <div class="satellite-panel__body">${bodyHtml}</div>
      <div class="satellite-panel__footer">
        <a class="satellite-panel__eo-btn"
           href="${escapeHtml(eoBrowserUrl)}"
           target="_blank"
           rel="noopener noreferrer">
          ↗ Ouvrir dans EO Browser
        </a>
      </div>
    `;

    this.attachListeners();
  }

  private attachListeners(): void {
    const thumbEl = this.element.querySelector<HTMLImageElement>('[data-role="satellite-thumb"]');
    thumbEl?.addEventListener('error', () => {
      this.replaceThumbWithPlaceholder('Image indisponible');
    }, { once: true });

    this.element.querySelector('[data-action="close"]')
      ?.addEventListener('click', () => this.hide());

    this.element.querySelector('[data-action="s2"]')?.addEventListener('click', () => {
      if (!this.state.request) return;
      this.state.activeCollection = 'sentinel-2-l2a';
      this.state.activeSceneIndex = 0;
      this.state.eoBrowserUrl = buildEoBrowserUrl(this.state.request.bbox, 'sentinel-2-l2a', new Date());
      this.render();
    });

    this.element.querySelector('[data-action="s1"]')?.addEventListener('click', () => {
      if (!this.state.request) return;
      this.state.activeCollection = 'sentinel-1-grd';
      this.state.activeSceneIndex = 0;
      this.state.eoBrowserUrl = buildEoBrowserUrl(this.state.request.bbox, 'sentinel-1-grd');
      this.render();
    });

    this.element.querySelector('[data-action="avant"]')?.addEventListener('click', () => {
      this.state.activeSceneIndex = this.state.s2Scenes.length - 1;
      this.render();
    });

    this.element.querySelector('[data-action="apres"]')?.addEventListener('click', () => {
      this.state.activeSceneIndex = 0;
      this.render();
    });
  }

  hide(): void {
    this.element.style.display = 'none';
    this.state.visible = false;
    this.abortController?.abort();
    this.abortController = null;
  }

  destroy(): void {
    this.abortController?.abort();
    this.abortController = null;
    if (this.element.parentElement) {
      this.element.remove();
    }
  }
}
