// tests/vigicrues-forecasts.test.ts : prévisions de hauteur Vigicrues (lot 3 de l'onglet Environnement, 20/10/2026), sur des
// réponses réelles du 20/10/2026 (Quissac sur le Vidourle en vigilance orange ; Tarascon sans prévision).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FORECAST_MAX_AGE_MS, forecastUrl, parseForecast } from '../api/_lib/vigicrues-forecasts.js';

const fx = (name: string): unknown => JSON.parse(readFileSync(new URL(`./fixtures/environment/${name}`, import.meta.url), 'utf8'));
const quissac = fx('vigicrues-previsions-quissac.json') as { Simul: { DtProdSimul: number; Prevs: Array<{ DtPrev: number }> } };
const produced = quissac.Simul.DtProdSimul;

describe('prévisions Vigicrues', () => {
  it('fourchette heure par heure, datée de sa production', () => {
    const f = parseForecast(quissac, produced + 60_000);
    expect(f?.producedAt).toBe(new Date(produced).toISOString());
    expect(f?.points).toHaveLength(4);
    expect(f?.points[0]).toEqual({ at: new Date(quissac.Simul.Prevs[0].DtPrev).toISOString(), min: 1.42, mean: 1.72, max: 2.02 });
  });
  it('aucune prévision publiée : null, jamais une valeur extrapolée', () => {
    expect(parseForecast(fx('vigicrues-previsions-vide.json'), produced)).toBeNull();
  });
  it('prévision de plus de 12 h : écartée', () => {
    expect(parseForecast(quissac, produced + FORECAST_MAX_AGE_MS + 1)).toBeNull();
  });
  it('forme inattendue : erreur ; code de station illisible : jamais dans une adresse', () => {
    expect(() => parseForecast({ foo: 1 }, produced)).toThrow();
    expect(() => forecastUrl('X&a=1')).toThrow();
    expect(forecastUrl('Y341400501')).toContain('CdStationHydro=Y341400501&GrdSerie=H');
  });
});
