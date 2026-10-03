// src/config/health-sources.test.ts
import { describe, expect, it } from 'vitest';
import type { DataSourceStatus } from '../types/index.ts';
import { HEALTH_SOURCE_NAMES, healthReportSources } from './health-sources.ts';

const st = (name: string, period?: string): DataSourceStatus => ({ name, status: 'ok', lastUpdate: null, period });

describe('sources santé du panneau des sources (spec 2026-10-03 S1)', () => {
  it('dix sources : veille sanitaire et offre de soins', () => {
    expect(HEALTH_SOURCE_NAMES).toEqual([
      'Santé publique France', 'Odissé alertes', 'Sentinelles', 'SUM’eau', 'OMS / ECDC', 'DGS-Urgent (PEPS)', 'ANSM Médicaments', 'RappelConso',
      'DREES APL', 'DREES SAE / FINESS',
    ]);
  });
  it('lignes de la note de situation : sources santé connues du panneau, identifiées, période gardée ; les autres ignorées', () => {
    const rows = healthReportSources([st('Vigicrues'), st('DREES APL', 'millésime 2024'), st('Santé publique France', 'S39 · publiée le 30/09')]);
    expect(rows).toEqual([
      { sourceId: 'health:syndromic', status: st('Santé publique France', 'S39 · publiée le 30/09') },
      { sourceId: 'health:apl', status: st('DREES APL', 'millésime 2024') },
    ]);
  });
});
