// api/_lib/anticipation/room.js : tick serveur de l'anticipation (04/11/2026). Chaque minute (collecteur server/prod/anticipation-collectors.mjs) :
// relevés déjà tenus par le site (aucune source de plus), signaux, moteur de règles, clôtures, crises manquées, journal et archive sur disque.
// L'instantané servi par /api/anticipation/now est recalculé à la demande quand le dernier tick a plus de 3 min (serveur de dev).
// Un relevé en échec devient une entrée nulle (« inconnu ») : le tick ne lève jamais. Revue finale : le registre est ouvert une fois par
// processus (indépendant de l'état) ; après un tick en échec, le recalcul à la demande attend une minute (dernier état servi entre-temps) ;
// les erreurs publiées sont des libellés sans chemin, le détail part une fois dans le journal du service.
import { readFile } from 'node:fs/promises';
import { parisDay } from '../../../src/services/paris-day.js';
import { upcomingFromSources } from '../../../src/services/upcoming-core.js';
import { PHENOMENON_WORD } from '../../_shared/phenomenon-word.js';
import { loadProtests } from '../protests.js';
import { loadVigilance } from '../meteo-vigilance.js';
import { loadSituations } from '../../_handlers/transport/rail-situations.js';
import { loadCyberWatch } from '../../_handlers/sovereignty/cyber-watch.js';
import { loadEcowattOfficial } from '../../_handlers/energy/ecowatt-signal.js';
import { FUEL_SNAPSHOT_FILES } from '../../_handlers/energy/fuel-tension.js';
import { snapshotItems } from '../../_handlers/news.js';
import { roomSnapshot as outagesSnapshot } from '../outages-room.js';
import { footballSnapshot } from '../football-data.js';
import { toSignals } from './signals.js';
import { capOpen, evaluate } from './engine.js';
import { openRegistry, previousMonth } from './registry.js';
import { closeDue, missedCrises } from './closing.js';
import { buildAgenda } from './agenda.js';
import { buildNote, latestNote, noteExists, parisHour, readNote, writeNote } from './note.js';
import { buildBilan, rulesInReview } from './bilan.js';
import { withExposure } from './exposure.js';
import { RULES } from './rules/index.js';
import { publicErrors, TICK_FAILED_LABEL } from './public-errors.js';

/** Écart minimal entre deux ticks (la boucle de collecte tourne toutes les 60 s). */
export const TICK_MIN_MS = 55_000;
/** Au-delà, l'instantané est recalculé à la demande (aucun collecteur ne tourne). */
export const SNAPSHOT_STALE_MS = 3 * 60_000;
const HOUR = 3_600_000;
/** Après un tick en échec, pas de nouveau calcul à la demande avant ce délai. */
export const RETRY_AFTER_FAILURE_MS = 60_000;

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
  readFootball: footballSnapshot,
};

/**
 * @typedef {object} FuelMemo
 * @property {string|null} generatedAt Date du relevé carburants courant.
 * @property {{ national: number|null, depts: Record<string, number> }} shares Parts du relevé courant.
 * @property {{ national: number|null, depts: Record<string, number> }} previous Parts du relevé précédent (tendance de la règle 5).
 */

/** @type {{ tickAt: number, signals: any[], scenarios: any[], agenda: any[], unknown: string[], errors: string[], fuel: FuelMemo | null, compactDay: string, frozenDay: string } | null} */
let state = null;
/** @type {Promise<void> | null} */
let running = null;
/** Registre ouvert une fois par processus, gardé même si un tick échoue ensuite. */
/** @type {any} */
let registry = null;
/** Heure du dernier tick en échec (null : le dernier a réussi). */
/** @type {number | null} */
let failedAt = null;
/** Erreurs internes déjà écrites dans le journal du service (une fois chacune). */
const logged = new Set();

/** Réservé aux tests : oublie l'état du processus (simule un redémarrage). */
export function __resetAnticipationForTests() {
  state = null;
  running = null;
  registry = null;
  failedAt = null;
  logged.clear();
}

/** Écrit chaque erreur interne une seule fois dans le journal du service (détail complet, chemins compris). */
function logOnce(/** @type {string[]} */ errors) {
  for (const e of errors) {
    if (logged.has(e)) continue;
    if (logged.size >= 500) logged.clear(); // mémoire bornée : au pire une erreur est réécrite
    logged.add(e);
    console.error('[anticipation]', e);
  }
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
/** Mémoire carburants rebâtie depuis l'archive : parts, date du relevé (lecture) et parts précédentes (`meta.previousValue`). */
function memoOfSignals(/** @type {any[]} */ signals) {
  const shares = emptyShares();
  const previous = emptyShares();
  let generatedAt = /** @type {string|null} */ (null);
  for (const s of signals) { // dans l'ordre d'archivage : le plus récent l'emporte
    if (s?.kind !== 'tension_carburant' || typeof s.value !== 'number') continue;
    if (typeof s.checkedAt === 'string' && (generatedAt === null || s.checkedAt > generatedAt)) generatedAt = s.checkedAt;
    const prev = typeof s.meta?.previousValue === 'number' ? s.meta.previousValue : null;
    if (s.meta?.national === true) { shares.national = s.value; previous.national = prev; }
    else if (Array.isArray(s.dept) && s.dept.length === 1) {
      shares.depts[s.dept[0]] = s.value;
      if (prev !== null) previous.depts[s.dept[0]] = prev; else delete previous.depts[s.dept[0]];
    }
  }
  return /** @type {FuelMemo} */ ({ generatedAt, shares, previous });
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

/** Durée maximale d'un relevé : un relevé bloqué ne doit pas figer la boucle d'une minute. */
export const READ_BUDGET_MS = 25_000;

/** Lecture bornée : échec ou délai dépassé donnent null (le délai est aussi noté dans `errors`). */
async function settle(/** @type {string} */ name, /** @type {(now: number) => Promise<any>} */ read, /** @type {number} */ now, /** @type {number} */ budget, /** @type {string[]} */ errors) {
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => { errors.push(`${name} : délai dépassé`); resolve(null); }, budget); });
  try { return (await Promise.race([Promise.resolve().then(() => read(now)), timeout])) ?? null; } catch { return null; } finally { clearTimeout(timer); }
}

/** Scénario enregistré avec une bascule qui vient d'être atteinte ? */
function newlyReached(/** @type {any} */ before, /** @type {any} */ after) {
  return (Array.isArray(after?.bascules) ? after.bascules : []).some((/** @type {any} */ b) => b.state === 'atteint'
    && !(Array.isArray(before?.bascules) ? before.bascules : []).some((/** @type {any} */ p) => p.id === b.id && p.state === 'atteint'));
}

/** Lignes d'inconnu propres à l'instantané : calendrier non configuré, stades non reconnus (club sans département), stades hors de France. */
function footballUnknown(/** @type {any} */ football) {
  if (!football) return [];
  if (football.configured === false) return ['Calendrier sportif non configuré'];
  const lines = (Array.isArray(football.matches) ? football.matches : []).filter((/** @type {any} */ m) => !m?.dept)
    .map((/** @type {any} */ m) => `${m?.abroad === true ? 'Stade hors de France' : 'Stade non reconnu'} : ${String(m?.home ?? 'n.d.')}`);
  return [...new Set(lines)];
}

async function run(/** @type {number} */ now, /** @type {any} */ readers) {
  const nowIso = new Date(now).toISOString();
  registry ??= await (readers.openRegistry ?? ((/** @type {number} */ at) => openRegistry({ now: at })))(now);
  let fuelMemo = state?.fuel ?? null;
  if (fuelMemo === null) {
    // Après un redémarrage : parts du dernier relevé archivé (2 h), pour garder la tendance.
    let archived = [];
    try { archived = await registry.signalsBetween(new Date(now - 2 * HOUR).toISOString(), nowIso); } catch { /* archive illisible : pas de tendance */ }
    fuelMemo = memoOfSignals(archived);
  }
  const names = ['protests', 'vigilance', 'rail', 'room', 'cyber', 'ecowatt', 'fuel', 'news', 'football'];
  /** @type {string[]} */
  const readErrors = [];
  const budget = typeof readers.budgetMs === 'number' ? readers.budgetMs : READ_BUDGET_MS;
  const labels = { protests: 'Manifestations', vigilance: 'Météo-France', rail: 'SNCF', room: 'Pannes', cyber: 'Veille cyber', ecowatt: 'Écowatt', fuel: 'Carburants', news: 'Presse', football: 'Calendrier sportif' };
  const values = await Promise.all(names.map((n) => settle(/** @type {Record<string, string>} */ (labels)[n], readers[`read${n[0].toUpperCase()}${n.slice(1)}`], now, budget, readErrors)));
  /** @type {Record<string, any>} */
  const inputs = {};
  names.forEach((n, i) => { inputs[n] = values[i]; });
  // Tendance carburants : à chaque nouveau relevé, les parts du relevé courant deviennent « précédentes ».
  if (inputs.fuel && typeof inputs.fuel.generatedAt === 'string' && inputs.fuel.generatedAt !== fuelMemo.generatedAt) {
    fuelMemo = { generatedAt: inputs.fuel.generatedAt, previous: fuelMemo.shares, shares: sharesOfFuel(inputs.fuel) };
  }
  if (inputs.fuel) inputs.fuel = withPrevious(inputs.fuel, fuelMemo);

  if (Array.isArray(inputs.football?.errors)) readErrors.push(...inputs.football.errors);
  const { signals, unknown, errors: signalErrors } = toSignals(/** @type {any} */ (inputs), now);
  const rules = readers.rules ?? RULES;
  const before = new Map(registry.state());
  const { opened, revised, open, errors: engineErrors } = evaluate(signals, registry, now, rules, unknown);
  for (const s of opened) await registry.record({ at: nowIso, type: 'ouverture', scenario: s });
  // Les retours arrivés pendant le tick sont relus juste avant l'écriture : aucun vote perdu.
  const keepVotes = (/** @type {any} */ s) => ({ ...s, feedback: registry.state().get(s.id)?.feedback ?? s.feedback });
  for (const s of revised) await registry.record({ at: nowIso, type: newlyReached(before.get(s.id), s) ? 'bascule' : 'revision', scenario: keepVotes(s) });
  for (const c of await closeDue(open, signals, rules, now, { registry, unknown })) await registry.record({ at: nowIso, type: 'cloture', scenario: keepVotes(c.scenario) });
  const stillOpen = [...registry.state().values()].filter((/** @type {any} */ s) => s.status === 'ouvert');
  for (const m of missedCrises(signals, stillOpen, [...registry.state().values()], now)) await registry.record({ at: nowIso, type: 'manque', scenario: m });
  await registry.archiveSignals(signals, now);
  let compactDay = state?.compactDay ?? '';
  if (compactDay !== parisDay(now)) {
    compactDay = parisDay(now);
    await registry.compact(now);
    registry.prune?.(now); // mémoire : clos d'avant le mois précédent oubliés (même période qu'après un redémarrage)
  }

  // Règle d'arrêt (spec § 11) : les scénarios d'une règle en revue ne sont plus servis.
  const served = capOpen([...registry.state().values()].filter((/** @type {any} */ s) => s.status === 'ouvert'), now, rulesInReview([...registry.state().values()], rules));
  const upcoming = upcomingFromSources({
    ecowatt: inputs.ecowatt ? { official: inputs.ecowatt } : null, vigilance: inputs.vigilance,
    protests: Array.isArray(inputs.protests?.items) ? inputs.protests.items : null, floods: null, now,
  }, { phenomenonWord: PHENOMENON_WORD, readForecast: () => null });
  const agenda = buildAgenda(served, upcoming, now);
  // Note de 7 h : figée une fois par jour de Paris, au premier tick à partir de 07:00. Le drapeau est en mémoire ; après un redémarrage
  // on regarde si le fichier du jour existe déjà.
  let frozenDay = state?.frozenDay ?? '';
  const today = parisDay(now);
  if (frozenDay !== today && parisHour(now) >= 7) {
    let failure = null;
    if (!(await noteExists(registry.root, today))) {
      const closedSince = [...registry.state().values()].filter((/** @type {any} */ s) => s.closedAt && s.status !== 'ouvert' && s.status !== 'manque' && Date.parse(s.closedAt) >= now - 24 * HOUR);
      failure = await writeNote(registry.root, buildNote(served, agenda, closedSince, now, [...publicErrors(readErrors), ...unknown]));
      if (failure && !registry.errors.includes(failure)) registry.errors.push(failure);
    }
    if (failure === null) frozenDay = today; // erreur passagère : nouvel essai au tick suivant
  }
  state = {
    tickAt: now, signals, scenarios: served.map(withExposure), agenda,
    // Calendrier sportif sans clé : nommé dans l'instantané seulement (ni dans la note ni dans les relevés de la règle).
    unknown: [...unknown, ...footballUnknown(inputs.football)],
    errors: [...readErrors, ...signalErrors, ...engineErrors, ...registry.errors], fuel: fuelMemo, compactDay, frozenDay,
  };
  failedAt = null;
  logOnce(state.errors);
}

/** Tick de l'anticipation : au plus un toutes les 55 s, un seul à la fois. Ne lève jamais. */
export async function tickAnticipation(now = Date.now(), readers = DEFAULT_READERS) {
  if (state !== null && state.tickAt > 0 && now - state.tickAt < TICK_MIN_MS) return;
  running ??= run(now, { ...DEFAULT_READERS, ...readers }).catch((err) => {
    failedAt = now;
    logOnce([`tick en échec : ${errMsg(err)}`]);
  }).finally(() => { running = null; });
  await running;
}

async function ensureState(/** @type {number} */ now, /** @type {any} */ readers) {
  if (state !== null && state.tickAt > 0 && now - state.tickAt <= SNAPSHOT_STALE_MS) return;
  // Tick en échec il y a moins d'une minute : on sert le dernier état (ou un instantané vide) sans tout recalculer à chaque requête.
  if (failedAt !== null && now - failedAt < RETRY_AFTER_FAILURE_MS) return;
  await tickAnticipation(now, readers);
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
    unknown: state?.unknown ?? [],
    // Libellés publics seulement (aucun chemin du serveur) ; l'échec du dernier tick est nommé tant qu'il n'est pas réessayé avec succès.
    errors: publicErrors([...(state?.errors ?? []), ...(failedAt !== null ? [TICK_FAILED_LABEL] : [])]),
  };
}

/**
 * Enregistre un retour sur un scénario connu, ouvert ou clos (décision du 04/11/2026 : le bilan « utile » compte aussi les scénarios clos) (compteur + ligne « retour » du journal). Renvoie false si le scénario est inconnu.
 * @param {string} scenarioId
 * @param {'utile'|'deja_su'|'faux'} vote
 * @param {number} [now]
 */
export async function recordFeedback(scenarioId, vote, now = Date.now(), readers = DEFAULT_READERS) {
  await ensureState(now, readers);
  const current = registry?.state().get(scenarioId);
  if (!registry || !current) return false;
  // Ligne compacte (id + vote) : le journal ne recopie plus le scénario entier à chaque retour.
  if (!(await registry.recordVote(scenarioId, vote, now))) return false;
  const next = registry.state().get(scenarioId);
  if (state && next) state.scenarios = state.scenarios.map((/** @type {any} */ s) => (s.id === scenarioId ? next : s));
  return true;
}

/**
 * Note de 7 h : celle du jour demandé, ou (sans jour) celle d'aujourd'hui si elle est figée, sinon celle de la veille. Null si absente.
 * @param {string|null} [day] AAAA-MM-JJ
 * @param {number} [now]
 */
export async function anticipationNote(day = null, now = Date.now(), readers = DEFAULT_READERS) {
  await ensureState(now, readers);
  const root = registry?.root;
  if (!root) return null;
  return day ? readNote(root, day) : latestNote(root, [parisDay(now), parisDay(Date.parse(`${parisDay(now)}T12:00:00Z`) - 86_400_000)]);
}

/**
 * Bilan d'un mois de Paris (AAAA-MM, mois courant par défaut) : scénarios ouverts dans ce mois. Le mois courant et le précédent viennent
 * de la mémoire du registre, les plus anciens du journal de leur mois.
 * @param {string|null} [month]
 * @param {number} [now]
 */
export async function anticipationBilan(month = null, now = Date.now(), readers = DEFAULT_READERS) {
  await ensureState(now, readers);
  const key = month || parisDay(now).slice(0, 7);
  if (!registry) return buildBilan(key, [], RULES);
  const current = parisDay(now).slice(0, 7);
  const recent = key === current || key === previousMonth(current);
  const source = recent ? registry.state() : await registry.scenariosOfMonth(key);
  const mine = [...source.values()].filter((/** @type {any} */ s) => parisDay(Date.parse(s.openedAt)).slice(0, 7) === key);
  // Le drapeau « en revue » décrit l'état courant de la règle (même calcul que le filtre des scénarios servis), pas le mois demandé.
  return buildBilan(key, mine, RULES, rulesInReview([...registry.state().values()], RULES));
}
