import { describe, it, expect } from 'vitest';
// @ts-expect-error — module JS sans déclaration de types
import { decodeEntities, fingerprint, titleSimilarity, isUnrenderedTemplate, planEventAssignments, MATCH_THRESHOLD, AMBIGUOUS_THRESHOLD } from '../api/_lib/event-clustering.js';

const sim = (a: string, b: string): number => titleSimilarity(fingerprint(a), fingerprint(b));
const H = 60 * 60 * 1000;
const T0 = Date.parse('2026-09-23T06:00:00Z');

describe('normalisation des titres', () => {
  it('décode les entités décimales, hexadécimales et unifie les apostrophes', () => {
    expect(decodeEntities('Les d&#xE9;put&#xE9;s ont approuv&#xE9; la loi')).toBe('Les députés ont approuvé la loi');
    expect(decodeEntities('d&#039;une « intoxication »')).toBe("d'une « intoxication »");
    expect(decodeEntities('l’attentat')).toBe("l'attentat");
  });

  it('repère les gabarits non rendus des flux EBRA', () => {
    expect(isUnrenderedTemplate('Vidéo. $content.TitleNoTags')).toBe(true);
    expect(isUnrenderedTemplate('Vidéo. Le pont de Normandie fermé')).toBe(false);
  });
});

describe('titleSimilarity (calibrée sur des titres réels du 23/09/2026)', () => {
  it('reconnaît une dépêche reprise avec une ponctuation et une apostrophe différentes', () => {
    expect(sim(
      'Lyon. « On était choqué » : stupéfaction au lycée Colbert après le projet d’attentat avorté',
      'Lyon. « On était choqué » : stupéfaction au lycée Colbert, après le projet d&#039;attentat avorté',
    )).toBe(1);
  });

  it('rapproche deux formulations du même fait', () => {
    expect(sim('Gironde : le feu de Lacanau fixé après 300 hectares brûlés', 'Incendie à Lacanau : 300 hectares parcourus, le feu est fixé'))
      .toBeGreaterThanOrEqual(MATCH_THRESHOLD);
  });

  it('ne fusionne pas deux faits différents dans la même ville', () => {
    expect(sim('Lyon : un incendie ravage un entrepôt à Vénissieux', 'Lyon : manifestation contre la réforme des retraites ce samedi'))
      .toBeLessThan(AMBIGUOUS_THRESHOLD);
  });

  it('classe comme ambiguë une couverture très reformulée', () => {
    const score = sim(
      'Paris. « Aux oubliettes » : le projet de rénovation de la tour Montparnasse abandonné',
      'Tour Montparnasse : le projet de rénovation retoqué par une majorité de copropriétaires',
    );
    expect(score).toBeGreaterThanOrEqual(AMBIGUOUS_THRESHOLD);
    expect(score).toBeLessThan(MATCH_THRESHOLD);
  });
});

describe('planEventAssignments', () => {
  const article = (id: number, title: string, hours: number, lat: number | null = null, lon: number | null = null) =>
    ({ id, title, publishedAt: T0 + hours * H, lat, lon });

  it('regroupe les reprises d’un même lot autour de l’article le plus ancien', () => {
    const plan = planEventAssignments([
      article(3, 'Justice. Teddy Riner visé par des messages haineux : enquête pour injures racistes', 2),
      article(1, 'Paris. Teddy Riner visé par des messages haineux : une enquête ouverte pour injures racistes', 0),
      article(2, 'Paris. Teddy Riner visé par des messages haineux : une enquête ouverte pour injures racistes', 1),
    ], []);
    expect(plan.seeds).toEqual([1]);
    expect(plan.attaches.map((a: { articleId: number }) => a.articleId)).toEqual([2, 3]);
    expect(plan.attaches[0].target).toEqual({ seedArticleId: 1 });
  });

  it('rattache à un événement existant dans la fenêtre de 72 h, pas au-delà', () => {
    const members = [{ articleId: 10, eventId: 7, title: 'Guerre en Ukraine. Au moins sept morts dans des frappes russes sur des infrastructures de transport', publishedAt: T0, lat: null, lon: null }];
    const inside = planEventAssignments([article(11, 'Ukraine : sept morts dans des frappes russes, des infrastructures de transport visées', 5)], members);
    expect(inside.attaches).toEqual([{ articleId: 11, target: { eventId: 7 }, score: expect.any(Number) }]);
    const outside = planEventAssignments([article(12, 'Ukraine : sept morts dans des frappes russes, des infrastructures de transport visées', 80)], members);
    expect(outside.seeds).toEqual([12]);
  });

  it('pénalise deux articles proches lexicalement mais distants de plus de 200 km', () => {
    const plan = planEventAssignments([
      article(1, 'Incendie dans un entrepôt de pneus : 80 pompiers mobilisés', 0, 48.85, 2.35),
      article(2, 'Incendie dans un entrepôt de pneus : 80 pompiers mobilisés', 1, 43.3, 5.37),
    ], []);
    expect(plan.attaches).toHaveLength(1);
    expect(plan.attaches[0].score).toBeLessThan(1);
  });

  it('ignore les gabarits non rendus et les titres vides de sens', () => {
    const plan = planEventAssignments([article(1, 'Vidéo. $content.TitleNoTags', 0), article(2, 'Vidéo.', 0)], []);
    expect(plan.skipped).toEqual([1, 2]);
    expect(plan.seeds).toEqual([]);
  });

  it('signale les paires ambiguës sans les fusionner', () => {
    const plan = planEventAssignments([
      article(1, 'Paris. « Aux oubliettes » : le projet de rénovation de la tour Montparnasse abandonné', 0),
      article(2, 'Tour Montparnasse : le projet de rénovation retoqué par une majorité de copropriétaires', 1),
    ], []);
    expect(plan.seeds).toEqual([1, 2]);
    expect(plan.ambiguous).toEqual([{ articleId: 2, candidate: { seedArticleId: 1 }, score: expect.any(Number) }]);
  });
});

describe('titres hostiles (relecture finale #1)', () => {
  it('ne lève pas et ne produit ni NUL ni demi-substitut sur une entité hors plage', () => {
    expect(decodeEntities('a&#99999999;b')).toBe('a�b');
    expect(decodeEntities('a&#0;b')).toBe('a�b');
    expect(decodeEntities('a&#xD800;b')).toBe('a�b');
    expect(decodeEntities('a&#x110000;b')).toBe('a�b');
  });

  it('planifie un lot contenant une entité hors plage sans échouer', () => {
    const plan = planEventAssignments([{ id: 1, title: 'Incendie &#99999999; à Lyon : un entrepôt détruit', publishedAt: T0, lat: null, lon: null }], []);
    expect(plan.seeds).toEqual([1]);
  });
});
