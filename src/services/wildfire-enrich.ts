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

/**
 * Genres portant effectivement un chiffre — sous-ensemble de `FACT_KINDS`.
 * `evacuation_order` et `rail_disrupted` sont volontairement exclus : ce
 * sont des faits qualitatifs, toujours `value: null` (§3.4, cf.
 * `QUALITATIVE_PATTERNS` dans api/_lib/impact-extractor.js) — `isLlmCandidate`
 * exige `value: number`, donc un candidat de ce genre serait de toute façon
 * silencieusement rejeté. Les motifs déterministes (Task 1) couvrent déjà
 * très bien ces deux genres par mots-clés ; la valeur ajoutée du LLM porte
 * sur les chiffres que ces motifs ont manqués (Finding 3, round 1 de revue).
 */
type NumericFactKind = 'area_ha' | 'evacuated' | 'dwellings_destroyed' | 'injured' | 'road_closed';

/**
 * Lexique par genre — mêmes mots-clés que `NUMERIC_PATTERNS` dans
 * api/_lib/impact-extractor.js (Task 1), pour rester cohérent avec la
 * classification « hybride keyword + override LLM » du projet (CLAUDE.md).
 * Sert de second verrou (voir `isGroundedInQuote`) : un chiffre présent dans
 * une citation ne suffit pas, il faut qu'un mot du bon genre soit à
 * proximité de CE chiffre précis (Finding 1, round 1 de revue) — sans quoi
 * n'importe quel nombre de la citation validerait n'importe quel genre.
 */
const NUMERIC_FACT_LEXICON: Record<NumericFactKind, RegExp> = {
  area_ha: /hectares?|\bha\b/i,
  evacuated: /[ée]vacu|d[ée]plac/i,
  dwellings_destroyed: /maisons?|habitations?|logements?|b[âa]timents?/i,
  injured: /bless[ée]s?/i,
  road_closed: /coup[ée]e?|ferm[ée]e?|neutralis[ée]e?|\bkm\b/i,
};

const NUMERIC_KINDS = Object.keys(NUMERIC_FACT_LEXICON) as NumericFactKind[];
const KNOWN_KINDS = new Set<string>(NUMERIC_KINDS);

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Colle UNIQUEMENT les séparateurs de milliers français (« 220 000 » →
 * « 220000 »), sans toucher aux autres espaces : contrairement à un
 * compactage total (round 1), on a besoin des frontières de mots pour que
 * le lexique de genre (Finding 1) puisse chercher un mot à proximité d'un
 * chiffre. `\s` couvre déjà l'espace insécable (U+00A0) et l'insécable fine
 * (U+202F, U+2009 et le reste de la classe Unicode Space_Separator) — pas
 * de classe de caractères manuelle nécessaire.
 */
function normalizeThousands(text: string): string {
  return text.replace(/(\d)\s(?=\d{3}(\D|$))/g, '$1');
}

/**
 * Rayon (en caractères) de la fenêtre de proximité autour d'un chiffre
 * ancré, dans laquelle on exige un mot du lexique du genre. Calibré sur la
 * citation de référence du 2026-07-26 : entre la fin de « 220000 » et le
 * début de « évacuer » dans « …contraint 220 000 personnes à évacuer. », il
 * y a 13 caractères (« personnes à » normalisé) — 30 laisse une marge
 * confortable. Il reste assez étroit pour rejeter un mot-clé du bon genre
 * mais rattaché à un AUTRE chiffre de la même citation : dans « Le feu a
 * détruit 42 000 hectares. Ailleurs, une décision d'évacuation a concerné
 * une commune voisine, où 175 maisons ont brûlé. », « évacuation » est à
 * ~41 caractères de « 175 » — hors fenêtre, donc `evacuated: 175` reste
 * rejeté malgré la présence du mot ailleurs dans la citation (test dédié).
 */
const PROXIMITY_RADIUS = 30;

/**
 * Un candidat est retenu seulement si (a) sa valeur existe dans la citation
 * comme un nombre À PART ENTIÈRE — jamais un fragment d'un nombre plus long
 * (Finding 2 : `injured: 4` ne doit pas s'ancrer sur « 42000 ») — ET (b) un
 * mot du lexique de son genre apparaît à proximité de CETTE occurrence
 * précise (Finding 1). L'un sans l'autre ne suffit jamais : un chiffre juste
 * n'importe où dans la citation, ou un mot-clé juste n'importe où dans la
 * citation, ne prouvent rien sur ce que le chiffre désigne réellement.
 */
function isGroundedInQuote(quote: string, kind: NumericFactKind, value: number): boolean {
  const lexicon = NUMERIC_FACT_LEXICON[kind];
  const text = normalizeThousands(quote);
  const numberPattern = new RegExp(`(?<!\\d)${escapeRegExp(String(value))}(?!\\d)`, 'g');

  let match: RegExpExecArray | null;
  while ((match = numberPattern.exec(text)) !== null) {
    const windowStart = Math.max(0, match.index - PROXIMITY_RADIUS);
    const windowEnd = Math.min(text.length, match.index + match[0].length + PROXIMITY_RADIUS);
    if (lexicon.test(text.slice(windowStart, windowEnd))) return true;
  }
  return false;
}

/**
 * Prompt : demande explicitement un tableau JSON strict, et interdit toute
 * déduction — seuls les chiffres explicitement présents dans les citations
 * comptent. La citation reste la seule vérité ; le garde-fou
 * `isGroundedInQuote` ci-dessous ne fait pas confiance aveuglément à cette
 * consigne. Seuls les genres chiffrés sont listés (voir `NumericFactKind`).
 */
function buildPrompt(facts: ImpactFact[]): string {
  const citations = facts.map((f, i) => `${i + 1}. "${f.quote}"`).join('\n');
  return [
    'Tu relis des citations de presse et de communiqués officiels sur un incendie en France.',
    `Genres de faits chiffrés connus : ${NUMERIC_KINDS.join(', ')}.`,
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
 * la citation grounde effectivement sa valeur (chiffre + genre, voir
 * `isGroundedInQuote`). Un candidat dont le genre est inconnu ou non
 * chiffré, dont la valeur n'est ancrée dans aucune citation relue, ou qui
 * double un fait déjà présent (même genre, même valeur) est écarté — jamais
 * complété par une valeur par défaut (§3.3).
 */
function factsFromCandidates(candidates: unknown[], sourceFacts: ImpactFact[]): ImpactFact[] {
  const already = new Set(sourceFacts.map(f => `${f.kind}|${f.value ?? 'null'}`));
  let nextId = Math.max(0, ...sourceFacts.map(f => f.id)) + 1;
  const added: ImpactFact[] = [];

  for (const raw of candidates) {
    if (!isLlmCandidate(raw)) continue;
    const { kind, value } = raw;
    if (!KNOWN_KINDS.has(kind)) continue;
    const numericKind = kind as NumericFactKind;

    const key = `${kind}|${value}`;
    if (already.has(key)) continue;

    // La provenance n'est jamais fabriquée : on cherche le fait dont la
    // citation grounde réellement cette valeur, pour ce genre précis.
    const donor = sourceFacts.find(f => isGroundedInQuote(f.quote, numericKind, value));
    if (!donor) continue;

    const newFact: ImpactFact = {
      id: nextId++,
      kind: numericKind,
      value,
      unit: kind === 'area_ha' ? 'ha' : kind === 'road_closed' ? 'km' : null,
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
