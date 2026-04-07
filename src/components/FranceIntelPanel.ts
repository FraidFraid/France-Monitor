// src/components/FranceIntelPanel.ts
// ⚠️ mount() does NOT call super.mount() — Panel base class would append a
// duplicate container and call render(). This class manages its own slide-in DOM.
import { Panel } from './Panel.ts';
import type { FranceIntelData, ISNRDimensionScores, MeteoVigilanceLevel } from '../types/index.ts';

const LEVEL_COLORS: Record<string, string> = {
  critical: '#e74c3c',
  high:     '#e67e22',
  medium:   '#f1c40f',
  low:      '#3498db',
  info:     '#95a5a6',
};

const VIGILANCE_EMOJI: Record<MeteoVigilanceLevel, string> = {
  red:    '🔴',
  violet: '🟣',
  orange: '🟠',
  yellow: '🟡',
  green:  '🟢',
};

const THREAT_LABELS: Record<string, string> = {
  critical: 'CRITIQUE',
  high:     'ÉLEVÉ',
  medium:   'MODÉRÉ',
  low:      'BAS',
  info:     'INFO',
};

const RISK_LABELS: Record<string, string> = {
  'wind':        'Vent',
  'rain-flood':  'Pluie',
  'thunderstorm':'Orages',
  'flood':       'Crues',
  'snow-ice':    'Neige',
  'heat':        'Canicule',
  'cold':        'Grand froid',
  'avalanche':   'Avalanches',
  'wave-surge':  'Vagues',
};

const SEV: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

function ciiColor(score: number): string {
  if (score >= 70) return '#e74c3c';
  if (score >= 55) return '#e67e22';
  if (score >= 40) return '#f1c40f';
  if (score >= 25) return '#3498db';
  return '#2ecc71';
}

function ciiLabel(score: number): string {
  if (score >= 70) return 'Critique';
  if (score >= 55) return 'Élevé';
  if (score >= 40) return 'Modéré';
  if (score >= 25) return 'Normal';
  return 'Bas';
}

function avgDim(
  scores: FranceIntelData['stability']['scores'],
  key: keyof ISNRDimensionScores,
): number {
  if (scores.length === 0) return 0;
  const sum = scores.reduce((acc, s) => acc + (s.dimensions?.[key] ?? 0), 0);
  return Math.round(sum / scores.length);
}

function computeCII(data: FranceIntelData): number {
  const social   = avgDim(data.stability.scores, 'social');
  const security = avgDim(data.stability.scores, 'security');
  const infra    = avgDim(data.stability.scores, 'infra');
  const cyber    = data.cyber.meta.globalScore;
  return Math.round(social * 0.25 + security * 0.30 + infra * 0.20 + cyber * 0.25);
}

function scoreBar(value: number, color: string): string {
  const pct = Math.min(100, Math.max(0, value));
  return `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <div style="flex:1;height:4px;background:rgba(255,255,255,0.08);border-radius:2px;overflow:hidden;">
        <div style="width:${pct}%;height:100%;background:${color};border-radius:2px;transition:width 0.4s;"></div>
      </div>
      <span style="font-size:11px;color:#aaa;font-variant-numeric:tabular-nums;min-width:26px;text-align:right;">${value}</span>
    </div>`;
}

function timeAgo(date: Date, lang: 'fr' | 'en'): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  const hrs  = Math.floor(mins / 60);
  if (lang === 'en') {
    if (mins < 2)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    if (hrs < 24)  return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }
  if (mins < 2)  return 'à l\'instant';
  if (mins < 60) return `il y a ${mins} min`;
  if (hrs < 24)  return `il y a ${hrs} h`;
  return `il y a ${Math.floor(hrs / 24)} j`;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export class FranceIntelPanel extends Panel {
  private modalEl!: HTMLElement;
  private contentEl: HTMLElement | null = null;
  private onClose?: () => void;
  private _isVisible = false;
  /** Tracks the currently displayed language so reopening restores it. */
  private currentLang: 'fr' | 'en' = 'fr';

  constructor(container: HTMLElement) {
    super(container, { title: 'France Intelligence', icon: '🇫🇷', collapsible: false });
  }

  // ⚠️ Does NOT call super.mount() — see file header.
  mount(): void {
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'france-intel-panel-modal';
    this.modalEl.style.cssText = `
      position: fixed;
      top: 0;
      right: 0;
      width: 380px;
      height: 100vh;
      background: var(--bg-surface, #13131a);
      border-left: 1px solid var(--border-color, rgba(255,255,255,0.1));
      box-shadow: -8px 0 32px rgba(0,0,0,0.5);
      z-index: 1100;
      display: flex;
      flex-direction: column;
      backdrop-filter: blur(10px);
      transform: translateX(100%);
      transition: transform 0.3s ease;
      overflow: hidden;
    `;

    // Header (built once, persists across show() calls)
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px 10px;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      flex-shrink: 0;
    `;
    header.innerHTML = `
      <div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:20px;">🇫🇷</span>
          <span style="font-size:15px;font-weight:700;color:#f0f0f0;letter-spacing:0.2px;">France</span>
        </div>
        <div style="font-size:10px;color:#666;letter-spacing:0.08em;text-transform:uppercase;margin-top:2px;">Country Intelligence</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <button class="fi-lang-toggle" style="
          background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);
          color:#aaa;font-size:10px;font-weight:700;padding:3px 8px;border-radius:6px;
          cursor:pointer;letter-spacing:0.06em;">FR</button>
        <button class="fi-close" style="
          background:transparent;border:none;color:#666;font-size:16px;
          cursor:pointer;padding:2px 6px;line-height:1;">×</button>
      </div>
    `;

    this.contentEl = document.createElement('div');
    this.contentEl.className = 'france-intel-content';
    this.contentEl.style.cssText = `
      overflow-y: auto;
      flex: 1;
      padding: 0 16px 16px;
    `;

    this.modalEl.appendChild(header);
    this.modalEl.appendChild(this.contentEl);
    this.container.appendChild(this.modalEl);

    // Close button
    const closeBtn = header.querySelector('.fi-close') as HTMLElement;
    closeBtn.onclick = () => this.hide();

    // Lang toggle
    const langBtn = header.querySelector('.fi-lang-toggle') as HTMLElement;
    langBtn.onclick = () => {
      const current = langBtn.textContent?.trim() ?? 'FR';
      const next    = current === 'FR' ? 'EN' : 'FR';
      langBtn.textContent = next;
      document.dispatchEvent(new CustomEvent('france-intel-lang-toggle', {
        detail: { lang: next.toLowerCase() as 'fr' | 'en' },
      }));
    };

  }

  protected render(): void { /* populated by show() — not called by base mount() */ }

  setOnClose(handler: () => void): void {
    this.onClose = handler;
  }

  /** Returns the lang currently displayed — App.ts should pass this back when re-opening. */
  getCurrentLang(): 'fr' | 'en' {
    return this.currentLang;
  }

  show(data: FranceIntelData): void {
    if (!this.contentEl) return;
    this.currentLang = data.briefLang ?? 'fr';
    // Sync toggle button text to currentLang
    const langBtn = this.modalEl.querySelector('.fi-lang-toggle') as HTMLElement | null;
    if (langBtn) langBtn.textContent = this.currentLang.toUpperCase();
    this.renderContent(data);
    this._isVisible = true;
    this.modalEl.style.transform = 'translateX(0)';
  }

  showBriefLoading(): void {
    const briefEl = this.modalEl.querySelector('.fi-brief-text');
    if (briefEl) {
      briefEl.innerHTML = `<div style="display:flex;align-items:center;gap:8px;color:#666;font-size:12px;">
        <span style="display:inline-block;width:12px;height:12px;border:2px solid rgba(255,255,255,0.1);border-top-color:#4a9eff;border-radius:50%;animation:fi-spin 0.8s linear infinite;"></span>
        Génération du brief…
      </div>`;
    }
  }

  updateBrief(brief: string | null, freshness: 'fresh' | 'cached'): void {
    const briefEl = this.modalEl.querySelector('.fi-brief-text');
    const badgeEl = this.modalEl.querySelector('.fi-brief-badge');
    if (briefEl) {
      briefEl.innerHTML = brief
        ? brief.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n\n/g, '<br><br>')
        : `<span style="color:#555;font-size:12px;font-style:italic;">Brief indisponible</span>`;
    }
    if (badgeEl) {
      badgeEl.textContent = freshness === 'fresh' ? 'Fresh' : 'Cached';
      (badgeEl as HTMLElement).style.color = freshness === 'fresh' ? '#2ecc71' : '#f39c12';
    }
  }

  hide(): void {
    if (this.modalEl) this.modalEl.style.transform = 'translateX(100%)';
    this._isVisible = false;
    this.onClose?.();
  }

  isVisible(): boolean {
    return this._isVisible;
  }

  destroy(): void {
    this.modalEl?.remove();
  }

  private renderContent(data: FranceIntelData): void {
    if (!this.contentEl) return;

    const cii      = computeCII(data);
    const color    = ciiColor(cii);
    const social   = avgDim(data.stability.scores, 'social');
    const security = avgDim(data.stability.scores, 'security');
    const infra    = avgDim(data.stability.scores, 'infra');
    const cyber    = data.cyber.meta.globalScore;
    const lang     = data.briefLang ?? 'fr';

    // Active signals: non-green meteo alerts grouped by risk type
    const activeAlerts = data.meteo.filter(a => a.level !== 'green');
    const signalMap = new Map<string, { level: MeteoVigilanceLevel; count: number }>();
    for (const a of activeAlerts) {
      for (const risk of a.risks) {
        const existing = signalMap.get(risk);
        const isHigher = !existing || ['red', 'violet'].includes(a.level);
        signalMap.set(risk, {
          level: isHigher ? a.level : existing.level,
          count: (existing?.count ?? 0) + 1,
        });
      }
    }

    const sortedNews = [...data.topNews]
      .sort((a, b) => (SEV[b.threat?.level ?? 'info'] ?? 0) - (SEV[a.threat?.level ?? 'info'] ?? 0))
      .slice(0, 6);

    const signalChips = [...signalMap.entries()]
      .map(([risk, { level, count }]) => {
        const emoji = VIGILANCE_EMOJI[level] ?? '⚪';
        const label = RISK_LABELS[risk] ?? risk;
        return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);font-size:11px;color:#ccc;margin:2px;">${emoji} ${label}${count > 1 ? ` ×${count}` : ''}</span>`;
      }).join('');

    const updatedTime = new Date(data.stability.timestamp).toLocaleTimeString(
      lang === 'fr' ? 'fr-FR' : 'en-US',
      { hour: '2-digit', minute: '2-digit' },
    );

    // Inject spinner keyframe once
    if (!document.getElementById('fi-spin-style')) {
      const style = document.createElement('style');
      style.id = 'fi-spin-style';
      style.textContent = '@keyframes fi-spin { to { transform: rotate(360deg); } }';
      document.head.appendChild(style);
    }

    this.contentEl.innerHTML = `
      <!-- Section 1: Instability Index -->
      <div style="margin-top:14px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <span style="font-size:10px;color:#666;letter-spacing:0.1em;text-transform:uppercase;">${lang === 'fr' ? 'Indice d\'instabilité' : 'Instability Index'}</span>
          <span style="font-size:10px;color:#555;">${lang === 'fr' ? 'Mis à jour' : 'Updated'} ${updatedTime}</span>
        </div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
          <div style="font-size:32px;font-weight:800;color:${color};font-variant-numeric:tabular-nums;line-height:1;">${cii}</div>
          <div>
            <div style="font-size:12px;color:#aaa;">/ 100</div>
            <div style="font-size:11px;color:${color};font-weight:600;margin-top:2px;">→ ${ciiLabel(cii)}</div>
          </div>
        </div>
        <div style="font-size:11px;color:#666;margin-bottom:4px;">${lang === 'fr' ? 'Social' : 'Social'}</div>
        ${scoreBar(social, '#e74c3c')}
        <div style="font-size:11px;color:#666;margin-bottom:4px;">${lang === 'fr' ? 'Sécurité' : 'Security'}</div>
        ${scoreBar(security, '#e67e22')}
        <div style="font-size:11px;color:#666;margin-bottom:4px;">${lang === 'fr' ? 'Infrastructure' : 'Infrastructure'}</div>
        ${scoreBar(infra, '#f1c40f')}
        <div style="font-size:11px;color:#666;margin-bottom:4px;">Cyber</div>
        ${scoreBar(cyber, '#9b59b6')}
      </div>

      <!-- Section 2: Active Signals -->
      <div style="margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.06);">
        <div style="font-size:10px;color:#666;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:8px;">${lang === 'fr' ? 'Signaux Actifs' : 'Active Signals'}</div>
        <div style="line-height:1.8;">
          ${signalChips || `<span style="font-size:12px;color:#555;font-style:italic;">${lang === 'fr' ? 'Aucun signal actif' : 'No active signals'}</span>`}
        </div>
      </div>

      <!-- Section 3: Intelligence Brief -->
      <div style="margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.06);">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <span style="font-size:10px;color:#666;letter-spacing:0.1em;text-transform:uppercase;">${lang === 'fr' ? 'Brief Renseignement' : 'Intelligence Brief'}</span>
          <span class="fi-brief-badge" style="font-size:10px;color:#666;font-weight:600;"></span>
        </div>
        <div class="fi-brief-text" style="font-size:12px;color:#bbb;line-height:1.65;"></div>
      </div>

      <!-- Section 4: Top News -->
      <div style="margin-top:16px;padding-top:14px;border-top:1px solid rgba(255,255,255,0.06);">
        <div style="font-size:10px;color:#666;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:10px;">${lang === 'fr' ? 'Actualités Principales' : 'Key Headlines'}</div>
        ${sortedNews.map(item => {
          const level = item.threat?.level ?? 'info';
          const col   = LEVEL_COLORS[level] ?? '#666';
          const ago   = timeAgo(item.pubDate, lang);
          const title = escapeHtml(item.title);
          return `
            <div style="display:flex;gap:8px;margin-bottom:10px;align-items:flex-start;">
              <span style="display:inline-block;padding:2px 6px;border-radius:4px;background:${col}22;border:1px solid ${col}44;color:${col};font-size:9px;font-weight:700;letter-spacing:0.06em;white-space:nowrap;flex-shrink:0;">${THREAT_LABELS[level] ?? level.toUpperCase()}</span>
              <div style="flex:1;min-width:0;">
                <div style="font-size:11px;color:#ccc;line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${title}</div>
                <div style="font-size:10px;color:#555;margin-top:2px;">${escapeHtml(item.source)} • ${ago}</div>
              </div>
            </div>`;
        }).join('')}
        ${sortedNews.length === 0 ? `<span style="font-size:12px;color:#555;font-style:italic;">${lang === 'fr' ? 'Aucune actualité récente' : 'No recent news'}</span>` : ''}
      </div>
    `;

    // Show brief loading state (populated async by App.ts)
    this.showBriefLoading();
  }
}
