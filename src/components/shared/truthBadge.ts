/**
 * truthBadge.ts — Pastille de fraîcheur des données (source unique).
 *
 * Avant ce helper, `renderTruthBadge()` était dupliqué dans ~11 panels et
 * plusieurs affichaient `TEMPS RÉEL` EN DUR même quand la donnée était vieille
 * ou en cache — un mensonge UI. Ce module centralise :
 *
 *  - `renderTruthBadge(label, color)` : le markup brut de la pastille (inchangé,
 *    même CSS inline que les copies locales historiques).
 *  - `renderFreshnessBadge(sourceIds, fallback?)` : calcule l'état RÉEL de
 *    fraîcheur à partir du registre `Watchdog` et rend la pastille honnête.
 *
 * Le calcul se fait au moment du rendu : il suffit qu'un panel appelle
 * `renderFreshnessBadge()` à chaque re-render pour que la pastille reste à jour.
 */

import { Watchdog } from '../../services/watchdog.ts';
import type { DataSourceStatus } from '../../types/index.ts';

// ─── Couleurs des états (identiques aux badges historiques) ───
const COLOR_OK = '#10B981';       // vert — donnée fraîche
const COLOR_STALE = '#F59E0B';    // orange — donnée en cache / différée
const COLOR_ERROR = '#EF4444';    // rouge — indisponible, aucune donnée
const COLOR_LOADING = '#6B7280';  // gris — chargement, pas encore de succès

/** Seuil de bascule en « différé » pour le mode fallback (sans Watchdog). */
const FALLBACK_STALE_MS = 10 * 60_000;

/**
 * Rend la pastille (pill) standard. Markup et CSS inline strictement identiques
 * à la fonction locale historiquement dupliquée dans les panels.
 */
export function renderTruthBadge(label: string, color: string): string {
  return `<span style="display:inline-flex;align-items:center;justify-content:center;padding:2px 8px;border-radius:999px;background:${color}22;border:1px solid ${color}33;color:${color};font-size:9px;font-weight:700;letter-spacing:0.06em;">${label}</span>`;
}

type FreshnessStatus = 'ok' | 'stale' | 'error' | 'loading';

// Ordre de gravité : on affiche toujours le PIRE état parmi les sources.
const STATUS_RANK: Record<FreshnessStatus, number> = {
  ok: 0,
  loading: 1,
  stale: 2,
  error: 3,
};

/** Formate un âge en libellé court MAJUSCULE (« IL Y A 12MIN » / « IL Y A 2H »). */
function formatAge(ageMs: number): string {
  const minutes = Math.max(1, Math.round(ageMs / 60_000));
  if (minutes < 60) return `IL Y A ${minutes}MIN`;
  const hours = Math.round(minutes / 60);
  return `IL Y A ${hours}H`;
}

/**
 * État de fraîcheur effectif d'une source au moment du rendu.
 *
 * On fait confiance au `status` calculé par le Watchdog : il applique déjà le
 * `staleAfterMs` propre à chaque source (ex. 60 min pour FIRMS, 5 min pour la
 * SNCF), et le re-évalue toutes les 30 s. On ne dérive ici que l'âge, pour le
 * libellé « il y a Xmin » des états différés.
 */
function effectiveStatus(s: DataSourceStatus): { status: FreshnessStatus; ageMs: number | null } {
  const lastSuccessMs = s.lastSuccess ? s.lastSuccess.getTime() : null;
  const ageMs = lastSuccessMs !== null
    ? Date.now() - lastSuccessMs
    : (s.cacheAgeMs ?? null);
  return { status: s.status, ageMs };
}

/**
 * Rend une pastille de fraîcheur honnête.
 *
 * @param sourceIds  IDs de sources enregistrées au Watchdog. On prend le PIRE
 *                   statut parmi celles réellement enregistrées.
 * @param fallback   Utilisé si AUCUN des sourceIds n'est enregistré : dernier
 *                   chargement réussi connu du panel (timestamp ms), seuil
 *                   « différé » de 10 min.
 */
export function renderFreshnessBadge(
  sourceIds: string[],
  fallback?: { lastUpdated: number | null },
): string {
  const statuses: DataSourceStatus[] = [];
  for (const id of sourceIds) {
    const s = Watchdog.getSourceStatus(id);
    if (s) statuses.push(s);
  }

  // ── Aucune source enregistrée : mode fallback sur le timestamp du panel ──
  if (statuses.length === 0) {
    const lastUpdated = fallback?.lastUpdated ?? null;
    if (lastUpdated === null) {
      return renderTruthBadge('CHARGEMENT', COLOR_LOADING);
    }
    const ageMs = Date.now() - lastUpdated;
    if (ageMs > FALLBACK_STALE_MS) {
      return renderTruthBadge(`DIFFÉRÉ · ${formatAge(ageMs)}`, COLOR_STALE);
    }
    return renderTruthBadge('TEMPS RÉEL', COLOR_OK);
  }

  // ── Pire état parmi les sources enregistrées ──
  let worstStatus: FreshnessStatus = 'ok';
  let worstRank = -1;
  let worstAgeMs: number | null = null;

  for (const s of statuses) {
    const { status, ageMs } = effectiveStatus(s);
    const rank = STATUS_RANK[status];
    if (rank > worstRank) {
      worstRank = rank;
      worstStatus = status;
      worstAgeMs = ageMs;
    } else if (rank === worstRank && ageMs !== null && (worstAgeMs === null || ageMs > worstAgeMs)) {
      // Même gravité : on garde l'âge le plus ancien pour l'affichage « différé ».
      worstAgeMs = ageMs;
    }
  }

  switch (worstStatus) {
    case 'ok':
      return renderTruthBadge('TEMPS RÉEL', COLOR_OK);
    case 'stale':
      return renderTruthBadge(
        worstAgeMs !== null ? `DIFFÉRÉ · ${formatAge(worstAgeMs)}` : 'DIFFÉRÉ',
        COLOR_STALE,
      );
    case 'error':
      return renderTruthBadge('INDISPONIBLE', COLOR_ERROR);
    case 'loading':
    default:
      return renderTruthBadge('CHARGEMENT', COLOR_LOADING);
  }
}
