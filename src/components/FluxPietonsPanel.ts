// src/components/FluxPietonsPanel.ts : panneau de couche « Flux piétons ». Coquille DOM : contenu de buildFluxView (pur), cadre de
// createLayerPanelShell. Onglets = phase (arrivée, dispersion) ; clic sur un événement = la carte passe à cet événement ; curseur
// du rejeu (et lecture) : la carte montre l'instant choisi, la ligne du curseur est mise à jour sur place (pas de nouveau rendu).
import type { FluxIndex, FluxPhase } from '../types/index.ts';
import { loadSectionState } from '../services/fiche-sections-store.ts';
import { createLayerPanelShell, isLayerPanelOpen, safeStorage, sectionOpenOf, type LayerPanelShell } from './layer-panel/frame.ts';
import { buildFluxView, replayLabel, selectedFluxEvent, type FluxViewInput } from './layer-panel/flux-pietons.ts';
import { timelineRange } from '../services/flux-timeline.ts';

/** Lecture : une minute du rejeu toutes les 120 ms (une heure et demie en une dizaine de secondes). */
const PLAY_STEP_MS = 120;

const PANEL_ID = 'pedestrianFlows';

export class FluxPietonsPanel {
  private shell: LayerPanelShell | null = null;
  private onClose?: () => void;
  private onSelect?: (id: string) => void;
  private onPhase?: (phase: FluxPhase) => void;
  private onTime?: (atMin: number | null) => void;
  private replay: FluxViewInput['replay'] = null;
  private instant: number | null = null;
  private playTimer: ReturnType<typeof setInterval> | null = null;
  private index: FluxIndex | null = null;
  private error: string | null = null;
  private selectedId: string | null = null;
  private phase: FluxPhase = 'arrivee';
  private geo: FluxViewInput['geo'] = 'idle';
  private clickCleanup: (() => void) | null = null;
  private readonly storage = safeStorage();
  private readonly container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  mount(): void {
    this.shell = createLayerPanelShell({
      container: this.container, className: 'flux-panel-modal', panelId: PANEL_ID, storage: this.storage, onClose: () => this.hide(),
      onTab: (tab) => { if (tab === 'arrivee' || tab === 'depart') this.onPhase?.(tab); },
    });
    const root = this.shell.root;
    const onClick = (e: Event): void => {
      const id = (e.target as HTMLElement).closest<HTMLElement>('[data-flux-event]')?.dataset['fluxEvent'];
      if (id) this.onSelect?.(id);
    };
    const onPlay = (e: Event): void => {
      if ((e.target as HTMLElement).closest('[data-flux-play]')) this.togglePlay();
    };
    const onInput = (e: Event): void => {
      const el = e.target as HTMLInputElement;
      if (!el.matches('[data-flux-time]')) return;
      this.stopPlay();
      this.setInstant(Number(el.value));
    };
    root.addEventListener('click', onClick);
    root.addEventListener('click', onPlay);
    root.addEventListener('input', onInput);
    this.clickCleanup = () => {
      root.removeEventListener('click', onClick);
      root.removeEventListener('click', onPlay);
      root.removeEventListener('input', onInput);
    };
  }

  setHandlers(h: { onClose: () => void; onSelect: (id: string) => void; onPhase: (phase: FluxPhase) => void; onTime: (atMin: number | null) => void }): void {
    this.onClose = h.onClose;
    this.onSelect = h.onSelect;
    this.onPhase = h.onPhase;
    this.onTime = h.onTime;
  }

  /** Instant choisi : carte (App.ts), ligne et position du curseur mises à jour sans nouveau rendu du panneau. */
  private setInstant(atMin: number): void {
    this.instant = atMin;
    this.onTime?.(atMin);
    const root = this.shell?.root;
    const e = selectedFluxEvent(this.index, this.selectedId);
    const label = root?.querySelector<HTMLElement>('[data-flux-time-label]');
    if (label && e) label.textContent = replayLabel(e, atMin);
    const range = root?.querySelector<HTMLInputElement>('[data-flux-time]');
    if (range && Number(range.value) !== atMin) range.value = String(atMin);
  }

  private togglePlay(): void {
    if (this.playTimer !== null) { this.stopPlay(); return; }
    const r = this.replay;
    if (!r) return;
    // Relancée depuis le début si le curseur est au bout.
    if (this.instant === null || this.instant >= r.max) this.setInstant(r.min);
    this.setPlayButton(true);
    this.playTimer = setInterval(() => {
      const next = (this.instant ?? r.min) + 1;
      if (next > r.max) { this.stopPlay(); return; }
      this.setInstant(next);
    }, PLAY_STEP_MS);
  }

  private stopPlay(): void {
    if (this.playTimer !== null) clearInterval(this.playTimer);
    this.playTimer = null;
    this.setPlayButton(false);
  }

  private setPlayButton(playing: boolean): void {
    const b = this.shell?.root.querySelector<HTMLButtonElement>('[data-flux-play]');
    if (!b) return;
    b.textContent = playing ? '❚❚' : '▶';
    b.setAttribute('aria-label', playing ? 'Mettre en pause' : 'Lire le rejeu');
  }

  show(): void {
    this.shell?.root.classList.add('is-open');
    this.render();
  }

  /** État complet venu d'App.ts (index, événement choisi, phase, lecture de la carte). */
  update(s: {
    index: FluxIndex | null; error: string | null; selectedId: string | null; phase: FluxPhase; geo: FluxViewInput['geo'];
    /** Distance au point de la rue la plus lointaine de la carte lue (m) ; null : pas de rejeu possible. */
    maxDistance: number | null; instant: number | null;
  }): void {
    if (s.instant === null || s.selectedId !== this.selectedId) this.stopPlay();
    const e = selectedFluxEvent(s.index, s.selectedId);
    this.replay = e?.temps && s.maxDistance !== null && s.geo === 'ready' ? timelineRange(e.temps, s.maxDistance) : null;
    this.instant = s.instant;
    this.index = s.index;
    this.error = s.error;
    this.selectedId = s.selectedId;
    this.phase = s.phase;
    this.geo = s.geo;
    if (this.isVisible()) this.render();
  }

  hide(opts: { silent?: boolean } = {}): void {
    this.stopPlay();
    this.shell?.root.classList.remove('is-open');
    if (!opts.silent) this.onClose?.();
  }

  isVisible(): boolean {
    return this.shell ? isLayerPanelOpen(this.shell.root) : false;
  }

  destroy(): void {
    this.stopPlay();
    this.clickCleanup?.();
    this.clickCleanup = null;
    this.shell?.destroy();
    this.shell = null;
  }

  private render(): void {
    if (!this.shell) return;
    const open = sectionOpenOf(loadSectionState(this.storage), PANEL_ID);
    this.shell.patch(buildFluxView({
      index: this.index, error: this.error, selectedId: this.selectedId, phase: this.phase, geo: this.geo, open, nowMs: Date.now(),
      replay: this.replay, instant: this.instant,
    }));
  }
}
