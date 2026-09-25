import { Panel } from './Panel.ts';
import { fmLoaderHTML } from './shared/loader.ts';
import type { BarometerWidget } from './BarometerWidget.ts';
import type {
  FranceCountrySnapshot,
  IntelEventsState,
  DetectedSituation,
  StructuredBrief,
} from '../types/index.ts';
import { renderChangesSection, renderEventsSection, resolveEvidenceRef, unavailableEventsState, type EventDetailState } from './france-intel-events.ts';
import { fetchEventDetail } from '../services/news-events.ts';
import { getDelta24h, getPillarDeltas24h, getSparklineSeries } from '../utils/stability-history.ts';
import { renderScoreCard, renderSituationRow } from './france-intel-score.ts';
import { renderDomainsBlock, renderEnergyBlock, renderTimelineBlock } from './france-intel-blocks.ts';
import { briefConfidenceLabel } from '../services/vigilance.ts';

const FLASH_MS = 1500;

function t(lang: 'fr' | 'en', fr: string, en: string): string {
  return lang === 'fr' ? fr : en;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  // Le résultat est aussi injecté en contexte attribut (title="…", data-sit-id="…") : échapper guillemets/apostrophes.
  return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export class FranceIntelPanel extends Panel {
  private modalEl!: HTMLElement;
  private contentEl: HTMLElement | null = null;
  private onClose?: () => void;
  private isOpen = false;
  private currentLang: 'fr' | 'en' = 'fr';
  private briefState: { brief: StructuredBrief; freshness: 'fresh' | 'cached' } | null = null;
  private infrastructureWidget: BarometerWidget | null = null;
  private lastSnapshot: FranceCountrySnapshot | null = null;
  private expandedSituations = new Set<string>();
  private situationsInitialized = false;
  private eventsState: IntelEventsState | null = null;
  /** Événements dépliés (articles chargés à la demande), communs aux deux listes. */
  private eventDetails = new Map<number, EventDetailState>();
  /** Preuve mise en évidence ; gardée en état car le panneau est souvent reconstruit en entier. */
  private flash: { ref: string; until: number } | null = null;
  /** Situations numérotées S1…S5 au moment du brief affiché (briefSituationIds). */
  private briefSituationIds: string[] = [];
  /** Volet « Pourquoi ce niveau ? » ouvert ; état hors du DOM, le contenu est reconstruit en continu. */
  private scoreWhyOpen = false;

  constructor(container: HTMLElement) {
    super(container, { title: 'France Intelligence', icon: '🇫🇷', collapsible: false });
  }

  mount(): void {
    this.modalEl = document.createElement('aside');
    this.modalEl.className = 'frintel-drawer';
    this.modalEl.setAttribute('aria-hidden', 'true');
    this.modalEl.innerHTML = `
      <div class="frintel-shell">
        <header class="frintel-header">
          <div>
            <h2 class="frintel-title">France</h2>
            <div class="frintel-subtitle"><span class="frintel-subtitle-live fi-active-count"></span></div>
          </div>
          <div class="frintel-header-actions">
            <span class="frintel-updated fi-updated"></span>
            <button type="button" class="frintel-action fi-lang-toggle">FR</button>
            <button type="button" class="frintel-close fi-close" aria-label="Fermer">×</button>
          </div>
        </header>
        <div class="frintel-content"></div>
      </div>
    `;

    this.contentEl = this.modalEl.querySelector('.frintel-content');
    this.container.appendChild(this.modalEl);
    // Délégation : le contenu est reconstruit par innerHTML à chaque rafraîchissement.
    this.contentEl?.addEventListener('click', (e) => this.handleEventsClick(e));
    // `toggle` ne remonte pas : écoute en capture sur le conteneur.
    this.contentEl?.addEventListener('toggle', (e) => {
      const target = e.target;
      if (target instanceof HTMLDetailsElement && target.classList.contains('frintel-why')) {
        this.scoreWhyOpen = target.open;
      }
    }, true);

    const closeBtn = this.modalEl.querySelector('.fi-close') as HTMLButtonElement | null;
    closeBtn?.addEventListener('click', () => this.hide());

    const langBtn = this.modalEl.querySelector('.fi-lang-toggle') as HTMLButtonElement | null;
    langBtn?.addEventListener('click', () => {
      const next = this.currentLang === 'fr' ? 'en' : 'fr';
      langBtn.textContent = next.toUpperCase();
      document.dispatchEvent(new CustomEvent('france-intel-lang-toggle', {
        detail: { lang: next },
      }));
    });
  }

  protected render(): void {}

  setOnClose(handler: () => void): void {
    this.onClose = handler;
  }

  setInfrastructureWidget(widget: BarometerWidget | null): void {
    this.infrastructureWidget = widget;
  }

  getCurrentLang(): 'fr' | 'en' {
    return this.currentLang;
  }

  isVisible(): boolean {
    return this.isOpen;
  }

  show(snapshot: FranceCountrySnapshot): void {
    if (!this.contentEl) return;
    this.lastSnapshot = snapshot;
    const preservedScrollTop = this.isOpen ? this.contentEl.scrollTop : 0;
    this.currentLang = snapshot.briefLang;
    const langBtn = this.modalEl.querySelector('.fi-lang-toggle');
    if (langBtn) langBtn.textContent = this.currentLang.toUpperCase();
    this.renderContent(snapshot);
    this.mountInfrastructureWidget();
    this.contentEl.scrollTop = preservedScrollTop;
    this.isOpen = true;
    this.modalEl.classList.add('active');
    this.modalEl.setAttribute('aria-hidden', 'false');
  }

  hide(opts: { silent?: boolean } = {}): void {
    this.isOpen = false;
    this.modalEl.classList.remove('active');
    this.modalEl.setAttribute('aria-hidden', 'true');
    // Masquage « silencieux » (bascule entre panneaux) : ne désactive pas la couche.
    if (!opts.silent) this.onClose?.();
  }

  resetBrief(): void {
    this.briefState = null;
    this.renderBriefSection();
  }

  showBriefLoading(): void {
    this.briefState = null;
    this.renderBriefSection();
  }

  updateBrief(brief: StructuredBrief, freshness: 'fresh' | 'cached', situationIds: string[] = []): void {
    this.briefState = { brief, freshness };
    this.briefSituationIds = situationIds;
    this.renderBriefSection();
    // Les preuves citées doivent rester consultables dans la liste d'événements.
    this.renderEventsSections();
  }

  updateEvents(state: IntelEventsState): void {
    this.eventsState = state;
    this.renderEventsSections();
  }

  /** Modules d'événements non chargés : message explicite plutôt qu'un chargement sans fin. */
  markEventsUnavailable(): void {
    this.updateEvents(unavailableEventsState(Date.now()));
  }

  destroy(): void {
    this.modalEl?.remove();
  }

  /**
   * Le panneau est reconstruit à chaque mise à jour de données (des dizaines de fois au
   * démarrage) : chaque rendu rend le focus clavier à l'équivalent recréé de l'élément focalisé.
   */
  private renderContent(snapshot: FranceCountrySnapshot): void {
    this.preservingFocus(() => this.renderContentNow(snapshot));
  }

  private renderContentNow(snapshot: FranceCountrySnapshot): void {
    if (!this.contentEl) return;
    const lang = snapshot.briefLang;

    const activeCount = snapshot.situations.length;
    const countEl = this.modalEl.querySelector('.fi-active-count');
    if (countEl) {
      countEl.textContent = activeCount > 0
        ? `${activeCount} ${t(lang, activeCount > 1 ? 'situations actives' : 'situation active', activeCount > 1 ? 'active situations' : 'active situation')}`
        : t(lang, 'aucune situation active', 'no active situation');
    }
    const updatedEl = this.modalEl.querySelector('.fi-updated');
    if (updatedEl) {
      updatedEl.textContent = `MAJ ${new Date(snapshot.stability.timestamp).toLocaleTimeString(
        lang === 'fr' ? 'fr-FR' : 'en-US',
        { hour: '2-digit', minute: '2-digit' },
      )}`;
    }

    this.contentEl.innerHTML = `
      ${this.renderScoreBlock(snapshot, lang)}
      <section class="frintel-card">
        <div class="frintel-card-top">
          <div class="frintel-card-title">${t(lang, 'Depuis votre dernière visite', 'Since your last visit')}</div>
          <div class="frintel-card-meta fi-changes-meta"></div>
        </div>
        <div class="fi-changes-body"></div>
      </section>
      ${this.renderSituationsBlock(snapshot.situations, lang)}
      <section class="frintel-card">
        <div class="frintel-card-top">
          <div class="frintel-card-title">${t(lang, 'Brief renseignement', 'Intelligence Brief')}</div>
          <div class="frintel-card-meta fi-brief-meta"></div>
        </div>
        <div class="frintel-brief-body fi-brief-body"></div>
      </section>
      <section class="frintel-card">
        <div class="frintel-card-top">
          <div class="frintel-card-title">${t(lang, 'Événements consolidés', 'Consolidated events')}</div>
          <div class="frintel-card-meta fi-events-meta"></div>
        </div>
        <div class="fi-events-body"></div>
      </section>
      <div class="fi-infra-widget-slot"></div>
      ${renderDomainsBlock(snapshot, lang)}
      ${renderEnergyBlock(snapshot.energy, lang)}
      ${renderTimelineBlock(snapshot.timeline, lang)}
    `;

    this.bindSituationToggles();
    this.renderBriefSection();
    this.renderEventsSections();
  }

  private renderEventsSections(): void {
    this.preservingFocus(() => this.renderEventsSectionsNow());
  }

  private renderEventsSectionsNow(): void {
    const lang = this.currentLang;
    const now = Date.now();
    const pinned = new Set(this.briefState?.brief.judgments.flatMap((j) => j.evidence) ?? []);
    const sections: Array<[string, { meta: string; body: string }]> = [
      ['changes', renderChangesSection(this.eventsState, lang, now, this.eventDetails)],
      ['events', renderEventsSection(this.eventsState, lang, now, this.eventDetails, pinned)],
    ];
    for (const [key, html] of sections) {
      const meta = this.modalEl.querySelector(`.fi-${key}-meta`);
      const body = this.modalEl.querySelector(`.fi-${key}-body`);
      if (!meta || !body) continue;
      meta.textContent = html.meta;
      body.innerHTML = html.body || fmLoaderHTML({ text: t(lang, 'Chargement des événements…', 'Loading events…'), variant: 'inline' });
    }
    this.applyFlash();
  }

  private handleEventsClick(e: MouseEvent): void {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) return;
    const ref = target.closest<HTMLElement>('[data-evidence]')?.dataset.evidence;
    if (ref) {
      this.focusEvidence(ref);
      return;
    }
    const head = target.closest<HTMLElement>('.frintel-ev-head');
    const id = Number(head?.closest<HTMLElement>('[data-event-id]')?.dataset.eventId);
    if (!head || !Number.isSafeInteger(id)) return;
    head.focus({ preventScroll: true }); // Safari ne focalise pas un bouton cliqué à la souris
    void this.toggleEvent(id);
  }

  private async toggleEvent(id: number): Promise<void> {
    if (this.eventDetails.has(id)) {
      this.eventDetails.delete(id);
      this.renderEventsSections();
      return;
    }
    this.eventDetails.set(id, 'loading');
    this.renderEventsSections();
    const detail = await fetchEventDetail(id);
    if (!this.eventDetails.has(id)) return; // replié pendant le chargement
    this.eventDetails.set(id, detail ?? 'error');
    this.renderEventsSections();
  }

  private preservingFocus(render: () => void): void {
    const selector = this.focusedSelector();
    render();
    if (selector) this.contentEl?.querySelector<HTMLElement>(selector)?.focus({ preventScroll: true });
  }

  /** Sélecteur stable de l'élément focalisé (événement, situation ou preuve), null sinon. */
  private focusedSelector(): string | null {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || !this.contentEl?.contains(el)) return null;
    if (el.matches('.frintel-why > summary')) return '.frintel-why > summary';
    if (el.dataset.evidence) return `.frintel-ev-ref[data-evidence="${CSS.escape(el.dataset.evidence)}"]`;
    const eventId = el.closest<HTMLElement>('[data-event-id]')?.dataset.eventId;
    if (eventId && el.classList.contains('frintel-ev-head')) {
      const section = el.closest('.fi-changes-body') ? 'changes' : 'events';
      return `.fi-${section}-body [data-event-id="${CSS.escape(eventId)}"] .frintel-ev-head`;
    }
    const sitId = el.closest<HTMLElement>('[data-sit-id]')?.dataset.sitId;
    if (sitId && el.classList.contains('frintel-sit-head')) return `[data-sit-id="${CSS.escape(sitId)}"] .frintel-sit-head`;
    return null;
  }

  /** E42 → ligne de l'événement ; S2 → deuxième situation telle que numérotée au moment du brief. */
  private findEvidenceElement(ref: string): HTMLElement | null {
    if (!this.contentEl) return null;
    const target = resolveEvidenceRef(ref, this.briefSituationIds);
    if (!target) return null;
    return target.kind === 'event'
      ? this.contentEl.querySelector<HTMLElement>(`.fi-events-body [data-event-id="${CSS.escape(String(target.id))}"]`)
      : this.contentEl.querySelector<HTMLElement>(`[data-sit-id="${CSS.escape(target.id)}"]`);
  }

  private focusEvidence(ref: string): void {
    const el = this.findEvidenceElement(ref);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    this.flash = { ref, until: Date.now() + FLASH_MS };
    this.applyFlash();
    window.setTimeout(() => this.applyFlash(), FLASH_MS);
  }

  private applyFlash(): void {
    this.contentEl?.querySelectorAll('.is-flash').forEach((node) => node.classList.remove('is-flash'));
    if (this.flash && Date.now() < this.flash.until) this.findEvidenceElement(this.flash.ref)?.classList.add('is-flash');
    else this.flash = null;
  }

  private renderScoreBlock(snapshot: FranceCountrySnapshot, lang: 'fr' | 'en'): string {
    return renderScoreCard({
      breakdown: snapshot.scoreBreakdown,
      delta24h: getDelta24h(),
      pillarDeltas: getPillarDeltas24h(),
      series: getSparklineSeries(),
      lang,
      whyOpen: this.scoreWhyOpen,
    });
  }

  private renderSituationsBlock(situations: DetectedSituation[], lang: 'fr' | 'en'): string {
    if (!this.situationsInitialized && situations.length > 0) {
      this.expandedSituations.add(situations[0].id);
      this.situationsInitialized = true;
    }

    const rows = situations
      .map((s) => renderSituationRow(s, lang, this.expandedSituations.has(s.id)))
      .join('');

    return `
      <section class="frintel-card">
        <div class="frintel-card-top">
          <div class="frintel-card-title frintel-card-title-accent">${t(lang, 'Situations corrélées', 'Correlated Situations')}</div>
          <div class="frintel-card-meta">${situations.length > 0
            ? `${situations.length} ${t(lang, situations.length > 1 ? 'actives' : 'active', 'active')}`
            : ''}</div>
        </div>
        ${situations.length > 0
          ? `<div class="frintel-sit-list">${rows}</div>`
          : `<div class="frintel-empty">${t(lang, 'Aucune situation corrélée active.', 'No active correlated situation.')}</div>`}
      </section>
    `;
  }

  private bindSituationToggles(): void {
    if (!this.contentEl || !this.lastSnapshot) return;
    this.contentEl.querySelectorAll('.frintel-sit-head').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = (btn.closest('.frintel-sit') as HTMLElement | null)?.dataset.sitId;
        if (!id || !this.lastSnapshot || !this.contentEl) return;
        if (this.expandedSituations.has(id)) this.expandedSituations.delete(id);
        else this.expandedSituations.add(id);
        const scrollTop = this.contentEl.scrollTop;
        this.renderContent(this.lastSnapshot);
        // Le re-render recrée un slot infra vide : re-monter le widget immédiatement.
        this.mountInfrastructureWidget();
        this.contentEl.scrollTop = scrollTop;
        // Le re-render détruit le bouton qui portait le focus clavier : le restaurer
        // sur son équivalent recréé pour ne pas renvoyer l'utilisateur clavier au body.
        const head = this.contentEl.querySelector<HTMLButtonElement>(`[data-sit-id="${CSS.escape(id)}"] .frintel-sit-head`);
        head?.focus();
      });
    });
  }

  private mountInfrastructureWidget(): void {
    const slot = this.modalEl.querySelector('.fi-infra-widget-slot') as HTMLElement | null;
    if (!slot || !this.infrastructureWidget) return;
    this.infrastructureWidget.attachTo(slot);
  }

  private renderBriefSection(): void {
    const body = this.modalEl.querySelector('.fi-brief-body');
    const meta = this.modalEl.querySelector('.fi-brief-meta');
    if (!body || !meta) return;
    const lang = this.currentLang;

    if (this.briefState === null) {
      meta.textContent = t(lang, 'Génération…', 'Generating…');
      body.innerHTML = fmLoaderHTML({ text: t(lang, 'Construction du brief national…', 'Building national brief…') });
      return;
    }

    const { brief, freshness } = this.briefState;
    // Horodatage au moment du rendu (spec §5) : un fallback déterministe n'est ni
    // "fresh" ni "cached", donc seule l'origine LLM porte la mention fraîcheur.
    const renderedAt = new Date().toLocaleTimeString(
      lang === 'fr' ? 'fr-FR' : 'en-US',
      { hour: '2-digit', minute: '2-digit' },
    );
    meta.textContent = brief.origin === 'llm'
      ? `${t(lang, 'IA', 'AI')} · ${freshness === 'fresh' ? t(lang, 'à jour', 'fresh') : t(lang, 'en cache', 'cached')} ${renderedAt}`
      : `${t(lang, 'Synthèse automatique', 'Automatic synthesis')} ${renderedAt}`;

    const judgments = brief.judgments.map((j) => `
      <div class="frintel-judgment">
        <span class="frintel-jd-badge frintel-jd-p${j.priority}">P${j.priority}</span>
        <div class="frintel-jd-main">
          <div class="frintel-jd-text">${escapeHtml(j.text)}</div>
          <div class="frintel-jd-foot">
            <span>
              <span class="frintel-jd-refs">${j.evidence.map((id) => `<button type="button" class="frintel-chip frintel-ev-ref" data-evidence="${escapeHtml(id)}">${escapeHtml(id)}</button>`).join('')}</span>
              <span class="frintel-jd-sources">${escapeHtml(j.sources.join(' · '))}</span>
            </span>
            <span>
              ${j.unsupported ? `<span class="frintel-jd-unsupported">${t(lang, 'Non étayé', 'Unsupported')}</span> ` : ''}
              <span class="frintel-jd-conf frintel-jd-conf-${j.confidence}">${briefConfidenceLabel(j.confidence, lang)}</span>
            </span>
          </div>
        </div>
      </div>
    `).join('');

    const watch = brief.watch.map((w) => `
      <div class="frintel-watch-item">
        <span class="frintel-chip frintel-watch-h">${escapeHtml(w.horizon.toUpperCase())}</span>
        <span class="frintel-watch-text">${escapeHtml(w.text)}</span>
      </div>
    `).join('');

    body.innerHTML = `
      <div class="frintel-bluf">
        <div class="frintel-bluf-kicker">${t(lang, "Évaluation d'ensemble", 'Overall assessment')}</div>
        <div class="frintel-bluf-text">${escapeHtml(brief.bluf)}</div>
      </div>
      <div class="frintel-jd-kicker">${t(lang, 'Jugements clés', 'Key judgments')}</div>
      ${judgments}
      ${brief.watch.length > 0 ? `
        <div class="frintel-watch">
          <div class="frintel-jd-kicker">${t(lang, 'À surveiller', 'Watch items')}</div>
          ${watch}
        </div>
      ` : ''}
    `;
  }
}
