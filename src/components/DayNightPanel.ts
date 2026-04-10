/**
 * DayNightPanel.ts — Panneau latéral droit pour le layer Jour/Nuit.
 *
 * Sections :
 *  - Temps UTC : horloge temps réel + slider ±12h
 *  - Couches   : 3 toggles (Nuit / Crépuscules / Soleil)
 *  - Légende   : explication des couleurs
 *
 * Usage :
 *   const panel = new DayNightPanel(appRootEl);
 *   panel.setOnChange((opts) => map.updateDayNightOptions(opts));
 *   panel.mount();
 *   panel.show();   // quand layer activé
 *   panel.hide();   // quand layer désactivé
 */

export interface DayNightPanelOptions {
  showNight: boolean;
  showTwilight: boolean;
  showSunIcon: boolean;
  /** Timestamp UTC en ms. 0 = temps réel (Date.now()). */
  timestamp: number;
}

export class DayNightPanel {
  private readonly el: HTMLElement;
  private onChange: ((opts: DayNightPanelOptions) => void) | null = null;

  private options: DayNightPanelOptions = {
    showNight: true,
    showTwilight: true,
    showSunIcon: true,
    timestamp: 0,
  };

  // Offset en minutes par rapport à l'heure courante (−720 à +720)
  private offsetMinutes = 0;

  private clockEl: HTMLElement | null = null;
  private sliderEl: HTMLInputElement | null = null;
  private resetBtnEl: HTMLButtonElement | null = null;
  private clockInterval: ReturnType<typeof setInterval> | null = null;

  // Drag state
  private isDragging = false;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private readonly onMouseMove: (e: MouseEvent) => void;
  private readonly onMouseUp: () => void;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'dn-panel';
    this.el.style.display = 'none';
    container.appendChild(this.el);

    this.onMouseMove = (e: MouseEvent) => {
      if (!this.isDragging) return;
      const x = Math.max(0, Math.min(window.innerWidth  - this.el.offsetWidth,  e.clientX - this.dragOffsetX));
      const y = Math.max(0, Math.min(window.innerHeight - this.el.offsetHeight, e.clientY - this.dragOffsetY));
      this.el.style.left  = `${x}px`;
      this.el.style.top   = `${y}px`;
      this.el.style.right = 'auto';
    };

    this.onMouseUp = () => {
      if (!this.isDragging) return;
      this.isDragging = false;
      document.body.style.userSelect = '';
    };
  }

  setOnChange(cb: (opts: DayNightPanelOptions) => void): void {
    this.onChange = cb;
  }

  mount(): void {
    this.render();
    this.startClock();
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mouseup',   this.onMouseUp);
  }

  show(): void {
    this.el.style.display = 'flex';
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private render(): void {
    this.el.innerHTML = `
      <header class="dn-panel__header">
        <div class="dn-panel__icon-wrap">
          <span class="dn-panel__icon">🌙</span>
        </div>
        <div class="dn-panel__header-text">
          <span class="dn-panel__eyebrow">Lecture solaire</span>
          <span class="dn-panel__title">Jour / Nuit</span>
          <span class="dn-panel__subtitle">Temps UTC, crépuscules et point subsolaire</span>
        </div>
      </header>

      <!-- SECTION TEMPS -->
      <section class="dn-section">
        <div class="dn-section__label">TEMPS UTC</div>
        <div class="dn-clock" id="dn-clock">00:00:00 UTC</div>

        <div class="dn-slider-wrap">
          <input
            class="dn-slider"
            id="dn-offset-slider"
            type="range"
            min="-720"
            max="720"
            step="5"
            value="0"
          />
          <div class="dn-slider-labels">
            <span>−12h</span>
            <span>Maintenant</span>
            <span>+12h</span>
          </div>
          <button class="dn-reset-btn" id="dn-reset-btn" disabled>
            ↺ Réel-temps
          </button>
        </div>
      </section>

      <!-- SECTION COUCHES -->
      <section class="dn-section">
        <div class="dn-section__label">COUCHES</div>

        <label class="dn-toggle" id="dn-toggle-night">
          <span class="dn-toggle__swatch dn-swatch--night"></span>
          <span class="dn-toggle__name">Nuit</span>
          <div class="dn-switch">
            <input type="checkbox" id="dn-chk-night" checked />
            <span class="dn-switch__track"></span>
          </div>
        </label>

        <label class="dn-toggle" id="dn-toggle-twilight">
          <span class="dn-toggle__swatch dn-swatch--twilight"></span>
          <span class="dn-toggle__name">Crépuscules</span>
          <div class="dn-switch">
            <input type="checkbox" id="dn-chk-twilight" checked />
            <span class="dn-switch__track"></span>
          </div>
        </label>

        <label class="dn-toggle" id="dn-toggle-sun">
          <span class="dn-toggle__swatch dn-swatch--sun"></span>
          <span class="dn-toggle__name">Soleil</span>
          <div class="dn-switch">
            <input type="checkbox" id="dn-chk-sun" checked />
            <span class="dn-switch__track"></span>
          </div>
        </label>
      </section>

      <!-- SECTION LÉGENDE -->
      <section class="dn-section">
        <div class="dn-section__label">LÉGENDE</div>

        <div class="dn-legend">
          <div class="dn-legend__item">
            <span class="dn-legend__swatch dn-swatch--night"></span>
            <div class="dn-legend__text">
              <span class="dn-legend__name">Nuit totale</span>
              <span class="dn-legend__desc">Imagerie optique impossible — soleil &lt;−18°</span>
            </div>
          </div>
          <div class="dn-legend__item">
            <span class="dn-legend__swatch dn-swatch--astro"></span>
            <div class="dn-legend__text">
              <span class="dn-legend__name">Crép. astronomique</span>
              <span class="dn-legend__desc">−12° à −18° · Seules les étoiles brillantes visibles</span>
            </div>
          </div>
          <div class="dn-legend__item">
            <span class="dn-legend__swatch dn-swatch--naut"></span>
            <div class="dn-legend__text">
              <span class="dn-legend__name">Crép. nautique</span>
              <span class="dn-legend__desc">−6° à −12° · Horizon marine difficilement distinguable</span>
            </div>
          </div>
          <div class="dn-legend__item">
            <span class="dn-legend__swatch dn-swatch--civil"></span>
            <div class="dn-legend__text">
              <span class="dn-legend__name">Crép. civil</span>
              <span class="dn-legend__desc">0° à −6° · Activité extérieure encore possible</span>
            </div>
          </div>
          <div class="dn-legend__item">
            <span class="dn-legend__swatch dn-swatch--sun-lg"></span>
            <div class="dn-legend__text">
              <span class="dn-legend__name">Point subsolaire</span>
              <span class="dn-legend__desc">Position zénithale du soleil</span>
            </div>
          </div>
        </div>
      </section>
    `;

    this.clockEl    = this.el.querySelector('#dn-clock');
    this.sliderEl   = this.el.querySelector('#dn-offset-slider');
    this.resetBtnEl = this.el.querySelector('#dn-reset-btn');

    // Drag via header
    const header = this.el.querySelector<HTMLElement>('.dn-panel__header');
    header?.addEventListener('mousedown', (e: MouseEvent) => {
      this.isDragging = true;
      const rect = this.el.getBoundingClientRect();
      this.dragOffsetX = e.clientX - rect.left;
      this.dragOffsetY = e.clientY - rect.top;
      // Ancrer en left/top à partir de la position courante
      this.el.style.left  = `${rect.left}px`;
      this.el.style.top   = `${rect.top}px`;
      this.el.style.right = 'auto';
      document.body.style.userSelect = 'none';
    });

    // Slider
    this.sliderEl?.addEventListener('input', () => {
      this.offsetMinutes = Number(this.sliderEl!.value);
      const isOffset = this.offsetMinutes !== 0;
      if (this.resetBtnEl) this.resetBtnEl.disabled = !isOffset;
      this.updateClock();
      this.emit();
    });

    // Reset to real-time
    this.resetBtnEl?.addEventListener('click', () => {
      this.offsetMinutes = 0;
      if (this.sliderEl) this.sliderEl.value = '0';
      if (this.resetBtnEl) this.resetBtnEl.disabled = true;
      this.updateClock();
      this.emit();
    });

    // Toggle checkboxes
    this.el.querySelector('#dn-chk-night')?.addEventListener('change', (e) => {
      this.options.showNight = (e.target as HTMLInputElement).checked;
      this.emit();
    });

    this.el.querySelector('#dn-chk-twilight')?.addEventListener('change', (e) => {
      this.options.showTwilight = (e.target as HTMLInputElement).checked;
      this.emit();
    });

    this.el.querySelector('#dn-chk-sun')?.addEventListener('change', (e) => {
      this.options.showSunIcon = (e.target as HTMLInputElement).checked;
      this.emit();
    });

    this.updateClock();
  }

  private startClock(): void {
    this.clockInterval = setInterval(() => {
      // Seulement mettre à jour l'horloge en temps réel si pas d'offset
      if (this.offsetMinutes === 0) this.updateClock();
    }, 1000);
  }

  private updateClock(): void {
    if (!this.clockEl) return;
    const now = Date.now() + this.offsetMinutes * 60_000;
    const d = new Date(now);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    this.clockEl.textContent = `${hh}:${mm}:${ss} UTC`;
    if (this.offsetMinutes !== 0) {
      const sign   = this.offsetMinutes > 0 ? '+' : '−';
      const absMin = Math.abs(this.offsetMinutes);
      const oh     = String(Math.floor(absMin / 60)).padStart(2, '0');
      const om     = String(absMin % 60).padStart(2, '0');
      this.clockEl.setAttribute('data-offset', `${sign}${oh}h${om}`);
    } else {
      this.clockEl.removeAttribute('data-offset');
    }
  }

  private buildTimestamp(): number {
    return this.offsetMinutes === 0 ? 0 : Date.now() + this.offsetMinutes * 60_000;
  }

  private emit(): void {
    this.options.timestamp = this.buildTimestamp();
    this.onChange?.(this.options);
  }

  destroy(): void {
    if (this.clockInterval !== null) {
      clearInterval(this.clockInterval);
      this.clockInterval = null;
    }
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup',   this.onMouseUp);
    this.el.remove();
  }
}
