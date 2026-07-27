import { describe, expect, it, vi } from 'vitest';
import type { FireIncident, ImpactFact, WildfireDossier } from '../types/index.ts';
import { buildDossier } from './wildfire-dossier.ts';
import { enrichWithLlm } from './wildfire-enrich.ts';

// NOTE défaut du brief : le snippet de la Task 9 utilise `fact`, `buildDossier`
// et `INCIDENT` sans jamais les importer ni les définir (ils vivent, non
// exportés, dans wildfire-dossier.test.ts). Reconstitués ici à l'identique.
function fact(over: Partial<ImpactFact> = {}): ImpactFact {
  return {
    id: 1, kind: 'area_ha', value: 42000, unit: 'ha',
    quote: '42 000 hectares de forêt ont été détruits',
    sourceUrl: 'https://www.sudouest.fr/a/1', sourceName: 'Sud Ouest',
    sourceLevel: 'secondary', reliability: 'D',
    hedged: false, provisional: true,
    observedAt: '2026-07-26T08:00:00Z', communes: [],
    ...over,
  };
}

const INCIDENT = {
  id: 'gironde', centroidLat: 44.78, centroidLon: -0.93,
  bboxMinLat: 44.37, bboxMaxLat: 44.97, bboxMinLon: -1.22, bboxMaxLon: -0.61,
  detectionsCount: 650, frpMean: 11, frpMax: 222, frpTotal: 7178,
  confidenceMax: 'high' as const,
  startDatetime: '2026-07-26T01:32:00Z', endDatetime: '2026-07-26T12:55:00Z',
  durationMinutes: 683, satellites: ['SNPP', 'NOAA-20'], hasNightDetection: true,
  nearUrban: true, clusterMethod: 'dbscan' as const, epsKm: 3, minPoints: 2,
  score: { severityScore: 90, impactScore: 80, labels: [] }, detectionIds: [],
} satisfies FireIncident;

const DOSSIER = {
  incident: { id: 'a', detectionsCount: 650, frpTotal: 7178 },
  severity: 'critical', deptCodes: ['33'], communes: [], facts: [],
  series: { area_ha: [], evacuated: [], dwellings_destroyed: [], injured: [],
            evacuation_order: [], road_closed: [], rail_disrupted: [] },
} as unknown as WildfireDossier;

describe('enrichWithLlm', () => {
  it('renvoie le dossier inchangé si Ollama est absent — sans lever', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await enrichWithLlm(DOSSIER, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual(DOSSIER);
  });

  it('n\'appelle QUE l\'endpoint local — jamais un LLM cloud (§7)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ response: '[]' }), { status: 200 }),
    );
    // DOSSIER n'a aucun fait — on force un fait minimal pour que l'appel ait lieu.
    const dossier = buildDossier(INCIDENT, [fact()], ['33']);
    await enrichWithLlm(dossier, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const url = String(fetchImpl.mock.calls[0]?.[0] ?? '');
    expect(url).toMatch(/^http:\/\/(localhost|127\.0\.0\.1):11434\//);
    expect(url).not.toMatch(/groq|openai|anthropic/i);
  });

  it('Finding 3 (round 1) — le prompt ne promet pas les genres qualitatifs', async () => {
    // evacuation_order et rail_disrupted n'ont jamais de valeur chiffrée
    // (§3.4) : isLlmCandidate exigeant `value: number`, un candidat de ce
    // genre serait de toute façon jeté. Les lister dans le prompt ferait
    // travailler le LLM pour rien.
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ response: '[]' }), { status: 200 }),
    );
    const dossier = buildDossier(INCIDENT, [fact()], ['33']);
    await enrichWithLlm(dossier, { fetchImpl: fetchImpl as unknown as typeof fetch });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as { prompt: string };
    expect(body.prompt).not.toMatch(/evacuation_order|rail_disrupted/);
    expect(body.prompt).toMatch(/area_ha/);
  });

  it('hérite la provenance de la citation relue et marque method: llm', async () => {
    // Le fait source : c'est SA citation que le LLM relit, et c'est SA
    // provenance que le fait produit hérite. Rien n'est fabriqué (§3.3).
    const source = fact({
      id: 1, kind: 'area_ha', value: 42000,
      quote: "L'incendie a détruit 42 000 hectares et contraint 220 000 personnes à évacuer.",
      sourceUrl: 'https://www.sudouest.fr/a/1', sourceName: 'Sud Ouest',
      sourceLevel: 'secondary', reliability: 'D', observedAt: '2026-07-26T08:00:00Z',
    });
    const payload = JSON.stringify({
      response: JSON.stringify([
        { kind: 'evacuated', value: 220000 },   // genre manqué par les patterns
        { kind: 'dwellings_destroyed', value: 175 }, // absent de la citation → à rejeter
      ]),
    });
    const fetchImpl = vi.fn().mockImplementation(
      () => Promise.resolve(new Response(payload, { status: 200 })),
    );
    const result = await enrichWithLlm(
      buildDossier(INCIDENT, [source], ['33']),
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    const llmFacts = result.facts.filter(f => f.method === 'llm');
    expect(llmFacts).toHaveLength(1);
    expect(llmFacts[0].kind).toBe('evacuated');
    expect(llmFacts[0].value).toBe(220000);
    // Provenance héritée à l'identique du fait source, jamais inventée.
    expect(llmFacts[0].sourceUrl).toBe(source.sourceUrl);
    expect(llmFacts[0].sourceName).toBe(source.sourceName);
    expect(llmFacts[0].observedAt).toBe(source.observedAt);
    expect(llmFacts[0].quote).toBe(source.quote);
  });

  it('ne relit rien et n\'appelle pas Ollama sur un dossier sans fait', async () => {
    const fetchImpl = vi.fn();
    const result = await enrichWithLlm(DOSSIER, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.facts).toEqual([]);
  });

  it('ignore une réponse LLM non parsable sans casser le dossier', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ response: 'je pense que...' }), { status: 200 }),
    );
    const result = await enrichWithLlm(DOSSIER, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.facts).toEqual([]);
  });

  // Les deux tests ci-dessus (Ollama absent / réponse non parsable) portent
  // sur DOSSIER, dont `facts` est vide — le court-circuit « rien à relire »
  // (test précédent) les rend inertes vis-à-vis de la gestion d'erreur
  // réseau/JSON proprement dite. Ajoutés pour couvrir réellement ces deux
  // chemins avec un dossier qui a effectivement quelque chose à relire.
  it('renvoie le dossier inchangé si Ollama est injoignable, même avec un fait à relire', async () => {
    const dossier = buildDossier(INCIDENT, [fact()], ['33']);
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await enrichWithLlm(dossier, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalled();
    expect(result).toEqual(dossier);
  });

  it('ignore une réponse LLM non parsable même avec un fait à relire', async () => {
    const dossier = buildDossier(INCIDENT, [fact()], ['33']);
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ response: 'je pense que...' }), { status: 200 }),
    );
    const result = await enrichWithLlm(dossier, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual(dossier);
  });

  it('rejette une réponse dont la valeur ne figure dans aucune citation relue', async () => {
    const source = fact({
      quote: "L'incendie a détruit 42 000 hectares.",
      sourceUrl: 'https://www.sudouest.fr/a/1', sourceName: 'Sud Ouest',
    });
    const payload = JSON.stringify({
      response: JSON.stringify([{ kind: 'evacuated', value: 999 }]),
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(payload, { status: 200 }));
    const dossier = buildDossier(INCIDENT, [source], ['33']);
    const result = await enrichWithLlm(dossier, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.facts.some(f => f.method === 'llm')).toBe(false);
    expect(result).toEqual(dossier);
  });

  it('renvoie le dossier inchangé sur un statut HTTP non-ok', async () => {
    // Le corps contient un candidat par ailleurs valide et grounded — s'il
    // était traité malgré le statut d'erreur, ce test ne distinguerait pas
    // un bug « ok ignoré » d'un simple candidat vide.
    const source = fact({
      quote: "L'incendie a détruit 42 000 hectares et contraint 220 000 personnes à évacuer.",
    });
    const payload = JSON.stringify({
      response: JSON.stringify([{ kind: 'evacuated', value: 220000 }]),
    });
    const dossier = buildDossier(INCIDENT, [source], ['33']);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(payload, { status: 500 }));
    const result = await enrichWithLlm(dossier, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual(dossier);
  });

  it('n\'ajoute pas de doublon (même genre, même valeur qu\'un fait déjà connu)', async () => {
    const source = fact({ kind: 'area_ha', value: 42000, quote: '42 000 hectares de forêt ont été détruits' });
    const payload = JSON.stringify({
      response: JSON.stringify([{ kind: 'area_ha', value: 42000 }]),
    });
    const dossier = buildDossier(INCIDENT, [source], ['33']);
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(payload, { status: 200 }),
    );
    const result = await enrichWithLlm(dossier, { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result).toEqual(dossier);
  });

  it('utilise le modèle et l\'endpoint fournis via deps', async () => {
    const dossier = buildDossier(INCIDENT, [fact()], ['33']);
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ response: '[]' }), { status: 200 }),
    );
    await enrichWithLlm(dossier, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      endpoint: 'http://127.0.0.1:11434',
      model: 'llama3',
    });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:11434/api/generate');
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe('llama3');
    expect(body.stream).toBe(false);
  });
});

// Round 1 de revue — Findings 1 et 2 : l'ancrage par sous-chaîne brute (a)
// ignore le genre du fait (un nombre présent n'importe où dans la citation
// valide n'importe quel kind) et (b) accepte un fragment d'un nombre plus
// long ("4" dans "42000"). Le fait source porte volontairement un
// kind/value (`injured`/999999) qui ne collisionne avec aucun candidat
// testé ici, pour que le rejet ou l'acceptation viennent bien de l'ancrage
// et jamais de la déduplication (already-known).
describe('enrichWithLlm — ancrage genre + frontière de chiffre (round 1 de revue)', () => {
  function sourceFact(quote: string): ImpactFact {
    return fact({ quote, kind: 'injured', value: 999999, sourceName: 'Sud Ouest' });
  }

  async function isAccepted(quote: string, candidate: { kind: string; value: number }): Promise<boolean> {
    const payload = JSON.stringify({ response: JSON.stringify([candidate]) });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(payload, { status: 200 }));
    const dossier = buildDossier(INCIDENT, [sourceFact(quote)], ['33']);
    const result = await enrichWithLlm(dossier, { fetchImpl: fetchImpl as unknown as typeof fetch });
    return result.facts.some(f => f.method === 'llm' && f.kind === candidate.kind && f.value === candidate.value);
  }

  it('area_ha: 42000 sur "42 000 hectares" → accepté', async () => {
    expect(await isAccepted(
      "L'incendie a détruit 42 000 hectares.",
      { kind: 'area_ha', value: 42000 },
    )).toBe(true);
  });

  it('evacuated: 220000 sur "220 000 personnes à évacuer" → accepté', async () => {
    expect(await isAccepted(
      "L'incendie a détruit 42 000 hectares et contraint 220 000 personnes à évacuer.",
      { kind: 'evacuated', value: 220000 },
    )).toBe(true);
  });

  it('Finding 1 — evacuated: 175 sur "42 000 hectares et 175 maisons" → rejeté (mauvais genre)', async () => {
    expect(await isAccepted(
      "L'incendie a détruit 42 000 hectares et 175 maisons.",
      { kind: 'evacuated', value: 175 },
    )).toBe(false);
  });

  it('Finding 2 — injured: 4 sur "42 000 hectares" → rejeté (fragment d\'un nombre plus long)', async () => {
    expect(await isAccepted(
      "L'incendie a détruit 42 000 hectares.",
      { kind: 'injured', value: 4 },
    )).toBe(false);
  });

  it('dwellings_destroyed: 175 sur "175 maisons ont brûlé" → accepté (bon genre, contraste avec Finding 1)', async () => {
    expect(await isAccepted(
      '175 maisons ont brûlé.',
      { kind: 'dwellings_destroyed', value: 175 },
    )).toBe(true);
  });

  it('Finding 2 (isolé du lexique) — dwellings_destroyed: 75 sur "175 maisons" → rejeté (fragment de 175, pas son propre nombre)', async () => {
    // Contrairement au test Finding 2 ci-dessus, le mot-clé du bon genre EST
    // présent juste à côté — seule la frontière de chiffre peut rejeter ce
    // candidat. Sans elle, "75" matcherait comme sous-chaîne de "175", avec
    // "maisons" à proximité immédiate, et serait accepté à tort.
    expect(await isAccepted(
      '175 maisons ont brûlé.',
      { kind: 'dwellings_destroyed', value: 75 },
    )).toBe(false);
  });

  it('non-régression : insécable fine (U+2009) dans le nombre → toujours accepté', async () => {
    expect(await isAccepted(
      "L'incendie a détruit 42 000 hectares.",
      { kind: 'area_ha', value: 42000 },
    )).toBe(true);
  });

  it('rejette un genre valide trouvé ailleurs dans la citation, perdant la compétition sur ce chiffre', async () => {
    // Preuve que le mécanisme est une COMPÉTITION relative entre genres, pas
    // une simple présence : "évacuation" existe bien dans cette citation,
    // mais "maisons" est bien plus proche de "175" — evacuated perd donc la
    // compétition sur cette occurrence précise. Sans compétition, la simple
    // présence d'"évacuation" n'importe où dans la citation validerait à
    // tort n'importe quel nombre du même texte.
    expect(await isAccepted(
      "Le feu a détruit 42 000 hectares. Ailleurs, une décision d'évacuation a "
      + 'concerné une commune voisine, où 175 maisons ont brûlé.',
      { kind: 'evacuated', value: 175 },
    )).toBe(false);
  });
});

// Round 2 de revue — Finding 4 : un rayon de proximité fixe (round 1) ne
// peut PAS satisfaire à la fois une incise éloignée légitime (53 caractères
// entre le chiffre et le mot-clé dans le cas ci-dessous) et le rejet d'une
// contamination croisée dans une phrase à deux faits rapprochés (22
// caractères seulement) : 53 > 22, donc aucun seuil scalaire ne peut accepter
// le premier et rejeter le second. Remplacé par une compétition relative
// (voir `nearestKeywordDistance`/`isGroundedInQuote`) : le genre revendiqué
// doit avoir son mot-clé strictement plus proche que tout autre genre pour
// cette occurrence précise du chiffre.
describe('enrichWithLlm — compétition de proximité entre genres (round 2 de revue)', () => {
  function sourceFact(quote: string): ImpactFact {
    return fact({ quote, kind: 'injured', value: 999999, sourceName: 'Sud Ouest' });
  }

  async function isAccepted(quote: string, candidate: { kind: string; value: number }): Promise<boolean> {
    const payload = JSON.stringify({ response: JSON.stringify([candidate]) });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(payload, { status: 200 }));
    const dossier = buildDossier(INCIDENT, [sourceFact(quote)], ['33']);
    const result = await enrichWithLlm(dossier, { fetchImpl: fetchImpl as unknown as typeof fetch });
    return result.facts.some(f => f.method === 'llm' && f.kind === candidate.kind && f.value === candidate.value);
  }

  // Phrase à deux faits rapprochés : preuve que la compétition fonctionne
  // dans les DEUX sens, sur le même texte.
  const TWO_FACTS_QUOTE = 'Le bilan fait état de 175 maisons détruites et 12 évacués.';

  it('dwellings_destroyed: 175 → accepté ("maisons" adjacent au 175)', async () => {
    expect(await isAccepted(TWO_FACTS_QUOTE, { kind: 'dwellings_destroyed', value: 175 })).toBe(true);
  });

  it('evacuated: 175 → rejeté ("maisons" gagne la compétition sur ce chiffre)', async () => {
    expect(await isAccepted(TWO_FACTS_QUOTE, { kind: 'evacuated', value: 175 })).toBe(false);
  });

  it('evacuated: 12 → accepté ("évacués" adjacent au 12)', async () => {
    expect(await isAccepted(TWO_FACTS_QUOTE, { kind: 'evacuated', value: 12 })).toBe(true);
  });

  it('dwellings_destroyed: 12 → rejeté ("évacués" gagne la compétition sur ce chiffre)', async () => {
    expect(await isAccepted(TWO_FACTS_QUOTE, { kind: 'dwellings_destroyed', value: 12 })).toBe(false);
  });

  it('non-régression Finding 4 — evacuated: 220000 → accepté malgré une incise de 53 caractères', async () => {
    // C'est le cas précis que le rayon fixe de 30 (round 1) rejetait à tort.
    expect(await isAccepted(
      '220 000 personnes, dont de nombreux vacanciers, ont dû être évacuées.',
      { kind: 'evacuated', value: 220000 },
    )).toBe(true);
  });

  it('non-régression — area_ha: 42000 sur "42 000 hectares" → toujours accepté', async () => {
    expect(await isAccepted(
      "L'incendie a détruit 42 000 hectares.",
      { kind: 'area_ha', value: 42000 },
    )).toBe(true);
  });

  it('non-régression Finding 2 — injured: 4 sur "42 000 hectares" → toujours rejeté', async () => {
    expect(await isAccepted(
      "L'incendie a détruit 42 000 hectares.",
      { kind: 'injured', value: 4 },
    )).toBe(false);
  });

  it('non-régression Finding 2 isolé — dwellings_destroyed: 75 sur "175 maisons" → toujours rejeté', async () => {
    expect(await isAccepted(
      '175 maisons ont brûlé.',
      { kind: 'dwellings_destroyed', value: 75 },
    )).toBe(false);
  });

  it('non-régression — insécable fine (U+2009) dans le nombre → toujours accepté', async () => {
    expect(await isAccepted(
      "L'incendie a détruit 42 000 hectares.",
      { kind: 'area_ha', value: 42000 },
    )).toBe(true);
  });

  it('égalité stricte de distance entre deux genres concurrents → rejeté (aucun ne l\'emporte)', async () => {
    // "blessés" et "hectares" sont chacun à exactement 1 caractère de "50"
    // (un espace de chaque côté) — distances vérifiées par calcul direct.
    // L'ambiguïté n'est pas une preuve : ni area_ha ni injured ne l'emporte.
    const quote = 'blessés 50 hectares.';
    expect(await isAccepted(quote, { kind: 'area_ha', value: 50 })).toBe(false);
    expect(await isAccepted(quote, { kind: 'injured', value: 50 })).toBe(false);
  });
});
