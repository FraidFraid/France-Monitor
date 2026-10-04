// Extracted from DeckGLMap.ts — popup/tooltip HTML templates (pure data -> string).
import { buildDromEnergyTooltipContent } from '../../services/drom-energy/tooltip.ts';
import type { DromEnergyAsset, DromEnergyAssetType, DromTerritoryCode } from '../../services/drom-energy/index.ts';
import { escapeHtml } from './format-utils.ts';

export const DROM_ENERGY_ASSET_TYPES = new Set<DromEnergyAssetType>([
  'source_substation',
  'htb_pylon',
  'production_site',
  'storage_site',
  'hosting_capacity_point',
]);

export const DROM_TERRITORY_CODES = new Set<DromTerritoryCode>(['GP', 'MQ', 'GF', 'RE', 'YT']);

export function cleanTooltipString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function finiteTooltipNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(',', '.'));
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function toDromEnergyAssetType(value: unknown): DromEnergyAssetType {
  return typeof value === 'string' && DROM_ENERGY_ASSET_TYPES.has(value as DromEnergyAssetType)
    ? value as DromEnergyAssetType
    : 'source_substation';
}

export function toDromTerritoryCode(value: unknown): DromTerritoryCode {
  return typeof value === 'string' && DROM_TERRITORY_CODES.has(value as DromTerritoryCode)
    ? value as DromTerritoryCode
    : 'RE';
}

export function dromEnergyAssetFromProperties(properties: Record<string, unknown>): DromEnergyAsset {
  const id = cleanTooltipString(properties.id) ?? cleanTooltipString(properties.name) ?? 'drom-energy-asset';
  const name = cleanTooltipString(properties.name) ?? id;
  const asset: DromEnergyAsset = {
    id,
    territoryCode: toDromTerritoryCode(properties.territoryCode),
    type: toDromEnergyAssetType(properties.assetType ?? properties.type),
    name,
    sourceDatasetId: cleanTooltipString(properties.sourceDatasetId) ?? 'drom-energy',
  };

  const communeName = cleanTooltipString(properties.communeName);
  if (communeName) asset.communeName = communeName;
  const operator = cleanTooltipString(properties.operator);
  if (operator) asset.operator = operator;
  const productionType = cleanTooltipString(properties.productionType);
  if (productionType) asset.productionType = productionType;
  const voltageKv = finiteTooltipNumber(properties.voltageKv);
  if (voltageKv != null) asset.voltageKv = voltageKv;
  const capacityMw = finiteTooltipNumber(properties.capacityMw);
  if (capacityMw != null) asset.capacityMw = capacityMw;
  const availableCapacityMw = finiteTooltipNumber(properties.availableCapacityMw);
  if (availableCapacityMw != null) asset.availableCapacityMw = availableCapacityMw;

  return asset;
}

export function renderDromEnergyTooltipHtml(asset: DromEnergyAsset): string {
  const content = buildDromEnergyTooltipContent(asset);
  const rows = content.rows
    .map((item) => `
      <span style="color:#9898a8;">${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.value)}</strong>
    `)
    .join('');

  return `
    <div style="color:#e8e8ec; min-width:220px;">
      <div style="font-size:14px; font-weight:700; color:#fff;">${escapeHtml(content.title)}</div>
      <div style="margin-top:8px; display:grid; grid-template-columns: 1fr auto; gap:4px 10px; font-size:12px;">
        ${rows}
      </div>
    </div>
  `;
}
