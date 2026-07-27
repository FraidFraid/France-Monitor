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
