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
export const SEVERITY_NAMES = ['info', 'low', 'medium', 'high', 'critical'];
const REASON_ORDER = ['declencheur_hors_titre', 'metaphore', 'passe', 'hypothetique', 'etranger', 'non_confirme'];
export const ACTIVE_MS = 12 * 60 * 60 * 1000;
export const CLOSED_MS = 48 * 60 * 60 * 1000;

function rankOf(severity) {
  return SEVERITY_RANK[severity] ?? 0;
}

/**
 * Gravité retenue d'un événement (spec 2026-09-28 § 4.5) : chaque groupe de presse compte une fois,
 * à sa gravité la plus élevée ; l'événement prend la 2ᵉ plus élevée (niveau atteint par au moins
 * 2 groupes indépendants). Un seul groupe : sa gravité, plafonnée à medium.
 * @param {Array<{ feedId: string, severity: string | null }>} articles
 * @returns {string}
 */
export function corroboratedSeverity(articles) {
  const byGroup = new Map();
  for (const a of articles) {
    const group = mediaGroupOf(a.feedId);
    const rank = rankOf(a.severity);
    if (!byGroup.has(group) || rank > byGroup.get(group)) byGroup.set(group, rank);
  }
  const ranks = [...byGroup.values()].sort((x, y) => y - x);
  if (ranks.length === 0) return 'info';
  const rank = ranks.length === 1 ? Math.min(ranks[0], SEVERITY_RANK.medium) : ranks[1];
  return SEVERITY_NAMES[rank];
}

/**
 * Qualification d'un événement : gravité signalée (pic des articles), zone, temporalité, motifs.
 * Zone et temporalité nulles quand aucun article n'est qualifié (articles antérieurs à kw-2).
 * @param {Array<{ severity: string | null, zone?: string | null, temporality?: string | null, reasons?: string[] }>} articles
 * @param {string} severity  gravité retenue (corroboratedSeverity)
 */
export function qualifyEvent(articles, severity) {
  let peak = 0;
  const zones = new Set();
  const times = new Set();
  const reasons = new Set();
  for (const a of articles) {
    peak = Math.max(peak, rankOf(a.severity));
    if (a.zone) zones.add(a.zone);
    if (a.temporality) times.add(a.temporality);
    for (const r of a.reasons ?? []) reasons.add(r);
  }
  if (peak > rankOf(severity)) reasons.add('non_confirme');
  const zone = zones.has('france') ? 'france' : zones.has('etranger') ? 'etranger' : zones.has('indeterminee') ? 'indeterminee' : null;
  const temporality = times.has('en_cours') ? 'en_cours' : times.has('a_venir') ? 'a_venir' : times.has('passe') ? 'passe' : null;
  return { peakSeverity: SEVERITY_NAMES[peak], zone, temporality, reasons: REASON_ORDER.filter((r) => reasons.has(r)) };
}

/**
 * @typedef {{ id: number, title: string, feedId: string, feedName: string | null, tier: number | null,
 *   publishedAt: number, category: string | null, severity: string | null, lat: number | null, lon: number | null,
 *   zone?: string | null, temporality?: string | null, reasons?: string[] }} MemberArticle
 * @typedef {{ title: string, category: string, severity: string, firstSeen: number, lastSeen: number,
 *   articleCount: number, sourceCount: number, independentCount: number, sourceNames: string[],
 *   lat: number | null, lon: number | null, peakSeverity: string, zone: string | null,
 *   temporality: string | null, reasons: string[] }} EventAggregate
 */

/**
 * Agrège les articles d'un événement. Titre représentatif : l'article du flux de meilleur rang
 * (tier le plus bas), puis le plus ancien. Catégorie : la plus fréquente hors « general ».
 * Gravité retenue : corroboratedSeverity ; qualification : qualifyEvent.
 * @param {MemberArticle[]} articles  au moins un article
 * @returns {EventAggregate}
 */
export function summarizeEvent(articles) {
  const sorted = [...articles].sort((a, b) => (a.tier ?? 9) - (b.tier ?? 9) || a.publishedAt - b.publishedAt || a.id - b.id);
  const representative = sorted[0];
  const categoryCounts = new Map();
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
  const severity = corroboratedSeverity(articles);
  return {
    title: decodeEntities(representative.title).replace(/\s+/g, ' ').trim(),
    category,
    severity,
    ...qualifyEvent(articles, severity),
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
