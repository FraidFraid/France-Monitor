import { getDromTerritoryLabel } from './labels.ts';
import type { DromEnergyAsset } from './types.ts';

export interface DromEnergyTooltipRow {
  label: string;
  value: string;
}

export interface DromEnergyTooltipContent {
  title: string;
  rows: DromEnergyTooltipRow[];
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function formatKv(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)} kV`
    : null;
}

function formatMw(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)} MW`
    : null;
}

function row(label: string, value: string | null): DromEnergyTooltipRow | null {
  return value ? { label, value } : null;
}

function compactRows(rows: Array<DromEnergyTooltipRow | null>): DromEnergyTooltipRow[] {
  return rows.filter((item): item is DromEnergyTooltipRow => item != null).slice(0, 3);
}

export function buildDromEnergyTooltipContent(asset: DromEnergyAsset): DromEnergyTooltipContent {
  let businessRows: DromEnergyTooltipRow[] = [];

  if (asset.type === 'source_substation') {
    businessRows = compactRows([
      row('Commune', cleanString(asset.communeName)),
      row('Tension', formatKv(asset.voltageKv)),
      row('Opérateur', cleanString(asset.operator)),
    ]);
  } else if (asset.type === 'htb_pylon') {
    businessRows = compactRows([
      row('Commune', cleanString(asset.communeName)),
      row('Tension', formatKv(asset.voltageKv)),
      row('Opérateur', cleanString(asset.operator)),
    ]);
  } else if (asset.type === 'production_site') {
    businessRows = compactRows([
      row('Commune', cleanString(asset.communeName)),
      row("Type d'énergie", cleanString(asset.productionType)),
      row('Puissance', formatMw(asset.capacityMw)),
    ]);
  }

  return {
    title: cleanString(asset.name) ?? asset.id,
    rows: [
      { label: 'Territoire', value: getDromTerritoryLabel(asset.territoryCode) },
      ...businessRows,
    ],
  };
}
