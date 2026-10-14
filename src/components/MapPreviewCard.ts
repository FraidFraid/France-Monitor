/**
 * MapPreviewCard.ts : aperçu ancré au point cliqué (spec 2026-10-14).
 * Événement : extrait du dernier article, 3 derniers articles, « Lire l'article complet », « Ouvrir la fiche ».
 * Article : extrait, source et âge, « Lire l'article complet », « Voir l'événement » s'il est rattaché.
 */
import type { NewsEvent, NewsEventDetail, NewsItem, ThreatLevel } from '../types/index.ts';
import { eventDisplayLevel, levelHex, levelLabel, unconfirmedPeakLevel } from '../services/vigilance.ts';
import { categoryLabel, newsLevelHex } from '../services/v2-map.ts';
import { fmIcon } from './shared/icons.ts';

export type EventDetailState = NewsEventDetail | 'loading' | 'error';
type PreviewAction = 'open-fiche' | 'open-event';

const MAX_EXCERPT = 220;
const NBSP = ' ';
const NEWS_LEVEL_LABEL: Record<ThreatLevel, string> = {
  critical: 'Critique', high: 'Élevé', medium: 'Modéré', low: 'Faible', info: 'Information',
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Lien externe sûr : http(s) absolu seulement. */
export function safeLink(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function relativeAge(ms: number, now: number): string {
  const min = Math.max(0, Math.round((now - ms) / 60_000));
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min}${NBSP}min`;
  const h = Math.round(min / 60);
  if (h < 48) return `il y a ${h}${NBSP}h`;
  return `il y a ${Math.round(h / 24)}${NBSP}j`;
}

function excerpt(text: string | null | undefined): string {
  if (!text) return '';
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > MAX_EXCERPT ? `${clean.slice(0, MAX_EXCERPT - 1).replace(/\s+\S*$/, '')}…` : clean;
}

function readLink(href: string | null): string {
  return href
    ? `<a class="mpc__primary" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">Lire l’article complet ${fmIcon('external-link', { size: 12 })}</a>`
    : '';
}

function shell(color: string, kind: string, title: string, body: string, actions: string): string {
  return `<div class="mpc__inner" style="--lvl:${color}">`
    + `<button type="button" class="mpc__close" data-action="close" aria-label="Fermer l’aperçu">${fmIcon('x', { size: 14 })}</button>`
    + `<div class="mpc__kind"><i aria-hidden="true"></i>${escapeHtml(kind)}</div>`
    + `<h3 class="mpc__title">${escapeHtml(title)}</h3>${body}<div class="mpc__actions">${actions}</div></div>`;
}

const byNewest = (a: { publishedAt: string | null }, b: { publishedAt: string | null }): number =>
  (Date.parse(b.publishedAt ?? '') || 0) - (Date.parse(a.publishedAt ?? '') || 0);

export function buildEventPreviewHtml(e: NewsEvent, detail: EventDetailState, now: number): string {
  const level = eventDisplayLevel(e.severity, e.peakSeverity);
  const unconfirmed = unconfirmedPeakLevel(e.severity, e.peakSeverity) !== null;
  const kind = ['Événement', levelLabel(level), unconfirmed ? 'à confirmer' : null, categoryLabel(e.category)]
    .filter((x): x is string => x !== null).join(' · ');
  const n = e.independentCount;
  const since = Date.parse(e.firstSeen);
  const meta = [
    `${n}${NBSP}source${n > 1 ? 's' : ''} indépendante${n > 1 ? 's' : ''}`,
    Number.isFinite(since) ? `depuis ${relativeAge(since, now).replace('il y a ', '')}` : null,
  ].filter((x): x is string => x !== null).join(' · ');

  let body: string;
  let primary = '';
  if (detail === 'loading') {
    body = '<p class="mpc__muted">Chargement des articles…</p>';
  } else if (detail === 'error') {
    body = '<p class="mpc__muted">Articles indisponibles pour le moment.</p>';
  } else {
    const articles = [...detail.articles].sort(byNewest);
    const latest = articles[0];
    primary = readLink(latest ? safeLink(latest.link) : null);
    const rows = articles.slice(0, 3).map((a) => {
      const href = safeLink(a.link);
      const at = Date.parse(a.publishedAt ?? '');
      const sub = [a.feedName, Number.isFinite(at) ? relativeAge(at, now) : null].filter((x): x is string => !!x).join(' · ');
      const title = escapeHtml(a.title);
      const head = href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${title}</a>` : `<span>${title}</span>`;
      return `<li>${head}${sub ? `<small>${escapeHtml(sub)}</small>` : ''}</li>`;
    }).join('');
    const lead = excerpt(latest?.summary);
    body = (lead ? `<p class="mpc__excerpt">${escapeHtml(lead)}</p>` : '')
      + (rows ? `<ul class="mpc__articles">${rows}</ul>` : '<p class="mpc__muted">Aucun article disponible.</p>');
  }
  const fiche = `<button type="button" class="mpc__ghost" data-action="open-fiche">Ouvrir la fiche · ${e.articleCount}${NBSP}articles</button>`;
  return shell(levelHex(level), kind, e.title, `<p class="mpc__meta">${escapeHtml(meta)}</p>${body}`, `${primary}${fiche}`);
}

export function buildArticlePreviewHtml(item: NewsItem, event: NewsEvent | null, now: number): string {
  const level = item.threat?.level ?? 'info';
  const lead = excerpt(item.aiSummary ?? item.summary);
  const meta = [item.source, relativeAge(item.pubDate.getTime(), now)].join(' · ');
  const body = (lead ? `<p class="mpc__excerpt">${escapeHtml(lead)}</p>` : '')
    + `<p class="mpc__meta">${escapeHtml(meta)}</p>`;
  const toEvent = event ? '<button type="button" class="mpc__ghost" data-action="open-event">Voir l’événement</button>' : '';
  return shell(newsLevelHex(level), `Article · ${NEWS_LEVEL_LABEL[level]}`, item.title, body, `${readLink(safeLink(item.link))}${toEvent}`);
}

export class MapPreviewCard {
  private readonly el: HTMLElement;
  private readonly parent: HTMLElement;
  private onAction: ((action: PreviewAction) => void) | null = null;
  private readonly onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape' && this.isOpen()) this.hide();
  };
  private readonly onOutside = (ev: MouseEvent): void => {
    if (this.isOpen() && ev.target instanceof Node && !this.el.contains(ev.target)) this.hide();
  };

  constructor(parent: HTMLElement) {
    this.parent = parent;
    this.el = document.createElement('div');
    this.el.className = 'map-preview-card';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Aperçu');
    this.el.style.display = 'none';
    parent.appendChild(this.el);
    this.el.addEventListener('click', (ev) => {
      if (!(ev.target instanceof Element)) return;
      const action = ev.target.closest('[data-action]')?.getAttribute('data-action');
      if (action === 'close') this.hide();
      if (action === 'open-fiche' || action === 'open-event') {
        this.onAction?.(action);
        this.hide();
      }
    });
    document.addEventListener('keydown', this.onKey);
    document.addEventListener('mousedown', this.onOutside, true);
  }

  setOnAction(cb: (action: PreviewAction) => void): void {
    this.onAction = cb;
  }

  show(html: string, x: number, y: number): void {
    this.el.innerHTML = html;
    this.el.style.display = 'block';
    const w = this.el.offsetWidth || 320;
    const h = this.el.offsetHeight || 200;
    const pw = this.parent.clientWidth || w + 24;
    const ph = this.parent.clientHeight || h + 24;
    this.el.style.left = `${Math.max(12, Math.min(x + 16, pw - w - 12))}px`;
    this.el.style.top = `${Math.max(12, Math.min(y - h / 2, ph - h - 12))}px`;
  }

  update(html: string): void {
    if (this.isOpen()) this.el.innerHTML = html;
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  isOpen(): boolean {
    return this.el.style.display !== 'none';
  }

  destroy(): void {
    document.removeEventListener('keydown', this.onKey);
    document.removeEventListener('mousedown', this.onOutside, true);
    this.el.remove();
  }
}
