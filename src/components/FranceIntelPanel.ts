import { Panel } from './Panel.ts';
import type {
  FranceIntelData,
  FranceIntelTimelineLane,
  ISNRDimensionScores,
  MeteoVigilanceLevel,
} from '../types/index.ts';

const LEVEL_COLORS: Record<string, string> = {
  critical: 'var(--threat-critical)',
  high: 'var(--threat-high)',
  medium: 'var(--threat-medium)',
  low: 'var(--threat-low)',
  info: 'var(--threat-info)',
};

const THREAT_LABELS: Record<string, string> = {
  critical: 'CRITIQUE',
  high: 'ÉLEVÉ',
  medium: 'MODÉRÉ',
  low: 'FAIBLE',
  info: 'INFO',
};

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

const SEVERITY_ORDER: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
  info: 0,
};

function t(lang: 'fr' | 'en', fr: string, en: string): string {
  return lang === 'fr' ? fr : en;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function getActiveScores(scores: FranceIntelData['stability']['scores']): FranceIntelData['stability']['scores'] {
  return scores.filter((score) => score.score > 0 || score.eventCount > 0);
}

function avgDim(scores: FranceIntelData['stability']['scores'], key: keyof ISNRDimensionScores): number {
  const activeScores = getActiveScores(scores);
  if (activeScores.length === 0) return 0;
  const sum = activeScores.reduce((acc, score) => acc + (score.dimensions?.[key] ?? 0), 0);
  return Math.round(sum / activeScores.length);
}

function computeCII(data: FranceIntelData): number {
  const social = avgDim(data.stability.scores, 'social');
  const security = avgDim(data.stability.scores, 'security');
  const infra = avgDim(data.stability.scores, 'infra');
  const cyber = data.cyber.meta.globalScore;
  return Math.round(social * 0.25 + security * 0.3 + infra * 0.2 + cyber * 0.25);
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function computeNationalPostureAxes(data: FranceIntelData, lang: 'fr' | 'en'): Array<{ label: string; value: number; color: string }> {
  const socialBase = avgDim(data.stability.scores, 'social');
  const securityBase = avgDim(data.stability.scores, 'security');

  const troubles = clampScore(Math.max(
    socialBase,
    data.signals.highNews * 5
      + data.signals.railDisruptions * 2
      + data.signals.roadIncidents
      + (data.signals.powerOutages + data.signals.telecomOutages) * 3,
  ));

  const conflict = clampScore(
    data.signals.defenseAlerts * 18
      + data.signals.jammingSignals * 16
      + Math.min(data.signals.militaryFlights, 20) * 2
      + Math.min(data.signals.maritimeTrafficFrance, 20),
  );

  const security = clampScore(Math.max(
    securityBase,
    data.signals.criticalNews * 18
      + data.signals.highNews * 8
      + data.signals.defenseHigh * 18
      + data.signals.jammingSignals * 10,
  ));

  const information = clampScore(
    Math.min(data.topNews.length, 20)
      + data.signals.highNews * 4
      + data.signals.criticalNews * 10
      + data.signals.marketStress * 5,
  );

  return [
    { label: t(lang, 'Troubles', 'Troubles'), value: troubles, color: '#7ddc6f' },
    { label: t(lang, 'Conflit', 'Conflict'), value: conflict, color: '#9ca3af' },
    { label: t(lang, 'Sécurité', 'Security'), value: security, color: '#ff6b35' },
    { label: t(lang, 'Information', 'Information'), value: information, color: '#7ddc6f' },
  ];
}

function ciiBand(score: number): 'stable' | 'elevated' | 'high' | 'critical' {
  if (score <= 25) return 'stable';
  if (score <= 50) return 'elevated';
  if (score <= 75) return 'high';
  return 'critical';
}

function ciiLabel(score: number, lang: 'fr' | 'en'): string {
  if (score <= 25) return t(lang, 'Stable', 'Stable');
  if (score <= 50) return t(lang, 'Sous tension', 'Elevated');
  if (score <= 75) return t(lang, 'Élevé', 'High');
  return t(lang, 'Critique', 'Critical');
}

function ciiColor(score: number): string {
  const band = ciiBand(score);
  if (band === 'critical') return 'var(--threat-critical)';
  if (band === 'high') return 'var(--threat-high)';
  if (band === 'elevated') return 'var(--threat-medium)';
  return 'var(--threat-low)';
}

function timeAgo(date: Date, lang: 'fr' | 'en'): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.max(0, Math.floor(diff / 60_000));
  const hours = Math.floor(mins / 60);
  if (lang === 'en') {
    if (mins < 2) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }
  if (mins < 2) return 'à l’instant';
  if (mins < 60) return `il y a ${mins} min`;
  if (hours < 24) return `il y a ${hours} h`;
  return `il y a ${Math.floor(hours / 24)} j`;
}

function summarizeBrief(text: string): string {
  const stripped = text.replace(/\*\*(.*?)\*\*/g, '$1').trim();
  const lines = stripped.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 4) return lines.slice(0, 4).join('\n');
  const sentences = stripped.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/).filter(Boolean);
  return sentences.slice(0, 4).join(' ');
}

function formatBriefHtml(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const escaped = escapeHtml(line.replace(/\*\*(.*?)\*\*/g, '$1'));
      if (/^[A-ZÀÂÄÇÉÈÊËÎÏÔÖÙÛÜŸ0-9\s:'-]{4,}$/.test(line)) {
        return `<div class="frintel-brief-kicker">${escaped}</div>`;
      }
      return `<p>${escaped}</p>`;
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

  getCurrentLang(): 'fr' | 'en' {
    return this.currentLang;
  }

  isVisible(): boolean {
    return this.isOpen;
  }

  show(data: FranceIntelData): void {
    if (!this.contentEl) return;
    this.currentLang = data.briefLang;
    const langBtn = this.modalEl.querySelector('.fi-lang-toggle');
    if (langBtn) langBtn.textContent = this.currentLang.toUpperCase();
    this.renderContent(data);
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

  private renderContent(data: FranceIntelData): void {
    if (!this.contentEl) return;

    const lang = data.briefLang;
    const cii = computeCII(data);
    const ciiBandLabel = ciiLabel(cii, lang);
    const ciiTint = ciiColor(cii);
    const postureAxes = computeNationalPostureAxes(data, lang);
    const updatedTime = new Date(data.stability.timestamp).toLocaleString(
      lang === 'fr' ? 'fr-FR' : 'en-US',
      { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
    );

    const news = [...data.topNews]
      .sort((a, b) => {
        const severityDelta = (SEVERITY_ORDER[b.threat?.level ?? 'info'] ?? 0) - (SEVERITY_ORDER[a.threat?.level ?? 'info'] ?? 0);
        if (severityDelta !== 0) return severityDelta;
        return b.pubDate.getTime() - a.pubDate.getTime();
      })
      .slice(0, 6);

    const dominantRisk = [
      { label: t(lang, 'Cyber', 'Cyber'), value: data.signals.cyberAlerts + data.signals.cyberCritical },
      { label: t(lang, 'Transport', 'Transport'), value: data.signals.railDisruptions + data.signals.roadIncidents },
      { label: t(lang, 'Pannes', 'Outages'), value: data.signals.powerOutages + data.signals.telecomOutages },
      { label: t(lang, 'Météo', 'Weather'), value: data.signals.meteoAlerts + data.signals.floodAlerts },
      { label: t(lang, 'Défense', 'Defense'), value: data.signals.defenseAlerts + data.signals.jammingSignals },
    ].sort((a, b) => b.value - a.value)[0];

    const riskMap = new Map<string, { level: MeteoVigilanceLevel; count: number }>();
    for (const alert of data.meteo.filter((item) => item.level !== 'green')) {
      for (const risk of alert.risks) {
        const prev = riskMap.get(risk);
        riskMap.set(risk, {
          level: prev && (prev.level === 'red' || prev.level === 'violet') ? prev.level : alert.level,
          count: (prev?.count ?? 0) + 1,
        });
      }
    }

    const signalChips: string[] = [];
    if (data.signals.criticalNews > 0) signalChips.push(`<span class="frintel-chip chip-critical">🚨 ${data.signals.criticalNews} ${t(lang, 'titre critique', 'critical headline')}${data.signals.criticalNews > 1 ? 's' : ''}</span>`);
    if (data.signals.militaryFlights > 0) signalChips.push(`<span class="frintel-chip chip-defense">✈️ ${data.signals.militaryFlights} ${t(lang, 'vols militaires', 'military flights')}</span>`);
    if (data.signals.maritimeTrafficFrance > 0) signalChips.push(`<span class="frintel-chip chip-transport">🚢 ${data.signals.maritimeTrafficFrance} ${t(lang, 'navires en zone France', 'ships in French waters')}</span>`);
    if (data.signals.defenseAlerts > 0) signalChips.push(`<span class="frintel-chip chip-defense">🛡️ ${data.signals.defenseAlerts} ${t(lang, 'alerte défense', 'defense alert')}${data.signals.defenseAlerts > 1 ? 's' : ''}</span>`);
    if (data.signals.jammingSignals > 0) signalChips.push(`<span class="frintel-chip chip-defense">📡 ${data.signals.jammingSignals} ${t(lang, 'signal GPS', 'GPS jamming signal')}${data.signals.jammingSignals > 1 ? 's' : ''}</span>`);
    if (data.signals.cyberCritical > 0) signalChips.push(`<span class="frintel-chip chip-cyber">🧬 ${data.signals.cyberCritical} ${t(lang, 'CVE critiques', 'critical CVEs')}</span>`);
    if (data.signals.railSevere > 0) signalChips.push(`<span class="frintel-chip chip-transport">🚆 ${data.signals.railSevere} ${t(lang, 'perturbations SNCF fortes', 'severe rail disruptions')}</span>`);
    if (data.signals.fireDetections > 0) signalChips.push(`<span class="frintel-chip chip-weather">🔥 ${data.signals.fireDetections} ${t(lang, 'détections de feux', 'fire detections')}</span>`);
    if (data.signals.marketStress > 0) signalChips.push(`<span class="frintel-chip chip-critical">📉 ${data.signals.marketStress} ${t(lang, 'lignes marché sous tension', 'market stress lines')}</span>`);
    if (data.signals.powerOutages + data.signals.telecomOutages > 0) signalChips.push(`<span class="frintel-chip chip-outage">🌐 ${data.signals.powerOutages + data.signals.telecomOutages} ${t(lang, 'pannes en cours', 'outages active')}</span>`);
    for (const [risk, item] of riskMap.entries()) {
      signalChips.push(`<span class="frintel-chip chip-weather">${escapeHtml(RISK_LABELS[risk] ?? risk)} · ${escapeHtml(VIGILANCE_LABELS[item.level])}${item.count > 1 ? ` ×${item.count}` : ''}</span>`);
    }

    const totalSignals = data.signals.criticalNews
      + data.signals.highNews
      + data.signals.meteoAlerts
      + data.signals.floodAlerts
      + data.signals.railDisruptions
      + data.signals.roadIncidents
      + data.signals.powerOutages
      + data.signals.telecomOutages
      + data.signals.fireDetections
      + data.signals.militaryFlights
      + data.signals.maritimeTrafficFrance
      + data.signals.defenseAlerts
      + data.signals.jammingSignals;

    const energy = data.energy;
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
            <div class="frintel-card-title">${t(lang, 'Indice d’instabilité', 'Instability Index')}</div>
            <div class="frintel-card-meta">${t(lang, 'Mis à jour', 'Updated')} ${updatedTime}</div>
          </div>
          <div class="frintel-score-row">
            <div class="frintel-score-value" style="color:${ciiTint};">${cii}/100</div>
            <div class="frintel-score-side">
              <div class="frintel-score-band" style="color:${ciiTint};">${escapeHtml(ciiBandLabel)}</div>
              <div class="frintel-score-note">${t(lang, 'CII national composite', 'Composite national CII')}</div>
            </div>
          </div>
          ${postureAxes.map((axis) => this.renderMetricBar(axis.label, axis.value, axis.color)).join('')}
        </section>

        <section class="frintel-card">
          <div class="frintel-card-top">
            <div class="frintel-card-title">${t(lang, 'Posture nationale', 'National Posture')}</div>
            <div class="frintel-card-meta">${t(lang, 'Risque dominant', 'Dominant risk')} • ${escapeHtml(dominantRisk?.label ?? 'n/a')}</div>
          </div>
          <div class="frintel-metric-grid">
            ${this.renderStatTile(t(lang, 'Cyber', 'Cyber'), data.signals.cyberAlerts.toString(), t(lang, 'alertes 30j', '30d alerts'))}
            ${this.renderStatTile(t(lang, 'Rail', 'Rail'), data.signals.railDisruptions.toString(), t(lang, 'perturbations', 'disruptions'))}
            ${this.renderStatTile(t(lang, 'Militaire', 'Military'), data.signals.militaryFlights.toString(), t(lang, 'vols actifs', 'active flights'))}
            ${this.renderStatTile(t(lang, 'Maritime', 'Maritime'), data.signals.maritimeTrafficFrance.toString(), t(lang, 'navires en zone FR', 'ships in FR waters'))}
            ${this.renderStatTile(t(lang, 'Pannes', 'Outages'), (data.signals.powerOutages + data.signals.telecomOutages).toString(), t(lang, 'élec + télécom', 'power + telecom'))}
            ${this.renderStatTile(t(lang, 'Défense', 'Defense'), data.signals.defenseAlerts.toString(), t(lang, 'alertes câbles', 'cable alerts'))}
            ${this.renderStatTile(t(lang, 'Météo', 'Weather'), (data.signals.meteoAlerts + data.signals.floodAlerts + data.signals.fireDetections).toString(), t(lang, 'vigies + feux', 'watches + fires'))}
          </div>
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
              ${data.timeline.days.map((day) => `<span>${escapeHtml(day)}</span>`).join('')}
            </div>
          </div>
          <div class="frintel-timeline">
            ${data.timeline.lanes.map(renderTimelineLane).join('')}
          </div>
        </section>

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
          ` : `<div class="frintel-empty">${t(lang, 'Aucun profil énergie disponible.', 'No energy profile available.')}</div>`}
        </section>

        <section class="frintel-card">
          <div class="frintel-card-top">
            <div class="frintel-card-title">${t(lang, 'Actualités principales', 'Key Headlines')}</div>
            <div class="frintel-card-meta">${news.length} ${t(lang, 'éléments', 'items')}</div>
          </div>
          <div class="frintel-news-list">
            ${news.length > 0 ? news.map((item) => {
              const level = item.threat?.level ?? 'info';
              const badge = lang === 'en'
                ? (level === 'critical' ? 'CRITICAL' : level === 'high' ? 'HIGH' : level === 'medium' ? 'MODERATE' : level === 'low' ? 'LOW' : 'INFO')
                : THREAT_LABELS[level] ?? level.toUpperCase();
              return `
                <a class="frintel-news-item" href="${escapeHtml(item.link)}" target="_blank" rel="noopener">
                  <div class="frintel-news-top">
                    <span class="frintel-news-badge" style="--fi-badge:${LEVEL_COLORS[level] ?? 'var(--text-muted)'};">${escapeHtml(badge)}</span>
                    <span class="frintel-news-time">${escapeHtml(timeAgo(item.pubDate, lang))}</span>
                  </div>
                  <div class="frintel-news-title">${escapeHtml(item.title)}</div>
                  <div class="frintel-news-meta">${escapeHtml(item.source)}</div>
                </a>
              `;
            }).join('') : `<div class="frintel-empty">${t(lang, 'Aucune actualité récente spécifique.', 'No recent specific headlines.')}</div>`}
          </div>
        </section>
      </div>
    `;

    this.renderBriefSection();
  }

  private renderMetricBar(label: string, value: number, color: string): string {
    const clamped = Math.max(0, Math.min(100, value));
    return `
      <div class="frintel-bar-row">
        <div class="frintel-bar-label">${escapeHtml(label)}</div>
        <div class="frintel-bar-track">
          <span class="frintel-bar-fill" style="width:${clamped}%;background:${color};"></span>
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
    const compact = summarizeBrief(sourceText);
    const activeText = this.briefExpanded ? sourceText : compact;
    body.innerHTML = `<div class="frintel-brief-copy">${formatBriefHtml(activeText)}</div>`;

    const canExpand = sourceText.length > compact.length + 20;
    toggle.hidden = !canExpand;
    if (canExpand) {
      toggle.textContent = this.briefExpanded
        ? t(lang, 'Réduire', 'Collapse')
        : t(lang, 'Lire le brief complet', 'Read full brief');
      toggle.onclick = () => {
        this.briefExpanded = !this.briefExpanded;
        this.renderBriefSection();
      };
    }
  }
}
