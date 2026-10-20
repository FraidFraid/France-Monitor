// src/components/layer-panel/env-focus.test.ts : pastilles cumulables de l'onglet Environnement.
import { describe, expect, it } from 'vitest';
import { envChipsPressed, envFocusStatus, isEnvFocusKey, toggleEnvChip } from './env-focus.ts';

const NOW = Date.parse('2026-10-20T10:00:00Z');

describe('pastilles Environnement', () => {
  it('allumées = retenues par un clic ou panneau ouvert, dans l’ordre des pastilles ; hors Environnement ignorées', () => {
    const pressed = envChipsPressed(['powerGrid', 'floods', 'fires', 'environmental'], new Set(['fires']), (id) => id === 'environmental');
    expect(pressed).toEqual(['fires', 'environmental']);
  });
  it('clic : s’allume et ouvre, ou s’éteint et ferme ; cumul', () => {
    const on = toggleEnvChip(new Set(['floods']), 'fires', false);
    expect([...on.selected]).toEqual(['floods', 'fires']);
    expect(on.open).toBe(true);
    const off = toggleEnvChip(on.selected, 'floods', true);
    expect([...off.selected]).toEqual(['fires']);
    expect(off.open).toBe(false);
  });
  it('webcams et radar sont des pastilles de l’onglet ; Énergie non', () => {
    expect(isEnvFocusKey('webcams')).toBe(true);
    expect(isEnvFocusKey('weatherRadar')).toBe(true);
    expect(isEnvFocusKey('nuclearFleet')).toBe(false);
  });
});

describe('envFocusStatus', () => {
  it('niveau et âge de la lecture', () => {
    expect(envFocusStatus('orange', NOW - 6 * 60_000, NOW)).toBe('Orange · lu il y a 6\u00a0min');
  });
  it('source indisponible dite, jamais un vert supposé', () => {
    expect(envFocusStatus('nd', NOW - 3 * 60_000, NOW)).toBe('Source indisponible · lu il y a 3\u00a0min');
    expect(envFocusStatus('nd', null, NOW)).toBe('Source indisponible');
  });
  it('sans niveau (radar, webcams) : l’âge seul ; rien de connu : null', () => {
    expect(envFocusStatus(null, NOW - 60_000, NOW)).toBe('lu il y a 1\u00a0min');
    expect(envFocusStatus(null, null, NOW)).toBeNull();
    expect(envFocusStatus(null, NOW - 4 * 60_000, NOW, 'image')).toBe('image il y a 4\u00a0min');
  });
});
