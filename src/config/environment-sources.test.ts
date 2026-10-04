import { describe, expect, it } from 'vitest';
import type { DataSourceStatus } from '../types/index.ts';
import {
  ENVIRONMENT_ALWAYS_POLLED, ENVIRONMENT_LAYER_KEYS, ENVIRONMENT_LAYER_SOURCES, ENVIRONMENT_POLL_MS, ENVIRONMENT_SOURCE_NAMES,
  environmentReportSources, hasActiveEnvironment,
} from './environment-sources.ts';

describe('couches et sources Environnement (contrats § 3.6)', () => {
  it('quatre couches dans l’ordre du tiroir ; le maître est actif dès qu’une couche l’est', () => {
    expect(ENVIRONMENT_LAYER_KEYS).toEqual(['environmental', 'floods', 'weatherRadar', 'fires']);
    expect(hasActiveEnvironment({})).toBe(false);
    expect(hasActiveEnvironment({ floods: true })).toBe(true);
    expect(hasActiveEnvironment({ environmental: false, weatherRadar: false, fires: false, floods: false })).toBe(false);
  });
  it('lignes du panneau des sources : noms gardés pour la continuité, chaque ligne rattachée à une couche', () => {
    expect(ENVIRONMENT_SOURCE_NAMES).toEqual([
      'Météo-France', 'Vigicrues', 'Radar Météo-France', 'NASA FIRMS', 'Météo des forêts', 'VigiEau', 'Atmo France', 'BCSF-RéNaSS', 'Marégraphes SHOM',
    ]);
    // Toute ligne rattachée à une couche est une ligne du panneau ; la réciproque revient à la tâche 31 (marégraphes exceptés).
    for (const name of Object.values(ENVIRONMENT_LAYER_SOURCES).flat()) expect(ENVIRONMENT_SOURCE_NAMES).toContain(name);
  });
  it('relèves : vigilance 5 min, crues 10, radar 5, feux 15 ; radar seulement couche active ou panneau ouvert', () => {
    expect(Object.fromEntries(Object.entries(ENVIRONMENT_POLL_MS).map(([k, v]) => [k, v / 60_000]))).toEqual({ environmental: 5, floods: 10, weatherRadar: 5, fires: 15 });
    expect([...ENVIRONMENT_ALWAYS_POLLED].sort()).toEqual(['environmental', 'fires', 'floods']);
  });
  it('note de situation : statuts présents seulement, identifiés « environment:<clé> »', () => {
    const status: DataSourceStatus = { name: 'Vigicrues', lastUpdate: new Date('2026-10-04T08:05:00Z'), status: 'ok', period: '10:05' };
    expect(environmentReportSources([status])).toEqual([{ sourceId: 'environment:floods', status }]);
  });
});
