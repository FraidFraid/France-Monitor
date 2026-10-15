import { describe, expect, it } from 'vitest';
import { ELECTRIC_FLOW_STYLE, GAS_FLOW_STYLE, OIL_FLOW_STYLE } from './flow-styles.ts';

describe('flux d’échange', () => {
  it('une seule couleur neutre, le sens est porté par les chevrons (le rouge et le vert sont réservés aux états)', () => {
    for (const s of [ELECTRIC_FLOW_STYLE, GAS_FLOW_STYLE, OIL_FLOW_STYLE]) {
      expect(s.importColor).toBe('#e5e5ea');
      expect(s.exportColor).toBe('#e5e5ea');
      expect(s.glowImportColor).toBe('#8e8e93');
      expect(s.glowExportColor).toBe('#8e8e93');
    }
  });
});
