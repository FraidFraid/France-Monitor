import { describe, expect, it } from 'vitest';
import { SWITCHER_TOP_PX, restorePanelPlan, showsSwitcher, switcherPanelOffsetPx, v2ColumnVars, v2SwitcherLayout, v2TabletPanelOffsetPx } from './floating-panel-switcher.ts';

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

describe('v2SwitcherLayout : repli selon la place réelle, libellé gardé sinon', () => {
  const ROW = 500;

  it('ordinateur, tiroir fermé : libellés, sur la ligne de Carte | Satellite si la rangée y tient', () => {
    expect(v2SwitcherLayout(1280, 900, false, ROW)).toEqual({ iconOnly: false, belowControls: false });
  });

  it('ordinateur, tiroir ouvert : il retire sa largeur à la carte (il la recouvre)', () => {
    expect(v2SwitcherLayout(1440, 900, true, ROW).belowControls).toBe(true);
    expect(v2SwitcherLayout(1440, 440, true, ROW).iconOnly).toBe(true);
  });

  it('tablette : le tiroir est une colonne à part, la largeur de la carte l’exclut déjà (pas de repli en icônes)', () => {
    // 1100 px, tiroir ouvert : carte de 360 px ; sans soustraire encore 300 px, les libellés restent.
    expect(v2SwitcherLayout(1100, 360, true, ROW)).toEqual({ iconOnly: false, belowControls: true });
    expect(v2SwitcherLayout(900, 240, true, ROW).iconOnly).toBe(false);
    // 1024 px, tiroir fermé : carte large, une rangée à côté du sélecteur.
    expect(v2SwitcherLayout(1024, 784, false, ROW)).toEqual({ iconOnly: false, belowControls: false });
  });

  it('tablette : icône seule seulement si la carte est vraiment trop étroite', () => {
    expect(v2SwitcherLayout(800, 170, false, ROW).iconOnly).toBe(true);
  });

  it('mobile (≤ 768 px) : icône seule toujours, quelle que soit la largeur de la rangée ; jamais sous les contrôles', () => {
    expect(v2SwitcherLayout(390, 390, false, 300)).toEqual({ iconOnly: true, belowControls: false });
    expect(v2SwitcherLayout(390, 390, false, ROW)).toEqual({ iconOnly: true, belowControls: false });
    expect(v2SwitcherLayout(768, 500, true, 100)).toEqual({ iconOnly: true, belowControls: false });
  });
});

describe('v2TabletPanelOffsetPx : en tablette, le panneau flottant commence sous les puces', () => {
  it('décale le panneau sous le bas de la barre, avec un espace de 8 px', () => {
    expect(v2TabletPanelOffsetPx(241, 1100, false)).toBe(125);
    expect(v2TabletPanelOffsetPx(197, 900, false)).toBe(81);
  });

  it('aucun décalage hors tablette (colonne État sur ordinateur, panneau en feuille sur mobile) ou barre masquée', () => {
    expect(v2TabletPanelOffsetPx(241, 1101, false)).toBe(0);
    expect(v2TabletPanelOffsetPx(241, 768, false)).toBe(0);
    expect(v2TabletPanelOffsetPx(241, 1000, true)).toBe(0);
  });

  it('jamais négatif', () => {
    expect(v2TabletPanelOffsetPx(60, 1000, false)).toBe(0);
  });
});
