// src/components/deckgl/energy-popup.ts
/**
 * energy-popup.ts : la fenêtre unique de l'énergie (spec 2026-10-16 § 6). Bulle courte au survol, fiche épinglée au clic.
 * Piège MapLibre : `addTo` sur une fenêtre déjà ouverte la ferme d'abord (évènement « close ») ; on ne rouvre donc qu'une
 * fenêtre fermée, et seule une fermeture qui ne vient pas de ce module (bouton ×) désépingle.
 */
export interface PopupLike {
  setLngLat(lngLat: [number, number]): unknown;
  setHTML(html: string): unknown;
  addTo(map: never): unknown;
  remove(): unknown;
  isOpen(): boolean;
  on(type: 'close', cb: () => void): unknown;
  getElement(): HTMLElement;
}

export class EnergyPopupController {
  private popup: PopupLike | null = null;
  private popupPinned = false;
  private closingByCode = false;
  pinned = false;

  private readonly create: (pinned: boolean) => PopupLike;
  private readonly attach: (p: PopupLike) => void;

  constructor(create: (pinned: boolean) => PopupLike, attach: (p: PopupLike) => void) {
    this.create = create;
    this.attach = attach;
  }

  show(lngLat: [number, number], html: string, pinned = false): void {
    if (this.popup === null || this.popupPinned !== pinned) {
      this.discard();
      const p = this.create(pinned);
      p.on('close', () => {
        if (this.closingByCode || this.popup !== p) return;
        // Fermée par l'utilisateur (bouton ×).
        this.popup = null;
        this.pinned = false;
      });
      this.popup = p;
      this.popupPinned = pinned;
    }
    const p = this.popup;
    p.setLngLat(lngLat);
    p.setHTML(html);
    if (!p.isOpen()) this.attach(p);
    const el = p.getElement();
    el.style.pointerEvents = pinned ? 'auto' : 'none';
    el.style.zIndex = '2000';
  }

  pin(lngLat: [number, number], html: string): void {
    this.pinned = true;
    this.show(lngLat, html, true);
  }

  /** Bulle de survol retirée ; une fiche épinglée reste. */
  hide(): void {
    if (this.pinned) return;
    this.discard();
  }

  unpin(): void {
    this.pinned = false;
    this.discard();
  }

  private discard(): void {
    const p = this.popup;
    this.popup = null;
    if (!p) return;
    this.closingByCode = true;
    try {
      p.remove();
    } finally {
      this.closingByCode = false;
    }
  }
}
