// tests/app-asnr-wiring.test.ts
// Câblage ASNR dans App.ts (spec 2026-10-13) : lu au démarrage et au rythme du nucléaire, ligne « ASNR » du panneau des sources, anneaux,
// section du panneau, entrées du moteur de situations ; tableau de qualité. App.ts ne s'instancie pas sous vitest : ces tests lisent sa source.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../src/App.ts');
const quality = read('../src/services/sources-quality-dashboard.ts');

describe('App.ts', () => {
  it('relevé : source « ASNR », anneaux, panneau, situations rafraîchies', () => {
    expect(app).toContain("this.statusPanel?.updateSource('ASNR', asnrStatus(this.currentAsnr, now));");
    expect(app).toContain('this.mapContainer?.updateAsnrLayer(this.currentAsnr.data, now);');
    expect(app).toContain('this.nuclearPanel?.setAsnr(this.currentAsnr);');
  });
  it('lu au démarrage et relevé avec le parc nucléaire', () => {
    expect(app).toMatch(/name: 'asnr', task: this\.loadAsnr\(\)/);
    expect(app).toMatch(/void this\.loadNuclear\(\);\s*void this\.loadAsnr\(\);/);
  });
  it('entrées du moteur : journal servi', () => {
    expect(app).toContain('asnrEvents:           asnrEventsOf(this.currentAsnr?.data ?? null),');
  });
  it('panneau créé après le relevé : section remplie', () => {
    expect(app).toContain('panel.setAsnr(this.currentAsnr);');
  });
});

describe('tableau de qualité', () => {
  it('ASNR, source officielle', () => {
    expect(quality).toMatch(/id: 'asnr',[^]*?sourceType: 'official',[^]*?watchdogNames: \['ASNR'\]/);
  });
});
