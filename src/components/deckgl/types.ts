// Extracted from DeckGLMap.ts — local types shared with deckgl modules.
import type { ThreatEvent } from '../../types/index.ts';

export type ThreatMapDatum =
  | {
      kind: 'cluster';
      id: number;
      coordinates: [number, number];
      count: number;
      severity: ThreatEvent['severity'];
      expansionZoom: number;
    }
  | {
      kind: 'event';
      event: ThreatEvent;
      coordinates: [number, number];
      severity: ThreatEvent['severity'];
    };
