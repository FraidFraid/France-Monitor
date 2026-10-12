// tests/situation-history-icons.test.ts : chaque type de situation environnementale a son icône dans l'historique (mineur du 12/10).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('SituationHistoryPanel', () => {
  it('icône des activations Copernicus EMS (jamais le triangle par défaut)', () => {
    const src = readFileSync(new URL('../src/components/SituationHistoryPanel.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/EMS_ACTIVATION:\s+fmIcon\('globe'\)/);
  });
});
