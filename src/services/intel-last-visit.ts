// src/services/intel-last-visit.ts — ancre du fil « depuis votre dernière visite ».
//
// localStorage garde l'heure de la dernière consultation de l'onglet Intelligence France ;
// sessionStorage fige l'ancre pour l'onglet courant (un rechargement ne la perd pas, et les
// rafraîchissements successifs comparent toujours au même point de départ).

import type { IntelVisitAnchor } from '../types/index.ts';

const LAST_SEEN_KEY = 'fm:intel:last-seen';
const ANCHOR_KEY = 'fm:intel:visit-anchor';
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

/** Ancre de l'onglet courant ; à la première ouverture, la calcule et enregistre la visite. */
export function beginIntelVisit(now = Date.now(), stores: VisitStores = browserStores()): IntelVisitAnchor {
  const existing = parseAnchor(read(stores.session, ANCHOR_KEY));
  if (existing) return existing;
  const anchor = resolveVisitAnchor(read(stores.local, LAST_SEEN_KEY), now);
  write(stores.session, ANCHOR_KEY, JSON.stringify(anchor));
  write(stores.local, LAST_SEEN_KEY, String(now));
  return anchor;
}

/** Note que l'utilisateur a vu l'état courant (rafraîchissement visible, fermeture du panneau). */
export function recordIntelVisitSeen(now = Date.now(), stores: VisitStores = browserStores()): void {
  write(stores.local, LAST_SEEN_KEY, String(now));
}
