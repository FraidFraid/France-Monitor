// src/components/fiche/parts.ts — fiche unique de la colonne de droite (refonte UI, spec §6) : un
// modèle commun à tous les types et son rendu HTML, parties toujours dans le même ordre, parties
// vides omises. Pur (aucun DOM) : tout texte tiers est échappé ici et seuls les liens http(s) sont
// cliquables. Les parties propres à un type (« Jugements », « Facteurs »…) et le volet « Pourquoi
// ce niveau ? » arrivent déjà rendus, et échappés, par le rendu de leur type.

import type { ChangeDigestItem, ThreatLevel } from '../../types/index.ts';
import { eventLevel, levelLabel, type VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml, safeHref } from '../france-intel-events.ts';
import { renderVigilancePill } from '../shared/vigilancePill.ts';

export type Lang = 'fr' | 'en';

export function t(lang: Lang, fr: string, en: string): string {
  return lang === 'fr' ? fr : en;
}

/** « Nouveau : titre » / « New: title ». */
export function labelled(lang: Lang, fr: string, en: string, text: string): string {
  return lang === 'fr' ? `${fr} : ${text}` : `${en}: ${text}`;
}

export function parseTime(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/** Heure au format 24 h (« 14:02 »). */
export function formatClock(ms: number, lang: Lang): string {
  return new Date(ms).toLocaleTimeString(lang === 'fr' ? 'fr-FR' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function formatNumber(value: number, lang: Lang): string {
  return value.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', { maximumFractionDigits: 2 });
}

const SEVERITIES: readonly ThreatLevel[] = ['critical', 'high', 'medium', 'low', 'info'];

/** Gravité brute d'un événement (critical, high…) → mot L1 en minuscules ; null si inconnue. */
export function severityWord(value: string | null, lang: Lang): string | null {
  const known = SEVERITIES.find((s) => s === value);
  return known ? levelLabel(eventLevel(known), lang).toLowerCase() : null;
}

/** Texte brut d'un changement d'événement depuis la visite (le rendu de la fiche l'échappe). */
export function digestChangeText(item: ChangeDigestItem, lang: Lang): string {
  const title = item.event.title;
  switch (item.kinds[0]) {
    case 'created':
      return labelled(lang, 'Nouveau', 'New', title);
    case 'escalated': {
      const from = severityWord(item.severityFrom, lang);
      const to = severityWord(item.event.severity, lang);
      // info et low partagent le vert L1 : pas de « vert → vert » trompeur.
      const arrow = from !== null && to !== null && from !== to ? ` (${from} → ${to})` : '';
      return labelled(lang, `Aggravé${arrow}`, `Escalated${arrow}`, title);
    }
    case 'corroborated': {
      const span = `${item.independentFrom ?? '?'} → ${item.event.independentCount}`;
      return labelled(lang, `Corroboré (${span} sources indép.)`, `Corroborated (${span} independent sources)`, title);
    }
    case 'reopened':
      return labelled(lang, 'Rouvert', 'Reopened', title);
    case 'deescalated':
      return labelled(lang, 'Atténué', 'De-escalated', title);
    case 'closed':
      return labelled(lang, 'Clos', 'Closed', title);
    case 'cooling':
      return labelled(lang, 'Refroidit', 'Cooling', title);
    default:
      return title;
  }
}

/** « Rien à traiter. <n> éléments suivis sont au vert. » (spec §7.4). */
export function nothingToHandleText(greenTracked: number, lang: Lang): string {
  const n = greenTracked;
  if (lang === 'fr') {
    const s = n > 1 ? 's' : '';
    return `Rien à traiter. ${n} élément${s} suivi${s} ${n > 1 ? 'sont' : 'est'} au vert.`;
  }
  return `Nothing to handle. ${n} tracked item${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} green.`;
}

export interface FicheChange {
  /** Heure du changement (ms), null si inconnue. */
  at: number | null;
  text: string;
  /** Clé de sélection ouverte au clic (« event:42 »), null si la ligne n'ouvre rien. */
  select: string | null;
}

export interface FicheFigure {
  label: string;
  value: string;
}

export interface FicheWatch {
  text: string;
  horizon: string | null;
}

export interface FicheSource {
  label: string;
  /** Lien externe, rendu cliquable seulement s'il est http(s). */
  href: string | null;
  /** Clé de sélection interne (preuve E…/S…). */
  select: string | null;
}

export interface FicheAction {
  id: string;
  label: string;
}

export interface FicheSection {
  title: string;
  /** HTML déjà échappé par le rendu du type. */
  html: string;
}

export interface FicheModel {
  /** Clé de la fiche (« france », « theme:energy », « event:42 ») : état du volet, focus. */
  key: string;
  kind: string;
  name: string;
  level: VigilanceLevel | null;
  /** Ligne « tiré par … » de l'en-tête. */
  driver: string;
  freshness: string;
  /** Une à trois phrases. */
  essentiel: string[];
  /** Méta de « Ce qui a changé » (ancre de visite, chargement) ; vide et sans ligne → partie omise. */
  changesMeta: string;
  changes: FicheChange[];
  /** Parties propres au type, entre « Ce qui a changé » et « Chiffres clés » (« Jugements », « Facteurs »…). */
  sections: FicheSection[];
  figures: FicheFigure[];
  watch: FicheWatch[];
  sourcesTitle: string;
  sources: FicheSource[];
  /** HTML déjà échappé du volet « Pourquoi ce niveau ? » ; vide → volet omis. */
  why: string;
  whyOpen: boolean;
  actions: FicheAction[];
}

function part(cls: string, title: string, body: string): string {
  return `<section class="fiche-part ${cls}"><h3 class="fiche-part-title">${title}</h3>${body}</section>`;
}

function renderChanges(model: FicheModel, lang: Lang): string {
  if (model.changes.length === 0 && model.changesMeta === '') return '';
  const rows = model.changes.map((c) => {
    const time = `<span class="fiche-time">${c.at === null ? '—' : formatClock(c.at, lang)}</span>`;
    const text = escapeHtml(c.text);
    const body = c.select
      ? `<button type="button" class="fiche-link" data-select="${escapeHtml(c.select)}">${text}</button>`
      : `<span>${text}</span>`;
    return `<li class="fiche-change">${time} ${body}</li>`;
  }).join('');
  const meta = model.changesMeta ? `<div class="fiche-meta">${escapeHtml(model.changesMeta)}</div>` : '';
  const empty = rows ? '' : `<p class="fiche-empty">${t(lang, 'Aucun changement notable.', 'No notable change.')}</p>`;
  return part('fiche-changes', t(lang, 'Ce qui a changé', 'What changed'), `${meta}${rows ? `<ul class="fiche-list">${rows}</ul>` : empty}`);
}

function renderSources(model: FicheModel, lang: Lang): string {
  if (model.sources.length === 0) return '';
  const chips = model.sources.map((s) => {
    const label = escapeHtml(s.label);
    const href = s.href ? safeHref(s.href) : null;
    if (href) return `<a class="fiche-source" href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    if (s.select) return `<button type="button" class="fiche-source fiche-link" data-select="${escapeHtml(s.select)}">${label}</button>`;
    return `<span class="fiche-source">${label}</span>`;
  }).join('');
  const title = model.sourcesTitle || t(lang, 'Preuves et sources', 'Evidence and sources');
  return part('fiche-sources', escapeHtml(title), `<div class="fiche-chips">${chips}</div>`);
}

/** Fiche complète : en-tête, essentiel, changements, parties du type, chiffres, à surveiller, sources, volet, actions. */
export function renderFiche(model: FicheModel, lang: Lang): string {
  const pill = model.level ? renderVigilancePill(model.level, lang) : '';
  const driver = model.driver ? ` <span class="fiche-driver">${escapeHtml(model.driver)}</span>` : '';
  const head = `<header class="fiche-head">`
    + `<div class="fiche-kind">${escapeHtml(model.kind)}</div>`
    + `<h2 class="fiche-name" tabindex="-1">${escapeHtml(model.name)}</h2>`
    + (pill || driver ? `<div class="fiche-level">${pill}${driver}</div>` : '')
    + (model.freshness ? `<div class="fiche-fresh">${escapeHtml(model.freshness)}</div>` : '')
    + `</header>`;
  const essentiel = model.essentiel.length > 0
    ? part('fiche-essentiel', t(lang, 'L’essentiel', 'Key points'), model.essentiel.map((p) => `<p>${escapeHtml(p)}</p>`).join(''))
    : '';
  const sections = model.sections.map((s) => part('fiche-extra', escapeHtml(s.title), s.html)).join('');
  const figures = model.figures.length > 0
    ? part('fiche-figures', t(lang, 'Chiffres clés', 'Key figures'), `<dl class="fiche-figures-grid">${model.figures.slice(0, 3)
      .map((f) => `<div><dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(f.value)}</dd></div>`).join('')}</dl>`)
    : '';
  const watch = model.watch.length > 0
    ? part('fiche-watch', t(lang, 'À surveiller', 'Watch'), `<ul class="fiche-list">${model.watch
      .map((w) => `<li>${w.horizon ? `<span class="fiche-horizon">${escapeHtml(w.horizon)}</span> ` : ''}${escapeHtml(w.text)}</li>`).join('')}</ul>`)
    : '';
  const why = model.why
    ? `<details class="fiche-why" data-why="${escapeHtml(model.key)}"${model.whyOpen ? ' open' : ''}>`
      + `<summary>${t(lang, 'Pourquoi ce niveau ?', 'Why this level?')}</summary>`
      + `<div class="fiche-why-body">${model.why}</div></details>`
    : '';
  const actions = model.actions.length > 0
    ? `<div class="fiche-actions">${model.actions
      .map((a) => `<button type="button" class="fiche-action" data-action="${escapeHtml(a.id)}">${escapeHtml(a.label)}</button>`).join('')}</div>`
    : '';
  return `<article class="fiche" data-fiche="${escapeHtml(model.key)}">${head}${essentiel}${renderChanges(model, lang)}${sections}${figures}${watch}${renderSources(model, lang)}${why}${actions}</article>`;
}
