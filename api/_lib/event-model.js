// api/_lib/event-model.js — agrégat d'un événement, statut et journal des changements (fonctions pures).

import { decodeEntities } from './event-clustering.js';

/**
 * Groupes de presse : des articles de titres d'un même groupe sont souvent la même dépêche
 * reprise (constaté : Le Progrès, Le Dauphiné, L'Est Républicain et DNA publient des titres
 * identiques). Ils ne comptent que pour une source indépendante. Un flux absent de cette
 * table forme son propre groupe.
 */
export const MEDIA_GROUPS = {
  'france-info': 'radio-france',
  'france-bleu': 'radio-france',
  rfi: 'france-medias-monde',
  'france-24-fr': 'france-medias-monde',
  'le-monde': 'groupe-le-monde',
  'courrier-international': 'groupe-le-monde',
  'l-obs': 'groupe-le-monde',
  'le-progres': 'ebra',
  'le-dauphine': 'ebra',
  'l-est-republicain': 'ebra',
  dna: 'ebra',
  'la-depeche': 'groupe-la-depeche',
  'midi-libre': 'groupe-la-depeche',
  'ouest-france': 'sipa-ouest-france',
  'actu-fr': 'sipa-ouest-france',
};

/** @param {string} feedId */
export function mediaGroupOf(feedId) {
  return MEDIA_GROUPS[feedId] ?? feedId;
}

export const SEVERITY_RANK = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
export const ACTIVE_MS = 12 * 60 * 60 * 1000;
export const CLOSED_MS = 48 * 60 * 60 * 1000;

function rankOf(severity) {
  return SEVERITY_RANK[severity] ?? 0;
}

/**
 * @typedef {{ id: number, title: string, feedId: string, feedName: string | null, tier: number | null,
 *   publishedAt: number, category: string | null, severity: string | null, lat: number | null, lon: number | null }} MemberArticle
 * @typedef {{ title: string, category: string, severity: string, firstSeen: number, lastSeen: number,
 *   articleCount: number, sourceCount: number, independentCount: number, sourceNames: string[],
 *   lat: number | null, lon: number | null }} EventAggregate
 */

/**
 * Agrège les articles d'un événement. Titre représentatif : l'article du flux de meilleur rang
 * (tier le plus bas), puis le plus ancien. Catégorie : la plus fréquente hors « general ».
 * Gravité : la plus élevée observée.
 * @param {MemberArticle[]} articles  au moins un article
 * @returns {EventAggregate}
 */
export function summarizeEvent(articles) {
  const sorted = [...articles].sort((a, b) => (a.tier ?? 9) - (b.tier ?? 9) || a.publishedAt - b.publishedAt || a.id - b.id);
  const representative = sorted[0];
  const categoryCounts = new Map();
  let severity = 'info';
  let firstSeen = Infinity;
  let lastSeen = -Infinity;
  const feeds = new Set();
  const groups = new Set();
  const names = [];
  let lat = null;
  let lon = null;
  // Parcours chronologique : sourceNames et coordonnées suivent l'ordre d'apparition,
  // quel que soit l'ordre des lignes renvoyées par la base.
  const chronological = [...articles].sort((a, b) => a.publishedAt - b.publishedAt || a.id - b.id);
  for (const a of chronological) {
    if (a.category && a.category !== 'general') categoryCounts.set(a.category, (categoryCounts.get(a.category) ?? 0) + 1);
    if (a.severity && rankOf(a.severity) > rankOf(severity)) severity = a.severity;
    firstSeen = Math.min(firstSeen, a.publishedAt);
    lastSeen = Math.max(lastSeen, a.publishedAt);
    if (!feeds.has(a.feedId)) {
      feeds.add(a.feedId);
      if (a.feedName) names.push(a.feedName);
    }
    groups.add(mediaGroupOf(a.feedId));
    if (lat === null && typeof a.lat === 'number' && typeof a.lon === 'number') { lat = a.lat; lon = a.lon; }
  }
  let category = 'general';
  let best = 0;
  for (const [c, n] of categoryCounts) if (n > best) { best = n; category = c; }
  return {
    title: decodeEntities(representative.title).replace(/\s+/g, ' ').trim(),
    category,
    severity,
    firstSeen,
    lastSeen,
    articleCount: articles.length,
    sourceCount: feeds.size,
    independentCount: groups.size,
    sourceNames: names.slice(0, 8),
    lat,
    lon,
  };
}

/**
 * @param {number} lastSeen  horodatage ms du dernier article
 * @param {number} now
 * @returns {'active' | 'cooling' | 'closed'}
 */
export function eventStatusAt(lastSeen, now) {
  const age = now - lastSeen;
  if (age < ACTIVE_MS) return 'active';
  if (age < CLOSED_MS) return 'cooling';
  return 'closed';
}

/**
 * Entrées du journal entre deux états d'un événement (before = null à la création).
 * @param {{ severity: string, independentCount: number, status: string } | null} before
 * @param {{ severity: string, independentCount: number, status: string }} after
 * @returns {Array<{ kind: 'created' | 'escalated' | 'deescalated' | 'corroborated' | 'cooling' | 'closed' | 'reopened', from: string | null, to: string | null }>}
 */
export function diffEvent(before, after) {
  if (!before) return [{ kind: 'created', from: null, to: after.severity }];
  const out = [];
  const delta = rankOf(after.severity) - rankOf(before.severity);
  if (delta > 0) out.push({ kind: 'escalated', from: before.severity, to: after.severity });
  if (delta < 0) out.push({ kind: 'deescalated', from: before.severity, to: after.severity });
  if (after.independentCount > before.independentCount) {
    out.push({ kind: 'corroborated', from: String(before.independentCount), to: String(after.independentCount) });
  }
  if (before.status !== after.status) {
    if (after.status === 'active') out.push({ kind: 'reopened', from: before.status, to: after.status });
    else out.push({ kind: after.status === 'cooling' ? 'cooling' : 'closed', from: before.status, to: after.status });
  }
  return out;
}
