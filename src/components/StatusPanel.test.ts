// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { StatusPanel } from './StatusPanel.ts';

describe('StatusPanel.getSources (voyant de fraîcheur de la v2)', () => {
  it('expose les sources suivies dans leur état courant', () => {
    const panel = new StatusPanel(document.createElement('div'));
    panel.updateSource('Écowatt RTE', { status: 'ok', lastUpdate: new Date(0) });
    panel.updateSource('Vigicrues', { status: 'error' });
    panel.updateSource('Écowatt RTE', { status: 'stale' });
    expect(panel.getSources().map((s) => [s.name, s.status])).toEqual([['Écowatt RTE', 'stale'], ['Vigicrues', 'error']]);
  });
});
