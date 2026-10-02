// Câblage des panneaux de couches du lot 2 dans App.ts (spec 2026-10-02 lot 2). App.ts ne s'instancie pas
// sous vitest : ces tests lisent sa source, comme tests/app-floating-switcher-wiring.test.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/styles/main.css', import.meta.url), 'utf8');

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
void css;
void methodBody;

describe('panneau Réseau gaz (spec lot 2 § 3.1)', () => {
  it('l’interrupteur pipeline, sans effet, n’est plus câblé', () => {
    expect(app).not.toContain('setPipelineCallback');
  });
});

describe('panneau Éolien (spec lot 2 § 3.4)', () => {
  it('reçoit la série éCO2mix à la création et à chaque rafraîchissement du réseau', () => {
    expect(methodBody('loadEcowatt')).toContain('this.eolienPanel?.setGrid(this.currentEcowattResponse.grid);');
    expect(methodBody('ensureEolienPanel')).toContain('panel.setGrid(this.currentEcowattResponse?.grid ?? null);');
  });
});
