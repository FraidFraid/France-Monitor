import type { DromTerritoryCode } from './types.ts';

const DROM_TERRITORY_LABELS: Record<DromTerritoryCode, string> = {
  GP: 'Guadeloupe',
  MQ: 'Martinique',
  GF: 'Guyane',
  RE: 'La Réunion',
  YT: 'Mayotte',
};

export function getDromTerritoryLabel(code: DromTerritoryCode | string): string {
  return DROM_TERRITORY_LABELS[code as DromTerritoryCode] ?? String(code || 'DROM');
}
