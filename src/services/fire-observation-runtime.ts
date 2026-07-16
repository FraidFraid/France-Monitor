import type { FireObservationFeedState } from '../types/index.ts';

export type FireObservationUiStatus =
  | 'ACTIF'
  | 'CHARGEMENT'
  | 'CACHE · DÉGRADÉ'
  | 'CONFIGURATION REQUISE'
  | 'INDISPONIBLE';

export function deriveFireObservationStatus(
  feed: FireObservationFeedState,
  _now: number,
): FireObservationUiStatus {
  switch (feed.status) {
    case 'ok':
      return 'ACTIF';
    case 'loading':
      return 'CHARGEMENT';
    case 'stale':
      return 'CACHE · DÉGRADÉ';
    case 'not-configured':
      return 'CONFIGURATION REQUISE';
    case 'error':
      return 'INDISPONIBLE';
  }
}
