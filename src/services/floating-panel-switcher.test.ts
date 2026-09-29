import { describe, expect, it } from 'vitest';
import { SWITCHER_TOP_PX, restorePanelPlan, showsSwitcher, switcherPanelOffsetPx, v2ColumnVars } from './floating-panel-switcher.ts';

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

describe('v2ColumnVars — un panneau de module prend la place exacte de la colonne État', () => {
  it('reprend le rectangle de la colonne, arrondi au pixel', () => {
    expect(v2ColumnVars({ top: 101.4, left: 1179.6, width: 420, height: 899.2 })).toEqual({
      '--v2-col-top': '101px', '--v2-col-left': '1180px', '--v2-col-width': '420px', '--v2-col-height': '899px',
    });
  });
});

describe('showsSwitcher — un panneau doit toujours pouvoir s’ouvrir', () => {
  it('v2 : la barre s’affiche dès un panneau disponible (cocher une couche n’ouvre plus son panneau)', () => {
    expect(showsSwitcher(true, 0)).toBe(false);
    expect(showsSwitcher(true, 1)).toBe(true);
    expect(showsSwitcher(true, 2)).toBe(true);
  });

  it('v1 : inchangé, la barre attend deux panneaux (le cochage ouvre déjà le premier)', () => {
    expect(showsSwitcher(false, 1)).toBe(false);
    expect(showsSwitcher(false, 2)).toBe(true);
  });
});
