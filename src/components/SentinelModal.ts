import type { CopernicusScene, SatelliteCollection, SatelliteViewRequest } from '../types/index.ts';
import { buildEoBrowserUrl, fetchSentinel1Scenes, fetchSentinel2Scenes } from '../services/copernicus.ts';
import { bboxToPolygon, fetchSentinelNdwi, geometryToBufferedPolygon } from '../services/sentinel-ndwi.ts';
import { fmIcon } from './shared/icons.ts';

interface SceneBundle {
  collection: SatelliteCollection;
  scenes: CopernicusScene[];
  eoBrowserUrl: string;
  fallbackReason?: string;
}

const TITILER_COG_ENDPOINT = 'https://titiler.xyz/cog';

function formatSceneDate(datetime: string): string {
  const value = new Date(datetime);
  if (Number.isNaN(value.getTime())) return datetime;
  return value.toLocaleString('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function buildSentinel2PreviewUrl(
  cogUrl: string,
  bbox: [number, number, number, number],
): string {
  const bboxPath = bbox.map((value) => value.toFixed(5)).join(',');
  const params = new URLSearchParams({
    url: cogUrl,
    return_mask: 'false',
    resampling: 'bilinear',
  });

  return `${TITILER_COG_ENDPOINT}/bbox/${bboxPath}/1600x900.webp?${params.toString()}`;
}

function formatAoiLabel(bbox: [number, number, number, number]): string {
  const centerLng = (bbox[0] + bbox[2]) / 2;
  const centerLat = (bbox[1] + bbox[3]) / 2;
  return `${centerLat.toFixed(3)}, ${centerLng.toFixed(3)}`;
}

function formatSceneIdentifier(value: string): string {
  if (value.length <= 42) return value;
  return `${value.slice(0, 20)}…${value.slice(-16)}`;
}

function isAuthFallbackMessage(message: string | null): boolean {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return normalized.includes('token cdse')
    || normalized.includes('auth cdse')
    || normalized.includes('eo browser en fallback');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export class SentinelModal {
  private overlayEl: HTMLElement;
  private panelEl: HTMLElement;
  private titleEl: HTMLElement;
  private subtitleEl: HTMLElement;
  private previewEl: HTMLElement;
  private listEl: HTMLElement;
  private metaEl: HTMLElement;
  private toggleBtn: HTMLButtonElement;
  private eoBtn: HTMLAnchorElement;
  private closeBtn: HTMLButtonElement;
  private isVisible = false;
  private currentCollection: SatelliteCollection = 'sentinel-2-l2a';
  private currentScenes: CopernicusScene[] = [];
  private currentEoBrowserUrl = '';
  private currentRequest: SatelliteViewRequest | null = null;
  private activeSceneIndex = 0;
  private compareSceneIndex = 1;
  private compareMode = false;
  private ndwiImageUrl: string | null = null;
  private ndwiLoading = false;
  private ndwiError: string | null = null;
  private ndwiRequestSeq = 0;

  private buildPreviewUrl(scene: CopernicusScene): string | null {
    if (this.currentCollection === 'sentinel-2-l2a' && scene.cogUrl && this.currentRequest?.bbox) {
      return buildSentinel2PreviewUrl(scene.cogUrl, this.currentRequest.bbox);
    }
    return scene.thumbnailUrl ?? null;
  }

  private getSceneRelativeLabel(sceneIndex: number): string {
    if (this.currentScenes.length < 2) return 'Scene';
    if (sceneIndex === 0) return 'Apres';
    if (sceneIndex === 1) return 'Avant';
    return `Archive ${sceneIndex + 1}`;
  }

  private getDisplayScenes(): Array<{ scene: CopernicusScene; sceneIndex: number }> {
    const limited = this.currentScenes
      .slice(0, 6)
      .map((scene, sceneIndex) => ({ scene, sceneIndex }));

    if (limited.length <= 2) {
      return limited.length === 2 ? [limited[1], limited[0]] : limited;
    }

    const ordered: Array<{ scene: CopernicusScene; sceneIndex: number }> = [];
    if (limited[1]) ordered.push(limited[1]);
    if (limited[0]) ordered.push(limited[0]);
    for (let index = 2; index < limited.length; index += 1) {
      ordered.push(limited[index]);
    }
    return ordered;
  }

  private getSelectedSceneIndex(): number {
    return this.compareMode && this.currentScenes.length > 1
      ? this.compareSceneIndex
      : this.activeSceneIndex;
  }

  private shouldRenderNdwi(): boolean {
    return this.currentCollection === 'sentinel-2-l2a' && this.currentRequest?.sourceType === 'flood';
  }

  constructor(container: HTMLElement) {
    this.overlayEl = document.createElement('div');
    this.overlayEl.className = 'sentinel-modal-overlay';
    this.overlayEl.style.display = 'none';

    this.panelEl = document.createElement('div');
    this.panelEl.className = 'sentinel-modal';
    this.panelEl.setAttribute('role', 'dialog');
    this.panelEl.setAttribute('aria-modal', 'true');
    this.panelEl.setAttribute('aria-label', 'Imagerie satellite Sentinel');

    const headerEl = document.createElement('div');
    headerEl.className = 'sentinel-modal__header';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'sentinel-modal__title-wrap';

    this.titleEl = document.createElement('div');
    this.titleEl.className = 'sentinel-modal__title';
    this.titleEl.textContent = 'Sentinel';

    this.subtitleEl = document.createElement('div');
    this.subtitleEl.className = 'sentinel-modal__subtitle';

    titleWrap.append(this.titleEl, this.subtitleEl);

    this.closeBtn = document.createElement('button');
    this.closeBtn.className = 'sentinel-modal__close';
    this.closeBtn.type = 'button';
    this.closeBtn.textContent = 'Fermer';
    this.closeBtn.addEventListener('click', () => this.hide());

    headerEl.append(titleWrap, this.closeBtn);

    this.previewEl = document.createElement('div');
    this.previewEl.className = 'sentinel-modal__preview';

    this.metaEl = document.createElement('div');
    this.metaEl.className = 'sentinel-modal__meta';

    const actionsEl = document.createElement('div');
    actionsEl.className = 'sentinel-modal__actions';

    this.toggleBtn = document.createElement('button');
    this.toggleBtn.type = 'button';
    this.toggleBtn.className = 'sentinel-modal__toggle';
    this.toggleBtn.textContent = 'Avant / apres';
    this.toggleBtn.addEventListener('click', () => {
      if (this.currentScenes.length < 2) return;
      this.compareMode = !this.compareMode;
      this.renderScene();
      void this.refreshNdwiForSelectedScene();
    });

    this.eoBtn = document.createElement('a');
    this.eoBtn.className = 'sentinel-modal__link';
    this.eoBtn.target = '_blank';
    this.eoBtn.rel = 'noopener noreferrer';
    this.eoBtn.innerHTML = `Ouvrir dans EO Browser ${fmIcon('external-link')}`;

    actionsEl.append(this.toggleBtn, this.eoBtn);

    this.listEl = document.createElement('div');
    this.listEl.className = 'sentinel-modal__list';

    this.panelEl.append(headerEl, this.previewEl, this.metaEl, actionsEl, this.listEl);
    this.overlayEl.appendChild(this.panelEl);
    container.appendChild(this.overlayEl);

    this.overlayEl.addEventListener('click', (event) => {
      if (event.target === this.overlayEl) this.hide();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.isVisible) this.hide();
    });
  }

  async show(request: SatelliteViewRequest): Promise<void> {
    this.currentRequest = request;
    this.currentCollection = request.preferredCollection ?? 'sentinel-2-l2a';
    this.activeSceneIndex = 0;
    this.compareSceneIndex = 1;
    this.compareMode = false;
    this.ndwiImageUrl = null;
    this.ndwiLoading = false;
    this.ndwiError = null;
    this.isVisible = true;
    this.overlayEl.style.display = 'flex';
    this.titleEl.textContent = request.title ?? (request.sourceType === 'flood' ? 'Comparaison crue' : 'Sentinel-2');
    this.subtitleEl.textContent = '';
    this.subtitleEl.style.display = 'none';
    this.previewEl.innerHTML = '<div class="sentinel-modal__empty">Chargement des scenes…</div>';
    this.metaEl.innerHTML = '';
    this.listEl.innerHTML = '';
    this.eoBtn.href = buildEoBrowserUrl(
      request.bbox,
      this.currentCollection,
      request.eventDate,
    );

    try {
      const bundle = this.currentCollection === 'sentinel-1-grd'
        ? await this.loadSentinel1(request)
        : await this.loadSentinel2(request);

      this.currentCollection = bundle.collection;
      this.currentScenes = bundle.scenes;
      this.activeSceneIndex = 0;
      this.compareSceneIndex = Math.min(1, Math.max(0, this.currentScenes.length - 1));
      this.currentEoBrowserUrl = bundle.eoBrowserUrl;
      this.eoBtn.href = bundle.eoBrowserUrl;
      this.renderScene(bundle.fallbackReason);
      void this.refreshNdwiForSelectedScene();
    } catch (error) {
      this.currentScenes = [];
      this.currentEoBrowserUrl = buildEoBrowserUrl(request.bbox, this.currentCollection, request.eventDate);
      this.eoBtn.href = this.currentEoBrowserUrl;
      this.previewEl.innerHTML = `
        <div class="sentinel-modal__empty">
          Impossible de charger les scenes pour le moment.<br />
          Utilise le fallback EO Browser.
        </div>
      `;
      this.metaEl.innerHTML = '';
      this.listEl.innerHTML = '';
      this.toggleBtn.disabled = true;
    }
  }

  hide(): void {
    this.isVisible = false;
    this.overlayEl.style.display = 'none';
    this.ndwiRequestSeq += 1;
  }

  private async refreshNdwiForSelectedScene(): Promise<void> {
    if (!this.shouldRenderNdwi() || !this.currentRequest?.bbox) {
      this.ndwiImageUrl = null;
      this.ndwiLoading = false;
      this.ndwiError = null;
      return;
    }

    const scene = this.currentScenes[this.getSelectedSceneIndex()];
    if (!scene) return;

    const requestSeq = ++this.ndwiRequestSeq;
    this.ndwiLoading = true;
    this.ndwiError = null;
    this.renderScene();

    try {
      const ndwi = await fetchSentinelNdwi(
        this.currentRequest.geometry
          ? geometryToBufferedPolygon(this.currentRequest.geometry)
          : bboxToPolygon(this.currentRequest.bbox),
        scene.datetime,
        scene.cloudCover != null ? Math.max(5, Math.round(scene.cloudCover)) : 30,
      );

      if (requestSeq !== this.ndwiRequestSeq || !this.isVisible) return;
      this.ndwiImageUrl = ndwi.imageUrl ?? null;
      this.ndwiLoading = false;
      this.ndwiError = this.ndwiImageUrl ? null : 'NDWI indisponible pour cette crue';
      this.renderScene();
    } catch (error) {
      if (requestSeq !== this.ndwiRequestSeq || !this.isVisible) return;
      this.ndwiImageUrl = null;
      this.ndwiLoading = false;
      this.ndwiError = error instanceof Error ? error.message : 'NDWI indisponible pour cette crue';
      this.renderScene();
    }
  }

  private async loadSentinel2(request: SatelliteViewRequest): Promise<SceneBundle> {
    const response = await fetchSentinel2Scenes(request.bbox);
    return {
      collection: 'sentinel-2-l2a',
      scenes: response.scenes,
      eoBrowserUrl: response.eoBrowserUrl,
      fallbackReason: response.fallbackReason,
    };
  }

  private async loadSentinel1(request: SatelliteViewRequest): Promise<SceneBundle> {
    const response = await fetchSentinel1Scenes(request.bbox);
    return {
      collection: 'sentinel-1-grd',
      scenes: response.scenes,
      eoBrowserUrl: response.eoBrowserUrl,
      fallbackReason: response.fallbackReason,
    };
  }

  private renderScene(fallbackReason?: string): void {
    const selectedSceneIndex = this.getSelectedSceneIndex();
    const scene = this.currentScenes[selectedSceneIndex];

    this.toggleBtn.disabled = this.currentScenes.length < 2;
    this.toggleBtn.textContent = this.compareMode ? 'Revenir a l\'apres' : 'Voir l\'avant';

    if (!scene) {
      this.previewEl.innerHTML = `
        <div class="sentinel-modal__empty">
          Aucune scene exploitable.<br />
          ${fallbackReason ? `Cause: ${fallbackReason}` : 'Le fallback EO Browser reste disponible.'}
        </div>
      `;
      this.metaEl.innerHTML = '';
      this.listEl.innerHTML = '';
      return;
    }

    const previewUrl = this.buildPreviewUrl(scene);
    this.previewEl.innerHTML = '';
    if (this.currentCollection === 'sentinel-1-grd') {
      const zoneLabel = this.currentRequest?.bbox ? formatAoiLabel(this.currentRequest.bbox) : 'Zone de crue';
      this.previewEl.innerHTML = `
        <div class="sentinel-modal__empty sentinel-modal__empty--sar">
          <strong>Visualisation Sentinel-1 in-app en cours de developpement</strong><br />
          Les crues SAR seront disponibles des qu'un backend raster dedie sera branche.<br />
          France Monitor n'affiche pas de viewer SAR fake base sur des thumbnails catalogue.<br />
          Zone cible : <span class="sentinel-modal__inline-code">${zoneLabel}</span>
        </div>
      `;
    } else if (this.shouldRenderNdwi() && this.ndwiLoading) {
      this.previewEl.innerHTML = '<div class="sentinel-modal__empty">Generation NDWI en cours…<br />Calcul de l\'eau de surface sur la zone de crue.</div>';
    } else if (this.shouldRenderNdwi() && this.ndwiImageUrl) {
      const modeLabel = this.getSceneRelativeLabel(selectedSceneIndex);
      this.previewEl.innerHTML = `
        <div class="sentinel-modal__preview-badge">NDWI ${modeLabel}</div>
        <img src="${this.ndwiImageUrl}" alt="NDWI crue" class="sentinel-modal__image sentinel-modal__image--ndwi" />
        <div class="sentinel-modal__legend">
          <span class="sentinel-modal__legend-chip sentinel-modal__legend-chip--low"></span>
          <span>Negatif</span>
          <span class="sentinel-modal__legend-chip sentinel-modal__legend-chip--mid"></span>
          <span>Neutre</span>
          <span class="sentinel-modal__legend-chip sentinel-modal__legend-chip--land"></span>
          <span>Eau</span>
        </div>
      `;
    } else if (this.shouldRenderNdwi() && this.ndwiError) {
      const fallbackHint = isAuthFallbackMessage(this.ndwiError)
        ? '<br /><a class="sentinel-modal__inline-link" href="#" data-action="eo-fallback">Ouvrir EO Browser en fallback</a>'
        : '';
      this.previewEl.innerHTML = `<div class="sentinel-modal__empty">${escapeHtml(this.ndwiError)}${fallbackHint}</div>`;
      const fallbackLink = this.previewEl.querySelector<HTMLElement>('[data-action="eo-fallback"]');
      fallbackLink?.addEventListener('click', (event) => {
        event.preventDefault();
        this.eoBtn.click();
      }, { once: true });
    } else if (previewUrl) {
      const img = document.createElement('img');
      img.alt = `Preview ${this.currentCollection}`;
      img.className = 'sentinel-modal__image';
      img.src = previewUrl;
      img.loading = 'eager';
      img.decoding = 'async';
      img.addEventListener('error', () => {
        if (scene.thumbnailUrl && img.src !== scene.thumbnailUrl) {
          img.src = scene.thumbnailUrl;
          return;
        }
        this.previewEl.innerHTML = '<div class="sentinel-modal__empty">Apercu indisponible pour cette scene.<br />Utilise EO Browser pour l\'analyse detaillee.</div>';
      }, { once: true });
      this.previewEl.appendChild(img);
    } else {
      this.previewEl.innerHTML = '<div class="sentinel-modal__empty">Apercu indisponible pour cette scene.<br />Utilise EO Browser pour l\'analyse detaillee.</div>';
    }

    const platform = this.currentCollection === 'sentinel-2-l2a' ? 'Sentinel-2 L2A' : 'Sentinel-1 GRD';
    const compareLabel = this.getSceneRelativeLabel(selectedSceneIndex);
    const cloudLabel = scene.cloudCover != null ? `${Math.round(scene.cloudCover)}% nuages` : 'Nuages n/a';
    const zoneLabel = this.currentRequest?.bbox ? formatAoiLabel(this.currentRequest.bbox) : 'n/a';
    this.metaEl.innerHTML = `
      <div class="sentinel-modal__meta-card">
        <span class="sentinel-modal__meta-label">Vue</span>
        <strong>${compareLabel}</strong>
      </div>
      <div class="sentinel-modal__meta-card">
        <span class="sentinel-modal__meta-label">Source</span>
        <strong>${platform}</strong>
      </div>
      <div class="sentinel-modal__meta-card">
        <span class="sentinel-modal__meta-label">Date</span>
        <strong>${formatSceneDate(scene.datetime)}</strong>
      </div>
      <div class="sentinel-modal__meta-card">
        <span class="sentinel-modal__meta-label">Qualite</span>
        <strong>${cloudLabel}</strong>
      </div>
      <div class="sentinel-modal__meta-card sentinel-modal__meta-card--wide">
        <span class="sentinel-modal__meta-label">Zone crue</span>
        <strong>${zoneLabel}</strong>
      </div>
      <div class="sentinel-modal__meta-card sentinel-modal__meta-card--wide">
        <span class="sentinel-modal__meta-label">Scene</span>
        <strong title="${escapeHtml(scene.id)}">${escapeHtml(formatSceneIdentifier(scene.id))}</strong>
      </div>
    `;

    this.eoBtn.href = buildEoBrowserUrl(
      this.currentRequest?.bbox ?? scene.bbox,
      this.currentCollection,
      new Date(scene.datetime),
    );
    this.eoBtn.innerHTML = isAuthFallbackMessage(this.ndwiError)
      ? `Ouvrir EO Browser (fallback) ${fmIcon('external-link')}`
      : `Ouvrir dans EO Browser ${fmIcon('external-link')}`;

    this.listEl.innerHTML = '';
    this.getDisplayScenes().forEach(({ scene: candidate, sceneIndex }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `sentinel-modal__scene${sceneIndex === selectedSceneIndex ? ' is-active' : ''}`;
      const cloud = candidate.cloudCover != null ? `${Math.round(candidate.cloudCover)}%` : 'SAR';
      const relativeLabel = this.getSceneRelativeLabel(sceneIndex);
      btn.innerHTML = `
        <span class="sentinel-modal__scene-tag">${relativeLabel}</span>
        <span class="sentinel-modal__scene-date">${formatSceneDate(candidate.datetime)}</span>
        <span class="sentinel-modal__scene-meta">${escapeHtml(cloud)}</span>
      `;
      btn.addEventListener('click', () => {
        this.activeSceneIndex = sceneIndex;
        this.compareMode = false;
        this.renderScene();
        void this.refreshNdwiForSelectedScene();
      });
      this.listEl.appendChild(btn);
    });
  }
}
