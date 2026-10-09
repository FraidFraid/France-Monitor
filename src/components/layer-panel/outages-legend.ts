// src/components/layer-panel/outages-legend.ts : légendes et teintes de carte des couches Pannes réseau (spec 2026-10-08) : sources
// appelées réellement, jamais « temps réel ». Teintes recopiées des jetons de main.css pour MapLibre, qui ne lit pas les variables CSS
// (égalité vérifiée par test) ; les vues des panneaux, elles, passent par var(--cat-out-*) (outages-format.ts).
import type { LegendCategory, LegendItem } from '../MapLegend.ts';
import { levelHex } from '../../services/vigilance.ts';
import { NBSP } from './format.ts';

/** Panne imprévue de moins de 24 h, arrêt imprévu d'une unité de production (jeton --cat-out-recent). */
export const OUT_RECENT_HEX = '#ef4444';
/** Panne imprévue plus ancienne ou sans date (jeton --cat-out-long). */
export const OUT_LONG_HEX = '#f97316';
/** Maintenance, annoncée ou en cours (jeton --cat-out-maint). */
export const OUT_MAINT_HEX = '#a1a1aa';
/** Donnée en retard : plus aucune couleur de catégorie (jeton --sev-grey). */
export const OUT_LATE_HEX = '#6b7280';
/** Site du référentiel Cloud : un inventaire, jamais un état de service (jeton --cat-out-ref). */
export const OUT_REF_HEX = '#8b8f9a';

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

const INTERNET_ITEMS: readonly LegendItem[] = [
  { id: 'internet-ongoing', label: 'Département en anomalie en cours', color: levelHex('rouge'), shape: 'zone' },
  { id: 'internet-recent', label: `Anomalie terminée depuis moins de 7${NBSP}jours (contour)`, color: OUT_LONG_HEX, shape: 'zone' },
];
const CLOUD_ITEMS: readonly LegendItem[] = [
  { id: 'cloud-ok', label: 'Site dont le fournisseur publie un état opérationnel', color: levelHex('vert'), shape: 'circle' },
  { id: 'cloud-maint', label: 'Maintenance', color: OUT_MAINT_HEX, shape: 'circle' },
  { id: 'cloud-degraded', label: 'Performances dégradées', color: levelHex('jaune'), shape: 'circle' },
  { id: 'cloud-partial', label: 'Panne partielle', color: levelHex('orange'), shape: 'circle' },
  { id: 'cloud-major', label: 'Panne majeure', color: levelHex('rouge'), shape: 'circle' },
  { id: 'cloud-deduced', label: 'Région sans état publié (colorée seulement si un incident est publié)', color: OUT_REF_HEX, shape: 'circle' },
  { id: 'cloud-ref', label: 'Centre de données du référentiel (inventaire)', color: OUT_REF_HEX, shape: 'circle' },
];

export function internetLegend(): LegendCategory {
  return {
    id: 'outagesInternet',
    title: 'Internet',
    items: INTERNET_ITEMS.map((i) => ({ ...i })),
    refresh: { label: `IODA 10${NBSP}min · Cloudflare Radar 15${NBSP}min` },
    notes: ['Un opérateur n’a pas de lieu : il n’est pas dessiné.', 'Outre-mer : listé dans le panneau, non dessiné.', 'Donnée en retard : zones en gris.'],
  };
}

export function cloudLegend(): LegendCategory {
  return {
    id: 'outagesCloud',
    title: 'Cloud et hébergement',
    items: CLOUD_ITEMS.map((i) => ({ ...i })),
    refresh: { label: `Pages d’état 30${NBSP}min` },
    notes: ['Un site n’est coloré que si son fournisseur publie un état.', LATE_NOTE],
  };
}
