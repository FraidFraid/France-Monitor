// src/components/WebcamWall.ts : mur de webcams, fenêtre flottante au-dessus de la carte. Déplaçable par son en-tête,
// redimensionnable par son coin, repliable ; de 1 à 12 images en mosaïque (1 à 4 colonnes ou automatique), réordonnables,
// une image agrandissable. État gardé dans localStorage (services/webcam-wall.ts). Images rafraîchies chaque minute tant que le
// mur est visible, jamais enregistrées. Coquille DOM mince : le contenu vient de renderWebcamWall (pur).
import type { WebcamsDataset } from '../types/index.ts';
import {
  WALL_LAYOUTS, WALL_REFRESH_MS, type WallLayout, type WallRect, type WallState,
  addToWall, clampRect, loadWallState, moveOnWall, refreshedImageUrl, removeFromWall, saveWallState, toggleOnWall, wallColumns,
} from '../services/webcam-wall.ts';
import { webcamThumbnailUrl } from '../services/webcams.ts';
import { safeStorage } from './layer-panel/frame.ts';
import { renderWebcamWall } from './layer-panel/webcam-wall.ts';
import { morphInto } from './layer-panel/morph.ts';

const timeLabel = (ms: number): string => new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit',
}).format(new Date(ms));

export class WebcamWall {
  private readonly storage = safeStorage();
  private state: WallState = loadWallState(this.storage);
  private data: WebcamsDataset | null = null;
  private root: HTMLElement | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private resizeObs: ResizeObserver | null = null;
  private refreshedMs = Date.now();
  private loaded = false;
  private columns = 1;
  private onChange?: (s: WallState) => void;
  private readonly cleanups: Array<() => void> = [];

  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /** Appelé à chaque changement (le panneau Webcams met à jour son bouton « Ajouter au mur »). */
  setOnChange(fn: (s: WallState) => void): void { this.onChange = fn; }

  getState(): Readonly<WallState> { return this.state; }

  setData(ds: WebcamsDataset | null): void {
    this.data = ds;
    if (this.root) this.render();
  }

  open(): void {
    this.commit({ ...this.state, open: true, minimized: false });
    this.fitHeight();
  }

  add(id: string): void { this.commit(addToWall(this.state, id)); }

  toggle(id: string): void { this.commit(toggleOnWall(this.state, id)); }

  /** Couche éteinte : le mur disparaît sans oublier qu'il était ouvert. */
  hide(): void { this.unmount(); }

  destroy(): void { this.unmount(); }

  private commit(next: WallState): void {
    this.state = next;
    saveWallState(this.storage, next);
    if (!next.open) this.unmount();
    else if (this.root) this.render();
    else this.mount();
    this.onChange?.(next);
  }

  private mount(): void {
    if (this.root) return;
    const root = document.createElement('section');
    root.className = 'wcw';
    root.setAttribute('aria-label', 'Mur de webcams');
    this.container.appendChild(root);
    this.root = root;
    this.placeRoot();

    const onClick = (e: Event): void => this.onClick(e);
    const onChange = (e: Event): void => {
      const sel = (e.target as HTMLElement).closest<HTMLSelectElement>('select[data-wall-action="add"]');
      if (!sel?.value) return;
      const id = sel.value;
      sel.value = '';
      this.add(id);
      this.fitHeight();
    };
    // load / error ne remontent pas : écoute en phase de capture.
    const onImg = (e: Event): void => {
      const img = e.target;
      if (!(img instanceof HTMLImageElement)) return;
      img.closest('.wcw-tile')?.classList.toggle('is-broken', e.type === 'error');
      if (e.type === 'load' && !this.loaded) {
        this.loaded = true;
        this.updateTime();
      }
    };
    const onPointerDown = (e: PointerEvent): void => this.startDrag(e);
    const onWinResize = (): void => this.placeRoot();
    const onVisibility = (): void => { if (!document.hidden) this.refreshIfDue(); };
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    root.addEventListener('load', onImg, true);
    root.addEventListener('error', onImg, true);
    root.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('resize', onWinResize);
    document.addEventListener('visibilitychange', onVisibility);
    this.cleanups.push(() => {
      root.removeEventListener('click', onClick);
      root.removeEventListener('change', onChange);
      root.removeEventListener('load', onImg, true);
      root.removeEventListener('error', onImg, true);
      root.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('resize', onWinResize);
      document.removeEventListener('visibilitychange', onVisibility);
    });

    // Redimensionnement par le coin (resize CSS) : taille gardée, colonnes recalculées en disposition automatique.
    if (typeof ResizeObserver !== 'undefined') {
      let pending: ReturnType<typeof setTimeout> | null = null;
      this.resizeObs = new ResizeObserver(() => {
        if (!this.root || this.state.minimized) return;
        const cols = this.computeColumns();
        if (cols !== this.columns) this.render();
        if (pending) clearTimeout(pending);
        pending = setTimeout(() => this.saveRectFromDom(), 300);
      });
      this.resizeObs.observe(root);
    }

    this.refreshedMs = Date.now();
    this.loaded = false;
    this.timer = setInterval(() => this.refreshIfDue(), WALL_REFRESH_MS);
    this.render();
  }

  private unmount(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    for (const fn of this.cleanups.splice(0)) fn();
    this.root?.remove();
    this.root = null;
  }

  private defaultRect(): WallRect {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = Math.min(560, vw - 32);
    const h = Math.min(420, vh - 160);
    return { x: Math.max(16, Math.round((vw - w) / 2) - 200), y: Math.max(80, vh - h - 80), w, h };
  }

  private placeRoot(): void {
    if (!this.root) return;
    const r = clampRect(this.state.rect ?? this.defaultRect(), window.innerWidth, window.innerHeight);
    const s = this.root.style;
    s.left = `${r.x}px`;
    s.top = `${r.y}px`;
    s.width = `${r.w}px`;
    // Replié : seule la barre de titre, hauteur naturelle.
    s.height = this.state.minimized ? '' : `${r.h}px`;
    this.root.classList.toggle('is-min', this.state.minimized);
  }

  private saveRectFromDom(): void {
    if (!this.root || this.state.minimized) return;
    const b = this.root.getBoundingClientRect();
    const rect = clampRect({ x: b.left, y: b.top, w: b.width, h: b.height }, window.innerWidth, window.innerHeight);
    const prev = this.state.rect;
    if (prev && prev.x === rect.x && prev.y === rect.y && prev.w === rect.w && prev.h === rect.h) return;
    this.state = { ...this.state, rect };
    saveWallState(this.storage, this.state);
  }

  private startDrag(e: PointerEvent): void {
    const target = e.target as HTMLElement;
    if (!this.root || e.button !== 0 || !target.closest('[data-wall-drag]') || target.closest('button, select, a')) return;
    e.preventDefault();
    const b = this.root.getBoundingClientRect();
    const dx = e.clientX - b.left;
    const dy = e.clientY - b.top;
    this.root.classList.add('is-dragging');
    const move = (ev: PointerEvent): void => {
      if (!this.root) return;
      const r = clampRect({ x: ev.clientX - dx, y: ev.clientY - dy, w: b.width, h: b.height }, window.innerWidth, window.innerHeight);
      this.root.style.left = `${r.x}px`;
      this.root.style.top = `${r.y}px`;
    };
    const up = (): void => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      if (!this.root) return;
      this.root.classList.remove('is-dragging');
      const nb = this.root.getBoundingClientRect();
      const base = this.state.rect ?? { x: nb.left, y: nb.top, w: nb.width, h: nb.height };
      this.state = { ...this.state, rect: { ...base, x: nb.left, y: nb.top } };
      saveWallState(this.storage, this.state);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  private onClick(e: Event): void {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('button[data-wall-action]');
    if (!btn) return;
    const id = btn.dataset['id'] ?? '';
    switch (btn.dataset['wallAction']) {
      case 'close': this.commit({ ...this.state, open: false }); break;
      case 'minimize':
        // Déplié : images du moment, pas celles d'avant le repli.
        if (this.state.minimized) { this.refreshedMs = Date.now(); this.loaded = false; }
        this.commit({ ...this.state, minimized: !this.state.minimized });
        break;
      case 'refresh': this.refreshNow(); break;
      case 'fullscreen': {
        // Plein écran de la case (image ou lecteur vidéo) ; Échap pour revenir.
        const media = btn.closest('.wcw-tile')?.querySelector<HTMLElement>('.wcw-media');
        media?.requestFullscreen?.().catch(() => undefined);
        break;
      }
      case 'layout': {
        const v = Number(btn.dataset['value']);
        const layout = (WALL_LAYOUTS as readonly number[]).includes(v) ? v as WallLayout : 0;
        this.commit({ ...this.state, layout });
        this.fitHeight();
        break;
      }
      case 'left': this.commit(moveOnWall(this.state, id, -1)); break;
      case 'right': this.commit(moveOnWall(this.state, id, 1)); break;
      case 'remove': this.commit(removeFromWall(this.state, id)); this.fitHeight(); break;
      case 'focus': this.commit({ ...this.state, focusId: this.state.focusId === id ? null : id }); this.fitHeight(); break;
      default: break;
    }
  }

  /** Hauteur ajustée au contenu après un ajout, un retrait ou un changement de disposition (pas de vide sous les images),
   *  bornée à l'écran ; un redimensionnement à la main reste maître jusqu'au changement suivant. */
  private fitHeight(): void {
    if (!this.root || this.state.minimized) return;
    // Après la mise en page des images (rapport 4/3 fixe : la hauteur est connue sans attendre leur chargement).
    requestAnimationFrame(() => {
      if (!this.root || this.state.minimized) return;
      const body = this.root.querySelector<HTMLElement>('.wcw-body');
      const content = body?.firstElementChild;
      if (!body || !(content instanceof HTMLElement)) return;
      // La zone de défilement s'étire avec la fenêtre : on mesure son contenu (mosaïque ou message), marges comprises.
      const style = getComputedStyle(content);
      const contentH = content.offsetHeight + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
      const bodyStyle = getComputedStyle(body);
      const chrome = this.root.offsetHeight - body.clientHeight;
      const wanted = chrome + contentH + parseFloat(bodyStyle.paddingTop) + parseFloat(bodyStyle.paddingBottom) + 2;
      const b = this.root.getBoundingClientRect();
      const rect = clampRect({ x: b.left, y: b.top, w: b.width, h: wanted }, window.innerWidth, window.innerHeight);
      // Trop haute pour la place sous son bord haut : remontée plutôt que coupée.
      if (rect.y + rect.h > window.innerHeight - 8) rect.y = Math.max(0, window.innerHeight - 8 - rect.h);
      this.state = { ...this.state, rect };
      saveWallState(this.storage, this.state);
      this.placeRoot();
    });
  }

  private computeColumns(): number {
    const width = this.root?.clientWidth ?? 560;
    const tiles = this.state.focusId ? 1 : this.state.ids.length;
    return wallColumns(this.state.layout, tiles, width);
  }

  private render(): void {
    if (!this.root) return;
    this.columns = this.computeColumns();
    // Mise à jour nœud à nœud : une vidéo déjà lancée n'est pas rechargée quand la fenêtre change de taille ou de disposition.
    morphInto(this.root, renderWebcamWall({
      data: this.data, state: this.state, columns: this.columns, refreshedMs: this.refreshedMs,
      refreshedLabel: this.loaded ? `Images de ${timeLabel(this.refreshedMs)}` : null,
    }));
    this.placeRoot();
  }

  private refreshIfDue(): void {
    if (Date.now() - this.refreshedMs >= WALL_REFRESH_MS - 1000) this.refreshNow();
  }

  /** Nouvelle image pour chaque tuile, sans reconstruire la fenêtre (menu « Ajouter » et défilement gardés). */
  private refreshNow(): void {
    if (!this.root || this.state.minimized || document.hidden) return;
    this.refreshedMs = Date.now();
    this.loaded = false;
    for (const tile of this.root.querySelectorAll<HTMLElement>('.wcw-tile[data-id]')) {
      const img = tile.querySelector<HTMLImageElement>('img');
      const w = this.data?.webcams.find((x) => x.id === tile.dataset['id']);
      const url = w ? webcamThumbnailUrl(w) : null;
      if (img && url) img.src = refreshedImageUrl(url, this.refreshedMs);
    }
  }

  private updateTime(): void {
    const el = this.root?.querySelector<HTMLElement>('.wcw-time');
    if (el) el.textContent = `Images de ${timeLabel(this.refreshedMs)}`;
    else if (this.root) this.render();
  }
}
