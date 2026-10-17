// src/services/crime.test.ts : lecture client de la couche Criminalité, sur le vrai fichier public/data/crime.json.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrimeDataset } from '../types/index.ts';
import {
  CRIME_INDICATOR_KEYS, CRIME_URL, crimeBand, crimeValue, evolutionPct, fetchCrimeDataset, franceRate, isCrimeDataset, ratePer100k,
  ratioToFrance, rankCities, rankDepartments, resetCrimeCache,
} from './crime.ts';

const raw: unknown = JSON.parse(readFileSync(new URL('../../public/data/crime.json', import.meta.url), 'utf8'));
const real = (): CrimeDataset => {
  if (!isCrimeDataset(raw)) throw new Error('crime.json invalide');
  return raw;
};

describe('fichier réel', () => {
  it('passe la garde stricte : 2025, 2024, 16 indicateurs', () => {
    const ds = real();
    expect(ds.year).toBe(2025);
    expect(ds.previousYear).toBe(2024);
    expect(ds.indicators.map((i) => i.key)).toEqual(CRIME_INDICATOR_KEYS);
  });
  it('Paris (75056) : violences physiques 11 095 ; Bouches-du-Rhône (13) : 56 homicides', () => {
    const ds = real();
    expect(crimeValue(ds.cities.find((c) => c.code === '75056')?.values.violencesPhysiques).count).toBe(11095);
    expect(crimeValue(ds.departments.find((d) => d.code === '13')?.values.homicides).count).toBe(56);
  });
  it('homicides et tentatives : département seulement, aucune ville classée', () => {
    const ds = real();
    expect(rankCities(ds, 'homicides')).toEqual([]);
    expect(rankCities(ds, 'violencesPhysiques', 20)).toHaveLength(20);
    expect(rankDepartments(ds, 'homicides', 15)).toHaveLength(15);
  });
  it('classement décroissant par taux, rapport à la France calculé', () => {
    const ds = real();
    const top = rankDepartments(ds, 'cambriolages', 5);
    expect(top[0].reading.rate ?? 0).toBeGreaterThanOrEqual(top[4].reading.rate ?? 0);
    expect(top[0].ratio).toBeCloseTo((top[0].reading.rate ?? 0) / (franceRate(ds, 'cambriolages') ?? 1), 6);
  });
});

describe('lecture des valeurs', () => {
  it('nombre masqué et taux renseigné : estimé ; tout à null : n.d.', () => {
    expect(crimeValue([null, 0.5, null])).toEqual({ count: null, rate: 0.5, estimated: true, previous: null });
    expect(crimeValue([12, 0.5, 10]).estimated).toBe(false);
    expect(crimeValue([null, null, null])).toEqual({ count: null, rate: null, estimated: false, previous: null });
    expect(crimeValue(undefined).rate).toBeNull();
  });
  it('taux pour 100 000, évolution et rapport à la France', () => {
    expect(ratePer100k(0.0143)).toBeCloseTo(1.43, 6);
    expect(ratePer100k(null)).toBeNull();
    expect(evolutionPct(110, 100)).toBeCloseTo(10, 6);
    expect(evolutionPct(null, 100)).toBeNull();
    expect(evolutionPct(5, 0)).toBeNull();
    expect(ratioToFrance(3, 1.5)).toBe(2);
    expect(ratioToFrance(3, 0)).toBeNull();
    expect(ratioToFrance(null, 1)).toBeNull();
  });
  it('bandes de couleur : 0,8 · 1,25 · 1,6 · 2', () => {
    expect(crimeBand(0.79)).toBe('bas');
    expect(crimeBand(0.8)).toBe('moyen');
    expect(crimeBand(1.25)).toBe('jaune');
    expect(crimeBand(1.6)).toBe('orange');
    expect(crimeBand(2)).toBe('rouge');
    expect(crimeBand(null)).toBe('nd');
  });
});

describe('garde et lecture réseau', () => {
  beforeEach(() => resetCrimeCache());
  it('rejette un fichier tronqué ou mal typé', () => {
    expect(isCrimeDataset(null)).toBe(false);
    expect(isCrimeDataset({ ...real(), departments: [{ code: '01' }] })).toBe(false);
    expect(isCrimeDataset({ ...real(), year: '2025' })).toBe(false);
  });
  it('lit une fois puis sert la mémoire ; un échec n’est pas gardé', async () => {
    const ok = { ok: true, status: 200, json: () => Promise.resolve(raw) } as unknown as Response;
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce({ ok: false, status: 500 } as unknown as Response)
      .mockResolvedValue(ok);
    await expect(fetchCrimeDataset(fetchMock)).rejects.toThrow('HTTP 500');
    const a = await fetchCrimeDataset(fetchMock);
    const b = await fetchCrimeDataset(fetchMock);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(CRIME_URL);
  });
  it('un corps mal formé est refusé', async () => {
    const bad = { ok: true, status: 200, json: () => Promise.resolve({ year: 2025 }) } as unknown as Response;
    await expect(fetchCrimeDataset(vi.fn<typeof fetch>().mockResolvedValue(bad))).rejects.toThrow('mal formé');
  });
});
