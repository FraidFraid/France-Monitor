// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import { StatusBar, freshnessCounts, renderStatusBar, type StatusBarModel } from './StatusBar.ts';
import { ThemeBar, renderThemeBar } from './ThemeBar.ts';

afterEach(() => {
  document.body.replaceChildren();
});

function mountRoot(): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return root;
}

const visit = { firstVisit: false, since: '3 h', aggravations: 2, nouveaux: 1 };
const base: StatusBarModel = {
  level: 'rouge',
  drivenBy: 'tirée par l’énergie',
  trend: 'en dégradation sur 24 h',
  visit,
  freshness: { upToDate: 33, total: 35 },
  lang: 'fr',
};

describe('StatusBar (spec §5.2)', () => {
  it('une ligne : niveau en mot, ce qui le tire, tendance, visite, fraîcheur', () => {
    const html = renderStatusBar(base);
    expect(html).toContain('<span class="fm-vig fm-vig--rouge">Rouge</span>');
    expect(html).toContain('France · tirée par l’énergie · en dégradation sur 24 h');
    expect(html).toContain('Depuis votre visite (3 h)</b> : 2 aggravations · 1 nouveau');
    expect(html).toContain('33 sources sur 35 à jour');
    expect(renderStatusBar({ ...base, visit: { ...visit, firstVisit: true } })).toContain('Première visite : dernières 24 h');
    expect(renderStatusBar({ ...base, level: null })).toContain('Calcul du niveau national…');
  });

  it('compte les sources à jour ; le niveau ouvre la fiche France', () => {
    expect(freshnessCounts([
      { name: 'a', lastUpdate: null, status: 'ok' },
      { name: 'b', lastUpdate: null, status: 'stale' },
    ])).toEqual({ upToDate: 1, total: 2 });
    const root = mountRoot();
    const bar = new StatusBar(root);
    const onFrance = vi.fn();
    bar.setOnSelectFrance(onFrance);
    bar.update(base);
    root.querySelector<HTMLButtonElement>('[data-select="france"]')?.click();
    expect(onFrance).toHaveBeenCalledTimes(1);
  });
});

describe('ThemeBar (spec §5.3)', () => {
  it('cinq thèmes, le mot du niveau sur chacun, le thème choisi est pressé', () => {
    const html = renderThemeBar({
      selected: 'energy',
      levels: { general: 'rouge', energy: 'rouge', security: 'orange', health: 'vert', environment: 'jaune' },
      lang: 'fr',
    });
    expect(html.match(/data-theme=/g)).toHaveLength(5);
    expect(html).toContain('data-theme="energy" aria-pressed="true"');
    expect(html).toContain('Santé <span class="tb-level"><span class="fm-vig fm-vig--vert">Vert</span>');
    // Niveau national pas encore calculé : aucune pastille plutôt qu'un vert par défaut (revue).
    expect(renderThemeBar({ selected: 'general', levels: null, lang: 'fr' })).not.toContain('fm-vig');
  });

  it('un clic choisit le thème', () => {
    const root = mountRoot();
    const bar = new ThemeBar(root);
    const onSelect = vi.fn();
    bar.setOnSelect(onSelect);
    bar.update({ selected: 'general', levels: { general: 'jaune', energy: 'vert', security: 'vert', health: 'vert', environment: 'vert' }, lang: 'fr' });
    root.querySelector<HTMLButtonElement>('[data-theme="health"]')?.click();
    expect(onSelect).toHaveBeenCalledWith('health');
  });
});
