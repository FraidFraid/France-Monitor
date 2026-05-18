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

  private renderAlertCard(color: string, bg: string, icon: string, title: string, sub: string, body: string, sourceUrl: string, sourceLabel: string): string {
    return `
      <div style="background:${bg}; border:1px solid ${color}44; border-left:3px solid ${color}; border-radius:7px; padding:10px 12px; margin-bottom:8px;">
        <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:8px; margin-bottom:4px;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="font-size:14px;">${icon}</span>
            <span style="color:#fff; font-weight:700; font-size:12px;">${title}</span>
          </div>
        </div>
        <div style="color:#9898a8; font-size:10px; margin-bottom:3px;">${sub}</div>
        ${body ? `<div style="color:#c8c8d4; font-size:11px; line-height:1.5; margin-top:4px;">${body}</div>` : ''}
        ${sourceUrl ? `<div style="margin-top:6px;"><a href="${sourceUrl}" target="_blank" rel="noopener noreferrer" style="color:#64d2ff; font-size:10px; text-decoration:none;">${sourceLabel} ↗</a></div>` : ''}
      </div>`;
  }

  private renderAlertesDuMoment(data: HealthFeatures): string {
    type Bucket = 'rouge' | 'orange' | 'jaune';
    type AlertItem = { date: string; html: string };
    const buckets: Record<Bucket, AlertItem[]> = { rouge: [], orange: [], jaune: [] };

    const toBucket = (s: string): Bucket =>
      (s === 'crise' || s === 'critical') ? 'rouge'
      : (s === 'alerte' || s === 'high') ? 'orange'
      : 'jaune';

    const COLOR: Record<Bucket, string> = { rouge: '#ff3b30', orange: '#ff9500', jaune: '#ffd60a' };
    const BG:    Record<Bucket, string> = { rouge: 'rgba(255,59,48,0.10)', orange: 'rgba(255,149,0,0.08)', jaune: 'rgba(255,214,10,0.07)' };

    // Hantavirus clusters
    for (const ev of (data.hantavirusEvents ?? []).filter(e => e.activeContext === 'andes_active_cluster' && e.kind !== 'contact_case')) {
      const b = toBucket(ev.severite);
      buckets[b].push({
        date: ev.date_debut ?? '',
        html: this.renderAlertCard(
          COLOR[b], BG[b], '🧬',
          this.escapeHtml(ev.label),
          `Hantavirus · ${this.escapeHtml(ev.kind)} · ${this.escapeHtml(ev.date_debut)}`,
          ev.commentaires ? this.escapeHtml(ev.commentaires) : '',
          ev.url_sources[0] ? this.escapeHtml(ev.url_sources[0]) : '', 'Source',
        ),
      });
    }

    // Alertes épidémiques Odissé
    const EPIC_LABEL: Record<string, string> = { critical: 'CRITIQUE', high: 'ÉLEVÉ', warning: 'VIGILANCE' };
    for (const al of this.resolvedEpidemicAlerts) {
      const b = toBucket(al.severity);
      const locs = al.locations.slice(0, 4).join(', ') + (al.locations.length > 4 ? ` +${al.locations.length - 4}` : '');
      buckets[b].push({
        date: al.date ?? '',
        html: this.renderAlertCard(
          COLOR[b], BG[b], '🦠',
          `${this.escapeHtml(al.pathogen)} <span style="color:${COLOR[b]}; font-size:9px; font-weight:700; margin-left:4px;">${EPIC_LABEL[al.severity] ?? ''}</span>`,
          `Épidémie saisonnière · ${this.escapeHtml(al.date)}`,
          this.escapeHtml(locs),
          al.sourceUrl ? this.escapeHtml(al.sourceUrl) : '', 'SPF Odissé',
        ),
      });
    }

    if (this.epidemicAlertsLoading && Object.values(buckets).every(b => b.length === 0)) {
      return `
        <div style="margin-bottom:16px;">
          ${this.renderSectionHeader('Alertes du moment', '#ff453a')}
          <div style="padding:10px 12px; background:rgba(255,255,255,0.04); border-radius:7px; color:#9898a8; font-size:11px;">Chargement des signaux épidémiques…</div>
        </div>`;
    }

    const total = buckets.rouge.length + buckets.orange.length + buckets.jaune.length;
    if (total === 0) {
      return `
        <div style="margin-bottom:16px;">
          ${this.renderSectionHeader('Alertes du moment', '#9898a8')}
          <div style="padding:10px 12px; background:rgba(255,255,255,0.04); border-radius:7px; color:#9898a8; font-size:11px;">Aucune alerte active à ce stade.</div>
        </div>`;
    }

    const byDate = (a: AlertItem, b: AlertItem) => b.date.localeCompare(a.date);

    const renderGroup = (bucket: Bucket, label: string, openByDefault: boolean): string => {
      const items = buckets[bucket];
      if (items.length === 0) return '';
      const color = COLOR[bucket];
      const cards = items.sort(byDate).map(i => i.html).join('');
      return `
        <details${openByDefault ? ' open' : ''} style="margin-bottom:6px; border-radius:7px; overflow:hidden;">
          <summary style="cursor:pointer; padding:7px 10px; background:${BG[bucket]}; border:1px solid ${color}44; border-radius:7px; display:flex; align-items:center; gap:7px; user-select:none; list-style:none;">
            <span style="width:8px; height:8px; border-radius:50%; background:${color}; flex-shrink:0;"></span>
            <span style="color:${color}; font-size:11px; font-weight:700; flex:1;">${label} <span style="color:#9898a8; font-weight:400;">(${items.length})</span></span>
            <span style="color:#9898a8; font-size:10px;">▾</span>
          </summary>
          <div style="padding:8px 0 2px;">${cards}</div>
        </details>`;
    };

    return `
      <div style="margin-bottom:16px;">
        ${this.renderSectionHeader(`Alertes du moment (${total})`, '#ff453a')}
        ${renderGroup('rouge', 'Critique / Crise', true)}
        ${renderGroup('orange', 'Alerte / Élevé', false)}
        ${renderGroup('jaune', 'Vigilance / Surveillance', false)}
      </div>`;
  }

  private renderHantavirusSituation(data: HealthFeatures): string {
    const snapshot = data.hantavirusSnapshot;
    if (!snapshot) return '';

    const franceConfirmed = snapshot.franceConfirmedCases ?? 'n/d';
    const franceContacts = snapshot.franceContactsMonitored ?? 'n/d';
    const globalConfirmed = snapshot.globalConfirmed ?? 'n/d';
    const globalProbable = snapshot.globalProbable ?? 'n/d';
    const globalInconclusive = snapshot.globalInconclusive ?? 'n/d';
    const deaths = snapshot.deaths ?? 'n/d';
    const riskLabel = snapshot.riskGeneralPopulation === 'very_low'
      ? 'très faible'
      : snapshot.riskGeneralPopulation === 'low'
        ? 'faible'
        : snapshot.riskGeneralPopulation === 'moderate'
          ? 'modéré'
          : snapshot.riskGeneralPopulation === 'high'
            ? 'élevé'
            : 'inconnu';

    const sourceLinks = snapshot.sourceUrls
      .slice(0, 3)
      .map((url, index) => `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color:#64d2ff; text-decoration:none;">Source ${index + 1}</a>`)
      .join(' · ');

    const narrative = snapshot.narrative
      .map((line) => `<li style="margin:4px 0; color:#c8c8d4; line-height:1.45;">${this.escapeHtml(line)}</li>`)
      .join('');

    return `
      <div style="margin-bottom:16px;">
        ${this.renderSectionHeader('Hantavirus — Situation', '#64d2ff')}
        <div style="padding:10px 12px; background:rgba(100,210,255,0.08); border:1px solid rgba(100,210,255,0.18); border-radius:8px; margin-bottom:8px;">
          <div style="display:grid; grid-template-columns:1fr auto; gap:4px 10px; font-size:11px;">
            <span style="color:#9898a8;">Cluster actif</span><strong style="color:#fff;">${snapshot.activeCluster === 'MV_HONDIUS' ? 'MV Hondius / Andes' : 'Aucun'}</strong>
            <span style="color:#9898a8;">France</span><strong style="color:#fff;">${franceConfirmed} confirmé · ${franceContacts} contacts</strong>
            <span style="color:#9898a8;">Monde</span><strong style="color:#fff;">${globalConfirmed} confirmés · ${globalProbable} probables · ${globalInconclusive} inconclusif(s)</strong>
            <span style="color:#9898a8;">Décès</span><strong style="color:#fff;">${deaths}</strong>
            <span style="color:#9898a8;">Risque population générale</span><strong style="color:#fff;">${riskLabel}</strong>
            <span style="color:#9898a8;">Horodatage</span><strong style="color:#fff;">${new Date(snapshot.asOf).toLocaleString('fr-FR')}</strong>
          </div>
        </div>
        <div style="padding:10px 12px; background:rgba(255,255,255,0.03); border-radius:8px;">
          <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.6px; color:#5a5a72; margin-bottom:6px;">Ce que cela signifie</div>
          <ul style="margin:0; padding-left:18px;">${narrative}</ul>
        </div>
        <div style="margin-top:8px; font-size:10px;">${sourceLinks}</div>
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
        </div>
      </details>`;

    // ── Assemblage ───────────────────────────────────────────────────────────
    this.contentEl.innerHTML = `
      <div style="padding:14px 16px 16px; overflow-y:auto; flex:1; font-size:13px;">
        ${this.renderHantavirusSituation(data)}
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
