// tests/app-anticipation-wiring.test.ts
// Câblage App.ts de l'onglet Anticipation (04/11/2026). App.ts ne s'instancie pas sous vitest : ces tests lisent sa source, comme
// tests/app-outages-wiring.test.ts ; le comportement (montage, relève de 60 s) est testé dans anticipation-controller.test.ts.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { LAYER_PRESETS, layersForPreset } from '../src/config/layer-presets.ts';
import { THEMES } from '../src/services/themes.ts';

const read = (path: string): string => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const app = read('src/App.ts');
const css = read('src/styles/main.css');

function methodBody(name: string): string {
  const signature = new RegExp(`\\n  (?:private |public )?(?:async )?${name}\\([^]*?\\{[ \\t]*\\n`);
  const match = signature.exec(app);
  if (!match) throw new Error(`méthode ${name} introuvable dans App.ts`);
  const start = match.index + match[0].length - 2;
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

describe('câblage App.ts de l\u2019onglet Anticipation', () => {
  it('vue « Anticipation » en dernier, sans couche ni événements ; onglet dans la barre des thèmes', () => {
    const last = LAYER_PRESETS.at(-1);
    expect(last).toEqual({
      id: 'anticipation', label: 'Anticipation', icon: 'target',
      description: 'Scénarios croisés entre domaines, à vérifier : agenda à 7 jours, preuves, inconnues, bascules.',
      layers: [], events: false,
    });
    expect(Object.values(layersForPreset('anticipation')).every((on) => on === false)).toBe(true);
    expect(THEMES.at(-1)?.id).toBe('anticipation');
  });

  it('anticipation tab mounts room and polls only when active', () => {
    // Pilote chargé à la demande (chunk App < 1 Mio), monté avec la carte, à côté de la salle des pannes.
    expect(app).toContain("import('./components/anticipation/anticipation-controller.ts')");
    expect(methodBody('syncAnticipationRoom')).toContain("this.uiV2 && this.v2Theme === 'anticipation'");
    expect(methodBody('syncAnticipationRoom')).toContain('setActive(');
    // Appelée partout où la salle des pannes est synchronisée.
    const outagesCalls = app.split('this.syncOutagesRoom();').length - 1;
    const anticipationCalls = app.split('this.syncAnticipationRoom();').length - 1;
    expect(outagesCalls).toBeGreaterThan(0);
    expect(anticipationCalls).toBeGreaterThanOrEqual(outagesCalls);
    for (const name of ['applyLayerPreset', 'mountOutagesNow']) {
      const body = methodBody(name);
      expect(body.includes('this.syncOutagesRoom();'), name).toBe(true);
      expect(body.includes('this.syncAnticipationRoom();'), name).toBe(true);
    }
    // Relève via les minuteurs suspendus quand l'onglet du navigateur est caché, retirée à la sortie (dans le pilote).
    expect(app).toContain('this.mountAnticipation(mapEl);');
    const mount = methodBody('syncAnticipationRoom');
    expect(mount).toContain('this.registerPausableInterval(fn, ms)');
    expect(mount).toContain('this.removePausableInterval(timer)');
    // Même calque des départements que la salle des pannes.
    expect(mount).toContain('setOutagesRoom: (state) => map?.setOutagesRoom(state)');
    expect(methodBody('destroy')).toContain('this.anticipation?.destroy();');
  });

  it('bloc CSS .anr- ; empilé sur mobile', () => {
    expect(css).toContain('.anr {');
    expect(css).toMatch(/@container \(max-width: 640px\) \{[^}]*\.anr-/);
  });
});
