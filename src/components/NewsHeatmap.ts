/**
 * NewsHeatmap.ts — Compact heatmap grid (day × category) for news history.
 *
 * Renders a CSS grid where columns = days/weeks, rows = categories.
 * Cell opacity = article count (normalized to dataset max).
 * Click cell → fires onCellClick callback with { category, date }.
 * Hover cell → shows tooltip with exact count.
 */

import type { HistoryBucket, EventCategory } from '../types/index.ts';

// ─── Config ──────────────────────────────────────────────────────────────────

/** Main rows in the heatmap. Categories not listed here go into "Autre". */
const HEATMAP_CATEGORIES: { key: EventCategory; label: string }[] = [
  { key: 'social',    label: 'Social' },
  { key: 'security',  label: 'Sécurité' },
  { key: 'energy',    label: 'Énergie' },
  { key: 'weather',   label: 'Météo' },
  { key: 'transport', label: 'Transport' },
  { key: 'health',    label: 'Santé' },
  { key: 'finance',   label: 'Finance' },
  { key: 'cyber',     label: 'Cyber' },
  { key: 'general',   label: 'Général' },
];

const OTHER_CATEGORY_LABEL = 'Autre';

/** Categories that map to the "Autre" row. */
const OTHER_CATEGORIES = new Set<string>([
  'infrastructure', 'floods', 'fires',
]);

export interface HeatmapCell {
  category: EventCategory | 'other';
  date: string;     // ISO date string (day start)
  count: number;
}

export interface HeatmapClickEvent {
  category: EventCategory | 'other';
  date: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export class NewsHeatmap {
  private el: HTMLElement;
  private tooltipEl: HTMLElement;
  private grid: HeatmapCell[][] = [];   // [row][col]
  private dateLabels: string[] = [];
  private selectedCell: { row: number; col: number } | null = null;
  private onCellClick: ((event: HeatmapClickEvent | null) => void) | null = null;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'news-heatmap';
    container.appendChild(this.el);

    this.tooltipEl = document.createElement('div');
    this.tooltipEl.className = 'news-heatmap__tooltip';
    document.body.appendChild(this.tooltipEl);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  setOnCellClick(fn: (event: HeatmapClickEvent | null) => void): void {
    this.onCellClick = fn;
  }

  update(buckets: HistoryBucket[]): void {
    const { grid, dateLabels } = this.buildGrid(buckets);
    this.grid = grid;
    this.dateLabels = dateLabels;
    this.selectedCell = null;
    this.render();
  }

  clearSelection(): void {
    this.selectedCell = null;
    this.render();
  }

  destroy(): void {
    this.tooltipEl.remove();
    this.el.remove();
  }

  // ── Grid construction ─────────────────────────────────────────────────────

  private buildGrid(buckets: HistoryBucket[]): {
    grid: HeatmapCell[][];
    dateLabels: string[];
  } {
    // Collect unique dates (sorted chronologically)
    const dateSet = new Set<string>();
    for (const b of buckets) {
      if (b.t) dateSet.add(b.t.slice(0, 10)); // ISO date part
    }
    const dateLabels = [...dateSet].sort();

    // Build count map: key = `${category}|${date}` → count
    const countMap = new Map<string, number>();
    for (const b of buckets) {
      if (!b.t) continue;
      const date = b.t.slice(0, 10);
      const cat = b.category && OTHER_CATEGORIES.has(b.category) ? 'other' : (b.category ?? 'other');
      const key = `${cat}|${date}`;
      countMap.set(key, (countMap.get(key) ?? 0) + b.count);
    }

    // Build grid: rows = categories + "other", cols = dates
    const allRows = [
      ...HEATMAP_CATEGORIES.map(c => c.key as EventCategory | 'other'),
      'other' as const,
    ];

    const grid: HeatmapCell[][] = allRows.map(cat =>
      dateLabels.map(date => ({
        category: cat,
        date,
        count: countMap.get(`${cat}|${date}`) ?? 0,
      }))
    );

    return { grid, dateLabels };
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  private render(): void {
    const cols = this.dateLabels.length;
    if (cols === 0) {
      this.el.innerHTML = '<div class="news-heatmap__empty">Aucune donnée</div>';
      return;
    }

    // Find max count for normalization
    let maxCount = 1;
    for (const row of this.grid) {
      for (const cell of row) {
        if (cell.count > maxCount) maxCount = cell.count;
      }
    }

    const rowLabels = [...HEATMAP_CATEGORIES.map(c => c.label), OTHER_CATEGORY_LABEL];

    // Date header labels — show every Nth label to avoid overlap
    const labelInterval = cols <= 7 ? 1 : cols <= 30 ? 5 : 7;

    let html = `<div class="news-heatmap__grid" style="grid-template-columns: 56px repeat(${cols}, 1fr);">`;

    // Header row (dates)
    html += '<div class="news-heatmap__corner"></div>';
    for (let c = 0; c < cols; c++) {
      const label = c % labelInterval === 0 ? this.formatDateLabel(this.dateLabels[c]) : '';
      html += `<div class="news-heatmap__date-label">${label}</div>`;
    }

    // Data rows
    for (let r = 0; r < this.grid.length; r++) {
      html += `<div class="news-heatmap__row-label">${rowLabels[r]}</div>`;
      for (let c = 0; c < cols; c++) {
        const cell = this.grid[r][c];
        const opacity = cell.count === 0 ? 0 : Math.max(0.08, cell.count / maxCount * 0.6);
        const isSelected = this.selectedCell?.row === r && this.selectedCell?.col === c;
        const selClass = isSelected ? ' news-heatmap__cell--selected' : '';
        html += `<div class="news-heatmap__cell${selClass}" data-row="${r}" data-col="${c}" style="background:rgba(108,140,255,${opacity.toFixed(2)});"></div>`;
      }
    }

    html += '</div>';
    this.el.innerHTML = html;
    this.attachListeners();
  }

  private formatDateLabel(isoDate: string): string {
    const [, m, d] = isoDate.split('-');
    return `${d}/${m}`;
  }

  // ── Events ────────────────────────────────────────────────────────────────

  private attachListeners(): void {
    this.el.querySelectorAll<HTMLElement>('.news-heatmap__cell').forEach(cellEl => {
      cellEl.addEventListener('mouseenter', e => this.showTooltip(e, cellEl));
      cellEl.addEventListener('mouseleave', () => this.hideTooltip());
      cellEl.addEventListener('click', () => this.handleCellClick(cellEl));
    });
  }

  private handleCellClick(cellEl: HTMLElement): void {
    const row = Number(cellEl.dataset['row']);
    const col = Number(cellEl.dataset['col']);

    // Toggle selection
    if (this.selectedCell?.row === row && this.selectedCell?.col === col) {
      this.selectedCell = null;
      this.onCellClick?.(null);
    } else {
      this.selectedCell = { row, col };
      const cell = this.grid[row][col];
      this.onCellClick?.({ category: cell.category, date: cell.date });
    }
    this.render();
  }

  private showTooltip(e: MouseEvent, cellEl: HTMLElement): void {
    const row = Number(cellEl.dataset['row']);
    const col = Number(cellEl.dataset['col']);
    const cell = this.grid[row]?.[col];
    if (!cell) return;

    const rowLabels = [...HEATMAP_CATEGORIES.map(c => c.label), OTHER_CATEGORY_LABEL];
    const catLabel = rowLabels[row] ?? '?';
    const dateLabel = this.formatDateLabel(cell.date);

    this.tooltipEl.textContent = `${cell.count} article${cell.count !== 1 ? 's' : ''} ${catLabel}, ${dateLabel}`;
    this.tooltipEl.classList.add('is-visible');

    const x = Math.min(e.clientX + 12, window.innerWidth - 200);
    const y = Math.max(8, e.clientY - 28);
    this.tooltipEl.style.left = `${x}px`;
    this.tooltipEl.style.top = `${y}px`;
  }

  private hideTooltip(): void {
    this.tooltipEl.classList.remove('is-visible');
  }
}
