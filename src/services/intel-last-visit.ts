// src/services/intel-last-visit.ts — ancre du fil « depuis votre dernière visite ».
//
// localStorage garde l'heure de la dernière consultation de l'onglet Intelligence France ;
// sessionStorage fige l'ancre pour l'onglet courant (un rechargement ne la perd pas, et les
// rafraîchissements successifs comparent toujours au même point de départ).

import type { IntelVisitAnchor } from '../types/index.ts';
import type { VigilanceLevel } from './vigilance.ts';

const LAST_SEEN_KEY = 'fm:intel:last-seen';
const ANCHOR_KEY = 'fm:intel:visit-anchor';
const LEVELS_KEY = 'fm:intel:last-seen-levels';
const BASELINE_KEY = 'fm:intel:visit-baseline';
const MAX_BASELINE_KEYS = 300;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_LOOKBACK_MS = 7 * DAY_MS;

export type VisitStorage = Pick<Storage, 'getItem' | 'setItem'>;
export interface VisitStores {
  local: VisitStorage | null;
  session: VisitStorage | null;
}

function browserStores(): VisitStores {
  const pick = (get: () => Storage): VisitStorage | null => {
    try {
      return get();
    } catch {
      return null;
    }
  };
  return { local: pick(() => window.localStorage), session: pick(() => window.sessionStorage) };
}

function read(store: VisitStorage | null, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(store: VisitStorage | null, key: string, value: string): void {
  try {
    store?.setItem(key, value);
  } catch {
    // Stockage plein ou bloqué (navigation privée) : l'ancre retombera sur 24 h.
  }
}

/** Pur : ancre à partir de la dernière consultation stockée (absente, invalide ou future → 24 h ; bornée à 7 j). */
export function resolveVisitAnchor(stored: string | null, now: number): IntelVisitAnchor {
  const last = stored === null ? Number.NaN : Number(stored);
  if (!Number.isFinite(last) || last <= 0 || last > now) return { since: now - DAY_MS, kind: 'default' };
  return { since: Math.max(last, now - MAX_LOOKBACK_MS), kind: 'last-visit' };
}

function parseAnchor(raw: string | null): IntelVisitAnchor | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { since, kind } = value as { since?: unknown; kind?: unknown };
    if (typeof since !== 'number' || !Number.isFinite(since)) return null;
    if (kind !== 'last-visit' && kind !== 'default') return null;
    return { since, kind };
  } catch {
    return null;
  }
}

/**
 * Ancre de l'onglet courant ; à la première ouverture, la calcule et la fige pour l'onglet.
 * N'enregistre PAS la visite : seul recordIntelVisitSeen le fait, une fois l'état réellement
 * affiché (une ouverture pendant une panne ne doit pas consommer la fenêtre suivante).
 */
export function beginIntelVisit(now = Date.now(), stores: VisitStores = browserStores()): IntelVisitAnchor {
  const existing = parseAnchor(read(stores.session, ANCHOR_KEY));
  if (existing) return existing;
  const anchor = resolveVisitAnchor(read(stores.local, LAST_SEEN_KEY), now);
  write(stores.session, ANCHOR_KEY, JSON.stringify(anchor));
  return anchor;
}

/** Note que l'utilisateur a vu l'état courant (rafraîchissement visible, fermeture du panneau). */
export function recordIntelVisitSeen(now = Date.now(), stores: VisitStores = browserStores()): void {
  write(stores.local, LAST_SEEN_KEY, String(now));
}

// ─── Ligne de base des niveaux (refonte UI étape 2, arbitrage A4) ──────────────────────────
// Les événements ont leur fil de changements serveur ; les autres éléments « À traiter »
// (situations, alertes, alertes officielles, marchés) sont comparés aux niveaux vus à la visite
// précédente pour les badges « nouveau » et « aggravé ». Même principe que l'ancre : la valeur
// de localStorage est figée pour l'onglet dans sessionStorage à la première lecture.

/** Niveau de chaque élément « À traiter » (clé de liste → couleur L1) vu à la dernière visite. */
export type VisitBaseline = Readonly<Record<string, VigilanceLevel>>;

const LEVEL_VALUES: readonly VigilanceLevel[] = ['vert', 'jaune', 'orange', 'rouge'];

/** Pur : relit une ligne de base stockée ; toute valeur illisible donne null (aucun badge plutôt qu'un faux). */
export function parseVisitBaseline(raw: string | null): VisitBaseline | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const out: Record<string, VigilanceLevel> = {};
    for (const [key, level] of Object.entries(value)) {
      const known = LEVEL_VALUES.find((l) => l === level);
      if (known) out[key] = known;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Ligne de base de l'onglet, figée à la première lecture. DOIT précéder tout recordVisitBaseline
 * de l'onglet : sinon elle serait l'état courant et aucun badge « nouveau » n'apparaîtrait.
 */
export function beginVisitBaseline(stores: VisitStores = browserStores()): VisitBaseline | null {
  const frozen = read(stores.session, BASELINE_KEY);
  if (frozen !== null) return parseVisitBaseline(frozen);
  const stored = read(stores.local, LEVELS_KEY);
  write(stores.session, BASELINE_KEY, stored ?? 'null');
  return parseVisitBaseline(stored);
}

/** Enregistre les niveaux affichés, au même moment que recordIntelVisitSeen ; 300 clés au plus. */
export function recordVisitBaseline(levels: VisitBaseline, stores: VisitStores = browserStores()): void {
  const entries = Object.entries(levels).slice(0, MAX_BASELINE_KEYS);
  write(stores.local, LEVELS_KEY, JSON.stringify(Object.fromEntries(entries)));
}

// ─── Enregistrement de la ligne de base de l'onglet (relecture finale I5) ───────────────────

/** Cible d'écouteurs minimale (document, window), injectable pour les tests. */
interface ListenerTarget {
  addEventListener(type: string, listener: () => void): void;
}

/** Cycle de vie de la page : passage en arrière-plan (visibilitychange → hidden) et départ (pagehide). */
export interface PageLifecycle {
  document: ListenerTarget & { readonly visibilityState: string };
  window: ListenerTarget;
}

export interface VisitBaselineSession {
  /** Ligne de base de l'onglet, figée avant tout enregistrement (null : première visite). */
  baseline: VisitBaseline | null;
  /** Enregistre les niveaux affichés comme ligne de base de la prochaine visite. */
  record: () => void;
}

/**
 * Fige la ligne de base de l'onglet (beginVisitBaseline), PUIS seulement donne de quoi enregistrer :
 * l'ordre exigé par la revue est garanti par construction. Enregistre aussi quand l'onglet passe
 * en arrière-plan ou est quitté, pour que la ligne de base soit la dernière liste vue, données
 * secondaires comprises (cyber, pétrole, AIS, militaire) — jamais la liste partielle du démarrage,
 * qui ferait des « NOUVEAU » à tort à la visite suivante. Écouteurs posés une fois, à l'appel.
 */
export function startVisitBaseline(
  levels: () => VisitBaseline,
  lifecycle: PageLifecycle,
  stores: VisitStores = browserStores(),
): VisitBaselineSession {
  const baseline = beginVisitBaseline(stores);
  const record = (): void => recordVisitBaseline(levels(), stores);
  lifecycle.document.addEventListener('visibilitychange', () => {
    if (lifecycle.document.visibilityState === 'hidden') record();
  });
  lifecycle.window.addEventListener('pagehide', record);
  return { baseline, record };
}
