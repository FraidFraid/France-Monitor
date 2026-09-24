// src/components/poste/StatusBar.ts — bandeau d'état de la disposition A1 (spec §5.2) : niveau
// national en mot et en couleur, ce qui le tire, tendance 24 h, changements depuis la visite et
// voyant de fraîcheur commun (§4.3). Une ligne ; le niveau ouvre la fiche France.

import type { DataSourceStatus } from '../../types/index.ts';
import type { VigilanceLevel } from '../../services/vigilance.ts';
import { renderVigilancePill } from '../shared/vigilancePill.ts';
import { escapeHtml } from '../france-intel-events.ts';

type Lang = 'fr' | 'en';

export interface FreshnessCounts {
  upToDate: number;
  total: number;
}

export interface StatusBarModel {
  /** null tant que l'instantané national n'est pas calculé. */
  level: VigilanceLevel | null;
  drivenBy: string;
  trend: string;
  /** null tant que l'historique n'est pas chargé, ou s'il est indisponible. */
  visit: { firstVisit: boolean; since: string; aggravations: number; nouveaux: number } | null;
  freshness: FreshnessCounts;
  lang: Lang;
}

export function freshnessCounts(sources: readonly DataSourceStatus[]): FreshnessCounts {
  return { upToDate: sources.filter((s) => s.status === 'ok').length, total: sources.length };
}

/** « 33 sources sur 35 à jour » : le seul voyant de fraîcheur (le détail est dans « Sources et qualité »). */
export function freshnessText(counts: FreshnessCounts, lang: Lang): string {
  if (counts.total === 0) return lang === 'fr' ? 'Sources en cours de chargement' : 'Sources loading';
  return lang === 'fr'
    ? `${counts.upToDate} source${counts.upToDate > 1 ? 's' : ''} sur ${counts.total} à jour`
    : `${counts.upToDate} of ${counts.total} sources up to date`;
}

function count(n: number, one: string, many: string, lang: Lang): string {
  const singular = lang === 'fr' ? n <= 1 : n === 1;
  return `${n} ${singular ? one : many}`;
}

export function renderStatusBar(model: StatusBarModel): string {
  const { lang } = model;
  const fr = lang === 'fr';
  if (model.level === null) {
    return `<div class="sb-line"><span class="sb-loading">${fr ? 'Calcul du niveau national…' : 'Computing national level…'}</span></div>`;
  }
  const pill = `<button type="button" class="sb-level" data-select="france" aria-label="${fr ? 'Ouvrir la fiche France' : 'Open the France sheet'}">`
    + `${renderVigilancePill(model.level, lang)}</button>`;
  const summary = ['France', model.drivenBy, model.trend].filter((part) => part.length > 0).map(escapeHtml).join(' · ');
  let visit = '';
  if (model.visit) {
    const v = model.visit;
    visit = v.firstVisit
      ? (fr ? 'Première visite : dernières 24 h' : 'First visit: last 24 h')
      : fr
        ? `<b>Depuis votre visite (${escapeHtml(v.since)})</b> : ${count(v.aggravations, 'aggravation', 'aggravations', lang)} · ${count(v.nouveaux, 'nouveau', 'nouveaux', lang)}`
        : `<b>Since your visit (${escapeHtml(v.since)})</b>: ${count(v.aggravations, 'escalation', 'escalations', lang)} · ${v.nouveaux} new`;
  }
  return `<div class="sb-line">${pill}<span class="sb-summary">${summary}</span>`
    + (visit ? `<span class="sb-visit">${visit}</span>` : '')
    + `<span class="sb-fresh"><span class="sb-dot" aria-hidden="true"></span>${escapeHtml(freshnessText(model.freshness, lang))}</span></div>`;
}

export class StatusBar {
  private readonly root: HTMLElement;
  private lastHtml = '';
  private onSelectFrance: (() => void) | null = null;

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.addEventListener('click', (e) => {
      const target = e.target instanceof Element ? e.target.closest('[data-select="france"]') : null;
      if (target) this.onSelectFrance?.();
    });
  }

  setOnSelectFrance(handler: () => void): void {
    this.onSelectFrance = handler;
  }

  update(model: StatusBarModel): void {
    const html = renderStatusBar(model);
    if (html === this.lastHtml) return;
    const active = document.activeElement;
    const hadFocus = active instanceof HTMLElement && this.root.contains(active);
    this.root.innerHTML = html;
    this.lastHtml = html;
    if (hadFocus) this.root.querySelector<HTMLElement>('[data-select="france"]')?.focus({ preventScroll: true });
  }
}
