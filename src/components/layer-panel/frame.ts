// src/components/layer-panel/frame.ts : cadre commun des panneaux de couches (spec 2026-10-02 § 4).
// Rendu pur (HTML échappé) + une coquille DOM mince : en-tête collant, onglets, fermeture, sections du kit.
import type { VigilanceLevel } from '../../services/vigilance.ts';
import { loadSectionState, saveSectionState, type SectionStorage } from '../../services/fiche-sections-store.ts';
import { escapeHtml, safeHref } from '../france-intel-events.ts';
import { renderVigilancePill } from '../shared/vigilancePill.ts';
import { fmLoaderHTML } from '../shared/loader.ts';
import { absoluteTime } from '../fiche/kit.ts';
import { renderKitSection, type FicheSection } from '../fiche/parts.ts';

export interface LayerHeadModel {
  theme: string;
  title: string;
  figure?: { value: string; caption: string } | null;
  level?: VigilanceLevel | 'nd' | null;
  status: string[];
  lead?: string | null;
}
export interface LayerTab { id: string; label: string; count?: number | null }
export interface LayerView { head: LayerHeadModel; tabs?: LayerTab[]; activeTab?: string; sections: FicheSection[]; bodyHtml?: string }

export function renderNdPill(): string {
  return '<span class="fm-vig fm-vig--nd">n.d.</span>';
}

export function renderLayerHead(m: LayerHeadModel, titleId: string): string {
  const pill = m.level === 'nd' ? renderNdPill() : m.level ? renderVigilancePill(m.level) : '';
  const status = m.status.filter((s) => s.length > 0).map((s) => `<span class="fmk-ctx">${escapeHtml(s)}</span>`).join('');
  const figure = m.figure
    ? `<div class="lp-figure"><b class="fmk-num">${escapeHtml(m.figure.value)}</b><span>${escapeHtml(m.figure.caption)}</span></div>`
    : '';
  return `<div class="fmk-eyebrow">${escapeHtml(`${m.theme} · Couche`)}</div>`
    + `<h2 class="lp-title" id="${escapeHtml(titleId)}" tabindex="-1">${escapeHtml(m.title)}</h2>`
    + figure
    + (pill || status ? `<div class="fmk-level">${pill}${status}</div>` : '')
    + (m.lead ? `<p class="fmk-lead">${escapeHtml(m.lead)}</p>` : '');
}

export function renderLayerTabs(tabs: readonly LayerTab[], activeId: string, panelId: string): string {
  const items = tabs.map((t) => {
    const on = t.id === activeId;
    const count = t.count != null ? `<span class="lp-tab-count fmk-num">${t.count}</span>` : '';
    return `<button type="button" role="tab" class="lp-tab${on ? ' is-on' : ''}" data-tab="${escapeHtml(t.id)}"`
      + ` id="${escapeHtml(`${panelId}-tab-${t.id}`)}" aria-selected="${on}" aria-controls="${escapeHtml(`${panelId}-body`)}"`
      + ` tabindex="${on ? 0 : -1}">${escapeHtml(t.label)}${count}</button>`;
  }).join('');
  return `<div class="lp-tabs" role="tablist">${items}</div>`;
}

export function renderLayerSections(panelId: string, sections: readonly FicheSection[]): string {
  return sections.map((s) => renderKitSection(`layer:${panelId}`, s)).join('');
}

export function renderLayerView(panelId: string, view: LayerView): string {
  const tabs = view.tabs && view.tabs.length > 0 ? renderLayerTabs(view.tabs, view.activeTab ?? view.tabs[0].id, panelId) : '';
  return `<header class="lp-head">${renderLayerHead(view.head, `${panelId}-title`)}${tabs}</header>`
    + `<div class="lp-body fmk" id="${escapeHtml(`${panelId}-body`)}"${tabs ? ' role="tabpanel"' : ''}>`
    + (view.bodyHtml ?? '') + renderLayerSections(panelId, view.sections) + `</div>`;
}

export function renderCloseButton(): string {
  return '<button type="button" class="lp-close" aria-label="Fermer">'
    + '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>';
}

export function loadingBody(): string {
  return `<div class="lp-state">${fmLoaderHTML()}<p>Chargement des données…</p></div>`;
}

export function sourceErrorCallout(lastDataMs: number | null, now: number): string {
  const text = lastDataMs === null
    ? 'Source injoignable. Aucune donnée reçue.'
    : `Source injoignable. Dernières données : ${absoluteTime(lastDataMs, now, 'fr')}.`;
  return `<p class="fmk-callout lp-callout">${escapeHtml(text)}</p>`;
}

export function emptyLine(text: string): string {
  return `<p class="fiche-empty">${escapeHtml(text)}</p>`;
}

export function freshnessSegment(dataMs: number, now: number, periodMs: number): string {
  const base = `données de ${absoluteTime(dataMs, now, 'fr')}`;
  return now - dataMs > 2 * periodMs ? `${base} (en retard)` : base;
}

export function sourceLinkHtml(label: string, href: string): string {
  const safe = safeHref(href);
  if (!safe) return escapeHtml(label);
  return `<a class="lp-link" href="${safe}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

export const LAYER_TABS_STORAGE_KEY = 'fm.layer.tabs';

function readTabs(storage: SectionStorage | null): Record<string, string> {
  if (!storage) return {};
  try {
    const parsed: unknown = JSON.parse(storage.getItem(LAYER_TABS_STORAGE_KEY) ?? '{}');
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') out[k] = v;
    return out;
  } catch {
    return {};
  }
}

export function loadLayerTab(storage: SectionStorage | null, panelId: string, allowed: readonly string[]): string {
  const saved = readTabs(storage)[panelId];
  return saved !== undefined && allowed.includes(saved) ? saved : allowed[0] ?? '';
}

export function saveLayerTab(storage: SectionStorage | null, panelId: string, tabId: string): void {
  if (!storage) return;
  try {
    storage.setItem(LAYER_TABS_STORAGE_KEY, JSON.stringify({ ...readTabs(storage), [panelId]: tabId }));
  } catch {
    // Stockage refusé : l'onglet reste celui de la session.
  }
}

export function sectionOpenOf(state: ReadonlyMap<string, boolean>, panelId: string): (sectionId: string, byDefault: boolean) => boolean {
  return (sectionId, byDefault) => state.get(`layer:${panelId}:${sectionId}`) ?? byDefault;
}

export function safeStorage(): SectionStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export interface LayerPanelShell { root: HTMLElement; render(view: LayerView): void; destroy(): void }

export function createLayerPanelShell(opts: {
  container: HTMLElement; className: string; panelId: string;
  onClose: () => void; onTab?: (tabId: string) => void; storage?: SectionStorage | null;
}): LayerPanelShell {
  const storage = opts.storage === undefined ? safeStorage() : opts.storage;
  const root = document.createElement('section');
  root.className = `lp ${opts.className}`;
  root.setAttribute('aria-labelledby', `${opts.panelId}-title`);
  // .fmk sur l'enveloppe : en-tête et corps reçoivent les styles du kit (sélecteurs « :is(#app.ui-v2, .lp) .fmk … »).
  root.innerHTML = `${renderCloseButton()}<div class="lp-view fmk"></div>`;
  const viewEl = root.querySelector<HTMLElement>('.lp-view');

  const onClick = (e: Event): void => {
    const target = e.target as HTMLElement;
    if (target.closest('.lp-close')) { opts.onClose(); return; }
    const tab = target.closest<HTMLElement>('[data-tab]');
    if (tab?.dataset['tab']) opts.onTab?.(tab.dataset['tab']);
  };
  const onKey = (e: KeyboardEvent): void => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
    if (!tab) return;
    const tabs = [...root.querySelectorAll<HTMLElement>('[role="tab"]')];
    const i = tabs.indexOf(tab);
    const next = e.key === 'ArrowRight' ? tabs[(i + 1) % tabs.length]
      : e.key === 'ArrowLeft' ? tabs[(i - 1 + tabs.length) % tabs.length]
      : e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs[tabs.length - 1] : null;
    if (!next?.dataset['tab']) return;
    e.preventDefault();
    opts.onTab?.(next.dataset['tab']);
    // Identifiants d'onglet internes (overview, calendar…) : sûrs dans un sélecteur d'attribut.
    root.querySelector<HTMLElement>(`[data-tab="${next.dataset['tab']}"]`)?.focus();
  };
  const onToggle = (e: Event): void => {
    const details = e.target as HTMLElement;
    if (!(details instanceof HTMLDetailsElement)) return;
    const key = details.dataset['section'];
    if (!key) return;
    const state = loadSectionState(storage);
    state.set(key, details.open);
    saveSectionState(storage, state);
  };
  root.addEventListener('click', onClick);
  root.addEventListener('keydown', onKey);
  root.addEventListener('toggle', onToggle, true);
  opts.container.appendChild(root);

  return {
    root,
    render(view: LayerView): void {
      if (!viewEl) return;
      const scroll = root.scrollTop;
      viewEl.innerHTML = renderLayerView(opts.panelId, view);
      root.scrollTop = scroll;
    },
    destroy(): void {
      root.removeEventListener('click', onClick);
      root.removeEventListener('keydown', onKey);
      root.removeEventListener('toggle', onToggle, true);
      root.remove();
    },
  };
}
