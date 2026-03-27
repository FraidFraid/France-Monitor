/**
 * party-colors.ts — Mapping codes nuance RNE → couleur + label politique
 * Codes source : Ministère de l'Intérieur (nuances élections municipales 2020)
 */

export interface PartyColor {
  color: string;       // CSS hex
  label: string;       // Libellé complet
  shortLabel: string;  // Sigle court
  family: 'left' | 'center-left' | 'center' | 'center-right' | 'right' | 'far-right' | 'far-left' | 'other';
}

export const PARTY_COLORS: Record<string, PartyColor> = {
  // Gauche
  'LDVG':  { color: '#e05252', label: 'Divers gauche',              shortLabel: 'DVG',  family: 'left' },
  'LSOC':  { color: '#cf3245', label: 'Parti socialiste',           shortLabel: 'PS',   family: 'left' },
  'LVE':   { color: '#43a85a', label: 'Europe Écologie-Les Verts',  shortLabel: 'EELV', family: 'center-left' },
  'LFI':   { color: '#c0392b', label: 'La France Insoumise',        shortLabel: 'LFI',  family: 'far-left' },
  'LCOM':  { color: '#8b0000', label: 'Parti communiste',           shortLabel: 'PCF',  family: 'far-left' },
  'LBOC':  { color: '#c0392b', label: 'Bloc de gauche',             shortLabel: 'BG',   family: 'far-left' },
  'LECO':  { color: '#27ae60', label: 'Écologiste',                 shortLabel: 'ECO',  family: 'center-left' },
  // Centre
  'LREM':  { color: '#f0b800', label: 'La République En Marche',    shortLabel: 'RE',   family: 'center' },
  'LMDM':  { color: '#e8a020', label: 'MoDem',                      shortLabel: 'MoDem',family: 'center' },
  'LDVC':  { color: '#a0a040', label: 'Divers centre',              shortLabel: 'DVC',  family: 'center' },
  'LUDI':  { color: '#5b9bd5', label: 'Union des Démocrates et Indépendants', shortLabel: 'UDI', family: 'center-right' },
  // Droite
  'LLR':   { color: '#2980b9', label: 'Les Républicains',           shortLabel: 'LR',   family: 'center-right' },
  'LDVD':  { color: '#4a90d9', label: 'Divers droite',              shortLabel: 'DVD',  family: 'right' },
  'LDI':   { color: '#3a7abd', label: 'Divers',                     shortLabel: 'DI',   family: 'other' },
  // Extrême droite
  'LRN':   { color: '#1a1a6e', label: 'Rassemblement National',     shortLabel: 'RN',   family: 'far-right' },
  'LFN':   { color: '#0d0d55', label: 'Front National',             shortLabel: 'FN',   family: 'far-right' },
  // Régionalistes / divers
  'LREG':  { color: '#8e44ad', label: 'Régionaliste',               shortLabel: 'REG',  family: 'other' },
  'LDIV':  { color: '#7f8c8d', label: 'Divers',                     shortLabel: 'DIV',  family: 'other' },
};

export const DEFAULT_PARTY_COLOR = '#7f8c8d';

export function getPartyColor(nuance: string | undefined): string {
  if (!nuance) return DEFAULT_PARTY_COLOR;
  return PARTY_COLORS[nuance]?.color ?? DEFAULT_PARTY_COLOR;
}

export function getPartyLabel(nuance: string | undefined): string {
  if (!nuance) return 'Non renseigné';
  return PARTY_COLORS[nuance]?.label ?? nuance;
}
