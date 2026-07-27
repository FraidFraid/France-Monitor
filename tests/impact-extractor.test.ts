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
    // "hectares…détruits" a été retiré de FIRE_LEXICON (round 2, Finding 6) :
    // trop générique, il matchait aussi des hectares détruits par la grêle
    // ou une tempête. Ces fixtures portent donc un contexte incendie propre.
    const cases = [
      { text: "L'incendie a détruit 42 000 hectares de forêt.", quote: "L'incendie a détruit 42 000 hectares de forêt." },
      { text: 'Incendie en Gironde : 42.000 hectares brûlés.', quote: 'Incendie en Gironde : 42.000 hectares brûlés.' },
      { text: 'le feu a parcouru 42 000 ha', quote: 'le feu a parcouru 42 000 ha' },
    ];
    for (const { text, quote } of cases) {
      const facts = extractImpactFacts({ ...BASE, text });
      const area = facts.filter(f => f.kind === 'area_ha');
      expect(area).toHaveLength(1);
      expect(area[0].value).toBe(42000);
      // Citation exacte (pas un simple `.toContain('42')`, qui masquait une
      // citation amputée en plein milieu du nombre — Finding 7) : la
      // citation EST la preuve de provenance, elle ne doit jamais être
      // tronquée par un point qui est en réalité un séparateur de milliers.
      expect(area[0].quote).toBe(quote);
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
      text: "Face à la progression de l'incendie, le préfet a décidé de déclencher une alerte FR-Alert afin d'ordonner l'évacuation immédiate.",
    });
    const order = facts.find(f => f.kind === 'evacuation_order');
    expect(order).toBeDefined();
    expect(order?.value).toBeNull();
    expect(order?.reliability).toBe('A');
    expect(order?.sourceLevel).toBe('primary');
  });

  it('extrait une coupure routière avec son kilométrage', () => {
    const [fact] = extractImpactFacts({
      ...BASE,
      text: "L'incendie a contraint à fermer l'A63 : la voie est coupée sur 70 km.",
    });
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

  it('rejette une pseudo-décimale ambiguë avec un séparateur de milliers', () => {
    // "42.5" n'est ni "42.000" (groupe de 3) ni un entier propre : on refuse
    // plutôt que de lire 425 (§7 — un blanc honnête vaut mieux qu'un chiffre
    // plausible mais faux, potentiellement d'un facteur 10 sur une surface).
    expect(extractImpactFacts({ ...BASE, text: "L'incendie a détruit 42.5 hectares de forêt." }))
      .toEqual([]);
  });

  it('ne produit RIEN sur des textes hors sujet sans vocabulaire incendie, même truffés de motifs numériques piégeurs', () => {
    // Contre-exemples de non-régression (revue qualité) : chacun contient un
    // motif numérique qui matcherait un des kind ci-dessus si la garde
    // mentionsFire n'était pas appliquée en amont.
    const traps = [
      '42 personnes blessées dans un accident de la route à Bordeaux.',
      'Le programme immobilier comptera 175 maisons neuves à Bordeaux.',
      "220 000 personnes ont assisté au concert, mais aucune n'a dû évacuer les lieux en urgence.",
      "L'A63 est coupée sur 70 km pour travaux de reasphaltage.",
      'Le score final était 42. Hectares de forêt ravagés dans le Var.',
    ];
    for (const text of traps) {
      expect(extractImpactFacts({ ...BASE, text })).toEqual([]);
    }
  });

  it('ne produit RIEN sur des hectares détruits sans rapport avec un incendie (Finding 6)', () => {
    // "hectares…détruits" a été retiré de FIRE_LEXICON : structurellement
    // dangereux, il matchait mot pour mot ce que consomme le motif area_ha,
    // sans second signal distinguant « détruit par le feu » d'une autre
    // cause (grêle, inondation, tempête, gel).
    const traps = [
      '500 hectares de vignes ont été détruits par un orage de grêle.',
      '1200 hectares de terres agricoles ont été détruits par les inondations.',
      "300 hectares de forêt ont été détruits par la tempête Ciarán.",
      '800 hectares de vignes ont été détruits par le gel tardif.',
    ];
    for (const text of traps) {
      expect(extractImpactFacts({ ...BASE, text })).toEqual([]);
    }
  });

  it('capture un nombre continu sans séparateur en entier, jamais tronqué (Finding 5)', () => {
    // Bug introduit par le durcissement du round 1 : un groupement strict
    // par milliers laissait la porte ouverte à un match partiel sur un
    // nombre continu non séparé (ex. "1200" lu 200, "123456" lu 456) au
    // lieu de capturer le nombre entier ou de ne rien capturer du tout.
    expect(extractImpactFacts({ ...BASE, text: "L'incendie a détruit 1200 hectares de forêt." })[0].value)
      .toBe(1200);
    expect(extractImpactFacts({ ...BASE, text: "L'incendie a détruit 123456 hectares de forêt." })[0].value)
      .toBe(123456);
    expect(extractImpactFacts({ ...BASE, text: "L'incendie a détruit 1234 maisons dans le village." })[0].value)
      .toBe(1234);
    // Contrôle de non-régression : la forme groupée équivalente doit
    // toujours donner la même valeur combinée.
    expect(extractImpactFacts({ ...BASE, text: "L'incendie a détruit 123 456 hectares de forêt." })[0].value)
      .toBe(123456);
    // 1 234 567 dépasse le seuil de vraisemblance (1 000 000 ha) : doit être
    // rejeté sur sa valeur réelle, pas sur un suffixe tronqué qui, lui,
    // paraîtrait plausible et contournerait le garde-fou anti-faux positif.
    expect(extractImpactFacts({ ...BASE, text: "L'incendie a détruit 1234567 hectares de forêt." }))
      .toEqual([]);
  });
});
