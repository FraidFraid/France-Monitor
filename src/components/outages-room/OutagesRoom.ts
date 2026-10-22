// src/components/outages-room/OutagesRoom.ts : control room des pannes (spec 2026-10-21 § 5.1), montée sur la carte quand l'onglet
// Pannes est actif. Barre des réseaux en haut, encart national à gauche, fil (ou détail d'une panne) à droite. La carte elle-même
// (départements, contour national) est pilotée par App à partir des rappels onFocus et onFilter.
import type { OutageJournalEntry, OutageNetwork, OutageNow, OutagesNowResponse } from '../../types/index.ts';
import { bulletinBox, detailHtml, feedHtml, nationalBox, networkStrip, NETWORK_SOURCES } from './room-view.ts';
import { cascadeHtml, friseHtml, TIMELINE_WINDOW_MS, timelineBars } from './timeline.ts';

const isNetwork = (v: string): v is OutageNetwork => Object.hasOwn(NETWORK_SOURCES, v);

export class OutagesRoom {
  private readonly el: HTMLElement;
  private readonly strip: HTMLElement;
  private readonly nat: HTMLElement;
  private readonly side: HTMLElement;
  private readonly frise: HTMLElement;
  private journal24: readonly OutageJournalEntry[] = [];
  private cursor: number | null = null;
  private onCursor: ((t: number | null) => void) | null = null;
  private data: OutagesNowResponse | null = null;
  private filter: OutageNetwork | null = null;
  private picked: string | null = null;
  private onFocus: ((o: OutageNow) => void) | null = null;
  private onFilter: ((n: OutageNetwork | null) => void) | null = null;
  /** Suit l'apparition et le contenu de la mini-légende des pastilles (#general-focus-key), posée sous la barre des pastilles. */
  private readonly legendWatch: MutationObserver | null;

  constructor(host: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'orm';
    this.strip = document.createElement('div');
    this.strip.className = 'orm-strip';
    this.nat = document.createElement('div');
    this.nat.className = 'orm-nat';
    this.side = document.createElement('div');
    this.side.className = 'orm-side';
    this.side.setAttribute('aria-live', 'polite');
    const body = document.createElement('div');
    body.className = 'orm-body';
    body.append(this.nat, this.side);
    this.frise = document.createElement('div');
    this.frise.className = 'orm-frise';
    this.el.append(this.strip, body, this.frise);
    this.el.addEventListener('click', (ev) => this.onClick(ev));
    host.appendChild(this.el);
    this.legendWatch = typeof MutationObserver === 'function' ? new MutationObserver(() => this.placeBelowPills()) : null;
    this.legendWatch?.observe(document.body, { childList: true });
    this.render();
  }

  setOnFocus(fn: (o: OutageNow) => void): void { this.onFocus = fn; }
  setOnFilter(fn: (n: OutageNetwork | null) => void): void { this.onFilter = fn; }
  /** Rejeu : instant choisi sur la frise (null : retour au direct). */
  setOnCursor(fn: (t: number | null) => void): void { this.onCursor = fn; }

  /** Journal des 24 dernières heures (frise). */
  setJournal(entries: readonly OutageJournalEntry[]): void {
    this.journal24 = entries;
    this.render();
  }

  update(r: OutagesNowResponse | null): void {
    this.data = r;
    this.render();
  }

  destroy(): void {
    this.legendWatch?.disconnect();
    this.el.remove();
  }

  /**
   * Sous la barre des pastilles posée sur la carte (sa hauteur dépend de la largeur), et sous leur mini-légende quand elle est
   * affichée (survol ou pastille allumée) ; sinon 108 px.
   */
  private placeBelowPills(): void {
    const host = this.el.parentElement;
    const pills = host?.parentElement?.querySelector('.floating-panel-switcher');
    if (!host || !pills) return;
    const legend = document.getElementById('general-focus-key');
    if (legend && this.legendWatch) this.legendWatch.observe(legend, { childList: true, subtree: true });
    const bottom = Math.max(pills.getBoundingClientRect().bottom, legend?.getBoundingClientRect().bottom ?? 0);
    const top = bottom - host.getBoundingClientRect().top;
    if (top > 0) this.el.style.setProperty('--orm-top', `${Math.round(top + 8)}px`);
  }

  private render(): void {
    const now = Date.now();
    this.placeBelowPills();
    this.strip.innerHTML = networkStrip(this.data, this.filter, now);
    this.nat.innerHTML = nationalBox(this.data, this.filter, now) + bulletinBox(this.data, this.filter, now);
    const picked = this.picked === null ? undefined : [...this.data?.outages ?? [], ...this.data?.bulletin ?? []].find((o) => o.id === this.picked);
    this.side.innerHTML = picked ? detailHtml(picked, this.data?.journal ?? [], now)
      : cascadeHtml(this.data?.cascades ?? []) + feedHtml(this.data?.journal ?? [], this.filter, now);
    const bars = timelineBars(this.journal24.length > 0 ? this.journal24 : this.data?.journal ?? [], this.data?.outages ?? [], now)
      .filter((b) => this.filter === null || b.network === this.filter);
    this.frise.innerHTML = friseHtml(bars, now, this.cursor);
  }

  private setCursor(t: number | null): void {
    this.cursor = t;
    this.onCursor?.(t);
    this.render();
  }

  private onClick(ev: Event): void {
    const target = ev.target instanceof Element ? ev.target : null;
    if (!target || target.closest('a')) return;
    const net = target.closest<HTMLElement>('button[data-net]')?.dataset.net;
    if (net !== undefined && isNetwork(net)) {
      this.filter = this.filter === net ? null : net;
      this.onFilter?.(this.filter);
      this.render();
      return;
    }
    if (target.closest('[data-now]')) {
      this.setCursor(null);
      return;
    }
    const area = target.closest<HTMLElement>('[data-frise]');
    if (area && !target.closest('[data-outage]') && ev instanceof MouseEvent) {
      // Échelle du temps = largeur d'une piste (la colonne des libellés est à gauche) ; à défaut, toute la zone.
      const track = area.querySelector('.orm-frise-track')?.getBoundingClientRect();
      const r = track && track.width > 0 ? track : area.getBoundingClientRect();
      if (r.width > 0) {
        const share = Math.min(Math.max((ev.clientX - r.left) / r.width, 0), 1);
        this.setCursor(Math.round(Date.now() - TIMELINE_WINDOW_MS * (1 - share)));
      }
      return;
    }
    if (target.closest('[data-back]')) {
      this.picked = null;
      this.render();
      return;
    }
    const id = target.closest<HTMLElement>('[data-outage]')?.dataset.outage;
    const o = id === undefined ? undefined : this.data?.outages.find((x) => x.id === id);
    if (o) {
      this.picked = o.id;
      this.onFocus?.(o);
      this.render();
    }
  }
}
