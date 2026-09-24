// Câblage de la disposition A1 (?ui=v2) dans App.ts (relecture finale I1, I5, m4). App.ts (carte,
// réseau, 7 900 lignes) ne s'instancie pas sous vitest : ces tests lisent sa source et vérifient que
// les décisions pures (services/ui-mode.ts, services/intel-last-visit.ts) sont branchées aux bons
// endroits. Le comportement lui-même est testé avec ces modules et contrôlé dans Chrome.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.ts', import.meta.url), 'utf8');

/** Corps d'une méthode de App (paramètres sans accolades), accolades équilibrées. */
function methodBody(name: string): string {
  const signature = new RegExp(`\\n  (?:private |public )?(?:async )?${name}\\([^{]*\\{`);
  const match = signature.exec(app);
  if (!match) throw new Error(`méthode ${name} introuvable dans App.ts`);
  const start = match.index + match[0].length - 1;
  let depth = 0;
  for (let i = start; i < app.length; i += 1) {
    if (app[i] === '{') depth += 1;
    else if (app[i] === '}') {
      depth -= 1;
      if (depth === 0) return app.slice(start, i + 1);
    }
  }
  throw new Error(`corps de ${name} non refermé`);
}

/** Texte entre deux repères (le premier après `from`). */
function between(from: string, to: string): string {
  const start = app.indexOf(from);
  if (start < 0) throw new Error(`repère introuvable : ${from}`);
  const end = app.indexOf(to, start + from.length);
  if (end < 0) throw new Error(`repère introuvable : ${to}`);
  return app.slice(start, end);
}

describe('I1 — en v2, aucun panneau flottant ne s’ouvre sur la colonne fiche', () => {
  it('« Voir sur la carte » d’une situation active ses couches avec les options de la v2', () => {
    expect(methodBody('activateLayersFromSituation')).toMatch(/this\.onLayerToggle\([^;]*, true, layerActivationOptions\(this\.uiV2\)\)/);
  });

  it('« Voir l’aéronef » active la couche militaire avec les options de la v2', () => {
    expect(methodBody('openAlertDossier')).toContain("this.onLayerToggle('military', true, layerActivationOptions(this.uiV2))");
  });

  it('les panneaux des couches persistées ne se rouvrent pas au chargement en v2', () => {
    expect(between('if (hasPersistedChildActive) {', '} else {'))
      .toContain('this.suppressFirstLoadPanelAutoOpen = !reopensLayerPanelsOnLoad(this.uiV2);');
  });
});

describe('I5 — ligne de base de visite enregistrée après les données secondaires et au départ', () => {
  it('startV2Intel fige la ligne de base et pose les écouteurs (startVisitBaseline) avant de marquer le démarrage', () => {
    const body = methodBody('startV2Intel');
    const start = body.indexOf('visit.startVisitBaseline(');
    expect(start).toBeGreaterThan(-1);
    expect(body).not.toContain('beginVisitBaseline');
    expect(start).toBeLessThan(body.indexOf('this.v2IntelStarted = true'));
  });

  it('un seul chemin d’enregistrement, seulement après startV2Intel (session de ligne de base)', () => {
    expect(methodBody('recordV2VisitBaseline')).toContain('this.v2BaselineSession?.record()');
    expect(methodBody('deliverV2Events')).toContain('this.recordV2VisitBaseline()');
    expect(app).not.toContain('visit.recordVisitBaseline(');
  });

  it('enregistre aussi une fois les couches secondaires chargées', () => {
    expect(between('this.loadSecondaryLayers()', '.catch(')).toContain('this.recordV2VisitBaseline()');
  });
});
