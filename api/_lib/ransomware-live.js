// api/_lib/ransomware-live.js : revendications de rançongiciels en France (spec 2026-10-04 souveraineté § 2.3, V3 ; contrats § 2.4,
// arbitrages 15 et 17). Fichiers ouverts de ransomware.live (usage non commercial, administrations comprises ; attribution obligatoire
// « Source : Ransomware.live » avec lien ; interdits : republier les lignes brutes, relire plus souvent que toutes les 30 min).
// `victims.json` (21 Mo) est relu toutes les 6 h avec If-Modified-Since, réduit en mémoire du processus à des comptes (semaines,
// secteurs, groupes) : aucun nom, site ni lien de victime n'en sort, ni dans la réponse, ni dans le stockage clé-valeur. Une
// revendication n'est pas un fait : la vue dit « revendiqué par le groupe, non confirmé ». Date de référence : `discovered`.
import { kvGetJson, kvSetJson } from './kv-history.js';
import { fetchStrictResponse, sourceError } from './source-http.js';

export const VICTIMS_URL = 'https://data.ransomware.live/victims.json';
export const RANSOM_KEY = 'sov:ransom:summary';
/** Relecture toutes les 6 h ; après un échec, nouvel essai 30 min plus tard (plancher des conditions de ransomware.live). */
export const RANSOM_INTERVAL_MS = 6 * 3_600_000;
export const RANSOM_FLOOR_MS = 30 * 60_000;
export const RANSOM_TIMEOUT_MS = 60_000;
/**
 * Plafond de lecture de `victims.json` (revue finale M6) : 21 Mo le 04/10/2026, le fichier grossit chaque année ; au-delà de 64 Mo,
 * panne nommée (« réponse trop volumineuse (plus de 64 Mo) ») et résumé précédent gardé, jamais un processus saturé.
 */
export const RANSOM_MAX_BYTES = 64 * 1024 * 1024;
const RANSOM_KEEP_SEC = 7 * 86_400;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const WEEKS = 12;
const BASELINE_DAYS = 90;
const TICK_TOLERANCE_MS = 5_000;

function round2(v) {
  return Math.round(v * 100) / 100;
}

function shares(list) {
  const counts = new Map();
  for (const label of list) counts.set(label, (counts.get(label) ?? 0) + 1);
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr', { sensitivity: 'base' }));
}

/**
 * Résumé des revendications en France (RansomwareSummary sans `lastModified`) à l'instant `checkedAt` (arbitrage 15) : 12 semaines de
 * 7 × 24 h finissant à `checkedAt` (plus ancienne d'abord) ; moyenne hebdomadaire des 90 jours qui précèdent la dernière semaine
 * (divisés par 90/7) et rapport de la semaine à cette moyenne ; 30 derniers jours contre la moyenne sur 30 jours des 90 jours qui
 * les précèdent ; secteurs et groupes sur 30 jours, tels que publiés. « Sans historique » (null) : le fichier n'a aucune ligne plus
 * ancienne que le début de la période comparée. Seuls `country`, `discovered`, `activity` et `group_name` sont lus.
 * @param {unknown[]} rows
 * @param {string} checkedAt
 */
export function summarizeVictims(rows, checkedAt) {
  const end = Date.parse(checkedAt);
  const fr = [];
  let oldest = Number.POSITIVE_INFINITY;
  for (const r of Array.isArray(rows) ? rows : []) {
    const t = Date.parse(r?.discovered);
    if (!Number.isFinite(t)) continue;
    oldest = Math.min(oldest, t);
    if (r.country !== 'FR' || t > end) continue;
    const sector = typeof r.activity === 'string' && r.activity.trim() ? r.activity.trim() : 'Not Found';
    const group = typeof r.group_name === 'string' && r.group_name.trim() ? r.group_name.trim() : 'n.d.';
    fr.push({ t, sector, group });
  }
  const between = (start, stop) => fr.filter((v) => v.t > start && v.t <= stop);
  const weeks = [];
  for (let k = WEEKS; k >= 1; k -= 1) {
    const start = end - k * WEEK_MS;
    weeks.push({ weekStart: new Date(start).toISOString(), count: between(start, start + WEEK_MS).length });
  }
  const weekStart = end - WEEK_MS;
  const weekCount = between(weekStart, end).length;
  const weeklyExact = oldest <= weekStart ? between(weekStart - BASELINE_DAYS * DAY_MS, weekStart).length / (BASELINE_DAYS / 7) : null;
  const l30Start = end - 30 * DAY_MS;
  const last30 = between(l30Start, end);
  const baseline30 = oldest <= l30Start ? round2(between(l30Start - BASELINE_DAYS * DAY_MS, l30Start).length / (BASELINE_DAYS / 30)) : null;
  return {
    lastModified: null,
    checkedAt,
    weeks,
    weekCount,
    baselineWeekly: weeklyExact === null ? null : round2(weeklyExact),
    ratio: weeklyExact ? round2(weekCount / weeklyExact) : null,
    last30: last30.length,
    baseline30,
    sectors30: shares(last30.map((v) => v.sector)),
    groups30: shares(last30.map((v) => v.group)),
  };
}

function isRecord(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

async function save(record, now) {
  await kvSetJson(RANSOM_KEY, record, RANSOM_KEEP_SEC, now);
}

async function refreshRansomware(now, record) {
  const prev = record?.summary ?? null;
  const headers = prev?.lastModified ? { 'If-Modified-Since': new Date(prev.lastModified).toUTCString() } : {};
  try {
    const resp = await fetchStrictResponse(VICTIMS_URL, { expect: 'json', timeoutMs: RANSOM_TIMEOUT_MS, headers, maxBytes: RANSOM_MAX_BYTES });
    let rows;
    try {
      rows = JSON.parse(resp.text);
    } catch {
      throw new Error('JSON illisible');
    }
    if (!Array.isArray(rows)) throw new Error('liste des revendications illisible');
    const header = resp.header('last-modified');
    const lastModified = header && Number.isFinite(Date.parse(header)) ? new Date(Date.parse(header)).toISOString() : null;
    const summary = { ...summarizeVictims(rows, new Date(now).toISOString()), lastModified };
    await save({ summary, attemptedAt: now, ok: true, errors: [] }, now);
    return { summary, errors: [] };
  } catch (err) {
    // 304 : fichier inchangé depuis la dernière lecture complète, jamais une panne. Le résumé reste ancré sur cette lecture (ses
    // semaines portent leur date de début) ; seule la date de la dernière lecture réussie avance.
    if (err && typeof err === 'object' && err.status === 304 && prev) {
      const summary = { ...prev, checkedAt: new Date(now).toISOString() };
      await save({ summary, attemptedAt: now, ok: true, errors: [] }, now);
      return { summary, errors: [] };
    }
    const errors = [sourceError('Ransomware.live', err)];
    await save({ summary: prev, attemptedAt: now, ok: false, errors }, now);
    return { summary: prev, errors };
  }
}

let inflight = null;

/** Réservé aux tests : aucune lecture en cours. */
export function __resetRansomwareForTests() {
  inflight = null;
}

/**
 * Résumé à jour (`{ summary: RansomwareSummary | null, errors }`) : relu toutes les 6 h, 30 min après un échec ; If-Modified-Since
 * avec la date du fichier lu ; une panne garde le dernier résumé et nomme l'erreur. Résumé gardé 7 jours dans le stockage clé-valeur.
 * @param {number} [now]
 */
export async function ensureRansomwareFresh(now = Date.now()) {
  const stored = await kvGetJson(RANSOM_KEY, now);
  const record = isRecord(stored) && Number.isFinite(stored.attemptedAt) ? stored : null;
  const wait = record ? (record.ok ? RANSOM_INTERVAL_MS : RANSOM_FLOOR_MS) : 0;
  if (record && now - record.attemptedAt < wait - TICK_TOLERANCE_MS) {
    return { summary: record.summary ?? null, errors: Array.isArray(record.errors) ? record.errors : [] };
  }
  inflight ??= refreshRansomware(now, record).finally(() => { inflight = null; });
  return inflight;
}
