// tests/app-ems-wiring.test.ts
// Câblage Copernicus EMS dans App.ts (spec 2026-10-12) : relevé avec la couche Catastrophes, ligne du panneau des sources, zones sur la
// carte, moteur de situations ; tableau de qualité. App.ts ne s'instancie pas sous vitest : ces tests lisent sa source.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../src/App.ts');
const quality = read('../src/services/sources-quality-dashboard.ts');

describe('App.ts', () => {
  it('relève de la couche Catastrophes : source « Copernicus EMS », zones sur la carte', () => {
    expect(app).toContain("this.statusPanel?.updateSource('Copernicus EMS', emsStatus(this.currentDisasters, now));");
    expect(app).toContain('this.mapContainer?.updateEmsLayer(this.currentDisasters.ems.data, now);');
  });
  it('entrées du moteur : activations servies à jour seulement', () => {
    expect(app).toContain('emsActive: servedEms(this.currentDisasters?.ems.data ?? null, now),');
  });
  it('clic sur la source ouvre le panneau Catastrophes', () => {
    expect(app).toMatch(/name === 'GDACS' \|\| name === 'Copernicus EMS'/);
  });
});

describe('tableau de qualité', () => {
  it('Copernicus EMS, source officielle', () => {
    expect(quality).toMatch(/id: 'copernicus-ems',[^]*?sourceType: 'official',[^]*?watchdogNames: \['Copernicus EMS'\]/);
  });
});
