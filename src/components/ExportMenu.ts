/**
 * ExportMenu.ts — Menu déroulant d'export CSV / GeoJSON par couche.
 *
 * Déclenché par le bouton « ⬇ Export » du header (même famille visuelle que
 * « Note de situation »). Au clic, liste les couches AYANT des données en cache
 * (libellé + compteur), chacune proposant un export CSV et, si des entités
 * géolocalisées existent, un export GeoJSON.
 *
 * Téléchargement 100 % client : Blob + URL.createObjectURL + <a download>,
 * l'URL objet étant révoquée juste après le clic. Aucune donnée ne quitte le
 * navigateur.
 */

import {
  buildExportFilename,
  collectExportableLayers,
  layerToCsv,
  layerToGeoJson,
  type ExportableLayer,
  type ExportContext,
} from '../services/data-export.ts';

const CSV_MIME = 'text/csv;charset=utf-8';
const GEOJSON_MIME = 'application/geo+json';

export interface ExportMenuOptions {
  /** Bouton du header servant d'ancrage au menu. */
  anchor: HTMLElement;
  /** Fournit l'instantané des caches courants au moment de l'ouverture. */
  getContext: () => ExportContext;
}

/** Déclenche un téléchargement client puis révoque l'URL objet. */
function downloadBlob(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export class ExportMenu {
  private readonly anchor: HTMLElement;
  private readonly getContext: () => ExportContext;

  private menuEl: HTMLElement | null = null;
  private isOpen = false;

  private onDocPointer: ((event: MouseEvent) => void) | null = null;
  private onKeydown: ((event: KeyboardEvent) => void) | null = null;
  private onReposition: (() => void) | null = null;

  constructor(options: ExportMenuOptions) {
    this.anchor = options.anchor;
    this.getContext = options.getContext;
  }

  /** Ouvre le menu s'il est fermé, le referme sinon. */
  toggle(): void {
    if (this.isOpen) this.hide();
    else this.show();
  }

  show(): void {
    if (this.isOpen) return;
    const layers = collectExportableLayers(this.getContext());
    this.menuEl = this.buildMenu(layers);
    document.body.appendChild(this.menuEl);
    this.position();
    this.isOpen = true;
    this.anchor.setAttribute('aria-expanded', 'true');

    this.onDocPointer = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (this.menuEl && !this.menuEl.contains(target) && !this.anchor.contains(target)) {
        this.hide();
      }
    };
    this.onKeydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        this.hide();
        this.anchor.focus();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        this.moveFocus(event.key === 'ArrowDown' ? 1 : -1);
        event.preventDefault();
      }
    };
    this.onReposition = (): void => this.position();

    // Différé : évite que le clic d'ouverture ne referme aussitôt le menu.
    setTimeout(() => document.addEventListener('click', this.onDocPointer as EventListener), 0);
    document.addEventListener('keydown', this.onKeydown);
    window.addEventListener('resize', this.onReposition);

    this.focusItem(0);
  }

  hide(): void {
    if (!this.isOpen) return;
    if (this.onDocPointer) document.removeEventListener('click', this.onDocPointer as EventListener);
    if (this.onKeydown) document.removeEventListener('keydown', this.onKeydown);
    if (this.onReposition) window.removeEventListener('resize', this.onReposition);
    this.onDocPointer = null;
    this.onKeydown = null;
    this.onReposition = null;
    this.menuEl?.remove();
    this.menuEl = null;
    this.isOpen = false;
    this.anchor.setAttribute('aria-expanded', 'false');
  }

  destroy(): void {
    this.hide();
  }

  // ─── Construction du DOM ────────────────────────────────────────────────────

  private buildMenu(layers: ExportableLayer[]): HTMLElement {
    const menu = document.createElement('div');
    menu.className = 'export-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Export des données par couche');

    const header = document.createElement('div');
    header.className = 'export-menu__header';
    header.textContent = 'Export de la vue courante';
    menu.appendChild(header);

    if (layers.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'export-menu__empty';
      empty.textContent = "Aucune donnée à exporter pour l'instant";
      menu.appendChild(empty);
      return menu;
    }

    const list = document.createElement('div');
    list.className = 'export-menu__list';
    for (const layer of layers) {
      list.appendChild(this.buildRow(layer));
    }
    menu.appendChild(list);
    return menu;
  }

  private buildRow(layer: ExportableLayer): HTMLElement {
    const row = document.createElement('div');
    row.className = 'export-menu__row';

    const label = document.createElement('span');
    label.className = 'export-menu__label';
    label.textContent = layer.label;
    const count = document.createElement('span');
    count.className = 'export-menu__count';
    count.textContent = `${layer.count}`;
    label.appendChild(count);
    row.appendChild(label);

    const actions = document.createElement('span');
    actions.className = 'export-menu__actions';
    actions.appendChild(
      this.buildAction(`Exporter ${layer.label} en CSV`, 'CSV', () => {
        const now = new Date();
        downloadBlob(buildExportFilename(layer.key, 'csv', now), layerToCsv(layer, now), CSV_MIME);
        this.hide();
      }),
    );
    // GeoJSON proposé seulement si la couche possède des entités géolocalisées.
    if (layer.serialized.features.length > 0) {
      actions.appendChild(
        this.buildAction(`Exporter ${layer.label} en GeoJSON`, 'GeoJSON', () => {
          const now = new Date();
          downloadBlob(
            buildExportFilename(layer.key, 'geojson', now),
            layerToGeoJson(layer, now),
            GEOJSON_MIME,
          );
          this.hide();
        }),
      );
    }
    row.appendChild(actions);
    return row;
  }

  private buildAction(ariaLabel: string, text: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'export-menu__action';
    btn.setAttribute('role', 'menuitem');
    btn.setAttribute('aria-label', ariaLabel);
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  // ─── Positionnement & navigation clavier ────────────────────────────────────

  private position(): void {
    if (!this.menuEl) return;
    const rect = this.anchor.getBoundingClientRect();
    this.menuEl.style.position = 'fixed';
    this.menuEl.style.top = `${Math.round(rect.bottom + 8)}px`;
    this.menuEl.style.right = `${Math.round(Math.max(8, window.innerWidth - rect.right))}px`;
  }

  private items(): HTMLButtonElement[] {
    if (!this.menuEl) return [];
    return Array.from(this.menuEl.querySelectorAll<HTMLButtonElement>('.export-menu__action'));
  }

  private focusItem(index: number): void {
    const items = this.items();
    if (items.length === 0) return;
    const clamped = ((index % items.length) + items.length) % items.length;
    items[clamped]?.focus();
  }

  private moveFocus(delta: number): void {
    const items = this.items();
    if (items.length === 0) return;
    const active = document.activeElement;
    const current = items.findIndex((el) => el === active);
    this.focusItem((current === -1 ? 0 : current) + delta);
  }
}
