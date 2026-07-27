import { describe, expect, it } from 'vitest';
import {
  mentionsFire, deriveReliability, deriveSourceLevel, extractImpactFacts,
} from '../api/_lib/impact-extractor.js';

const BASE = {
  sourceUrl: 'https://www.sudouest.fr/a/1',
  sourceName: 'Sud Ouest',
  tier: 3,
  observedAt: '2026-07-26T08:00:00Z',
};

describe('mentionsFire', () => {
  it('reconnaît le vocabulaire incendie et ignore le reste', () => {
    expect(mentionsFire('Un incendie ravage la forêt')).toBe(true);
    expect(mentionsFire('feu de forêt maîtrisé')).toBe(true);
    expect(mentionsFire('42 000 hectares brûlés')).toBe(true);
    expect(mentionsFire('Le conseil municipal a voté le budget')).toBe(false);
  });
});

describe('deriveSourceLevel / deriveReliability', () => {
  it('classe un domaine officiel en primaire noté A', () => {
    expect(deriveSourceLevel('https://www.gironde.gouv.fr/x')).toBe('primary');
    expect(deriveReliability('https://www.gironde.gouv.fr/x', null)).toBe('A');
  });

  it('classe la presse par tier, et une encyclopédie en tertiaire', () => {
    expect(deriveSourceLevel('https://www.sudouest.fr/a')).toBe('secondary');
    expect(deriveReliability('https://www.lemonde.fr/a', 1)).toBe('B');
    expect(deriveReliability('https://www.sudouest.fr/a', 3)).toBe('D');
    expect(deriveSourceLevel('https://fr.wikipedia.org/wiki/X')).toBe('tertiary');
  });
});

describe('extractImpactFacts — formulations réelles du cas Gironde', () => {
  it('extrait les hectares avec espace insécable, point et abréviation', () => {
    for (const text of ['42 000 hectares de forêt ont été détruits',
                        '42.000 hectares détruits',
                        'le feu a parcouru 42 000 ha']) {
      const facts = extractImpactFacts({ ...BASE, text });
      const area = facts.filter(f => f.kind === 'area_ha');
      expect(area).toHaveLength(1);
      expect(area[0].value).toBe(42000);
      expect(area[0].quote).toContain('42');
    }
  });

  it('marque hedged sur une formulation approximative', () => {
    const [fact] = extractImpactFacts({ ...BASE, text: 'près de 8 000 hectares brûlés' });
    expect(fact.value).toBe(8000);
    expect(fact.hedged).toBe(true);
  });

  it('extrait évacués, habitations et blessés', () => {
    const facts = extractImpactFacts({
      ...BASE,
      text: "L'incendie a contraint 220 000 personnes à évacuer. 175 maisons ont brûlé. 42 sapeurs-pompiers blessés.",
    });
    const byKind = Object.fromEntries(facts.map(f => [f.kind, f.value]));
    expect(byKind['evacuated']).toBe(220000);
    expect(byKind['dwellings_destroyed']).toBe(175);
    expect(byKind['injured']).toBe(42);
  });

  it("retient un ordre d'évacuation sans chiffre — la préfecture ne quantifie pas", () => {
    const facts = extractImpactFacts({
      ...BASE,
      sourceUrl: 'https://www.gironde.gouv.fr/c',
      sourceName: 'Préfecture de la Gironde',
      tier: null,
      text: "Le préfet a décidé de déclencher une alerte FR-Alert afin d'ordonner l'évacuation immédiate.",
    });
    const order = facts.find(f => f.kind === 'evacuation_order');
    expect(order).toBeDefined();
    expect(order?.value).toBeNull();
    expect(order?.reliability).toBe('A');
    expect(order?.sourceLevel).toBe('primary');
  });

  it('extrait une coupure routière avec son kilométrage', () => {
    const [fact] = extractImpactFacts({ ...BASE, text: "l'A63 est coupée sur 70 km" });
    expect(fact.kind).toBe('road_closed');
    expect(fact.value).toBe(70);
    expect(fact.unit).toBe('km');
  });

  it('ne produit RIEN sur un texte incendie sans fait chiffrable', () => {
    expect(extractImpactFacts({ ...BASE, text: "Les pompiers restent mobilisés sur l'incendie." }))
      .toEqual([]);
  });

  it('ne produit RIEN sur un texte hors sujet, même truffé de nombres', () => {
    expect(extractImpactFacts({ ...BASE, text: '42 000 spectateurs au stade, 175 buts marqués' }))
      .toEqual([]);
  });

  it('rejette un fait dont la provenance est incomplète', () => {
    expect(extractImpactFacts({ ...BASE, sourceUrl: '', text: '42 000 hectares détruits' }))
      .toEqual([]);
    expect(extractImpactFacts({ ...BASE, observedAt: '', text: '42 000 hectares détruits' }))
      .toEqual([]);
  });

  it('ignore un nombre aberrant (garde-fou anti-faux positif)', () => {
    expect(extractImpactFacts({ ...BASE, text: "l'incendie a détruit 99 000 000 hectares" }))
      .toEqual([]);
  });
});
