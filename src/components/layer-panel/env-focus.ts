// src/components/layer-panel/env-focus.ts : pastilles de l'onglet Environnement au modèle Énergie (20/10/2026). Pur, sans DOM.
// Pastilles cumulables (retenues par un clic, ou panneau ouvert), ligne d'état chiffrée de la mini-légende.
import type { MapLayers } from '../../types/index.ts';
import { levelLabel } from '../../services/vigilance.ts';
import { formatAge } from './environment-format.ts';
import type { WatchLevel } from './watch.ts';

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
): Array<keyof MapLayers> {
  return ids.filter((id): id is keyof MapLayers => isEnvFocusKey(id) && (selected.has(id) || panelOpen(id)));
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
