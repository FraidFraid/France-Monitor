import { Panel } from './Panel.ts';
import {
  applyPremiumCloseButtonHover,
  createPremiumIconHeader,
  getPremiumCloseButtonStyle,
  getPremiumModalStyle,
} from './panelHeader.ts';
import type { HealthFeatures } from '../types/index.ts';

const ODISSE_WINTER_ALERTS_URL =
  'https://odisse.santepubliquefrance.fr/api/explore/v2.1/catalog/datasets/ma_region_epidemies_hivernales_alertes/records?limit=100&order_by=-date&where=valeur%20%3E%3D%203';
const ODISSE_RECENT_SIGNAL_WINDOW_DAYS = 90;

const REGION_CODE_TO_NAME: Record<string, string> = {
  '01': 'Guadeloupe',
  '02': 'Martinique',
  '03': 'Guyane',
  '04': 'La Réunion',
  '06': 'Mayotte',
  '11': 'Île-de-France',
  '24': 'Centre-Val de Loire',
  '27': 'Bourgogne-Franche-Comté',
  '28': 'Normandie',
  '32': 'Hauts-de-France',
  '44': 'Grand Est',
  '52': 'Pays de la Loire',
  '53': 'Bretagne',
  '75': 'Nouvelle-Aquitaine',
  '76': 'Occitanie',
  '84': 'Auvergne-Rhône-Alpes',
  '93': "Provence-Alpes-Côte d'Azur",
  '94': 'Corse',
};

export class NationalHealthPanel extends Panel {
  private modalEl!: HTMLElement;
  private contentEl: HTMLElement | null = null;
  private closeBtn: HTMLElement | null = null;
  private onClose?: () => void;
  private currentData: HealthFeatures | null = null;
  private resolvedEpidemicAlerts: HealthFeatures['epidemicAlerts'] = [];
  private epidemicAlertsLoading = false;

  constructor(container: HTMLElement) {
    super(container, { title: 'Indicateurs Santé', icon: '🇫🇷', collapsible: false });
  }

  setOnClose(handler: () => void): void {
    this.onClose = handler;
  }

  mount(): void {
    this.modalEl = document.createElement('div');
    this.modalEl.style.cssText = `
      ${getPremiumModalStyle({
        width: '400px',
        maxHeight: 'calc(100vh - var(--header-height) - 40px)',
        backgroundStart: 'rgba(12, 18, 31, 0.97)',
        backgroundEnd: 'rgba(13, 16, 26, 0.96)',
        borderColor: 'rgba(52, 211, 153, 0.16)',
        top: 'calc(var(--header-height) + 20px)',
      })}
    `;

    // Close button
    this.closeBtn = document.createElement('button');
    this.closeBtn.innerHTML = '✕';
    this.closeBtn.style.cssText = getPremiumCloseButtonStyle();
    applyPremiumCloseButtonHover(this.closeBtn);
    this.closeBtn.onclick = () => this.hide();
    // Create separate header to attach drag events
    const header = createPremiumIconHeader({
      icon: '🇫🇷',
      title: 'Indicateurs Santé Nationaux',
      subtitle: 'France métropolitaine et outre-mer',
      gradientStart: 'rgba(52, 211, 153, 0.16)',
      gradientEnd: 'rgba(59, 130, 246, 0.10)',
      iconGradientStart: 'rgba(52, 211, 153, 0.22)',
      iconGradientEnd: 'rgba(59, 130, 246, 0.14)',
      titlePrefix: 'Santé publique',
    });
    header.style.cursor = 'move';
    header.style.flexShrink = '0';

    // Make it draggable
    let isDragging = false;
    let startX = 0; let startY = 0;
    let initialX = 0; let initialY = 0;

    header.addEventListener('mousedown', (e) => {
      if (e.target === this.closeBtn || this.closeBtn?.contains(e.target as Node)) return;
      e.preventDefault();
      e.stopPropagation();

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      initialX = this.modalEl.offsetLeft;
      initialY = this.modalEl.offsetTop;

      this.modalEl.style.right = 'auto';
      this.modalEl.style.bottom = 'auto';
      this.modalEl.style.left = `${initialX}px`;
      this.modalEl.style.top = `${initialY}px`;
      this.modalEl.style.transform = 'none';

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      let newX = initialX + (e.clientX - startX);
      let newY = initialY + (e.clientY - startY);

      const maxX = window.innerWidth - this.modalEl.offsetWidth;
      const maxY = window.innerHeight - this.modalEl.offsetHeight;
      newX = Math.max(0, Math.min(newX, maxX));
      newY = Math.max(0, Math.min(newY, maxY + this.modalEl.offsetHeight - 60));

      this.modalEl.style.left = `${newX}px`;
      this.modalEl.style.top = `${newY}px`;
    };

    const onMouseUp = () => {
      isDragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    this.modalEl.appendChild(this.closeBtn);
    this.modalEl.appendChild(header);

    this.contentEl = document.createElement('div');
    this.contentEl.style.cssText = `
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    `;
    this.modalEl.appendChild(this.contentEl);

    this.container.appendChild(this.modalEl);
    this.render();
  }

  protected render(): void { }

  private escapeHtml(input: string): string {
    return input
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  private hantavirusSeverityColor(severity: HealthFeatures['hantavirusEvents'][number]['severite']): string {
    switch (severity) {
      case 'crise':
        return '#ff3b30';
      case 'alerte':
        return '#ff9500';
      case 'surveillance':
        return '#ffd60a';
      case 'info':
      default:
        return '#64d2ff';
    }
  }

  private hantavirusDisplayLabel(event: HealthFeatures['hantavirusEvents'][number]): string {
    if (event.type === 'zone_historique') {
      return `Zone historique SPF (circulation documentée 2005-2023) · ${event.label.replace(/^Zone historique hantavirus -\s*/i, '').replace(/^Zone historique elargie -\s*/i, '')}`;
    }
    return event.label;
  }

  private renderHantavirusEventCard(event: HealthFeatures['hantavirusEvents'][number]): string {
    const severityColor = this.hantavirusSeverityColor(event.severite);
    const sourceUrl = event.url_sources[0] ?? '';
    const periodLabel = event.date_fin
      ? `${event.date_debut} → ${event.date_fin}`
      : event.date_debut;

    return `
      <div style="padding:9px 10px; border-radius:8px; background:rgba(255,255,255,0.04); border:1px solid ${severityColor}44; border-left:3px solid ${severityColor}; margin-bottom:8px;">
        <div style="display:flex; justify-content:space-between; gap:8px; margin-bottom:5px; align-items:flex-start;">
          <strong style="color:#f3f4f6; font-size:12px; line-height:1.35;">${this.escapeHtml(this.hantavirusDisplayLabel(event))}</strong>
          <span style="color:${severityColor}; font-size:10px; text-transform:uppercase; font-weight:700; white-space:nowrap;">${this.escapeHtml(event.severite)}</span>
        </div>
        <div style="color:#9898a8; font-size:10px; line-height:1.45; margin-bottom:4px;">${this.escapeHtml(event.type)} · ${this.escapeHtml(event.territoire_niveau)} · ${this.escapeHtml(event.territoire_code)}</div>
        <div style="color:#c8c8d4; font-size:10px; line-height:1.45;">${this.escapeHtml(periodLabel)}</div>
        ${event.commentaires ? `<div style="color:#aeb3c2; font-size:10px; line-height:1.45; margin-top:5px;">${this.escapeHtml(event.commentaires)}</div>` : ''}
        ${sourceUrl ? `<div style="margin-top:6px;"><a href="${this.escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer" style="color:#64d2ff; text-decoration:none; font-size:10px;">Source ↗</a></div>` : ''}
      </div>
    `;
  }

  private isWithinDays(isoDate: string, days: number): boolean {
    const ts = Date.parse(`${isoDate}T00:00:00Z`);
    if (Number.isNaN(ts)) return false;
    return Date.now() - ts <= days * 24 * 60 * 60 * 1000;
  }


  show(data: HealthFeatures): void {
    this.currentData = data;
    if ((data.epidemicAlerts ?? []).length > 0) {
      this.resolvedEpidemicAlerts = data.epidemicAlerts;
    }

    if (!this.contentEl) return;
    this.modalEl.style.display = 'flex';

    // Safety bounds check
    const rect = this.modalEl.getBoundingClientRect();
    if (rect.right < 50 || rect.bottom < 50 || rect.left > window.innerWidth - 50 || rect.top > window.innerHeight - 50) {
      this.modalEl.style.right = '20px';
      this.modalEl.style.top = 'calc(var(--header-height) + 20px)';
      this.modalEl.style.left = 'auto';
    }

    this.renderContent();

    if ((data.epidemicAlerts ?? []).length === 0 && !this.epidemicAlertsLoading) {
      void this.loadEpidemicAlertsFallback();
    }
  }

  private renderSectionHeader(label: string, color: string): string {
    return `<div style="font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:${color}; margin:0 0 8px; padding-bottom:5px; border-bottom:1px solid rgba(255,255,255,0.07);">${label}</div>`;
  }

  private renderAlertesDuMoment(data: HealthFeatures): string {
    const SEVERITY_RANK = { crise: 4, alerte: 3, high: 3, warning: 2, surveillance: 2, info: 1 } as const;
    const SEVERITY_COLOR: Record<string, string> = {
      crise: '#ff3b30', alerte: '#ff9500', high: '#ff9500', warning: '#ffd60a', surveillance: '#ffd60a', info: '#64d2ff',
    };
    const SEVERITY_LABEL: Record<string, string> = {
      crise: 'CRISE', alerte: 'ALERTE', high: 'ÉLEVÉ', warning: 'VIGILANCE', surveillance: 'SURVEILLANCE', info: 'INFO',
    };

    type AlertItem = { rank: number; html: string };
    const items: AlertItem[] = [];

    // Hantavirus clusters
    for (const ev of (data.hantavirusEvents ?? []).filter(e => e.type === 'cluster')) {
      const color = SEVERITY_COLOR[ev.severite] ?? '#9898a8';
      const label = SEVERITY_LABEL[ev.severite] ?? ev.severite.toUpperCase();
      const rank = SEVERITY_RANK[ev.severite as keyof typeof SEVERITY_RANK] ?? 1;
      const sourceUrl = ev.url_sources[0] ?? '';
      items.push({ rank, html: `
        <div style="background:rgba(255,255,255,0.04); border:1px solid ${color}44; border-left:3px solid ${color}; border-radius:7px; padding:10px 12px; margin-bottom:8px;">
          <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px; margin-bottom:4px;">
            <div style="display:flex; align-items:center; gap:6px;">
              <span style="font-size:14px;">🧬</span>
              <span style="color:#fff; font-weight:700; font-size:12px;">${this.escapeHtml(ev.label)}</span>
            </div>
            <span style="flex-shrink:0; background:${color}22; border:1px solid ${color}66; color:${color}; font-size:9px; font-weight:700; letter-spacing:0.5px; padding:2px 7px; border-radius:3px;">${label}</span>
          </div>
          <div style="color:#9898a8; font-size:10px; margin-bottom:3px;">Hantavirus · ${this.escapeHtml(ev.territoire_niveau)} · ${this.escapeHtml(ev.date_debut)}</div>
          ${ev.commentaires ? `<div style="color:#c8c8d4; font-size:11px; line-height:1.5; margin-top:4px;">${this.escapeHtml(ev.commentaires)}</div>` : ''}
          ${sourceUrl ? `<div style="margin-top:6px;"><a href="${this.escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer" style="color:#64d2ff; font-size:10px; text-decoration:none;">Source ↗</a></div>` : ''}
        </div>` });
    }

    // Alertes épidémiques Odissé
    const EPIDEMIC_COLOR: Record<string, string> = { critical: '#ff3b30', high: '#ff9500', warning: '#ffd60a' };
    const EPIDEMIC_LABEL: Record<string, string> = { critical: 'CRITIQUE', high: 'ÉLEVÉ', warning: 'VIGILANCE' };
    for (const al of this.resolvedEpidemicAlerts) {
      const color = EPIDEMIC_COLOR[al.severity] ?? '#ffd60a';
      const label = EPIDEMIC_LABEL[al.severity] ?? 'VIGILANCE';
      const rank = SEVERITY_RANK[al.severity as keyof typeof SEVERITY_RANK] ?? 2;
      const locs = al.locations.slice(0, 3).join(', ') + (al.locations.length > 3 ? ` +${al.locations.length - 3}` : '');
      items.push({ rank, html: `
        <div style="background:rgba(255,255,255,0.04); border:1px solid ${color}44; border-left:3px solid ${color}; border-radius:7px; padding:10px 12px; margin-bottom:8px;">
          <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px; margin-bottom:4px;">
            <div style="display:flex; align-items:center; gap:6px;">
              <span style="font-size:14px;">🦠</span>
              <span style="color:#fff; font-weight:700; font-size:12px;">${this.escapeHtml(al.pathogen)}</span>
            </div>
            <span style="flex-shrink:0; background:${color}22; border:1px solid ${color}66; color:${color}; font-size:9px; font-weight:700; letter-spacing:0.5px; padding:2px 7px; border-radius:3px;">${label}</span>
          </div>
          <div style="color:#9898a8; font-size:10px; margin-bottom:3px;">Épidémie saisonnière · ${this.escapeHtml(al.date)}</div>
          <div style="color:#c8c8d4; font-size:11px; line-height:1.5; margin-top:4px;">${this.escapeHtml(locs)}</div>
          ${al.sourceUrl ? `<div style="margin-top:6px;"><a href="${this.escapeHtml(al.sourceUrl)}" target="_blank" rel="noopener noreferrer" style="color:#64d2ff; font-size:10px; text-decoration:none;">SPF Odissé ↗</a></div>` : ''}
        </div>` });
    }

    if (this.epidemicAlertsLoading && items.length === 0) {
      return `
        <div style="margin-bottom:16px;">
          ${this.renderSectionHeader('Alertes du moment', '#ff453a')}
          <div style="padding:10px 12px; background:rgba(255,255,255,0.04); border-radius:7px; color:#9898a8; font-size:11px;">Chargement des signaux épidémiques…</div>
        </div>`;
    }

    const cardsHtml = items.length > 0
      ? items.sort((a, b) => b.rank - a.rank).map(i => i.html).join('')
      : `<div style="padding:10px 12px; background:rgba(255,255,255,0.04); border-radius:7px; color:#9898a8; font-size:11px;">Aucune alerte active à ce stade.</div>`;

    return `
      <div style="margin-bottom:16px;">
        ${this.renderSectionHeader(`Alertes du moment${items.length > 0 ? ` (${items.length})` : ''}`, '#ff453a')}
        ${cardsHtml}
      </div>`;
  }

  private renderContent(): void {
    if (!this.contentEl || !this.currentData) return;

    const data = this.currentData;

    // ── 2. Réseau Sentinelles ────────────────────────────────────────────────
    const sentItems = data.sentinellesIndicators ?? [];
    const sentIndicatorsHtml = sentItems.length > 0
      ? sentItems.map(ind => {
          let trendHtml = '';
          if (ind.trend !== undefined && Math.abs(ind.trend) > 0.1) {
            trendHtml = ind.trend > 0
              ? `<span style="color:#ff3b30; font-size:12px; margin-left:6px; font-weight:bold;">↑</span>`
              : `<span style="color:#34c759; font-size:12px; margin-left:6px; font-weight:bold;">↓</span>`;
          } else if (ind.trend !== undefined) {
            trendHtml = `<span style="color:#9898a8; font-size:12px; margin-left:6px; font-weight:bold;">→</span>`;
          }
          return `
            <div style="display:flex; justify-content:space-between; margin-bottom:5px; align-items:center;">
              <span style="color:#d8d8df;">${ind.label}</span>
              <span><strong style="color:#bf5af2; font-size:14px;">${ind.nationalIncidence.toFixed(1)}</strong><span style="color:#9898a8; font-size:11px; margin-left:2px;">/100k</span>${trendHtml}</span>
            </div>`;
        }).join('')
      : '<div style="color:#9898a8; font-size:11px;">Aucun indicateur disponible.</div>';

    const sentinellesHtml = `
      <div style="margin-bottom:16px;">
        ${this.renderSectionHeader('Réseau Sentinelles — Incidence', '#bf5af2')}
        <div style="color:#9898a8; font-size:10px; margin-bottom:8px;">Semaine : ${data.sentinellesLastWeekAvailable ?? 'n/d'} · France entière</div>
        ${sentIndicatorsHtml}
      </div>`;

    // ── 3. ANSM Pénuries ─────────────────────────────────────────────────────
    const ansmUrl = data.drugShortagesUrl ?? 'https://ansm.sante.fr/disponibilites-des-produits-de-sante/medicaments';
    const ansmItems = data.drugShortagesItems ?? [];
    const badgeColors: Record<string, string> = { rupture: '#ff3b30', tension: '#ff9500', normalisation: '#34c759' };
    const mixedItems = [
      ...ansmItems.filter(i => i.status === 'rupture').slice(0, 4),
      ...ansmItems.filter(i => i.status === 'tension').slice(0, 3),
      ...ansmItems.filter(i => i.status === 'normalisation').slice(0, 2),
    ];
    const ansmListHtml = mixedItems.length > 0
      ? mixedItems.map(it => `
          <li style="margin:3px 0; display:flex; align-items:flex-start;">
            <span style="display:inline-block; width:6px; height:6px; border-radius:50%; background:${badgeColors[it.status] || '#9898a8'}; margin-right:6px; margin-top:4px; flex-shrink:0;"></span>
            <span style="color:#d8d8df; line-height:1.4; font-size:11px;">${this.escapeHtml(it.drugName)} <span style="color:${badgeColors[it.status] || '#9898a8'};"> (${it.status})</span></span>
          </li>`).join('')
      : '<li style="color:#9898a8; font-size:11px;">Liste non disponible dans ce cycle.</li>';
    const ansmLastUpdate = data.drugShortagesLastUpdate
      ? new Date(data.drugShortagesLastUpdate).toLocaleDateString('fr-FR') : 'n/d';

    const ansmHtml = `
      <div style="margin-bottom:16px;">
        ${this.renderSectionHeader('ANSM — Pénuries médicaments', '#ff9f0a')}
        <div style="display:grid; grid-template-columns:1fr auto; gap:4px 10px; font-size:11px; margin-bottom:10px; padding:8px 10px; background:rgba(0,0,0,0.2); border-radius:6px;">
          <span style="color:#9898a8;">Rupture</span><strong style="color:#ff3b30;">${data.drugShortagesByStatus?.rupture ?? 0}</strong>
          <span style="color:#9898a8;">Tension</span><strong style="color:#ff9500;">${data.drugShortagesByStatus?.tension ?? 0}</strong>
          <span style="color:#9898a8;">Normalisation</span><strong style="color:#34c759;">${data.drugShortagesByStatus?.normalisation ?? 0}</strong>
          <span style="color:#9898a8;">Màj</span><strong style="color:#d8d8df;">${ansmLastUpdate}</strong>
        </div>
        <ul style="margin:0 0 8px; padding:0; list-style:none; max-height:130px; overflow:auto;">${ansmListHtml}</ul>
        <a href="${ansmUrl}" target="_blank" rel="noopener noreferrer" style="font-size:10px; color:#64d2ff; text-decoration:none;">Voir tout sur ansm.sante.fr →</a>
      </div>`;

    // ── 4. Données de référence (plié) ───────────────────────────────────────
    const historicalZones = (data.hantavirusEvents ?? []).filter(e => e.type === 'zone_historique');
    const historicalHtml = historicalZones.length > 0
      ? historicalZones.slice(0, 12).map(e => this.renderHantavirusEventCard(e)).join('')
        + (historicalZones.length > 12 ? `<div style="color:#9898a8; font-size:10px; margin-top:4px;">+ ${historicalZones.length - 12} zones supplémentaires.</div>` : '')
      : '<div style="color:#9898a8; font-size:11px;">Aucune zone historique chargée.</div>';

    const checkedAt = data.epidemiologyFreshness?.checkedAt
      ? new Date(data.epidemiologyFreshness.checkedAt).toLocaleString('fr-FR') : 'n/d';
    const staleBadge = (data.epidemiologyFreshness?.obsoleteCount ?? 0) > 0
      ? `<span style="color:#ff453a;">${data.epidemiologyFreshness.obsoleteCount} obsolète(s)</span>`
      : `<span style="color:#34c759;">à jour</span>`;

    const referenceHtml = `
      <details style="margin-bottom:12px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.07); border-radius:8px;">
        <summary style="cursor:pointer; padding:9px 12px; color:#9898a8; font-size:11px; font-weight:600; user-select:none;">
          Données de référence &amp; fraîcheur
        </summary>
        <div style="padding:10px 12px; border-top:1px solid rgba(255,255,255,0.06);">
          <div style="font-size:10px; font-weight:700; text-transform:uppercase; color:#5a5a72; letter-spacing:0.6px; margin-bottom:6px;">Fraîcheur SPF / Odissé</div>
          <div style="display:grid; grid-template-columns:1fr auto; gap:4px 10px; font-size:11px; padding:8px; background:rgba(0,0,0,0.2); border-radius:6px; margin-bottom:12px;">
            <span style="color:#9898a8;">Dernier contrôle</span><strong style="color:#d8d8df;">${checkedAt}</strong>
            <span style="color:#9898a8;">Seuil obsolescence</span><strong>${data.epidemiologyFreshness?.staleAfterDays ?? '—'} j</strong>
            <span style="color:#9898a8;">État</span>${staleBadge}
          </div>
          <div style="font-size:10px; font-weight:700; text-transform:uppercase; color:#5a5a72; letter-spacing:0.6px; margin-bottom:6px;">Zones historiques Hantavirus SPF 2005-2023</div>
          <div style="color:#9898a8; font-size:10px; margin-bottom:8px;">Circulation documentée — ce ne sont pas des cas 2026.</div>
          ${historicalHtml}
        </div>
      </details>`;

    // ── Assemblage ───────────────────────────────────────────────────────────
    this.contentEl.innerHTML = `
      <div style="padding:14px 16px 16px; overflow-y:auto; flex:1; font-size:13px;">
        ${this.renderAlertesDuMoment(data)}
        ${sentinellesHtml}
        ${ansmHtml}
        ${referenceHtml}
        <div style="margin-top:10px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.07); text-align:center;">
          <button onclick="document.dispatchEvent(new CustomEvent('open-health-barometer'))" style="width:100%; background:linear-gradient(135deg,rgba(46,204,113,0.15),rgba(231,76,60,0.15)); border:1px solid rgba(255,255,255,0.15); color:#fff; padding:9px 16px; border-radius:8px; font-size:12px; font-weight:600; cursor:pointer; letter-spacing:0.3px;">🩺 Baromètre national Santé</button>
        </div>
      </div>
    `;
  }

  private async loadEpidemicAlertsFallback(): Promise<void> {
    this.epidemicAlertsLoading = true;
    this.renderContent();

    try {
      const resp = await fetch(ODISSE_WINTER_ALERTS_URL, {
        headers: { Accept: 'application/json' },
      });

      if (!resp.ok) {
        this.resolvedEpidemicAlerts = [];
        return;
      }

      const payload = await resp.json() as {
        results?: Array<{ theme?: string; reg?: string; date?: string; date_lib?: string; valeur?: number }>;
      };

      const rows = Array.isArray(payload.results) ? payload.results : [];
      const recentRows = rows.filter((row) => this.isWithinDays(String(row?.date ?? '').trim(), ODISSE_RECENT_SIGNAL_WINDOW_DAYS));
      if (recentRows.length === 0) {
        this.resolvedEpidemicAlerts = [];
        return;
      }

      const latestByRegionTheme = new Map<string, {
        theme: string;
        regionCode: string;
        regionName: string;
        date: string;
        dateLib: string;
        level: number;
      }>();

      for (const row of recentRows) {
        const date = String(row?.date ?? '').trim();
        const theme = String(row?.theme ?? '').trim();
        const regionCode = String(row?.reg ?? '').trim();
        const level = Number(row?.valeur);
        const dateLib = String(row?.date_lib ?? '').trim();

        if (!date || !theme || !regionCode || !Number.isFinite(level) || level < 3) continue;

        const key = `${theme}::${regionCode}`;
        const prev = latestByRegionTheme.get(key);
        if (prev && prev.date >= date) continue;

        latestByRegionTheme.set(key, {
          theme,
          regionCode,
          regionName: REGION_CODE_TO_NAME[regionCode] ?? `Région ${regionCode}`,
          date,
          dateLib,
          level,
        });
      }

      const grouped = new Map<string, {
        theme: string;
        latestDate: string;
        latestDateLib: string;
        maxLevel: number;
        locations: string[];
      }>();

      for (const row of latestByRegionTheme.values()) {
        const key = row.theme;
        const existing = grouped.get(key) ?? {
          theme: row.theme,
          latestDate: row.date,
          latestDateLib: row.dateLib,
          maxLevel: row.level,
          locations: [],
        };

        if (row.date > existing.latestDate) {
          existing.latestDate = row.date;
          existing.latestDateLib = row.dateLib;
        }
        existing.maxLevel = Math.max(existing.maxLevel, row.level);
        existing.locations.push(`${row.regionName} (${row.dateLib}, niveau ${row.level})`);
        grouped.set(key, existing);
      }

      this.resolvedEpidemicAlerts = [...grouped.values()]
        .map((entry) => ({
          id: `odisee-${this.slugify(`${entry.theme}-${entry.latestDateLib}`)}`,
          pathogen: entry.theme,
          severity: entry.maxLevel >= 4 ? 'high' as const : 'warning' as const,
          title: `${entry.theme} · signaux hivernaux SPF`,
          summary: `Signaux de niveau 3 ou 4 relevés sur les ${ODISSE_RECENT_SIGNAL_WINDOW_DAYS} derniers jours. Dernier bulletin concerné : ${entry.latestDateLib}.`,
          locations: entry.locations.slice(0, 6),
          date: entry.latestDate,
          sourceLabel: 'Santé publique France / Odissé',
          sourceUrl: 'https://odisse.santepubliquefrance.fr/explore/dataset/ma_region_epidemies_hivernales_alertes/api/?flg=fr-fr',
        }))
        .sort((a, b) => b.date.localeCompare(a.date));
    } catch {
      this.resolvedEpidemicAlerts = [];
    } finally {
      this.epidemicAlertsLoading = false;
      this.renderContent();
    }
  }

  private slugify(input: string): string {
    return input
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  hide(): void {
    if (this.modalEl) this.modalEl.style.display = 'none';
    this.onClose?.();
  }

  isVisible(): boolean {
    return this.modalEl?.style.display === 'flex';
  }
}
