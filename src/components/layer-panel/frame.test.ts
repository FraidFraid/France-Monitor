// src/components/layer-panel/frame.test.ts
// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  createLayerPanelShell, freshnessSegment, loadLayerTab, renderLayerHead, renderLayerTabs, renderLayerSections,
  saveLayerTab, sectionOpenOf, sourceErrorCallout, sourceLinkHtml, LAYER_TABS_STORAGE_KEY,
} from './frame.ts';

const NOW = Date.parse('2026-10-02T05:00:00Z'); // 07:00 Paris
function memStorage(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(), key: () => null, get length() { return m.size; } } as Storage;
}

describe('cadre des panneaux de couches', () => {
  it('en-tête : sur-titre, titre, gros chiffre, pastille à gauche, segments joints par « · », synthèse', () => {
    const html = renderLayerHead({
      theme: 'Énergie', title: 'Parc nucléaire', figure: { value: '50,4', caption: 'GW disponibles sur 61,7 GW · 82 %' },
      level: 'jaune', status: ['1 arrêt fortuit (1,3 GW)', 'RTE 06:30'], lead: 'Synthèse.',
    }, 'lp-t');
    expect(html).toContain('Énergie · Couche');
    expect(html).toMatch(/<h2[^>]*id="lp-t"[^>]*>Parc nucléaire<\/h2>/);
    expect(html).toContain('50,4');
    // Séparateur « · » posé par le CSS du kit (.fmk-ctx + .fmk-ctx::before), pas dans le HTML.
    expect(html).toMatch(/fm-vig--jaune[^]*<span class="fmk-ctx">1 arrêt fortuit \(1,3 GW\)<\/span><span class="fmk-ctx">RTE 06:30<\/span>/);
    expect(html).toContain('Synthèse.');
    expect(html).not.toMatch(/—|&mdash;/);
  });
  it('pastille grise « n.d. », pas de pastille sans niveau', () => {
    expect(renderLayerHead({ theme: 'É', title: 'T', level: 'nd', status: [] }, 'x')).toContain('fm-vig--nd');
    expect(renderLayerHead({ theme: 'É', title: 'T', level: null, status: ['a'] }, 'x')).not.toContain('fm-vig');
  });
  it('échappe tout texte', () => {
    const html = renderLayerHead({ theme: '<b>', title: '<img src=x onerror=1>', status: ['<i>'], lead: '<script>' }, 'x');
    expect(html).not.toMatch(/<img|<script|<i>|<b>/);
  });
  it('onglets : tablist, aria-selected, compteur', () => {
    const html = renderLayerTabs([{ id: 'a', label: 'Vue' }, { id: 'b', label: 'Signaux REMIT', count: 2 }], 'b', 'nuclearFleet');
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/data-tab="b"[^>]*aria-selected="true"/);
    expect(html).toMatch(/data-tab="a"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
    expect(html).toMatch(/Signaux REMIT<span class="lp-tab-count fmk-num">2<\/span>/);
  });
  it('sections : clés layer:<panneau>:<section>, ouverture mémorisée', () => {
    const html = renderLayerSections('powerGrid', [{ id: 'prod', title: 'Production', html: '<p>x</p>', collapsible: true, open: true }]);
    expect(html).toContain('data-section="layer:powerGrid:prod"');
    const open = sectionOpenOf(new Map([['layer:powerGrid:prod', false]]), 'powerGrid');
    expect(open('prod', true)).toBe(false);
    expect(open('autre', true)).toBe(true);
  });
  it('fraîcheur : heure de la donnée, « (en retard) » au-delà de deux périodes', () => {
    expect(freshnessSegment(NOW - 10 * 60_000, NOW, 15 * 60_000)).toBe('données de 06:50');
    expect(freshnessSegment(NOW - 31 * 60_000, NOW, 15 * 60_000)).toBe('données de 06:29 (en retard)');
  });
  it('erreur de source : avec ou sans données antérieures', () => {
    expect(sourceErrorCallout(NOW - 3600_000, NOW)).toContain('Dernières données : 06:00.');
    expect(sourceErrorCallout(null, NOW)).toContain('Aucune donnée reçue.');
  });
  it('lien de source : http(s) seulement', () => {
    expect(sourceLinkHtml('RTE', 'https://www.rte-france.com')).toMatch(/<a [^>]*href="https:\/\/www.rte-france.com"[^>]*rel="noopener noreferrer"/);
    expect(sourceLinkHtml('X', 'javascript:alert(1)')).not.toContain('<a');
  });
  it('onglet mémorisé par panneau, repli sur le premier, stockage protégé', () => {
    const s = memStorage();
    expect(loadLayerTab(s, 'nuclearFleet', ['vue', 'cal'])).toBe('vue');
    saveLayerTab(s, 'nuclearFleet', 'cal');
    expect(loadLayerTab(s, 'nuclearFleet', ['vue', 'cal'])).toBe('cal');
    s.setItem(LAYER_TABS_STORAGE_KEY, '{corrompu');
    expect(loadLayerTab(s, 'nuclearFleet', ['vue', 'cal'])).toBe('vue');
    expect(loadLayerTab(null, 'nuclearFleet', ['vue'])).toBe('vue');
  });
  it('coquille DOM : fermeture une seule fois, onglets au clavier, mémoire des sections', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const onClose = vi.fn();
    const onTab = vi.fn();
    const storage = memStorage();
    const shell = createLayerPanelShell({ container, className: 'nuclear-panel-modal', panelId: 'nuclearFleet', onClose, onTab, storage });
    shell.render({
      head: { theme: 'Énergie', title: 'Parc nucléaire', status: [] },
      tabs: [{ id: 'vue', label: 'Vue' }, { id: 'cal', label: 'Calendrier' }], activeTab: 'vue',
      sections: [{ id: 'prod', title: 'Production', html: 'x', collapsible: true, open: true }],
    });
    expect(shell.root.classList.contains('lp')).toBe(true);
    expect(shell.root.classList.contains('nuclear-panel-modal')).toBe(true);
    expect(shell.root.getAttribute('aria-labelledby')).toBeTruthy();
    (shell.root.querySelector('[data-tab="vue"]') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(onTab).toHaveBeenCalledWith('cal');
    const details = shell.root.querySelector('details[data-section="layer:nuclearFleet:prod"]') as HTMLDetailsElement;
    details.open = false;
    details.dispatchEvent(new Event('toggle'));
    expect(JSON.parse(storage.getItem('fm.v2.sections') ?? '{}')).toMatchObject({ 'layer:nuclearFleet:prod': false });
    (shell.root.querySelector('.lp-close') as HTMLButtonElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
    shell.destroy();
    expect(container.contains(shell.root)).toBe(false);
  });
});

describe('feuille de style des panneaux de couches', () => {
  it('toute variable du kit utilisée par une règle élargie est définie sur .lp', () => {
    const css = readFileSync('src/styles/main.css', 'utf8');
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1] ?? '', body: m[2] ?? '' }));
    const widened = rules.filter((r) => r.sel.includes(':is(#app.ui-v2, .lp)'));
    const used = new Set(widened.flatMap((r) => [...r.body.matchAll(/var\((--fmk-[a-z-]+|--v2-brand-rgb)/g)].map((m) => m[1] ?? '')));
    expect(used.size).toBeGreaterThan(0);
    const defined = rules.filter((r) => /(^|[\s,])\.lp([\s,.:{]|$)/.test(r.sel.trim()) && !r.sel.includes(':is(')).map((r) => r.body).join(';');
    for (const name of used) expect(defined, name).toContain(`${name}:`);
  });
});
