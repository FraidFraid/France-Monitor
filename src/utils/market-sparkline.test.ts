import { describe, it, expect } from 'vitest';
import { buildMarketSparkline } from './market-sparkline.ts';

describe('buildMarketSparkline (marchés neutres, spec §4.4)', () => {
  it('trace en gris par défaut, quel que soit le sens', () => {
    expect(buildMarketSparkline([1, 2, 3], 'neutral')).toContain('stroke="var(--text-muted)"');
  });

  it('trace en jaune un mouvement exceptionnel', () => {
    expect(buildMarketSparkline([3, 2, 1], 'alert')).toContain('stroke="var(--sev-yellow)"');
  });
});
