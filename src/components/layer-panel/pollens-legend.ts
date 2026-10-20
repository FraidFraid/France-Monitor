// src/components/layer-panel/pollens-legend.ts : teintes et légende de la couche Pollens (Atmo France, 20/10/2026). Palette officielle
// Atmo des codes 1 à 6, la même que celle de l'indice ATMO. Donnée en retard (S2) : « (en retard) » et couleurs retirées de la carte.
import type { PollenResponse } from '../../types/index.ts';
import { isEnvironmentDataLate } from '../../services/environment-levels.ts';
import type { LegendCategory } from '../MapLegend.ts';
import { absoluteTime } from '../fiche/kit.ts';
import { NBSP } from './format.ts';

/** Palette officielle Atmo, du code 1 (très faible) au code 6 (extrêmement élevé) ; l'indice 0 est inutilisé. */
export const POLLEN_HEX: readonly string[] = ['#000000', '#50f0e6', '#50ccaa', '#f0e641', '#ff5050', '#960032', '#872181'];

/** Niveau en toutes lettres, masculin singulier (« niveau élevé »). */
export const POLLEN_WORD: Readonly<Record<number, string>> = {
  1: 'très faible', 2: 'faible', 3: 'modéré', 4: 'élevé', 5: 'très élevé', 6: 'extrêmement élevé',
};

const HEADER_HEX = '#9898a8';

export const POLLENS_LEGEND: LegendCategory = {
  id: 'pollens',
  title: 'Pollens',
  items: [
    { id: 'pollens-header', label: 'Niveau de pollens du jour, plus haut du département', color: HEADER_HEX, isHeader: true },
    ...[1, 2, 3, 4, 5, 6].map((code) => ({ id: `pollens-${code}`, label: `${POLLEN_WORD[code][0].toUpperCase()}${POLLEN_WORD[code].slice(1)} (${code})`, color: POLLEN_HEX[code], shape: 'square' as const })),
  ],
  source: { label: 'Atmo France et AASQA (Licence Ouverte)' },
  refresh: { label: `Relève toutes les 2${NBSP}h` },
  notes: [
    'Six taxons suivis : aulne, bouleau, olivier, graminées, armoise, ambroisie. Niveau du département : plus haut niveau de ses communes.',
    'Département non couvert par une AASQA ce jour : non rempli.',
  ],
};

function clockOf(iso: string | null, now: number): string {
  const ms = iso === null ? Number.NaN : Date.parse(iso);
  return Number.isFinite(ms) ? absoluteTime(ms, now, 'fr', { withDate: true }) : 'n.d.';
}

/** Légende datée (S1) : jour affiché et mise à jour de la source ; en retard, couleurs retirées. */
export function pollensLegend(p: PollenResponse | null, now: number): LegendCategory {
  const dated = (data: string, late: boolean): LegendCategory => ({
    ...POLLENS_LEGEND, items: POLLENS_LEGEND.items.map((i) => ({ ...i })),
    notes: [`Données : ${data}${late ? ' (en retard)' : ''}.`, ...(late ? ['En retard : couleurs de niveau retirées de la carte.'] : []), ...(POLLENS_LEGEND.notes ?? [])],
  });
  if (!p) return dated('Atmo France indisponible', false);
  const first = p.days[0];
  if (first === undefined) return dated('pollens non encore publiés', false);
  const day = `${first.slice(8, 10)}/${first.slice(5, 7)}`;
  return dated(`pollens du ${day}, mis à jour le ${clockOf(p.updatedAt, now)}`, isEnvironmentDataLate('pollen', p.updatedAt, now));
}
