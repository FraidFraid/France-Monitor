// src/components/outages-room/OutagesRoom.ts : control room des pannes (spec 2026-10-21 § 5.1), montée sur la carte quand l'onglet
// Pannes est actif. Barre des réseaux en haut, encart national à gauche, fil (ou détail d'une panne) à droite. La carte elle-même
// (départements, contour national) est pilotée par App à partir des rappels onFocus et onFilter.
import type { OutageNetwork, OutageNow, OutagesNowResponse } from '../../types/index.ts';
import { detailHtml, feedHtml, nationalBox, networkStrip } from './room-view.ts';

export class OutagesRoom {
  private readonly el: HTMLElement;
  private readonly strip: HTMLElement;
  private readonly nat: HTMLElement;
  private readonly side: HTMLElement;
  private data: OutagesNowResponse | null = null;
  private filter: OutageNetwork | null = null;
  private picked: string | null = null;
  private onFocus: ((o: OutageNow) => void) | null = null;
  private onFilter: ((n: OutageNetwork | null) => void) | null = null;

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
    this.el.append(this.strip, this.nat, this.side);
    this.el.addEventListener('click', (ev) => this.onClick(ev));
    host.appendChild(this.el);
    this.render();
  }

  setOnFocus(fn: (o: OutageNow) => void): void { this.onFocus = fn; }
  setOnFilter(fn: (n: OutageNetwork | null) => void): void { this.onFilter = fn; }

  update(r: OutagesNowResponse | null): void {
    this.data = r;
    this.render();
  }

  destroy(): void {
    this.el.remove();
  }

  private render(): void {
    const now = Date.now();
    this.strip.innerHTML = networkStrip(this.data, this.filter, now);
    this.nat.innerHTML = nationalBox(this.data, this.filter, now);
    const picked = this.picked === null ? undefined : this.data?.outages.find((o) => o.id === this.picked);
    this.side.innerHTML = picked ? detailHtml(picked, this.data?.journal ?? [], now) : feedHtml(this.data?.journal ?? [], this.filter, now);
  }

  private onClick(ev: Event): void {
    const target = ev.target instanceof Element ? ev.target : null;
    if (!target || target.closest('a')) return;
    const net = target.closest<HTMLElement>('button[data-net]')?.dataset.net;
    if (net === 'mobile' || net === 'internet' || net === 'electricite' || net === 'cloud') {
      this.filter = this.filter === net ? null : net;
      this.onFilter?.(this.filter);
      this.render();
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
