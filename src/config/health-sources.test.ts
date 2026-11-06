// src/config/health-sources.test.ts
import { describe, expect, it } from 'vitest';
import type { DataSourceStatus } from '../types/index.ts';
import { HEALTH_NATIONAL_KEYS, HEALTH_SOURCE_NAMES, healthReportSources, healthSourceDetail } from './health-sources.ts';

const st = (name: string, period?: string): DataSourceStatus => ({ name, status: 'ok', lastUpdate: null, period });

describe('sources santé du panneau des sources (spec 2026-10-03 S1)', () => {
  it('neuf sources : veille sanitaire et offre de soins (DGS-Urgent retiré du compte le 03/11/2026, lien seulement)', () => {
    expect(HEALTH_SOURCE_NAMES).toEqual([
      'Santé publique France', 'Odissé alertes', 'Sentinelles', 'SUM’eau', 'OMS / ECDC', 'ANSM Médicaments', 'RappelConso',
      'DREES APL', 'DREES SAE / FINESS',
    ]);
  });
  it('sources des quatre entrées du niveau national (fiche thème Santé)', () => {
    expect(HEALTH_NATIONAL_KEYS).toEqual(['syndromic', 'alerts', 'sentinelles', 'wastewater']);
  });
  it('lignes de la note de situation : sources santé connues du panneau, identifiées, période gardée ; les autres ignorées', () => {
    const rows = healthReportSources([st('Vigicrues'), st('DREES APL', 'millésime 2024'), st('Santé publique France', 'S39 · publiée le 30/09')]);
    expect(rows).toEqual([
      { sourceId: 'health:syndromic', status: st('Santé publique France', 'S39 · publiée le 30/09') },
      { sourceId: 'health:apl', status: st('DREES APL', 'millésime 2024') },
    ]);
  });
});

describe('chaque source santé est citée avec un lien officiel (retour médecin 05/11/2026)', () => {
  it('les neuf lignes du panneau des sources ont une provenance et un lien https', () => {
    for (const name of HEALTH_SOURCE_NAMES) {
      const d = healthSourceDetail(name);
      expect(d, name).not.toBeNull();
      expect(d?.detail.length, name).toBeGreaterThan(0);
      expect(d?.link, name).toMatch(/^https:\/\//);
      expect(d?.detail, name).not.toMatch(/—/);
    }
    expect(healthSourceDetail('Vols militaires')).toBeNull();
  });
});
