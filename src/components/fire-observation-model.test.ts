import { describe, expect, it } from 'vitest';
import {
  buildFireObservationSources,
  FIRE_OBSERVATION_CNRS_URL,
  FIRE_OBSERVATION_LSA_SAF_URL,
} from './fire-observation-model.ts';

describe('buildFireObservationSources', () => {
  it('describes the four sources in operational reading order', () => {
    const sources = buildFireObservationSources({ multiSource: false });
    expect(sources.map(source => source.id)).toEqual(['firms', 'gibs', 'mtg-frp', 'radar']);
    expect(sources.map(source => source.status)).toEqual([
      'ACTIF',
      'À LA DEMANDE',
      'NON CONNECTÉ',
      'NON CONNECTÉ',
    ]);
    expect(sources[2].timing).toContain('10 min');
    expect(sources[2].timing).toContain('45 min');
    expect(sources[3].timing).toContain('5 min');
  });

  it('adapts FIRMS revisit copy to available satellites', () => {
    expect(buildFireObservationSources({ multiSource: false })[0].timing).toContain('~3 h');
    expect(buildFireObservationSources({ multiSource: true })[0].timing).toContain('~1 h');
  });

  it('uses direct institutional HTTPS documentation URLs', () => {
    expect(FIRE_OBSERVATION_CNRS_URL).toMatch(/^https:\/\/www\.cnrs\.fr\//);
    expect(FIRE_OBSERVATION_LSA_SAF_URL).toMatch(/^https:\/\/lsa-saf\.eumetsat\.int\//);
  });
});
