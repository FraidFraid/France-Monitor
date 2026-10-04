// src/services/sovereignty-source.ts : socle des services clients Souveraineté (spec 2026-10-04 souveraineté § 1, S1 à S4 ; contrats
// § 3.2). Reprend les prédicats et la fusion à l'écriture des Trafics et ajoute ce que la souveraineté demande en plus :
// - formes exactes vérifiées élément par élément : un élément mal formé (champ absent, faux ou en trop) refuse la réponse et il est
//   nommé par son chemin dans le message (« others[2].registration (en trop) »), jamais accepté ni corrigé (S3, S4) ;
// - lecture qui ne rejette jamais, cache par URL sous la relève d'App.ts, et réponse non 2xx de même forme (502 du serveur) lue
//   pour nommer la panne par ses erreurs (« adsb.lol : HTTP 429, nouvelle tentative après 16:58 ») au lieu de « HTTP 502 » ;
// - statut du panneau des sources lié aux retards de la souveraineté (tableau S2), avec un filtre par source pour les réponses qui
//   portent plusieurs sources (cinq pour la vigilance cyber).
import type { DataSourceStatus } from '../types/index.ts';
import { absoluteTime } from '../components/fiche/kit.ts';
import { isRecord } from './health-surveillance.ts';
import { isSovereigntyDataLate, type SovereigntySource } from './sovereignty-levels.ts';
import { dataMs, isNum, type SourceSlot } from './traffic-source.ts';

export {
  dataMs, emptySlot, isBool, isNum, isNumOrNull, isPoint, isStr, isStrOrNull, listOf, loadSlot, mergeSlot, numbersIn, type SourceSlot,
} from './traffic-source.ts';
export { isOneOf } from './environment-source.ts';

export type SovereigntyStatus = Pick<DataSourceStatus, 'status' | 'lastUpdate' | 'error' | 'period'>;

// ─── Notes d'avancement du serveur (jamais des pannes) ───

/** File adsb.lol occupée au-delà de l'échéance de la route (api/_lib/military-collect.js, MIL_PENDING_NOTE). */
export const MILITARY_PENDING_NOTE = 'adsb.lol : collecte en cours';
/** Plus de 20 pages CERT-FR dues : le reste au cycle suivant (api/_lib/cyber-collect.js, CERTFR_PAGES_NOTE). */
export const CERTFR_PAGES_NOTE = 'CERT-FR : lecture des pages en cours';
/** Collecte cyber plus longue que l'échéance de la route (api/_lib/cyber-collect.js, CYBER_PENDING_NOTE). */
export const CYBER_PENDING_NOTE = 'Vigilance cyber : collecte en cours';
/** Cumul de la grille GNSS de moins de 24 h (phase B, api/_lib/gnss-collect.js). */
export const GNSS_CONSTRUCTION_NOTE = 'Grille GNSS : référence en construction';

/** Notes d'avancement du serveur : phrases exactes des modules serveur. */
export const SOVEREIGNTY_PROGRESS_NOTES: readonly string[] = [MILITARY_PENDING_NOTE, CERTFR_PAGES_NOTE, CYBER_PENDING_NOTE, GNSS_CONSTRUCTION_NOTE];

export function isSovereigntyProgressNote(text: string): boolean {
  return SOVEREIGNTY_PROGRESS_NOTES.includes(text);
}

// ─── Formes exactes, vérifiées élément par élément (S3, S4) ───

/** Prédicats de valeur ajoutés à ceux des Trafics. */
export const isCount = (v: unknown): v is number => isNum(v) && Number.isInteger(v) && v >= 0;
export const isCountOrNull = (v: unknown): boolean => v === null || isCount(v);
/** Date ISO lisible. */
export const isDate = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));
export const isDateOrNull = (v: unknown): boolean => v === null || isDate(v);
/** Jour « AAAA-MM-JJ » lisible. */
export const isDay = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v));
export const isDayOrNull = (v: unknown): boolean => v === null || isDay(v);
export const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x: unknown) => typeof x === 'string');

/** Écarts d'une valeur à sa forme, nommés par leur chemin (« others[2].family ») ; liste vide : conforme. */
export type ShapeCheck = (v: unknown, at: string) => string[];

const pathOf = (at: string, key: string): string => (at === '' ? key : `${at}.${key}`);

/** Valeur simple, conforme si `ok(v)`. */
export function value(ok: (v: unknown) => boolean): ShapeCheck {
  return (v, at) => (ok(v) ? [] : [at || 'réponse']);
}

/** Valeur constante (`masked: true`, `licence: 'ODbL 1.0'`). */
export function exactly(expected: string | number | boolean | null): ShapeCheck {
  return value((v) => v === expected);
}

/** Valeur nulle, ou conforme à `check`. */
export function nullable(check: ShapeCheck): ShapeCheck {
  return (v, at) => (v === null ? [] : check(v, at));
}

/**
 * Objet de forme exacte : chaque champ de `fields` présent et conforme (sauf ceux d'`optional`, facultatifs dans le type), aucun champ
 * de plus : un champ que le contrat ne prévoit pas (immatriculation, titre d'une fuite…) refuse la réponse au lieu d'être affiché.
 */
export function record(fields: Readonly<Record<string, ShapeCheck>>, optional: readonly string[] = []): ShapeCheck {
  return (v, at) => {
    if (!isRecord(v)) return [at || 'réponse'];
    const out: string[] = [];
    for (const [key, check] of Object.entries(fields)) {
      if (!(key in v)) {
        if (!optional.includes(key)) out.push(`${pathOf(at, key)} (absent)`);
      } else {
        out.push(...check(v[key], pathOf(at, key)));
      }
    }
    for (const key of Object.keys(v)) if (!(key in fields)) out.push(`${pathOf(at, key)} (en trop)`);
    return out;
  };
}

/** Référence publique qui peut nommer un élément (« CERTFR-2026-ALE-011 », « CVE-2026-88771 ») à la place de son rang. */
const PUBLIC_REF = /^[A-Za-z0-9._:/-]{1,40}$/;

/**
 * Liste vérifiée élément par élément ; un élément mal formé est nommé par son rang, ou par `idKey` quand c'est une référence publique
 * (jamais l'adresse d'un aéronef ni le MMSI d'un navire : les listes Défense et Connectivité sont nommées par leur rang).
 */
export function list(item: ShapeCheck, idKey?: string): ShapeCheck {
  return (v, at) => {
    if (!Array.isArray(v)) return [at || 'réponse'];
    return v.flatMap((e: unknown, i: number) => {
      const id = idKey !== undefined && isRecord(e) ? e[idKey] : undefined;
      return item(e, `${at}[${typeof id === 'string' && PUBLIC_REF.test(id) ? id : i}]`);
    });
  };
}

/** Règle de cohérence entre champs d'un objet déjà conforme (`slowVessels` nul quand la veille n'est pas évaluée). */
export function refine(check: ShapeCheck, rule: (v: Record<string, unknown>) => boolean, label: string): ShapeCheck {
  return (v, at) => {
    const problems = check(v, at);
    if (problems.length > 0 || !isRecord(v) || rule(v)) return problems;
    return [`${at || 'réponse'} (${label})`];
  };
}

/** Forme d'une réponse : ses écarts nommés, et le prédicat de type qui en découle. */
export interface Shape<T> {
  problems(v: unknown): string[];
  is(v: unknown): v is T;
}

export function shapeOf<T>(check: ShapeCheck): Shape<T> {
  return {
    problems: (v) => check(v, ''),
    is: (v): v is T => check(v, '').length === 0,
  };
}

/** Au plus cinq écarts nommés, puis leur nombre. */
export function describeProblems(problems: readonly string[]): string {
  const shown = problems.slice(0, 5).join(', ');
  return problems.length > 5 ? `${shown} et ${problems.length - 5}\u00a0autres` : shown;
}

// ─── Lecture qui ne rejette jamais ───

const READ_TIMEOUT_MS = 20_000;

interface RawRead { ok: boolean; status: number; readable: boolean; json: unknown }

const cache = new Map<string, { data: unknown; at: number }>();
const inFlight = new Map<string, Promise<RawRead>>();

/** Échec avant toute réponse : délai ou réseau, en français (jamais « Failed to fetch » brut). */
function networkErrorMessage(err: unknown): string {
  const name = typeof err === 'object' && err !== null && 'name' in err ? err.name : null;
  return name === 'TimeoutError' || name === 'AbortError' ? 'délai dépassé' : 'source injoignable';
}

async function rawRead(url: string): Promise<RawRead> {
  let resp: Response;
  try {
    resp = await fetch(url, { signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
  } catch (err) {
    throw new Error(networkErrorMessage(err));
  }
  try {
    return { ok: resp.ok, status: resp.status, readable: true, json: (await resp.json()) as unknown };
  } catch {
    return { ok: resp.ok, status: resp.status, readable: false, json: null };
  }
}

/** Une seule requête par URL tant qu'elle est en cours (démarrage, couche restaurée, relève) ; un échec n'est jamais gardé. */
function sharedRead(url: string): Promise<RawRead> {
  const pending = inFlight.get(url);
  if (pending) return pending;
  const read = rawRead(url).finally(() => { inFlight.delete(url); });
  inFlight.set(url, read);
  return read;
}

/**
 * Lit `url` ; la réponse conforme est gardée `ttlMs` (plus court que la relève). Ne rejette jamais : en échec, la source garde ses
 * dernières données et porte le message (S3) ; un échec n'est jamais mis en cache. Une réponse non 2xx de même forme que la réponse
 * attendue (502 du serveur : rien n'a pu être lu) est nommée par ses erreurs ; sinon « HTTP 502 ». Réponse mal formée : ses écarts
 * nommés un par un (« réponse des vols militaires mal formée : others[0].registration (en trop) »), aucune donnée gardée d'elle.
 */
export async function loadSovereigntySlot<T extends { errors: string[] }>(
  url: string, ttlMs: number, previous: SourceSlot<T> | undefined, now: number, shape: Shape<T>, name: string,
): Promise<SourceSlot<T>> {
  const hit = cache.get(url);
  if (hit && now - hit.at < ttlMs && shape.is(hit.data)) return { data: hit.data, error: null, fetchedAt: hit.at };
  try {
    const read = await sharedRead(url);
    const json = read.json;
    if (!read.ok) {
      const named = read.readable && shape.is(json) ? json.errors : [];
      throw new Error(named.length > 0 ? named.join(' ; ') : `HTTP ${read.status}`);
    }
    if (!read.readable) throw new Error('réponse illisible');
    if (!shape.is(json)) throw new Error(`réponse ${name} mal formée : ${describeProblems(shape.problems(json))}`);
    cache.set(url, { data: json, at: now });
    return { data: json, error: null, fetchedAt: now };
  } catch (err) {
    return { data: previous?.data ?? null, error: err instanceof Error ? err.message : 'erreur inconnue', fetchedAt: previous?.fetchedAt ?? null };
  }
}

/** Tests seulement : vide le cache et les lectures en cours. */
export function resetSovereigntySourceCache(): void {
  cache.clear();
  inFlight.clear();
}

// ─── Panneau des sources (S1, S2) ───

/** Erreur nommée par la source `prefix` (« CERT-FR, avis : HTTP 503 », « CISA KEV : HTTP 503 »). */
export function isNamedBy(text: string, prefix: string): boolean {
  return text === prefix || text.startsWith(`${prefix} `) || text.startsWith(`${prefix},`);
}

/**
 * Panneau des sources (S1, S2) : comme environmentSlotStatus, avec isSovereigntyDataLate. Date de la donnée, jamais l'heure de
 * lecture ; « stale » en retard ou quand une partie a échoué ; « error » sans donnée ou sans date de la source (partie jamais lue) ;
 * « loading » avant la première lecture ou quand le serveur ne dit qu'une note d'avancement. Les notes d'avancement sont jointes à la
 * période, sans dégrader le statut.
 * `errorPrefix` : ne garde que les erreurs de la réponse nommées par ce libellé (une réponse cyber porte cinq sources).
 * `options.parts` : libellés de toutes les sources de la réponse ; une erreur qui n'en nomme aucune (collecte interrompue, note
 * d'avancement commune) vaut alors pour chaque ligne, et une panne de lecture n'est retirée d'une ligne que si elle nomme une autre
 * source. `options.fallback` : date de repli quand la source lue ne publie pas sa date (fichier Ransomware.live sans en-tête
 * last-modified : date du relevé), dite par sa note dans la période (« 16:48 · fichier sans date de modification ») ; jamais
 * « source jamais lue » pour une source lue.
 */
export interface SovereigntyStatusOptions {
  parts?: readonly string[];
  fallback?: { date: string | null; note: string };
}

export function sovereigntySlotStatus<T extends { errors: string[] }>(
  slot: SourceSlot<T>, source: SovereigntySource, dataDate: string | null, now: number, errorPrefix?: string,
  options: SovereigntyStatusOptions = {},
): SovereigntyStatus {
  const parts = options.parts ?? [];
  const others = parts.filter((p) => p !== errorPrefix);
  const readFailures = slot.error === null ? [] : slot.error.split(' ; ').filter((e) => !others.some((p) => isNamedBy(e, p)));
  if (slot.data === null) {
    if (slot.error === null) return { status: 'loading', lastUpdate: null, error: undefined, period: undefined };
    if (readFailures.length > 0 && readFailures.every(isSovereigntyProgressNote)) {
      return { status: 'loading', lastUpdate: null, error: undefined, period: `n.d. · ${readFailures.join(' ; ')}` };
    }
    return { status: 'error', lastUpdate: null, error: readFailures.length > 0 ? readFailures.join(' ; ') : 'source jamais lue', period: undefined };
  }
  const own = errorPrefix === undefined
    ? slot.data.errors
    : slot.data.errors.filter((e) => isNamedBy(e, errorPrefix) || (parts.length > 0 && !parts.some((p) => isNamedBy(e, p))));
  const all = [...readFailures, ...own];
  const errors = all.filter((e) => !isSovereigntyProgressNote(e));
  const notes = all.filter(isSovereigntyProgressNote);
  const withNotes = (period: string): string => (notes.length > 0 ? `${period} · ${notes.join(' ; ')}` : period);
  const error = errors.length > 0 ? errors.join(' ; ') : undefined;
  const ownMs = dataMs(dataDate);
  const fallback = ownMs === null && options.fallback !== undefined && dataMs(options.fallback.date) !== null ? options.fallback : null;
  const date = fallback === null ? dataDate : fallback.date;
  const ms = dataMs(date);
  if (ms === null) return { status: 'error', lastUpdate: null, error: error ?? 'source jamais lue', period: withNotes('n.d.') };
  const late = isSovereigntyDataLate(source, date, now);
  // « (en retard) » reste en fin de l'heure (StatusPanel le lit en fin de période) ; la note de repli la précède.
  return {
    status: errors.length > 0 || late ? 'stale' : 'ok', lastUpdate: new Date(ms), error,
    period: withNotes(`${absoluteTime(ms, now, 'fr')}${fallback === null ? '' : ` · ${fallback.note}`}${late ? ' (en retard)' : ''}`),
  };
}
