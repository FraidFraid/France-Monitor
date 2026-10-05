// src/components/fiche/items.ts — fiches thème, événement, situation, alerte, alerte officielle et
// marché (spec §6.3). Le §11 ne prévoyait à l'étape 2 que les fiches France, thème et événement ;
// les fiches situation et alerte sont livrées ici parce que la v2 retire SituationMonitor et
// AlertMonitor et que le §14 exige que leur détail reste accessible (arbitrage A1).

import type {
  ClassificationReason,
  DetectedSituation,
  EventTemporality,
  FranceCountrySnapshot,
  IntelEventsState,
  NewsEvent,
  NewsEventChangeKind,
  NewsEventDetail,
  SituationAction,
} from '../../types/index.ts';
import {
  MARKET_ALERT_THRESHOLD,
  confidenceLabel,
  eventDisplayLevel,
  eventLevel,
  formatSignedPct,
  levelLabel,
  levelPhrase,
  levelVigilanceWord,
  situationLevel,
  unconfirmedPeakLevel,
} from '../../services/vigilance.ts';
import { categoryTheme, situationTheme, themeLabel, type SpecificThemeId } from '../../services/themes.ts';
import {
  officialSourceName,
  officialTheme,
  officialTitle,
  type MarketLine,
  type OfficialAlertGroup,
  type OfficialSignal,
  type WorkBadge,
  type WorkQueue,
} from '../../services/work-queue.ts';
import { parseScoreLine, splitScoreLines, statusWordLevel, splitScoreSentences, splitZoneScore } from '../../services/situation-text.ts';
import { escapeHtml, safeHref, type EventDetailState } from '../france-intel-events.ts';
import { energySection, fuelSection } from './france-indicators.ts';
import { renderVigilancePill } from '../shared/vigilancePill.ts';
import { absoluteTime, intensityLevel, kvRow, levelDot, meterRow, stepCurve, type CurvePoint } from './kit.ts';
import {
  digestChangeText,
  formatNumber,
  labelled,
  nothingToHandleText,
  parseTime,
  renderChangeRows,
  renderSourceChips,
  severityWord,
  t,
  type FicheAction,
  type FicheChange,
  type FicheModel,
  type FicheSection,
  type FicheSource,
  type Lang,
} from './parts.ts';
import { renderNdPill } from '../layer-panel/frame.ts';
import type { NationalHealthSummary } from '../layer-panel/veille.ts';
import { MILITARY_FIGURE_LABEL, gnssPartialText } from '../../services/sovereignty-levels.ts';

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function plural(n: number): string {
  return n > 1 ? 's' : '';
}

/** Heure inconnue d'abord, puis du plus récent au plus ancien. */
function byTimeDesc(a: FicheChange, b: FicheChange): number {
  const rank = (at: number | null): number => at ?? Number.MAX_SAFE_INTEGER;
  return rank(b.at) - rank(a.at);
}

// ─── Thème ────────────────────────────────────────────────────────────────────────────────────

export interface ThemeFicheInput {
  theme: SpecificThemeId;
  queue: WorkQueue;
  snapshot: Pick<FranceCountrySnapshot, 'signals' | 'energy'>;
  events: IntelEventsState | null;
  changeTimes: ReadonlyMap<string, number>;
  freshness: string;
  sectionOpen: ReadonlyMap<string, boolean>;
  now: number;
  /** Couches critiques chargées : avant, « Chargement des données… », jamais « Rien à traiter » (relecture finale m1). */
  ready: boolean;
  lang: Lang;
  /** Fiche thème Santé (spec 2026-10-03 § 3.5) : niveau national et ses quatre entrées ; null tant que la veille n'est pas chargée. */
  health?: NationalHealthSummary | null;
}

function officialSignalText(o: OfficialSignal, lang: Lang): string {
  const word = levelLabel(o.level, lang).toLowerCase();
  if (o.source === 'ecowatt') return t(lang, `Écowatt : signal ${word} (national)`, `Ecowatt: ${word} signal (national)`);
  if (o.source === 'meteo') return t(lang, `Vigilance météo ${word}`, `Weather ${levelVigilanceWord(o.level, 'en')}`);
  return t(lang, `Vigicrues ${word}`, `Vigicrues ${word}`);
}

interface ThemeFigure {
  label: string;
  value: string;
}

/** Gros chiffre Défense (O9), même libellé que la légende et la tuile. */
const MILITARY_FIGURE_TITLE = `${MILITARY_FIGURE_LABEL.charAt(0).toUpperCase()}${MILITARY_FIGURE_LABEL.slice(1)}`;

function themeFigures(theme: SpecificThemeId, snapshot: ThemeFicheInput['snapshot'], lang: Lang): ThemeFigure[] {
  const s = snapshot.signals;
  switch (theme) {
    case 'energy':
      // Production, éolien et stocks sont portés par les sections énergie et carburants.
      return [];
    case 'security':
      // Souveraineté (spec 2026-10-04 souveraineté § 2.4 ; O1, O9) : source indisponible, « n.d. » (S3), jamais un « 0 » ; parts de la
      // Défense (aéronefs, câbles, grille GNSS) absentes ou en retard : « non évalué », une par une (disponibilité par partie, tâche B28).
      return [
        {
          label: t(lang, 'Alertes CERT-FR en cours', 'CERT-FR alerts in progress'),
          value: s.cyberUnavailable === true ? 'n.d.' : String(s.cyberOpenAlerts ?? s.cyberAlerts),
        },
        {
          label: t(lang, MILITARY_FIGURE_TITLE, 'Military or state aircraft visible on ADS-B over metropolitan France'),
          value: s.militaryUnavailable === true ? t(lang, 'non évalué', 'not assessed') : String(s.militaryFlights),
        },
        // Deux sources, deux lignes : une part non lue ne se cache jamais dans une somme (grille GNSS absente, en retard ou en
        // dégradation générale : « non évalué »).
        {
          // Navires distincts (FX2), pas des alertes : la veille en fait une par navire et par câble.
          label: t(lang, 'Navires lents confirmés sur un câble', 'Slow vessels confirmed on a cable'),
          value: s.cablesUnavailable === true ? t(lang, 'non évalué', 'not assessed') : String(s.defenseAlerts),
        },
        {
          label: t(lang, 'Mailles GNSS dégradées (24\u00a0h)', 'Degraded GNSS cells (24\u00a0h)'),
          value: s.gnssUnavailable === true ? t(lang, 'non évalué', 'not assessed')
            : `${s.jammingSignals}${s.gnssPartialHours !== undefined ? ` (${gnssPartialText(s.gnssPartialHours, lang)})` : ''}`,
        },
      ];
    case 'environment':
      return [
        // Source indisponible (S3) : « n.d. », jamais un « 0 ».
        { label: t(lang, 'Départements en vigilance orange ou rouge', 'Departments on orange or red'), value: s.vigilanceUnavailable === true ? 'n.d.' : String(s.meteoAlerts) },
        { label: t(lang, 'Tronçons en crue orange ou rouge', 'River sections on orange or red'), value: s.floodsUnavailable === true ? 'n.d.' : String(s.floodAlerts) },
        { label: t(lang, 'Foyers confirmés en France', 'Confirmed fires in France'), value: s.firesUnavailable === true ? 'n.d.' : String(s.fireFoyersConfirmed ?? 0) },
      ];
    case 'health':
      // Niveau national et entrées : section santé (healthIndicators), pas de chiffres isolés.
      return [];
  }
}

const HEALTH_PANELS: ReadonlyArray<readonly [string, string]> = [
  ['health', 'Veille sanitaire'], ['healthOscour', 'Urgences et SOS Médecins'], ['healthApl', 'Accès aux soins'], ['hospitals', 'Hôpitaux'],
];

/** Fiche thème Santé (spec 2026-10-03 § 3.5) : niveau national, ses quatre entrées datées, liens d'ouverture des quatre panneaux. */
function healthIndicators(summary: NationalHealthSummary | null, lang: Lang): string {
  // Liens au format de « open-cyber » (france-indicators.ts) : FichePanel route data-action vers PosteSituation.runAction.
  const links = `<div class="fmk-sub">${t(lang, 'Panneaux des couches', 'Layer panels')}</div><ul class="fiche-list">${HEALTH_PANELS.map(([key, label]) =>
    `<li><button type="button" class="fmk-link" data-action="open-layer:${key}">${escapeHtml(label)}</button></li>`).join('')}</ul>`;
  const title = `<div class="fmk-sub">${t(lang, 'Niveau national de santé', 'National health level')}</div>`;
  if (!summary) return `${title}<p class="fiche-empty">${t(lang, 'Données de santé en chargement…', 'Health data loading…')}</p>${links}`;
  const pill = summary.level === 'nd' ? renderNdPill() : renderVigilancePill(summary.level, lang);
  const rows = summary.inputs.map((i) => {
    const late = i.late ? t(lang, ' · en retard, écartée', ' · late, excluded')
      : i.unavailable ? t(lang, ' · source indisponible, écartée', ' · source unavailable, excluded') : '';
    return `<li>${levelDot(i.late || i.level === 'nd' ? null : i.level)}${escapeHtml(`${i.label} : ${i.value} · ${i.period}${late}`)}</li>`;
  }).join('');
  return `${title}<p>${pill} ${escapeHtml(summary.driverPhrase)}</p><ul class="fiche-list">${rows}</ul>${links}`;
}

export function buildThemeFiche(input: ThemeFicheInput): FicheModel {
  const { theme, queue, lang } = input;
  const items = queue.items.filter((i) => i.theme === theme);
  const official = queue.official.filter((o) => officialTheme(o.source) === theme);
  const raised = official.filter((o) => o.level !== 'vert');
  const reds = items.filter((i) => i.level === 'rouge').length;
  const n = items.length;

  const essentiel: string[] = n === 0
    ? [input.ready ? nothingToHandleText(queue.greenTracked[theme], lang) : t(lang, 'Chargement des données…', 'Loading data…')]
    : [
        t(lang,
          `${n} élément${plural(n)} à traiter${reds > 0 ? `, dont ${reds} rouge${plural(reds)}` : ''}.`,
          `${n} item${plural(n)} to handle${reds > 0 ? `, ${reds} red` : ''}.`),
        t(lang, `Le plus grave : ${items[0].title}.`, `Most severe: ${items[0].title}.`),
      ];
  for (const o of raised) essentiel.push(`${officialSignalText(o, lang)}.`);

  const changes: FicheChange[] = items
    .filter((i) => i.badge !== null && i.ref.kind !== 'event')
    .map((i) => ({
      at: input.changeTimes.get(i.key) ?? null,
      text: i.badge === 'nouveau' ? labelled(lang, 'Nouveau', 'New', i.title) : labelled(lang, 'Aggravé', 'Escalated', i.title),
      select: i.key,
    }));
  for (const d of input.events?.digest ?? []) {
    if (categoryTheme(d.event.category) !== theme) continue;
    changes.push({ at: parseTime(d.latestAt), text: digestChangeText(d, lang), select: `event:${d.event.id}` });
  }

  const labels = new Set<string>(official.map((o) => officialSourceName(o.source)));
  for (const i of items) {
    if (i.ref.kind === 'situation' || i.ref.kind === 'alert') {
      for (const ref of i.ref.situation.sourceRefs) labels.add(ref);
    }
  }

  const signalRows = official.map((o) => {
    const where = o.level === 'vert' ? '' : ` · ${o.places} ${t(lang, o.places > 1 ? 'lieux' : 'lieu', o.places > 1 ? 'places' : 'place')}`;
    return `<li>${renderVigilancePill(o.level, lang)} ${escapeHtml(officialSourceName(o.source))}${where}</li>`;
  }).join('');
  const itemRows = items.map((i) => `<li>${renderVigilancePill(i.level, lang)} ${escapeHtml(i.title)}</li>`).join('');

  const open = (id: string, byDefault: boolean): boolean => input.sectionOpen.get(id) ?? byDefault;
  const figures = themeFigures(theme, input.snapshot, lang).map((f) => kvRow(f.label, escapeHtml(f.value))).join('');
  const indicators = (figures ? `<div class="fmk-kvs">${figures}</div>` : '')
    + (signalRows ? `<div class="fmk-sub">${t(lang, 'Signaux officiels', 'Official signals')}</div><ul class="fiche-list">${signalRows}</ul>` : '')
    + (itemRows ? `<div class="fmk-sub">${t(lang, 'Éléments à traiter', 'Items to handle')}</div><ul class="fiche-list">${itemRows}</ul>` : '')
    + (theme === 'energy' ? energySection(input.snapshot.energy, lang).html + (fuelSection(input.snapshot.energy, lang)?.html ?? '') : '')
    + (theme === 'health' ? healthIndicators(input.health ?? null, lang) : '')
    + `<p class="fmk-note">${t(lang, 'Le niveau du thème est le plus élevé de ses signaux officiels et de ses éléments à traiter.', 'The theme level is the highest of its official signals and items to handle.')}</p>`;
  const sorted = changes.sort(byTimeDesc);
  const sections: FicheSection[] = [{ id: 'indicators', title: t(lang, 'Indicateurs', 'Indicators'), collapsible: true, open: open('indicators', true), html: indicators }];
  if (sorted.length > 0) {
    sections.push({
      id: 'evolution', title: t(lang, 'Évolution', 'Evolution'), collapsible: true, open: open('evolution', true),
      summary: escapeHtml(t(lang, `${sorted.length} changement${plural(sorted.length)}`, `${sorted.length} change${plural(sorted.length)}`)),
      html: renderChangeRows(sorted, lang, input.now),
    });
  }
  const sources = [...labels].slice(0, 8).map((label) => ({ label, href: null, select: null }));
  if (sources.length > 0) {
    sections.push({
      id: 'sources', title: t(lang, 'Sources', 'Sources'), collapsible: true, open: open('sources', false), tone: 'reference',
      summary: escapeHtml(`${sources.length} source${plural(sources.length)}`), html: renderSourceChips(sources),
    });
  }

  const driverText = n > 0 ? items[0].title : raised.length > 0 ? officialSignalText(raised[0], lang) : input.ready ? t(lang, 'rien à traiter', 'nothing to handle') : '';
  return {
    key: `theme:${theme}`,
    kind: t(lang, 'Thème', 'Theme'),
    name: themeLabel(theme, lang),
    level: queue.themeLevels[theme],
    driver: '',
    freshness: '',
    context: [driverText, input.freshness].filter(Boolean),
    lead: essentiel.slice(0, 3).join(' '),
    sections,
    actions: [{ id: 'show-theme', label: t(lang, 'Afficher sur la carte', 'Show on map') }],
  };
}

// ─── Événement consolidé ──────────────────────────────────────────────────────────────────────

export interface EventFicheInput {
  event: NewsEvent;
  /** Articles et journal, chargés à la demande (undefined tant que la demande n'est pas partie). */
  detail: EventDetailState | undefined;
  /** Département sous le point de l'événement (null si inconnu). */
  place: { code: string; nom: string } | null;
  /** Ouverture retenue par id de section pour les fiches événement. */
  sectionOpen: ReadonlyMap<string, boolean>;
  lang: Lang;
  now: number;
}

const LOG_LABEL: Record<NewsEventChangeKind, [string, string]> = {
  created: ['créé', 'created'],
  escalated: ['aggravé', 'escalated'],
  corroborated: ['corroboré', 'corroborated'],
  reopened: ['rouvert', 'reopened'],
  deescalated: ['atténué', 'de-escalated'],
  cooling: ['en refroidissement', 'cooling'],
  closed: ['clos', 'closed'],
};

function logText(entry: NewsEventDetail['log'][number], lang: Lang): string {
  const label = LOG_LABEL[entry.kind][lang === 'fr' ? 0 : 1];
  // Statuts (actif / cooling / closed) : le libellé français suffit, jamais « active → cooling ».
  if (entry.kind === 'cooling' || entry.kind === 'closed' || entry.kind === 'reopened') return label;
  const severity = entry.kind === 'created' || entry.kind === 'escalated' || entry.kind === 'deescalated';
  const value = (v: string): string => (severity ? severityWord(v, lang) ?? v : v);
  if (entry.from !== null && entry.to !== null) {
    const from = value(entry.from);
    const to = value(entry.to);
    // info et low partagent le vert L1 : juste le mot, pas de « vert → vert ».
    return from === to ? label : `${label} ${from} → ${to}`;
  }
  return entry.to !== null ? `${label} · ${value(entry.to)}` : label;
}

const REASON_LABEL: Record<ClassificationReason, [string, string]> = {
  declencheur_hors_titre: ['mot-clé présent seulement dans le résumé', 'keyword only in the summary'],
  metaphore: ['emploi figuré écarté (« séisme politique »)', 'figurative use ignored'],
  passe: ['procès, enquête ou rappel d’un fait passé', 'trial, inquiry or past event'],
  hypothetique: ['hypothèse, risque évoqué ou exercice', 'hypothesis, possible risk or drill'],
  etranger: ['à l’étranger, sans effet déclaré sur la France', 'abroad, no stated effect on France'],
  non_confirme: ['niveau le plus grave signalé par une seule source indépendante (à confirmer)', 'highest level reported by a single independent source (unconfirmed)'],
};
const TEMPORALITY_LABEL: Record<EventTemporality, [string, string]> = {
  en_cours: ['en cours', 'ongoing'], passe: ['fait passé', 'past event'], a_venir: ['hypothèse, à venir', 'hypothesis, upcoming'],
};

function confirmationText(e: NewsEvent, lang: Lang): string {
  const n = e.independentCount;
  if (n >= 2) return t(lang, `confirmé par ${n} groupes de presse indépendants`, `confirmed by ${n} independent press groups`);
  if (e.sourceCount > 1) return t(lang, `un seul groupe de presse (${e.sourceCount} titres)`, `a single press group (${e.sourceCount} outlets)`);
  return t(lang, 'source unique', 'single source');
}

type EventLog = NewsEventDetail['log'];

/** Journal du plus récent au plus ancien (heure inconnue en dernier). */
function sortedLog(log: EventLog): EventLog {
  return [...log].sort((a, b) => (parseTime(b.at) ?? 0) - (parseTime(a.at) ?? 0));
}

function statusText(e: NewsEvent, log: EventLog | null, now: number, lang: Lang): string {
  if (e.status === 'active') return t(lang, 'actif', 'active');
  if (e.status === 'closed') return t(lang, 'clos', 'closed');
  const cooling = log?.find((entry) => entry.kind === 'cooling');
  const at = cooling ? parseTime(cooling.at) : null;
  return at === null
    ? t(lang, 'en refroidissement', 'cooling')
    : t(lang, `en refroidissement depuis ${absoluteTime(at, now, lang)}`, `cooling since ${absoluteTime(at, now, lang)}`);
}

/** Groupes indépendants dans le temps, depuis les changements « corroboré » du journal. */
function corroborationPoints(e: NewsEvent, log: EventLog | null): CurvePoint[] {
  if (!log) return [];
  const steps = log
    .filter((entry) => entry.kind === 'corroborated' && entry.to !== null)
    .map((entry) => ({ at: parseTime(entry.at), from: entry.from === null || entry.from === '' ? Number.NaN : Number(entry.from), to: Number(entry.to) }))
    .filter((s): s is { at: number; from: number; to: number } => s.at !== null && Number.isFinite(s.to))
    .sort((a, b) => a.at - b.at);
  if (steps.length === 0) return [];
  const start = parseTime(e.firstSeen) ?? steps[0].at;
  const points: CurvePoint[] = [{ at: Math.min(start, steps[0].at), value: Number.isFinite(steps[0].from) ? steps[0].from : 1 }];
  for (const s of steps) points.push({ at: s.at, value: s.to });
  const end = parseTime(e.lastSeen);
  if (end !== null && end > steps[steps.length - 1].at) points.push({ at: end, value: steps[steps.length - 1].to });
  return points;
}

function eventPlaceText(e: NewsEvent, place: EventFicheInput['place'], lang: Lang): string | null {
  if (e.zone === 'etranger') return t(lang, 'à l’étranger', 'abroad');
  if (place) return `${place.nom} (${place.code})`;
  return e.zone === 'france' ? 'France' : null;
}

export function buildEventFiche(input: EventFicheInput): FicheModel {
  const { event: e, detail, lang, now } = input;
  const i = lang === 'fr' ? 0 : 1;
  const level = eventDisplayLevel(e.severity, e.peakSeverity);
  const unconfirmed = unconfirmedPeakLevel(e.severity, e.peakSeverity);
  const loaded = detail !== undefined && detail !== 'loading' && detail !== 'error' ? detail : null;
  const log = loaded ? sortedLog(loaded.log) : null;
  const firstSeen = parseTime(e.firstSeen);
  const lastSeen = parseTime(e.lastSeen);
  const open = (id: string, byDefault: boolean): boolean => input.sectionOpen.get(id) ?? byDefault;
  const theme = themeLabel(categoryTheme(e.category), lang);
  const placeText = eventPlaceText(e, input.place, lang);

  const context = [
    placeText,
    firstSeen !== null ? t(lang, `depuis ${absoluteTime(firstSeen, now, lang)}`, `since ${absoluteTime(firstSeen, now, lang)}`) : t(lang, 'depuis n.d.', 'since n.d.'),
    statusText(e, log, now, lang),
    unconfirmed ? t(lang, `à confirmer, signalé ${levelLabel(unconfirmed, lang).toLowerCase()}`, `unconfirmed, reported ${levelLabel(unconfirmed, lang).toLowerCase()}`) : null,
  ].filter((c): c is string => c !== null);

  const names = e.sourceNames.slice(0, 4).join(', ');
  const last = lastSeen !== null ? t(lang, ` Dernier article à ${absoluteTime(lastSeen, now, lang)}.`, ` Last article at ${absoluteTime(lastSeen, now, lang)}.`) : '';
  const lead = t(lang,
    `Repris par ${e.sourceCount} source${plural(e.sourceCount)}${names ? ` (${names})` : ''}.${last}`,
    `Reported by ${e.sourceCount} source${plural(e.sourceCount)}${names ? ` (${names})` : ''}.${last}`);

  const points = corroborationPoints(e, log);
  const curve = stepCurve(points, {
    label: t(lang, `Groupes de presse indépendants, de ${points[0]?.value ?? 1} à ${e.independentCount}`, `Independent press groups, from ${points[0]?.value ?? 1} to ${e.independentCount}`),
    timeLabel: (ms) => absoluteTime(ms, now, lang),
  });
  const reasons = (e.reasons ?? []).map((r) => REASON_LABEL[r][i]);
  const reported = eventLevel(e.peakSeverity ?? e.severity);
  const rows = [
    kvRow(t(lang, 'Confirmation', 'Confirmation'), escapeHtml(confirmationText(e, lang))),
    kvRow(t(lang, 'Gravité', 'Severity'), `${renderVigilancePill(reported, lang)} ${t(lang, 'signalée', 'reported')} → ${renderVigilancePill(level, lang)} ${t(lang, 'retenue', 'kept')}`),
    reasons.length > 0 ? kvRow(t(lang, 'Motifs', 'Reasons'), escapeHtml(reasons.join(' ; '))) : '',
    kvRow(t(lang, 'Volume', 'Volume'), escapeHtml(t(lang, `${e.articleCount} articles · ${e.sourceCount} flux`, `${e.articleCount} articles · ${e.sourceCount} feeds`))),
    placeText ? kvRow(t(lang, 'Lieu', 'Location'), escapeHtml(placeText)) : '',
    e.temporality ? kvRow(t(lang, 'Temporalité', 'Timing'), escapeHtml(TEMPORALITY_LABEL[e.temporality][i])) : '',
    kvRow(t(lang, 'Classement', 'Classification'), escapeHtml(theme)),
    kvRow(t(lang, 'Preuve', 'Evidence'), escapeHtml(e.evidenceId)),
  ].join('');
  const indicators = (curve ? `<div class="fmk-sub">${t(lang, 'Corroboration : groupes de presse indépendants', 'Corroboration: independent press groups')}</div>${curve}` : '')
    + `<div class="fmk-kvs">${rows}</div>`;

  const pending = (fr: string, en: string): string => `<p class="fmk-muted">${t(lang, fr, en)}</p>`;
  const evolution = log
    ? (log.length > 0
      ? renderChangeRows(log.slice(0, 8).map((entry) => ({ at: parseTime(entry.at), text: logText(entry, lang), select: null })), lang, now)
      : pending('Aucun changement.', 'No change.'))
    : detail === 'error'
      ? pending('Journal indisponible pour le moment.', 'Log unavailable right now.')
      : pending('Chargement du journal…', 'Loading log…');

  const articles = loaded
    ? [...loaded.articles].sort((a, b) => (parseTime(b.publishedAt ?? '') ?? 0) - (parseTime(a.publishedAt ?? '') ?? 0))
    : null;
  const articleRows = (articles ?? []).map((a) => {
    const at = a.publishedAt ? parseTime(a.publishedAt) : null;
    const meta = [a.feedName, at !== null ? absoluteTime(at, now, lang) : null].filter((x): x is string => x !== null && x !== '').join(' · ');
    const href = safeHref(a.link);
    const title = escapeHtml(a.title);
    return `<li class="fmk-row">${href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${title}</a>` : `<span>${title}</span>`}`
      + `${meta ? `<small>${escapeHtml(meta)}</small>` : ''}</li>`;
  }).join('');
  const articlesHtml = articles
    ? articles.length === 0 ? pending('Aucun article disponible.', 'No article available.') : `<ul class="fmk-rows">${articleRows}</ul>`
    : detail === 'error'
      ? pending('Articles indisponibles pour le moment.', 'Articles unavailable right now.')
      : pending('Chargement des articles…', 'Loading articles…');

  const n = e.independentCount;
  const actions: FicheAction[] = e.lat !== null && e.lon !== null ? [{ id: 'map', label: t(lang, 'Voir sur la carte', 'Show on map') }] : [];
  actions.push({ id: 'copy-ref', label: t(lang, 'Copier la référence', 'Copy reference') });
  return {
    key: `event:${e.id}`,
    kind: `${t(lang, 'Événement', 'Event')} · ${theme}`,
    name: e.title,
    level,
    driver: '',
    freshness: '',
    context,
    lead,
    sections: [
      {
        id: 'indicators', title: t(lang, 'Indicateurs', 'Indicators'), collapsible: true, open: open('indicators', true), html: indicators,
        summary: escapeHtml(t(lang, `${n} groupe${plural(n)} indépendant${plural(n)} · ${e.articleCount} articles`, `${n} independent group${plural(n)} · ${e.articleCount} articles`)),
      },
      {
        id: 'evolution', title: t(lang, 'Évolution', 'Evolution'), collapsible: true, open: open('evolution', true), html: evolution,
        summary: log ? escapeHtml(log.length > 8
          ? t(lang, `8 sur ${log.length} changements`, `8 of ${log.length} changes`)
          : t(lang, `${log.length} changement${plural(log.length)}`, `${log.length} change${plural(log.length)}`)) : '',
      },
      {
        id: 'articles', title: t(lang, 'Articles', 'Articles'), collapsible: true, open: open('articles', false), tone: 'reference', html: articlesHtml,
        summary: escapeHtml(t(lang, `${e.articleCount} articles · ${e.sourceCount} flux`, `${e.articleCount} articles · ${e.sourceCount} feeds`)),
      },
    ],
    reference: `${e.evidenceId} · ${e.title} · ${levelLabel(level, lang)} · ${t(lang, 'première apparition', 'first seen')} ${firstSeen !== null ? absoluteTime(firstSeen, now, lang, { withDate: true }) : 'n.d.'}`,
    actions,
  };
}

// ─── Situation du moteur et alerte ────────────────────────────────────────────────────────────

export interface SituationFicheInput {
  situation: DetectedSituation;
  kind: 'situation' | 'alert';
  badge: WorkBadge;
  /** Heure d'apparition connue dans la session, null sinon. */
  changeAt: number | null;
  /** Un dossier dédié existe (grand feu, vol militaire). */
  hasDossier: boolean;
  sectionOpen: ReadonlyMap<string, boolean>;
  lang: Lang;
  now: number;
}

const ACTION_TYPE: Record<SituationAction['actionType'], [string, string]> = {
  investigate: ['Enquête', 'Investigate'],
  monitor: ['Surveillance', 'Monitor'],
  'cross-check': ['Recoupement', 'Cross-check'],
  escalate: ['Escalade', 'Escalate'],
};

export function buildSituationFiche(input: SituationFicheInput): FicheModel {
  const { situation: s, lang, now } = input;
  const level = situationLevel(s.severity);
  const summary = splitScoreSentences(s.summary);
  const drivers = splitScoreLines(s.drivers);
  const zones = s.affectedZones.map(splitZoneScore);
  const updated = s.updatedAt.getTime();
  const open = (id: string, byDefault: boolean): boolean => input.sectionOpen.get(id) ?? byDefault;
  const names = zones.map((z) => z.name);
  const zoneText = names.length > 3 ? `${names.slice(0, 3).join(', ')} + ${names.length - 3}` : names.join(', ');
  const atText = input.changeAt !== null ? ` (${absoluteTime(input.changeAt, now, lang)})` : '';
  const badgeText = input.badge === 'nouveau'
    ? t(lang, `nouveau depuis votre visite${atText}`, `new since your visit${atText}`)
    : input.badge === 'aggrave' ? t(lang, `aggravé depuis votre visite${atText}`, `escalated since your visit${atText}`) : null;
  const context = [
    levelPhrase(level, lang),
    zoneText || null,
    t(lang, `mise à jour ${absoluteTime(updated, now, lang)}`, `updated ${absoluteTime(updated, now, lang)}`),
    badgeText,
  ].filter((c): c is string => c !== null);
  const lead = summary.plain.length > 0
    ? summary.plain.slice(0, 3).join(' ')
    : t(lang, `${s.title} : ${levelVigilanceWord(level)}.`, `${s.title}: ${levelVigilanceWord(level, 'en')}.`);

  // Indicateurs (ex-« Pourquoi ce niveau ? », spec 2026-10-01 fiches § 2.3) : une barre par sous-score.
  const meters: string[] = [];
  const notes: string[] = [];
  const seenLabels = new Set<string>();
  let trend: string | null = null;
  const pushScore = (line: string): void => {
    const p = parseScoreLine(line);
    if (!p) {
      notes.push(line);
      return;
    }
    // Une barre par libellé (la synthèse et les facteurs répètent parfois le même sous-score).
    if (seenLabels.has(p.label)) return;
    seenLabels.add(p.label);
    const trendMatch = p.note ? /tendance\s+([^\s,;]+)/i.exec(p.note) : null;
    if (trendMatch && trend === null) trend = trendMatch[1];
    meters.push(meterRow({
      label: p.label, value: (p.value / p.max) * 100, level: statusWordLevel(p.note) ?? intensityLevel(p.value, p.max), display: p.display,
      noteHtml: p.note ? `<span class="fmk-muted">${escapeHtml(p.note)}</span>` : undefined,
    }));
  };
  for (const line of [...drivers.scored, ...summary.scored]) pushScore(line);
  for (const z of zones) if (z.score !== null) pushScore(`${z.name} : ${z.score}`);
  const confidence = Math.round(s.confidence * 100);
  meters.push(meterRow({ label: t(lang, 'Confiance', 'Confidence'), value: confidence, level: null, neutral: true, display: `${confidence} %` }));
  const provenance = [
    s.sourceRefs.length > 0 ? `${t(lang, 'Sources :', 'Sources:')} ${s.sourceRefs.join(', ')}` : null,
    t(lang, `mise à jour ${absoluteTime(updated, now, lang)}`, `updated ${absoluteTime(updated, now, lang)}`),
  ].filter((c): c is string => c !== null).join(' · ');
  const indicators = `<div class="fmk-meters fmk-meters--score">${meters.join('')}</div>`
    + notes.map((n) => `<p class="fmk-note">${escapeHtml(n)}</p>`).join('')
    + `<p class="fmk-note">${escapeHtml(provenance)}</p>`;

  const sections: FicheSection[] = [{
    id: 'indicators', title: t(lang, 'Indicateurs', 'Indicators'), collapsible: true, open: open('indicators', true),
    summary: escapeHtml(trend ? `${confidenceLabel(s.confidence, lang)} · ${t(lang, 'tendance', 'trend')} ${trend}` : confidenceLabel(s.confidence, lang)), html: indicators,
  }];
  if (s.recommendedActions.length > 0) {
    const items = s.recommendedActions.map((a) => {
      const meta = [a.ownerHint, ACTION_TYPE[a.actionType][lang === 'fr' ? 0 : 1], a.automatable ? t(lang, 'IA possible', 'AI possible') : null]
        .filter((x): x is string => x !== null && x !== '').join(' · ');
      return `<li>${escapeHtml(a.label)}<small>${escapeHtml(meta)}</small></li>`;
    }).join('');
    const n = s.recommendedActions.length;
    sections.push({ id: 'todo', title: t(lang, 'À faire', 'To do'), collapsible: true, open: open('todo', true),
      summary: escapeHtml(t(lang, `${n} action${plural(n)}`, `${n} action${plural(n)}`)), html: `<ol class="fmk-todo">${items}</ol>` });
  }
  if (drivers.plain.length > 0) {
    sections.push({ id: 'factors', title: t(lang, 'Facteurs', 'Drivers'), collapsible: true, open: open('factors', true),
      summary: String(drivers.plain.length), html: `<ul class="fiche-list">${drivers.plain.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>` });
  }
  if (names.length > 0) {
    sections.push({ id: 'zones', title: t(lang, 'Zones', 'Areas'), collapsible: true, open: open('zones', true),
      summary: escapeHtml(t(lang, `${names.length} zone${plural(names.length)}`, `${names.length} area${plural(names.length)}`)),
      html: `<div class="fmk-tags">${names.map((z) => `<span class="fmk-tag">${escapeHtml(z)}</span>`).join('')}</div>` });
  }
  const sources: FicheSource[] = s.sourceRefs.map((label) => ({ label, href: null, select: null }));
  if (s.linkUrl && safeHref(s.linkUrl) !== null) {
    sources.unshift({ label: s.linkLabel ?? t(lang, 'Ouvrir la source', 'Open source'), href: s.linkUrl, select: null });
  }
  if (sources.length > 0) {
    sections.push({ id: 'sources', title: t(lang, 'Sources', 'Sources'), collapsible: true, open: open('sources', false), tone: 'reference',
      summary: escapeHtml(t(lang, `${sources.length} source${plural(sources.length)}`, `${sources.length} source${plural(sources.length)}`)), html: renderSourceChips(sources) });
  }

  const actions: FicheAction[] = [];
  if ((s.activateLayers?.length ?? 0) > 0 || (s.lon != null && s.lat != null)) {
    actions.push({ id: 'map', label: t(lang, 'Voir sur la carte', 'Show on map') });
  }
  if (input.hasDossier) {
    actions.push({
      id: 'dossier',
      label: s.type === 'WILDFIRE_ESCALATION' ? t(lang, 'Ouvrir le dossier d’incident', 'Open incident file') : t(lang, 'Voir l’aéronef', 'Show aircraft'),
    });
  }
  actions.push({ id: 'copy-ref', label: t(lang, 'Copier la référence', 'Copy reference') });

  const kindWord = input.kind === 'alert' ? t(lang, 'Alerte', 'Alert') : t(lang, 'Situation', 'Situation');
  return {
    key: `${input.kind}:${s.id}`,
    kind: `${kindWord} · ${themeLabel(situationTheme(s.type, s.category), lang)}`,
    name: s.title,
    level,
    driver: '',
    freshness: '',
    context,
    lead,
    sections,
    reference: `${s.id} · ${s.title} · ${levelLabel(level, lang)} · ${t(lang, 'mise à jour', 'updated')} ${absoluteTime(updated, now, lang, { withDate: true })}`,
    actions,
  };
}

// ─── Alerte officielle et marché ──────────────────────────────────────────────────────────────

export function buildOfficialFiche(group: OfficialAlertGroup, input: { freshness: string; sectionOpen: ReadonlyMap<string, boolean>; lang: Lang }): FicheModel {
  const { lang } = input;
  const open = (id: string, byDefault: boolean): boolean => input.sectionOpen.get(id) ?? byDefault;
  const n = group.places.length;
  const shown = group.places.slice(0, 5).join(', ');
  const more = n > 5 ? t(lang, ` et ${n - 5} autre${plural(n - 5)}`, ` and ${n - 5} more`) : '';
  const source = officialSourceName(group.source);
  const note = t(lang, `Niveau publié par ${source}, repris tel quel.`, `Level published by ${source}, shown as is.`);
  return {
    key: `official:${group.source}:${group.level}`,
    kind: `${t(lang, 'Alerte officielle', 'Official alert')} · ${source}`,
    name: officialTitle(group, lang),
    level: group.level,
    driver: '',
    freshness: '',
    context: [source, input.freshness].filter(Boolean),
    lead: t(lang,
      `${capitalize(levelVigilanceWord(group.level))} (${levelPhrase(group.level)}) : ${shown}${more}.`,
      `${capitalize(levelVigilanceWord(group.level, 'en'))} (${levelPhrase(group.level, 'en')}): ${shown}${more}.`),
    sections: [
      {
        id: 'indicators', title: t(lang, 'Indicateurs', 'Indicators'), collapsible: true, open: open('indicators', true),
        html: `<div class="fmk-kvs">${kvRow(t(lang, 'Lieux concernés', 'Places concerned'), String(n))}</div><p class="fmk-note">${escapeHtml(note)}</p>`,
      },
      {
        id: 'places', title: t(lang, 'Détail par lieu', 'Detail by place'), collapsible: true, open: open('places', true), summary: String(n),
        html: `<ul class="fiche-list">${group.details.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>`,
      },
      {
        id: 'sources', title: t(lang, 'Sources', 'Sources'), collapsible: true, open: open('sources', false), tone: 'reference',
        summary: '1', html: renderSourceChips([{ label: source, href: null, select: null }]),
      },
    ],
    actions: [{ id: 'show-layer', label: t(lang, 'Afficher la couche', 'Show layer') }],
  };
}

export function buildMarketFiche(line: MarketLine, input: { sectionOpen: ReadonlyMap<string, boolean>; lang: Lang }): FicheModel {
  const { lang } = input;
  const threshold = MARKET_ALERT_THRESHOLD[line.kind];
  const pct = formatSignedPct(line.changePercent);
  const html = `<div class="fmk-kvs">${kvRow(t(lang, 'Cours', 'Price'), escapeHtml(formatNumber(line.price, lang)))}${kvRow(t(lang, 'Variation', 'Change'), escapeHtml(pct))}</div>`
    + `<p class="fmk-note">${t(lang,
      'Seuil d’alerte : ±3 % sur la journée pour un indice boursier, ±5 % pour le pétrole et le gaz. En deçà, les marchés restent en gris.',
      'Alert threshold: ±3 % over the day for a stock index, ±5 % for oil and gas. Below it, markets stay grey.')}</p>`;
  return {
    key: `market:${line.symbol}`,
    kind: t(lang, 'Marché', 'Market'),
    name: line.name,
    level: 'jaune',
    driver: '',
    freshness: '',
    context: [t(lang, 'mouvement exceptionnel', 'exceptional move')],
    lead: t(lang,
      `${line.name} varie de ${pct} sur la journée, au-delà du seuil de ±${threshold} %.`,
      `${line.name} moved ${pct} today, beyond the ±${threshold} % threshold.`),
    sections: [{ id: 'indicators', title: t(lang, 'Indicateurs', 'Indicators'), collapsible: true, open: input.sectionOpen.get('indicators') ?? true, html }],
    actions: [],
  };
}
