import { describe, it, expect } from 'vitest';
import { THEMES, categoryTheme, drivenByText, inTheme, situationTheme, themeLabel } from './themes.ts';
import { LAYER_PRESETS } from '../config/layer-presets.ts';
import { isUiV2 } from './ui-mode.ts';

describe('isUiV2', () => {
  it('active la nouvelle interface que sur ?ui=v2', () => {
    expect(isUiV2('?ui=v2')).toBe(true);
    expect(isUiV2('?view=app&ui=v2')).toBe(true);
    expect(isUiV2('')).toBe(false);
    expect(isUiV2('?ui=v1')).toBe(false);
    expect(isUiV2('?ui=V2')).toBe(false);
  });
});

describe('themes (spec 5.3, 7.3)', () => {
  it('reprennent les cinq vues de layer-presets, dans le meme ordre, avec les libelles de la spec', () => {
    expect(THEMES.map((th) => th.id)).toEqual(LAYER_PRESETS.map((p) => p.id));
    expect(themeLabel('security')).toBe('Sécurité et défense');
    expect(themeLabel('environment')).toBe('Environnement et transports');
    expect(themeLabel('general', 'en')).toBe('Overview');
  });

  it('rattachent les categories selon le tableau 7.3', () => {
    expect(categoryTheme('energy')).toBe('energy');
    for (const c of ['security', 'cyber', 'social']) expect(categoryTheme(c)).toBe('security');
    expect(categoryTheme('health')).toBe('health');
    for (const c of ['weather', 'floods', 'fires', 'transport', 'infrastructure']) expect(categoryTheme(c)).toBe('environment');
    for (const c of ['finance', 'general', 'inconnue']) expect(categoryTheme(c)).toBe('general');
  });

  it('rattachent situations et alertes ; une alerte presse suit la categorie de son article', () => {
    expect(situationTheme('FUEL_SUPPLY_RISK')).toBe('energy');
    expect(situationTheme('DEFENSE_ALERT')).toBe('security');
    expect(situationTheme('TELECOM_DISRUPTION')).toBe('environment');
    expect(situationTheme('NEWS_ALERT')).toBe('general');
    expect(situationTheme('NEWS_ALERT', 'cyber')).toBe('security');
  });

  it('Vue generale montre tout, un theme ne montre que les siens', () => {
    expect(inTheme('energy', 'general')).toBe(true);
    expect(inTheme('general', 'energy')).toBe(false);
    expect(inTheme('energy', 'energy')).toBe(true);
  });

  it('tiree par : deux themes au plus, sinon sans pression dominante', () => {
    expect(drivenByText(['energy'])).toBe("tirée par l'énergie");
    expect(drivenByText(['energy', 'health'])).toBe("tirée par l'énergie et la santé");
    expect(drivenByText([])).toBe('sans pression dominante');
    expect(drivenByText(['security'], 'en')).toBe('driven by security and defence');
  });
});
