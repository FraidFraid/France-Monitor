// api/_lib/anticipation/engine.js : moteur de règles de l'anticipation (04/11/2026).
// Évalue les règles sur les signaux, applique le plancher des grilles, ouvre ou révise les scénarios (jamais de doublon : même règle,
// même premier département, fenêtres qui se chevauchent). N'écrit rien : l'appelant enregistre `opened` et `revised` dans le registre.
import { applyFloor, peakWordOf, WORDS, wordWhy } from './probability.js';
import { parisDay } from '../../../src/services/paris-day.js';
import { RULES } from './rules/index.js';

/** @typedef {import('./probability.js').Signal} Signal */
/** @typedef {import('./registry.js').Scenario} Scenario */

const MAX_NATIONAL = 5;
const MAX_PER_DEPT = 3;
const errMsg = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e));


/** Dernier jour (Paris) d'un scénario arrivé de cette règle dans ce département, ou null. */
function precedentIn(/** @type {Map<string, Scenario>} */ state, /** @type {string} */ ruleId, /** @type {string} */ dept) {
  let best = null;
  for (const s of state.values()) {
    if (s.ruleId !== ruleId || s.status !== 'arrive' || s.zone?.dept?.[0] !== dept) continue;
    const t = Date.parse(s.closedAt ?? '');
    if (Number.isFinite(t) && (best === null || t > best)) best = t;
  }
  return best === null ? null : parisDay(best);
}

const deptKey = (/** @type {{ zone: { dept: string[] } }} */ s) => s.zone?.dept?.[0] ?? 'national';
/** Recoupement strict : deux demi-journées voisines (fin de l'une = début de l'autre) ne se chevauchent pas. */
const overlap = (/** @type {{from: string, to: string}} */ a, /** @type {{from: string, to: string}} */ b) => {
  const af = Date.parse(a.from), at = Date.parse(a.to), bf = Date.parse(b.from), bt = Date.parse(b.to);
  return af < bt && bf < at;
};
const sameJson = (/** @type {unknown} */ a, /** @type {unknown} */ b) => JSON.stringify(a) === JSON.stringify(b);
const LEVEL_RANK = /** @type {Record<string, number>} */ ({ jaune: 1, orange: 2, rouge: 3 });
const levelRank = (/** @type {unknown} */ l) => LEVEL_RANK[String(l)] ?? 0;

/**
 * Baseline de citation (clôture) : pour chaque id déjà cité, le niveau le plus bas jamais écrit, de sorte qu'une montée ultérieure
 * reste détectable par `arrived` même après plusieurs révisions. Un niveau qui baisse abaisse la baseline.
 * @param {Scenario['chain']} previous Chaîne déjà enregistrée.
 * @param {Scenario['chain']} next Chaîne du candidat.
 * @returns {Scenario['chain']}
 */
function keepLowestLevels(previous, next) {
  /** @type {Map<string, string|null>} */
  const lowest = new Map();
  for (const step of Array.isArray(previous) ? previous : []) {
    for (const [id, level] of Object.entries(step?.levels ?? {})) {
      if (!lowest.has(id) || levelRank(level) < levelRank(lowest.get(id))) lowest.set(id, level);
    }
  }
  return next.map((step) => {
    if (!step.levels) return step;
    const levels = Object.fromEntries(Object.entries(step.levels).map(([id, level]) => [id, lowest.has(id) && levelRank(lowest.get(id)) < levelRank(level) ? /** @type {string|null} */ (lowest.get(id)) : level]));
    return { ...step, levels };
  });
}
/**
 * Chaîne normalisée : identifiants triés, clés de `levels` triées. L'ordre d'arrivée des signaux ne fait donc jamais réviser un scénario.
 * @param {Scenario['chain']} chain
 * @returns {Scenario['chain']}
 */
export function normalizeChain(chain) {
  return (Array.isArray(chain) ? chain : []).map((step) => {
    if (!step || typeof step !== 'object') return step;
    const ids = Array.isArray(step.signalIds) ? [...step.signalIds].sort() : step.signalIds;
    const out = { ...step, signalIds: ids };
    if (step.levels && typeof step.levels === 'object') out.levels = Object.fromEntries(Object.entries(step.levels).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    return out;
  });
}
const WATCHED = /** @type {const} */ (['word', 'why', 'title', 'chain', 'bascules', 'window', 'unknowns', 'verify', 'disconfirmers']);

/**
 * @param {Signal[]|null} signals
 * @param {{ state(): Map<string, Scenario> }} registry
 * @param {number} now Heure de référence en ms.
 * @param {import('./rules/index.js').CrossRule[]} [rules]
 * @param {string[]} [unknown] Relevés absents ou périmés (liste `unknown` de toSignals), transmise aux règles.
 * @returns {{ opened: Scenario[], revised: Scenario[], open: Scenario[], errors: string[] }}
 */
export function evaluate(signals, registry, now, rules = RULES, unknown = []) {
  const list = Array.isArray(signals) ? signals : [];
  const state = registry.state();
  const nowIso = new Date(now).toISOString();
  const ctx = { now, unknown: Array.isArray(unknown) ? unknown : [], precedent: (/** @type {string} */ ruleId, /** @type {string} */ dept) => precedentIn(state, ruleId, dept) };
  /** @type {string[]} */
  const errors = [];
  /** @type {Map<string, Scenario>} */
  const pool = new Map();
  for (const [id, s] of state) if (s.status === 'ouvert') pool.set(id, s);
  // Seuls les scénarios déjà ouverts avant ce tick peuvent être révisés ; deux demi-journées voisines restent deux scénarios.
  const before = [...pool.values()];
  const closed = [...state.values()].filter((s) => s.status !== 'ouvert');
  /** @type {Set<string>} */
  const openedIds = new Set();
  /** @type {Set<string>} */
  const revisedIds = new Set();

  for (const rule of rules) {
    /** @type {import('./rules/index.js').Candidate[]} */
    let candidates;
    if (rule.suspended) continue; // règle suspendue : plus d'émission, ses scénarios ouverts restent clos par closeDue
    try {
      candidates = rule.evaluate(list, ctx);
      if (!Array.isArray(candidates)) candidates = [];
    } catch (e) {
      errors.push(`Règle ${rule.id} : ${errMsg(e)}`);
      continue;
    }
    for (const c of candidates) {
      try {
        if (!c?.window?.from || !c.window.to || !c.evidence) throw new Error('candidat incomplet');
        const word = applyFloor(/** @type {import('./probability.js').Word} */ (c.word), c.evidence);
        const why = wordWhy(c.evidence);
        const key = deptKey(c);
        const id = `${c.ruleId}:${key}:${c.window.from}`;
        // Scénario déjà clos (même id, ou même règle, même département et fenêtre qui se chevauche) : jamais rouvert ni écrasé.
        if (closed.some((s) => s.id === id || (s.ruleId === c.ruleId && deptKey(s) === key && overlap(s.window, c.window)))) continue;
        const existing = before.find((s) => s.ruleId === c.ruleId && deptKey(s) === key && overlap(s.window, c.window));
        if (existing) {
          // Une bascule déjà atteinte le reste, même si le signal qui l'a levée a disparu entre-temps.
          const bascules = c.bascules.map((b) => {
            const prev = existing.bascules?.find((p) => p.id === b.id);
            // Atteinte puis toujours atteinte : on garde l'ancienne (date comprise), sinon l'heure de lecture ferait réviser à chaque tick.
            return prev && prev.state === 'atteint' ? prev : b;
          });
          const { evidence: _evidence, ...fields } = c;
          void _evidence;
          const next = { ...existing, ...fields, chain: normalizeChain(keepLowestLevels(existing.chain, normalizeChain(fields.chain))), bascules, word, peakWord: peakWordOf({ word, peakWord: peakWordOf(existing) }), why, id: existing.id, openedAt: existing.openedAt, status: existing.status, closedAt: existing.closedAt,
            outcomeNote: existing.outcomeNote, feedback: existing.feedback, revisedAt: nowIso };
          // Comparaison à la chaîne enregistrée normalisée : un scénario écrit avant la normalisation ne révise pas pour l'ordre seul.
          const was = { ...existing, chain: normalizeChain(existing.chain) };
          const changed = WATCHED.some((k) => !sameJson(/** @type {Record<string, unknown>} */ (next)[k], /** @type {Record<string, unknown>} */ (was)[k]));
          if (changed) {
            pool.set(existing.id, next);
            revisedIds.add(existing.id);
          }
        } else {
          const { evidence: _evidence, ...fields } = c;
          void _evidence;
          if (pool.has(id)) continue; // même candidat deux fois dans le tick
          pool.set(id, { ...fields, chain: normalizeChain(fields.chain), id, word, peakWord: word, why, openedAt: nowIso, revisedAt: nowIso, status: 'ouvert', closedAt: null, outcomeNote: null, feedback: { utile: 0, deja_su: 0, faux: 0 } });
          openedIds.add(id);
        }
      } catch (e) {
        errors.push(`Règle ${rule.id} : candidat écarté : ${errMsg(e)}`);
      }
    }
  }

  const opened = [...openedIds].map((id) => /** @type {Scenario} */ (pool.get(id)));
  const revised = [...revisedIds].filter((id) => !openedIds.has(id)).map((id) => /** @type {Scenario} */ (pool.get(id)));
  return { opened, revised, open: [...pool.values()], errors };
}

const dayOf = parisDay;

/**
 * Plafonds d'affichage : 5 scénarios nationaux dont la fenêtre recoupe aujourd'hui (jour de Paris), 3 par département et par jour de Paris
 * (jour de début de la fenêtre) ; les jours futurs ne comptent pas dans le plafond national. Les autres restent au registre sans être servis.
 * Tri : mot le plus fort d'abord, puis ouverture la plus ancienne.
 * @param {Scenario[]} open
 * @param {number} [now]
 * @param {Set<string>} [inReview] Identifiants des règles en revue : leurs scénarios ne sont pas servis.
 * @returns {Scenario[]}
 */
export function capOpen(open, now = Date.now(), inReview = new Set()) {
  const rank = (/** @type {Scenario} */ s) => WORDS.indexOf(/** @type {import('./probability.js').Word} */ (s.word));
  // Une règle en revue (règle d'arrêt, spec § 11) n'est plus servie.
  const sorted = [...(Array.isArray(open) ? open : [])].filter((s) => !inReview.has(s.ruleId)).sort((a, b) => rank(b) - rank(a) || Date.parse(a.openedAt) - Date.parse(b.openedAt));
  const today = dayOf(now);
  /** @type {Map<string, number>} */
  const count = new Map();
  return sorted.filter((s) => {
    const from = Date.parse(s.window?.from ?? ''), to = Date.parse(s.window?.to ?? '');
    const national = deptKey(s) === 'national';
    let key;
    let max;
    if (national) {
      const intersectsToday = Number.isFinite(from) && Number.isFinite(to) && dayOf(from) <= today && dayOf(Math.max(from, to - 1)) >= today;
      if (!intersectsToday) return true; // jour futur ou passé : pas de plafond national
      key = 'national';
      max = MAX_NATIONAL;
    } else {
      key = `${deptKey(s)}|${Number.isFinite(from) ? dayOf(from) : 'n.d.'}`;
      max = MAX_PER_DEPT;
    }
    const n = count.get(key) ?? 0;
    if (n >= max) return false;
    count.set(key, n + 1);
    return true;
  });
}
