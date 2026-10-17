// tests/build-crime.test.ts
// scripts/build-crime.mjs (spec 2026-10-17 criminalité) : lecture des CSV SSMSI (BOM, guillemets, virgule décimale, NA), secret
// statistique (estimation lissée), base du taux (logements pour les cambriolages), seuil des villes, et jeu publié réel.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { buildDataset, num, readCommunes, readDepartments, splitLine } from '../scripts/build-crime.mjs';
import type { CrimeDataset } from '../src/types/index.ts';

const DEP_HEAD = '﻿"Code_departement";"Code_region";"annee";"indicateur";"unite_de_compte";"nombre";"taux_pour_mille";"insee_pop";"insee_pop_millesime";"insee_log";"insee_log_millesime"';
const dep = (code: string, year: number, ind: string, n: number, pop: number, log: number, rate = (n / pop) * 1000) =>
  `"${code}";"11";"${year}";"${ind}";"Victime";"${n}";"${String(rate.toFixed(7)).replace('.', ',')}";"${pop}";"2023";"${log}";"2022"`;
const COM_HEAD = '﻿"CODGEO_2026";"annee";"indicateur";"unite_de_compte";"nombre";"taux_pour_mille";"est_diffuse";"insee_pop";"insee_pop_millesime";"insee_log";"insee_log_millesime";"complement_info_nombre";"complement_info_taux"';

describe('lecture SSMSI', () => {
  it('guillemets retirés, NA nul, virgule décimale', () => {
    expect(splitLine('"01001";"2016";NA;"0,0078318"')).toEqual(['01001', '2016', null, '0,0078318']);
    expect(num('0,0078318')).toBeCloseTo(0.0078318);
    expect(num(null)).toBeNull();
  });

  it('jeu complet : France sommée, cambriolages aux logements, villes de 20 000 hab. et plus, estimation sous secret', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'crime-test-'));
    writeFileSync(join(dir, 'dep.csv'), [DEP_HEAD,
      dep('75', 2024, 'Homicides', 30, 2_100_000, 1_400_000), dep('75', 2025, 'Homicides', 35, 2_100_000, 1_400_000),
      dep('13', 2024, 'Homicides', 63, 2_000_000, 1_000_000), dep('13', 2025, 'Homicides', 56, 2_000_000, 1_000_000),
      dep('75', 2025, 'Cambriolages de logement', 7000, 2_100_000, 1_400_000, (7000 / 1_400_000) * 1000),
      dep('13', 2025, 'Cambriolages de logement', 4000, 2_000_000, 1_000_000, (4000 / 1_000_000) * 1000),
      dep('75', 2025, 'Usage de stupéfiants (AFD)', 9, 2_100_000, 1_400_000),
    ].join('\n'));
    writeFileSync(join(dir, 'com.csv.gz'), gzipSync([COM_HEAD,
      '"75056";"2025";"Violences sexuelles";"Victime";"6320";"3,0041193";"diff";"2103778";"2023";"1399122";"2022";NA;NA',
      '"75056";"2024";"Violences sexuelles";"Victime";"6000";"2,85";"diff";"2103778";"2023";"1399122";"2022";NA;NA',
      '"75056";"2025";"Vols avec armes";"Infraction";NA;NA;"ndiff";"2103778";"2023";"1399122";"2022";"3,5";"0,0017"',
      '"01001";"2025";"Violences sexuelles";"Victime";"1";"1,3";"diff";"767";"2016";"348";"2016";NA;NA',
      '"75056";"2019";"Violences sexuelles";"Victime";"4000";"1,9";"diff";"2103778";"2023";"1399122";"2022";NA;NA',
    ].join('\n')));
    const deps = await readDepartments(join(dir, 'dep.csv'));
    const communes = await readCommunes(join(dir, 'com.csv.gz'), [2024, 2025]);
    const places = new Map([['75056', { name: 'Paris', lat: 48.8566, lon: 2.3522 }], ['01001', { name: "L'Abergement-Clémenciat", lat: 46.15, lon: 4.92 }]]);
    const d = buildDataset({ deps, communes, places, publishedAt: '2026-07-09' }) as CrimeDataset;
    expect(d.year).toBe(2025);
    expect(d.previousYear).toBe(2024);
    expect(d.france.homicides?.at(-1)).toEqual({ year: 2025, count: 91, rate: 0.0222 });
    expect(d.indicators.find((i) => i.key === 'cambriolages')?.base).toBe('logements');
    expect(d.indicators.find((i) => i.key === 'homicides')?.base).toBe('habitants');
    expect(d.departments.find((x) => x.code === '13')?.values.homicides).toEqual([56, 0.028, 63]);
    expect(d.cities.map((c) => c.name)).toEqual(['Paris']);
    expect(d.cities[0].values.violencesSexuelles).toEqual([6320, 3.0041, 6000]);
    expect(d.cities[0].values.volsArmes).toEqual([null, 0.0017, null]);
    expect(d.cities[0].values).not.toHaveProperty('homicides');
  });
});

describe('jeu publié (public/data/crime.json)', () => {
  const d = JSON.parse(readFileSync(new URL('../public/data/crime.json', import.meta.url), 'utf8')) as CrimeDataset;
  it('2025, 101 départements, villes de 20 000 hab. et plus, valeurs vérifiées à la source', () => {
    expect(d.year).toBe(2025);
    expect(d.departments).toHaveLength(101);
    expect(d.cities.every((c) => c.population >= d.cityMinPopulation)).toBe(true);
    expect(d.cities.find((c) => c.code === '75056')?.values.violencesPhysiques?.[0]).toBe(11095);
    expect(d.departments.find((x) => x.code === '13')?.values.homicides?.[0]).toBe(56);
    expect(JSON.stringify(d)).not.toContain('—');
  });
});
