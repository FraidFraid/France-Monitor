import { describe, expect, it } from 'vitest';
import type { DataSourceStatus } from '../types/index.ts';
import {
  ENVIRONMENT_ALWAYS_POLLED, ENVIRONMENT_LAYER_KEYS, ENVIRONMENT_LAYER_SOURCES, ENVIRONMENT_POLL_MS, ENVIRONMENT_SOURCE_NAMES,
  environmentReportSources, hasActiveEnvironment,
} from './environment-sources.ts';

describe('couches et sources Environnement (contrats § 3.6)', () => {
  it('sept couches dans l’ordre du tiroir ; le maître est actif dès qu’une couche l’est', () => {
    expect(ENVIRONMENT_LAYER_KEYS).toEqual(['environmental', 'floods', 'weatherRadar', 'fires', 'drought', 'airQuality', 'earthquakes']);
    expect(hasActiveEnvironment({})).toBe(false);
    expect(hasActiveEnvironment({ floods: true })).toBe(true);
    expect(hasActiveEnvironment({ environmental: false, weatherRadar: false, fires: false, floods: false })).toBe(false);
  });
  it('lignes du panneau des sources : noms gardés pour la continuité, chaque ligne rattachée à une couche', () => {
    expect(ENVIRONMENT_SOURCE_NAMES).toEqual([
      'Météo-France', 'Vigicrues', 'Radar Météo-France', 'NASA FIRMS', 'Météo des forêts', 'VigiEau', 'Atmo France', 'BCSF-RéNaSS', 'Marégraphes SHOM',
    ]);
    // Toute ligne rattachée à une couche est une ligne du panneau, et réciproquement, marégraphes exceptés (lus avec la vigilance).
    for (const name of Object.values(ENVIRONMENT_LAYER_SOURCES).flat()) expect(ENVIRONMENT_SOURCE_NAMES).toContain(name);
    expect(Object.values(ENVIRONMENT_LAYER_SOURCES).flat().sort()).toEqual(ENVIRONMENT_SOURCE_NAMES.filter((n) => n !== 'Marégraphes SHOM').sort());
  });
  it('relèves : vigilance 5 min, crues 10, radar 5, feux 15, sécheresse 60, air 30, séismes 10 ; radar et sécheresse seulement couche active ou panneau ouvert', () => {
    expect(Object.fromEntries(Object.entries(ENVIRONMENT_POLL_MS).map(([k, v]) => [k, v / 60_000]))).toEqual({ environmental: 5, floods: 10, weatherRadar: 5, fires: 15, drought: 60, airQuality: 30, earthquakes: 10 });
    expect([...ENVIRONMENT_ALWAYS_POLLED].sort()).toEqual(['airQuality', 'earthquakes', 'environmental', 'fires', 'floods']);
  });
  it('note de situation : statuts présents seulement, identifiés « environment:<clé> »', () => {
    const status: DataSourceStatus = { name: 'Vigicrues', lastUpdate: new Date('2026-10-04T08:05:00Z'), status: 'ok', period: '10:05' };
    expect(environmentReportSources([status])).toEqual([{ sourceId: 'environment:floods', status }]);
  });
});
