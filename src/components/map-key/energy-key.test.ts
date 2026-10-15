// src/components/map-key/energy-key.test.ts
// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { buildEnergyKeyHtml } from './energy-key.ts';
import type { EnergyKeyModel } from '../deckgl/energy-map.ts';
import type { EnergyState } from '../../services/energy-state.ts';

const base = (over: Partial<EnergyKeyModel> = {}): EnergyKeyModel => ({
  visible: true,
  counts: { arret: 2, tension: 1, reduit: 0, maintenance: 9, normal: 40, nonSuivi: 300 },
  hiddenStates: new Set<EnergyState>(),
  alertSectors: [['nucleaire', 'arret'], ['gaz', 'tension']],
  shapes: { reactor: true, refinery: false, storage: true, hydro: false },
  windClusters: true,
  networks: { gas: true, oil: false, drom: false },
  flows: { exports: 4, imports: 2 },
  regions: true,
  metro: false,
  fuelTension: null,
  ...over,
});

function dom(html: string): HTMLElement {
  const el = document.createElement('div');
  el.innerHTML = html;
  return el;
}

describe('légende de l’énergie', () => {
  it('rien quand aucune couche énergie n’est allumée', () => {
    expect(buildEnergyKeyHtml(base({ visible: false }))).toBe('');
  });
  it('une ligne par état présent, du plus grave au moins grave, avec son nombre ; un état à zéro n’a pas de ligne', () => {
    const el = dom(buildEnergyKeyHtml(base()));
    const rows = [...el.querySelectorAll('[data-key-action^="energy:"]')];
    expect(rows.map((r) => r.getAttribute('data-key-action'))).toEqual(
      ['energy:arret', 'energy:tension', 'energy:maintenance', 'energy:normal', 'energy:nonSuivi'],
    );
    expect(rows[0].textContent).toContain('À l’arrêt sans préavis');
    expect(rows[0].querySelector('.mk-n')?.textContent).toBe('2');
    expect(rows[4].querySelector('.mk-n')?.textContent).toBe('300');
  });
  it('un état masqué est barré et aria-pressed=false', () => {
    const el = dom(buildEnergyKeyHtml(base({ hiddenStates: new Set<EnergyState>(['normal']) })));
    const row = el.querySelector('[data-key-action="energy:normal"]');
    expect(row?.classList.contains('mk-row--off')).toBe(true);
    expect(row?.getAttribute('aria-pressed')).toBe('false');
  });
  it('pictos des filières en alerte seulement, à la couleur de leur état', () => {
    const el = dom(buildEnergyKeyHtml(base()));
    const pics = [...el.querySelectorAll('.mk-icons .mk-pic')];
    expect(pics).toHaveLength(2);
    expect(el.textContent).toContain('Nucléaire');
    expect(el.textContent).toContain('Gaz');
    expect(pics[0].getAttribute('style')).toContain('#ff3b30');
  });
  it('réseaux, flux comptés, fond des régions écrit « ce n’est pas une vigilance »', () => {
    const html = buildEnergyKeyHtml(base());
    expect(html).toContain('Gazoduc');
    expect(html).not.toContain('Oléoduc');
    expect(html).toContain('ce n’est pas une vigilance');
    const el = dom(html);
    expect(el.textContent).toContain('Export');
    expect(el.textContent).toContain('Import');
  });
  it('formes des sites présents et taille des groupes d’éoliennes en cercles emboîtés', () => {
    const html = buildEnergyKeyHtml(base());
    expect(html).toContain('Réacteur, unité');
    expect(html).toContain('Stockage, terminal');
    expect(html).not.toContain('Raffinerie');
    expect(html).toContain(`200 éoliennes et plus`);
  });
  it('jamais de tiret cadratin', () => {
    expect(buildEnergyKeyHtml(base({ fuelTension: { rouge: 1, orange: 0, jaune: 2 }, metro: true }))).not.toContain('—');
  });
});
