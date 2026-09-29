// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { innerLayerOpen } from './escape-layers.ts';

function add(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  // jsdom ne fait pas de mise en page : on simule « affiché ».
  for (const el of host.querySelectorAll('*')) (el as HTMLElement).getClientRects = () => [{}] as unknown as DOMRectList;
  return host;
}
afterEach(() => { document.body.innerHTML = ''; });

describe('innerLayerOpen', () => {
  it('faux sans couche', () => { add('<div class="gas-panel-modal"></div>'); expect(innerLayerOpen()).toBe(false); });
  it('vrai avec une bulle de carte ou une fenêtre', () => {
    add('<div class="maplibregl-popup"></div>');
    expect(innerLayerOpen()).toBe(true);
    document.body.innerHTML = '';
    add('<div role="dialog"></div>');
    expect(innerLayerOpen()).toBe(true);
  });
  it('un menu masqué ne compte pas', () => {
    const h = add('<div role="menu" hidden></div>');
    h.querySelector('[role="menu"]')!.getClientRects = () => [] as unknown as DOMRectList;
    expect(innerLayerOpen()).toBe(false);
  });
  it('une fenêtre fermée (aria-hidden) laissée dans le DOM ne compte pas', () => {
    add('<div aria-hidden="true"><div role="dialog" aria-modal="true"></div></div>');
    expect(innerLayerOpen()).toBe(false);
  });
  it('le panneau de module lui-même est ignoré', () => {
    add('<div class="gas-panel-modal" role="dialog"></div>');
    expect(innerLayerOpen(document, '.gas-panel-modal')).toBe(false);
  });
});
