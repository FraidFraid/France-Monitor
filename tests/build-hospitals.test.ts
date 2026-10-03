import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SAE_VINTAGE, buildHospitalsDataset, crsOf, decodeSaeCsv, departmentCode, fetchMetadata, hospitalCategory, latestFinessUrl, parseFiness,
  parseSemicolonCsv, readSaeTable, saeUrl, toWgs84,
} from '../scripts/build-hospitals.mjs';

afterEach(() => { vi.unstubAllGlobals(); });

// Extraits miniatures fidèles aux fichiers réels : SAE 2025 (CSV « ; », latin-1, table ID entre guillemets),
// FINESS géolocalisé (ligne de commentaire, section structureet puis section geolocalisation).
const ID = '"BOR";"AN";"FI";"RS";"FI_EJ";"CAT";"DEP";"NOMCOM"\r\n'
  + '"ID";"2025";"010000024";"CH DE FLEYRIAT";"010780054";"355";"01";"VIRIAT"\r\n'
  + '"ID";"2025";"970100012";"POLYCLINIQUE DE LA GUADELOUPE";"970100103";"365";"9A";"LES ABYMES"\r\n'
  + '"ID";"2025";"830200523";"POLYCLINIQUE MUTUALISTE MALARTIC";"830000000";"365";"83";"OLLIOULES"\r\n'
  + '"ID";"2025";"750100125";"GHU APHP SUN SITE PITIE SALPETRIERE";"750712184";"101";"75";"PARIS 13E ARRONDISSEMENT"\r\n';
const URGENCES = 'BOR;AN;FI;RS;FI_EJ;AUTSU;AUTGEN;AUTSAIS;AUTPED;AUTMEDURG\n'
  + 'URGENCES;2025;010000024;CH DE FLEYRIAT;010780054;1;1;0;0;0\n'
  + 'URGENCES;2025;970100012;POLYCLINIQUE DE LA GUADELOUPE;970100103;1;1;0;1;0\n'
  + 'URGENCES;2025;830200523;POLYCLINIQUE MUTUALISTE MALARTIC;830000000;1;1;0;0;0\n'
  + 'URGENCES;2025;750100125;GHU APHP SUN SITE PITIE SALPETRIERE;750712184;0;0;0;0;0\n';
const URGENCES2 = 'BOR;AN;FI;RS;FI_EJ;URG;PASSU;LIT_UHCD\n'
  + 'URGENCES2;2025;010000024;CH DE FLEYRIAT;010780054;GEN;45177;10\n'
  + 'URGENCES2;2025;970100012;POLYCLINIQUE DE LA GUADELOUPE;970100103;GEN;30000;4\n'
  + 'URGENCES2;2025;970100012;POLYCLINIQUE DE LA GUADELOUPE;970100103;PED;5000;\n'
  + 'URGENCES2;2025;830200523;POLYCLINIQUE MUTUALISTE MALARTIC;830000000;GEN;20000;2\n';
// SITOT est le total des soins intensifs (SIADU + SIPED) : jamais additionné une seconde fois.
const REA = 'BOR;AN;FI;RS;FI_EJ;UNI;LIT\n'
  + 'REA;2025;010000024;CH DE FLEYRIAT;010780054;REAADU;12\n'
  + 'REA;2025;010000024;CH DE FLEYRIAT;010780054;SIADU;13\n'
  + 'REA;2025;010000024;CH DE FLEYRIAT;010780054;SITOT;13\n'
  + 'REA;2025;750100125;GHU APHP SUN SITE PITIE SALPETRIERE;750712184;REAADU;110\n'
  + 'REA;2025;750100125;GHU APHP SUN SITE PITIE SALPETRIERE;750712184;REAENF;0\n';
const MCO = 'BOR;AN;FI;RS;FI_EJ;LIT_MCO\n'
  + 'MCO;2025;010000024;CH DE FLEYRIAT;010780054;344\n'
  + 'MCO;2025;750100125;GHU APHP SUN SITE PITIE SALPETRIERE;750712184;1275\n';
const FINESS = 'finess;etalab;98;2026-05-12\n'
  + 'structureet;010000024;010780054;CH DE FLEYRIAT;CENTRE HOSPITALIER DE BOURG-EN-BRESSE FLEYRIAT;;;900;RTE;DE PARIS;;;451;01;AIN;01440 VIRIAT;0474454647;0474454114;355;Centre Hospitalier (C.H.);1102;Centres Hospitaliers;26010004500012;8610Z;03;ARS;1;Etablissement public de santé;1979-02-13;1979-02-13;2020-02-04;\n'
  + 'structureet;970100012;970100103;POLYCLINIQUE DE LA GUADELOUPE;POLYCLINIQUE DE GUADELOUPE;;;;;MORNE JOLIVIERE;;;101;9A;GUADELOUPE;97139 LES ABYMES;0590821963;0590837034;365;Etablissement de Soins Pluridisciplinaire;1110;Etablissements de Soins de Courte Durée;31328539700011;8610Z;07;ARS;0;Non concerné;1969-03-01;1969-03-01;2010-08-25;\n'
  + 'structureet;010000099;010000098;EHPAD TEST;EHPAD TEST;;;;;;;;001;01;AIN;01000 BOURG;;;500;EHPAD;4401;Etablissements pour personnes âgées;;;;;;;;;;\n'
  + 'geolocalisation;010000024;870262.2;6571540.8;1,ATLASANTE,96,BAN,EPSG:2154 RGF93 / Lambert-93 (Métropole);2026-05-04\n'
  + 'geolocalisation;970100012;657242.9;1795384.4;2,ATLASANTE,96,BAN,EPSG:5490 RGAF09/UTM Zone 20N (Antilles);2026-05-04\n';

describe('lecture des fichiers', () => {
  it('CSV « ; » : guillemets, point-virgule et guillemet doublé dans un champ, CRLF, BOM', () => {
    expect(parseSemicolonCsv('\uFEFF"a";"b;c";"d ""e"""\r\n1;2;3\n')).toEqual([['a', 'b;c', 'd "e"'], ['1', '2', '3']]);
  });
  it('latin-1 : É, è, ô ; FI gardé en texte avec son zéro initial', () => {
    expect(decodeSaeCsv(Uint8Array.from([0x43, 0x48, 0x20, 0xc9, 0xe8, 0xf4]))).toBe('CH Éèô');
    expect(readSaeTable(ID)[0]).toMatchObject({ FI: '010000024', CAT: '355', DEP: '01' });
  });
  it('fichier mixte (table ID : valeurs UTF-8 dans un CSV latin-1) : chaque ligne décodée en UTF-8 d’abord, windows-1252 en repli', () => {
    const latin1 = Uint8Array.from([...Buffer.from('ID;2025;800000432;CH P', 'ascii'), 0xc9, ...Buffer.from('RONNE\r\n', 'ascii')]);
    const utf8 = Buffer.from('ID;2025;590796975;HÔPITAL SALENGRO CHU LILLE;COMPIÈGNE\r\n', 'utf8');
    const text = decodeSaeCsv(Buffer.concat([latin1, utf8, latin1]));
    expect(text).toBe('ID;2025;800000432;CH PÉRONNE\r\nID;2025;590796975;HÔPITAL SALENGRO CHU LILLE;COMPIÈGNE\r\nID;2025;800000432;CH PÉRONNE\r\n');
    expect(text).not.toMatch(/Ã/);
  });
  it('FINESS à deux sections : date, catégories, coordonnées et système de chaque établissement', () => {
    const f = parseFiness(FINESS);
    expect(f.date).toBe('2026-05-12');
    expect(f.establishments.get('970100012')).toEqual({ categetab: '365', categagretab: '1110', libcategagretab: 'Etablissements de Soins de Courte Durée' });
    expect(f.geo.get('010000024')).toEqual({ x: '870262.2', y: '6571540.8', crs: 'EPSG:2154' });
  });
  it('systèmes de coordonnées lus dans sourcecoordet', () => {
    expect(crsOf('2,ATLASANTE,100,BDADRESSE,EPSG:4471 RGM04/UTM zone 38S (Mayotte)')).toBe('EPSG:4471');
    expect(crsOf('2,ATLASANTE,90,BAN,WGS84/UTM zone 21N (St-Pierre-et-Miquelon)')).toBe('EPSG:32621');
    expect(crsOf('')).toBeNull();
  });
  it('reprojection WGS84 (valeurs de contrôle pyproj, 5 décimales)', () => {
    expect(toWgs84('870262.2', '6571540.8', 'EPSG:2154')).toEqual([5.20918, 46.22229]);
    expect(toWgs84('657242.9', '1795384.4', 'EPSG:5490')).toEqual([-61.52874, 16.234]);
    expect(toWgs84('353672.8', '544349.1', 'EPSG:2972')).toEqual([-52.31973, 4.92347]);
    expect(toWgs84('323086.6', '7679599.8', 'EPSG:2975')).toEqual([55.29821, -20.97571]);
    expect(toWgs84('524819.9', '8587194.7', 'EPSG:4471')).toEqual([45.22868, -12.77989]);
    expect(toWgs84('563213.8', '5180306.8', 'EPSG:32621')).toEqual([-56.17201, 46.77332]);
    expect(toWgs84('1', '2', 'EPSG:9999')).toBeNull();
  });
  it('catégories et départements', () => {
    expect(['101', '355', '365', '128', '697', '114', '131'].map(hospitalCategory)).toEqual(['chu', 'ch', 'private', 'private', 'gcs', 'army', 'other']);
    expect(['9A', '9B', '9C', '9D', '9F', '2A', '75'].map(departmentCode)).toEqual(['971', '972', '973', '974', '976', '2A', '75']);
  });
  it('URL de la base SAE construite sur le millésime', () => {
    expect(saeUrl(SAE_VINTAGE)).toBe('https://data.drees.solidarites-sante.gouv.fr/api/v2/catalog/datasets/707_bases-administratives-sae/attachments/sae_2025_base_administrative_formats_sas_csv_7z');
    expect(saeUrl(2026)).toContain('/attachments/sae_2026_base_administrative_formats_sas_csv_7z');
  });
  it('métadonnées data.gouv : statut HTTP contrôlé, délai borné', async () => {
    const inits: Array<RequestInit | undefined> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      inits.push(init);
      return { ok: false, status: 503, json: async () => ({}) };
    }));
    await expect(fetchMetadata('https://www.data.gouv.fr/api/1/datasets/x/')).rejects.toThrow('HTTP 503');
    expect(inits[0]?.signal).toBeInstanceOf(AbortSignal);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ resources: [] }) })));
    expect(await fetchMetadata('https://www.data.gouv.fr/api/1/datasets/x/')).toEqual({ resources: [] });
  });
  it('dernier FINESS géolocalisé parmi les ressources data.gouv', () => {
    expect(latestFinessUrl([
      { url: 'https://static.data.gouv.fr/x/20260108/etalab-stock-et-historique-2004-2025.zip' },
      { url: 'https://static.data.gouv.fr/x/20260312/etalab-cs1100507-stock-20260312-0339.csv' },
      { url: 'https://static.data.gouv.fr/x/20260512/etalab-cs1100507-stock-20260512-0339.csv' },
      { url: 'https://static.data.gouv.fr/x/20260512/etalab-cs1100502-stock-20260512-0339.csv' },
    ])).toBe('https://static.data.gouv.fr/x/20260512/etalab-cs1100507-stock-20260512-0339.csv');
  });
});

describe('jeu des sites d’urgences', () => {
  const dataset = buildHospitalsDataset({
    sae: { ID: readSaeTable(ID), URGENCES: readSaeTable(URGENCES), URGENCES2: readSaeTable(URGENCES2), REA: readSaeTable(REA), MCO: readSaeTable(MCO) },
    finess: parseFiness(FINESS),
  });
  it('sites autorisés (AUTSU = 1) joints au FINESS ; le site sans coordonnées est listé', () => {
    expect(dataset.sites.map((s: { finess: string }) => s.finess)).toEqual(['010000024', '970100012']);
    expect(dataset.unmatched).toEqual(['830200523']);
    expect(dataset.finessDate).toBe('2026-05-12');
  });
  it('fiche d’un site : catégorie, autorisations, passages, lits ; null si aucune unité déclarée', () => {
    expect(dataset.sites[0]).toEqual({
      finess: '010000024', name: 'CH DE FLEYRIAT', commune: 'VIRIAT', dept: '01', category: 'ch', lat: 46.22229, lon: 5.20918,
      general: true, pediatric: false, seasonal: false, antenna: false,
      passages: 45177, bedsMco: 344, bedsIcu: 12, bedsIntensive: 13, bedsUhcd: 10,
    });
    expect(dataset.sites[1]).toMatchObject({ dept: '971', category: 'private', pediatric: true, passages: 35000, bedsMco: null, bedsIcu: null, bedsIntensive: null, bedsUhcd: 4 });
  });
  it('totaux nationaux : tous les sites de la SAE pour les lits, SITOT non compté deux fois', () => {
    expect(dataset.totals).toEqual({ sites: 3, passages: 100177, bedsMco: 1619, bedsIcu: 122, bedsIntensive: 13, icuSites: 2 });
  });
  it('LIT_MCO vide : lits MCO null (non déclarés), jamais 0', () => {
    const d = buildHospitalsDataset({
      sae: { ID: readSaeTable(ID), URGENCES: readSaeTable(URGENCES), URGENCES2: readSaeTable(URGENCES2), REA: readSaeTable(REA),
        MCO: readSaeTable(`${MCO}MCO;2025;970100012;POLYCLINIQUE DE LA GUADELOUPE;970100103;\n`) },
      finess: parseFiness(FINESS),
    });
    expect(d.sites.find((s: { finess: string }) => s.finess === '970100012')?.bedsMco).toBeNull();
  });
  it('FINESS sans date d’extraction : échec (S1), jamais un fichier sans date', () => {
    const sae = { ID: readSaeTable(ID), URGENCES: readSaeTable(URGENCES), URGENCES2: readSaeTable(URGENCES2), REA: readSaeTable(REA), MCO: readSaeTable(MCO) };
    expect(() => buildHospitalsDataset({ sae, finess: parseFiness(FINESS.replace('finess;etalab;98;2026-05-12', 'finess;etalab;98;')) }))
      .toThrow('date d’extraction FINESS');
  });
  it('établissements de santé FINESS par catégorie agrégée (11xx seulement)', () => {
    expect(dataset.establishments).toEqual([
      { aggregate: '1102', label: 'Centres Hospitaliers', count: 1 },
      { aggregate: '1110', label: 'Etablissements de Soins de Courte Durée', count: 1 },
    ]);
  });
});

describe('fichier publié public/data/hospitals-urgences.json (SAE 2025, FINESS du 12/05/2026)', () => {
  const published = JSON.parse(readFileSync(new URL('../public/data/hospitals-urgences.json', import.meta.url), 'utf8')) as {
    sites: Array<{ name: string; commune: string }>; unmatched: string[];
    totals: { sites: number; bedsMco: number; bedsIcu: number; bedsIntensive: number; icuSites: number };
  };
  it('aucun nom mal décodé (UTF-8 lu comme latin-1 : « HÃ”PITAL »)', () => {
    const garbled = published.sites.filter((s) => /Ã[\u0080-¿‘-›]/.test(`${s.name} ${s.commune}`));
    expect(garbled.map((s) => s.name)).toEqual([]);
    expect(published.sites.map((s) => s.name)).toContain('HÔPITAL SALENGRO CHU LILLE');
  });
  it('totaux de contrôle de la spec', () => {
    expect(published.totals).toMatchObject({ sites: 617, bedsMco: 184_933, bedsIcu: 5_755, bedsIntensive: 9_867, icuSites: 327 });
    expect([published.sites.length, published.unmatched]).toEqual([616, ['830200523']]);
  });
});
