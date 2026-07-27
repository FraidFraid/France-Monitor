/**
 * wildfire-enrich.ts — Enrichissement Ollama du dossier « grand feu ».
 *
 * Seul point d'effet de bord Ollama (voir wildfire-dossier.ts, PUR). Appelé
 * UNIQUEMENT à l'ouverture d'un dossier, pour un seul incident — jamais dans
 * une boucle de rafraîchissement (Task 8, App.ts).
 *
 * Ce que fait réellement `enrichWithLlm` : le dossier ne contient PAS le
 * texte des articles, seulement des faits, chacun avec sa `quote` — la
 * phrase source verbatim. La fonction relit ces citations DÉJÀ PRÉSENTES
 * pour y trouver les genres de faits que les motifs déterministes (Task 1)
 * ont manqués. Elle n'a donc aucun texte à relire hors des citations, et
 * aucune provenance à inventer (§3.3) : chaque fait produit HÉRITE de la
 * provenance du fait dont la citation l'a livré — `sourceUrl`, `sourceName`,
 * `sourceLevel`, `reliability`, `observedAt`, `quote` — plus `method: 'llm'`.
 *
 * Ollama tourne EN LOCAL uniquement (http://localhost:11434, §7). Jamais de
 * repli vers un LLM cloud (Groq, OpenAI…) : les citations de presse et de
 * communiqués préfectoraux nomment des communes, des lieux-dits, parfois des
 * personnes — la règle du projet interdit d'envoyer cela vers un LLM cloud.
 *
 * Tout échec — réseau injoignable, JSON non parsable, schéma inattendu,
 * timeout — renvoie le dossier INCHANGÉ, sans jamais lever.
 */

import type { ImpactFact, ImpactFactKind, WildfireDossier } from '../types/index.ts';
import { FACT_KINDS, gradeCredibility } from './wildfire-dossier.ts';

const DEFAULT_ENDPOINT = 'http://localhost:11434';
const DEFAULT_MODEL = 'mistral:instruct';
const TIMEOUT_MS = 20_000;

export interface EnrichWithLlmDeps {
  fetchImpl?: typeof fetch;
  endpoint?: string;
  model?: string;
}

const KNOWN_KINDS = new Set<string>(FACT_KINDS);

/**
 * Un genre + une valeur numérique candidats, tels que renvoyés par Ollama —
 * pas encore validés (schéma non garanti d'une réponse LLM).
 */
interface LlmCandidate {
  kind: string;
  value: number;
}

function isLlmCandidate(raw: unknown): raw is LlmCandidate {
  if (typeof raw !== 'object' || raw === null) return false;
  const { kind, value } = raw as Record<string, unknown>;
  return typeof kind === 'string' && typeof value === 'number' && Number.isFinite(value);
}

/**
 * Un nombre cité en français s'écrit souvent avec un espace de milliers
 * (« 220 000 »). On compacte tout blanc (espace, insécable, fine insécable)
 * avant de chercher la valeur en chiffres : ni la ponctuation ni les lettres
 * environnantes ne peuvent produire une fausse correspondance, seuls les
 * chiffres déjà contigus dans le texte source le peuvent.
 */
function quoteGrounds(quote: string, value: number): boolean {
  const compact = quote.replace(/[\s\u00a0\u202f]/g, '');
  return compact.includes(String(value));
}

/**
 * Prompt : demande explicitement un tableau JSON strict, et interdit toute
 * déduction — seuls les chiffres explicitement présents dans les citations
 * comptent. La citation reste la seule vérité ; le garde-fou `quoteGrounds`
 * ci-dessous ne fait pas confiance aveuglément à cette consigne.
 */
function buildPrompt(facts: ImpactFact[]): string {
  const citations = facts.map((f, i) => `${i + 1}. "${f.quote}"`).join('\n');
  return [
    'Tu relis des citations de presse et de communiqués officiels sur un incendie en France.',
    `Genres de faits connus : ${FACT_KINDS.join(', ')}.`,
    'Pour chaque citation, identifie UNIQUEMENT les faits chiffrés qui y sont EXPLICITEMENT',
    'mentionnés. N\'invente et ne déduis aucun chiffre absent du texte.',
    'Réponds STRICTEMENT avec un tableau JSON, sans aucun texte autour, de la forme :',
    '[{"kind": "<genre>", "value": <nombre>}]',
    'Citations à relire :',
    citations,
  ].join('\n');
}

/**
 * Valide chaque candidat et lui rattache la provenance du fait source dont
 * la citation contient effectivement sa valeur. Un candidat dont le genre
 * est inconnu, dont la valeur n'est numérique dans aucune citation relue, ou
 * qui double un fait déjà présent (même genre, même valeur) est écarté —
 * jamais complété par une valeur par défaut (§3.3).
 */
function factsFromCandidates(candidates: unknown[], sourceFacts: ImpactFact[]): ImpactFact[] {
  const already = new Set(sourceFacts.map(f => `${f.kind}|${f.value ?? 'null'}`));
  let nextId = Math.max(0, ...sourceFacts.map(f => f.id)) + 1;
  const added: ImpactFact[] = [];

  for (const raw of candidates) {
    if (!isLlmCandidate(raw)) continue;
    const { kind, value } = raw;
    if (!KNOWN_KINDS.has(kind)) continue;

    const key = `${kind}|${value}`;
    if (already.has(key)) continue;

    // La provenance n'est jamais fabriquée : on cherche le fait dont la
    // citation grounde réellement cette valeur.
    const donor = sourceFacts.find(f => quoteGrounds(f.quote, value));
    if (!donor) continue;

    const newFact: ImpactFact = {
      id: nextId++,
      kind: kind as ImpactFactKind,
      value,
      unit: kind === 'area_ha' ? 'ha' : null,
      quote: donor.quote,
      sourceUrl: donor.sourceUrl,
      sourceName: donor.sourceName,
      sourceLevel: donor.sourceLevel,
      reliability: donor.reliability,
      hedged: donor.hedged,
      provisional: donor.provisional,
      observedAt: donor.observedAt,
      communes: donor.communes,
      method: 'llm',
    };
    newFact.credibility = gradeCredibility(newFact, [newFact.sourceName]);

    added.push(newFact);
    already.add(key);
  }

  return added;
}

/**
 * Reconstruit `series` après ajout de faits — même partition que
 * `buildDossier`, pour que la chronologie des révisions (§12.4) reste
 * cohérente avec `facts` dans le rendu (WildfireDossierModal).
 */
function rebuildSeries(facts: ImpactFact[]): Record<ImpactFactKind, ImpactFact[]> {
  return Object.fromEntries(
    FACT_KINDS.map(kind => [kind, facts.filter(f => f.kind === kind)]),
  ) as Record<ImpactFactKind, ImpactFact[]>;
}

export async function enrichWithLlm(
  dossier: WildfireDossier,
  deps: EnrichWithLlmDeps = {},
): Promise<WildfireDossier> {
  // Rien à relire : aucun appel réseau. C'est l'état actuel du système
  // pendant l'indisponibilité de Neon (§4 du plan).
  if (dossier.facts.length === 0) return dossier;

  const fetchImpl = deps.fetchImpl ?? fetch;
  const endpoint = deps.endpoint ?? DEFAULT_ENDPOINT;
  const model = deps.model ?? DEFAULT_MODEL;

  let candidates: unknown;
  try {
    const response = await fetchImpl(`${endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: buildPrompt(dossier.facts),
        stream: false,
        format: 'json',
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return dossier;

    const outer = await response.json() as { response?: unknown };
    if (typeof outer.response !== 'string') return dossier;

    candidates = JSON.parse(outer.response);
  } catch {
    // Réseau injoignable, timeout, JSON invalide… toute panne renvoie le
    // dossier inchangé (§7) : jamais de bascule vers un LLM cloud, jamais
    // d'exception qui remonterait jusqu'à l'ouverture du modal.
    return dossier;
  }

  if (!Array.isArray(candidates)) return dossier;

  const added = factsFromCandidates(candidates, dossier.facts);
  if (added.length === 0) return dossier;

  const facts = [...dossier.facts, ...added]
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));

  return { ...dossier, facts, series: rebuildSeries(facts) };
}
