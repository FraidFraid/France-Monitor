import { Panel } from './Panel.ts';
import type { BarometerWidget } from './BarometerWidget.ts';
import type {
  FranceCountrySnapshot,
  FranceIntelTimelineLane,
  MeteoVigilanceLevel,
} from '../types/index.ts';
import {
  filterFuelPriceSeries,
  formatFuelDeltaCents,
  formatFuelPrice,
  renderFuelPriceChartSvg,
} from '../utils/fuelPriceChart.ts';

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


function ciiBand(score: number): 'stable' | 'tense' | 'degraded' | 'critical' {
  if (score >= 80) return 'stable';
  if (score >= 65) return 'tense';
  if (score >= 50) return 'degraded';
  return 'critical';
}

function ciiLabel(score: number, lang: 'fr' | 'en'): string {
  if (score >= 80) return t(lang, 'Stable', 'Stable');
  if (score >= 65) return t(lang, 'Sous tension', 'Under Pressure');
  if (score >= 50) return t(lang, 'Dégradé', 'Degraded');
  return t(lang, 'Critique', 'Critical');
}

function ciiColor(score: number): string {
  const band = ciiBand(score);
  if (band === 'critical') return 'var(--threat-critical)';
  if (band === 'degraded') return 'var(--threat-high)';
  if (band === 'tense') return 'var(--threat-medium)';
  return 'var(--threat-low)';
}

function axisRiskColor(value: number): string {
  if (value >= 75) return 'var(--threat-critical)';
  if (value >= 55) return 'var(--threat-high)';
  if (value >= 35) return 'var(--threat-medium)';
  return 'var(--threat-low)';
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
  return /^[A-ZÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸ0-9\s'’:/()\-]{4,}$/.test(line);
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
  const match = line.match(/^((?:\d+[.)]\s*)?[A-ZÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸ0-9\s'’/()\-]{4,})\s*:\s+(.+)$/);
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
          <div class="frintel-header-left">
            <div class="frintel-flag">🇫🇷</div>
            <div>
              <h2 class="frintel-title">France</h2>
              <div class="frintel-subtitle">FR • Country Intelligence</div>
            </div>
          </div>
          <div class="frintel-header-actions">
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
    const cii = snapshot.score;
    const ciiBandLabel = ciiLabel(cii, lang);
    const ciiTint = ciiColor(cii);
    const postureAxes = [
      { label: t(lang, 'Continuité', 'Continuity'), value: snapshot.axes.continuity, color: axisRiskColor(snapshot.axes.continuity) },
      { label: t(lang, 'Défense',    'Defense'),    value: snapshot.axes.defense,    color: axisRiskColor(snapshot.axes.defense) },
      { label: t(lang, 'Sécurité',   'Security'),   value: snapshot.axes.security,   color: axisRiskColor(snapshot.axes.security) },
      { label: t(lang, 'Veille',     'Watch'),       value: snapshot.axes.signal,     color: axisRiskColor(snapshot.axes.signal) },
    ];
    const updatedTime = new Date(snapshot.stability.timestamp).toLocaleString(
      lang === 'fr' ? 'fr-FR' : 'en-US',
      { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
    );

    const dominantRisk = [
      { label: t(lang, 'Cyber', 'Cyber'), value: snapshot.signals.cyberAlerts + snapshot.signals.cyberCritical },
      { label: t(lang, 'Transport', 'Transport'), value: snapshot.signals.railDisruptions + snapshot.signals.roadIncidents },
      { label: t(lang, 'Pannes', 'Outages'), value: snapshot.signals.powerOutages + snapshot.signals.telecomOutages },
      { label: t(lang, 'Météo', 'Weather'), value: snapshot.signals.meteoAlerts + snapshot.signals.floodAlerts },
      { label: t(lang, 'Défense', 'Defense'), value: snapshot.signals.defenseAlerts + snapshot.signals.jammingSignals },
    ].sort((a, b) => b.value - a.value)[0];

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

    const signalChips: string[] = [];
    if (snapshot.signals.criticalNews > 0) signalChips.push(`<span class="frintel-chip chip-critical">🚨 ${snapshot.signals.criticalNews} ${t(lang, 'titre critique', 'critical headline')}${snapshot.signals.criticalNews > 1 ? 's' : ''}</span>`);
    if (snapshot.signals.militaryFlights > 0) signalChips.push(`<span class="frintel-chip chip-defense">✈️ ${snapshot.signals.militaryFlights} ${t(lang, 'vols militaires', 'military flights')}</span>`);
    if (snapshot.signals.defenseAlerts > 0) signalChips.push(`<span class="frintel-chip chip-defense">🛡️ ${snapshot.signals.defenseAlerts} ${t(lang, 'alerte défense', 'defense alert')}${snapshot.signals.defenseAlerts > 1 ? 's' : ''}</span>`);
    if (snapshot.signals.jammingSignals > 0) signalChips.push(`<span class="frintel-chip chip-defense">📡 ${snapshot.signals.jammingSignals} ${t(lang, 'signal GPS', 'GPS jamming signal')}${snapshot.signals.jammingSignals > 1 ? 's' : ''}</span>`);
    if (snapshot.signals.cyberCritical > 0) signalChips.push(`<span class="frintel-chip chip-cyber">🧬 ${snapshot.signals.cyberCritical} ${t(lang, 'CVE critiques', 'critical CVEs')}</span>`);
    if (snapshot.signals.railSevere > 0) signalChips.push(`<span class="frintel-chip chip-transport">🚆 ${snapshot.signals.railSevere} ${t(lang, 'perturbations SNCF fortes', 'severe rail disruptions')}</span>`);
    if (snapshot.signals.fireDetections > 0) signalChips.push(`<span class="frintel-chip chip-weather">🔥 ${snapshot.signals.fireDetections} ${t(lang, 'détections de feux', 'fire detections')}</span>`);
    if (snapshot.signals.marketStress > 0) signalChips.push(`<span class="frintel-chip chip-critical">📉 ${snapshot.signals.marketStress} ${t(lang, 'lignes marché sous tension', 'market stress lines')}</span>`);
    if (snapshot.signals.powerOutages + snapshot.signals.telecomOutages > 0) signalChips.push(`<span class="frintel-chip chip-outage">🌐 ${snapshot.signals.powerOutages + snapshot.signals.telecomOutages} ${t(lang, 'pannes en cours', 'outages active')}</span>`);
    for (const [risk, item] of riskMap.entries()) {
      signalChips.push(`<span class="frintel-chip chip-weather">${escapeHtml(RISK_LABELS[risk] ?? risk)} · ${escapeHtml(VIGILANCE_LABELS[item.level])}${item.count > 1 ? ` ×${item.count}` : ''}</span>`);
    }

    const totalSignals = snapshot.signals.criticalNews
      + snapshot.signals.highNews
      + snapshot.signals.meteoAlerts
      + snapshot.signals.floodAlerts
      + snapshot.signals.railDisruptions
      + snapshot.signals.roadIncidents
      + snapshot.signals.powerOutages
      + snapshot.signals.telecomOutages
      + snapshot.signals.fireDetections
      + snapshot.signals.militaryFlights
      + snapshot.signals.defenseAlerts
      + snapshot.signals.jammingSignals;

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

    this.contentEl.innerHTML = `
      <div class="frintel-summary-grid">
        <section class="frintel-card frintel-score-card">
          <div class="frintel-card-top">
            <div class="frintel-card-title">${t(lang, 'Indice de stabilité', 'Stability Index')}</div>
            <div class="frintel-card-meta">${t(lang, 'Mis à jour', 'Updated')} ${updatedTime}</div>
          </div>
          <div class="frintel-score-row">
            <div class="frintel-score-value" style="color:${ciiTint};">${cii}/100</div>
            <div class="frintel-score-side">
              <div class="frintel-score-band" style="color:${ciiTint};">${escapeHtml(ciiBandLabel)}</div>
              <div class="frintel-score-note">${t(lang, 'Score haut = pays plus stable. Base France stable + dégradation temps réel. Axes hauts = risque plus fort.', 'Higher score = more stable country. Stable-France baseline plus real-time degradation. Higher axes = stronger risk pressure.')}</div>
            </div>
          </div>
          ${postureAxes.map((axis) => this.renderMetricBar(axis.label, axis.value, axis.color)).join('')}
        </section>
      </div>

      <div class="frintel-grid">
        <section class="frintel-card">
          <div class="frintel-card-top">
            <div class="frintel-card-title">${t(lang, 'Brief renseignement', 'Intelligence Brief')}</div>
            <div class="frintel-card-meta fi-brief-meta"></div>
          </div>
          <div class="frintel-brief-body fi-brief-body"></div>
          <button type="button" class="frintel-inline-action fi-brief-toggle" hidden></button>
        </section>

        <section class="frintel-card">
          <div class="frintel-card-top">
            <div class="frintel-card-title">${t(lang, 'Posture nationale', 'National Posture')}</div>
            <div class="frintel-card-meta">${t(lang, 'Risque dominant', 'Dominant risk')} • ${escapeHtml(dominantRisk?.label ?? 'n/a')}</div>
          </div>
          <div class="frintel-metric-grid">
            ${this.renderStatTile(t(lang, 'Cyber', 'Cyber'), snapshot.signals.cyberAlerts.toString(), t(lang, 'alertes 30j', '30d alerts'))}
            ${this.renderStatTile(t(lang, 'Rail', 'Rail'), snapshot.signals.railDisruptions.toString(), t(lang, 'perturbations', 'disruptions'))}
            ${this.renderStatTile(t(lang, 'Militaire', 'Military'), snapshot.signals.militaryFlights.toString(), t(lang, 'vols actifs', 'active flights'))}
            ${this.renderStatTile(t(lang, 'Maritime', 'Maritime'), snapshot.signals.maritimeTrafficFrance.toString(), t(lang, 'navires en zone FR', 'ships in FR waters'))}
            ${this.renderStatTile(t(lang, 'Pannes', 'Outages'), (snapshot.signals.powerOutages + snapshot.signals.telecomOutages).toString(), t(lang, 'élec + télécom', 'power + telecom'))}
            ${this.renderStatTile(t(lang, 'Défense', 'Defense'), snapshot.signals.defenseAlerts.toString(), t(lang, 'alertes câbles', 'cable alerts'))}
            ${this.renderStatTile(t(lang, 'Météo', 'Weather'), (snapshot.signals.meteoAlerts + snapshot.signals.floodAlerts + snapshot.signals.fireDetections).toString(), t(lang, 'vigies + feux', 'watches + fires'))}
          </div>
        </section>

        <section class="frintel-card">
          <div class="frintel-card-top">
            <div class="frintel-card-title">${t(lang, 'Signaux actifs', 'Active Signals')}</div>
            <div class="frintel-card-meta">${totalSignals} ${t(lang, 'signaux agrégés', 'aggregated signals')}</div>
          </div>
          <div class="frintel-chip-wrap">
            ${signalChips.length > 0 ? signalChips.join('') : `<div class="frintel-empty">${t(lang, 'Aucun signal dominant à cette minute.', 'No dominant signal right now.')}</div>`}
          </div>
        </section>

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

        <div class="fi-infra-widget-slot"></div>

        <section class="frintel-card">
          <div class="frintel-card-top">
            <div class="frintel-card-title">${t(lang, 'Profil énergie', 'Energy Profile')}</div>
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
                  <div class="frintel-oil-title">${t(lang, '🛢️ Pétrole & Carburants', '🛢️ Oil & Fuels')}</div>
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
      </div>
    `;

    this.renderBriefSection();
  }

  private mountInfrastructureWidget(): void {
    const slot = this.modalEl.querySelector('.fi-infra-widget-slot') as HTMLElement | null;
    if (!slot || !this.infrastructureWidget) return;
    this.infrastructureWidget.attachTo(slot);
  }

  private renderMetricBar(label: string, value: number, color: string): string {
    const clamped = Math.max(0, Math.min(100, value));
    return `
      <div class="frintel-bar-row">
        <div class="frintel-bar-label">${escapeHtml(label)}</div>
        <div class="frintel-bar-track">
          <span class="frintel-bar-fill" style="width:${clamped}%;background:${color};box-shadow:0 0 12px color-mix(in srgb, ${color} 45%, transparent);"></span>
        </div>
        <div class="frintel-bar-value">${value}</div>
      </div>
    `;
  }

  private renderStatTile(label: string, value: string, meta: string): string {
    return `
      <div class="frintel-stat-tile">
        <div class="frintel-stat-label">${escapeHtml(label)}</div>
        <div class="frintel-stat-value">${escapeHtml(value)}</div>
        <div class="frintel-stat-meta">${escapeHtml(meta)}</div>
      </div>
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
      body.innerHTML = `
        <div class="frintel-loading">
          <span class="frintel-loading-line"></span>
          <span class="frintel-loading-line short"></span>
          <span class="frintel-loading-text">${t(lang, 'Construction du brief national…', 'Building national brief…')}</span>
        </div>
      `;
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
