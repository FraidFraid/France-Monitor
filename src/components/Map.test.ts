// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { Map as SvgMap } from './Map.ts';

// Un département carré autour du centre de la projection (2,2° E, 46,6° N).
const DEPARTEMENTS = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: { code: '18' },
    geometry: { type: 'Polygon', coordinates: [[[1.2, 46.1], [3.2, 46.1], [3.2, 47.1], [1.2, 47.1], [1.2, 46.1]]] },
  }],
};

function sized(el: HTMLElement, width: number, height: number): void {
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: height });
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe('carte mobile D3 : redimensionnement (relecture finale m7)', () => {
  it('initialisée dans un conteneur masqué (400 × 600 par défaut), elle s’ajuste au conteneur devenu visible', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(DEPARTEMENTS))));
    const container = document.createElement('div');
    document.body.appendChild(container);
    sized(container, 0, 0);
    const map = new SvgMap(container);
    await map.init();
    const svg = container.querySelector('svg');
    expect([svg?.getAttribute('width'), svg?.getAttribute('height')]).toEqual(['400', '600']);
    const before = container.querySelector('.dept')?.getAttribute('d');

    sized(container, 390, 700);
    map.resize();
    expect([svg?.getAttribute('width'), svg?.getAttribute('height')]).toEqual(['390', '700']);
    const after = container.querySelector('.dept')?.getAttribute('d');
    expect(after).toBeTruthy();
    expect(after).not.toBe(before);
  });

  it('conteneur encore masqué : ne change rien', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    const container = document.createElement('div');
    document.body.appendChild(container);
    sized(container, 0, 0);
    const map = new SvgMap(container);
    await map.init();
    map.resize();
    expect(container.querySelector('svg')?.getAttribute('width')).toBe('400');
  });
});
