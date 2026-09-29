/**
 * WeatherRadarPanel.ts — panneau flottant de la couche « Radar météo » (mosaïque RainViewer).
 * Affiche l'heure et la nature de l'image, sa fraîcheur, la légende des intensités et la source.
 * Le × ferme le panneau sans éteindre la couche.
 */
import {
  applyPremiumCloseButtonHover,
  createPremiumIconHeader,
  getPremiumCloseButtonStyle,
  getPremiumModalStyle,
} from './panelHeader.ts';
import { fmIcon } from './shared/icons.ts';
import { WEATHER_RADAR_LEGEND_ITEMS } from '../config/weather-radar-legend.ts';
import {
  weatherRadarSummary,
  type WeatherRadarFrame,
  type WeatherRadarStatus,
} from '../services/weather-radar.ts';

const REFRESH_LABEL_MS = 60_000;

export class WeatherRadarPanel {
  private readonly container: HTMLElement;
  private modalEl: HTMLElement | null = null;
  private contentEl: HTMLElement | null = null;
  private onClose: (() => void) | null = null;
  private frame: WeatherRadarFrame | null = null;
  private status: WeatherRadarStatus = 'loading';
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  setOnClose(handler: () => void): void {
    this.onClose = handler;
  }

  mount(): void {
    const modal = document.createElement('div');
    modal.className = 'fm-floating-panel';
    modal.style.cssText = getPremiumModalStyle({
      width: '360px',
      maxHeight: 'calc(100vh - var(--header-height) - 40px)',
      backgroundStart: 'rgba(12, 18, 31, 0.97)',
      backgroundEnd: 'rgba(13, 16, 26, 0.96)',
      borderColor: 'rgba(79, 195, 247, 0.18)',
      top: 'calc(var(--header-height) + 20px)',
    }) + 'display:none;overflow-y:auto;';

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = fmIcon('x');
    closeBtn.setAttribute('aria-label', 'Fermer');
    closeBtn.style.cssText = getPremiumCloseButtonStyle();
    applyPremiumCloseButtonHover(closeBtn);
    closeBtn.onclick = () => this.hide();
    modal.appendChild(closeBtn);

    modal.appendChild(createPremiumIconHeader({
      icon: fmIcon('cloud-rain'),
      title: 'Radar météo',
      subtitle: 'Précipitations — mosaïque radar RainViewer',
      gradientStart: 'rgba(79, 195, 247, 0.16)',
      gradientEnd: 'rgba(59, 130, 246, 0.10)',
      iconGradientStart: 'rgba(79, 195, 247, 0.22)',
      iconGradientEnd: 'rgba(59, 130, 246, 0.14)',
    }));

    this.contentEl = document.createElement('div');
    this.contentEl.style.cssText = 'display:flex;flex-direction:column;gap:14px;padding:14px 16px 16px;';
    modal.appendChild(this.contentEl);

    this.container.appendChild(modal);
    this.modalEl = modal;
    this.render();
  }

  /** Trame affichée par la carte et état du chargement. */
  update(frame: WeatherRadarFrame | null, status: WeatherRadarStatus): void {
    this.frame = frame;
    this.status = status;
    if (this.isVisible()) this.render();
  }

  show(): void {
    if (!this.modalEl) return;
    this.modalEl.style.display = 'flex';
    this.modalEl.style.flexDirection = 'column';
    this.render();
    this.timer ??= setInterval(() => { if (this.isVisible()) this.render(); }, REFRESH_LABEL_MS);
  }

  hide(opts: { silent?: boolean } = {}): void {
    if (this.modalEl) this.modalEl.style.display = 'none';
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    // Masquage « silencieux » (bascule entre panneaux) : pas de rappel ; le × prévient l'appli
    // pour qu'elle remette à jour le sélecteur (la couche reste active).
    if (!opts.silent) this.onClose?.();
  }

  isVisible(): boolean {
    return this.modalEl?.style.display === 'flex';
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.modalEl?.remove();
  }

  private render(): void {
    if (!this.contentEl) return;
    const s = weatherRadarSummary(this.frame, this.status, Date.now(), 'fr');

    let image: string;
    if (s.state === 'ready') {
      const nature = s.natureLabel === 'observation' ? 'observation' : 'prévision à court terme';
      image = `
        <div data-wr="image" style="${s.stale ? 'opacity:0.5;filter:grayscale(1);' : ''}">
          <div style="font-size:13px;font-weight:600;color:var(--text-primary);">${s.imageLabel}</div>
          <div style="margin-top:2px;font-size:12px;color:var(--text-muted);">Nature de l’image : ${nature}</div>
          ${s.stale ? `<div data-wr="stale" style="margin-top:6px;font-size:11px;color:var(--text-muted);">${s.staleLabel}</div>` : ''}
        </div>`;
    } else {
      image = `<div data-wr="image" style="font-size:12px;color:var(--text-muted);">${s.message}</div>`;
    }

    const legend = WEATHER_RADAR_LEGEND_ITEMS.map((item) => `
      <li style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-primary);">
        <span aria-hidden="true" style="width:12px;height:12px;border-radius:2px;flex-shrink:0;background:${item.color ?? 'transparent'};"></span>
        <span>${item.label}</span>
      </li>`).join('');

    this.contentEl.innerHTML = `
      ${image}
      <section>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-muted);margin-bottom:6px;">Intensité des précipitations</div>
        <ul data-wr="legend" style="list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px;">${legend}</ul>
      </section>
      <footer style="font-size:11px;line-height:1.4;color:var(--text-muted);">
        Source : RainViewer · nouvelle image environ toutes les 10 min · France métropolitaine, Europe et outre-mer
      </footer>`;
  }
}
