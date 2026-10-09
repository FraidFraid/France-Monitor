// api/_lib/outages-power.js : collecteur du panneau Électricité (spec 2026-10-08 panneaux pannes § 2.2 ; faits § 2 à 4). EDF OpenData
// (indisponibilités de production, version en vigueur, chroniques de réserve et unités belges écartées), RTE IIP (messages REMIT de
// production et de transport, version la plus haute, annulés écartés), EDF SEI (signal horaire de La Réunion et de la Corse). Une unité
// présente chez EDF et dans l'IIP est gardée d'après EDF (arbitrage 4) ; un même arrêt publié en plusieurs lignes est compté une fois (P3).
// Chaque partie a sa cadence : IIP 10 min, EDF 15 min, SEI 30 min, d'après l'heure de sa dernière lecture RÉUSSIE ; une partie en échec
// garde ses dernières données, nomme son erreur et est retentée après 5 min. Dernier relevé gardé en KV, servi daté.
import { kvGetJson, kvSetJson } from './kv-history.js';
import { failed, partDue, succeeded } from './outages-parts.js';
import { iipDispatcher } from './rte-iip-agent.js';
import { decodeEntities, fetchStrictJson, fetchStrictXml, sourceError } from './source-http.js';

const EDF_BASE = 'https://opendata.edf.fr/data-fair/api/v1/datasets';
export const EDF_DATASET = `${EDF_BASE}/indisponibilites-des-moyens-de-production-edf-sa`;
export const IIP_PRODUCTION_URL = 'https://iip.cloud-rte-france.com/data/rss/production_unavailability/production_unavailability.xml';
export const IIP_TRANSMISSION_URL = 'https://iip.cloud-rte-france.com/data/rss/transmission_unavailability/transmission_unavailability.xml';
export const SEI_DATASETS = [{ zone: 'reunion', id: 'meteo-reseau-reunion' }, { zone: 'corse', id: 'ecorsicawatt' }];
/** Unités de Luminus en Belgique : le jeu EDF couvre « France métropolitaine + Belgique » (faits § 2). */
export const EDF_BELGIAN_UNITS = ['SERAING TG1', 'SERAING TG2', 'SERAING TV', 'Seraing CCGT-GT', 'Seraing CCGT-ST', 'RINGVAART STEG', 'NOBELWIND', 'BESS Navagne'];
export const POWER_LAST_KEY = 'out:power:last';
export const POWER_PENDING_NOTE = 'Électricité : collecte en cours';
const IIP_INTERVAL_MS = 10 * 60_000;
const EDF_INTERVAL_MS = 15 * 60_000;
const SEI_INTERVAL_MS = 30 * 60_000;
const DAY_MS = 86_400_000;
const LAST_TTL_SEC = 3 * 86_400;
const EDF_FIELDS = 'identifiant,numero_de_version,nom,filiere,type,cause,status,date_de_debut,date_de_fin,date_de_publication,puissance_maximale_mw,puissance_disponible_mw';
const FUEL_FR = {
  Nuclear: 'Nucléaire', 'Hydro Water Reservoir': 'Réservoir hydraulique', 'Hydro Pumped Storage': 'Station de transfert d’énergie par pompage hydraulique',
  'Hydro Run-of-river and poundage': 'Fil de l’eau et éclusé hydraulique', 'Fossil Gas': 'Gaz fossile', 'Fossil Hard coal': 'Houille fossile',
  'Fossil Oil': 'Fuel / TAC', 'Wind Offshore': 'Éolien en mer', Biomass: 'Biomasse',
};
const REASON_FR = { Failure: 'Défaillance', 'Foreseen Maintenance': 'Maintenance prévisionnelle', 'Complementary Information': 'Information complémentaire' };
const COUNTRY_FR = { FR: 'France', UK: 'Royaume-Uni', GB: 'Royaume-Uni', IT: 'Italie', ES: 'Espagne', BE: 'Belgique', DE: 'Allemagne', CH: 'Suisse' };

let queue = Promise.resolve();

/** Réservé aux tests : file libre. */
export function __resetPowerForTests() {
  queue = Promise.resolve();
}

const iso = (v) => { const t = Date.parse(String(v ?? '')); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : null);

/** Lignes EDF en vigueur (Active) qui recouvrent la fenêtre [from, to] (filtres DataFair ; `qs` avec « > » répond 400). */
export function edfLinesUrl({ from, to }) {
  const p = new URLSearchParams({ select: EDF_FIELDS, status_eq: 'Active', date_de_fin_gte: from, date_de_debut_lte: to, size: '1000', sort: 'date_de_debut' });
  return `${EDF_DATASET}/lines?${p.toString()}`;
}

/** Arrêts imprévus des 30 derniers jours (courbe). */
export function edfHistoryUrl(fromIso) {
  const p = new URLSearchParams({ select: EDF_FIELDS, status_eq: 'Active', type_in: 'Fortuite,Fortuite (pompe)', date_de_fin_gte: fromIso, size: '1000', sort: 'date_de_debut' });
  return `${EDF_DATASET}/lines?${p.toString()}`;
}

/** Ligne EDF → PowerUnitOutage ; null pour une chronique de réserve, une unité belge ou une ligne illisible. */
export function normalizeEdfLine(line) {
  if (!line || typeof line !== 'object') return null;
  const type = String(line.type ?? '');
  if (!type.startsWith('Fortuite') && !type.startsWith('Planifiée')) return null;
  const name = String(line.nom ?? '').trim();
  if (!name || EDF_BELGIAN_UNITS.includes(name)) return null;
  const start = iso(line.date_de_debut);
  const max = num(line.puissance_maximale_mw);
  const available = num(line.puissance_disponible_mw);
  if (start === null || max === null || available === null) return null;
  const sector = String(line.filiere ?? '').trim() || 'Filière non précisée';
  return {
    id: String(line.identifiant ?? name), name, sector, nuclear: sector === 'Nucléaire',
    kind: type.startsWith('Fortuite') ? 'imprevue' : 'planifiee', lostMw: Math.max(0, max - available), maxMw: max,
    start, end: iso(line.date_de_fin), publishedAt: iso(line.date_de_publication), cause: line.cause ? String(line.cause) : null, source: 'edf',
  };
}

function tag(xml, name) {
  const m = new RegExp(`<(?:[\\w]+:)?${name}>([\\s\\S]*?)</(?:[\\w]+:)?${name}>`).exec(xml);
  return m ? m[1].trim() : null;
}

/** Flux RSS IIP → messages REMIT lus (un par item). Le message REMIT est échappé dans <description> (entités décodées par decodeEntities). */
export function parseIipFeed(xml) {
  const items = [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);
  return items.flatMap((item) => {
    const desc = decodeEntities(tag(item, 'description') ?? '');
    const messageId = tag(desc, 'messageId');
    if (!messageId) return [];
    const m = /^(.*)_(\d+)$/.exec(messageId);
    const asset = tag(tag(desc, 'affectedAsset') ?? '', 'name');
    const intervals = [...desc.matchAll(/<capacityInterval>([\s\S]*?)<\/capacityInterval>/g)].map((x) => ({
      start: iso(tag(x[1], 'intervalStart')), stop: iso(tag(x[1], 'intervalStop')), unavailable: num(tag(x[1], 'unavailableCapacity')),
    }));
    return [{
      messageId, base: m ? m[1] : messageId, version: m ? Number(m[2]) : 0, status: tag(desc, 'eventStatus'), type: tag(desc, 'unavailabilityType'),
      start: iso(tag(desc, 'eventStart')), stop: iso(tag(desc, 'eventStop')), publishedAt: iso(tag(desc, 'publicationDateTime')),
      reason: tag(desc, 'unavailabilityReason'), fuel: tag(desc, 'fuelType'), asset, installed: num(tag(desc, 'installedCapacity')), intervals,
    }];
  });
}

/** Version la plus haute de chaque message ; annulés (Dismissed) écartés. */
export function latestVersions(messages) {
  const by = new Map();
  for (const m of messages) {
    const prev = by.get(m.base);
    if (!prev || m.version > prev.version) by.set(m.base, m);
  }
  return [...by.values()].filter((m) => m.status !== 'Dismissed' && m.start !== null && m.asset);
}

function unavailableAt(m, nowMs) {
  const cur = m.intervals.find((i) => i.start && i.stop && Date.parse(i.start) <= nowMs && nowMs < Date.parse(i.stop));
  return cur ? cur.unavailable : null;
}

/**
 * MW publiés pour une unité de production : l'intervalle qui contient l'instant ; pour un arrêt annoncé (début à venir), le premier
 * intervalle à venir. Sinon null : jamais la puissance installée ni 0, qui ne sont pas des MW perdus publiés (aucune valeur fabriquée).
 */
function publishedLostMw(m, nowMs) {
  const cur = unavailableAt(m, nowMs);
  if (cur !== null) return cur;
  if (Date.parse(m.start) <= nowMs) return null;
  const next = m.intervals.filter((i) => i.start && i.unavailable !== null && Date.parse(i.start) > nowMs).sort((a, b) => a.start.localeCompare(b.start))[0];
  return next ? next.unavailable : null;
}

/**
 * Unités de production de l'IIP (statut Active) avec leurs MW perdus publiés (voir publishedLostMw). Une unité sans MW publié pour
 * l'instant ou pour sa prochaine fenêtre est écartée : elle ne peut pas entrer dans un total sans valeur.
 */
export function iipUnits(messages, nowMs) {
  return messages.filter((m) => m.status === 'Active').flatMap((m) => {
    const lostMw = publishedLostMw(m, nowMs);
    if (lostMw === null) return [];
    return [{
      id: m.base, name: m.asset, sector: FUEL_FR[m.fuel] ?? m.fuel ?? 'Filière non précisée', nuclear: m.fuel === 'Nuclear',
      kind: m.type === 'Unplanned' ? 'imprevue' : 'planifiee', lostMw, maxMw: m.installed,
      start: m.start, end: m.stop, publishedAt: m.publishedAt, cause: REASON_FR[m.reason] ?? m.reason, source: 'rte',
    }];
  });
}

/** « Indispo_FR_UK_90259_00000_076 » → { from: 'FR', to: 'UK', key: '90259' } ; null sinon. */
function direction(base) {
  const m = /^Indispo_([A-Z]{2})_([A-Z]{2})_(\d+)/.exec(base);
  return m ? { from: m[1], to: m[2], key: m[3] } : null;
}

/** Indisponibilités du transport en cours (Active, fenêtre contenant maintenant), regroupées par ouvrage, sens nommés. */
export function iipTransmission(messages, nowMs) {
  const groups = new Map();
  for (const m of messages) {
    if (m.status !== 'Active' || Date.parse(m.start) > nowMs || (m.stop && Date.parse(m.stop) <= nowMs)) continue;
    const dir = direction(m.base);
    const key = `${m.asset}:${dir?.key ?? m.base}`;
    const g = groups.get(key) ?? {
      id: dir?.key ?? m.base, asset: m.asset, kind: m.type === 'Unplanned' ? 'imprevue' : 'planifiee', start: m.start, end: m.stop,
      publishedAt: m.publishedAt, reason: REASON_FR[m.reason] ?? m.reason, directions: [],
    };
    const label = dir ? `${COUNTRY_FR[dir.from] ?? dir.from} → ${COUNTRY_FR[dir.to] ?? dir.to}` : 'Ouvrage';
    if (!g.directions.some((d) => d.label === label)) g.directions.push({ label, unavailableMw: unavailableAt(m, nowMs), installedMw: m.installed });
    if ((m.publishedAt ?? '') > (g.publishedAt ?? '')) g.publishedAt = m.publishedAt;
    groups.set(key, g);
  }
  const all = [...groups.values()].map((g) => ({ ...g, directions: g.directions.sort((a, b) => (a.label.startsWith('France') ? -1 : 1) - (b.label.startsWith('France') ? -1 : 1)) }));
  return { unplanned: all.filter((g) => g.kind === 'imprevue'), planned: all.filter((g) => g.kind === 'planifiee') };
}

const unitKey = (name) => String(name).toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();

/** Deux lignes de la même unité et du même genre dont les fenêtres se recouvrent : un seul arrêt publié en plusieurs lignes. */
function sameOutage(a, b) {
  if (unitKey(a.name) !== unitKey(b.name) || a.kind !== b.kind) return false;
  const aEnd = a.end === null ? Number.POSITIVE_INFINITY : Date.parse(a.end);
  const bEnd = b.end === null ? Number.POSITIVE_INFINITY : Date.parse(b.end);
  return Date.parse(a.start) <= bEnd && Date.parse(b.start) <= aEnd;
}

/**
 * Un arrêt compté une fois (P3) : EDF publie parfois la même unité en plusieurs lignes (REVIN 2 en deux fenêtres, COCHE POMPE en mode
 * turbine et en mode pompe). Les lignes de même unité et même genre dont les fenêtres se recouvrent sont fusionnées en gardant la plus
 * perdante (à égalité, la fin la plus tardive, une fin inconnue comptant pour la plus tardive, puis la plus récemment commencée). Un début
 * identique suffit donc, sans être exigé. Ordre d'entrée conservé.
 */
export function dedupeUnits(units) {
  const endMs = (u) => (u.end === null ? Number.POSITIVE_INFINITY : Date.parse(u.end));
  const laterEnd = (a, b) => (endMs(b) === endMs(a) ? 0 : endMs(b) > endMs(a) ? 1 : -1);
  const ranked = units.map((u, i) => ({ u, i })).sort((a, b) => b.u.lostMw - a.u.lostMw || laterEnd(a.u, b.u) || b.u.start.localeCompare(a.u.start) || a.i - b.i);
  const kept = [];
  for (const entry of ranked) {
    if (!kept.some((k) => sameOutage(k.u, entry.u))) kept.push(entry);
  }
  return kept.sort((a, b) => a.i - b.i).map((k) => k.u);
}

/** Unités EDF, plus celles de l'IIP absentes d'EDF (arbitrage 4). */
export function mergeUnits(edf, iip) {
  const known = new Set(edf.map((u) => `${unitKey(u.name)}:${u.kind}`));
  return [...edf, ...iip.filter((u) => !known.has(`${unitKey(u.name)}:${u.kind}`))];
}

/** Ligne SEI de l'heure en cours → IslandPowerSignal ; null sans ligne. Couleur et texte tels que publiés (la vue décide de leur affichage). */
export function seiSignal(json, zone, nowMs) {
  const rows = Array.isArray(json?.results) ? json.results : [];
  const row = rows
    .map((r) => ({ r, t: Date.parse(String(r.dateheure ?? '')) }))
    .filter((x) => Number.isFinite(x.t) && x.t <= nowMs && nowMs < x.t + 3_600_000)[0]?.r;
  if (!row) return null;
  return {
    zone, at: new Date(Date.parse(row.dateheure)).toISOString(), color: String(row.signal_horaire_couleur ?? '').toLowerCase(),
    text: String(row.signal_horaire_texte ?? ''), cyclone: row.cyclone_en_cours === true,
  };
}

/** Courbe : MW perdus en arrêts imprévus à 12 h Paris (≈ 10 h UTC) chaque jour des 30 derniers jours (arbitrage 5) ; un point par jour. */
export function historyFromEdf(units, nowMs) {
  const out = [];
  for (let d = 29; d >= 0; d -= 1) {
    const day = new Date(nowMs - d * DAY_MS).toISOString().slice(0, 10);
    const at = Date.parse(`${day}T10:00:00Z`);
    if (at > nowMs) continue;
    // Un arrêt à la fois : fusion par jour, car deux lignes d'une même unité peuvent ne se recouvrir qu'à certaines dates.
    const live = dedupeUnits(units.filter((u) => u.kind === 'imprevue' && Date.parse(u.start) <= at && (u.end === null || Date.parse(u.end) > at)));
    out.push({ day, unplannedMw: Math.round(live.reduce((s, u) => s + u.lostMw, 0)) });
  }
  return out;
}

const byMw = (a, b) => b.lostMw - a.lostMw || a.name.localeCompare(b.name, 'fr');

/**
 * Réponse à partir des parties lues ; `iip` : { transmission } ou null (transport illisible). `edfReadAt` : dernière lecture réussie du
 * jeu EDF (horloge du serveur), sur laquelle se mesure le retard EDF (R20) ; `iipReadAt` : dernière lecture réussie de l'IIP, idem pour le retard IIP.
 */
export function buildPower({ edf, iip, sei, history, edfUpdatedAt = null, edfReadAt = null, iipPublishedAt = null, iipReadAt = null, errors = [] }, nowMs) {
  const live = (u) => Date.parse(u.start) <= nowMs && (u.end === null || Date.parse(u.end) > nowMs);
  const soon = (u) => Date.parse(u.start) > nowMs && Date.parse(u.start) <= nowMs + 7 * DAY_MS;
  return {
    readAt: new Date(nowMs).toISOString(), edfUpdatedAt, edfReadAt, iipPublishedAt, iipReadAt,
    unplanned: dedupeUnits(edf.filter((u) => u.kind === 'imprevue' && live(u))).sort(byMw),
    planned: dedupeUnits(edf.filter((u) => u.kind === 'planifiee' && live(u))).sort(byMw),
    upcoming: dedupeUnits(edf.filter(soon)).sort((a, b) => a.start.localeCompare(b.start) || byMw(a, b)),
    transmission: iip ? iip.transmission : null,
    islands: sei, history, errors,
  };
}

/** Réponse vide (jamais lu) : listes vides, dates null, jamais « aucun arrêt ». */
export function emptyPower(errors = []) {
  return { readAt: null, edfUpdatedAt: null, edfReadAt: null, iipPublishedAt: null, iipReadAt: null, unplanned: [], planned: [], upcoming: [], transmission: null, islands: [], history: [], errors };
}

const anyDue = (parts, now) => partDue(parts.edf, EDF_INTERVAL_MS, now) || partDue(parts.iip, IIP_INTERVAL_MS, now) || partDue(parts.sei, SEI_INTERVAL_MS, now);

/** EDF : lignes en cours et à venir, date du jeu, courbe de 30 jours. Lève si une des trois requêtes échoue. */
async function readEdf(now) {
  const from = new Date(now).toISOString();
  const to = new Date(now + 7 * DAY_MS).toISOString();
  const [lines, meta, past] = await Promise.all([
    fetchStrictJson(edfLinesUrl({ from, to }), { timeoutMs: 20_000 }),
    fetchStrictJson(EDF_DATASET, { timeoutMs: 15_000 }),
    fetchStrictJson(edfHistoryUrl(new Date(now - 30 * DAY_MS).toISOString()), { timeoutMs: 20_000 }),
  ]);
  // Une réponse 200 sans liste `results` n'est pas « aucun arrêt » : erreur nommée (S3).
  if (!Array.isArray(lines?.results) || !Array.isArray(past?.results)) throw new Error('réponse sans liste de lignes');
  const units = lines.results.map(normalizeEdfLine).filter((u) => u !== null);
  const pastUnits = past.results.map(normalizeEdfLine).filter((u) => u !== null);
  return { updatedAt: iso(meta?.dataUpdatedAt), units, history: historyFromEdf(pastUnits, now) };
}

/** IIP : unités de production et ouvrages de transport en cours. Lève si un des deux flux échoue. */
async function readIip(now) {
  // Agent dédié : RTE n'envoie pas son certificat intermédiaire (voir rte-iip-agent.js) ; vérification TLS stricte conservée.
  const opts = { timeoutMs: 20_000, dispatcher: iipDispatcher() };
  const [prodXml, transXml] = await Promise.all([fetchStrictXml(IIP_PRODUCTION_URL, opts), fetchStrictXml(IIP_TRANSMISSION_URL, opts)]);
  return {
    publishedAt: iso(tag(prodXml, 'lastBuildDate')),
    units: iipUnits(latestVersions(parseIipFeed(prodXml)), now),
    transmission: iipTransmission(latestVersions(parseIipFeed(transXml)), now),
  };
}

const zoneLabel = (zone) => (zone === 'reunion' ? 'La Réunion' : 'Corse');

/** SEI : un signal par île ; une île en échec garde son dernier signal et nomme son erreur. */
async function readSei(now, previous) {
  const hour = new Date(Math.floor(now / 3_600_000) * 3_600_000).toISOString();
  const signals = [];
  const errors = [];
  for (const d of SEI_DATASETS) {
    try {
      const json = await fetchStrictJson(`${EDF_BASE}/${d.id}/lines?size=3&sort=dateheure&dateheure_gte=${encodeURIComponent(hour)}`, { timeoutMs: 15_000 });
      const s = seiSignal(json, d.zone, now);
      // Une île sans ligne pour l'heure en cours est une source muette, jamais une île « sans signal » passée sous silence.
      if (!s) throw new Error('signal de l’heure absent');
      signals.push(s);
    } catch (err) {
      errors.push(sourceError(`EDF SEI, ${zoneLabel(d.zone)}`, err));
      const kept = (previous?.signals ?? []).find((s) => s.zone === d.zone);
      if (kept) signals.push(kept);
    }
  }
  return { signals, errors };
}

/** Une collecte : chaque partie relue si elle est due ; une partie en panne garde ses dernières données et nomme son erreur. */
export async function collectPower(now = Date.now()) {
  const attemptedAt = new Date(now).toISOString();
  const stored = await kvGetJson(POWER_LAST_KEY, now);
  const parts = { ...(stored && typeof stored === 'object' ? stored.parts : null) };

  if (partDue(parts.edf, EDF_INTERVAL_MS, now)) {
    try {
      parts.edf = succeeded(await readEdf(now), attemptedAt);
    } catch (err) {
      parts.edf = failed(parts.edf, { readAt: null, updatedAt: null, units: [], history: [] }, sourceError('EDF OpenData', err), attemptedAt);
    }
  }
  if (partDue(parts.iip, IIP_INTERVAL_MS, now)) {
    try {
      parts.iip = succeeded(await readIip(now), attemptedAt);
    } catch (err) {
      parts.iip = failed(parts.iip, { readAt: null, publishedAt: null, units: [], transmission: null }, sourceError('RTE IIP', err), attemptedAt);
      // Le transport en cours dépend de l'heure de lecture : illisible, jamais resservi comme actuel.
      parts.iip.transmission = null;
    }
  }
  if (partDue(parts.sei, SEI_INTERVAL_MS, now)) {
    const { signals, errors } = await readSei(now, parts.sei);
    parts.sei = errors.length === 0
      ? { readAt: attemptedAt, failedAt: null, errors: [], signals }
      : { readAt: parts.sei?.readAt ?? null, failedAt: attemptedAt, errors, signals };
  }

  const errors = [parts.edf?.error, parts.iip?.error, ...(parts.sei?.errors ?? [])].filter((e) => typeof e === 'string' && e.length > 0);
  const islands = parts.sei?.signals ?? [];
  const body = parts.edf?.readAt || parts.iip?.readAt
    ? buildPower({
      edf: mergeUnits(parts.edf?.units ?? [], parts.iip?.units ?? []), iip: parts.iip?.transmission ? { transmission: parts.iip.transmission } : null, sei: islands,
      history: parts.edf?.history ?? [], edfUpdatedAt: parts.edf?.updatedAt ?? null, edfReadAt: parts.edf?.readAt ?? null,
      iipPublishedAt: parts.iip?.publishedAt ?? null, iipReadAt: parts.iip?.readAt ?? null, errors,
    }, now)
    : { ...emptyPower(errors), islands };
  await kvSetJson(POWER_LAST_KEY, { attemptedAt, parts, body }, LAST_TTL_SEC, now);
  return body;
}

/** Dernier relevé, après une collecte si une partie est due ; jamais deux à la fois. */
export function ensurePowerFresh(now = Date.now()) {
  const turn = queue.then(async () => {
    const last = await kvGetJson(POWER_LAST_KEY, now);
    // Un relevé écrit avant `iipReadAt` n'a pas la forme du contrat : relu tout de suite.
    if (last?.body && 'iipReadAt' in last.body && last.parts && !anyDue(last.parts, now)) return last.body;
    return collectPower(now);
  });
  queue = turn.then(() => undefined, () => undefined);
  return turn;
}

/** Relevé gardé, sans attendre la collecte en cours, avec `note`. */
export async function storedPower(now, note) {
  const last = await kvGetJson(POWER_LAST_KEY, now);
  const body = last?.body ?? emptyPower();
  return { ...body, errors: [...body.errors, note] };
}
