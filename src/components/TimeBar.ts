/**
 * TimeBar.ts — Barre de sélection temporelle (style WorldMonitor).
 * Affiche les boutons : 1h | 6h | 24h | 48h | 7d | Tout
 */

import type { TimeRange } from '../types/index.ts';

interface TimeOption {
  label: string;
  value: TimeRange;
}

const TIME_OPTIONS: TimeOption[] = [
  { label: '1h', value: '1h' },
  { label: '6h', value: '6h' },
  { label: '24h', value: '24h' },
  { label: '48h', value: '48h' },
  { label: '7d', value: '7d' },
  { label: 'Tout', value: 'all' },
];

export type TimeChangeHandler = (range: TimeRange) => void;

export class TimeBar {
  private container: HTMLElement;
  private currentRange: TimeRange = '24h';
  private onChange: TimeChangeHandler | null = null;
  private element: HTMLElement | null = null;

  constructor(container: HTMLElement, initialRange: TimeRange = '24h') {
    this.container = container;
    this.currentRange = initialRange;
  }

  setOnChange(handler: TimeChangeHandler): void {
    this.onChange = handler;
  }

  setRange(range: TimeRange): void {
    this.currentRange = range;
    this.render();
  }

  getRange(): TimeRange {
    return this.currentRange;
  }

  mount(): void {
    this.element = document.createElement('div');
    this.element.className = 'time-bar';
    this.container.appendChild(this.element);
    this.render();
  }

  private render(): void {
    if (!this.element) return;

    this.element.innerHTML = `
      <div class="time-bar-buttons">
        ${TIME_OPTIONS.map(opt => `
          <button
            class="time-bar-btn ${this.currentRange === opt.value ? 'active' : ''}"
            data-range="${opt.value}"
          >${opt.label}</button>
        `).join('')}
      </div>
    `;

    // Bind click events
    this.element.querySelectorAll('.time-bar-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const range = (btn as HTMLElement).dataset.range as TimeRange;
        if (range && range !== this.currentRange) {
          this.currentRange = range;
          this.onChange?.(range);
          this.render();
        }
      });
    });
  }
}
