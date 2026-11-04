/**
 * anticipation.ts : service client de l'anticipation (04/11/2026).
 * Lit /api/anticipation/{now,note,bilan} derrière le circuit breaker commun (3 échecs : 5 min de repos) ;
 * pendant une panne, la dernière réponse valide est resservie (sa date reste dans `generatedAt`).
 * Les retours Utile / Déjà su / Faux sont mémorisés dans localStorage : un vote par scénario.
 */
import type {
  AnticipationBilan,
  AnticipationNote,
  AnticipationNowResponse,
  AnticipationVote,
} from '../types/index.ts';
import { fetchWithBreaker } from '../utils/fetch-with-breaker.ts';

const BASE = '/api/anticipation';
const VOTES_KEY = 'fm.anticipation.votes.v1';
const TIMEOUT_MS = 10_000;

/** Dernière réponse valide par clé de source. */
const lastGood = new Map<string, unknown>();

/** Oublie les réponses mémorisées (tests). */
export function resetAnticipationCache(): void {
  lastGood.clear();
}

/**
 * GET JSON protégé par le breaker. Échec (réseau, circuit ouvert, statut non 2xx) : dernière réponse valide si elle existe, sinon lève.
 * `nullOn404` : un 404 est une réponse normale (note absente) et rend null.
 */
async function getJson<T>(path: string, breakerKey: string, nullOn404 = false): Promise<T | null> {
  try {
    const res = await fetchWithBreaker(`${BASE}/${path}`, { breakerKey, retries: 0, timeoutMs: TIMEOUT_MS });
    if (nullOn404 && res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as T;
    lastGood.set(path, body);
    return body;
  } catch (error) {
    if (lastGood.has(path)) return lastGood.get(path) as T;
    throw error;
  }
}

/** Instantané : scénarios ouverts, agenda, signaux cités, inconnus et erreurs. */
export async function fetchAnticipationNow(): Promise<AnticipationNowResponse> {
  const body = await getJson<AnticipationNowResponse>('now', 'anticipation');
  if (!body) throw new Error('anticipation : réponse vide');
  return body;
}

/** Note de 7 h (jour AAAA-MM-JJ, sinon la plus récente) ; null si aucune n'existe. */
export async function fetchAnticipationNote(day?: string): Promise<AnticipationNote | null> {
  const path = day ? `note?day=${encodeURIComponent(day)}` : 'note';
  return getJson<AnticipationNote>(path, 'anticipation-note', true);
}

/** Bilan mensuel (mois AAAA-MM, sinon le mois de Paris courant). */
export async function fetchAnticipationBilan(month?: string): Promise<AnticipationBilan> {
  const path = month ? `bilan?month=${encodeURIComponent(month)}` : 'bilan';
  const body = await getJson<AnticipationBilan>(path, 'anticipation');
  if (!body) throw new Error('anticipation : bilan vide');
  return body;
}

// ── Mémoire des votes (un vote par scénario) ──

const VOTE_VALUES: readonly string[] = ['utile', 'deja_su', 'faux'];

function readVotes(): Record<string, AnticipationVote> {
  try {
    const raw = localStorage.getItem(VOTES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, AnticipationVote> = {};
    for (const [id, vote] of Object.entries(parsed)) {
      if (typeof vote === 'string' && VOTE_VALUES.includes(vote)) out[id] = vote as AnticipationVote;
    }
    return out;
  } catch {
    return {};
  }
}

function rememberVote(scenarioId: string, vote: AnticipationVote): void {
  try {
    localStorage.setItem(VOTES_KEY, JSON.stringify({ ...readVotes(), [scenarioId]: vote }));
  } catch {
    /* stockage indisponible : le serveur reste le garde-fou */
  }
}

/** Vote déjà donné par ce navigateur pour ce scénario, ou null. */
export function readAnticipationVote(scenarioId: string): AnticipationVote | null {
  return readVotes()[scenarioId] ?? null;
}

/**
 * Envoie un retour. 'ok' : enregistré (204) ; 'deja' : déjà voté ici ou refusé par le serveur (429) ; 'erreur' : 400, 415, plafond
 * passager (429 avec Retry-After), panne ou réseau.
 */
export async function sendAnticipationFeedback(
  scenarioId: string,
  vote: AnticipationVote,
): Promise<'ok' | 'deja' | 'erreur'> {
  if (readAnticipationVote(scenarioId)) return 'deja';
  try {
    // Sans disjoncteur : un 429 est une réponse normale (déjà voté) et ne doit pas bloquer les votes suivants.
    const res = await fetch(`${BASE}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scenarioId, vote }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // 429 avec Retry-After : plafond passager du serveur (par minute), pas un vote déjà compté ; on ne le mémorise pas.
    if (res.status === 429 && res.headers.get('retry-after') !== null) return 'erreur';
    if (res.status === 429) {
      rememberVote(scenarioId, vote);
      return 'deja';
    }
    if (res.ok) {
      rememberVote(scenarioId, vote);
      return 'ok';
    }
    return 'erreur';
  } catch {
    return 'erreur';
  }
}
