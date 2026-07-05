/**
 * situation-brief.ts — Sélection PURE des convergences d'ouverture (24 h).
 *
 * Entrée  : situations ACTIVES (moteur) + situations des dernières 24 h résolues.
 * Sortie  : au plus 3 BriefItem, priorité aux situations actives (sévérité puis
 *           ancienneté), complétées par les résolues récentes s'il reste de la place.
 *
 * Aucune dépendance au DOM ni au réseau : fonction déterministe, `now` injecté.
 */

import type { HistorySlot, SituationSeverity, SituationType } from '../types/index.ts';

// ─── Constantes ────────────────────────────────────────────────────────────────

/** Nombre maximum d'items affichés dans la synthèse d'ouverture. */
export const BRIEF_MAX_ITEMS = 3;

/** Fenêtre par défaut pour les convergences récemment résolues. */
export const BRIEF_WINDOW_MS = 24 * 60 * 60 * 1000;

const SITUATION_TYPES = new Set<SituationType>([
  'ENERGY_STRESS', 'IMPORT_DEPENDENCY_RISK', 'FLOOD_CRISIS', 'WILDFIRE_ESCALATION',
  'CYBER_PRESSURE', 'SOCIAL_ESCALATION', 'TELECOM_DISRUPTION', 'MARITIME_ANOMALY',
  'DEFENSE_SIGNAL_ELEVATED', 'FUEL_SUPPLY_RISK', 'NEWS_ALERT', 'MILITARY_SURGE_ALERT',
  'WEATHER_ALERT', 'AIS_ANOMALY_ALERT', 'DEFENSE_ALERT', 'GPS_JAMMING_ALERT',
]);

/** Normalise un `type` sérialisé (string) vers le type fermé, avec repli sûr. */
function asSituationType(value: string): SituationType {
  return SITUATION_TYPES.has(value as SituationType) ? (value as SituationType) : 'NEWS_ALERT';
}

const SEVERITY_ORDER: Record<SituationSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  watch: 1,
};

const SEVERITY_LABEL_FR: Record<SituationSeverity, string> = {
  critical: 'Critique',
  high: 'Élevé',
  medium: 'Moyen',
  watch: 'Veille',
};

// ─── Types ─────────────────────────────────────────────────────────────────────

/**
 * Forme minimale attendue par la synthèse, commune aux situations actives
 * (issues du moteur) et aux situations résolues (reconstruites depuis l'historique).
 */
export interface BriefSourceSituation {
  id: string;
  type: SituationType;
  severity: SituationSeverity;
  title: string;
  affectedZones: string[];
  /** epoch ms — début observé (active) ou dernière observation (résolue). */
  since: number;
  lat?: number;
  lon?: number;
}

export interface BriefItem {
  id: string;
  type: SituationType;
  title: string;
  severity: SituationSeverity;
  /** Libellé de sévérité en français. */
  severityLabel: string;
  zone?: string;
  /** "depuis 2 h" (active) ou "il y a 40 min" (résolue). */
  sinceLabel: string;
  resolved: boolean;
  lat?: number;
  lon?: number;
}

// ─── Formatage temporel ──────────────────────────────────────────────────────────

/**
 * Formate un délai en libellé français relatif.
 * `resolved` choisit le préfixe : "depuis" (en cours) vs "il y a" (résolu).
 */
export function formatSinceLabel(deltaMs: number, resolved: boolean): string {
  const prefix = resolved ? 'il y a' : 'depuis';
  const minutes = Math.floor(Math.max(0, deltaMs) / 60_000);

  if (minutes < 1) return 'à l’instant';
  if (minutes < 60) return `${prefix} ${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${prefix} ${hours} h`;

  const days = Math.floor(hours / 24);
  return `${prefix} ${days} j`;
}

// ─── Sélection ─────────────────────────────────────────────────────────────────

function toBriefItem(source: BriefSourceSituation, now: number, resolved: boolean): BriefItem {
  const item: BriefItem = {
    id: source.id,
    type: source.type,
    title: source.title,
    severity: source.severity,
    severityLabel: SEVERITY_LABEL_FR[source.severity],
    sinceLabel: formatSinceLabel(now - source.since, resolved),
    resolved,
  };
  const zone = source.affectedZones[0];
  if (zone) item.zone = zone;
  if (source.lat != null) item.lat = source.lat;
  if (source.lon != null) item.lon = source.lon;
  return item;
}

/**
 * Sélectionne au maximum {@link BRIEF_MAX_ITEMS} convergences pour l'ouverture.
 *
 * 1. Situations ACTIVES triées par sévérité décroissante puis ancienneté (les plus
 *    anciennes d'abord — une situation qui dure est plus significative).
 * 2. S'il reste des places, complète avec les situations des 24 h résolues récemment
 *    (marquées `resolved: true`), triées de la plus récemment résolue à la plus ancienne.
 * 3. Dédoublonnage par `id` : une situation active n'est jamais reprise comme résolue.
 */
export function selectBriefItems(
  active: BriefSourceSituation[],
  recent24h: BriefSourceSituation[],
  now: number,
): BriefItem[] {
  const sortedActive = [...active].sort((a, b) => {
    const bySeverity = SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity];
    if (bySeverity !== 0) return bySeverity;
    return a.since - b.since;
  });

  const seen = new Set<string>();
  const items: BriefItem[] = [];

  for (const situation of sortedActive) {
    if (items.length >= BRIEF_MAX_ITEMS) break;
    if (seen.has(situation.id)) continue;
    seen.add(situation.id);
    items.push(toBriefItem(situation, now, false));
  }

  if (items.length < BRIEF_MAX_ITEMS) {
    const sortedResolved = [...recent24h].sort((a, b) => b.since - a.since);
    for (const situation of sortedResolved) {
      if (items.length >= BRIEF_MAX_ITEMS) break;
      if (seen.has(situation.id)) continue;
      seen.add(situation.id);
      items.push(toBriefItem(situation, now, true));
    }
  }

  return items;
}

// ─── Reconstruction depuis l'historique ──────────────────────────────────────────

/**
 * Reconstruit les situations vues dans la fenêtre 24 h à partir des créneaux
 * d'historique. Chaque situation est ramenée à sa dernière observation (`since` =
 * `capturedAt` du créneau le plus récent où elle apparaît). Les créneaux manquants
 * et hors fenêtre sont ignorés. Le filtrage "encore active" est laissé à
 * {@link selectBriefItems} (dédoublonnage par id).
 */
export function resolvedSituationsFromHistory(
  slots: readonly HistorySlot[],
  now: number,
  windowMs: number = BRIEF_WINDOW_MS,
): BriefSourceSituation[] {
  const byId = new Map<string, BriefSourceSituation>();

  for (const slot of slots) {
    if ('status' in slot) continue; // créneau manquant

    const seenAt = Date.parse(slot.capturedAt);
    if (!Number.isFinite(seenAt) || seenAt > now || now - seenAt > windowMs) continue;

    for (const s of slot.situations) {
      const existing = byId.get(s.id);
      if (existing && existing.since >= seenAt) continue; // garder l'observation la plus récente
      byId.set(s.id, {
        id: s.id,
        type: asSituationType(s.type),
        severity: s.severity,
        title: s.title,
        affectedZones: s.affectedZones,
        since: seenAt,
      });
    }
  }

  return [...byId.values()];
}
