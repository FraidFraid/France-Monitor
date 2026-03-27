/**
 * risk-flags.ts — Pavillons à risque selon Paris MOU (Port State Control)
 * Source : Paris MOU Annual Report 2024 — Black & Grey List
 * Clé = code pays ISO2 extrait du MMSI (via getMmsiCountry)
 */

// Black list Paris MOU 2024 — taux de rétention > 10%
export const BLACK_LIST_FLAGS = new Set([
  'TZ', // Tanzanie
  'KH', // Cambodge
  'GQ', // Guinée équatoriale
  'SL', // Sierra Leone
  'TG', // Togo
  'MG', // Madagascar
  'CF', // Centrafrique
  'CD', // Congo (RDC)
]);

// Grey list Paris MOU 2024 — taux de rétention 5-10%
export const GREY_LIST_FLAGS = new Set([
  'PA', // Panama (important — 1er registre mondial)
  'VU', // Vanuatu
  'PW', // Palau
  'KM', // Comores
  'BO', // Bolivie
  'MD', // Moldavie
  'SB', // Îles Salomon
  'GN', // Guinée
]);

// Registres OFAC sanctionnés (Iran, Russie, Corée du Nord, etc.)
export const SANCTIONED_FLAGS = new Set([
  'KP', // Corée du Nord
  'IR', // Iran
  'SY', // Syrie
  'CU', // Cuba
  'VE', // Venezuela (partiel)
]);

export type FlagRisk = 'blacklist' | 'greylist' | 'sanctioned' | 'none';

export function getFlagRisk(countryIso2: string | undefined): FlagRisk {
  if (!countryIso2) return 'none';
  if (SANCTIONED_FLAGS.has(countryIso2)) return 'sanctioned';
  if (BLACK_LIST_FLAGS.has(countryIso2)) return 'blacklist';
  if (GREY_LIST_FLAGS.has(countryIso2)) return 'greylist';
  return 'none';
}
