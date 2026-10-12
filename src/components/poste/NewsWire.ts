// src/components/poste/NewsWire.ts — fil défilant des alertes de l'en-tête v2 (demande du 12/10/2026, façon « newswire » des
// salles de rédaction) : les éléments à traiter tous thèmes confondus, les rouges en tête, dans l'espace libre de la
// première ligne. Masqué faute de place (main.css) ; arrêté au survol et au focus ; immobile si l'utilisateur réduit les animations.

import type { VigilanceLevel } from '../../services/vigilance.ts';
import { levelLabel } from '../../services/vigilance.ts';
import type { WorkItem } from '../../services/work-queue.ts';
import { escapeHtml } from '../france-intel-events.ts';

type Lang = 'fr' | 'en';

export interface WireItem {
  key: string;
  level: VigilanceLevel;
  title: string;
  place: string | null;
  /** Début connu (ms epoch), null si inconnu. */
  at: number | null;
}

/** Au plus quinze dépêches : au-delà, le tour du fil dépasse plusieurs minutes. */
export const WIRE_MAX_ITEMS = 15;

/**
 * Dépêches du fil : éléments à traiter jaunes, orange ou rouges, tous thèmes confondus, sans les cours de marché ; les rouges
 * d'abord, puis les orange, puis les jaunes (demande du 12/10/2026), et dans chaque niveau du plus récent au plus ancien (date
 * inconnue en dernier). Pure.
 */
export function wireItems(items: readonly WorkItem[]): WireItem[] {
  const rank: Record<VigilanceLevel, number> = { rouge: 0, orange: 1, jaune: 2, vert: 3 };
  return items
    .filter((i) => i.level !== 'vert' && i.ref.kind !== 'market')
    .map((i): WireItem => ({ key: i.key, level: i.level, title: i.title, place: i.place, at: i.since }))
    .sort((a, b) => rank[a.level] - rank[b.level] || (b.at ?? -Infinity) - (a.at ?? -Infinity))
    .slice(0, WIRE_MAX_ITEMS);
}

const PARIS_TIME = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
const PARIS_DAY = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit' });

/** Heure de Paris (« 07:42 ») dans les dernières 24 h, sinon le jour (« 11/10 ») ; rien si inconnue. */
export function wireTime(at: number | null, now: number): string {
  if (at === null) return '';
  return now - at < 86_400_000 ? PARIS_TIME.format(at) : PARIS_DAY.format(at);
}

/** Durée d'un tour : la vitesse de lecture reste la même quel que soit le nombre de dépêches. */
export function wireDurationSeconds(items: readonly WireItem[]): number {
  const chars = items.reduce((n, i) => n + i.title.length + (i.place?.length ?? 0) + 12, 0);
  return Math.min(300, Math.max(25, Math.round(chars / 7)));
}

function renderRun(items: readonly WireItem[], now: number, lang: Lang, copy: boolean): string {
  const rows = items.map((i) => {
    const time = wireTime(i.at, now);
    // Copie : décor du défilement continu, hors de l'ordre de tabulation et des lecteurs d'écran.
    return `<li><button type="button" class="nw-item" data-wire-key="${escapeHtml(i.key)}"${copy ? ' tabindex="-1"' : ''}>`
      + (time ? `<span class="nw-time">${escapeHtml(time)}</span>` : '')
      + `<span class="nw-dot nw-dot--${i.level}" aria-hidden="true"></span>`
      + `<span class="visually-hidden">${escapeHtml(levelLabel(i.level, lang))} : </span>`
      + `<span class="nw-title">${escapeHtml(i.title)}</span>`
      + (i.place ? `<span class="nw-place">${escapeHtml(i.place)}</span>` : '')
      + '</button></li>';
  }).join('');
  return `<ul class="nw-run"${copy ? ' aria-hidden="true"' : ''}>${rows}</ul>`;
}

export function renderNewsWire(items: readonly WireItem[], now: number, lang: Lang): string {
  if (items.length === 0) return '';
  const label = lang === 'fr' ? 'Fil des alertes' : 'Alert wire';
  return `<div class="nw" role="region" aria-label="${label}">`
    + `<span class="nw-tag">${lang === 'fr' ? 'Fil' : 'Wire'}</span>`
    + `<div class="nw-viewport"><div class="nw-track" style="--nw-duration: ${wireDurationSeconds(items)}s">`
    + renderRun(items, now, lang, false) + renderRun(items, now, lang, true)
    + '</div></div></div>';
}

export class NewsWire {
  private readonly root: HTMLElement;
  private lastKey = '';
  private onSelect: ((key: string) => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.addEventListener('click', (e) => {
      const key = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-wire-key]')?.dataset.wireKey : undefined;
      if (key) this.onSelect?.(key);
    });
  }

  setOnSelect(handler: (key: string) => void): void {
    this.onSelect = handler;
  }

  /** Ne repeint que si les dépêches changent : un rafraîchissement sans nouveauté ne relance pas le défilement. */
  update(items: readonly WireItem[], now: number, lang: Lang): void {
    const key = `${lang}|${items.map((i) => `${i.key}:${i.level}:${i.title}:${i.at ?? ''}`).join('|')}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.root.innerHTML = renderNewsWire(items, now, lang);
  }
}
