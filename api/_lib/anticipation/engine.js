// api/_lib/anticipation/engine.js : moteur de règles de l'anticipation (04/11/2026).
// Évalue les règles sur les signaux, applique le plancher des grilles, ouvre ou révise les scénarios (jamais de doublon : même règle,
// même premier département, fenêtres qui se chevauchent). N'écrit rien : l'appelant enregistre `opened` et `revised` dans le registre.
import { applyFloor, WORDS, wordWhy } from './probability.js';
import { RULES } from './rules/index.js';

/** @typedef {import('./probability.js').Signal} Signal */
/** @typedef {import('./registry.js').Scenario} Scenario */

const MAX_NATIONAL = 5;
const MAX_PER_DEPT = 3;
const errMsg = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e));

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Dernier jour (Paris) d'un scénario arrivé de cette règle dans ce département, ou null. */
function precedentIn(/** @type {Map<string, Scenario>} */ state, /** @type {string} */ ruleId, /** @type {string} */ dept) {
  let best = null;
  for (const s of state.values()) {
    if (s.ruleId !== ruleId || s.status !== 'arrive' || s.zone?.dept?.[0] !== dept) continue;
    const t = Date.parse(s.closedAt ?? '');
    if (Number.isFinite(t) && (best === null || t > best)) best = t;
  }
  return best === null ? null : dayFmt.format(new Date(best));
}

const deptKey = (/** @type {{ zone: { dept: string[] } }} */ s) => s.zone?.dept?.[0] ?? 'national';
const overlap = (/** @type {{from: string, to: string}} */ a, /** @type {{from: string, to: string}} */ b) => {
  const af = Date.parse(a.from), at = Date.parse(a.to), bf = Date.parse(b.from), bt = Date.parse(b.to);
  return af <= bt && bf <= at;
};

/**
 * @param {Signal[]|null} signals
 * @param {{ state(): Map<string, Scenario> }} registry
 * @param {number} now Heure de référence en ms.
 * @param {import('./rules/index.js').CrossRule[]} [rules]
 * @returns {{ opened: Scenario[], revised: Scenario[], open: Scenario[], errors: string[] }}
 */
export function evaluate(signals, registry, now, rules = RULES) {
  const list = Array.isArray(signals) ? signals : [];
  const state = registry.state();
  const nowIso = new Date(now).toISOString();
  const ctx = { now, precedent: (/** @type {string} */ ruleId, /** @type {string} */ dept) => precedentIn(state, ruleId, dept) };
  /** @type {string[]} */
  const errors = [];
  /** @type {Map<string, Scenario>} */
  const pool = new Map();
  for (const [id, s] of state) if (s.status === 'ouvert') pool.set(id, s);
  /** @type {Set<string>} */
  const openedIds = new Set();
  /** @type {Set<string>} */
  const revisedIds = new Set();

  for (const rule of rules) {
    /** @type {import('./rules/index.js').Candidate[]} */
    let candidates;
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
        const existing = [...pool.values()].find((s) => s.ruleId === c.ruleId && deptKey(s) === key && overlap(s.window, c.window));
        if (existing) {
          // Une bascule déjà atteinte le reste, même si le signal qui l'a levée a disparu entre-temps.
          const bascules = c.bascules.map((b) => {
            const prev = existing.bascules?.find((p) => p.id === b.id);
            return prev && prev.state === 'atteint' && b.state !== 'atteint' ? prev : b;
          });
          const { evidence: _evidence, ...fields } = c;
          void _evidence;
          const next = { ...existing, ...fields, bascules, word, why, id: existing.id, openedAt: existing.openedAt, status: existing.status, closedAt: existing.closedAt,
            outcomeNote: existing.outcomeNote, feedback: existing.feedback, revisedAt: nowIso };
          pool.set(existing.id, next);
          revisedIds.add(existing.id);
        } else {
          const { evidence: _evidence, ...fields } = c;
          void _evidence;
          const id = `${c.ruleId}:${key === 'national' ? 'national' : key}:${c.window.from}`;
          pool.set(id, { ...fields, id, word, why, openedAt: nowIso, revisedAt: nowIso, status: 'ouvert', closedAt: null, outcomeNote: null, feedback: { utile: 0, deja_su: 0, faux: 0 } });
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

/**
 * Plafonds d'affichage : 5 scénarios nationaux, 3 par département ; les autres restent au registre sans être servis.
 * Tri : mot le plus fort d'abord, puis ouverture la plus ancienne.
 * @param {Scenario[]} open
 * @returns {Scenario[]}
 */
export function capOpen(open) {
  const sorted = [...(Array.isArray(open) ? open : [])].sort((a, b) => WORDS.indexOf(/** @type {any} */ (b.word)) - WORDS.indexOf(/** @type {any} */ (a.word))
    || Date.parse(a.openedAt) - Date.parse(b.openedAt));
  /** @type {Map<string, number>} */
  const count = new Map();
  return sorted.filter((s) => {
    const key = deptKey(s);
    const n = count.get(key) ?? 0;
    if (n >= (key === 'national' ? MAX_NATIONAL : MAX_PER_DEPT)) return false;
    count.set(key, n + 1);
    return true;
  });
}
