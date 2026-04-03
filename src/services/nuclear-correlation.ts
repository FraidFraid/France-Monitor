/**
 * nuclear-correlation.ts — Layer 3 : Diff REMIT vs RTE + Score tension
 *
 * Croise les signaux REMIT nucléaires avec les indisponibilités RTE structurées.
 * Produit : UnconfirmedRemitSignal[], NuclearStressScore, NuclearState complet.
 *
 * Temporalité : calculé à chaque fetch (hérite du freshness le plus dégradé).
 */

import type {
  NuclearUnavailability,
  NuclearRemitSignal,
  UnconfirmedRemitSignal,
  NuclearStressScore,
  NuclearState,
  EnergyMix,
} from '../types/index.ts';
import type { RTEIIPState } from './rte-iip.ts';
import { NUCLEAR_PLANTS } from '../config/infrastructure.ts';
import { extractNuclearRemitSignals } from './nuclear-remit.ts';
import { invalidateNuclearRTECache } from './nuclear-rte.ts';
import type { NuclearRTEResult } from './nuclear-rte.ts';

// Re-export pour App.ts
export { invalidateNuclearRTECache };

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Construit l'état complet du module nucléaire.
 *
 * @param unavailabilities  Résultat de fetchNuclearUnavailabilities()
 * @param iipState          Résultat de fetchRTEIIPIncidents()
 * @param nationalMix       Mix national éCO2mix (optionnel, pour gridTensionRisk)
 */
export function buildNuclearState(
  rteResult: NuclearRTEResult,
  iipState: RTEIIPState,
  nationalMix?: Pick<EnergyMix, 'nuclear' | 'total'>,
): NuclearState {
  const { items: unavailabilities, available: rteAvailable } = rteResult;

  // IIP RSS (iip.cloud-rte-france.com) est une SPA Angular — le flux RSS n'est pas
  // accessible sans navigateur. On dérive les signaux REMIT directement depuis les
  // indisponibilités RTE structurées quand l'IIP est indisponible.
  let remitSignals: import('../types/index.ts').NuclearRemitSignal[];
  let remitAvailable: boolean;

  const iipSignals = extractNuclearRemitSignals(iipState);
  if (iipSignals.length > 0) {
    // IIP a fourni des données — les utiliser normalement
    remitSignals = iipSignals;
    remitAvailable = true;
  } else if (rteAvailable && unavailabilities.length > 0) {
    // Fallback : synthétiser les signaux REMIT depuis Layer 1
    // Chaque indisponibilité RTE est par définition une publication REMIT confirmée
    remitSignals = unavailabilities.map((u) => ({
      id: `rte-derived-${u.id}`,
      plantName: u.plantName,
      unitName: u.unitName,
      classifiedAs: u.type === 'UNPLANNED' ? 'UNPLANNED_OUTAGE' as const
        : u.type === 'PLANNED' ? 'PLANNED_MAINTENANCE' as const
        : 'OTHER' as const,
      capacityMW: u.nominalPowerMW - u.availablePowerMW,
      publishedAt: u.updatedAt,
      title: `${u.unitName} — ${u.type} (${u.nominalPowerMW - u.availablePowerMW} MW)`,
      link: '',
      confirmedByRTE: true,
      matchConfidence: 1.0,
    }));
    remitAvailable = true;
  } else {
    remitSignals = [];
    remitAvailable = iipState.available;
  }

  const { confirmed, unconfirmed } = correlate(remitSignals, unavailabilities);

  const enrichedRemit = remitSignals.map((s) => ({
    ...s,
    confirmedByRTE: s.confirmedByRTE || confirmed.has(s.id),
  }));

  const stress = buildStressScore(unavailabilities, nationalMix, rteAvailable);

  return {
    unavailabilities,
    remitSignals: enrichedRemit,
    unconfirmedSignals: unconfirmed,
    stress,
    rteAvailable,
    remitAvailable,
    fetchedAt: new Date(),
  };
}

// ── Correlation ───────────────────────────────────────────────────────────────

function correlate(
  remit: NuclearRemitSignal[],
  rte: NuclearUnavailability[],
): { confirmed: Set<string>; unconfirmed: UnconfirmedRemitSignal[] } {
  const confirmed  = new Set<string>();
  const unconfirmed: UnconfirmedRemitSignal[] = [];

  for (const signal of remit) {
    const match = rte.find((u) => {
      const sameOrSimilarPlant =
        normalizeText(u.plantName).includes(normalizeText(signal.plantName)) ||
        normalizeText(signal.plantName).includes(normalizeText(u.plantName));
      if (!sameOrSimilarPlant) return false;

      // Overlap temporel : le signal REMIT publishedAt doit être proche de la fenêtre RTE
      const pub  = signal.publishedAt.getTime();
      const start = u.startDate.getTime();
      const end   = u.endDate?.getTime() ?? Infinity;
      const WINDOW_MS = 48 * 60 * 60_000; // ±48h de tolérance
      return pub >= start - WINDOW_MS && pub <= end + WINDOW_MS;
    });

    if (match) {
      confirmed.add(signal.id);
    } else {
      unconfirmed.push({
        remitSignal: signal,
        reason: 'Aucune indisponibilité RTE correspondante',
        confidence: signal.matchConfidence,
      });
    }
  }

  return { confirmed, unconfirmed };
}

// ── Stress score ──────────────────────────────────────────────────────────────

function buildStressScore(
  unavailabilities: NuclearUnavailability[],
  nationalMix: Pick<EnergyMix, 'nuclear' | 'total'> | undefined,
  rteAvailable: boolean,
): NuclearStressScore {
  const now = Date.now();

  const installedCapacityMW = NUCLEAR_PLANTS
    .filter((p) => p.status !== 'shutdown')
    .reduce((sum, p) => sum + (p.capacity ?? 0), 0);

  // Capacité indisponible = somme des (nominal - available) pour les tranches actives
  const indispoMW = unavailabilities
    .filter((u) => u.startDate.getTime() <= now && (u.endDate === null || u.endDate.getTime() >= now))
    .reduce((sum, u) => sum + Math.max(0, u.nominalPowerMW - u.availablePowerMW), 0);

  const availableCapacityMW = Math.max(0, installedCapacityMW - indispoMW);
  const stressRatio = installedCapacityMW > 0
    ? (installedCapacityMW - availableCapacityMW) / installedCapacityMW
    : 0;

  const level: NuclearStressScore['level'] =
    stressRatio > 0.25 ? 'CRITIQUE'
    : stressRatio > 0.10 ? 'TENSION'
    : 'NORMAL';

  // heuristique produit v1 : nucléaire < 35% du mix national
  const gridTensionRisk =
    stressRatio > 0.10 &&
    nationalMix != null &&
    nationalMix.total > 0 &&
    nationalMix.nuclear < nationalMix.total * 0.35;

  const freshness: NuclearStressScore['freshness'] = !rteAvailable
    ? 'unavailable'
    : 'quasi-realtime'; // fetchedAt est évalué dans App.ts si stale

  return {
    installedCapacityMW,
    availableCapacityMW,
    stressRatio,
    level,
    gridTensionRisk,
    updatedAt: new Date(),
    freshness,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}
