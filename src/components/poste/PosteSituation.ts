// src/components/poste/PosteSituation.ts — contrôleur de la disposition A1 (refonte UI, étape 2) :
// assemble bandeau d'état, barre de thèmes, liste « À traiter », fiche et onglets mobiles à partir
// des données en cache que lui passe App.ts. Tout l'état d'interface (thème, sélection, volets
// ouverts, onglet, liste dépliée) vit ici, jamais dans le DOM : les composants sont reconstruits à
// chaque arrivée de données (une vingtaine de fois au démarrage).

import type {
  CommodityData,
  DataSourceStatus,
  DetectedSituation,
  EcowattResponse,
  FloodSegment,
  IntelEventsState,
  MarketData,
  MeteoAlert,
  StructuredBrief,
} from '../../types/index.ts';
import type { StabilityPillarValues } from '../../utils/stability-history.ts';
import type { BriefSourceSituation } from '../../services/situation-brief.ts';
import type { VisitBaseline } from '../../services/intel-last-visit.ts';
import { scoreLevel } from '../../services/vigilance.ts';
import { drivenByText, themeLabel, type ThemeId } from '../../services/themes.ts';
import {
  buildWorkQueue,
  drivingThemes,
  levelsForBaseline,
  marketLines,
  viewWorkQueue,
  visitCounts,
  type WorkQueue,
} from '../../services/work-queue.ts';
import { fetchEventDetail } from '../../services/news-events.ts';
import { escapeHtml, unavailableEventsState, type EventDetailState } from '../france-intel-events.ts';
import { trendText } from '../france-intel-score.ts';
import { buildFranceFiche, type FranceFicheSnapshot } from '../fiche/france.ts';
import { buildEventFiche, buildMarketFiche, buildOfficialFiche, buildSituationFiche, buildThemeFiche } from '../fiche/items.ts';
import type { FicheModel, Lang } from '../fiche/parts.ts';
import { StatusBar, freshnessCounts, freshnessText } from './StatusBar.ts';
import { ThemeBar } from './ThemeBar.ts';
import { WorkList } from './WorkList.ts';
import { FichePanel } from './FichePanel.ts';

export type PosteLayout = 'mobile' | 'tablet' | 'desktop';
export type PosteTab = 'list' | 'map' | 'fiche';

/** Disposition selon la largeur (spec §9) : moins de 700 px mobile, 700 à 1 100 px tablette. */
export function layoutFor(width: number): PosteLayout {
  if (width < 700) return 'mobile';
  if (width <= 1100) return 'tablet';
  return 'desktop';
}

/** Chauffe du démarrage : ce qui apparaît pendant ces 2 min vient des données qui arrivent, pas d'un changement. */
const WARMUP_MS = 2 * 60 * 1000;
const MAX_EVENT_DETAILS = 50;

export interface PosteData {
  snapshot: FranceFicheSnapshot;
  alerts: readonly DetectedSituation[];
  ecowatt: EcowattResponse | null;
  meteo: readonly MeteoAlert[];
  floods: readonly FloodSegment[];
  markets: readonly MarketData[];
  commodities: readonly CommodityData[];
  sources: readonly DataSourceStatus[];
  score: { delta24h: number | null; pillarDeltas: StabilityPillarValues | null; series: number[] };
  /**
   * Couches critiques chargées. Avant, l'indice national est calculé sur des données absentes :
   * aucun niveau national ni de thème n'est affiché (jamais un « vert » qui rassurerait à tort).
   */
  ready: boolean;
  lang: Lang;
  now: number;
}

export interface PosteCallbacks {
  /** Thème choisi (barre de thèmes, garde, action de la fiche) : App applique la vue de couches (A5). */
  onThemeChange: (theme: ThemeId) => void;
  onFlyTo: (lon: number, lat: number, zoom: number) => void;
  onActivateLayers: (keys: readonly string[]) => void;
  /** Dossier dédié d'une alerte ou d'une situation (grand feu, vol militaire) ; false s'il n'existe pas. */
  onOpenDossier: (situation: DetectedSituation) => boolean;
  onOpenReport: () => void;
  onShowFrance: () => void;
  /** Après chaque rendu de fiche : App y rattache le baromètre des infrastructures (§14). */
  onFicheRendered: (body: HTMLElement) => void;
}

export interface PosteRoots {
  /** Racine #app : porte data-v2-tab et data-v2-fiche pour la mise en page CSS. */
  app: HTMLElement;
  status: HTMLElement;
  themes: HTMLElement;
  list: HTMLElement;
  fiche: HTMLElement;
  tabs: HTMLElement;
}

export interface PosteOptions {
  /** Largeur de la fenêtre, injectable pour les tests. */
  viewportWidth?: () => number;
}

function durationLabel(ms: number, lang: Lang): string {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} ${lang === 'fr' ? 'j' : 'd'}`;
}

export class PosteSituation {
  private readonly roots: PosteRoots;
  private readonly callbacks: PosteCallbacks;
  private readonly viewportWidth: () => number;
  private readonly statusBar: StatusBar;
  private readonly themeBar: ThemeBar;
  private readonly workList: WorkList;
  private readonly fichePanel: FichePanel;

  // ── État d'interface (jamais lu dans le DOM) ──
  private theme: ThemeId = 'general';
  /** Clé sélectionnée (« event:42 », « situation:… », « france »…) ; null = fiche par défaut. */
  private selection: string | null = null;
  private showAll = false;
  private tab: PosteTab = 'list';
  private readonly whyOpen = new Set<string>();
  private lastTabsHtml = '';

  // ── Données ──
  private data: PosteData | null = null;
  private queue: WorkQueue | null = null;
  private events: IntelEventsState | null = null;
  private brief: { brief: StructuredBrief; freshness: 'fresh' | 'cached' } | null = null;
  private briefSituationIds: string[] = [];
  private resolved: BriefSourceSituation[] = [];
  private baseline: VisitBaseline | null = null;
  private warmupUntil: number | null = null;
  private readonly knownKeys = new Set<string>();
  private readonly firstSeen = new Map<string, number>();
  private readonly eventDetails = new Map<number, EventDetailState>();

  constructor(roots: PosteRoots, callbacks: PosteCallbacks, options: PosteOptions = {}) {
    this.roots = roots;
    this.callbacks = callbacks;
    this.viewportWidth = options.viewportWidth ?? ((): number => window.innerWidth);
    this.statusBar = new StatusBar(roots.status);
    this.themeBar = new ThemeBar(roots.themes);
    this.workList = new WorkList(roots.list);
    this.fichePanel = new FichePanel(roots.fiche);

    this.statusBar.setOnSelectFrance(() => this.select('france'));
    this.themeBar.setOnSelect((theme) => this.setTheme(theme));
    this.workList.setOnSelect((key) => this.select(key));
    this.workList.setOnShowAll((showAll) => {
      this.showAll = showAll;
      this.render();
    });
    this.workList.setOnGuard((theme) => this.setTheme(theme));
    this.fichePanel.setOnSelect((key) => this.select(key));
    this.fichePanel.setOnAction((action, ficheKey) => this.runAction(action, ficheKey));
    this.fichePanel.setOnWhyToggle((ficheKey, open) => {
      if (open) this.whyOpen.add(ficheKey);
      else this.whyOpen.delete(ficheKey);
    });
    this.fichePanel.setOnClose(() => this.close());

    // Échap referme la fiche (spec §9), que le focus soit dans la liste ou dans la fiche.
    const onEscape = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || this.selection === null) return;
      e.preventDefault();
      this.close();
    };
    roots.list.addEventListener('keydown', onEscape);
    roots.fiche.addEventListener('keydown', onEscape);
    roots.tabs.addEventListener('click', (e) => {
      const tab = e.target instanceof Element ? e.target.closest<HTMLElement>('[data-tab]')?.dataset.tab : undefined;
      if (tab === 'list' || tab === 'map' || tab === 'fiche') this.setTab(tab);
    });
  }

  update(data: PosteData): void {
    this.data = data;
    this.rebuild();
  }

  /** null : modules d'événements non chargés → « indisponible », jamais un chargement sans fin. */
  setEvents(state: IntelEventsState | null): void {
    this.events = state ?? unavailableEventsState(Date.now());
    this.rebuild();
  }

  setBrief(brief: StructuredBrief, freshness: 'fresh' | 'cached', situationIds: readonly string[]): void {
    this.brief = { brief, freshness };
    this.briefSituationIds = [...situationIds];
    this.render();
  }

  setBriefPending(): void {
    this.brief = null;
    this.render();
  }

  setResolved(items: readonly BriefSourceSituation[]): void {
    this.resolved = [...items];
    this.render();
  }

  setBaseline(baseline: VisitBaseline | null): void {
    this.baseline = baseline;
    this.rebuild();
  }

  /** Niveaux affichés, enregistrés comme ligne de base de la prochaine visite. */
  currentLevels(): VisitBaseline {
    return this.queue ? levelsForBaseline(this.queue) : {};
  }

  setTheme(theme: ThemeId, opts: { silent?: boolean } = {}): void {
    if (theme === this.theme) return;
    this.theme = theme;
    this.showAll = false;
    this.selection = null; // un thème affiche sa propre fiche
    if (!opts.silent) this.callbacks.onThemeChange(theme);
    this.render();
  }

  select(key: string | null): void {
    this.selection = key;
    this.render();
    // Tablette et mobile : la fiche s'ouvre en volet, le focus la suit.
    if (key !== null && this.layout() !== 'desktop') this.fichePanel.focusClose();
  }

  close(): void {
    const key = this.selection;
    if (key === null) return;
    this.selection = null;
    this.render();
    if (!this.workList.focusRow(key)) this.fichePanel.focusHeading();
  }

  setTab(tab: PosteTab): void {
    this.tab = tab;
    if (tab === 'fiche') this.selection = null; // l'onglet « France » montre la fiche du pays ou du thème
    this.render();
  }

  private layout(): PosteLayout {
    return layoutFor(this.viewportWidth());
  }

  private rebuild(): void {
    const data = this.data;
    if (!data) return;
    const queue = buildWorkQueue({
      situations: data.snapshot.situations,
      alerts: data.alerts,
      events: this.events,
      ecowatt: data.ecowatt,
      meteo: data.meteo,
      floods: data.floods,
      markets: marketLines(data.markets, data.commodities),
      baseline: this.baseline,
      firstSeen: this.firstSeen,
      lang: data.lang,
    });
    this.trackAppearances(queue, data.now);
    this.queue = queue;
    this.render();
  }

  /** Heure d'apparition des éléments nouveaux pendant la session, après la chauffe du démarrage. */
  private trackAppearances(queue: WorkQueue, now: number): void {
    this.warmupUntil ??= now + WARMUP_MS;
    const warming = now < this.warmupUntil;
    for (const item of queue.items) {
      if (this.knownKeys.has(item.key)) continue;
      this.knownKeys.add(item.key);
      if (!warming) this.firstSeen.set(item.key, now);
    }
  }

  private render(): void {
    const data = this.data;
    const queue = this.queue;
    if (!data || !queue) return;
    const { lang, now } = data;
    const national = data.ready ? scoreLevel(data.snapshot.score) : null;
    const drivers = national ? drivingThemes(queue.themeLevels, national) : [];

    // La fiche d'abord : un élément sélectionné qui a disparu ramène à la fiche par défaut, et
    // la liste doit alors être rendue sans sélection.
    const active = document.activeElement;
    const ficheHadFocus = active instanceof HTMLElement && this.roots.fiche.contains(active);
    let model = this.selection === null ? null : this.ficheFor(this.selection, data, queue, drivers);
    const vanished = this.selection !== null && model === null;
    if (vanished) this.selection = null;
    model ??= this.defaultFiche(data, queue, drivers);
    if (!data.ready && (model.key === 'france' || model.key.startsWith('theme:'))) {
      model = { ...model, level: null, driver: lang === 'fr' ? 'niveau en cours de calcul' : 'level being computed' };
    }
    this.fichePanel.render(model, lang, this.selection !== null);
    this.callbacks.onFicheRendered(this.fichePanel.getBody());
    if (vanished && ficheHadFocus) this.fichePanel.focusHeading();

    const history = this.events && !(this.events.unavailable && this.events.events.length === 0) ? this.events : null;
    this.statusBar.update({
      level: national,
      drivenBy: national ? drivenByText(drivers, lang) : '',
      trend: national ? trendText(data.score.delta24h, lang) : '',
      visit: history
        ? { firstVisit: history.anchor.kind === 'default', since: durationLabel(now - history.anchor.since, lang), ...visitCounts(queue) }
        : null,
      freshness: freshnessCounts(data.sources),
      lang,
    });
    this.themeBar.update({ selected: this.theme, levels: national ? { general: national, ...queue.themeLevels } : null, lang });
    this.workList.update({ view: viewWorkQueue(queue, this.theme, this.showAll), selectedKey: this.selection, ready: data.ready, lang, now });
    this.renderTabs(lang);
    this.roots.app.dataset.v2Tab = this.tab;
    this.roots.app.dataset.v2Fiche = this.selection === null ? 'default' : 'open';
  }

  private freshness(data: PosteData): string {
    return freshnessText(freshnessCounts(data.sources), data.lang);
  }

  private franceFiche(data: PosteData, queue: WorkQueue, drivers: readonly ThemeId[]): FicheModel {
    return buildFranceFiche({
      snapshot: data.snapshot,
      queue,
      drivers,
      brief: this.brief,
      briefSituationIds: this.briefSituationIds,
      events: this.events,
      resolved: this.resolved,
      changeTimes: this.firstSeen,
      score: data.score,
      freshness: this.freshness(data),
      whyOpen: this.whyOpen.has('france'),
      lang: data.lang,
      now: data.now,
    });
  }

  /** « Vue générale » : la France ; un thème : sa fiche (spec §6.1, §7.3). */
  private defaultFiche(data: PosteData, queue: WorkQueue, drivers: readonly ThemeId[]): FicheModel {
    const theme = this.theme;
    if (theme === 'general') return this.franceFiche(data, queue, drivers);
    return buildThemeFiche({
      theme,
      queue,
      snapshot: data.snapshot,
      events: this.events,
      changeTimes: this.firstSeen,
      freshness: this.freshness(data),
      whyOpen: this.whyOpen.has(`theme:${theme}`),
      lang: data.lang,
    });
  }

  private ficheFor(key: string, data: PosteData, queue: WorkQueue, drivers: readonly ThemeId[]): FicheModel | null {
    const { lang, now } = data;
    const whyOpen = this.whyOpen.has(key);
    if (key === 'france') return this.franceFiche(data, queue, drivers);
    const item = queue.items.find((i) => i.key === key);
    if (key.startsWith('event:')) {
      const id = Number(key.slice('event:'.length));
      // Une preuve peut citer un événement hors de la liste (non corroboré) : il reste consultable.
      const event = item?.ref.kind === 'event' ? item.ref.event : this.events?.events.find((e) => e.id === id);
      if (!event) return null;
      this.ensureEventDetail(event.id);
      return buildEventFiche({ event, detail: this.eventDetails.get(event.id), whyOpen, lang, now });
    }
    if (key.startsWith('situation:')) {
      const id = key.slice('situation:'.length);
      const situation = item?.ref.kind === 'situation' ? item.ref.situation : data.snapshot.situations.find((s) => s.id === id);
      if (!situation) return null;
      return buildSituationFiche({
        situation, kind: 'situation', badge: item?.badge ?? null, changeAt: this.firstSeen.get(key) ?? null,
        hasDossier: situation.type === 'WILDFIRE_ESCALATION', whyOpen, lang,
      });
    }
    if (item?.ref.kind === 'alert') {
      const situation = item.ref.situation;
      return buildSituationFiche({
        situation, kind: 'alert', badge: item.badge, changeAt: this.firstSeen.get(key) ?? null,
        hasDossier: situation.type === 'MILITARY_SURGE_ALERT' || situation.type === 'WILDFIRE_ESCALATION', whyOpen, lang,
      });
    }
    if (item?.ref.kind === 'official') return buildOfficialFiche(item.ref.group, { freshness: this.freshness(data), whyOpen, lang });
    if (item?.ref.kind === 'market') return buildMarketFiche(item.ref.line, { whyOpen, lang });
    return null;
  }

  private ensureEventDetail(id: number): void {
    if (this.eventDetails.has(id)) return;
    if (this.eventDetails.size >= MAX_EVENT_DETAILS) {
      const oldest = this.eventDetails.keys().next();
      if (!oldest.done) this.eventDetails.delete(oldest.value);
    }
    this.eventDetails.set(id, 'loading');
    void fetchEventDetail(id).then((detail) => {
      this.eventDetails.set(id, detail ?? 'error');
      this.render();
    });
  }

  private runAction(action: string, ficheKey: string): void {
    const data = this.data;
    if (!data) return;
    const toMap = (): void => {
      if (this.layout() === 'mobile') this.setTab('map');
    };
    if (action === 'report') {
      this.callbacks.onOpenReport();
      return;
    }
    if (action === 'show-france') {
      this.callbacks.onShowFrance();
      toMap();
      return;
    }
    if (action === 'show-theme') {
      this.callbacks.onThemeChange(this.theme);
      toMap();
      return;
    }
    const item = this.queue?.items.find((i) => i.key === ficheKey);
    if (action === 'show-layer' && item?.ref.kind === 'official') {
      this.callbacks.onActivateLayers(item.ref.group.source === 'ecowatt' ? ['powerGrid'] : ['environmental']);
      toMap();
      return;
    }
    const situation = item?.ref.kind === 'situation' || item?.ref.kind === 'alert'
      ? item.ref.situation
      : data.snapshot.situations.find((s) => `situation:${s.id}` === ficheKey);
    if (action === 'dossier' && situation) {
      this.callbacks.onOpenDossier(situation);
      return;
    }
    if (action !== 'map') return;
    if (situation) {
      if (situation.activateLayers && situation.activateLayers.length > 0) this.callbacks.onActivateLayers(situation.activateLayers);
      if (situation.lon != null && situation.lat != null) this.callbacks.onFlyTo(situation.lon, situation.lat, 10);
    } else if (ficheKey.startsWith('event:')) {
      const id = Number(ficheKey.slice('event:'.length));
      const event = this.events?.events.find((e) => e.id === id);
      if (event && event.lon !== null && event.lat !== null) this.callbacks.onFlyTo(event.lon, event.lat, 10);
    }
    toMap();
  }

  private renderTabs(lang: Lang): void {
    const ficheLabel = this.theme === 'general' ? 'France' : themeLabel(this.theme, lang);
    const tabs: Array<[PosteTab, string]> = [
      ['list', lang === 'fr' ? 'À traiter' : 'To handle'],
      ['map', lang === 'fr' ? 'Carte' : 'Map'],
      ['fiche', ficheLabel],
    ];
    const html = `<div class="v2-tabs" role="tablist">${tabs.map(([id, label]) => {
      const on = this.tab === id;
      return `<button type="button" role="tab" class="v2-tab${on ? ' is-on' : ''}" data-tab="${id}" aria-selected="${on ? 'true' : 'false'}">${escapeHtml(label)}</button>`;
    }).join('')}</div>`;
    if (html === this.lastTabsHtml) return;
    const active = document.activeElement;
    const focused = active instanceof HTMLElement && this.roots.tabs.contains(active) ? active.dataset.tab : undefined;
    this.roots.tabs.innerHTML = html;
    this.lastTabsHtml = html;
    if (focused) this.roots.tabs.querySelector<HTMLElement>(`[data-tab="${focused}"]`)?.focus({ preventScroll: true });
  }
}
