// src/components/deckgl/energy-popup.test.ts
import { describe, expect, it } from 'vitest';
import { EnergyPopupController, type PopupLike } from './energy-popup.ts';

/** Fenêtre factice qui se comporte comme maplibregl.Popup : addTo sur une fenêtre ouverte la ferme d'abord (évènement close). */
class FakePopup implements PopupLike {
  static open = new Set<FakePopup>();
  private closeCbs: Array<() => void> = [];
  html = '';
  readonly closeButton: boolean;
  constructor(closeButton: boolean) { this.closeButton = closeButton; }
  setLngLat(): this { return this; }
  setHTML(h: string): this { this.html = h; return this; }
  addTo(): this { if (FakePopup.open.has(this)) this.remove(); FakePopup.open.add(this); return this; }
  remove(): this { if (FakePopup.open.delete(this)) for (const cb of this.closeCbs) cb(); return this; }
  isOpen(): boolean { return FakePopup.open.has(this); }
  on(_type: 'close', cb: () => void): this { this.closeCbs.push(cb); return this; }
  getElement(): HTMLElement { return { style: {} } as HTMLElement; }
  userClose(): void { this.remove(); }
}

const setup = (): { c: EnergyPopupController; made: FakePopup[] } => {
  FakePopup.open.clear();
  const made: FakePopup[] = [];
  const c = new EnergyPopupController((pinned) => { const p = new FakePopup(pinned); made.push(p); return p; }, (p) => { p.addTo(undefined as never); });
  return { c, made };
};

describe('fenêtre unique de l’énergie', () => {
  it('cent survols successifs : une seule fenêtre ouverte', () => {
    const { c } = setup();
    for (let i = 0; i < 100; i += 1) c.show([2, 47], `b${i}`, false);
    expect(FakePopup.open.size).toBe(1);
    c.hide();
    expect(FakePopup.open.size).toBe(0);
  });
  it('fiche épinglée : reste épinglée quand on la met à jour, une seule fenêtre', () => {
    const { c } = setup();
    c.show([2, 47], 'bulle', false);
    c.pin([2, 47], 'fiche');
    c.pin([2, 47], 'fiche 2');
    expect(c.pinned).toBe(true);
    expect(FakePopup.open.size).toBe(1);
    c.hide();
    expect(FakePopup.open.size).toBe(1);
  });
  it('bouton de fermeture ou Échap : plus épinglée, plus de fenêtre', () => {
    const { c, made } = setup();
    c.pin([2, 47], 'fiche');
    made[0].userClose();
    expect(c.pinned).toBe(false);
    c.pin([2, 47], 'fiche');
    c.unpin();
    expect(c.pinned).toBe(false);
    expect(FakePopup.open.size).toBe(0);
  });
});
