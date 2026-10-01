// src/components/fiche/parts.ts — fiche unique de la colonne de droite (refonte UI, spec §6) : un
// modèle commun à tous les types et son rendu HTML : en-tête « Instrument » (score) ou en-tête kit,
// sections du kit, actions. Plus de parties génériques ni de volet « Pourquoi ce niveau ? ». Pur
// (aucun DOM) : tout texte tiers est échappé ici et seuls les liens http(s) sont cliquables. Les
// sections arrivent déjà rendues, et échappées, par le constructeur de leur type.

import type { ChangeDigestItem, ThreatLevel } from '../../types/index.ts';
import { eventLevel, levelColorVar, levelLabel, type VigilanceLevel } from '../../services/vigilance.ts';
import { escapeHtml, safeHref } from '../france-intel-events.ts';
import { renderVigilancePill } from '../shared/vigilancePill.ts';
import { absoluteTime, CHEVRON_SVG, meterRow } from './kit.ts';

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
  /** Kit fmk (spec 2026-10-01) : identifiant stable dans la fiche ; absent → rendu historique. */
  id?: string;
  /** HTML échappé affiché à droite du titre. */
  summary?: string;
  /** Section repliable (<details>) ; sinon titre simple au même style. */
  collapsible?: boolean;
  /** Ouverture d'une section repliable (défaut : fermée). */
  open?: boolean;
  /** Ton discret des sections de référence (articles, sources). */
  tone?: 'reference';
}

export interface FichePillar {
  label: string;
  /** Pression du pilier 0–100 (plus haut = pire). */
  value: number;
  level: VigilanceLevel;
  /** Variation 24 h déjà formatée (« +2 ▲ », « — »). */
  delta: string;
  /** Points retirés déjà formatés (« −14,7 »). */
  deduction: string;
}

/** En-tête « Instrument » (spec 2026-10-01 § 3.1). */
export interface FicheScore {
  value: number;
  level: VigilanceLevel;
  baseline: number;
  /** Variation 24 h du score déjà formatée. */
  delta24h: string;
  /** SVG de la courbe 7 jours, '' si trop peu de points. */
  sparkline: string;
  pillars: FichePillar[];
  /** « Facteur principal » déjà échappé ; null si aucun pilier ne pèse. */
  factor: string | null;
  cap: number | null;
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
  /** Parties de la fiche, dans l'ordre d'affichage. */
  sections: FicheSection[];
  actions: FicheAction[];
  /** En-tête « Instrument » du kit fmk : remplace l'en-tête simple ; 'pending' avant le premier calcul. */
  score?: FicheScore | 'pending';
  /** Synthèse en tête de fiche, texte brut (en-tête kit). */
  lead?: string;
  /** Éléments de la ligne de niveau (lieu, depuis, statut…), texte brut. */
  context?: string[];
  /** Texte copié par l'action « Copier la référence ». */
  reference?: string;
}

function part(cls: string, title: string, body: string): string {
  return `<section class="fiche-part ${cls}"><h3 class="fiche-part-title">${title}</h3>${body}</section>`;
}

/** Lignes de changements (heure absolue, texte, lien), la plus récente mise en avant ; '' si aucune. */
export function renderChangeRows(changes: readonly FicheChange[], lang: Lang, now: number): string {
  const rows = changes.map((c, index) => {
    const time = `<span class="fiche-time">${c.at === null ? 'n.d.' : absoluteTime(c.at, now, lang)}</span>`;
    const text = escapeHtml(c.text);
    const body = c.select
      ? `<button type="button" class="fiche-link" data-select="${escapeHtml(c.select)}">${text}</button>`
      : `<span>${text}</span>`;
    return `<li class="fiche-change${index === 0 ? ' is-latest' : ''}">${time} ${body}</li>`;
  }).join('');
  return rows ? `<ul class="fiche-list">${rows}</ul>` : '';
}

/** Étiquettes de sources et de preuves (liens http(s), sélections internes, texte). */
export function renderSourceChips(sources: readonly FicheSource[]): string {
  const chips = sources.map((s) => {
    const label = escapeHtml(s.label);
    const href = s.href ? safeHref(s.href) : null;
    if (href) return `<a class="fiche-source" href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    if (s.select) return `<button type="button" class="fiche-source fiche-link" data-select="${escapeHtml(s.select)}">${label}</button>`;
    return `<span class="fiche-source">${label}</span>`;
  }).join('');
  return `<div class="fiche-chips">${chips}</div>`;
}

const SCALE_ZONES: ReadonlyArray<{ level: VigilanceLevel; width: number }> = [
  { level: 'rouge', width: 55 }, { level: 'orange', width: 15 }, { level: 'jaune', width: 15 }, { level: 'vert', width: 15 },
];
const SCALE_TICKS: readonly number[] = [0, 55, 70, 85, 100];

/** En-tête « Instrument » (spec 2026-10-01 § 3.1) : score, échelle, fraîcheur, piliers, facteur, plafond. */
function renderScoreHead(model: FicheModel, score: FicheScore | 'pending', lang: Lang): string {
  const title = `<h2 class="fiche-name fmk-eyebrow" tabindex="-1">${escapeHtml(model.kind)}</h2>`;
  const fresh = model.freshness ? escapeHtml(model.freshness) : '';
  if (score === 'pending') {
    return `<header class="fiche-head fmk-head">${title}`
      + `<p class="fmk-pending">${t(lang, 'Calcul du niveau national…', 'Computing the national level…')}</p>`
      + (fresh ? `<div class="fmk-fresh"><span>${fresh}</span></div>` : '')
      + `</header>`;
  }
  const driver = model.driver ? `<span class="fmk-driver">${escapeHtml(model.driver)}</span>` : '';
  const zones = SCALE_ZONES.map((z) => `<i style="flex:${z.width};background:${levelColorVar(z.level)}"></i>`).join('');
  const ticks = SCALE_TICKS.map((v) => `<span style="left:${v}%">${v}</span>`).join('');
  const marker = Math.max(0, Math.min(100, score.value));
  const pillars = score.pillars
    .map((p) => meterRow({ label: p.label, value: p.value, level: p.level, extra: [p.delta, p.deduction] }))
    .join('');
  const scaleLabel = t(lang, `Indice ${score.value} sur 100 ; seuils 55, 70 et 85`, `Index ${score.value} out of 100; thresholds 55, 70 and 85`);
  return `<header class="fiche-head fmk-head">${title}`
    + `<div class="fmk-score"><span class="fmk-score-value fmk-num" style="color:${levelColorVar(score.level)}">${score.value}</span>`
    + `<span class="fmk-score-max fmk-num">/100</span>`
    + `<span class="fmk-score-level">${renderVigilancePill(score.level, lang)}${driver}</span></div>`
    + `<div class="fmk-scale" role="img" aria-label="${escapeHtml(scaleLabel)}">`
    + `<div class="fmk-scale-zones">${zones}</div><span class="fmk-scale-marker" style="left:${marker}%"></span>`
    + `<div class="fmk-scale-ticks fmk-num" aria-hidden="true">${ticks}</div></div>`
    + `<div class="fmk-fresh"><span>${fresh ? `${fresh} · ` : ''}${t(lang, '24 h : ', '24 h: ')}${escapeHtml(score.delta24h)}</span>${score.sparkline}</div>`
    + `<div class="fmk-sub fmk-eyebrow">${t(lang, `Ce qui retire des points (base ${score.baseline})`, `What takes points off (baseline ${score.baseline})`)}</div>`
    + `<div class="fmk-meters fmk-meters--pillars">${pillars}</div>`
    + (score.factor ? `<p class="fmk-factor"><span class="fmk-muted">${t(lang, 'Facteur principal :', 'Main factor:')}</span> ${score.factor}</p>` : '')
    + (score.cap !== null
      ? `<p class="fmk-callout">${t(lang, `Plafonné à <b>${score.cap}</b> tant qu’une situation corrélée est active.`, `Capped at <b>${score.cap}</b> while a correlated situation is active.`)}</p>`
      : '')
    + `</header>`;
}

/** En-tête kit des fiches sans score : sur-titre, titre, pastille et contexte, synthèse. */
function renderKitHead(model: FicheModel, lang: Lang): string {
  const pill = model.level ? renderVigilancePill(model.level, lang) : '';
  const context = (model.context ?? []).map((c) => `<span>${escapeHtml(c)}</span>`).join('<span class="fmk-sep" aria-hidden="true">•</span>');
  return `<header class="fiche-head fmk-head">`
    + `<div class="fmk-eyebrow">${escapeHtml(model.kind)}</div>`
    + `<h2 class="fiche-name fmk-title" tabindex="-1">${escapeHtml(model.name)}</h2>`
    + (pill || context ? `<div class="fmk-level">${pill}${context}</div>` : '')
    + (model.lead ? `<p class="fmk-lead">${escapeHtml(model.lead)}</p>` : '')
    + `</header>`;
}

/** Section du kit (id présent) : repliable en <details>, sinon titre simple ; sans id : rendu historique. */
function renderSection(model: FicheModel, s: FicheSection): string {
  if (s.id === undefined) return part('fiche-extra', escapeHtml(s.title), s.html);
  const title = `<h3 class="fiche-part-title fmk-eyebrow">${escapeHtml(s.title)}</h3>`;
  const summary = s.summary ? `<span class="fmk-sum">${s.summary}</span>` : '';
  const key = escapeHtml(`${model.key}:${s.id}`);
  const cls = `fiche-part fmk-sec${s.tone === 'reference' ? ' fmk-sec--ref' : ''}`;
  if (s.collapsible) {
    return `<details class="${cls}" data-section="${key}"${s.open ? ' open' : ''}>`
      + `<summary class="fmk-sec-h">${title}${summary}${CHEVRON_SVG}</summary><div class="fmk-sec-body">${s.html}</div></details>`;
  }
  return `<section class="${cls}" data-section="${key}"><div class="fmk-sec-h">${title}${summary}</div>`
    + `<div class="fmk-sec-body">${s.html}</div></section>`;
}

/** Fiche complète : en-tête, sections du kit, actions. */
export function renderFiche(model: FicheModel, lang: Lang): string {
  const head = model.score !== undefined ? renderScoreHead(model, model.score, lang) : renderKitHead(model, lang);
  const sections = model.sections.map((s) => renderSection(model, s)).join('');
  const actions = model.actions.length > 0
    ? `<div class="fiche-actions">${model.actions
      .map((a) => `<button type="button" class="fiche-action" data-action="${escapeHtml(a.id)}">${escapeHtml(a.label)}</button>`).join('')}</div>`
    : '';
  return `<article class="fiche fmk" data-fiche="${escapeHtml(model.key)}">${head}${sections}${actions}</article>`;
}
