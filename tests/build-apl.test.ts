import { describe, expect, it } from 'vitest';
import { aggregate, buildAplDataset, departmentOf, parseAplSheet } from '../scripts/build-apl.mjs';

// Feuilles miniatures fidèles aux classeurs DREES 2022-2024 : 8 lignes de titre et de notes, en-tête en ligne 9,
// ligne d'unités, puis une ligne par commune (code INSEE en texte, arrondissements de Paris, Corse, DROM).
const MG_HEADER = ['Code commune INSEE', 'Commune', 'APL aux médecins généralistes', 'APL aux médecins généralistes de 65 ans ou moins',
  'APL aux médecins généralistes de 62 ans ou moins', 'APL aux médecins généralistes de 60 ans ou moins',
  'Population standardisée 2022 pour la médecine générale', 'Population totale 2022'];
const SF_HEADER = ['Code commune INSEE', 'Commune', 'APL aux sages-femmes', 'Population féminine standardisée 2022 pour les sages-femmes',
  'Population totale 2022', 'Population féminine 2022'];
const TITLE = [['Indicateur d\'accessibilité potentielle localisée (APL) 2024 aux médecins généralistes', null], [null], ['Millésime : 2024'],
  ['Sources : SNIIR-AM 2024'], ['Champ : France hors Mayotte.'], ['Lecture : …'], ['Note : pondérer par la population standardisée.'], [null]];
const sheet = (header: string[], rows: unknown[][]): unknown[][] =>
  [...TITLE, header, [null, null, 'En nombre de consultations/visites accessibles par habitant standardisé'], ...rows];
// APL, versions restreintes (ignorées), population standardisée, population totale (bruit flottant réel : 520.000000004).
const MG_2024 = sheet(MG_HEADER, [
  ['75101', 'Paris 1er Arrondissement', 6, 1, 1, 1, 1000, 900],
  ['75102', 'Paris 2e Arrondissement', 5, 1, 1, 1, 3000, 3100],
  ['2A004', 'Ajaccio', 2, 9, 9, 9, 500, 520.000000004],
  ['97101', 'Les Abymes', 3, 3, 3, 3, 800, 790],
  ['97411', 'Saint-Denis', 2.4, 2, 2, 2, 200, 210],
  ['01001', 'Commune sans valeur', null, null, null, null, 100, 100],
  ['Total', null, 4, 4, 4, 4, 1, 1],
]);
const MG_2023 = sheet(MG_HEADER, [['75101', 'Paris 1er Arrondissement', 4, 1, 1, 1, 1000, 1000], ['2A004', 'Ajaccio', 3, 1, 1, 1, 1000, 1000]]);
const MG_2022 = sheet(MG_HEADER, [['75101', 'Paris 1er Arrondissement', 2, 1, 1, 1, 1000, 1000], ['2A004', 'Ajaccio', 3, 1, 1, 1, 1000, 1000]]);
const SF_2024 = sheet(SF_HEADER, [['75101', 'Paris 1er Arrondissement', 20, 400, 900, 450], ['97101', 'Les Abymes', 40, 100, 790, 400]]);

describe('lecture d’une feuille APL', () => {
  it('en-tête en ligne 9, unités sautées, codes INSEE en texte, populations arrondies', () => {
    const communes = parseAplSheet(MG_2024);
    expect(communes.map((c: { code: string }) => c.code)).toEqual(['75101', '75102', '2A004', '97101', '97411']);
    expect(communes[2]).toEqual({ code: '2A004', dep: '2A', apl: 2, popStd: 500, popTotal: 520 });
  });
  it('sages-femmes : population féminine standardisée et population totale', () => {
    expect(parseAplSheet(SF_2024)[0]).toEqual({ code: '75101', dep: '75', apl: 20, popStd: 400, popTotal: 900 });
  });
  it('feuille sans en-tête reconnu : erreur explicite', () => {
    expect(() => parseAplSheet([['Autre chose']])).toThrow('Code commune INSEE');
    expect(() => parseAplSheet(sheet(['Code commune INSEE', 'Commune', 'Autre'], []))).toThrow('colonnes APL introuvables');
  });
  it('département : 97x outre-mer, deux caractères sinon (arrondissements, Corse)', () => {
    expect(['75101', '2A004', '2B033', '97101', '97411', '01001'].map(departmentOf)).toEqual(['75', '2A', '2B', '971', '974', '01']);
  });
});

describe('agrégation (règle DREES)', () => {
  it('moyenne pondérée par la population standardisée ; population sous le seuil en population totale', () => {
    const paris = parseAplSheet(MG_2024).filter((c: { dep: string }) => c.dep === '75');
    expect(aggregate(paris, 2.5)).toEqual({ apl: 5.25, pop: 4000, popUnder: 0 });
    expect(aggregate(parseAplSheet(MG_2024), 2.5)).toEqual({ apl: 24880 / 5500, pop: 5520, popUnder: 730 });
    expect(aggregate([], 2.5)).toEqual({ apl: null, pop: 0, popUnder: 0 });
  });
  it('jeu complet : France, évolution, départements, Mayotte listée comme absente', () => {
    const dataset = buildAplDataset({
      publishedAt: '2026-07-22',
      names: { '75': 'Paris', '2A': 'Corse-du-Sud', '971': 'Guadeloupe', '974': 'La Réunion', '976': 'Mayotte' },
      sheets: {
        mg: { 2022: parseAplSheet(MG_2022), 2023: parseAplSheet(MG_2023), 2024: parseAplSheet(MG_2024) },
        sf: { 2022: [], 2023: [], 2024: parseAplSheet(SF_2024) },
      },
    });
    expect(dataset.vintage).toBe(2024);
    expect(dataset.france.apl).toEqual({ mg: 4.52, inf: null, kine: null, sf: 24, dent: null });
    expect(dataset.france.byYear).toEqual([
      { year: 2022, aplMg: 2.5, shareUnder25: 50, popUnder25: 1000 },
      { year: 2023, aplMg: 3.5, shareUnder25: 0, popUnder25: 0 },
      { year: 2024, aplMg: 4.52, shareUnder25: 13.2, popUnder25: 730 },
    ]);
    expect(dataset.departments.map((d: { code: string }) => d.code)).toEqual(['2A', '75', '971', '974']);
    expect(dataset.departments[1]).toEqual({
      code: '75', name: 'Paris',
      apl: { mg: 5.25, inf: null, kine: null, sf: 20, dent: null },
      apl2023: { mg: 4, inf: null, kine: null, sf: null, dent: null },
      pop: 4000, popUnder25: 0, shareUnder25: 0,
    });
    expect(dataset.departments[3]).toMatchObject({ code: '974', pop: 210, popUnder25: 210, shareUnder25: 100 });
    expect(dataset.missing).toEqual(['976']);
  });
});
