/**
 * Loader unifié du projet France Monitor.
 *
 * Source unique de vérité pour TOUS les indicateurs de chargement. Avant ce
 * helper, chaque panel avait son propre markup (emoji + pulse, skeleton, spin
 * custom, points animés…) → incohérence visuelle. Tout doit désormais passer
 * par `fmLoaderHTML()` (ou `fmLoaderEl()`), avec le même anneau, la même
 * couleur (--text-accent), le même tempo (@keyframes spin 0.8s) et le même
 * texte par défaut « Chargement… ».
 *
 * Styles associés : `.fm-loader*` dans src/styles/main.css.
 */

export interface FmLoaderOptions {
  /** Texte affiché sous (block) ou à côté (inline) de l'anneau. Défaut « Chargement… ». */
  text?: string;
  /** `block` = centré dans un corps de panel (défaut). `inline` = compact pour strips/lignes. */
  variant?: 'block' | 'inline';
}

const DEFAULT_TEXT = 'Chargement…';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Renvoie le markup HTML du loader standard (à injecter via innerHTML). */
export function fmLoaderHTML(options: FmLoaderOptions = {}): string {
  const { text = DEFAULT_TEXT, variant = 'block' } = options;
  const cls = variant === 'inline' ? 'fm-loader fm-loader--inline' : 'fm-loader';
  const label = escapeHtml(text);
  return (
    `<div class="${cls}" role="status" aria-live="polite">` +
    `<span class="fm-loader__spinner" aria-hidden="true"></span>` +
    `<span class="fm-loader__text">${label}</span>` +
    `</div>`
  );
}

/** Renvoie un élément DOM prêt à insérer (même rendu que `fmLoaderHTML`). */
export function fmLoaderEl(options: FmLoaderOptions = {}): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = fmLoaderHTML(options);
  return wrapper.firstElementChild as HTMLElement;
}
