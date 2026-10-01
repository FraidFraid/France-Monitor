// src/components/fiche/france.ts — fiche « France » (spec §6.3), affichée quand rien n'est sélectionné :
// en-tête « Instrument » (indice, piliers, facteur dominant), puis sections résumées et repliables du
// kit fmk (situations, note de situation, changements depuis la visite, indicateurs, preuves et sources) ;
// plus de volet « Pourquoi ce niveau ? » (spec 2026-10-01).

import type { FranceCountrySnapshot, IntelEventsState, StructuredBrief } from '../../types/index.ts';
import type { StabilityPillarValues } from '../../utils/stability-history.ts';
import type { BriefSourceSituation } from '../../services/situation-brief.ts';
import { LEVEL_RANK, briefConfidenceLabel, confidenceLabel, eventLevel, levelLabel, scoreLevel, situationLevel, type VigilanceLevel } from '../../services/vigilance.ts';
import { dataDateLabel, freshnessOf } from '../../services/freshness.ts';
import { drivenByText, type ThemeId } from '../../services/themes.ts';
import type { WorkQueue } from '../../services/work-queue.ts';
import { escapeHtml, formatAge, resolveEvidenceRef } from '../france-intel-events.ts';
import { PILLAR_UI, dominantFactorText, formatDelta, pillarLevel, renderSparkline } from '../france-intel-score.ts';
import type { InfraInput } from '../../services/infra-continuity.ts';
import { domainsSection, energySection, fuelSection, infraSection, timelineSection, type IndicatorSection } from './france-indicators.ts';
import { renderVigilancePill } from '../shared/vigilancePill.ts';
import {
  digestChangeText,
  formatClock,
  labelled,
  parseTime,
  renderChangeRows,
  renderSourceChips,
  t,
  type FicheChange,
  type FicheScore,
  type FicheSection,
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
  /** Heure de réception et niveau national au moment de la note ; null tant qu'aucune note n'est arrivée. */
  briefMeta: { at: number; level: VigilanceLevel } | null;
  freshness: string;
  /** Baromètre des infrastructures (null tant qu'App ne l'a pas reçu). */
  infra: InfraInput | null;
  /** Ouverture retenue par id de section (« note », « infra »…) ; absente → valeur par défaut. */
  sectionOpen: ReadonlyMap<string, boolean>;
  /**
   * Couches critiques chargées. Avant, l'indice est calculé sur des données absentes : ni indice,
   * ni jauge, ni piliers dans le volet (relecture finale m1).
   */
  ready: boolean;
  lang: Lang;
  now: number;
}

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

const MAX_ETAT_CHANGES = 5;

interface EtatChange extends FicheChange {
  kind: 'nouveau' | 'aggrave' | 'resolu' | 'autre';
  /** Orange ou rouge, ou situation résolue : affiché dans l'onglet État. */
  important: boolean;
}

function allChanges(input: FranceFicheInput): EtatChange[] {
  const { lang } = input;
  const out: EtatChange[] = [];
  // Même ensemble que le fil (relecture finale I5) : un événement du résumé serveur n'est compté que
  // s'il est une ligne de la liste (règle d'entrée, hors étranger).
  const listed = new Set(input.queue.items.map((i) => i.key));
  for (const item of input.queue.items) {
    if (item.badge === null || item.ref.kind === 'event') continue;
    const text = item.badge === 'nouveau'
      ? labelled(lang, 'Nouveau', 'New', item.title)
      : labelled(lang, 'Aggravé', 'Escalated', item.title);
    out.push({
      at: input.changeTimes.get(item.key) ?? null, text, select: item.key,
      kind: item.badge, important: LEVEL_RANK[item.level] >= LEVEL_RANK.orange,
    });
  }
  for (const d of input.events?.digest ?? []) {
    if (!listed.has(`event:${d.event.id}`)) continue;
    const kind = d.kinds.includes('created') ? 'nouveau'
      : d.kinds.includes('escalated') || d.kinds.includes('reopened') ? 'aggrave' : 'autre';
    out.push({
      at: parseTime(d.latestAt), text: digestChangeText(d, lang), select: `event:${d.event.id}`,
      kind, important: LEVEL_RANK[eventLevel(d.event.severity)] >= LEVEL_RANK.orange,
    });
  }
  const active = new Set(input.snapshot.situations.map((s) => s.id));
  for (const r of input.resolved) {
    if (active.has(r.id)) continue;
    out.push({ at: r.since, text: labelled(lang, 'Résolue', 'Resolved', r.title), select: null, kind: 'resolu', important: true });
  }
  const rank = (at: number | null): number => at ?? Number.MAX_SAFE_INTEGER;
  return out.sort((a, b) => rank(b.at) - rank(a.at));
}

function totalsText(changes: readonly EtatChange[], lang: Lang): string {
  const count = (kind: EtatChange['kind']): number => changes.filter((c) => c.kind === kind).length;
  const parts: string[] = [];
  const n = count('nouveau');
  const a = count('aggrave');
  const r = count('resolu');
  if (n > 0) parts.push(lang === 'fr' ? `${n} nouveau${n > 1 ? 'x' : ''}` : `${n} new`);
  if (a > 0) parts.push(lang === 'fr' ? `${a} aggravé${a > 1 ? 's' : ''}` : `${a} escalated`);
  if (r > 0) parts.push(lang === 'fr' ? `${r} résolu${r > 1 ? 's' : ''}` : `${r} resolved`);
  return parts.join(' · ');
}

/** « Depuis votre dernière visite » : ancre et totaux, puis 5 changements orange ou rouges au plus. */
export function franceChangeDigest(input: FranceFicheInput): { meta: string; rows: FicheChange[] } {
  const all = allChanges(input);
  // Première visite (ancre par défaut) : « dernières 24 h » sans totaux — ils comptent depuis une visite qui n'a pas eu lieu.
  const totals = input.events?.anchor.kind === 'default' ? '' : totalsText(all, input.lang);
  const meta = totals ? `${changesMeta(input)} — ${totals}` : changesMeta(input);
  const rows = all.filter((c) => c.important).slice(0, MAX_ETAT_CHANGES).map(({ at, text, select }) => ({ at, text, select }));
  return { meta, rows };
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

function situationsHtml(input: FranceFicheInput): string {
  const { lang } = input;
  return input.snapshot.situations.map((s) => `<li class="fiche-situation">`
    + `<button type="button" class="fiche-link" data-select="situation:${escapeHtml(s.id)}">${renderVigilancePill(situationLevel(s.severity), lang)} ${escapeHtml(s.title)}</button>`
    + ` <span class="fiche-meta">${confidenceLabel(s.confidence, lang)}</span></li>`).join('');
}

/** Résumé de la note : origine, heure de rédaction, niveau de rédaction s'il diffère ; grisé si périmée. */
function noteSummary(input: FranceFicheInput): string {
  const { lang } = input;
  if (!input.brief) return escapeHtml(t(lang, 'en préparation', 'in preparation'));
  const origin = input.brief.brief.origin === 'llm'
    ? (input.brief.freshness === 'fresh' ? t(lang, 'IA', 'AI') : t(lang, 'IA, en cache', 'AI, cached'))
    : t(lang, 'Synthèse automatique', 'Automatic synthesis');
  const parts = [origin];
  const meta = input.briefMeta;
  if (meta) parts.push(t(lang, `rédigée ${formatClock(meta.at, lang)}`, `written ${formatClock(meta.at, lang)}`));
  if (meta && input.ready && meta.level !== scoreLevel(input.snapshot.score)) {
    parts.push(t(lang, `au niveau ${levelLabel(meta.level, lang).toLowerCase()}`, `at ${levelLabel(meta.level, lang).toLowerCase()} level`));
  }
  const text = escapeHtml(parts.join(' · '));
  return freshnessOf(meta?.at ?? null, 'brief', input.now) === 'fresh' ? text : `<span class="fmk-stale">${text}</span>`;
}

function noteHtml(input: FranceFicheInput): string {
  const { lang } = input;
  const brief = input.brief?.brief ?? null;
  if (!brief) return `<p>${t(lang, 'Synthèse nationale en cours de préparation…', 'National summary being prepared…')}</p>`;
  const watch = brief.watch.length > 0
    ? `<div class="fmk-sub fmk-eyebrow">${t(lang, 'À surveiller', 'Watch')}</div><ul class="fiche-list fmk-watch">${brief.watch
      .map((w) => `<li><span class="fiche-horizon">${escapeHtml(w.horizon.replace('h', ' h'))}</span> ${escapeHtml(w.text)}</li>`).join('')}</ul>`
    : '';
  const judgments = brief.judgments.length > 0 ? judgmentsHtml(brief, input) : '';
  const body = `<p class="fmk-bluf"><b>${t(lang, 'En bref :', 'Bottom line:')}</b> ${escapeHtml(brief.bluf)}</p>${judgments}${watch}`;
  const at = input.briefMeta?.at ?? null;
  if (freshnessOf(at, 'brief', input.now) === 'fresh') return body;
  return `<div class="fiche-stale"><p class="fiche-meta">${escapeHtml(dataDateLabel(at, lang))}</p>${body}</div>`;
}

function changesHtml(input: FranceFicheInput): string {
  const { meta, rows } = franceChangeDigest(input);
  const list = renderChangeRows(rows, input.lang, input.now);
  return `<div class="fiche-meta">${escapeHtml(meta)}</div>${list || `<p class="fiche-empty">${t(input.lang, 'Aucun changement orange ou rouge.', 'No orange or red change.')}</p>`}`;
}

function changesSummary(input: FranceFicheInput): string {
  const { lang } = input;
  if (input.events === null) return escapeHtml(t(lang, 'chargement…', 'loading…'));
  const n = allChanges(input).filter((c) => c.important).length;
  if (n === 0) return escapeHtml(t(lang, 'aucun changement orange ou rouge', 'no orange or red change'));
  return escapeHtml(lang === 'fr'
    ? `${n} changement${n > 1 ? 's' : ''} orange ou rouge${n > 1 ? 's' : ''}`
    : `${n} orange or red change${n > 1 ? 's' : ''}`);
}

function sourcesSummary(sources: readonly FicheSource[], lang: Lang): string {
  const evidence = sources.filter((s) => s.select !== null).length;
  const named = sources.length - evidence;
  const parts: string[] = [];
  if (evidence > 0) parts.push(lang === 'fr' ? `${evidence} preuve${evidence > 1 ? 's' : ''}` : `${evidence} evidence`);
  if (named > 0) parts.push(`${named} source${named > 1 ? 's' : ''}`);
  return escapeHtml(parts.join(' · '));
}

function formatDeduction(value: number, lang: Lang): string {
  return `−${value.toLocaleString(lang === 'fr' ? 'fr-FR' : 'en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
}

function franceScore(input: FranceFicheInput): FicheScore {
  const { snapshot, lang } = input;
  const bd = snapshot.scoreBreakdown;
  const level = scoreLevel(snapshot.score);
  const pillars = PILLAR_UI.flatMap((ui) => {
    const p = bd.pillars.find((x) => x.key === ui.key);
    if (!p) return [];
    const delta = input.score.pillarDeltas ? input.score.pillarDeltas[ui.key] : null;
    return [{ label: t(lang, ui.fr, ui.en), value: p.value, level: pillarLevel(p.value), delta: formatDelta(delta), deduction: formatDeduction(p.deduction, lang) }];
  });
  return {
    value: snapshot.score, level, baseline: bd.baseline, delta24h: formatDelta(input.score.delta24h),
    sparkline: renderSparkline(input.score.series, level, lang), pillars,
    factor: dominantFactorText(bd, lang), cap: bd.situationCap,
  };
}

export function buildFranceFiche(input: FranceFicheInput): FicheModel {
  const { snapshot, lang } = input;
  const brief = input.brief?.brief ?? null;
  const n = snapshot.situations.length;
  const count = lang === 'fr' ? `${n} situation${n > 1 ? 's' : ''} active${n > 1 ? 's' : ''}` : `${n} active situation${n === 1 ? '' : 's'}`;
  const open = (id: string, byDefault: boolean): boolean => input.sectionOpen.get(id) ?? byDefault;
  const situations = situationsHtml(input);
  const indicators = [
    infraSection(input.infra, lang),
    domainsSection(snapshot, lang),
    energySection(snapshot.energy, lang),
    fuelSection(snapshot.energy, lang),
    timelineSection(snapshot.timeline, lang),
  ].filter((s): s is IndicatorSection => s !== null);
  const sources = brief ? franceSources(brief, input) : [];
  const sections: FicheSection[] = [
    {
      id: 'situations', title: t(lang, 'Situations actives', 'Active situations'), summary: String(n), collapsible: false,
      html: situations ? `<ul class="fiche-list">${situations}</ul>` : `<p class="fmk-muted">${t(lang, 'Aucune situation active.', 'No active situation.')}</p>`,
    },
    { id: 'note', title: t(lang, 'Note de situation', 'Situation note'), summary: noteSummary(input), html: noteHtml(input), collapsible: true, open: open('note', true) },
    {
      id: 'changes', title: t(lang, 'Depuis votre dernière visite', 'Since your last visit'), summary: changesSummary(input),
      html: changesHtml(input), collapsible: true, open: open('changes', false),
    },
    ...indicators.map((s) => ({ ...s, collapsible: true, open: open(s.id, false) })),
    ...(sources.length > 0
      ? [{ id: 'sources', title: t(lang, 'Preuves et sources', 'Evidence and sources'), summary: sourcesSummary(sources, lang), html: renderSourceChips(sources), collapsible: true, open: open('sources', false) }]
      : []),
  ];
  return {
    key: 'france',
    kind: t(lang, 'État de la France', 'State of France'),
    name: 'France',
    level: scoreLevel(snapshot.score),
    driver: drivenByText(input.drivers, lang),
    freshness: [count, `MAJ ${formatClock(input.now, lang)}`, input.freshness].filter(Boolean).join(' · '),
    essentiel: [],
    changesMeta: '',
    changes: [],
    sections,
    figures: [],
    watch: [],
    sourcesTitle: t(lang, 'Preuves et sources', 'Evidence and sources'),
    sources: [],
    why: '',
    whyOpen: false,
    score: input.ready ? franceScore(input) : 'pending',
    actions: [
      { id: 'show-france', label: t(lang, 'Voir sur la carte', 'Show on map') },
      { id: 'report', label: t(lang, 'Note de situation', 'Situation report') },
    ],
  };
}
