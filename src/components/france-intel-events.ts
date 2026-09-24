// src/components/france-intel-events.ts — rendu HTML des sections « Depuis votre dernière
// visite » et « Événements consolidés » du panneau Intelligence France.
//
// Fonctions pures (chaînes HTML, aucun accès au DOM) : testables sous Node. Titres et liens
// viennent de flux RSS tiers : tout est échappé, et seuls les liens http(s) sont cliquables.

import type {
  ChangeDigestItem,
  IntelEventsState,
  NewsEvent,
  NewsEventChangeKind,
  NewsEventDetail,
  NewsEventStatus,
  ThreatLevel,
} from '../types/index.ts';
import { eventLevel, levelColorVar, levelLabel } from '../services/vigilance.ts';

type Lang = 'fr' | 'en';
export type EventDetailState = NewsEventDetail | 'loading' | 'error';
export interface SectionHtml {
  meta: string;
  body: string;
}

const MAX_DIGEST_ROWS = 8;
const MAX_EVENT_ROWS = 12;
const MAX_LOG_ROWS = 5;

function t(lang: Lang, fr: string, en: string): string {
  return lang === 'fr' ? fr : en;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Lien cliquable seulement s'il est http(s) : un flux ne doit pas pouvoir injecter javascript:. */
export function safeHref(link: string): string | null {
  return /^https?:\/\//i.test(link.trim()) ? escapeHtml(link.trim()) : null;
}

const STATUS_LABEL: Record<NewsEventStatus, { fr: string; en: string }> = {
  active: { fr: 'actif', en: 'active' },
  cooling: { fr: 'refroidit', en: 'cooling' },
  closed: { fr: 'clos', en: 'closed' },
};

const KIND_LABEL: Record<NewsEventChangeKind, { fr: string; en: string }> = {
  created: { fr: 'nouveaux', en: 'new' },
  escalated: { fr: 'aggravés', en: 'escalated' },
  corroborated: { fr: 'corroborés', en: 'corroborated' },
  reopened: { fr: 'rouverts', en: 'reopened' },
  deescalated: { fr: 'atténués', en: 'de-escalated' },
  cooling: { fr: 'en refroidissement', en: 'cooling' },
  closed: { fr: 'clos', en: 'closed' },
};

/** Libellé d'une entrée du journal d'un événement (singulier, contrairement aux totaux). */
const LOG_LABEL: Record<NewsEventChangeKind, { fr: string; en: string }> = {
  created: { fr: 'créé', en: 'created' },
  escalated: { fr: 'aggravé', en: 'escalated' },
  corroborated: { fr: 'corroboré', en: 'corroborated' },
  reopened: { fr: 'rouvert', en: 'reopened' },
  deescalated: { fr: 'atténué', en: 'de-escalated' },
  cooling: { fr: 'en refroidissement', en: 'cooling' },
  closed: { fr: 'clos', en: 'closed' },
};

const TOTALS_ORDER: NewsEventChangeKind[] = ['created', 'escalated', 'corroborated', 'reopened', 'closed'];

const SEVERITIES: readonly ThreatLevel[] = ['critical', 'high', 'medium', 'low', 'info'];

function severityLabel(value: string | null, lang: Lang): string {
  const known = SEVERITIES.find((s) => s === value);
  return known ? levelLabel(eventLevel(known), lang).toLowerCase() : escapeHtml(value ?? '?');
}

function hhmm(iso: string | number, lang: Lang): string {
  return new Date(iso).toLocaleTimeString(lang === 'fr' ? 'fr-FR' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
}

export function formatAge(iso: string, now: number, lang: Lang): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return t(lang, `il y a ${minutes} min`, `${minutes} min ago`);
  const hours = Math.round(minutes / 60);
  if (hours < 48) return t(lang, `il y a ${hours} h`, `${hours} h ago`);
  const days = Math.round(hours / 24);
  return t(lang, `il y a ${days} j`, `${days} d ago`);
}

function chip(text: string, tone: '' | 'warn' | 'crit' | 'zone' = ''): string {
  return `<span class="frintel-chip${tone ? ` frintel-chip-${tone}` : ''}">${text}</span>`;
}

function kindChip(item: ChangeDigestItem, kind: NewsEventChangeKind, lang: Lang): string {
  switch (kind) {
    case 'escalated':
      return chip(`${t(lang, 'Aggravé', 'Escalated')} ${severityLabel(item.severityFrom, lang)} → ${severityLabel(item.event.severity, lang)}`, 'crit');
    case 'created':
      return chip(t(lang, 'Nouveau', 'New'), 'warn');
    case 'corroborated':
      return chip(`${t(lang, 'Corroboré', 'Corroborated')} ${item.independentFrom ?? '?'} → ${item.event.independentCount}`, 'zone');
    case 'reopened':
      return chip(t(lang, 'Rouvert', 'Reopened'), 'warn');
    case 'deescalated':
      return chip(t(lang, 'Atténué', 'De-escalated'));
    case 'closed':
      return chip(t(lang, 'Clos', 'Closed'));
    case 'cooling':
      return chip(t(lang, 'Refroidit', 'Cooling'));
  }
}

function corroborationChip(e: NewsEvent, lang: Lang): string {
  if (e.independentCount >= 2) {
    return chip(t(lang, `${e.sourceCount} sources · ${e.independentCount} indépendantes`, `${e.sourceCount} sources · ${e.independentCount} independent`), 'zone');
  }
  return e.sourceCount > 1
    ? chip(t(lang, `${e.sourceCount} titres · même groupe`, `${e.sourceCount} outlets · same group`), 'warn')
    : chip(t(lang, 'Source unique', 'Single source'), 'warn');
}

function renderDetail(detail: EventDetailState, lang: Lang): string {
  if (detail === 'loading') return `<div class="frintel-ev-detail frintel-empty">${t(lang, 'Chargement des articles…', 'Loading articles…')}</div>`;
  if (detail === 'error') return `<div class="frintel-ev-detail frintel-empty">${t(lang, 'Articles indisponibles pour le moment.', 'Articles unavailable right now.')}</div>`;
  const articles = detail.articles.map((a) => {
    const href = safeHref(a.link);
    const title = escapeHtml(a.title);
    const source = `${escapeHtml(a.feedName ?? '—')}${a.publishedAt ? ` · ${hhmm(a.publishedAt, lang)}` : ''}`;
    return `<li><span class="frintel-ev-src">${source}</span>${href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${title}</a>` : title}</li>`;
  }).join('');
  const log = detail.log.slice(0, MAX_LOG_ROWS).map((l) => {
    const isSeverity = l.kind === 'created' || l.kind === 'escalated' || l.kind === 'deescalated';
    const value = (v: string | null): string => (isSeverity ? severityLabel(v, lang) : escapeHtml(v ?? '?'));
    const change = l.from !== null && l.to !== null
      ? ` ${value(l.from)} → ${value(l.to)}`
      : l.to !== null ? ` · ${value(l.to)}` : '';
    return `<div>${hhmm(l.at, lang)} · ${LOG_LABEL[l.kind][lang]}${change}</div>`;
  }).join('');
  return `<div class="frintel-ev-detail"><ul>${articles}</ul>${log ? `<div class="frintel-ev-log">${log}</div>` : ''}</div>`;
}

export function renderEventRow(e: NewsEvent, lang: Lang, now: number, detail: EventDetailState | undefined, leadingChips = ''): string {
  return `
    <article class="frintel-ev${detail ? ' is-expanded' : ''}" data-event-id="${e.id}">
      <button type="button" class="frintel-ev-head" aria-expanded="${detail ? 'true' : 'false'}">
        <span class="frintel-ev-dot" style="background:${levelColorVar(eventLevel(e.severity))}"></span>
        <span class="frintel-ev-title">${escapeHtml(e.title)}</span>
      </button>
      <div class="frintel-sit-tags">
        ${leadingChips}
        ${chip(e.evidenceId)}
        ${chip(escapeHtml(e.category))}
        ${corroborationChip(e, lang)}
        ${chip(STATUS_LABEL[e.status][lang])}
        <span class="frintel-ev-age">${formatAge(e.lastSeen, now, lang)}</span>
      </div>
      ${detail ? renderDetail(detail, lang) : ''}
    </article>
  `;
}

export type EvidenceTarget = { kind: 'event'; id: number } | { kind: 'situation'; id: string };

/**
 * Cible d'une preuve citée : E<id> → événement ; S<n> → n-ième situation parmi celles
 * figées au moment du brief (briefSituationIds), jamais l'instantané courant.
 */
export function resolveEvidenceRef(ref: string, situationIds: readonly string[]): EvidenceTarget | null {
  const event = /^E(\d{1,12})$/.exec(ref);
  if (event) return { kind: 'event', id: Number(event[1]) };
  const situation = /^S(\d{1,2})$/.exec(ref);
  const id = situation ? situationIds[Number(situation[1]) - 1] : undefined;
  return id === undefined ? null : { kind: 'situation', id };
}

/**
 * État « historique indisponible » quand les modules d'événements n'ont pas pu être chargés
 * (chunk en échec) : les deux sections le disent, au lieu d'un chargement sans fin.
 */
export function unavailableEventsState(now: number): IntelEventsState {
  return { events: [], digest: [], totals: {}, anchor: { since: now - 24 * 60 * 60 * 1000, kind: 'default' }, fetchedAt: now, unavailable: true };
}

const UNAVAILABLE = (lang: Lang): string => `<div class="frintel-empty">${t(lang,
  'Historique serveur indisponible : ce fil reviendra au prochain rafraîchissement.',
  'Server history unavailable: this feed will return on the next refresh.')}</div>`;

export function renderChangesSection(
  state: IntelEventsState | null,
  lang: Lang,
  now: number,
  details: ReadonlyMap<number, EventDetailState>,
): SectionHtml {
  if (!state) return { meta: t(lang, 'Chargement…', 'Loading…'), body: '' };
  const meta = state.anchor.kind === 'last-visit'
    ? t(lang, `depuis ${hhmm(state.anchor.since, lang)} · ${formatAge(new Date(state.anchor.since).toISOString(), now, lang)}`,
      `since ${hhmm(state.anchor.since, lang)} · ${formatAge(new Date(state.anchor.since).toISOString(), now, lang)}`)
    : t(lang, 'première visite · dernières 24 h', 'first visit · last 24 h');
  if (state.unavailable) return { meta, body: UNAVAILABLE(lang) };
  const totals = TOTALS_ORDER
    .filter((k) => (state.totals[k] ?? 0) > 0)
    .map((k) => `${state.totals[k]} ${KIND_LABEL[k][lang]}`)
    .join(' · ');
  const rows = state.digest.slice(0, MAX_DIGEST_ROWS)
    .map((item) => renderEventRow(item.event, lang, now, details.get(item.event.id), item.kinds.map((k) => kindChip(item, k, lang)).join('')))
    .join('');
  const body = `
    ${totals ? `<div class="frintel-changes-totals">${totals}</div>` : ''}
    ${rows || `<div class="frintel-empty">${t(lang, 'Aucune aggravation, corroboration ni événement grave nouveau.', 'No escalation, corroboration or new serious event.')}</div>`}
  `;
  return { meta, body };
}

/**
 * @param pinned  identifiants E… cités par le brief : toujours listés, même hors des 12 premiers,
 *                pour que chaque preuve citée soit consultable.
 */
export function renderEventsSection(
  state: IntelEventsState | null,
  lang: Lang,
  now: number,
  details: ReadonlyMap<number, EventDetailState>,
  pinned: ReadonlySet<string> = new Set(),
): SectionHtml {
  if (!state) return { meta: t(lang, 'Chargement…', 'Loading…'), body: '' };
  if (state.unavailable && state.events.length === 0) return { meta: '', body: UNAVAILABLE(lang) };
  const shown = state.events.slice(0, MAX_EVENT_ROWS);
  for (const e of state.events.slice(MAX_EVENT_ROWS)) if (pinned.has(e.evidenceId)) shown.push(e);
  const meta = t(lang, `${state.events.length} ouverts · MAJ ${hhmm(state.fetchedAt, lang)}`, `${state.events.length} open · updated ${hhmm(state.fetchedAt, lang)}`);
  const body = shown.length > 0
    ? shown.map((e) => renderEventRow(e, lang, now, details.get(e.id))).join('')
    : `<div class="frintel-empty">${t(lang, 'Aucun événement ouvert.', 'No open event.')}</div>`;
  return { meta, body };
}
