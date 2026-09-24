// src/components/fiche/france.ts — fiche « France », affichée quand rien n'est sélectionné en
// « Vue générale » (spec §6.3) : BLUF du brief en guise d'essentiel, jugements avec leurs preuves
// cliquables et leur confiance en mots, « À surveiller » du brief, changements depuis la visite,
// et dans « Pourquoi ce niveau ? » tout le contenu chiffré de l'ancien tiroir (spec §14).

import type { FranceCountrySnapshot, IntelEventsState, StructuredBrief } from '../../types/index.ts';
import type { StabilityPillarValues } from '../../utils/stability-history.ts';
import type { BriefSourceSituation } from '../../services/situation-brief.ts';
import { briefConfidenceLabel, eventLevel, levelLabel, scoreLevel } from '../../services/vigilance.ts';
import { drivenByText, type ThemeId } from '../../services/themes.ts';
import type { WorkQueue } from '../../services/work-queue.ts';
import { escapeHtml, formatAge, resolveEvidenceRef } from '../france-intel-events.ts';
import { renderWhyBody } from '../france-intel-score.ts';
import { renderDomainsBlock, renderEnergyBlock, renderTimelineBlock } from '../france-intel-blocks.ts';
import {
  digestChangeText,
  formatClock,
  labelled,
  parseTime,
  t,
  type FicheChange,
  type FicheFigure,
  type FicheModel,
  type FicheSource,
  type Lang,
} from './parts.ts';

/** Champs de l'instantané national lus par la fiche (App.ts passe l'instantané complet). */
export type FranceFicheSnapshot = Pick<
  FranceCountrySnapshot,
  'score' | 'scoreBreakdown' | 'situations' | 'signals' | 'meteo' | 'energy' | 'timeline'
>;

export interface FranceFicheInput {
  snapshot: FranceFicheSnapshot;
  queue: WorkQueue;
  /** Thèmes qui tirent le niveau (drivingThemes). */
  drivers: readonly ThemeId[];
  brief: { brief: StructuredBrief; freshness: 'fresh' | 'cached' } | null;
  /** Situations numérotées S1…S5 au moment du brief (briefSituationIds), jamais l'instantané courant. */
  briefSituationIds: readonly string[];
  /** null tant que les événements n'ont pas été chargés une première fois. */
  events: IntelEventsState | null;
  /** Situations vues dans les 24 h (historique) : celles qui ne sont plus actives sont « résolues ». */
  resolved: readonly BriefSourceSituation[];
  /** Heure d'apparition connue, par clé de liste. */
  changeTimes: ReadonlyMap<string, number>;
  score: { delta24h: number | null; pillarDeltas: StabilityPillarValues | null; series: number[] };
  freshness: string;
  whyOpen: boolean;
  lang: Lang;
  now: number;
}

const MAX_CHANGES = 12;

function evidenceKey(ref: string, input: FranceFicheInput): string | null {
  const target = resolveEvidenceRef(ref, input.briefSituationIds);
  if (!target) return null;
  return target.kind === 'event' ? `event:${target.id}` : `situation:${target.id}`;
}

function evidenceLabel(ref: string, input: FranceFicheInput): string {
  const target = resolveEvidenceRef(ref, input.briefSituationIds);
  if (target?.kind === 'event') {
    const event = input.events?.events.find((e) => e.id === target.id);
    return event ? `${ref} · ${event.title}` : ref;
  }
  if (target?.kind === 'situation') {
    const situation = input.snapshot.situations.find((s) => s.id === target.id);
    return situation ? `${ref} · ${situation.title}` : ref;
  }
  return ref;
}

function changesMeta(input: FranceFicheInput): string {
  const { lang, events } = input;
  if (events === null) return t(lang, 'Chargement de l’historique…', 'Loading history…');
  if (events.unavailable && events.events.length === 0) {
    return t(lang,
      'Historique serveur indisponible : les événements reviendront au prochain rafraîchissement.',
      'Server history unavailable: events will return on the next refresh.');
  }
  if (events.anchor.kind === 'default') return t(lang, 'Première visite : dernières 24 h', 'First visit: last 24 h');
  const clock = formatClock(events.anchor.since, lang);
  const ago = formatAge(new Date(events.anchor.since).toISOString(), input.now, lang);
  return t(lang, `Depuis votre visite de ${clock} (${ago})`, `Since your visit at ${clock} (${ago})`);
}

function franceChanges(input: FranceFicheInput): FicheChange[] {
  const { lang } = input;
  const changes: FicheChange[] = [];
  for (const item of input.queue.items) {
    // Les événements viennent du fil serveur ci-dessous, avec leur heure.
    if (item.badge === null || item.ref.kind === 'event') continue;
    const text = item.badge === 'nouveau'
      ? labelled(lang, 'Nouveau', 'New', item.title)
      : labelled(lang, 'Aggravé', 'Escalated', item.title);
    changes.push({ at: input.changeTimes.get(item.key) ?? null, text, select: item.key });
  }
  for (const d of input.events?.digest ?? []) {
    changes.push({ at: parseTime(d.latestAt), text: digestChangeText(d, lang), select: `event:${d.event.id}` });
  }
  // §14 : les convergences résolues dans les 24 h restent visibles ici.
  const active = new Set(input.snapshot.situations.map((s) => s.id));
  for (const r of input.resolved) {
    if (active.has(r.id)) continue;
    changes.push({ at: r.since, text: labelled(lang, 'Résolue', 'Resolved', r.title), select: null });
  }
  // Heure inconnue d'abord (changé depuis la visite, heure non mesurée), puis du plus récent au plus ancien.
  const rank = (at: number | null): number => at ?? Number.MAX_SAFE_INTEGER;
  return changes.sort((a, b) => rank(b.at) - rank(a.at)).slice(0, MAX_CHANGES);
}

function judgmentsHtml(brief: StructuredBrief, input: FranceFicheInput): string {
  const { lang } = input;
  const rows = brief.judgments.map((j) => {
    const refs = j.evidence.map((ref) => {
      const key = evidenceKey(ref, input);
      const label = escapeHtml(ref);
      return key
        ? `<button type="button" class="fiche-ref fiche-link" data-select="${escapeHtml(key)}">${label}</button>`
        : `<span class="fiche-ref">${label}</span>`;
    }).join(' ');
    const unsupported = j.unsupported ? `${t(lang, 'Non étayé', 'Unsupported')} · ` : '';
    return `<li class="fiche-judgment"><p>${escapeHtml(j.text)}</p>`
      + `<div class="fiche-judgment-foot">${refs}<span class="fiche-conf">${unsupported}${briefConfidenceLabel(j.confidence, lang)}</span></div></li>`;
  }).join('');
  return `<ul class="fiche-list">${rows}</ul>`;
}

function franceSources(brief: StructuredBrief, input: FranceFicheInput): FicheSource[] {
  const out: FicheSource[] = [];
  const seen = new Set<string>();
  for (const ref of brief.judgments.flatMap((j) => j.evidence)) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    out.push({ label: evidenceLabel(ref, input), href: null, select: evidenceKey(ref, input) });
  }
  for (const name of brief.judgments.flatMap((j) => j.sources)) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ label: name, href: null, select: null });
  }
  return out;
}

/** §14 : la liste complète des événements consolidés ouverts (l'ancienne section du tiroir). */
function allEventsHtml(input: FranceFicheInput): string {
  const { lang } = input;
  const events = input.events?.events ?? [];
  if (events.length === 0) return '';
  const rows = events.map((e) => {
    const sources = e.independentCount >= 2
      ? t(lang, `${e.independentCount} sources indép.`, `${e.independentCount} independent sources`)
      : t(lang, 'source unique', 'single source');
    return `<li><button type="button" class="fiche-link" data-select="event:${e.id}">${escapeHtml(e.evidenceId)} · ${escapeHtml(e.title)}</button>`
      + ` <span class="fiche-meta">${levelLabel(eventLevel(e.severity), lang)} · ${sources}</span></li>`;
  }).join('');
  return `<h4 class="fiche-why-title">${t(lang, 'Événements consolidés ouverts', 'Open consolidated events')} (${events.length})</h4><ul class="fiche-list">${rows}</ul>`;
}

function briefOrigin(brief: FranceFicheInput['brief'], lang: Lang): string {
  if (!brief) return '';
  const text = brief.brief.origin === 'llm'
    ? `${t(lang, 'Brief : IA', 'Brief: AI')}, ${brief.freshness === 'fresh' ? t(lang, 'à jour', 'fresh') : t(lang, 'en cache', 'cached')}`
    : t(lang, 'Brief : synthèse automatique', 'Brief: automatic synthesis');
  return `<p class="fiche-meta">${text}</p>`;
}

export function buildFranceFiche(input: FranceFicheInput): FicheModel {
  const { snapshot, lang } = input;
  const brief = input.brief?.brief ?? null;
  const figures: FicheFigure[] = [
    { label: t(lang, 'Situations actives', 'Active situations'), value: String(snapshot.situations.length) },
    { label: t(lang, 'Éléments à traiter', 'Items to handle'), value: String(input.queue.items.length) },
  ];
  if (input.queue.eventsStatus === 'ok' && input.events) {
    figures.push({ label: t(lang, 'Événements ouverts', 'Open events'), value: String(input.events.events.length) });
  }
  const why = [
    renderWhyBody({
      breakdown: snapshot.scoreBreakdown,
      delta24h: input.score.delta24h,
      pillarDeltas: input.score.pillarDeltas,
      series: input.score.series,
      lang,
    }),
    // Le baromètre des infrastructures (et son infobulle) est un composant vivant : App.ts l'y rattache.
    '<div class="fiche-infra-slot"></div>',
    renderDomainsBlock(snapshot, lang),
    renderEnergyBlock(snapshot.energy, lang),
    renderTimelineBlock(snapshot.timeline, lang),
    allEventsHtml(input),
    briefOrigin(input.brief, lang),
  ].join('');
  return {
    key: 'france',
    kind: t(lang, 'Pays', 'Country'),
    name: 'France',
    level: scoreLevel(snapshot.score),
    driver: drivenByText(input.drivers, lang),
    freshness: input.freshness,
    essentiel: brief ? [brief.bluf] : [t(lang, 'Synthèse nationale en cours de préparation…', 'National summary being prepared…')],
    changesMeta: changesMeta(input),
    changes: franceChanges(input),
    sections: brief && brief.judgments.length > 0
      ? [{ title: t(lang, 'Jugements', 'Judgments'), html: judgmentsHtml(brief, input) }]
      : [],
    figures,
    watch: (brief?.watch ?? []).map((w) => ({ text: w.text, horizon: w.horizon.replace('h', ' h') })),
    sourcesTitle: t(lang, 'Preuves et sources', 'Evidence and sources'),
    sources: brief ? franceSources(brief, input) : [],
    why,
    whyOpen: input.whyOpen,
    actions: [
      { id: 'show-france', label: t(lang, 'Voir sur la carte', 'Show on map') },
      { id: 'report', label: t(lang, 'Note de situation', 'Situation report') },
    ],
  };
}
