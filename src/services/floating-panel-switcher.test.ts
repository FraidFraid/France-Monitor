import { describe, expect, it } from 'vitest';
import { SWITCHER_TOP_PX, restorePanelPlan, switcherPanelOffsetPx } from './floating-panel-switcher.ts';

const PANEL: Record<string, string> = {
  environmental: 'environmental',
  fires: 'fires',
  health: 'health',
  healthOscour: 'health',
  trafficRail: 'trafficRail',
};
const panelOf = (key: string): string | null => PANEL[key] ?? null;

describe('restorePanelPlan — un seul panneau flottant rouvert au chargement (règle §5.3.3)', () => {
  it('rouvre le panneau de la première couche, les autres couches restent actives sans panneau', () => {
    expect(restorePanelPlan(['environmental', 'fires', 'trafficRail'], panelOf)).toEqual({
      open: ['environmental'],
      silent: ['fires', 'trafficRail'],
    });
  });

  it('les couches qui partagent le panneau rouvert le chargent aussi (santé + OSCOUR)', () => {
    expect(restorePanelPlan(['health', 'fires', 'healthOscour'], panelOf)).toEqual({
      open: ['health', 'healthOscour'],
      silent: ['fires'],
    });
  });

  it('une couche sans panneau ne consomme pas la place du panneau à rouvrir', () => {
    expect(restorePanelPlan(['radar', 'fires', 'trafficRail'], panelOf)).toEqual({
      open: ['radar', 'fires'],
      silent: ['trafficRail'],
    });
  });

  it('aucune couche : rien à faire', () => {
    expect(restorePanelPlan([], panelOf)).toEqual({ open: [], silent: [] });
  });
});

describe('switcherPanelOffsetPx — les panneaux commencent sous la barre de boutons', () => {
  it('v1 : décale les panneaux de droite juste sous la barre (une rangée de 28 px)', () => {
    // Barre à 56 px, haute de 28 px, 8 px d'écart → panneaux à 92 px au lieu de 68 px.
    expect(SWITCHER_TOP_PX).toBe(56);
    expect(switcherPanelOffsetPx(28, false)).toBe(24);
    expect(switcherPanelOffsetPx(62, false)).toBe(58);
  });

  it('barre masquée : aucun décalage', () => {
    expect(switcherPanelOffsetPx(0, false)).toBe(0);
  });

  it('v2 : les panneaux s’ouvrent sur la colonne fiche, pas sous la carte : aucun décalage', () => {
    expect(switcherPanelOffsetPx(28, true)).toBe(0);
  });
});
