// tests/app-score-sources-keeper.test.ts : gardien des 14 sources de l'indice (26/10/2026). La couverture des relevés de la VM variait
// de 11 à 14 sources selon l'ordre de chargement (pétrole et carburants lus au premier tour de leur relève seulement, lecture ratée
// au démarrage non retentée avant le relevé) ; une alerte n'est jamais émise sur un relevé incomplet.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const app = readFileSync(new URL('../src/App.ts', import.meta.url), 'utf8');
const body = (name: string): string => {
  const start = app.indexOf(`private ${name}(`);
  return start === -1 ? '' : app.slice(start, app.indexOf('\n  }\n', start));
};

describe('gardien des sources de l’indice', () => {
  const keeper = body('startScoreSourcesKeeper');
  it('lancé au démarrage, toutes les 30 s pendant 10 min puis toutes les 2 min, sur les sources manquantes de la couverture', () => {
    expect(app).toContain('this.startScoreSourcesKeeper();');
    expect(keeper).toContain('const { missing } = this.scoreCoverage(this.environmentInputs());');
    expect(keeper).toContain('}, 30_000);');
    expect(keeper).toContain('10 * 60_000');
    expect(keeper).toContain('this.registerPausableInterval(tick, 2 * 60_000);');
  });
  it('une relance pour chaque source lue par la page (la presse suit son propre pipeline)', () => {
    for (const key of ['isnr', 'ecowatt', 'vigilance', 'crues', 'feux', 'trains', 'routes', 'telecom', 'cyber', 'militaire', 'finance', 'carburants', 'petrole']) {
      expect(keeper).toMatch(new RegExp(`\\b${key}: \\(\\) => this\\.`));
    }
  });
  it('pétrole et carburants : une seule lecture à la fois, relève comprise', () => {
    expect(keeper).toContain('carburants: () => this.loadOilOnce(),');
    expect(app).toContain('this.oilLoading ??= this.loadOil().finally(() => { this.oilLoading = null; });');
    expect(app).toContain('void this.loadOilOnce();');
  });
});
