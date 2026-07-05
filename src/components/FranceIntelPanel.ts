import { Panel } from './Panel.ts';
import { fmLoaderHTML } from './shared/loader.ts';
import type { BarometerWidget } from './BarometerWidget.ts';
import type {
  FranceCountrySnapshot,
  FranceIntelTimelineLane,
  MeteoVigilanceLevel,
  FranceScoreBreakdown,
  SituationSeverity,
  DetectedSituation,
} from '../types/index.ts';
import {
  filterFuelPriceSeries,
  formatFuelDeltaCents,
  formatFuelPrice,
  renderFuelPriceChartSvg,
} from '../utils/fuelPriceChart.ts';
import { getDelta24h, getPillarDeltas24h, getSparklineSeries } from '../utils/stability-history.ts';

const VIGILANCE_LABELS: Record<MeteoVigilanceLevel, string> = {
  green: 'Vert',
  yellow: 'Jaune',
  orange: 'Orange',
  red: 'Rouge',
  violet: 'Violet',
};

const RISK_LABELS: Record<string, string> = {
  wind: 'Vent',
  'rain-flood': 'Pluie-inondation',
  thunderstorm: 'Orages',
  flood: 'Crues',
  'snow-ice': 'Neige-verglas',
  heat: 'Canicule',
  cold: 'Grand froid',
  avalanche: 'Avalanches',
  'wave-surge': 'Vagues-submersion',
};

function t(lang: 'fr' | 'en', fr: string, en: string): string {
  return lang === 'fr' ? fr : en;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}


// ─── Bandes du score v3 (spec §4.3) ─────────────────────────────────────────

function scoreBandLabel(score: number, lang: 'fr' | 'en'): string {
  if (score >= 85) return 'STABLE';
  if (score >= 70) return 'VIGILANCE';
  if (score >= 55) return t(lang, 'SOUS TENSION', 'UNDER PRESSURE');
  if (score >= 40) return t(lang, 'DÉGRADÉ', 'DEGRADED');
  return t(lang, 'CRITIQUE', 'CRITICAL');
}

function scoreBandColor(score: number): string {
  if (score >= 85) return 'var(--threat-low)';
  if (score >= 70) return 'var(--threat-medium)';
  if (score >= 55) return 'var(--meteo-orange)';
  if (score >= 40) return 'var(--threat-high)';
  return 'var(--threat-critical-text)';
}

const SEVERITY_COLORS: Record<SituationSeverity, string> = {
  critical: 'var(--threat-critical)',
  high: 'var(--threat-high)',
  medium: 'var(--threat-medium)',
  watch: 'var(--threat-info)',
};

// Ordre du tableau RULES du situation-engine — cosmétique, stable entre sessions.
const SIT_CODES: Record<string, string> = {
  'energy-stress': 'SIT-01',
  'import-dependency-risk': 'SIT-02',
  'flood-crisis': 'SIT-03',
  'wildfire-escalation': 'SIT-04',
  'cyber-pressure': 'SIT-05',
  'social-escalation': 'SIT-06',
  'telecom-disruption': 'SIT-07',
  'maritime-anomaly': 'SIT-08',
  'defense-signal-elevated': 'SIT-09',
  'fuel-supply-risk': 'SIT-10',
};

function sitCode(id: string): string {
  return SIT_CODES[id] ?? 'SIT-00';
}

const PILLAR_UI: Array<{ key: FranceScoreBreakdown['pillars'][number]['key']; fr: string; en: string }> = [
  { key: 'continuity', fr: 'CONTINUITÉ', en: 'CONTINUITY' },
  { key: 'security', fr: 'SÉCURITÉ', en: 'SECURITY' },
  { key: 'signal', fr: 'SIGNAL', en: 'SIGNAL' },
  { key: 'defense', fr: 'DÉFENSE', en: 'DEFENSE' },
];

function pillarBarColor(value: number): string {
  if (value >= 55) return 'var(--meteo-orange)';
  if (value >= 35) return 'var(--threat-medium)';
  return 'var(--threat-low)';
}

function formatDelta(delta: number | null | undefined): string {
  if (delta == null) return '—';
  if (delta > 0) return `+${delta} ▲`;
  if (delta < 0) return `−${Math.abs(delta)} ▼`;
  return '0 ·';
}

function deltaColor(delta: number | null | undefined, invert = false): string {
  if (delta == null || delta === 0) return 'var(--text-muted)';
  const worse = invert ? delta < 0 : delta > 0;
  return worse ? 'var(--threat-high)' : 'var(--threat-low)';
}

type BriefSection = {
  heading: string | null;
  body: string;
};

const BRIEF_COLLAPSED_LINES = 16;
const BRIEF_COLLAPSED_MAX_HEIGHT_PX = 336;
const INLINE_BRIEF_SECTION_TITLES = [
  'ANALYSE',
  'ANALYSIS',
  'À SURVEILLER (6H)',
  'NEXT 6 HOURS TO WATCH',
  'SITUATION ACTUELLE',
  'CURRENT SITUATION',
  'POINTS DE PRESSION',
  'PRESSURE POINTS',
] as const;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeBriefText(text: string): string {
  let normalized = text.replace(/\r\n/g, '\n');

  for (const title of INLINE_BRIEF_SECTION_TITLES) {
    const escapedTitle = escapeRegExp(title);
    normalized = normalized.replace(
      new RegExp(`\\s*(${escapedTitle})(?=\\s+|\\n|$)`, 'g'),
      '\n$1\n',
    );
  }

  return normalized
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function normalizeBriefLine(line: string): string {
  return line
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/^[\s:•\-*]+/, '')
    .trim();
}

function isBriefHeading(line: string): boolean {
  return /^[A-ZÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸ0-9\s'’:/()-]{4,}$/.test(line);
}

function formatBriefHeading(line: string): string {
  const normalized = normalizeBriefLine(line).replace(/\s+/g, ' ').trim();
  const headingMap: Record<string, string> = {
    'situation actuelle': 'Situation actuelle',
    'points de pression': 'Points de pression',
    analyse: 'Analyse',
    'à surveiller (6h)': 'À surveiller (6h)',
    'current situation': 'Current situation',
    'pressure points': 'Pressure points',
    analysis: 'Analysis',
    'next 6 hours to watch': 'Next 6 Hours To Watch',
    'points de vigilance': 'Points de vigilance',
    'ce que cela implique': 'Ce que cela implique',
    'what this means': 'What this means',
  };

  const key = normalized.toLocaleLowerCase('fr-FR');
  if (headingMap[key]) return headingMap[key];

  const lower = normalized.toLocaleLowerCase('fr-FR');
  return lower.charAt(0).toLocaleUpperCase('fr-FR') + lower.slice(1);
}

function splitBriefHeadingLine(line: string): { heading: string; body: string } | null {
  const match = line.match(/^((?:\d+[.)]\s*)?[A-ZÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸ0-9\s'’/()-]{4,})\s*:\s+(.+)$/);
  if (!match) return null;

  const heading = match[1].replace(/^\d+[.)]\s*/, '').trim();
  const body = match[2].trim();
  if (!heading || !body || !isBriefHeading(heading)) return null;
  return { heading, body };
}

function parseBriefSections(text: string): BriefSection[] {
  const rawLines = normalizeBriefText(text).split('\n').map(normalizeBriefLine).filter(Boolean);
  const sections: BriefSection[] = [];
  let currentSection: { heading: string | null; lines: string[] } | null = null;

  const pushCurrentSection = () => {
    if (!currentSection) return;
    const body = currentSection.lines.join(' ').replace(/\s+/g, ' ').trim();
    if (!currentSection.heading && !body) return;
    sections.push({
      heading: currentSection.heading,
      body,
    });
  };

  for (const line of rawLines) {
    const splitLine = splitBriefHeadingLine(line);
    if (splitLine) {
      pushCurrentSection();
      currentSection = {
        heading: formatBriefHeading(splitLine.heading),
        lines: [splitLine.body],
      };
      continue;
    }

    if (isBriefHeading(line)) {
      pushCurrentSection();
      currentSection = {
        heading: formatBriefHeading(line),
        lines: [],
      };
      continue;
    }

    if (!currentSection) {
      currentSection = { heading: null, lines: [line] };
    } else {
      currentSection.lines.push(line);
    }
  }

  pushCurrentSection();
  return sections;
}

function formatBriefHtml(sections: BriefSection[]): string {
  return sections
    .map((section) => {
      const heading = section.heading
        ? `<div class="frintel-brief-kicker">${escapeHtml(section.heading)}</div>`
        : '';
      const body = section.body
        ? `<p class="frintel-brief-paragraph">${escapeHtml(section.body)}</p>`
        : '';
      return `<section class="frintel-brief-section">${heading}${body}</section>`;
    })
    .join('');
}

function intensity(count: number): number {
  if (count <= 0) return 0.08;
  if (count === 1) return 0.25;
  if (count === 2) return 0.45;
  if (count === 3) return 0.65;
  return 0.9;
}

function renderTimelineLane(lane: FranceIntelTimelineLane): string {
  return `
    <div class="frintel-timeline-row">
      <div class="frintel-timeline-label">${escapeHtml(lane.label)}</div>
      <div class="frintel-timeline-track">
        ${lane.counts.map((count) => `
          <span
            class="frintel-timeline-cell"
            title="${escapeHtml(`${lane.label}: ${count}`)}"
            style="--fi-timeline-color:${lane.color};--fi-timeline-alpha:${intensity(count)};"
          >${count > 0 ? count : ''}</span>
        `).join('')}
      </div>
    </div>
  `;
}

export class FranceIntelPanel extends Panel {
  private modalEl!: HTMLElement;
  private contentEl: HTMLElement | null = null;
  private onClose?: () => void;
  private isOpen = false;
  private currentLang: 'fr' | 'en' = 'fr';
  private briefState: { text: string | null; freshness: 'fresh' | 'cached' } | null = null;
  private briefExpanded = false;
  private infrastructureWidget: BarometerWidget | null = null;
  private lastSnapshot: FranceCountrySnapshot | null = null;
  private expandedSituations = new Set<string>();
  private situationsInitialized = false;

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
            <h2 class="frintel-title">FRANCE</h2>
            <div class="frintel-subtitle">Country Intelligence · <span class="frintel-subtitle-live fi-active-count"></span></div>
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

  hide(): void {
    this.isOpen = false;
    this.modalEl.classList.remove('active');
    this.modalEl.setAttribute('aria-hidden', 'true');
    this.onClose?.();
  }

  resetBrief(): void {
    this.briefState = null;
    this.briefExpanded = false;
    this.renderBriefSection();
  }

  showBriefLoading(): void {
    this.briefState = null;
    this.briefExpanded = false;
    this.renderBriefSection();
  }

  updateBrief(brief: string | null, freshness: 'fresh' | 'cached'): void {
    this.briefState = { text: brief, freshness };
    this.briefExpanded = false;
    this.renderBriefSection();
  }

  destroy(): void {
    this.modalEl?.remove();
  }

  private renderContent(snapshot: FranceCountrySnapshot): void {
    if (!this.contentEl) return;
    const lang = snapshot.briefLang;

    const activeCount = snapshot.situations.length;
    const countEl = this.modalEl.querySelector('.fi-active-count');
    if (countEl) {
      countEl.textContent = activeCount > 0
        ? `${activeCount} ${t(lang, activeCount > 1 ? 'situations actives' : 'situation active', activeCount > 1 ? 'active situations' : 'active situation')}`
        : t(lang, 'surveillance nominale', 'nominal watch');
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
      ${this.renderSituationsBlock(snapshot.situations, lang)}
      <section class="frintel-card">
        <div class="frintel-card-top">
          <div class="frintel-card-title">${t(lang, 'Brief renseignement', 'Intelligence Brief')}</div>
          <div class="frintel-card-meta fi-brief-meta"></div>
        </div>
        <div class="frintel-brief-body fi-brief-body"></div>
        <button type="button" class="frintel-inline-action fi-brief-toggle" hidden></button>
      </section>
      <div class="fi-infra-widget-slot"></div>
      ${this.renderDomainsBlock(snapshot, lang)}
      ${this.renderEnergyBlock(snapshot, lang)}
      ${this.renderTimelineBlock(snapshot, lang)}
    `;

    this.bindSituationToggles();
    this.renderBriefSection();
  }

  private renderScoreBlock(snapshot: FranceCountrySnapshot, lang: 'fr' | 'en'): string {
    const bd = snapshot.scoreBreakdown;
    const score = bd.score;
    const tint = scoreBandColor(score);
    const delta24 = getDelta24h();
    const pillarDeltas = getPillarDeltas24h();
    const spark = this.renderScoreSparkline(getSparklineSeries(), score, lang);

    const pillarRows = PILLAR_UI.map(({ key, fr, en }) => {
      const pillar = bd.pillars.find((p) => p.key === key);
      if (!pillar) return '';
      const delta = pillarDeltas ? pillarDeltas[key] : null;
      return `
        <div class="frintel-pillar-label">${t(lang, fr, en)}</div>
        <div class="frintel-pillar-track"><span class="frintel-pillar-fill" style="width:${Math.min(100, pillar.value)}%;background:${pillarBarColor(pillar.value)};"></span></div>
        <div class="frintel-pillar-val">${pillar.value}</div>
        <div class="frintel-pillar-delta" style="color:${deltaColor(delta)};">${formatDelta(delta)}</div>
        <div class="frintel-pillar-ded">−${pillar.deduction.toFixed(1)}</div>
      `;
    }).join('');

    const dominant = [...bd.pillars].sort((a, b) => b.deduction - a.deduction)[0];
    const dominantUi = dominant ? PILLAR_UI.find((p) => p.key === dominant.key) : undefined;
    const whyParts = dominant && dominant.components.length > 0
      ? dominant.components.map((c) => `${escapeHtml(c.label)} ${c.value}`).join(' · ')
      : t(lang, 'pression diffuse de fond', 'diffuse background pressure');
    const whyLine = dominantUi
      ? `${t(lang, 'Facteur principal', 'Main factor')} : ${t(lang, dominantUi.fr, dominantUi.en)} — ${whyParts}`
      : '';
    const capLine = bd.situationCap != null
      ? `<div class="frintel-score-cap">${t(lang, `Plafonné à ${bd.situationCap} par situation active`, `Capped at ${bd.situationCap} by active situation`)}</div>`
      : '';

    return `
      <section class="frintel-card">
        <div class="frintel-card-top">
          <div class="frintel-card-title">${t(lang, 'Indice de stabilité', 'Stability Index')}</div>
          <div class="frintel-card-meta">${t(lang, 'Base 95 − pression temps réel', 'Baseline 95 − live pressure')}</div>
        </div>
        <div class="frintel-score-row">
          <div class="frintel-score-main">
            <div class="frintel-score-value" style="color:${tint};">${score}</div>
            <div class="frintel-score-band" style="color:${tint};">${scoreBandLabel(score, lang)}</div>
            <div class="frintel-score-delta">Δ24H <span style="color:${deltaColor(delta24, true)};">${formatDelta(delta24)}</span></div>
          </div>
          <div class="frintel-score-viz">
            <div class="frintel-gauge" role="img" aria-label="${t(lang, `Indice ${score} sur 100`, `Index ${score} out of 100`)}">
              <span class="frintel-gauge-zone" style="width:40%;background:var(--threat-critical);"></span>
              <span class="frintel-gauge-zone" style="width:15%;background:var(--threat-high);"></span>
              <span class="frintel-gauge-zone" style="width:15%;background:var(--meteo-orange);"></span>
              <span class="frintel-gauge-zone" style="width:15%;background:var(--threat-medium);"></span>
              <span class="frintel-gauge-zone" style="width:15%;background:var(--threat-low);"></span>
              <span class="frintel-gauge-marker" style="left:${score}%;"></span>
            </div>
            <div class="frintel-gauge-scale"><span>0</span><span>40</span><span>55</span><span>70</span><span>85</span><span>100</span></div>
            ${spark}
          </div>
        </div>
        <div class="frintel-pillars">
          ${pillarRows}
        </div>
        ${whyLine ? `<div class="frintel-score-why">${whyLine}</div>` : ''}
        ${capLine}
      </section>
    `;
  }

  private renderScoreSparkline(series: number[], score: number, lang: 'fr' | 'en'): string {
    if (series.length < 2) return '';
    const W = 200;
    const H = 26;
    const min = Math.min(...series) - 2;
    const max = Math.max(...series) + 2;
    const range = max - min || 1;
    const toX = (i: number): number => (i / (series.length - 1)) * W;
    const toY = (v: number): number => H - ((v - min) / range) * H;
    const pts = series.map((v, i) => `${toX(i).toFixed(1)},${toY(v).toFixed(1)}`).join(' ');
    const last = series[series.length - 1];
    return `
      <svg class="frintel-spark" viewBox="0 0 ${W} ${H}" role="img"
        aria-label="${t(lang, 'Historique du score sur 7 jours', '7-day score history')}">
        <polyline points="${pts}" fill="none" stroke="var(--text-accent)" stroke-width="1.5"/>
        <circle cx="${toX(series.length - 1).toFixed(1)}" cy="${toY(last).toFixed(1)}" r="2" fill="${scoreBandColor(score)}"/>
      </svg>
      <div class="frintel-spark-caption">${t(lang, '7 JOURS', '7 DAYS')}</div>
    `;
  }

  private renderSituationsBlock(situations: DetectedSituation[], lang: 'fr' | 'en'): string {
    if (!this.situationsInitialized && situations.length > 0) {
      this.expandedSituations.add(situations[0].id);
      this.situationsInitialized = true;
    }

    const rows = situations.map((s) => {
      const expanded = this.expandedSituations.has(s.id);
      const color = SEVERITY_COLORS[s.severity];
      const drivers = s.drivers.map((d, i) => `
        <div class="frintel-sit-driver">${i === s.drivers.length - 1 ? '└─' : '├─'} ${escapeHtml(d)}</div>
      `).join('');
      const zoneChips = s.affectedZones.slice(0, 4).map((z) =>
        `<span class="frintel-chip frintel-chip-zone">${escapeHtml(z)}</span>`).join('');
      const actionChips = s.recommendedActions.slice(0, 3).map((a) =>
        `<span class="frintel-chip">ACTION · ${escapeHtml(a.label)}</span>`).join('');
      const sourceChips = s.sourceRefs.slice(0, 5).map((r) =>
        `<span class="frintel-chip">${escapeHtml(r)}</span>`).join('');
      return `
        <article class="frintel-sit${expanded ? ' is-expanded' : ''}" data-sit-id="${escapeHtml(s.id)}">
          <span class="frintel-sit-rail" style="background:${color};"></span>
          <div class="frintel-sit-body">
            <button type="button" class="frintel-sit-head" aria-expanded="${expanded ? 'true' : 'false'}">
              <span class="frintel-sit-code">${sitCode(s.id)} · ${escapeHtml(s.type)}</span>
              <span class="frintel-sit-sev" style="color:${color};">${s.severity.toUpperCase()} · CONF ${s.confidence.toFixed(2)}</span>
            </button>
            <div class="frintel-sit-title">${escapeHtml(s.title)}</div>
            ${expanded ? `
              <div class="frintel-sit-detail">
                <p class="frintel-sit-summary">${escapeHtml(s.summary)}</p>
                <div class="frintel-sit-drivers">${drivers}</div>
                <div class="frintel-sit-tags">${zoneChips}${sourceChips}${actionChips}</div>
              </div>
            ` : ''}
          </div>
        </article>
      `;
    }).join('');

    return `
      <section class="frintel-card">
        <div class="frintel-card-top">
          <div class="frintel-card-title frintel-card-title-accent">${t(lang, 'Situations corrélées', 'Correlated Situations')}</div>
          <div class="frintel-card-meta">${situations.length > 0
            ? `${situations.length} ${t(lang, 'actives · moteur 10 règles', 'active · 10-rule engine')}`
            : t(lang, 'moteur 10 règles', '10-rule engine')}</div>
        </div>
        ${situations.length > 0
          ? `<div class="frintel-sit-list">${rows}</div>`
          : `<div class="frintel-empty">${t(lang, 'Surveillance nominale — aucune corrélation active.', 'Nominal watch — no active correlation.')}</div>`}
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
        this.contentEl.scrollTop = scrollTop;
      });
    });
  }

  private renderDomainsBlock(snapshot: FranceCountrySnapshot, lang: 'fr' | 'en'): string {
    const s = snapshot.signals;
    const outages = s.powerOutages + s.telecomOutages;
    const meteoTotal = s.meteoAlerts + s.floodAlerts + s.fireDetections;
    type Level = 'low' | 'medium' | 'high';
    const tiles: Array<{ label: string; value: number; meta: string; level: Level }> = [
      {
        label: 'CYBER', value: s.cyberAlerts,
        meta: `${t(lang, 'alertes 30j', '30d alerts')} · ${s.cyberCritical} CVE`,
        level: s.cyberCritical > 0 ? 'high' : s.cyberAlerts > 5 ? 'medium' : 'low',
      },
      {
        label: 'RAIL', value: s.railDisruptions,
        meta: `${s.railSevere} ${t(lang, 'fortes', 'severe')}`,
        level: s.railSevere > 0 ? 'high' : s.railDisruptions > 10 ? 'medium' : 'low',
      },
      {
        label: t(lang, 'MILITAIRE', 'MILITARY'), value: s.militaryFlights,
        meta: t(lang, 'vols actifs', 'active flights'),
        level: s.militaryFlights > 10 ? 'medium' : 'low',
      },
      {
        label: 'MARITIME', value: s.maritimeTrafficFrance,
        meta: t(lang, 'navires zone FR', 'ships FR waters'),
        level: 'low',
      },
      {
        label: t(lang, 'PANNES', 'OUTAGES'), value: outages,
        meta: `${t(lang, 'élec', 'power')} ${s.powerOutages} · ${t(lang, 'télécom', 'telecom')} ${s.telecomOutages}`,
        level: outages > 5 ? 'high' : outages > 0 ? 'medium' : 'low',
      },
      {
        label: t(lang, 'DÉFENSE', 'DEFENSE'), value: s.defenseAlerts + s.jammingSignals,
        meta: `${t(lang, 'câbles', 'cables')} ${s.defenseAlerts} · GPS ${s.jammingSignals}`,
        level: s.defenseHigh > 0 || s.jammingSignals > 0 ? 'high' : s.defenseAlerts > 0 ? 'medium' : 'low',
      },
      {
        label: t(lang, 'MÉTÉO', 'WEATHER'), value: meteoTotal,
        meta: `${t(lang, 'vigies', 'watches')} ${s.meteoAlerts} · ${t(lang, 'crues', 'floods')} ${s.floodAlerts} · ${t(lang, 'feux', 'fires')} ${s.fireDetections}`,
        level: s.meteoAlerts > 3 || s.floodAlerts > 2 ? 'high' : meteoTotal > 0 ? 'medium' : 'low',
      },
      {
        label: 'FINANCE', value: s.marketStress,
        meta: t(lang, 'lignes sous tension', 'stressed lines'),
        level: s.marketStress > 2 ? 'medium' : 'low',
      },
    ];
    const levelColor: Record<Level, string> = {
      low: 'var(--threat-low)', medium: 'var(--threat-medium)', high: 'var(--threat-high)',
    };
    const tilesHtml = tiles.map((tile) => `
      <div class="frintel-dom-tile">
        <span class="frintel-dom-dot" style="background:${levelColor[tile.level]};"></span>
        <span class="frintel-dom-label">${escapeHtml(tile.label)}</span>
        <div class="frintel-dom-value">${tile.value} <span class="frintel-dom-meta">${escapeHtml(tile.meta)}</span></div>
      </div>
    `).join('');

    // Chips vigilances météo actives (même logique qu'avant, sans emoji)
    const riskMap = new Map<string, { level: MeteoVigilanceLevel; count: number }>();
    for (const alert of snapshot.meteo.filter((item) => item.level !== 'green')) {
      for (const risk of alert.risks) {
        const prev = riskMap.get(risk);
        riskMap.set(risk, {
          level: prev && (prev.level === 'red' || prev.level === 'violet') ? prev.level : alert.level,
          count: (prev?.count ?? 0) + 1,
        });
      }
    }
    const chips: string[] = [];
    for (const [risk, item] of riskMap.entries()) {
      chips.push(`<span class="frintel-chip frintel-chip-warn">${escapeHtml(RISK_LABELS[risk] ?? risk)} · ${escapeHtml(VIGILANCE_LABELS[item.level])}${item.count > 1 ? ` ×${item.count}` : ''}</span>`);
    }
    if (s.railSevere > 0) chips.push(`<span class="frintel-chip frintel-chip-warn">${s.railSevere} SNCF ${t(lang, 'fortes', 'severe')}</span>`);
    if (s.criticalNews > 0) chips.push(`<span class="frintel-chip frintel-chip-crit">${s.criticalNews} ${t(lang, 'titres critiques', 'critical headlines')}</span>`);

    return `
      <section class="frintel-card">
        <div class="frintel-card-top">
          <div class="frintel-card-title">${t(lang, 'Domaines', 'Domains')}</div>
          <div class="frintel-card-meta">${t(lang, 'État par domaine de surveillance', 'Status by watch domain')}</div>
        </div>
        <div class="frintel-dom-grid">${tilesHtml}</div>
        ${chips.length > 0 ? `<div class="frintel-chip-wrap">${chips.join('')}</div>` : ''}
      </section>
    `;
  }

  private mountInfrastructureWidget(): void {
    const slot = this.modalEl.querySelector('.fi-infra-widget-slot') as HTMLElement | null;
    if (!slot || !this.infrastructureWidget) return;
    this.infrastructureWidget.attachTo(slot);
  }

  private renderEnergyBlock(snapshot: FranceCountrySnapshot, lang: 'fr' | 'en'): string {
    const energy = snapshot.energy;
    const energySegments = energy
      ? [
          { label: 'Nuclear', color: '#7c3aed', value: energy.shares.nuclear },
          { label: 'Gas', color: '#2563eb', value: energy.shares.gas },
          { label: 'Hydro', color: '#38bdf8', value: energy.shares.hydro },
          { label: 'Wind', color: '#60a5fa', value: energy.shares.wind },
          { label: 'Solar', color: '#facc15', value: energy.shares.solar },
          { label: t(lang, 'Autre', 'Other'), color: '#34c759', value: energy.shares.other },
        ].filter((segment) => segment.value > 0)
      : [];

    return `
      <section class="frintel-card">
        <div class="frintel-card-top">
          <div class="frintel-card-title">${t(lang, 'Énergie', 'Energy')}</div>
          <div class="frintel-card-meta">${energy?.ecowattSignal ? `Ecowatt ${escapeHtml(energy.ecowattSignal.toUpperCase())}` : t(lang, 'Données partielles', 'Partial data')}</div>
        </div>
        ${energy ? `
          <div class="frintel-energy-stack">
            ${energySegments.map((segment) => `<span style="width:${segment.value}%;background:${segment.color};"></span>`).join('')}
          </div>
          <div class="frintel-energy-legend">
            ${energySegments.map((segment) => `
              <div class="frintel-energy-row">
                <span class="frintel-energy-dot" style="background:${segment.color};"></span>
                <span>${escapeHtml(segment.label)} ${segment.value}%</span>
              </div>
            `).join('')}
          </div>
          <div class="frintel-energy-meta">
            <span>${t(lang, 'Production totale', 'Total production')} ${energy.totalMw ?? 'n/a'} MW</span>
            <span>${t(lang, 'Éolien live', 'Live wind')} ${energy.windGw != null ? `${energy.windGw.toFixed(1)} GW` : 'n/a'}</span>
            <span>${t(lang, 'Charge éolienne', 'Wind load factor')} ${energy.windLoadFactor != null ? `${energy.windLoadFactor}%` : 'n/a'}</span>
          </div>
          ${(() => {
            const oilDays = energy.oilStocksDays;
            const oilStatus = energy.oilVigilanceStatus;
            const fuelLevel = energy.fuelTensionLevel;
            const fuelAnomaly = energy.fuelTensionAnomalyShare;
            const fuelHistory = energy.fuelPriceHistory;
            const hasFuelHistory = !!fuelHistory && fuelHistory.series.length > 0;
            if (!oilDays && !fuelLevel && !hasFuelHistory) return '';
            const oilColor = oilStatus === 'critical' ? 'var(--threat-critical)' : oilStatus === 'tense' ? 'var(--threat-medium)' : 'var(--threat-low)';
            const oilLabel = oilStatus === 'critical' ? t(lang, 'Critique', 'Critical') : oilStatus === 'tense' ? t(lang, 'Sous tension', 'Tense') : t(lang, 'Normal', 'Normal');
            const fuelColor = fuelLevel === 'CRITICAL' ? 'var(--threat-critical)' : fuelLevel === 'HIGH' ? 'var(--threat-high)' : fuelLevel === 'MEDIUM' ? 'var(--threat-medium)' : 'var(--threat-low)';
            const visibleSeries = hasFuelHistory ? filterFuelPriceSeries(fuelHistory, '1m') : [];
            const fuelChart = visibleSeries.length > 0
              ? renderFuelPriceChartSvg(visibleSeries, {
                  width: 320,
                  height: 92,
                  showAxes: false,
                })
              : '';
            const fuelLegend = visibleSeries.map((series) => `
              <div class="frintel-fuel-row">
                <span class="frintel-fuel-name">
                  <span class="frintel-fuel-dot" style="background:${series.color};"></span>
                  ${escapeHtml(series.label)}
                </span>
                <span class="frintel-fuel-value">${escapeHtml(formatFuelPrice(series.latestPrice))}</span>
                <span class="frintel-fuel-delta" style="color:${series.delta7dCents != null && series.delta7dCents > 0 ? 'var(--threat-high)' : series.delta7dCents != null && series.delta7dCents < 0 ? 'var(--threat-low)' : 'var(--text-muted)'};">7j ${escapeHtml(formatFuelDeltaCents(series.delta7dCents))}</span>
              </div>
            `).join('');
            return `
              <div class="frintel-oil-block">
                <div class="frintel-oil-title">${t(lang, 'Pétrole & Carburants', 'Oil & Fuels')}</div>
                <div class="frintel-oil-grid">
                  ${oilDays != null ? `
                    <div class="frintel-oil-row">
                      <span class="frintel-oil-label">${t(lang, 'Stocks nationaux', 'National stocks')}</span>
                      <span class="frintel-oil-value" style="color:${oilColor};">${oilDays}j <span class="frintel-oil-badge" style="color:${oilColor};">${escapeHtml(oilLabel)}</span></span>
                    </div>
                  ` : ''}
                  ${fuelLevel != null ? `
                    <div class="frintel-oil-row">
                      <span class="frintel-oil-label">${t(lang, 'Tension carburants', 'Fuel tension')}</span>
                      <span class="frintel-oil-value" style="color:${fuelColor};">${escapeHtml(fuelLevel)}${fuelAnomaly != null ? ` <span class="frintel-oil-badge" style="color:${fuelColor};">${fuelAnomaly.toFixed(1)}% ${t(lang, 'anomalies', 'anomalies')}</span>` : ''}</span>
                    </div>
                  ` : ''}
                </div>
                ${fuelChart ? `
                  <div class="frintel-fuel-history">
                    <div class="frintel-fuel-history-title">${t(lang, 'Prix moyens carburants · 30 jours', 'Average fuel prices · 30 days')}</div>
                    <div class="frintel-fuel-chart">${fuelChart}</div>
                    <div class="frintel-fuel-legend">${fuelLegend}</div>
                  </div>
                ` : ''}
              </div>
            `;
          })()}
        ` : `<div class="frintel-empty">${t(lang, 'Aucun profil énergie disponible.', 'No energy profile available.')}</div>`}
      </section>
    `;
  }

  private renderTimelineBlock(snapshot: FranceCountrySnapshot, lang: 'fr' | 'en'): string {
    return `
      <section class="frintel-card">
        <div class="frintel-card-top">
          <div class="frintel-card-title">${t(lang, 'Chronologie 7 jours', '7-Day Timeline')}</div>
          <div class="frintel-card-meta">${t(lang, 'Lecture par intensité de signal', 'Signal intensity view')}</div>
        </div>
        <div class="frintel-timeline-head">
          <div></div>
          <div class="frintel-timeline-days">
            ${snapshot.timeline.days.map((day) => `<span>${escapeHtml(day)}</span>`).join('')}
          </div>
        </div>
        <div class="frintel-timeline">
          ${snapshot.timeline.lanes.map(renderTimelineLane).join('')}
        </div>
      </section>
    `;
  }

  private renderBriefSection(): void {
    const body = this.modalEl.querySelector('.fi-brief-body');
    const meta = this.modalEl.querySelector('.fi-brief-meta');
    const toggle = this.modalEl.querySelector('.fi-brief-toggle') as HTMLButtonElement | null;
    if (!body || !meta || !toggle) return;

    const lang = this.currentLang;

    if (this.briefState === null) {
      meta.textContent = t(lang, 'Génération…', 'Generating…');
      body.innerHTML = fmLoaderHTML({ text: t(lang, 'Construction du brief national…', 'Building national brief…') });
      toggle.hidden = true;
      return;
    }

    meta.textContent = this.briefState.freshness === 'fresh'
      ? t(lang, 'Fresh', 'Fresh')
      : t(lang, 'Cached', 'Cached');

    if (!this.briefState.text) {
      body.innerHTML = `<div class="frintel-empty">${t(lang, 'Brief indisponible pour le moment.', 'Brief currently unavailable.')}</div>`;
      toggle.hidden = true;
      return;
    }

    const sourceText = this.briefState.text.trim();
    const sections = parseBriefSections(sourceText);
    const lineCount = normalizeBriefText(sourceText).split('\n').map(normalizeBriefLine).filter(Boolean).length;
    body.classList.toggle('is-collapsed', !this.briefExpanded);
    body.innerHTML = `<div class="frintel-brief-copy">${formatBriefHtml(sections)}</div>`;

    const canExpand = body.scrollHeight > BRIEF_COLLAPSED_MAX_HEIGHT_PX + 8 || lineCount > BRIEF_COLLAPSED_LINES;
    toggle.hidden = !canExpand;
    if (canExpand) {
      toggle.textContent = this.briefExpanded
        ? t(lang, 'Moins', 'Less')
        : t(lang, 'Plus', 'More');
      toggle.onclick = () => {
        this.briefExpanded = !this.briefExpanded;
        this.renderBriefSection();
      };
      body.classList.toggle('is-collapsed', !this.briefExpanded);
    } else {
      body.classList.remove('is-collapsed');
    }
  }
}
