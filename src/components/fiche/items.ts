// src/components/fiche/items.ts — fiches thème, événement, situation, alerte, alerte officielle et
// marché (spec §6.3). Le §11 ne prévoyait à l'étape 2 que les fiches France, thème et événement ;
// les fiches situation et alerte sont livrées ici parce que la v2 retire SituationMonitor et
// AlertMonitor et que le §14 exige que leur détail reste accessible (arbitrage A1).

import type {
  DetectedSituation,
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
  eventLevel,
  formatSignedPct,
  levelLabel,
  levelPhrase,
  levelVigilanceWord,
  situationLevel,
} from '../../services/vigilance.ts';
import { categoryTheme, themeLabel, type SpecificThemeId } from '../../services/themes.ts';
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
import { splitScoreLines, splitScoreSentences, splitZoneScore } from '../../services/situation-text.ts';
import { escapeHtml, formatAge, safeHref, type EventDetailState } from '../france-intel-events.ts';
import { renderEnergyBlock } from '../france-intel-blocks.ts';
import { renderVigilancePill } from '../shared/vigilancePill.ts';
import {
  digestChangeText,
  formatClock,
  formatNumber,
  labelled,
  nothingToHandleText,
  parseTime,
  severityWord,
  t,
  type FicheAction,
  type FicheChange,
  type FicheFigure,
  type FicheModel,
  type FicheSection,
  type FicheSource,
  type Lang,
} from './parts.ts';

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
  whyOpen: boolean;
  /** Couches critiques chargées : avant, « Chargement des données… », jamais « Rien à traiter » (relecture finale m1). */
  ready: boolean;
  lang: Lang;
}

function officialSignalText(o: OfficialSignal, lang: Lang): string {
  const word = levelLabel(o.level, lang).toLowerCase();
  if (o.source === 'ecowatt') return t(lang, `Écowatt : signal ${word}`, `Ecowatt: ${word} signal`);
  if (o.source === 'meteo') return t(lang, `Vigilance météo ${word}`, `Weather ${levelVigilanceWord(o.level, 'en')}`);
  return t(lang, `Vigicrues ${word}`, `Vigicrues ${word}`);
}

function themeFigures(theme: SpecificThemeId, snapshot: ThemeFicheInput['snapshot'], lang: Lang): FicheFigure[] {
  const s = snapshot.signals;
  const e = snapshot.energy;
  switch (theme) {
    case 'energy': {
      const figures: FicheFigure[] = [];
      if (e?.totalMw != null) figures.push({ label: t(lang, 'Production nationale', 'National output'), value: `${formatNumber(Math.round(e.totalMw), lang)} MW` });
      if (e?.oilStocksDays != null) figures.push({ label: t(lang, 'Stocks de carburant', 'Fuel stocks'), value: `${e.oilStocksDays} ${t(lang, 'j', 'd')}` });
      if (e?.windGw != null) figures.push({ label: t(lang, 'Production éolienne', 'Wind output'), value: `${formatNumber(e.windGw, lang)} GW` });
      return figures;
    }
    case 'security':
      return [
        { label: t(lang, 'Alertes cyber (30 j)', 'Cyber alerts (30 d)'), value: String(s.cyberAlerts) },
        { label: t(lang, 'Vols militaires suivis', 'Military flights tracked'), value: String(s.militaryFlights) },
        { label: t(lang, 'Alertes câbles et brouillage', 'Cable and jamming alerts'), value: String(s.defenseAlerts + s.jammingSignals) },
      ];
    case 'environment':
      return [
        { label: t(lang, 'Départements en vigilance orange ou rouge', 'Departments on orange or red'), value: String(s.meteoAlerts) },
        { label: t(lang, 'Tronçons en crue orange ou rouge', 'River sections on orange or red'), value: String(s.floodAlerts) },
        { label: t(lang, 'Feux détectés', 'Fires detected'), value: String(s.fireDetections) },
      ];
    case 'health':
      // Les données santé ne sont pas dans l'instantané national : les panneaux santé deviennent
      // le contenu de ce thème à l'étape 3.
      return [];
  }
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
  const why = [
    signalRows ? `<h4 class="fiche-why-title">${t(lang, 'Signaux officiels', 'Official signals')}</h4><ul class="fiche-list">${signalRows}</ul>` : '',
    itemRows ? `<h4 class="fiche-why-title">${t(lang, 'Éléments à traiter', 'Items to handle')}</h4><ul class="fiche-list">${itemRows}</ul>` : '',
    theme === 'energy' ? renderEnergyBlock(input.snapshot.energy, lang) : '',
    `<p class="fiche-meta">${t(lang,
      'Le niveau du thème est le plus élevé de ses signaux officiels et de ses éléments à traiter.',
      'The theme level is the highest of its official signals and items to handle.')}</p>`,
  ].join('');

  return {
    key: `theme:${theme}`,
    kind: t(lang, 'Thème', 'Theme'),
    name: themeLabel(theme, lang),
    level: queue.themeLevels[theme],
    driver: n > 0 ? items[0].title : raised.length > 0 ? officialSignalText(raised[0], lang) : t(lang, 'rien à traiter', 'nothing to handle'),
    freshness: input.freshness,
    essentiel: essentiel.slice(0, 3),
    changesMeta: '',
    changes: changes.sort(byTimeDesc),
    sections: [],
    figures: themeFigures(theme, input.snapshot, lang),
    watch: [],
    sourcesTitle: t(lang, 'Sources', 'Sources'),
    sources: [...labels].slice(0, 8).map((label) => ({ label, href: null, select: null })),
    why,
    whyOpen: input.whyOpen,
    actions: [{ id: 'show-theme', label: t(lang, 'Afficher sur la carte', 'Show on map') }],
  };
}

// ─── Événement consolidé ──────────────────────────────────────────────────────────────────────

export interface EventFicheInput {
  event: NewsEvent;
  /** Articles et journal, chargés à la demande (undefined tant que la demande n'est pas partie). */
  detail: EventDetailState | undefined;
  whyOpen: boolean;
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

const STATUS_LABEL: Record<NewsEvent['status'], [string, string]> = {
  active: ['actif', 'active'],
  cooling: ['refroidit', 'cooling'],
  closed: ['clos', 'closed'],
};

function logText(entry: NewsEventDetail['log'][number], lang: Lang): string {
  const label = LOG_LABEL[entry.kind][lang === 'fr' ? 0 : 1];
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

export function buildEventFiche(input: EventFicheInput): FicheModel {
  const { event: e, detail, lang, now } = input;
  const level = eventLevel(e.severity);
  const indep = e.independentCount;
  const driver = indep >= 2
    ? t(lang, `${indep} sources indépendantes`, `${indep} independent sources`)
    : e.sourceCount > 1
      ? t(lang, `${e.sourceCount} titres du même groupe`, `${e.sourceCount} outlets from one group`)
      : t(lang, 'source unique', 'single source');
  const names = e.sourceNames.slice(0, 4).join(', ');
  const since = formatClock(parseTime(e.firstSeen) ?? now, lang);
  const loaded = detail !== undefined && detail !== 'loading' && detail !== 'error' ? detail : null;
  const changes: FicheChange[] = loaded
    ? loaded.log.slice(0, 5).map((entry) => ({ at: parseTime(entry.at), text: logText(entry, lang), select: null }))
    : [];
  const changesMeta = loaded
    ? ''
    : detail === 'error'
      ? t(lang, 'Journal indisponible pour le moment.', 'Log unavailable right now.')
      : t(lang, 'Chargement du journal…', 'Loading log…');
  const sources: FicheSource[] = loaded
    ? loaded.articles.map((a) => {
        const at = a.publishedAt ? parseTime(a.publishedAt) : null;
        return { label: `${a.title} · ${a.feedName ?? '—'}${at !== null ? ` · ${formatClock(at, lang)}` : ''}`, href: a.link, select: null };
      })
    : e.sourceNames.map((name) => ({ label: name, href: null, select: null }));
  const status = STATUS_LABEL[e.status][lang === 'fr' ? 0 : 1];
  const why = `<ul class="fiche-list">`
    + `<li>${t(lang, 'Identifiant de preuve', 'Evidence id')} : ${escapeHtml(e.evidenceId)}</li>`
    + `<li>${t(lang, 'Classement', 'Classification')} : ${escapeHtml(themeLabel(categoryTheme(e.category), lang))}, ${levelLabel(level, lang).toLowerCase()}</li>`
    + `<li>${t(lang, 'Corroboration', 'Corroboration')} : ${t(lang,
      `${indep} groupe${plural(indep)} de presse indépendant${plural(indep)} sur ${e.sourceCount} flux`,
      `${indep} independent press group${plural(indep)} across ${e.sourceCount} feeds`)}</li>`
    + `<li>${t(lang, 'Statut', 'Status')} : ${status}</li>`
    + `</ul>`;
  return {
    key: `event:${e.id}`,
    kind: `${t(lang, 'Événement', 'Event')} · ${themeLabel(categoryTheme(e.category), lang)}`,
    name: e.title,
    level,
    driver,
    freshness: `${t(lang, 'Dernier article', 'Last article')} ${formatAge(e.lastSeen, now, lang)}`,
    essentiel: [t(lang,
      `Repris par ${e.sourceCount} source${plural(e.sourceCount)}${names ? ` (${names})` : ''} depuis ${since}.`,
      `Reported by ${e.sourceCount} source${plural(e.sourceCount)}${names ? ` (${names})` : ''} since ${since}.`)],
    changesMeta,
    changes,
    sections: [],
    figures: [
      { label: t(lang, 'Articles', 'Articles'), value: String(e.articleCount) },
      { label: t(lang, 'Flux', 'Feeds'), value: String(e.sourceCount) },
      { label: t(lang, 'Groupes indépendants', 'Independent groups'), value: String(indep) },
    ],
    watch: [],
    sourcesTitle: t(lang, 'Articles', 'Articles'),
    sources,
    why,
    whyOpen: input.whyOpen,
    actions: e.lat !== null && e.lon !== null ? [{ id: 'map', label: t(lang, 'Voir sur la carte', 'Show on map') }] : [],
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
  whyOpen: boolean;
  lang: Lang;
}

const ACTION_TYPE: Record<SituationAction['actionType'], [string, string]> = {
  investigate: ['Enquête', 'Investigate'],
  monitor: ['Surveillance', 'Monitor'],
  'cross-check': ['Recoupement', 'Cross-check'],
  escalate: ['Escalade', 'Escalate'],
};

export function buildSituationFiche(input: SituationFicheInput): FicheModel {
  const { situation: s, lang } = input;
  const level = situationLevel(s.severity);
  const summary = splitScoreSentences(s.summary);
  const drivers = splitScoreLines(s.drivers);
  const essentiel = summary.plain.length > 0
    ? summary.plain.slice(0, 3)
    : [t(lang, `${s.title} : ${levelVigilanceWord(level)}.`, `${s.title}: ${levelVigilanceWord(level, 'en')}.`)];

  const sections: FicheSection[] = [];
  if (drivers.plain.length > 0) {
    sections.push({
      title: t(lang, 'Facteurs', 'Drivers'),
      html: `<ul class="fiche-list">${drivers.plain.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>`,
    });
  }
  // Relecture finale I4 : « Seine-Saint-Denis (72/100) » → le nom ici, le score dans le volet.
  const zones = s.affectedZones.map(splitZoneScore);
  if (zones.length > 0) {
    sections.push({ title: t(lang, 'Zones', 'Areas'), html: `<p>${escapeHtml(zones.map((z) => z.name).join(' · '))}</p>` });
  }
  if (s.recommendedActions.length > 0) {
    const rows = s.recommendedActions.map((a) => {
      const auto = a.automatable ? ` · ${t(lang, 'IA possible', 'AI possible')}` : '';
      return `<li>${escapeHtml(a.label)} <span class="fiche-meta">${escapeHtml(a.ownerHint)} · ${ACTION_TYPE[a.actionType][lang === 'fr' ? 0 : 1]}${auto}</span></li>`;
    }).join('');
    sections.push({ title: t(lang, 'Actions recommandées', 'Recommended actions'), html: `<ul class="fiche-list">${rows}</ul>` });
  }

  const sources: FicheSource[] = s.sourceRefs.map((label) => ({ label, href: null, select: null }));
  // Lien source de l'ancienne fiche d'alerte : seulement s'il est http(s).
  if (s.linkUrl && safeHref(s.linkUrl) !== null) {
    sources.unshift({ label: s.linkLabel ?? t(lang, 'Ouvrir la source', 'Open source'), href: s.linkUrl, select: null });
  }

  // Arbitrage A7 : sous-scores et phrases chiffrées du moteur seulement dans le volet.
  const zoneScores = zones.flatMap((z) => (z.score === null ? [] : [`${z.name} : ${z.score}`]));
  const whyRows = [...drivers.scored, ...summary.scored, ...zoneScores].map((line) => `<li>${escapeHtml(line)}</li>`).join('');
  const why = `<ul class="fiche-list">${whyRows}`
    + `<li>${capitalize(confidenceLabel(s.confidence, lang))} (${Math.round(s.confidence * 100)} %)</li>`
    + `<li>${t(lang, 'Niveau', 'Level')} : ${levelLabel(level, lang)}, ${levelPhrase(level, lang)}</li></ul>`;

  const actions: FicheAction[] = [];
  if ((s.activateLayers?.length ?? 0) > 0 || (s.lon != null && s.lat != null)) {
    actions.push({ id: 'map', label: t(lang, 'Voir sur la carte', 'Show on map') });
  }
  if (input.hasDossier) {
    actions.push({
      id: 'dossier',
      label: s.type === 'WILDFIRE_ESCALATION'
        ? t(lang, 'Ouvrir le dossier d’incident', 'Open incident file')
        : t(lang, 'Voir l’aéronef', 'Show aircraft'),
    });
  }

  const changes: FicheChange[] = input.badge === null
    ? []
    : [{
        at: input.changeAt,
        text: input.badge === 'nouveau'
          ? t(lang, 'Nouveau depuis votre visite', 'New since your visit')
          : t(lang, 'Aggravé depuis votre visite', 'Escalated since your visit'),
        select: null,
      }];

  return {
    key: `${input.kind}:${s.id}`,
    kind: input.kind === 'alert' ? t(lang, 'Alerte', 'Alert') : t(lang, 'Situation', 'Situation'),
    name: s.title,
    level,
    driver: confidenceLabel(s.confidence, lang),
    freshness: `${t(lang, 'Mise à jour', 'Updated')} ${formatClock(s.updatedAt.getTime(), lang)}`,
    essentiel,
    changesMeta: '',
    changes,
    sections,
    figures: [],
    watch: [],
    sourcesTitle: t(lang, 'Sources', 'Sources'),
    sources,
    why,
    whyOpen: input.whyOpen,
    actions,
  };
}

// ─── Alerte officielle et marché ──────────────────────────────────────────────────────────────

export function buildOfficialFiche(group: OfficialAlertGroup, input: { freshness: string; whyOpen: boolean; lang: Lang }): FicheModel {
  const { lang } = input;
  const n = group.places.length;
  const shown = group.places.slice(0, 5).join(', ');
  const more = n > 5 ? t(lang, ` et ${n - 5} autre${plural(n - 5)}`, ` and ${n - 5} more`) : '';
  const source = officialSourceName(group.source);
  const violet = group.source === 'meteo'
    ? ` ${t(lang, 'Le violet de Météo-France compte comme rouge.', 'Météo-France purple counts as red.')}`
    : '';
  return {
    key: `official:${group.source}:${group.level}`,
    kind: t(lang, 'Alerte officielle', 'Official alert'),
    name: officialTitle(group, lang),
    level: group.level,
    driver: source,
    freshness: input.freshness,
    essentiel: [t(lang,
      `${capitalize(levelVigilanceWord(group.level))} (${levelPhrase(group.level)}) : ${shown}${more}.`,
      `${capitalize(levelVigilanceWord(group.level, 'en'))} (${levelPhrase(group.level, 'en')}): ${shown}${more}.`)],
    changesMeta: '',
    changes: [],
    sections: [{
      title: t(lang, 'Détail par lieu', 'Detail by place'),
      html: `<ul class="fiche-list">${group.details.map((d) => `<li>${escapeHtml(d)}</li>`).join('')}</ul>`,
    }],
    figures: [{ label: t(lang, 'Lieux concernés', 'Places concerned'), value: String(n) }],
    watch: [],
    sourcesTitle: t(lang, 'Sources', 'Sources'),
    sources: [{ label: source, href: null, select: null }],
    why: `<p>${escapeHtml(t(lang, `Niveau publié par ${source}, repris tel quel.`, `Level published by ${source}, shown as is.`))}${violet}</p>`,
    whyOpen: input.whyOpen,
    actions: [{ id: 'show-layer', label: t(lang, 'Afficher la couche', 'Show layer') }],
  };
}

export function buildMarketFiche(line: MarketLine, input: { whyOpen: boolean; lang: Lang }): FicheModel {
  const { lang } = input;
  const threshold = MARKET_ALERT_THRESHOLD[line.kind];
  const pct = formatSignedPct(line.changePercent);
  return {
    key: `market:${line.symbol}`,
    kind: t(lang, 'Marché', 'Market'),
    name: line.name,
    level: 'jaune',
    driver: t(lang, 'mouvement exceptionnel', 'exceptional move'),
    freshness: '',
    essentiel: [t(lang,
      `${line.name} varie de ${pct} sur la journée, au-delà du seuil de ±${threshold} %.`,
      `${line.name} moved ${pct} today, beyond the ±${threshold} % threshold.`)],
    changesMeta: '',
    changes: [],
    sections: [],
    figures: [
      { label: t(lang, 'Cours', 'Price'), value: formatNumber(line.price, lang) },
      { label: t(lang, 'Variation', 'Change'), value: pct },
    ],
    watch: [],
    sourcesTitle: '',
    sources: [],
    why: `<p>${t(lang,
      'Seuil d’alerte : ±3 % sur la journée pour un indice boursier, ±5 % pour le pétrole et le gaz. En deçà, les marchés restent en gris.',
      'Alert threshold: ±3 % over the day for a stock index, ±5 % for oil and gas. Below it, markets stay grey.')}</p>`,
    whyOpen: input.whyOpen,
    actions: [],
  };
}
