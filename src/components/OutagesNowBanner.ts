// src/components/OutagesNowBanner.ts : bandeau « Pannes en cours » (téléphone et internet, toutes sources, 21/10/2026). En bas au centre
// de la carte, dans tous les onglets, dès qu'une panne est en cours : la plus grave en une ligne, « + n autres » ; un clic déplie la liste
// complète (opérateur, département ou pays, depuis quand, preuves et sources). Rien quand aucune panne : l'absence n'est pas « RAS ».
import type { OutageNow, OutagesNowResponse } from '../types/index.ts';
import { DEPARTEMENT_CENTERS } from '../config/departement-centers.ts';
import { departementName } from './layer-panel/health-format.ts';
import { NBSP } from './layer-panel/format.ts';
import { parisClock } from './layer-panel/outages-format.ts';
import { escapeHtml, safeHref } from './france-intel-events.ts';
import { levelColorVar } from '../services/vigilance.ts';
import { NETWORK_LABEL, outageProof, SOURCE_LABEL } from '../services/outages-now.ts';
import { parisDayOf } from '../services/environment-levels.ts';

const LEVEL_WORD = { jaune: 'Vigilance', orange: 'Alerte', rouge: 'Crise' } as const;

/** Nom de la panne : opérateur (« nationale » si dite telle), département, ouvrage, ou pays entier. */
export function outageName(o: Pick<OutageNow, 'scope' | 'dept' | 'operator' | 'label' | 'national'>): string {
  if (o.scope === 'departement' && o.dept !== null) return `${departementName(o.dept)} (${o.dept})`;
  if (o.scope === 'operateur') return `${o.operator ?? o.label ?? 'Opérateur'}${o.national ? ', panne nationale' : ''}`;
  return o.label ?? 'France entière';
}

/** « Téléphone mobile · Orange, panne nationale » : le réseau d'abord. */
export function outageTitle(o: OutageNow): string {
  return `${NETWORK_LABEL[o.network]} · ${outageName(o)}`;
}

/** « depuis 12 h 00 » le jour même, « depuis le 20/10 à 23 h 10 » sinon. */
export function outageSince(iso: string | null, now: number): string {
  const t = iso === null ? Number.NaN : Date.parse(iso);
  if (!Number.isFinite(t)) return 'début n.d.';
  if (parisDayOf(t) === parisDayOf(now)) return `depuis ${parisClock(t)}`;
  const [, m, d] = parisDayOf(t).split('-');
  return `depuis le ${d}/${m} à ${parisClock(t)}`;
}

function dot(level: OutageNow['level']): string {
  return `<span class="onb-dot" style="background:${levelColorVar(level)}"></span>`;
}

function evidenceHtml(o: OutageNow): string {
  return o.evidence.map((e) => {
    const text = escapeHtml(e.text);
    const href = e.link === null ? null : safeHref(e.link);
    const body = href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
    return `<li><b>${escapeHtml(SOURCE_LABEL[e.source])}</b>${NBSP}: ${body}</li>`;
  }).join('');
}

/** Corps du bandeau (pur) : ligne de tête et, déplié, la liste complète. */
export function renderOutagesNow(r: OutagesNowResponse, open: boolean, now: number): string {
  const [top, ...rest] = r.outages;
  if (top === undefined) return '';
  const more = rest.length > 0 ? ` <span class="onb-more">+${NBSP}${rest.length}${NBSP}autre${rest.length > 1 ? 's' : ''}</span>` : '';
  const head = `<button type="button" class="onb-head" aria-expanded="${open}">${dot(top.level)}<span class="onb-title">Panne en cours${NBSP}: `
    + `${escapeHtml(outageTitle(top))}</span><span class="onb-meta">${escapeHtml(outageSince(top.since, now))} · ${escapeHtml(outageProof(top))}</span>${more}`
    + `<span class="onb-chev">${open ? '▾' : '▴'}</span></button>`;
  if (!open) return head;
  const rows = r.outages.map((o) => {
    const focus = o.scope === 'departement' && o.dept !== null ? ` data-dept="${escapeHtml(o.dept)}" role="button" tabindex="0"` : '';
    return `<div class="onb-row${focus ? ' is-link' : ''}"${focus}>${dot(o.level)}<div><div class="onb-row-title">${escapeHtml(outageTitle(o))}`
      + ` <span class="onb-level" style="color:${levelColorVar(o.level)}">${LEVEL_WORD[o.level]}</span></div>`
      + `<div class="onb-meta">${escapeHtml(outageSince(o.since, now))} · ${escapeHtml(outageProof(o))}</div><ul>${evidenceHtml(o)}</ul></div></div>`;
  }).join('');
  const down = r.sources.filter((s) => !s.ok).map((s) => SOURCE_LABEL[s.source]);
  const foot = `<p class="onb-foot">Téléphone mobile, internet, électricité et cloud, tous opérateurs${NBSP}: presse (toutes les 5${NBSP}min), usagers sur Bluesky et Mastodon (2${NBSP}min), IODA et Cloudflare Radar (10${NBSP}min), RTE et EDF (10${NBSP}min), pages d’état (30${NBSP}min), ARCEP (un fichier par jour).`
    + `${down.length > 0 ? ` Indisponibles ou en retard${NBSP}: ${escapeHtml(down.join(', '))}.` : ''}</p>`;
  return `${head}<div class="onb-list">${rows}${foot}</div>`;
}

export class OutagesNowBanner {
  private readonly el: HTMLElement;
  private data: OutagesNowResponse | null = null;
  private open = false;
  private onFlyTo: ((lon: number, lat: number, zoom: number) => void) | null = null;

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'outages-now-banner';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.el.hidden = true;
    this.el.addEventListener('click', (ev) => this.onClick(ev));
    this.el.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' && ev.target instanceof HTMLElement && ev.target.dataset.dept) this.focusDept(ev.target.dataset.dept);
    });
    container.appendChild(this.el);
  }

  setOnFlyTo(handler: (lon: number, lat: number, zoom: number) => void): void {
    this.onFlyTo = handler;
  }

  update(data: OutagesNowResponse | null): void {
    this.data = data;
    this.render();
  }

  destroy(): void {
    this.el.remove();
  }

  private render(): void {
    const html = this.data ? renderOutagesNow(this.data, this.open, Date.now()) : '';
    this.el.hidden = html === '';
    this.el.classList.toggle('is-open', this.open);
    const top = this.data?.outages[0];
    if (top) this.el.style.setProperty('--onb-level', levelColorVar(top.level));
    this.el.innerHTML = html;
  }

  private onClick(ev: Event): void {
    const target = ev.target instanceof Element ? ev.target : null;
    if (target?.closest('a')) return;
    const row = target?.closest<HTMLElement>('[data-dept]');
    if (row?.dataset.dept) {
      this.focusDept(row.dataset.dept);
      return;
    }
    if (target?.closest('.onb-head')) {
      this.open = !this.open;
      this.render();
    }
  }

  private focusDept(code: string): void {
    const entry = Object.values(DEPARTEMENT_CENTERS).find((d) => d.code === code);
    if (entry) this.onFlyTo?.(entry.center[0], entry.center[1], 8);
  }
}
