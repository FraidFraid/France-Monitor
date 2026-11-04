// api/_lib/anticipation/room.js : tick serveur de l'anticipation (04/11/2026). Chaque minute (collecteur server/prod/anticipation-collectors.mjs) :
// relevés déjà tenus par le site (aucune source de plus), signaux, moteur de règles, clôtures, crises manquées, journal et archive sur disque.
// L'instantané servi par /api/anticipation/now est recalculé à la demande quand le dernier tick a plus de 3 min (serveur de dev).
// Un relevé en échec devient une entrée nulle (« inconnu ») : le tick ne lève jamais.
import { readFile } from 'node:fs/promises';
import { parisDay } from '../../_shared/paris-day.js';
import { upcomingFromSources } from '../../_shared/upcoming.js';
import { PHENOMENON_WORD } from '../../_shared/phenomenon-word.js';
import { loadProtests } from '../protests.js';
import { loadVigilance } from '../meteo-vigilance.js';
import { loadSituations } from '../../_handlers/transport/rail-situations.js';
import { loadCyberWatch } from '../../_handlers/sovereignty/cyber-watch.js';
import { loadEcowattOfficial } from '../../_handlers/energy/ecowatt-signal.js';
import { FUEL_SNAPSHOT_FILES } from '../../_handlers/energy/fuel-tension.js';
import { snapshotItems } from '../../_handlers/news.js';
import { roomSnapshot as outagesSnapshot } from '../outages-room.js';
import { toSignals } from './signals.js';
import { capOpen, evaluate } from './engine.js';
import { openRegistry } from './registry.js';
import { closeDue, missedCrises } from './closing.js';
import { buildAgenda } from './agenda.js';
import { RULES } from './rules/index.js';

/** Écart minimal entre deux ticks (la boucle de collecte tourne toutes les 60 s). */
export const TICK_MIN_MS = 55_000;
/** Au-delà, l'instantané est recalculé à la demande (aucun collecteur ne tourne). */
export const SNAPSHOT_STALE_MS = 3 * 60_000;
const HOUR = 3_600_000;

/** Premier fichier carburants lisible (relevé de la VM), ou null. */
async function readFuel() {
  for (const file of FUEL_SNAPSHOT_FILES) {
    try { return JSON.parse(await readFile(file, 'utf8')); } catch { /* fichier suivant */ }
  }
  return null;
}

const DEFAULT_READERS = {
  readProtests: loadProtests,
  readVigilance: loadVigilance,
  readRail: loadSituations,
  readRoom: outagesSnapshot,
  readCyber: loadCyberWatch,
  readEcowatt: loadEcowattOfficial,
  readFuel,
  readNews: snapshotItems,
};

/**
 * @typedef {object} FuelMemo
 * @property {string|null} generatedAt Date du relevé carburants courant.
 * @property {{ national: number|null, depts: Record<string, number> }} shares Parts du relevé courant.
 * @property {{ national: number|null, depts: Record<string, number> }} previous Parts du relevé précédent (tendance de la règle 5).
 */

/** @type {{ registry: any, tickAt: number, signals: any[], scenarios: any[], agenda: any[], unknown: string[], errors: string[], fuel: FuelMemo | null, compactDay: string } | null} */
let state = null;
/** @type {Promise<void> | null} */
let running = null;

/** Réservé aux tests : oublie l'état du processus (simule un redémarrage). */
export function __resetAnticipationForTests() {
  state = null;
  running = null;
}

const errMsg = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e));
const emptyShares = () => ({ national: /** @type {number|null} */ (null), depts: /** @type {Record<string, number>} */ ({}) });

/** Parts de tension carburants d'un relevé ou d'une liste de signaux archivés. */
function sharesOfFuel(/** @type {any} */ fuel) {
  const out = emptyShares();
  if (typeof fuel?.national?.anomalyShare === 'number') out.national = fuel.national.anomalyShare;
  for (const s of Array.isArray(fuel?.summaries) ? fuel.summaries : []) {
    if (typeof s?.departmentCode === 'string' && typeof s.anomalyShare === 'number') out.depts[s.departmentCode] = s.anomalyShare;
  }
  return out;
}
function sharesOfSignals(/** @type {any[]} */ signals) {
  const out = emptyShares();
  for (const s of signals) { // dans l'ordre d'archivage : le plus récent l'emporte
    if (s?.kind !== 'tension_carburant' || typeof s.value !== 'number') continue;
    if (s.meta?.national === true) out.national = s.value;
    else if (Array.isArray(s.dept) && s.dept.length === 1) out.depts[s.dept[0]] = s.value;
  }
  return out;
}

/** Relevé carburants avec la part précédente injectée (`previousAnomalyShare`), sans toucher à l'original. */
function withPrevious(/** @type {any} */ fuel, /** @type {FuelMemo} */ memo) {
  const prev = memo.previous;
  return {
    ...fuel,
    ...(fuel.national && typeof fuel.national === 'object' && prev.national !== null ? { national: { ...fuel.national, previousAnomalyShare: prev.national } } : {}),
    summaries: (Array.isArray(fuel.summaries) ? fuel.summaries : []).map((/** @type {any} */ s) => (
      typeof s?.departmentCode === 'string' && typeof prev.depts[s.departmentCode] === 'number' ? { ...s, previousAnomalyShare: prev.depts[s.departmentCode] } : s)),
  };
}

async function settle(/** @type {(now: number) => Promise<any>} */ read, /** @type {number} */ now) {
  try { return (await read(now)) ?? null; } catch { return null; }
}

/** Scénario enregistré avec une bascule qui vient d'être atteinte ? */
function newlyReached(/** @type {any} */ before, /** @type {any} */ after) {
  return (Array.isArray(after?.bascules) ? after.bascules : []).some((/** @type {any} */ b) => b.state === 'atteint'
    && !(Array.isArray(before?.bascules) ? before.bascules : []).some((/** @type {any} */ p) => p.id === b.id && p.state === 'atteint'));
}

async function run(/** @type {number} */ now, /** @type {any} */ readers) {
  const nowIso = new Date(now).toISOString();
  const registry = state?.registry ?? await (readers.openRegistry ?? ((/** @type {number} */ at) => openRegistry({ now: at })))(now);
  let fuelMemo = state?.fuel ?? null;
  if (fuelMemo === null) {
    // Après un redémarrage : parts du dernier relevé archivé (2 h), pour garder la tendance.
    let archived = [];
    try { archived = await registry.signalsBetween(new Date(now - 2 * HOUR).toISOString(), nowIso); } catch { /* archive illisible : pas de tendance */ }
    fuelMemo = { generatedAt: null, shares: sharesOfSignals(archived), previous: emptyShares() };
  }
  const names = ['protests', 'vigilance', 'rail', 'room', 'cyber', 'ecowatt', 'fuel', 'news'];
  const results = await Promise.allSettled([
    settle(readers.readProtests, now), settle(readers.readVigilance, now), settle(readers.readRail, now), settle(readers.readRoom, now),
    settle(readers.readCyber, now), settle(readers.readEcowatt, now), settle(readers.readFuel, now), settle(readers.readNews, now),
  ]);
  /** @type {Record<string, any>} */
  const inputs = {};
  names.forEach((n, i) => { const r = results[i]; inputs[n] = r.status === 'fulfilled' ? r.value : null; });
  // Tendance carburants : à chaque nouveau relevé, les parts du relevé courant deviennent « précédentes ».
  if (inputs.fuel && typeof inputs.fuel.generatedAt === 'string' && inputs.fuel.generatedAt !== fuelMemo.generatedAt) {
    fuelMemo = { generatedAt: inputs.fuel.generatedAt, previous: fuelMemo.shares, shares: sharesOfFuel(inputs.fuel) };
  }
  if (inputs.fuel) inputs.fuel = withPrevious(inputs.fuel, fuelMemo);

  const { signals, unknown, errors: signalErrors } = toSignals(/** @type {any} */ (inputs), now);
  const rules = readers.rules ?? RULES;
  const before = new Map(registry.state());
  const { opened, revised, open, errors: engineErrors } = evaluate(signals, registry, now, rules, unknown);
  for (const s of opened) await registry.record({ at: nowIso, type: 'ouverture', scenario: s });
  for (const s of revised) await registry.record({ at: nowIso, type: newlyReached(before.get(s.id), s) ? 'bascule' : 'revision', scenario: s });
  for (const c of await closeDue(open, signals, rules, now, { registry, unknown })) await registry.record({ at: nowIso, type: 'cloture', scenario: c.scenario });
  const stillOpen = [...registry.state().values()].filter((/** @type {any} */ s) => s.status === 'ouvert');
  for (const m of missedCrises(signals, stillOpen, [...registry.state().values()], now)) await registry.record({ at: nowIso, type: 'manque', scenario: m });
  await registry.archiveSignals(signals, now);
  let compactDay = state?.compactDay ?? '';
  if (compactDay !== parisDay(now)) { compactDay = parisDay(now); await registry.compact(now); }

  const served = capOpen([...registry.state().values()].filter((/** @type {any} */ s) => s.status === 'ouvert'), now);
  const upcoming = upcomingFromSources({
    ecowatt: inputs.ecowatt ? { official: inputs.ecowatt } : null, vigilance: inputs.vigilance,
    protests: Array.isArray(inputs.protests?.items) ? inputs.protests.items : null, floods: null, now,
  }, { phenomenonWord: PHENOMENON_WORD, readForecast: () => null });
  state = {
    registry, tickAt: now, signals, scenarios: served, agenda: buildAgenda(served, upcoming, now), unknown,
    errors: [...signalErrors, ...engineErrors, ...registry.errors], fuel: fuelMemo, compactDay,
  };
}

/** Tick de l'anticipation : au plus un toutes les 55 s, un seul à la fois. Ne lève jamais. */
export async function tickAnticipation(now = Date.now(), readers = DEFAULT_READERS) {
  if (state !== null && state.tickAt > 0 && now - state.tickAt < TICK_MIN_MS) return;
  running ??= run(now, { ...DEFAULT_READERS, ...readers }).catch((err) => console.warn('[anticipation] tick en échec :', errMsg(err)))
    .finally(() => { running = null; });
  await running;
}

async function ensureState(/** @type {number} */ now, /** @type {any} */ readers) {
  if (state === null || state.tickAt === 0 || now - state.tickAt > SNAPSHOT_STALE_MS) await tickAnticipation(now, readers);
}

/**
 * Réponse de /api/anticipation/now (AnticipationNowResponse). Les signaux ne sont que ceux cités par les scénarios servis.
 * @param {number} [now]
 */
export async function anticipationSnapshot(now = Date.now(), readers = DEFAULT_READERS) {
  await ensureState(now, readers);
  const scenarios = state?.scenarios ?? [];
  const cited = new Set(scenarios.flatMap((/** @type {any} */ s) => (Array.isArray(s.chain) ? s.chain : []).flatMap((/** @type {any} */ c) => c.signalIds ?? [])));
  /** @type {Record<string, any>} */
  const signals = {};
  for (const s of state?.signals ?? []) if (cited.has(s.id)) signals[s.id] = s;
  return {
    generatedAt: new Date(state?.tickAt || now).toISOString(), beta: true, scenarios, agenda: state?.agenda ?? [], signals,
    unknown: state?.unknown ?? [], errors: state?.errors ?? [],
  };
}

/**
 * Enregistre un retour sur un scénario connu (compteur + ligne « retour » du journal). Renvoie false si le scénario est inconnu.
 * @param {string} scenarioId
 * @param {'utile'|'deja_su'|'faux'} vote
 * @param {number} [now]
 */
export async function recordFeedback(scenarioId, vote, now = Date.now(), readers = DEFAULT_READERS) {
  await ensureState(now, readers);
  const registry = state?.registry;
  const current = registry?.state().get(scenarioId);
  if (!registry || !current) return false;
  const next = { ...current, feedback: { ...current.feedback, [vote]: (current.feedback?.[vote] ?? 0) + 1 } };
  await registry.record({ at: new Date(now).toISOString(), type: 'retour', scenario: next });
  if (state) state.scenarios = state.scenarios.map((/** @type {any} */ s) => (s.id === scenarioId ? next : s));
  return true;
}
