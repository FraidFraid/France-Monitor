// Extracted from DeckGLMap.ts — popup/tooltip HTML templates (pure data -> string).
import { buildDromEnergyTooltipContent } from '../../services/drom-energy/tooltip.ts';
import type { DromEnergyAsset, DromEnergyAssetType, DromTerritoryCode } from '../../services/drom-energy/index.ts';
import { escapeHtml, normalizeLandingPoints, toNumber } from './format-utils.ts';

export type SubmarineCableProperties = {
  id?: string;
  name?: string;
  landing_points?: string[] | string;
  length_km?: number | string;
  rfs_year?: number | string;
  owner?: string;
  capacity_tbps?: number | string;
};

export function buildSubmarineLandingPoints(
  data: GeoJSON.FeatureCollection<GeoJSON.LineString>
): GeoJSON.FeatureCollection<GeoJSON.Point, Record<string, unknown>> {
  return {
    type: 'FeatureCollection',
    features: data.features.flatMap((feature) => {
      const coordinates = feature.geometry?.coordinates ?? [];
      if (coordinates.length < 2) return [];
      const props = (feature.properties ?? {}) as SubmarineCableProperties;
      const landingPoints = normalizeLandingPoints(props.landing_points);
      const cableName = props.name ?? 'Câble';
      const shared = {
        cableId: props.id ?? cableName,
        name: cableName,
        owner: props.owner ?? '',
        capacity_tbps: props.capacity_tbps ?? null,
        rfs_year: props.rfs_year ?? null,
        length_km: props.length_km ?? null,
      };

      return [
        {
          type: 'Feature' as const,
          id: `${shared.cableId}-landing-a`,
          geometry: { type: 'Point' as const, coordinates: coordinates[0] },
          properties: { ...shared, landingLabel: landingPoints[0] ?? 'Atterrage 1', landingSide: 'A' },
        },
        {
          type: 'Feature' as const,
          id: `${shared.cableId}-landing-b`,
          geometry: { type: 'Point' as const, coordinates: coordinates[coordinates.length - 1] },
          properties: { ...shared, landingLabel: landingPoints[landingPoints.length - 1] ?? 'Atterrage 2', landingSide: 'B' },
        },
      ];
    }),
  };
}

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

export function buildSubseaCableTooltip(properties: Record<string, unknown>): string {
  const p = properties as SubmarineCableProperties & { landingLabel?: string };
  const name = p.name ?? p.landingLabel ?? 'Liaison sous-marine';
  const landingPoints = normalizeLandingPoints(p.landing_points);
  const lengthKm = toNumber(p.length_km);
  const rfsYear = toNumber(p.rfs_year);
  const capacityTbps = toNumber(p.capacity_tbps);
  const owners = String(p.owner ?? '')
    .split(',')
    .map((owner) => owner.trim())
    .filter(Boolean);

  const meta: string[] = [];
  if (lengthKm != null) meta.push(`${new Intl.NumberFormat('fr-FR').format(lengthKm)} km`);
  if (capacityTbps != null) meta.push(`${capacityTbps} Tbps`);
  if (rfsYear != null) meta.push(`RFS ${rfsYear}`);

  const derived: string[] = [];
  if (landingPoints.length > 0) derived.push(`${landingPoints.length} point${landingPoints.length > 1 ? 's' : ''} d’atterrage`);
  if (owners.length > 0) derived.push(`${owners.length} opérateur${owners.length > 1 ? 's' : ''}`);
  if (rfsYear != null) {
    const age = new Date().getFullYear() - rfsYear;
    if (age >= 0) derived.push(age === 0 ? 'mise en service cette année' : `${age} an${age > 1 ? 's' : ''} d’ancienneté`);
  }

  return `
    <div style="display:flex; flex-direction:column; gap:6px;">
      <div>
        <strong style="color:#7dd3fc;">${escapeHtml(name)}</strong>
        ${landingPoints.length > 0 ? `<div style="color:#cbd5e1; font-size:11px; margin-top:2px;">${escapeHtml(landingPoints.join(' ↔ '))}</div>` : ''}
      </div>
      ${meta.length > 0 ? `<div style="color:#94a3b8; font-size:10px;">${escapeHtml(meta.join(' · '))}</div>` : ''}
      ${owners.length > 0 ? `<div style="color:#e2e8f0; font-size:10px;">Consortium: ${escapeHtml(owners.slice(0, 3).join(', '))}${owners.length > 3 ? ` +${owners.length - 3}` : ''}</div>` : ''}
      ${derived.length > 0 ? `<div style="color:#67e8f9; font-size:10px;">${escapeHtml(derived.join(' · '))}</div>` : ''}
    </div>
  `;
}
