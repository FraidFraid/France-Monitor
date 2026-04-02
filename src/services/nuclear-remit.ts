/**
 * nuclear-remit.ts — Layer 2 : REMIT / UMM filtré pour le nucléaire
 *
 * Consomme l'état IIP RTE déjà fetchté (rte-iip.ts) et extrait
 * les signaux de production nucléaire avec matching plant name + classification.
 *
 * Temporalité : QUASI TEMPS RÉEL (hérite du cache rte-iip.ts ~12 min)
 * Aucun appel réseau propre.
 */

import type { NuclearRemitSignal } from '../types/index.ts';
import type { RTEIIPState } from './rte-iip.ts';
import { NUCLEAR_PLANTS } from '../config/infrastructure.ts';

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Filtre un RTEIIPState pour ne garder que les incidents nucléaires.
 * Chaque signal a confirmedByRTE = false (résolu dans nuclear-correlation.ts).
 */
export function extractNuclearRemitSignals(iipState: RTEIIPState): NuclearRemitSignal[] {
  const results: NuclearRemitSignal[] = [];

  for (const inc of iipState.incidents) {
    if (inc.type !== 'production') continue;

    const { plantName, matchConfidence } = matchPlant(inc.title + ' ' + inc.description);
    if (matchConfidence < 0.4) continue;

    const signal: NuclearRemitSignal = {
      id: inc.id,
      plantName,
      unitName: extractUnitName(inc.title),
      classifiedAs: classifyText(inc.title + ' ' + inc.description),
      capacityMW: inc.capacityMW,
      publishedAt: inc.publishedAt,
      title: inc.title,
      link: inc.link,
      confirmedByRTE: false,
      matchConfidence,
    };
    results.push(signal);
  }

  return results;
}

// ── Plant matching ────────────────────────────────────────────────────────────

function matchPlant(text: string): { plantName: string; matchConfidence: number } {
  const norm = normalizeText(text);

  // Exact match
  for (const plant of NUCLEAR_PLANTS) {
    if (plant.status === 'shutdown') continue;
    const plantNorm = normalizeText(plant.name);
    if (norm.includes(plantNorm)) {
      return { plantName: plant.name, matchConfidence: 1.0 };
    }
  }

  // Partial match: Levenshtein distance ≤ 2 sur les 6 premiers chars
  for (const plant of NUCLEAR_PLANTS) {
    if (plant.status === 'shutdown') continue;
    const plantNorm = normalizeText(plant.name);
    const prefix = plantNorm.slice(0, 6);
    // Find any word in the text that starts similarly
    const words = norm.split(/\s+/);
    for (const word of words) {
      if (word.length >= 4 && levenshtein(word.slice(0, 6), prefix) <= 2) {
        return { plantName: plant.name, matchConfidence: 0.7 };
      }
    }
  }

  return { plantName: '', matchConfidence: 0 };
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// ── Text classification ────────────────────────────────────────────────────────

function classifyText(text: string): NuclearRemitSignal['classifiedAs'] {
  const t = text.toLowerCase();
  if (/unplanned outage|avarie|arrêt fortuit|forced outage/.test(t)) return 'UNPLANNED_OUTAGE';
  if (/restart|remise en service|reconnection/.test(t)) return 'RESTART';
  if (/extension|prolongation/.test(t)) return 'EXTENSION';
  if (/maintenance|arrêt programmé|planned outage|révision/.test(t)) return 'PLANNED_MAINTENANCE';
  return 'OTHER';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractUnitName(title: string): string | null {
  // Ex: "GRAVELINES-3 unavailability" → "GRAVELINES-3"
  const m = title.match(/([A-Z][A-Z0-9\-]{3,}(?:-\d+)?)\b/);
  return m ? m[1] : null;
}

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}
