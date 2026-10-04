// api/_lib/cyber-collect.js : collecte serveur de la Vigilance cyber (spec 2026-10-04 souveraineté § 2.3, V3, V4 ; contrats § 2.4 ;
// amendement 7, O1, O3, O5, S12). Cinq parties, chacune à sa cadence et avec sa date : CERT-FR (flux d'alertes et d'avis, page liste
// des alertes et flux CTI toutes les heures ; éléments accumulés par référence, pages lues au plus 20 par cycle), catalogue KEV de la
// CISA (6 h), revendications ransomware.live (6 h), fuites HIBP en .fr (6 h, un compte et un lien seulement), Cybermalveillance.gouv.fr
// (1 h). Le statut officiel d'une alerte (« Alerte en cours », « Clôturée le … ») vient de la page liste, lue une fois par cycle,
// sinon de la clôture écrite sur la page de l'alerte ; il n'est jamais supposé « en cours ». Une partie en panne garde sa dernière
// valeur et nomme l'erreur (préfixe de la source). Le croisement CERT-FR et KEV est refait à chaque appel : une vulnérabilité est
// « citée par le CERT-FR » si son CVE figure dans une alerte ou un avis accumulé. Seules des valeurs de moins de 200 Ko vont au
// stockage clé-valeur (arbitrage 17).
import {
  ALERT_KEEP_DAYS, CERTFR_FEEDS, MAX_PAGES_PER_CYCLE, RECENT_DAYS, applyAlertList, applyPageRead, fetchAlertList, fetchCtiReports,
  itemDate, mergeCertFrItems, pageDue, parisDaysSince, parseCertFrFeed, parseCertFrPage, sortCertFr,
} from './certfr.js';
import { KEV_TTL_SEC, crossCertFr, kevAgeDays, kevWeeks, loadKev } from './cisa-kev.js';
import { CYBERMALVEILLANCE_TTL_SEC, loadCybermalveillance } from './cybermalveillance.js';
import { HIBP_TTL_SEC, loadHibp } from './hibp.js';
import { kvGetJson, kvSetJson } from './kv-history.js';
import { mapLimit } from './map-limit.js';
import { ensureRansomwareFresh } from './ransomware-live.js';
import { fetchStrictHtml, fetchStrictXml, sourceError } from './source-http.js';

export const CYBER_KEY = 'sov:cyber:last';
export const CERTFR_ITEMS_KEY = 'sov:certfr:items';
export const CERTFR_INTERVAL_MS = 60 * 60_000;
/** Aucun flux lu au dernier essai : nouvel essai 10 min plus tard, pas une heure. */
export const CERTFR_RETRY_MS = 10 * 60_000;
/** Pages restant à lire au cycle suivant (plus de 20 dues) : note d'avancement, jamais une panne. */
export const CERTFR_PAGES_NOTE = 'CERT-FR : lecture des pages en cours';
/** Échéance de la route atteinte pendant une collecte : collecte précédente servie avec cette note. */
export const CYBER_PENDING_NOTE = 'Vigilance cyber : collecte en cours';
const CERTFR_ITEMS_TTL_SEC = 100 * 86_400;
const CYBER_KEEP_SEC = 7 * 86_400;
const FEED_LABEL = { alerte: 'alertes', avis: 'avis' };
const CYBERM_FEED_LABEL = { alertes: 'alertes', actualites: 'actualités' };
const ALERT_LIST_LABEL = 'CERT-FR, liste des alertes';
const CTI_LABEL = 'CERT-FR, rapports Menaces et incidents';
const TICK_TOLERANCE_MS = 5_000;
/** Une valeur plus vieille que sa cadence plus une minute a été servie parce que la relecture a échoué. */
const STALE_MARGIN_MS = 60_000;
const NBSP = ' ';

function isRecord(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function isStale(readAt, ttlSec, now) {
  const t = Date.parse(readAt);
  return Number.isFinite(t) && now - t > ttlSec * 1000 + STALE_MARGIN_MS;
}

async function settle(work) {
  try {
    return { ok: true, value: await work };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * Lecture de la page d'un élément appliquée (A6, `applyPageRead`). Une alerte que ni la page liste de ce cycle ni sa propre page ne
 * disent close garde le statut déjà lu (liste en panne, alerte sortie de la première page de la liste) ; sans statut lu, elle reste
 * « non lu » (null), jamais « en cours ».
 */
function withPage(item, page, listEntry, now) {
  const next = applyPageRead(item, page, listEntry, now);
  if (next.kind === 'alerte' && next.status === null && item.status) return { ...next, status: item.status, closedAt: item.closedAt ?? null };
  return next;
}

/**
 * Flux, page liste, flux CTI, accumulation et pages du CERT-FR ; état gardé dans `sov:certfr:items` (environ 50 Ko). La page liste
 * est lue une seule fois par cycle : elle sert au statut de toutes les alertes et à celui des pages lues à ce cycle.
 */
async function refreshCertFr(now, record) {
  const [alerte, avis, list, cti] = await Promise.all([
    settle(fetchStrictXml(CERTFR_FEEDS.alerte, { timeoutMs: 15_000 }).then((xml) => parseCertFrFeed(xml, 'alerte'))),
    settle(fetchStrictXml(CERTFR_FEEDS.avis, { timeoutMs: 15_000 }).then((xml) => parseCertFrFeed(xml, 'avis'))),
    settle(fetchAlertList()),
    settle(fetchCtiReports()),
  ]);
  const errors = [];
  for (const [kind, part] of [['alerte', alerte], ['avis', avis]]) if (!part.ok) errors.push(sourceError(`CERT-FR, ${FEED_LABEL[kind]}`, part.error));
  if (!list.ok) errors.push(sourceError(ALERT_LIST_LABEL, list.error));
  if (!cti.ok) errors.push(sourceError(CTI_LABEL, cti.error));
  const read = [alerte, avis].filter((p) => p.ok).map((p) => p.value);
  let items = mergeCertFrItems(record?.items ?? [], read.flat(), now);
  if (list.ok) items = applyAlertList(items, list.value);
  const listByRef = new Map(list.ok ? list.value.map((e) => [e.ref, e]) : []);
  // Pages dues : alertes d'abord, puis avis, les plus récents d'abord ; 20 au plus par cycle, deux à la fois.
  const due = items.filter((i) => pageDue(i, now))
    .sort((a, b) => Number(a.kind === 'avis') - Number(b.kind === 'avis') || itemDate(b).localeCompare(itemDate(a)));
  const batch = due.slice(0, MAX_PAGES_PER_CYCLE);
  const results = await mapLimit(batch, 2, async (i) => parseCertFrPage(await fetchStrictHtml(i.url, { timeoutMs: 15_000 })));
  const pages = new Map();
  results.forEach((r, k) => {
    if (r.ok) pages.set(batch[k].ref, r.value);
    else errors.push(sourceError(`CERT-FR, page ${batch[k].ref}`, r.error));
  });
  items = sortCertFr(items.map((i) => {
    const page = pages.get(i.ref);
    return page ? withPage(i, page, listByRef.get(i.ref) ?? null, now) : i;
  }));
  if (due.length > batch.length) errors.push(CERTFR_PAGES_NOTE);
  const next = {
    items,
    reports: cti.ok ? cti.value : Array.isArray(record?.reports) ? record.reports : [],
    readAt: read.length > 0 ? new Date(now).toISOString() : record?.readAt ?? null,
    attemptedAt: now,
    ok: read.length > 0,
    errors,
  };
  await kvSetJson(CERTFR_ITEMS_KEY, next, CERTFR_ITEMS_TTL_SEC, now);
  return next;
}

/** Partie CERT-FR : relue si le dernier essai a une heure ou plus (10 min si aucun flux n'a été lu). */
async function certfrPart(now) {
  const stored = await kvGetJson(CERTFR_ITEMS_KEY, now);
  const record = isRecord(stored) && Array.isArray(stored.items) && Number.isFinite(stored.attemptedAt) ? stored : null;
  const wait = record?.ok === false ? CERTFR_RETRY_MS : CERTFR_INTERVAL_MS;
  if (record && now - record.attemptedAt < wait - TICK_TOLERANCE_MS) return record;
  return refreshCertFr(now, record);
}

/**
 * Élément accumulé vers CertFrItem : CVE de la page, sinon du résumé ; `kevCves` parmi eux (catalogue lu, sinon dernier croisement) ;
 * statut officiel, clôture et exploitation signalée tels que lus (null : non lus).
 */
function toCertFrItem(i, kevCves, previousKev) {
  const cves = Array.isArray(i.pageCves) ? i.pageCves : i.feedCves ?? [];
  const kev = kevCves ? cves.filter((c) => kevCves.has(c)) : (previousKev.get(i.ref) ?? []).filter((c) => cves.includes(c));
  return {
    ref: i.ref, kind: i.kind, title: i.title, product: i.product, updatedMark: i.updatedMark, url: i.url,
    firstVersion: i.firstVersion, lastVersion: i.lastVersion ?? null, cves, kevCves: kev, pageReadAt: i.pageReadAt ?? null,
    status: i.kind === 'alerte' ? i.status ?? null : null,
    closedAt: i.kind === 'alerte' ? i.closedAt ?? null : null,
    exploited: typeof i.exploited === 'boolean' ? i.exploited : null,
    exploitedQuote: typeof i.exploitedQuote === 'string' ? i.exploitedQuote : null,
  };
}

const EMPTY_KEV = { readAt: null, catalogVersion: null, dateReleased: null, count: null, recent: [], weeks: [] };

/** Réponse sans aucune partie lue (CyberResponse), erreurs nommées. */
export function emptyCyberBody(errors) {
  return {
    readAt: null, certfr: { readAt: null, alerts: [], avis: [], reports: [] }, kev: EMPTY_KEV, ransomware: null, hibp: null,
    cybermalveillance: null, errors,
  };
}

/**
 * Entrées Cybermalveillance datées seulement : une entrée sans date de publication lisible est écartée et signalée par flux
 * (« Cybermalveillance, alertes : 1 entrée sans date de publication lisible, écartée »), jamais servie sans date.
 */
function datedEntries(entries) {
  const undated = new Map();
  const kept = [];
  for (const e of entries) {
    if (typeof e.published === 'string' && Number.isFinite(Date.parse(e.published))) kept.push(e);
    else undated.set(e.feed, (undated.get(e.feed) ?? 0) + 1);
  }
  const errors = [...undated.entries()].map(([feed, n]) => (n === 1
    ? `Cybermalveillance, ${CYBERM_FEED_LABEL[feed] ?? feed} : 1${NBSP}entrée sans date de publication lisible, écartée`
    : `Cybermalveillance, ${CYBERM_FEED_LABEL[feed] ?? feed} : ${n}${NBSP}entrées sans date de publication lisible, écartées`));
  return { entries: kept, errors };
}

let lastSaved = '';

async function collectCyber(now) {
  const stored = await kvGetJson(CYBER_KEY, now);
  const prev = isRecord(stored) && isRecord(stored.certfr) ? stored : null;
  const [certfr, kev, ransom, hibp, cyberm] = await Promise.all([
    settle(certfrPart(now)), settle(loadKev(now)), settle(ensureRansomwareFresh(now)), settle(loadHibp(now)), settle(loadCybermalveillance(now)),
  ]);
  const errors = [];
  const certfrRecord = certfr.ok
    ? certfr.value
    : { items: [], reports: prev?.certfr.reports ?? [], readAt: null, errors: [sourceError('CERT-FR', certfr.error)] };
  errors.push(...certfrRecord.errors);

  let kevValue = null;
  if (kev.ok) {
    kevValue = kev.value;
    if (isStale(kevValue.readAt, KEV_TTL_SEC, now)) errors.push('CISA KEV : relevé précédent servi (lecture en échec)');
  } else {
    errors.push(sourceError('CISA KEV', kev.error));
  }
  const previousKev = new Map([...(prev?.certfr.alerts ?? []), ...(prev?.certfr.avis ?? [])].map((i) => [i.ref, i.kevCves ?? []]));
  const items = certfrRecord.items.map((i) => toCertFrItem(i, kevValue ? new Set(kevValue.cves) : null, previousKev));
  const alerts = sortCertFr(items.filter((i) => i.kind === 'alerte' && parisDaysSince(itemDate(i), now) < ALERT_KEEP_DAYS));
  const avis = sortCertFr(items.filter((i) => i.kind === 'avis' && parisDaysSince(itemDate(i), now) < RECENT_DAYS));
  let kevPart = prev?.kev ?? EMPTY_KEV;
  if (kevValue) {
    const crossed = crossCertFr(kevValue, items);
    kevPart = {
      readAt: kevValue.readAt, catalogVersion: kevValue.catalogVersion, dateReleased: kevValue.dateReleased, count: kevValue.count,
      recent: crossed.filter((k) => kevAgeDays(k.dateAdded, now) < RECENT_DAYS), weeks: kevWeeks(crossed, now),
    };
  }

  let ransomware = prev?.ransomware ?? null;
  if (ransom.ok) {
    ransomware = ransom.value.summary ?? ransomware;
    errors.push(...ransom.value.errors);
  } else {
    errors.push(sourceError('Ransomware.live', ransom.error));
  }

  // HIBP (O5) : un compte et un lien, fenêtre de 30 jours appliquée à la lecture (toutes les 6 h) ; aucun titre ni domaine.
  let hibpPart = prev?.hibp ?? null;
  if (hibp.ok) {
    const { readAt, count, newestAddedDate, url } = hibp.value;
    hibpPart = { readAt, count, newestAddedDate, url };
    if (isStale(readAt, HIBP_TTL_SEC, now)) errors.push('HIBP : relevé précédent servi (lecture en échec)');
  } else {
    errors.push(sourceError('HIBP', hibp.error));
  }

  let cybermPart = prev?.cybermalveillance ?? null;
  if (cyberm.ok) {
    if (cyberm.value.readAt !== null) {
      const dated = datedEntries(cyberm.value.entries);
      cybermPart = { readAt: cyberm.value.readAt, entries: dated.entries };
      errors.push(...dated.errors);
    }
    errors.push(...cyberm.value.errors);
    if (cyberm.value.readAt !== null && isStale(cyberm.value.readAt, CYBERMALVEILLANCE_TTL_SEC, now)) {
      errors.push('Cybermalveillance : relevé précédent servi (lecture en échec)');
    }
  } else {
    errors.push(sourceError('Cybermalveillance', cyberm.error));
  }

  const dates = [certfrRecord.readAt, kevPart.readAt, ransomware?.checkedAt ?? null, hibpPart?.readAt ?? null, cybermPart?.readAt ?? null]
    .filter((d) => typeof d === 'string').sort();
  const body = {
    readAt: dates.at(-1) ?? null,
    certfr: { readAt: certfrRecord.readAt, alerts, avis, reports: Array.isArray(certfrRecord.reports) ? certfrRecord.reports : [] },
    kev: kevPart,
    ransomware,
    hibp: hibpPart,
    cybermalveillance: cybermPart,
    errors: [...new Set(errors)],
  };
  // Écriture seulement après une vraie lecture d'une partie ou un changement d'erreurs (pas à chaque relève d'une minute).
  const signature = JSON.stringify([dates, body.errors]);
  if (signature !== lastSaved) {
    lastSaved = signature;
    await kvSetJson(CYBER_KEY, body, CYBER_KEEP_SEC, now);
  }
  return body;
}

let inflight = null;

/** Réservé aux tests : aucune collecte en cours, prochaine réponse écrite. */
export function __resetCyberForTests() {
  inflight = null;
  lastSaved = '';
}

/**
 * Collecte à jour (CyberResponse) ; chaque partie ne relit sa source que si elle est due. Une seule collecte à la fois ; ne lève
 * jamais (une erreur imprévue est nommée, la dernière réponse gardée est servie).
 * @param {number} [now]
 */
export function ensureCyberFresh(now = Date.now()) {
  inflight ??= collectCyber(now)
    .catch((err) => {
      console.error('[collecte cyber] collecte interrompue', err instanceof Error ? err.message : String(err));
      return storedCyber(now, sourceError('Collecte cyber interrompue', err));
    })
    .finally(() => { inflight = null; });
  return inflight;
}

/**
 * Dernière réponse gardée, sans attendre la collecte en cours (échéance de la route) : servie avec ses erreurs et `note`.
 * @param {number} now
 * @param {string} [note]
 */
export async function storedCyber(now, note) {
  const stored = await kvGetJson(CYBER_KEY, now);
  const extra = note ? [note] : [];
  if (!isRecord(stored) || !isRecord(stored.certfr)) return emptyCyberBody(extra);
  return {
    ...stored,
    certfr: { ...stored.certfr, reports: Array.isArray(stored.certfr.reports) ? stored.certfr.reports : [] },
    errors: [...new Set([...(Array.isArray(stored.errors) ? stored.errors : []), ...extra])],
  };
}
