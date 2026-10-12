// src/components/poste/ThemeBar.ts — barre de thèmes (spec §5.3) : bouton Intelligence France puis les six vues, chacune avec
// son voyant de niveau (le mot au survol et pour les lecteurs d'écran).

import { levelLabel, type VigilanceLevel } from '../../services/vigilance.ts';
import { THEMES, themeLabel, type ThemeId } from '../../services/themes.ts';
import { fmIcon } from '../shared/icons.ts';
import { LAYER_PRESETS } from '../../config/layer-presets.ts';
import { escapeHtml } from '../france-intel-events.ts';

type Lang = 'fr' | 'en';

export interface ThemeBarModel {
  selected: ThemeId;
  /** Fiche État de la France affichée : le bouton « Intelligence France » est pressé. */
  franceOn?: boolean;
  /** null tant que le niveau national n'est pas calculé : aucun voyant plutôt qu'un vert par défaut. */
  levels: Record<ThemeId, VigilanceLevel> | null;
  lang: Lang;
}

export function renderThemeBar(model: ThemeBarModel): string {
  const buttons = THEMES.map((th) => {
    const on = th.id === model.selected;
    const lv = model.levels?.[th.id];
    // Même voyant sur chaque thème, Vue générale comprise (niveau national) : décision du 12/10/2026, revient sur la spec
    // 2026-09-29 § 4 (pastille avec le mot pour orange et rouge). Le mot reste dit aux lecteurs d'écran et au survol ; orange et
    // rouge brillent plus fort. Niveau pas encore calculé : rien plutôt qu'un vert par défaut.
    const word = lv ? levelLabel(lv, model.lang) : '';
    const level = !lv ? ''
      : ` <span class="tb-dot tb-dot--${lv}" title="${escapeHtml(word)}" aria-hidden="true"></span><span class="visually-hidden">· ${word}</span>`;
    // Même pictogramme que la vue de couches du thème (LayerPanel).
    const icon = LAYER_PRESETS.find((p) => p.id === th.id)?.icon;
    return `<button type="button" class="tb-theme${on ? ' is-on' : ''}" data-theme="${th.id}" aria-pressed="${on ? 'true' : 'false'}">`
      + `${icon ? fmIcon(icon, { size: 13 }) : ''}${escapeHtml(themeLabel(th.id, model.lang))}${level}</button>`;
  }).join('');
  // Avant les thèmes (décision du 12/10/2026) : ouvre la fiche État de la France, à toutes les largeurs.
  const franceOn = model.franceOn === true;
  // Bouton d'entrée, distinct des thèmes (qui filtrent) : il ouvre une fiche, un filet le sépare du groupe de thèmes.
  const france = `<button type="button" class="tb-france${franceOn ? ' is-on' : ''}" data-france aria-pressed="${franceOn ? 'true' : 'false'}">`
    + `${fmIcon('activity', { size: 14 })}${escapeHtml(model.lang === 'fr' ? 'Intelligence France' : 'France intelligence')}</button>`;
  return `<div class="tb-list" role="group" aria-label="${model.lang === 'fr' ? 'Thèmes' : 'Themes'}">${france}`
    + `<span class="tb-sep" aria-hidden="true"></span><div class="tb-seg">${buttons}</div></div>`;
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
  private onSelectFrance: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    root.addEventListener('click', (e) => {
      if (e.target instanceof Element && e.target.closest('[data-france]')) {
        this.onSelectFrance?.();
        return;
      }
      const id = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-theme]')?.dataset.theme : undefined;
      const theme = THEMES.find((th) => th.id === id)?.id;
      if (theme) this.onSelect?.(theme);
    });
    root.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const buttons = [...root.querySelectorAll<HTMLElement>('[data-france], [data-theme]')];
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

  setOnSelectFrance(handler: () => void): void {
    this.onSelectFrance = handler;
  }

  update(model: ThemeBarModel): void {
    const html = renderThemeBar(model);
    if (html === this.lastHtml) return;
    const active = document.activeElement;
    const inside = active instanceof HTMLElement && this.root.contains(active);
    const focused = inside ? active.dataset.theme : undefined;
    const franceFocused = inside && active.hasAttribute('data-france');
    this.root.innerHTML = html;
    this.lastHtml = html;
    if (franceFocused) this.root.querySelector<HTMLElement>('[data-france]')?.focus({ preventScroll: true });
    else if (focused) findTheme(this.root, focused)?.focus({ preventScroll: true });
  }
}
