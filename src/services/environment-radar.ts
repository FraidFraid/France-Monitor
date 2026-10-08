// src/services/environment-radar.ts : état du panneau Radar météo (spec 2026-10-04 environnement § 2.3 ; contrats § 3.3). Réutilise
// la lecture du manifeste (radar-2d.ts) et de la colonne (radar-column.ts) ; ajoute le statut daté du panneau des sources et l'état
// du profil vertical en un point (démonstration).
import type { RadarColumnResult } from '../types/index.ts';
import { absoluteTime } from '../components/fiche/kit.ts';
import { isEnvironmentDataLate } from './environment-levels.ts';
import type { EnvironmentStatus } from './environment-source.ts';
import type { Radar2dResult } from './radar-2d.ts';

/** Point cliqué sur la carte (couche Radar active) et son profil : en cours, en échec, ou rendu (hors couverture compris). */
export interface RadarProfileState { lat: number; lon: number; result: RadarColumnResult | 'loading' | 'error' }

/**
 * Panneau des sources : « Radar Météo-France », daté par l'heure d'observation de la dernière image (S1) ; « (en retard) » au-delà de
 * 15 min ; worker non configuré : « error », « worker radar non configuré » ; manifeste dégradé (dernière image gardée) : « stale ».
 */
export function radarStatus(result: Radar2dResult | null, error: string | null, now: number): EnvironmentStatus {
  if (result === null) return { status: error !== null ? 'error' : 'loading', lastUpdate: null, period: undefined, error: error ?? undefined };
  if (!result.configured) return { status: 'error', lastUpdate: null, period: undefined, error: 'worker radar non configuré' };
  const ms = Date.parse(result.manifest.observedAt);
  const late = isEnvironmentDataLate('radar', result.manifest.observedAt, now);
  const problems = [...(error !== null ? [error] : []), ...(result.degraded ? ['dernière image gardée (lecture en échec)'] : [])];
  return {
    status: late || problems.length > 0 ? 'stale' : 'ok',
    lastUpdate: Number.isFinite(ms) ? new Date(ms) : null,
    period: Number.isFinite(ms) ? `${absoluteTime(ms, now, 'fr')}${late ? ' (en retard)' : ''}` : 'n.d.',
    error: problems.length > 0 ? problems.join(' ; ') : undefined,
  };
}
