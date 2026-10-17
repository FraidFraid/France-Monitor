// src/components/layer-panel/manifestations-legend.ts : légende de la couche Manifestations (spec 2026-10-17 manifestations) : trois
// couleurs, datée du relevé du serveur. Les teintes viennent de la carte (deckgl/protests-map.ts), source unique.
import type { ProtestsResponse } from '../../types/index.ts';
import { isProtestsLate } from '../../services/protests.ts';
import type { LegendCategory } from '../MapLegend.ts';
import { absoluteTime } from '../fiche/kit.ts';
import { PROTEST_ANNOUNCED_HEX, PROTEST_CLASH_HEX, PROTEST_REPORTED_HEX } from '../deckgl/protests-map.ts';
import { NBSP } from './format.ts';

export const PROTESTS_LEGEND: LegendCategory = {
  id: 'protests',
  title: 'Manifestations',
  items: [
    { id: 'protest-clash', label: 'Heurts signalés (presse)', color: PROTEST_CLASH_HEX, shape: 'circle' },
    { id: 'protest-reported', label: 'Signalé par la presse', color: PROTEST_REPORTED_HEX, shape: 'circle' },
    { id: 'protest-announced', label: 'Annoncé (agenda militant)', color: PROTEST_ANNOUNCED_HEX, shape: 'circle' },
  ],
  source: { label: 'Démosphère (agenda militant) · presse française · GDELT (presse mondiale)' },
  refresh: { label: `Relève toutes les 10${NBSP}min` },
  notes: [
    'Un rendez-vous annoncé n’est pas une manifestation constatée. Presse : ville ou département nommé dans le titre ; GDELT : lieu souvent approximatif.',
    'Plusieurs éléments au même point : un seul rond, taille et nombre en étiquette.',
  ],
};

/** Légende datée : relevé du serveur, dit en retard au-delà de 30 min ; source muette : dite. */
export function protestsLegend(r: ProtestsResponse | null, now: number): LegendCategory {
  const ms = r?.readAt ? Date.parse(r.readAt) : Number.NaN;
  const data = !Number.isFinite(ms) ? 'sources indisponibles'
    : `relevé ${absoluteTime(ms, now, 'fr')}${isProtestsLate(r?.readAt ?? null, now) ? ' (en retard)' : ''}`;
  return { ...PROTESTS_LEGEND, items: PROTESTS_LEGEND.items.map((i) => ({ ...i })), notes: [`Données : ${data}.`, ...(PROTESTS_LEGEND.notes ?? [])] };
}
