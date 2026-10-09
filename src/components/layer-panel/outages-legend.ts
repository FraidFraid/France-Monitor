// src/components/layer-panel/outages-legend.ts : légendes et teintes de carte des couches Pannes réseau (spec 2026-10-08) : sources
// appelées réellement, jamais « temps réel ». Teintes recopiées des jetons de main.css pour MapLibre, qui ne lit pas les variables CSS
// (égalité vérifiée par test) ; les vues des panneaux, elles, passent par var(--cat-out-*) (outages-format.ts).
import type { LegendCategory, LegendItem } from '../MapLegend.ts';
import { NBSP } from './format.ts';

/** Panne imprévue de moins de 24 h, arrêt imprévu d'une unité de production (jeton --cat-out-recent). */
export const OUT_RECENT_HEX = '#ef4444';
/** Panne imprévue plus ancienne ou sans date (jeton --cat-out-long). */
export const OUT_LONG_HEX = '#f97316';
/** Maintenance, annoncée ou en cours (jeton --cat-out-maint). */
export const OUT_MAINT_HEX = '#a1a1aa';
/** Donnée en retard : plus aucune couleur de catégorie (jeton --sev-grey). */
export const OUT_LATE_HEX = '#6b7280';

const TELECOM_ITEMS: readonly LegendItem[] = [
  { id: 'telecom-recent', label: `Panne imprévue de moins de 24${NBSP}h`, color: OUT_RECENT_HEX, shape: 'circle' },
  { id: 'telecom-long', label: 'Panne imprévue plus ancienne ou sans date', color: OUT_LONG_HEX, shape: 'circle' },
  { id: 'telecom-maint', label: 'Maintenance (option du panneau)', color: OUT_MAINT_HEX, shape: 'circle' },
];
const POWER_ITEMS: readonly LegendItem[] = [
  { id: 'power-unplanned', label: 'Unité de production en arrêt imprévu', color: OUT_RECENT_HEX, shape: 'circle' },
  { id: 'power-planned', label: 'Unité en maintenance', color: OUT_MAINT_HEX, shape: 'circle' },
];
const LATE_NOTE = 'Donnée en retard : points en gris.';

export function telecomLegend(): LegendCategory {
  return {
    id: 'outagesTelecom',
    title: 'Télécoms mobiles',
    items: TELECOM_ITEMS.map((i) => ({ ...i })),
    refresh: { label: `Fichier ARCEP quotidien (vers 11${NBSP}h)` },
    notes: ['Un point par site et par opérateur.', LATE_NOTE],
  };
}

export function powerLegend(): LegendCategory {
  return {
    id: 'outagesElec',
    title: 'Électricité : production et transport',
    items: POWER_ITEMS.map((i) => ({ ...i })),
    refresh: { label: `EDF 15${NBSP}min · RTE IIP 10${NBSP}min` },
    notes: ['Une unité sans emplacement connu n’est pas dessinée.', LATE_NOTE],
  };
}
