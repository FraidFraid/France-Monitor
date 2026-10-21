// api/_lib/outages-room.js : control room des pannes (spec 2026-10-21 § 5.3). Tick serveur toutes les minutes (collecteur de
// server/prod/outages-collectors.mjs) : relevés déjà tenus par les routes /api/outages/* (aucune lecture de source de plus), fusion
// (outages-now.js), comparaison à l'état précédent (outages-journal.js). État et journal (7 jours) gardés en mémoire et dans le
// stockage clé-valeur, écrit seulement quand l'état change ; relus au redémarrage. Sans collecteur (serveur de dev), calcul à la demande.
import { kvReadJson, kvWriteJson } from './kv-history.js';
import { diffOutages } from './outages-journal.js';
import { ARCEP_MAX_AGE_MS, CLOUD_MAX_AGE_MS, LIVE_MAX_AGE_MS, outagesNow } from './outages-now.js';
import { loadCloud } from '../_handlers/outages/cloud.js';
import { loadInternet } from '../_handlers/outages/internet.js';
import { loadPower } from '../_handlers/outages/power.js';
import { loadTelecom } from '../_handlers/outages/telecom.js';
import { snapshotItems } from '../_handlers/news.js';
import { pressOutages } from './telecom-press.js';
import { ensureSocialFresh, socialErrors, socialOutages, socialReadAt, SOCIAL_MAX_AGE_MS } from './outages-social.js';
import { ATLAS_MAX_AGE_MS, atlasOutages, atlasStatus, ensureAtlasFresh } from './outages-atlas.js';
import { ensureStatusFresh, statusOutages } from './outages-status.js';

export const ROOM_KEY = 'out:room:v1';
const ROOM_TTL_SEC = 8 * 24 * 3600;
export const JOURNAL_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
/** Écart minimal entre deux ticks (la boucle de collecte tourne toutes les 60 s). */
export const TICK_MIN_MS = 55_000;
/** Au-delà, l'instantané est recalculé à la demande (aucun collecteur ne tourne). */
export const SNAPSHOT_STALE_MS = 3 * 60_000;
/** Entrées du journal servies avec l'état. */
export const SNAPSHOT_JOURNAL = 50;

/** Pannes de tous les réseaux signalées par la presse (instantané d'actualités en mémoire, aucune lecture Neon de plus) ; null sans base. */
async function readPress(now) {
  const items = await snapshotItems(now);
  return items === null ? null : pressOutages(items, now);
}

/** Pics de signalements d'usagers (relève toutes les 2 min, déjà faite par le collecteur en production). */
async function readSocial(now) {
  await ensureSocialFresh(now);
  return socialOutages(now);
}

/** Sondes RIPE Atlas décrochées (relève toutes les 5 min, déjà faite par le collecteur en production). */
async function readAtlas(now) {
  await ensureAtlasFresh(now);
  return atlasOutages(now);
}

/** Incidents des pages d'état élargies (relève toutes les 5 min, déjà faite par le collecteur en production). */
async function readStatus(now) {
  await ensureStatusFresh(now);
  return statusOutages(now).outages;
}

const DEFAULT_READERS = { readTelecom: loadTelecom, readInternet: loadInternet, readPower: loadPower, readCloud: loadCloud, readPress, readSocial, readAtlas, readStatus };

/** @type {{ loaded: boolean, state: any, journal: any[], tickAt: number, outages: any[], sources: any[], errors: string[] } | null} */
let room = null;
/** @type {Promise<void> | null} */
let running = null;

/** Réservé aux tests : oublie l'état du processus (simule un redémarrage). */
export function __resetRoomForTests() {
  room = null;
  running = null;
}

const fresh = (iso, now, maxAge) => {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) && now - t <= maxAge;
};
const iso = (now) => new Date(now).toISOString();

async function settle(read, now) {
  try {
    return await read(now);
  } catch {
    return null;
  }
}

async function run(now, readers) {
  // État relu tant qu'une lecture n'a pas abouti : sur une panne du stockage, on sert les pannes du moment sans journal et sans
  // rien écrire (un état vide écraserait le journal de 7 jours).
  if (room === null || !room.loaded) {
    const read = await kvReadJson(ROOM_KEY, now);
    const stored = read.value;
    room = {
      ...(room ?? { tickAt: 0, outages: [], sources: [], errors: [] }),
      loaded: !read.failed, state: stored?.state ?? null, journal: Array.isArray(stored?.journal) ? stored.journal : [],
    };
  }
  const [telecom, internet, power, cloud, press, social, atlas, status] = await Promise.all([
    settle(readers.readTelecom, now), settle(readers.readInternet, now), settle(readers.readPower, now), settle(readers.readCloud, now),
    settle(readers.readPress ?? readPress, now), settle(readers.readSocial ?? readSocial, now), settle(readers.readAtlas ?? readAtlas, now), settle(readers.readStatus ?? readStatus, now),
  ]);
  const outages = outagesNow({ telecom, internet, power, cloud, now, press: press ?? undefined, social: social ?? [], atlas: atlas ?? [], status: status ?? [] });
  const loaded = room.loaded;
  const { state, entries } = loaded ? diffOutages(room.state, outages, now) : { state: room.state, entries: [] };
  const cut = now - JOURNAL_MAX_AGE_MS;
  const journal = [...entries.reverse(), ...room.journal].filter((e) => Date.parse(e.at) >= cut);
  const changed = room.state === null || entries.length > 0 || journal.length !== room.journal.length
    || JSON.stringify(state.items) !== JSON.stringify(room.state.items);
  if (loaded && changed) await kvWriteJson(ROOM_KEY, { state, journal }, ROOM_TTL_SEC, now);
  room = {
    loaded, state, journal, tickAt: now, outages,
    sources: [
      { source: 'presse', readAt: press || telecom?.press ? iso(now) : null, ok: Array.isArray(press) || Array.isArray(telecom?.press) },
      { source: 'usagers', readAt: socialReadAt(), ok: fresh(socialReadAt(), now, SOCIAL_MAX_AGE_MS) },
      { source: 'arcep', readAt: telecom?.file?.publishedAt ?? null, ok: fresh(telecom?.file?.publishedAt, now, ARCEP_MAX_AGE_MS) },
      { source: 'ioda', readAt: internet?.iodaReadAt ?? null, ok: fresh(internet?.iodaReadAt, now, LIVE_MAX_AGE_MS) },
      { source: 'radar', readAt: internet?.radar?.readAt ?? null, ok: Boolean(internet?.radar?.configured) && fresh(internet?.radar?.readAt, now, LIVE_MAX_AGE_MS) },
      { source: 'atlas', readAt: atlasStatus().readAt, ok: fresh(atlasStatus().readAt, now, ATLAS_MAX_AGE_MS) },
      { source: 'rte', readAt: power?.iipReadAt ?? null, ok: fresh(power?.iipReadAt, now, LIVE_MAX_AGE_MS) },
      { source: 'edf', readAt: power?.edfReadAt ?? null, ok: fresh(power?.edfReadAt, now, LIVE_MAX_AGE_MS) },
      { source: 'statut', readAt: cloud?.readAt ?? null, ok: fresh(cloud?.readAt, now, CLOUD_MAX_AGE_MS) },
    ],
    errors: [...[telecom, internet, power, cloud].flatMap((r) => (Array.isArray(r?.errors) ? r.errors : [])), ...socialErrors(), ...(atlasStatus().error ? [atlasStatus().error] : []), ...statusOutages(now).errors],
  };
}

/** Tick de la salle : au plus un toutes les 55 s, un seul à la fois. Ne lève jamais. */
export async function tickOutagesRoom(now = Date.now(), readers = DEFAULT_READERS) {
  if (room !== null && room.tickAt > 0 && now - room.tickAt < TICK_MIN_MS) return;
  running ??= run(now, readers).catch((err) => console.warn('[outages-room] tick en échec :', err instanceof Error ? err.message : err))
    .finally(() => { running = null; });
  await running;
}

async function ensureRoom(now, readers) {
  if (room === null || room.tickAt === 0 || now - room.tickAt > SNAPSHOT_STALE_MS) await tickOutagesRoom(now, readers);
}

/** Réponse de /api/outages/now (OutagesNowResponse). */
export async function roomSnapshot(now = Date.now(), readers = DEFAULT_READERS) {
  await ensureRoom(now, readers);
  return {
    generatedAt: iso(room?.tickAt || now),
    outages: room?.outages ?? [],
    journal: (room?.journal ?? []).slice(0, SNAPSHOT_JOURNAL),
    sources: room?.sources ?? [],
    errors: room?.errors ?? [],
  };
}

/** Entrées du journal depuis `sinceMs` (7 jours au plus), plus récentes d'abord. */
export async function roomJournal(sinceMs, now = Date.now(), readers = DEFAULT_READERS) {
  await ensureRoom(now, readers);
  return (room?.journal ?? []).filter((e) => Date.parse(e.at) >= sinceMs);
}
