import { Panel } from './Panel.ts';
import { fmLoaderHTML } from './shared/loader.ts';
import { fmIcon, fmEmptyStateHTML } from './shared/icons.ts';
import type {
  DromEnergyDashboard,
  DromEnergyAsset,
  DromEnergyCommuneMetric,
  DromEnergyProductionLimitation,
} from '../services/drom-energy/index.ts';

const PANEL_COLORS = {
  text: '#E8EEF9',
  muted: '#94A3B8',
  cyan: '#38BDF8',
  cyanSoft: 'rgba(56, 189, 248, 0.16)',
  slateSoft: 'rgba(148, 163, 184, 0.14)',
  amber: '#F59E0B',
  amberSoft: 'rgba(245, 158, 11, 0.14)',
  red: '#EF4444',
} as const;

type FilterState = {
  territory: string;
  assetType: string;
  dataset: string;
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });
}

function metricCard(label: string, value: string, detail: string, color: string, background: string): string {
  return `
    <div style="min-width:0;background:${background};border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:10px;">
      <div style="font-size:10px;color:${PANEL_COLORS.muted};text-transform:uppercase;letter-spacing:0.05em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(label)}</div>
      <div style="margin-top:4px;font-size:18px;font-weight:700;color:${escapeHtml(color)};">${escapeHtml(value)}</div>
      <div title="${escapeHtml(detail)}" style="margin-top:2px;font-size:11px;color:${PANEL_COLORS.muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(detail)}</div>
    </div>
  `;
}

function getAssetTypeColor(type: DromEnergyAsset['type']): string {
  switch (type) {
    case 'source_substation':
      return '#4FD1FF';
    case 'htb_pylon':
      return '#3B82F6';
    case 'production_site':
      return '#2DD4BF';
    default:
      return '#60A5FA';
  }
}

function getAssetTypeLabel(type: DromEnergyAsset['type']): string {
  switch (type) {
    case 'source_substation':
      return 'Postes sources';
    case 'htb_pylon':
      return 'Pylônes HTB';
    case 'production_site':
      return 'Sites de production';
    default:
      return type;
  }
}

function renderAssetLegend(): string {
  const items: DromEnergyAsset['type'][] = ['source_substation', 'htb_pylon', 'production_site'];
  return `
    <div style="background:rgba(15,23,42,0.72);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:10px 12px;margin-bottom:12px;">
      <div style="font-size:12px;font-weight:700;color:${PANEL_COLORS.text};margin-bottom:8px;">Légende actifs</div>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;">
        ${items.map((type) => `
          <div style="display:flex;align-items:center;gap:7px;min-width:0;font-size:11px;color:${PANEL_COLORS.muted};">
            <span style="width:9px;height:9px;border-radius:50%;background:${getAssetTypeColor(type)};box-shadow:0 0 0 2px rgba(255,255,255,0.08);flex:0 0 auto;"></span>
            <span title="${escapeHtml(getAssetTypeLabel(type))}" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(getAssetTypeLabel(type))}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

export class DromEnergyPanel extends Panel {
  private modalEl!: HTMLElement;
  private contentEl: HTMLElement | null = null;
  private onClose?: () => void;
  private onHoverAsset?: (asset: DromEnergyAsset | null) => void;
  private dashboard: DromEnergyDashboard | null = null;
  private errorMessage: string | null = null;
  private loading = false;
  private filters: FilterState = {
    territory: 'all',
    assetType: 'all',
    dataset: 'all',
  };

  constructor(container: HTMLElement) {
    super(container, { title: 'Énergie DROM / SEI', collapsible: false });
  }

  mount(): void {
    this.modalEl = document.createElement('div');
    this.modalEl.className = 'drom-energy-panel-modal';
    this.modalEl.style.cssText = `
      position:absolute;
      top:var(--right-panel-top);
      right:20px;
      width:400px;
      max-height:calc(100vh - var(--right-panel-top) - 20px);
      background:linear-gradient(180deg, rgba(7, 18, 31, 0.97), rgba(7, 15, 26, 0.96));
      border:1px solid rgba(56, 189, 248, 0.22);
      border-radius:14px;
      box-shadow:0 12px 34px rgba(2, 6, 23, 0.52);
      z-index:1000;
      display:none;
      flex-direction:column;
      backdrop-filter:blur(12px);
      overflow:hidden;
    `;

    this.modalEl.innerHTML = `
      <button class="drom-energy-panel-close" aria-label="Fermer" style="
        position:absolute;top:12px;right:12px;background:rgba(255,255,255,0.08);
        border:none;color:${PANEL_COLORS.muted};cursor:pointer;font-size:14px;width:28px;height:28px;
        border-radius:14px;display:flex;align-items:center;justify-content:center;z-index:10;
      ">${fmIcon('x')}</button>
      <div style="
        padding:18px 16px 14px;border-bottom:1px solid rgba(255,255,255,0.06);
        display:flex;align-items:center;gap:14px;
        background:linear-gradient(135deg, rgba(8,145,178,0.22), rgba(245,158,11,0.10));
      ">
        <div style="position:relative;width:68px;height:68px;">
          <svg viewBox="0 0 36 36" style="width:68px;height:68px;transform:rotate(-90deg);">
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="rgba(255,255,255,0.1)" stroke-width="3"></circle>
            <circle id="drom-energy-ring-progress" cx="18" cy="18" r="15.9" fill="none" stroke="${PANEL_COLORS.cyan}" stroke-width="3"
              stroke-dasharray="0 100" stroke-linecap="round"></circle>
          </svg>
          <div id="drom-energy-ring-score" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:${PANEL_COLORS.text};">--</div>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:14px;font-weight:700;color:${PANEL_COLORS.text};">Énergie DROM / SEI</div>
          <div id="drom-energy-status-label" style="margin-top:2px;font-size:11px;color:${PANEL_COLORS.cyan};">Réseaux insulaires</div>
          <div id="drom-energy-update-time" style="margin-top:5px;font-size:10px;color:${PANEL_COLORS.muted};"></div>
        </div>
      </div>
    `;

    this.contentEl = document.createElement('div');
    this.contentEl.className = 'drom-energy-panel-content';
    this.contentEl.style.cssText = `
      padding:12px;
      overflow-y:auto;
      flex:1;
      color:${PANEL_COLORS.text};
    `;
    this.modalEl.appendChild(this.contentEl);
    this.container.appendChild(this.modalEl);

    this.modalEl.querySelector('.drom-energy-panel-close')?.addEventListener('click', () => this.hide());
    this.render();
  }

  protected render(): void {}

  setOnClose(handler: () => void): void {
    this.onClose = handler;
  }

  setOnHoverAsset(handler: (asset: DromEnergyAsset | null) => void): void {
    this.onHoverAsset = handler;
  }

  show(dashboard: DromEnergyDashboard | null): void {
    this.modalEl.style.display = 'flex';
    if (dashboard) {
      this.dashboard = dashboard;
      this.errorMessage = null;
      this.loading = false;
    }
    this.renderState();
  }

  showLoadingState(): void {
    this.loading = true;
    this.errorMessage = null;
    this.modalEl.style.display = 'flex';
    this.renderState();
  }

  showErrorState(message: string): void {
    this.loading = false;
    this.errorMessage = message;
    this.modalEl.style.display = 'flex';
    this.renderState();
  }

  hide(): void {
    this.modalEl.style.display = 'none';
    this.onHoverAsset?.(null);
    this.onClose?.();
  }

  isVisible(): boolean {
    return this.modalEl?.style.display === 'flex';
  }

  private renderState(): void {
    if (!this.contentEl) return;

    if (this.loading) {
      this.updateHeader(0, 'Chargement...', '');
      this.contentEl.innerHTML = fmLoaderHTML({ text: 'Chargement de la couche DROM énergie…' });
      return;
    }

    if (this.errorMessage) {
      this.updateHeader(0, 'Erreur de chargement', '');
      this.contentEl.innerHTML = fmEmptyStateHTML({
        icon: 'triangle-alert',
        text: `Couche indisponible : ${this.errorMessage}`,
      });
      return;
    }

    const dashboard = this.dashboard;
    if (!dashboard) {
      this.updateHeader(0, 'Aucune donnée', '');
      this.contentEl.innerHTML = fmEmptyStateHTML({
        icon: 'inbox',
        text: 'Aucune donnée DROM énergie chargée.',
      });
      return;
    }

    const territoriesByCode = new Map(dashboard.territories.map((territory) => [territory.code, territory.name]));
    const datasetsById = new Map(dashboard.datasets.map((dataset) => [dataset.id, dataset.label]));
    const filteredAssets = this.getFilteredAssets(dashboard.assets);
    const filteredCommuneMetrics = this.getFilteredCommuneMetrics(dashboard.communeMetrics);
    const filteredLimitations = this.getFilteredLimitations(dashboard.productionLimitations);
    const territoryCodes = [...new Set([
      ...dashboard.assets.map((asset) => asset.territoryCode),
      ...dashboard.communeMetrics.map((metric) => metric.territoryCode),
      ...dashboard.productionLimitations.map((limitation) => limitation.territoryCode),
    ])];
    const assetTypes = [...new Set(dashboard.assets.map((asset) => asset.type))];
    const datasetIds = [...new Set([
      ...dashboard.assets.map((asset) => asset.sourceDatasetId),
      ...dashboard.communeMetrics.map((metric) => metric.sourceDatasetId),
      ...dashboard.productionLimitations.map((limitation) => limitation.sourceDatasetId),
    ])];

    this.updateHeader(
      Math.min(100, dashboard.assets.length * 10),
      `${dashboard.assets.length} actifs chargés`,
      dashboard.updatedAt,
    );

    const assetListHtml = filteredAssets.length > 0
      ? filteredAssets.map((asset) => this.renderAssetCard(asset, territoriesByCode, datasetsById)).join('')
      : `
          <div style="text-align:center;padding:20px 12px;border:1px solid rgba(255,255,255,0.06);border-radius:10px;background:rgba(15,23,42,0.55);font-size:11px;color:${PANEL_COLORS.muted};">
            Aucun actif ne correspond aux filtres.
          </div>
        `;
    const metricsListHtml = filteredCommuneMetrics.length > 0
      ? filteredCommuneMetrics.slice(0, 40).map((metric) => this.renderMetricCard(metric, territoriesByCode, datasetsById)).join('')
      : `
          <div style="text-align:center;padding:16px 12px;border:1px solid rgba(255,255,255,0.06);border-radius:10px;background:rgba(15,23,42,0.55);font-size:11px;color:${PANEL_COLORS.muted};">
            Aucune métrique tabulaire disponible avec les filtres.
          </div>
        `;
    const limitationsListHtml = filteredLimitations.length > 0
      ? filteredLimitations.slice(0, 40).map((limitation) => this.renderLimitationCard(limitation, territoriesByCode, datasetsById)).join('')
      : `
          <div style="text-align:center;padding:16px 12px;border:1px solid rgba(255,255,255,0.06);border-radius:10px;background:rgba(15,23,42,0.55);font-size:11px;color:${PANEL_COLORS.muted};">
            Aucune limitation disponible avec les filtres.
          </div>
        `;

    this.contentEl.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:12px;">
        ${metricCard('Assets', String(dashboard.assets.length), 'actifs', PANEL_COLORS.cyan, PANEL_COLORS.cyanSoft)}
        ${metricCard('Métriques', String(dashboard.communeMetrics.length), 'communes', PANEL_COLORS.amber, PANEL_COLORS.amberSoft)}
        ${metricCard('Limitations', String(dashboard.productionLimitations.length), 'lignes', PANEL_COLORS.text, PANEL_COLORS.slateSoft)}
        ${metricCard('Filtrés', String(filteredAssets.length), 'visibles', PANEL_COLORS.cyan, PANEL_COLORS.slateSoft)}
      </div>

      <div style="background:rgba(15,23,42,0.72);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:12px;margin-bottom:12px;">
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 12px;font-size:11px;color:${PANEL_COLORS.muted};">
          <div style="min-width:0;overflow-wrap:anywhere;"><span style="color:${PANEL_COLORS.text};font-weight:700;">Datasets présents</span><br>${escapeHtml(String(dashboard.datasets.length))}</div>
          <div style="min-width:0;overflow-wrap:anywhere;"><span style="color:${PANEL_COLORS.text};font-weight:700;">Datasets</span><br>${escapeHtml(dashboard.datasets.map((dataset) => dataset.label).join(' · ') || 'Aucun')}</div>
          <div style="min-width:0;overflow-wrap:anywhere;"><span style="color:${PANEL_COLORS.text};font-weight:700;">Territoires</span><br>${escapeHtml(territoryCodes.map((code) => territoriesByCode.get(code) ?? code).join(' · ') || 'Aucun')}</div>
          <div style="min-width:0;overflow-wrap:anywhere;"><span style="color:${PANEL_COLORS.text};font-weight:700;">Mise à jour</span><br>${escapeHtml(formatDate(dashboard.updatedAt))}</div>
        </div>
      </div>

      <div style="background:rgba(15,23,42,0.72);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:12px;margin-bottom:12px;">
        <div style="font-size:12px;font-weight:700;color:${PANEL_COLORS.text};margin-bottom:10px;">Filtres</div>
        <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;">
          ${this.renderFilterSelect('Territoire', 'territory', territoryCodes.map((code) => ({
            value: code,
            label: territoriesByCode.get(code) ?? code,
          })), this.filters.territory)}
          ${this.renderFilterSelect('Type', 'assetType', assetTypes.map((type) => ({
            value: type,
            label: type,
          })), this.filters.assetType)}
          ${this.renderFilterSelect('Dataset', 'dataset', datasetIds.map((datasetId) => ({
            value: datasetId,
            label: datasetsById.get(datasetId) ?? datasetId,
          })), this.filters.dataset)}
        </div>
      </div>

      ${renderAssetLegend()}

      <div style="margin-bottom:8px;font-size:12px;font-weight:700;color:${PANEL_COLORS.text};">Actifs</div>
      <div style="display:flex;flex-direction:column;gap:8px;">
        ${assetListHtml}
      </div>

      <div style="margin-top:12px;font-size:12px;font-weight:700;color:${PANEL_COLORS.text};">Métriques communales</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">
        ${metricsListHtml}
      </div>

      <div style="margin-top:12px;font-size:12px;font-weight:700;color:${PANEL_COLORS.text};">Limitations de production</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">
        ${limitationsListHtml}
      </div>
    `;

    this.attachFilterListeners();
    this.attachAssetHoverListeners(filteredAssets);
  }

  private updateHeader(score: number, subtitle: string, updatedAt: string): void {
    const ring = this.modalEl.querySelector('#drom-energy-ring-progress') as SVGCircleElement | null;
    const scoreEl = this.modalEl.querySelector('#drom-energy-ring-score') as HTMLElement | null;
    const statusEl = this.modalEl.querySelector('#drom-energy-status-label') as HTMLElement | null;
    const updateEl = this.modalEl.querySelector('#drom-energy-update-time') as HTMLElement | null;

    if (ring) ring.style.strokeDasharray = `${score} 100`;
    if (scoreEl) scoreEl.textContent = this.loading ? '…' : String(score);
    if (statusEl) statusEl.textContent = subtitle;
    if (updateEl) updateEl.textContent = updatedAt ? `Mise à jour: ${formatDate(updatedAt)}` : '';
  }

  private getFilteredAssets(assets: DromEnergyAsset[]): DromEnergyAsset[] {
    return assets.filter((asset) => {
      if (this.filters.territory !== 'all' && asset.territoryCode !== this.filters.territory) return false;
      if (this.filters.assetType !== 'all' && asset.type !== this.filters.assetType) return false;
      if (this.filters.dataset !== 'all' && asset.sourceDatasetId !== this.filters.dataset) return false;
      return true;
    });
  }

  private getFilteredCommuneMetrics(metrics: DromEnergyCommuneMetric[]): DromEnergyCommuneMetric[] {
    return metrics.filter((metric) => {
      if (this.filters.territory !== 'all' && metric.territoryCode !== this.filters.territory) return false;
      if (this.filters.dataset !== 'all' && metric.sourceDatasetId !== this.filters.dataset) return false;
      return true;
    });
  }

  private getFilteredLimitations(limitations: DromEnergyProductionLimitation[]): DromEnergyProductionLimitation[] {
    return limitations.filter((limitation) => {
      if (this.filters.territory !== 'all' && limitation.territoryCode !== this.filters.territory) return false;
      if (this.filters.dataset !== 'all' && limitation.sourceDatasetId !== this.filters.dataset) return false;
      return true;
    });
  }

  private renderFilterSelect(
    label: string,
    filterKey: keyof FilterState,
    options: Array<{ value: string; label: string }>,
    selected: string,
  ): string {
    return `
      <label style="display:flex;flex-direction:column;gap:6px;">
        <span style="font-size:10px;color:${PANEL_COLORS.muted};text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(label)}</span>
        <select data-filter="${escapeHtml(filterKey)}" style="
          background:rgba(255,255,255,0.06);
          color:${PANEL_COLORS.text};
          border:1px solid rgba(255,255,255,0.1);
          border-radius:8px;
          padding:7px 8px;
          font-size:11px;
        ">
          <option value="all"${selected === 'all' ? ' selected' : ''}>Tous</option>
          ${options.map((option) => `<option value="${escapeHtml(option.value)}"${selected === option.value ? ' selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}
        </select>
      </label>
    `;
  }

  private renderAssetCard(
    asset: DromEnergyAsset,
    territoriesByCode: Map<string, string>,
    datasetsById: Map<string, string>,
  ): string {
    const territory = territoriesByCode.get(asset.territoryCode) ?? asset.territoryCode;
    const dataset = datasetsById.get(asset.sourceDatasetId) ?? asset.sourceDatasetId;
    const coords = asset.coordinates ? `${asset.coordinates[1].toFixed(4)}, ${asset.coordinates[0].toFixed(4)}` : null;
    const assetTypeColor = getAssetTypeColor(asset.type);

    return `
      <div data-drom-energy-asset-id="${escapeHtml(asset.id)}" tabindex="0" style="background:rgba(15,23,42,0.72);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:12px;cursor:default;transition:border-color 0.16s ease, box-shadow 0.16s ease, background 0.16s ease;">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
          <div style="min-width:0;">
            <div style="font-size:13px;font-weight:700;color:${PANEL_COLORS.text};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(asset.name)}</div>
            <div style="margin-top:2px;font-size:11px;color:${assetTypeColor};">${escapeHtml(asset.type)}</div>
          </div>
          <div style="font-size:10px;color:${PANEL_COLORS.muted};white-space:nowrap;">${escapeHtml(asset.id)}</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr auto;gap:4px 10px;margin-top:10px;font-size:11px;">
          <span style="color:${PANEL_COLORS.muted};">Territoire</span><strong>${escapeHtml(territory)}</strong>
          <span style="color:${PANEL_COLORS.muted};">Dataset</span><strong>${escapeHtml(dataset)}</strong>
          ${asset.communeName ? `<span style="color:${PANEL_COLORS.muted};">Commune</span><strong>${escapeHtml(asset.communeName)}</strong>` : ''}
          ${asset.operator ? `<span style="color:${PANEL_COLORS.muted};">Opérateur</span><strong>${escapeHtml(asset.operator)}</strong>` : ''}
          ${asset.voltageKv != null ? `<span style="color:${PANEL_COLORS.muted};">Tension</span><strong>${escapeHtml(asset.voltageKv)} kV</strong>` : ''}
          ${coords ? `<span style="color:${PANEL_COLORS.muted};">Coordonnées</span><strong>${escapeHtml(coords)}</strong>` : ''}
        </div>
      </div>
    `;
  }

  private renderMetricCard(
    metric: DromEnergyCommuneMetric,
    territoriesByCode: Map<string, string>,
    datasetsById: Map<string, string>,
  ): string {
    const territory = territoriesByCode.get(metric.territoryCode) ?? metric.territoryCode;
    const dataset = datasetsById.get(metric.sourceDatasetId) ?? metric.sourceDatasetId;
    const isAssetMetric = metric.assetsCount != null || metric.substationsCount != null;
    const values = [
      metric.assetsCount != null ? `Assets: ${metric.assetsCount.toLocaleString('fr-FR')}` : null,
      metric.substationsCount != null ? `Postes sources: ${metric.substationsCount.toLocaleString('fr-FR')}` : null,
      metric.consumptionMwh != null ? `Conso: ${metric.consumptionMwh.toLocaleString('fr-FR')} MWh` : null,
      metric.co2Tons != null ? `CO2: ${metric.co2Tons.toLocaleString('fr-FR')} t` : null,
      metric.efficiencyActionsCount != null ? `Actions: ${metric.efficiencyActionsCount.toLocaleString('fr-FR')}` : null,
    ].filter(Boolean).join(' · ');

    return `
      <div style="background:rgba(15,23,42,0.72);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:10px;">
        <div style="font-size:12px;font-weight:700;color:${PANEL_COLORS.text};">${escapeHtml(metric.communeName)}${metric.communeCode ? ` (${escapeHtml(metric.communeCode)})` : ''}</div>
        <div style="margin-top:4px;font-size:11px;color:${PANEL_COLORS.cyan};">${escapeHtml([territory, metric.year].filter(Boolean).join(' · '))}</div>
        ${isAssetMetric ? `
          <div style="display:grid;grid-template-columns:1fr auto auto;gap:6px 10px;align-items:center;margin-top:8px;font-size:11px;color:${PANEL_COLORS.text};">
            <span style="color:${PANEL_COLORS.muted};">Commune</span>
            <span style="color:${PANEL_COLORS.muted};text-align:right;">Assets énergie DROM</span>
            <span style="color:${PANEL_COLORS.muted};text-align:right;">Postes sources</span>
            <strong style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(metric.communeName)}</strong>
            <strong style="text-align:right;">${escapeHtml((metric.assetsCount ?? 0).toLocaleString('fr-FR'))}</strong>
            <strong style="text-align:right;">${escapeHtml((metric.substationsCount ?? 0).toLocaleString('fr-FR'))}</strong>
          </div>
        ` : `<div style="margin-top:6px;font-size:11px;color:${PANEL_COLORS.text};">${escapeHtml(values || 'Valeurs non renseignées')}</div>`}
        <div style="margin-top:4px;font-size:10px;color:${PANEL_COLORS.muted};">${escapeHtml(dataset)}</div>
      </div>
    `;
  }

  private renderLimitationCard(
    limitation: DromEnergyProductionLimitation,
    territoriesByCode: Map<string, string>,
    datasetsById: Map<string, string>,
  ): string {
    const territory = territoriesByCode.get(limitation.territoryCode) ?? limitation.territoryCode;
    const dataset = datasetsById.get(limitation.sourceDatasetId) ?? limitation.sourceDatasetId;
    const period = [limitation.startDate, limitation.endDate].filter(Boolean).join(' → ');
    return `
      <div style="min-width:0;background:rgba(15,23,42,0.72);border:1px solid rgba(255,255,255,0.06);border-radius:10px;padding:10px;overflow:hidden;">
        <div style="display:flex;justify-content:space-between;gap:8px;min-width:0;">
          <div title="${escapeHtml(limitation.siteName ?? limitation.id)}" style="min-width:0;font-size:12px;font-weight:700;color:${PANEL_COLORS.text};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(limitation.siteName ?? limitation.id)}</div>
          <div style="font-size:10px;color:${PANEL_COLORS.muted};white-space:nowrap;flex-shrink:0;">${escapeHtml(territory)}</div>
        </div>
        <div style="margin-top:4px;font-size:11px;color:${PANEL_COLORS.cyan};overflow-wrap:anywhere;">${escapeHtml(limitation.productionType ?? 'Type non renseigné')}</div>
        ${limitation.limitedPowerMw != null ? `<div style="margin-top:4px;font-size:11px;color:${PANEL_COLORS.text};">Puissance limitée: ${escapeHtml(limitation.limitedPowerMw)} MW</div>` : ''}
        ${limitation.limitationReason ? `<div style="margin-top:4px;font-size:11px;color:${PANEL_COLORS.muted};overflow-wrap:anywhere;line-height:1.35;">${escapeHtml(limitation.limitationReason)}</div>` : ''}
        ${period ? `<div style="margin-top:4px;font-size:10px;color:${PANEL_COLORS.muted};overflow-wrap:anywhere;">${escapeHtml(period)}</div>` : ''}
        <div title="${escapeHtml(dataset)}" style="margin-top:4px;font-size:10px;color:${PANEL_COLORS.muted};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(dataset)}</div>
      </div>
    `;
  }

  private attachFilterListeners(): void {
    if (!this.contentEl) return;
    this.contentEl.querySelectorAll<HTMLSelectElement>('select[data-filter]').forEach((select) => {
      select.addEventListener('change', () => {
        const filterKey = select.dataset.filter as keyof FilterState | undefined;
        if (!filterKey) return;
        this.onHoverAsset?.(null);
        this.filters[filterKey] = select.value;
        this.renderState();
      });
    });
  }

  private attachAssetHoverListeners(assets: DromEnergyAsset[]): void {
    if (!this.contentEl) return;
    const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
    this.contentEl.querySelectorAll<HTMLElement>('[data-drom-energy-asset-id]').forEach((card) => {
      const assetId = card.dataset.dromEnergyAssetId;
      const asset = assetId ? assetsById.get(assetId) : null;
      if (!asset) return;

      const activate = (): void => {
        card.style.borderColor = 'rgba(56, 189, 248, 0.55)';
        card.style.boxShadow = '0 0 0 1px rgba(56, 189, 248, 0.18), 0 10px 24px rgba(56, 189, 248, 0.12)';
        card.style.background = 'rgba(14, 39, 63, 0.88)';
        this.onHoverAsset?.(asset);
      };
      const deactivate = (): void => {
        card.style.borderColor = 'rgba(255,255,255,0.06)';
        card.style.boxShadow = '';
        card.style.background = 'rgba(15,23,42,0.72)';
        this.onHoverAsset?.(null);
      };

      card.addEventListener('mouseenter', activate);
      card.addEventListener('focus', activate);
      card.addEventListener('mouseleave', deactivate);
      card.addEventListener('blur', deactivate);
    });
  }
}
