// src/components/poste/WorkList.ts — liste « À traiter » (spec §7.2) : une ligne par élément, barre
// de couleur ET mot du niveau (§9), badge NOUVEAU ou AGGRAVÉ, « Voir les <n> autres », garde hors
// thème fixe en bas. Navigable au clavier (flèches, Début, Fin ; Entrée ouvre la fiche). La liste
// est reconstruite à chaque donnée : le focus est rendu à la même ligne, ou à la première.

import { levelLabel } from '../../services/vigilance.ts';
import { THEMES, themeLabel, type ThemeId } from '../../services/themes.ts';
import { WORK_LIST_CAP, type WorkItem, type WorkQueueView } from '../../services/work-queue.ts';
import { escapeHtml } from '../france-intel-events.ts';
import { fmLoaderHTML } from '../shared/loader.ts';
import { nothingToHandleText } from '../fiche/parts.ts';

type Lang = 'fr' | 'en';

export interface WorkListModel {
  view: WorkQueueView;
  selectedKey: string | null;
  /** Couches critiques chargées : avant, une liste vide dit « chargement », jamais « rien à traiter ». */
  ready: boolean;
  lang: Lang;
  now: number;
}

function relative(since: number, now: number, lang: Lang, ongoing: boolean): string {
  const minutes = Math.max(0, Math.round((now - since) / 60_000));
  const unit = minutes < 60
    ? `${minutes} min`
    : minutes < 48 * 60 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes / 1440)} ${lang === 'fr' ? 'j' : 'd'}`;
  if (lang === 'fr') return ongoing ? `depuis ${unit}` : `il y a ${unit}`;
  return ongoing ? `for ${unit}` : `${unit} ago`;
}

/** « Rouge · Seine-Maritime · il y a 30 min · 3 sources indép. » (spec §7.2), texte brut. */
export function rowMeta(item: WorkItem, lang: Lang, now: number): string {
  const parts = [levelLabel(item.level, lang)];
  if (item.place) parts.push(item.place);
  if (item.since !== null) {
    // Un événement ou une alerte datent d'un instant (« il y a ») ; une situation dure (« depuis »).
    const ongoing = item.ref.kind !== 'event' && item.ref.kind !== 'alert';
    parts.push(relative(item.since, now, lang, ongoing));
  }
  if (item.independentSources !== null) {
    parts.push(item.independentSources >= 2
      ? (lang === 'fr' ? `${item.independentSources} sources indép.` : `${item.independentSources} indep. sources`)
      : (lang === 'fr' ? 'source unique' : 'single source'));
  }
  return parts.join(' · ');
}

function badgeHtml(item: WorkItem, lang: Lang): string {
  // Majuscules du §7.2, exception explicite au §4.3 (arbitrage A4) ; couleur neutre (§2).
  if (item.badge === 'nouveau') return ` <span class="wl-badge">${lang === 'fr' ? 'NOUVEAU' : 'NEW'}</span>`;
  if (item.badge === 'aggrave') return ` <span class="wl-badge">${lang === 'fr' ? 'AGGRAVÉ' : 'ESCALATED'}</span>`;
  return '';
}

export function renderWorkList(model: WorkListModel): string {
  const { view, lang, now } = model;
  const fr = lang === 'fr';
  const title = `${fr ? 'À traiter' : 'To handle'} · ${themeLabel(view.theme, lang)} · ${view.total}`;
  const rows = view.rows.map((item) => {
    const selected = item.key === model.selectedKey;
    return `<li class="wl-row"><button type="button" class="wl-item${selected ? ' is-selected' : ''}" data-key="${escapeHtml(item.key)}"`
      + ` aria-current="${selected ? 'true' : 'false'}" aria-controls="fm-v2-fiche">`
      + `<span class="wl-bar wl-bar--${item.level}" aria-hidden="true"></span>`
      + `<span class="wl-body"><span class="wl-item-title">${escapeHtml(item.title)}${badgeHtml(item, lang)}</span>`
      + `<span class="wl-meta">${escapeHtml(rowMeta(item, lang, now))}</span></span></button></li>`;
  }).join('');
  const notes: string[] = [];
  if (view.eventsStatus === 'loading') {
    notes.push(`<li class="wl-note">${fmLoaderHTML({ text: fr ? 'Chargement des événements…' : 'Loading events…', variant: 'inline' })}</li>`);
  } else if (view.eventsStatus === 'unavailable') {
    notes.push(`<li class="wl-note">${fr ? 'Événements indisponibles pour le moment' : 'Events unavailable right now'}</li>`);
  }
  const emptyText = model.ready ? nothingToHandleText(view.greenTracked, lang) : (fr ? 'Chargement des données…' : 'Loading data…');
  const empty = view.total === 0 ? `<p class="wl-empty">${escapeHtml(emptyText)}</p>` : '';
  const moreLabel = fr
    ? (view.hiddenCount > 1 ? `Voir les ${view.hiddenCount} autres` : 'Voir l’autre élément')
    : `Show ${view.hiddenCount} more`;
  const more = view.hiddenCount > 0
    ? `<button type="button" class="wl-more" data-more="show">${moreLabel}</button>`
    : view.total > WORK_LIST_CAP
      ? `<button type="button" class="wl-more" data-more="hide">${fr ? 'Réduire la liste' : 'Show less'}</button>`
      : '';
  const guardThemes = view.guard ? view.guard.themes.map((th) => themeLabel(th, lang)).join(', ') : '';
  const guard = view.guard
    ? `<button type="button" class="wl-guard" data-guard="${view.guard.target}">${escapeHtml(fr
      ? `Hors de ce thème : ${view.guard.reds} rouge${view.guard.reds > 1 ? 's' : ''} (${guardThemes})`
      : `Outside this theme: ${view.guard.reds} red (${guardThemes})`)}</button>`
    : '';
  return `<div class="wl-head"><h2 class="wl-title" tabindex="-1">${escapeHtml(title)}</h2></div>`
    + `<ul class="wl-list">${rows}${notes.join('')}</ul>${empty}${more}${guard}`;
}

function findByKey(root: ParentNode, key: string): HTMLElement | null {
  for (const el of root.querySelectorAll<HTMLElement>('[data-key]')) {
    if (el.dataset.key === key) return el;
  }
  return null;
}

export class WorkList {
  private readonly root: HTMLElement;
  private lastHtml = '';
  private onSelect: ((key: string) => void) | null = null;
  private onShowAll: ((showAll: boolean) => void) | null = null;
  private onGuard: ((theme: ThemeId) => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    root.addEventListener('click', (e) => this.handleClick(e));
    root.addEventListener('keydown', (e) => this.handleKeydown(e));
  }

  setOnSelect(handler: (key: string) => void): void {
    this.onSelect = handler;
  }

  setOnShowAll(handler: (showAll: boolean) => void): void {
    this.onShowAll = handler;
  }

  setOnGuard(handler: (theme: ThemeId) => void): void {
    this.onGuard = handler;
  }

  update(model: WorkListModel): void {
    const html = renderWorkList(model);
    if (html === this.lastHtml) return;
    const active = document.activeElement;
    const restore = active instanceof HTMLElement && this.root.contains(active) ? this.focusTarget(active) : null;
    this.root.innerHTML = html;
    this.lastHtml = html;
    if (!restore) return;
    // Ligne disparue (élément résolu, expiré, filtré) : la première ligne, jamais le body.
    const target = restore() ?? this.root.querySelector<HTMLElement>('.wl-item') ?? this.root.querySelector<HTMLElement>('.wl-title');
    target?.focus({ preventScroll: true });
  }

  /** Rend le focus à la ligne d'une clé (retour de la fiche) ; false si elle n'est plus affichée. */
  focusRow(key: string): boolean {
    const row = findByKey(this.root, key);
    row?.focus({ preventScroll: true });
    return row !== null;
  }

  private focusTarget(el: HTMLElement): () => HTMLElement | null {
    const key = el.dataset.key;
    if (key !== undefined) return () => findByKey(this.root, key);
    if (el.dataset.more !== undefined) return () => this.root.querySelector<HTMLElement>('.wl-more');
    if (el.dataset.guard !== undefined) return () => this.root.querySelector<HTMLElement>('.wl-guard');
    return () => this.root.querySelector<HTMLElement>('.wl-title');
  }

  private handleClick(e: MouseEvent): void {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    const key = target.closest<HTMLElement>('[data-key]')?.dataset.key;
    if (key !== undefined) {
      this.onSelect?.(key);
      return;
    }
    const more = target.closest<HTMLElement>('[data-more]')?.dataset.more;
    if (more !== undefined) {
      this.onShowAll?.(more === 'show');
      return;
    }
    const guard = target.closest<HTMLElement>('[data-guard]')?.dataset.guard;
    const theme = THEMES.find((th) => th.id === guard)?.id;
    if (theme) this.onGuard?.(theme);
  }

  private handleKeydown(e: KeyboardEvent): void {
    const items = [...this.root.querySelectorAll<HTMLElement>('.wl-item')];
    const index = items.findIndex((el) => el === document.activeElement);
    if (index === -1) return;
    let next: number;
    if (e.key === 'ArrowDown') next = Math.min(items.length - 1, index + 1);
    else if (e.key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else return; // Entrée et Espace : clic natif du bouton → onSelect.
    e.preventDefault();
    items[next]?.focus();
  }
}
