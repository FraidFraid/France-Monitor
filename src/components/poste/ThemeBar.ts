// src/components/poste/ThemeBar.ts — barre de thèmes (spec §5.3) : les cinq vues, chacune avec la
// pastille de son niveau (le mot sur la couleur, §9). « Vue générale » porte le niveau national.

import type { VigilanceLevel } from '../../services/vigilance.ts';
import { THEMES, themeLabel, type ThemeId } from '../../services/themes.ts';
import { renderVigilancePill } from '../shared/vigilancePill.ts';
import { escapeHtml } from '../france-intel-events.ts';

type Lang = 'fr' | 'en';

export interface ThemeBarModel {
  selected: ThemeId;
  /** null tant que le niveau national n'est pas calculé : aucune pastille plutôt qu'un vert par défaut. */
  levels: Record<ThemeId, VigilanceLevel> | null;
  lang: Lang;
}

export function renderThemeBar(model: ThemeBarModel): string {
  const buttons = THEMES.map((th) => {
    const on = th.id === model.selected;
    const level = model.levels ? ` <span class="tb-level">${renderVigilancePill(model.levels[th.id], model.lang)}</span>` : '';
    return `<button type="button" class="tb-theme${on ? ' is-on' : ''}" data-theme="${th.id}" aria-pressed="${on ? 'true' : 'false'}">`
      + `${escapeHtml(themeLabel(th.id, model.lang))}${level}</button>`;
  }).join('');
  return `<div class="tb-list" role="group" aria-label="${model.lang === 'fr' ? 'Thèmes' : 'Themes'}">${buttons}</div>`;
}

function findTheme(root: ParentNode, id: string): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>('[data-theme]')) {
    if (el.dataset.theme === id) return el;
  }
  return null;
}

export class ThemeBar {
  private readonly root: HTMLElement;
  private lastHtml = '';
  private onSelect: ((theme: ThemeId) => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    root.addEventListener('click', (e) => {
      const id = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-theme]')?.dataset.theme : undefined;
      const theme = THEMES.find((th) => th.id === id)?.id;
      if (theme) this.onSelect?.(theme);
    });
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const buttons = [...root.querySelectorAll<HTMLElement>('[data-theme]')];
      const index = buttons.findIndex((b) => b === document.activeElement);
      if (index === -1) return;
      e.preventDefault();
      const next = e.key === 'ArrowRight' ? Math.min(buttons.length - 1, index + 1) : Math.max(0, index - 1);
      buttons[next]?.focus();
    });
  }

  setOnSelect(handler: (theme: ThemeId) => void): void {
    this.onSelect = handler;
  }

  update(model: ThemeBarModel): void {
    const html = renderThemeBar(model);
    if (html === this.lastHtml) return;
    const active = document.activeElement;
    const focused = active instanceof HTMLElement && this.root.contains(active) ? active.dataset.theme : undefined;
    this.root.innerHTML = html;
    this.lastHtml = html;
    if (focused) findTheme(this.root, focused)?.focus({ preventScroll: true });
  }
}
