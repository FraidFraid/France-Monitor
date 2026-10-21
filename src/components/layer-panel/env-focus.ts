// src/components/layer-panel/env-focus.ts : pastilles de l'onglet Environnement au modèle Énergie (20/10/2026). Pur, sans DOM.
// Pastilles cumulables (retenues par un clic, ou panneau ouvert), ligne d'état chiffrée de la mini-légende.
import type { MapLayers } from '../../types/index.ts';
import { levelLabel } from '../../services/vigilance.ts';
import { formatAge } from './environment-format.ts';
import type { WatchLevel } from './watch.ts';
import { isEnergyLayerKey } from '../deckgl/energy-focus.ts';

/** Pastilles de l'onglet Environnement (ordre de FLOATING_PANEL_DEFS), webcams comprises. */
export const ENV_FOCUS_IDS: ReadonlyArray<keyof MapLayers> = [
  'envBrief', 'environmental', 'floods', 'weatherRadar', 'fires', 'drought', 'airQuality', 'pollens', 'earthquakes', 'disasters', 'seveso', 'webcams',
];

export function isEnvFocusKey(id: string): id is keyof MapLayers {
  return (ENV_FOCUS_IDS as readonly string[]).includes(id);
}

/** Pastilles allumées, dans l'ordre des pastilles : retenues par un clic, ou dont le panneau est ouvert. */
export function envChipsPressed(
  ids: readonly string[], selected: ReadonlySet<keyof MapLayers>, panelOpen: (id: keyof MapLayers) => boolean,
  isKey: (id: string) => id is keyof MapLayers = isEnvFocusKey,
): Array<keyof MapLayers> {
  return ids.filter((id): id is keyof MapLayers => isKey(id) && (selected.has(id) || panelOpen(id)));
}

/** Clic : pastille allumée → elle s'éteint (panneau fermé) ; sinon elle s'allume et son panneau s'ouvre. Cumulables. */
export function toggleEnvChip(
  selected: ReadonlySet<keyof MapLayers>, key: keyof MapLayers, pressed: boolean,
): { selected: Set<keyof MapLayers>; open: boolean } {
  const next = new Set(selected);
  if (pressed) next.delete(key);
  else next.add(key);
  return { selected: next, open: !pressed };
}

/**
 * Ligne d'état de la mini-légende : niveau de la pastille et âge de la dernière lecture (« Orange · lu il y a 6 min »).
 * Source indisponible : « Source indisponible » ; sans niveau (radar, webcams) : l'âge seul ; rien de connu : null. `verb` : « lu »
 * (heure de lecture), « image » pour le radar (heure d'observation).
 */
export function envFocusStatus(level: WatchLevel | null, at: number | null, now: number, verb = 'lu'): string | null {
  const age = at !== null ? `${verb} ${formatAge(at, now)}` : null;
  if (level === 'nd') return age ? `Source indisponible · ${age}` : 'Source indisponible';
  const word = level !== null ? levelLabel(level) : null;
  const parts = [word, age].filter((s): s is string => s !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Pastilles de l'onglet Pannes (21/10/2026) : mêmes règles qu'Environnement et Santé (cumulables, couche vive, mini-légende). */
const OUTAGES_FOCUS_IDS: readonly string[] = ['outagesTelecom', 'outagesInternet', 'outagesElec', 'outagesCloud'];

/** Pastille cumulable (clic qui la retient, mise en avant de sa couche) dans l'onglet affiché. */
export function cumulFocusKey(theme: string, id: string): id is keyof MapLayers {
  if (theme === 'environment') return isEnvFocusKey(id);
  return theme === 'outages' && OUTAGES_FOCUS_IDS.includes(id);
}

/** Pastille qui passe par le mécanisme Énergie (pastilles vertes) : une couche énergie, hors de l'onglet Pannes. */
export function usesEnergyFocus(theme: string, id: string): boolean {
  return theme !== 'outages' && isEnergyLayerKey(id);
}
