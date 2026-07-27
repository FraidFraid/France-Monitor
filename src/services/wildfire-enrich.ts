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
 * Lexique par genre — DÉRIVÉ des motifs `NUMERIC_PATTERNS` d'
 * api/_lib/impact-extractor.js (Task 1), pas une reprise à l'identique : on
 * n'en garde que le noyau lexical (les mots), pas la structure complète —
 * `evacuated` y exige la co-occurrence chiffre + « personnes/habitants » PUIS
 * « évacu/déplac » ; `injured` exige « pompiers/personnes » immédiatement
 * suivi de « blessé » ; `road_closed` exige la structure « coupée SUR X km ».
 * Simplification VOLONTAIRE : les motifs de Task 1 EXTRAIENT un chiffre
 * depuis du texte brut et doivent donc être précis dès la détection ; ce
 * lexique ne fait que VALIDER la proximité d'un chiffre déjà extrait par
 * ailleurs (le LLM) — un rôle plus simple qui n'a pas besoin de la même
 * rigueur structurelle. Risque de dérive assumé : si Task 1 fait évoluer ses
 * motifs (nouveaux synonymes, structure resserrée), ce lexique ne suit pas
 * automatiquement — même limite déjà relevée pour `isSafeSourceUrl`
 * (WildfireDossierModal.ts) vis-à-vis d'`escapeHtml` (Finding 5, round 2).
 *
 * Sert de second verrou (voir `isGroundedInQuote`) : un chiffre présent dans
 * une citation ne suffit pas, il faut que le genre revendiqué GAGNE la
 * compétition de proximité contre tous les autres genres chiffrés pour CE
 * chiffre précis (Finding 1 puis Finding 4, round 2 de revue — un rayon fixe
 * ne peut structurellement pas séparer une incise éloignée légitime d'une
 * phrase à deux faits rapprochés, voir task-9-report.md).
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
 * Distance en caractères entre l'occurrence d'un chiffre `[start, start+length)`
 * et la plus proche occurrence d'un mot du lexique du genre `kind` dans
 * `text`. `null` si ce lexique n'apparaît nulle part dans la citation — pas
 * de preuve, pas de distance. Un mot-clé qui chevauche ou touche le chiffre
 * compte comme distance 0.
 *
 * Round 2, Finding 4 : un rayon fixe ne peut PAS distinguer les deux cas
 * mesurés sur des citations réelles — « 220 000 personnes, dont de nombreux
 * vacanciers, ont dû être évacuées. » a 53 caractères entre le chiffre et
 * « évacu » (incise légitime, à ACCEPTER), tandis que « 175 maisons
 * détruites et 12 évacués. » n'a que 22 caractères entre `175` et `12` (à
 * REJETER pour `evacuated: 175`). 53 > 22 : aucun seuil scalaire ne peut
 * accepter le premier et rejeter le second. Cette fonction ne mesure donc
 * plus une distance contre un seuil, mais sert à un CLASSEMENT relatif entre
 * genres (voir `isGroundedInQuote`) : peu importe la distance absolue, seul
 * compte qui, du genre revendiqué ou d'un concurrent, est le plus proche.
 */
function nearestKeywordDistance(
  text: string, start: number, length: number, kind: NumericFactKind,
): number | null {
  const lexicon = NUMERIC_FACT_LEXICON[kind];
  const globalLexicon = new RegExp(lexicon.source, lexicon.flags.includes('g') ? lexicon.flags : `${lexicon.flags}g`);
  const end = start + length;

  let best: number | null = null;
  let match: RegExpExecArray | null;
  while ((match = globalLexicon.exec(text)) !== null) {
    const kwStart = match.index;
    const kwEnd = kwStart + match[0].length;
    const distance = kwStart >= end ? kwStart - end : kwEnd <= start ? start - kwEnd : 0;
    if (best === null || distance < best) best = distance;
    // Filet anti-boucle infinie si un mot-clé matchait un jour la chaîne
    // vide — aucun des lexiques actuels ne le fait, mais `exec` sur un motif
    // global qui matche `''` ne progresse jamais tout seul.
    if (match[0].length === 0) globalLexicon.lastIndex += 1;
  }
  return best;
}

/**
 * Un candidat est retenu seulement si (a) sa valeur existe dans la citation
 * comme un nombre À PART ENTIÈRE — jamais un fragment d'un nombre plus long
 * (Finding 2 : `injured: 4` ne doit pas s'ancrer sur « 42000 ») — ET (b) le
 * genre revendiqué GAGNE la compétition de proximité : son mot-clé le plus
 * proche de CETTE occurrence doit être strictement plus proche que celui de
 * TOUS les autres genres chiffrés (Finding 1 puis Finding 4, round 2 de
 * revue — remplace le rayon fixe du round 1, structurellement incapable de
 * séparer une incise éloignée légitime d'une phrase à deux faits proches).
 * Aucun mot-clé du genre revendiqué dans toute la citation → rejet immédiat,
 * sans même chercher de concurrent. Égalité de distance avec un concurrent
 * → rejet : l'ambiguïté n'est pas une preuve (§ principe du projet : rien
 * plutôt qu'un fait douteux).
 */
function isGroundedInQuote(quote: string, kind: NumericFactKind, value: number): boolean {
  const text = normalizeThousands(quote);
  const numberPattern = new RegExp(`(?<!\\d)${escapeRegExp(String(value))}(?!\\d)`, 'g');

  let match: RegExpExecArray | null;
  while ((match = numberPattern.exec(text)) !== null) {
    const start = match.index;
    const length = match[0].length;
    const ownDistance = nearestKeywordDistance(text, start, length, kind);
    if (ownDistance === null) continue;

    const winsAgainstAllOthers = NUMERIC_KINDS.every(other => {
      if (other === kind) return true;
      const otherDistance = nearestKeywordDistance(text, start, length, other);
      return otherDistance === null || ownDistance < otherDistance;
    });
    if (winsAgainstAllOthers) return true;
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
