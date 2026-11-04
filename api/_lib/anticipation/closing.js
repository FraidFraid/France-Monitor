// api/_lib/anticipation/closing.js : clôture des scénarios échus et crises manquées (04/11/2026, spec § 8).
// `closeDue` juge avec les signaux observés PENDANT la fenêtre (archive du registre) réunis aux signaux courants, jamais le seul
// instantané : une arrivée vue puis disparue reste une arrivée. `missedCrises` consigne ce que le moteur n'avait pas anticipé.
// Aucun texte de jugement n'est produit par une IA : les notes sont des gabarits.
import { cleanSignals, firstDept } from './rules/common.js';

/** @typedef {import('./probability.js').Signal} Signal */
/** @typedef {import('./registry.js').Scenario} Scenario */

const H = 3_600_000;
const CLOSE_AFTER_MS = 2 * H; // la fenêtre doit être terminée depuis 2 h
const EXPIRE_AFTER_MS = 48 * H;
const MISSED_LOOKBACK_MS = 24 * H;
const errMsg = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e));

/**
 * Réunit des listes de signaux sans écraser aucune observation : on garde chaque couple (id, observedAt) distinct, les doublons exacts
 * seuls sont retirés. Un signal encore présent à la clôture (carburants, Écowatt, panne) ne remplace donc pas sa copie datée de la
 * fenêtre ; les règles, qui testent chaque enregistrement (observedAt, publishedAt, valeur, niveau), voient les deux.
 * @param {...Signal[]} lists
 * @returns {Signal[]}
 */
function mergeSignals(...lists) {
  /** @type {Map<string, Signal>} */
  const seen = new Map();
  for (const s of lists.flatMap((l) => cleanSignals(l))) {
    const key = `${s.id}|${s.observedAt}`;
    if (!seen.has(key)) seen.set(key, s);
  }
  return [...seen.values()];
}

/**
 * Signaux à juger pour un scénario : archive de sa fenêtre + signaux courants (doublons exacts retirés, voir mergeSignals).
 * Sans registre (ou lecture impossible) : les signaux courants seuls.
 * @param {{ signalsBetween?: (from: string, to: string) => Promise<Signal[]> }|null|undefined} registry
 * @param {Scenario} scenario
 * @param {Signal[]} current
 * @returns {Promise<Signal[]>}
 */
export async function collectWindowSignals(registry, scenario, current) {
  /** @type {Signal[]} */
  let archived = [];
  try {
    if (registry?.signalsBetween && scenario?.window) archived = await registry.signalsBetween(scenario.window.from, scenario.window.to);
  } catch {
    archived = []; // archive illisible : on juge avec l'instantané, sans lever
  }
  return mergeSignals(archived, cleanSignals(current));
}

const NOTES = Object.freeze({
  arrive: "Arrivé : un fait du test d'arrivée de la règle a été relevé pendant la fenêtre.",
  pas_arrive: "Pas arrivé : les relevés ont été lus pendant la fenêtre et n'ont pas montré le fait attendu.",
  indecidable: "Indécidable : un relevé nécessaire n'a pas été lu pendant la fenêtre, on ne peut pas conclure.",
  expire: "Expiré : la fenêtre est terminée depuis plus de 48 h sans décision de la règle.",
});

/**
 * Clôture les scénarios ouverts dont la fenêtre est terminée depuis plus de 2 h. Statut donné par `rule.arrived` (null : indécidable,
 * puis expiré au-delà de 48 h). Le scénario rendu est la copie close (statut, `closedAt`, `outcomeNote`) à enregistrer par l'appelant.
 * Asynchrone car il relit l'archive des signaux de la fenêtre.
 * @param {Scenario[]} open
 * @param {Signal[]} signals Signaux courants.
 * @param {import('./rules/index.js').CrossRule[]} rules
 * @param {number} now
 * @param {{ registry?: { signalsBetween?: (from: string, to: string) => Promise<Signal[]> }, unknown?: string[] }} [opts]
 * @returns {Promise<Array<{ scenario: Scenario, status: 'arrive'|'pas_arrive'|'indecidable'|'expire', note: string }>>}
 */
export async function closeDue(open, signals, rules, now, opts = {}) {
  const unknown = Array.isArray(opts.unknown) ? opts.unknown : [];
  /** @type {Array<{ scenario: Scenario, status: 'arrive'|'pas_arrive'|'indecidable'|'expire', note: string }>} */
  const out = [];
  for (const s of Array.isArray(open) ? open : []) {
    if (!s || s.status !== 'ouvert') continue;
    const to = Date.parse(s.window?.to ?? '');
    if (!Number.isFinite(to) || !(to + CLOSE_AFTER_MS < now)) continue;
    const rule = (rules ?? []).find((r) => r.id === s.ruleId);
    /** @type {'arrive'|'pas_arrive'|'indecidable'|null} */
    let verdict = null;
    let failure = '';
    if (rule) {
      try {
        verdict = rule.arrived(s, await collectWindowSignals(opts.registry, s, signals), { now, unknown });
      } catch (e) {
        failure = ` (règle en erreur : ${errMsg(e)})`;
      }
    }
    /** @type {'arrive'|'pas_arrive'|'indecidable'|'expire'} */
    const status = verdict ?? (to + EXPIRE_AFTER_MS < now ? 'expire' : 'indecidable');
    const note = `${NOTES[status]}${failure}`;
    out.push({ scenario: { ...s, status, closedAt: new Date(now).toISOString(), outcomeNote: note }, status, note });
  }
  return out;
}

/**
 * Signal qui aurait dû ouvrir un scénario. Dans ce moteur, une « crise » est une panne rouge ou un événement de presse consolidé
 * critique ou élevé en sécurité ou social : le moteur de situations du client n'est pas disponible côté serveur.
 */
function isCrisis(/** @type {Signal} */ s) {
  if (s.kind === 'presse') {
    const sev = s.meta?.severity;
    return (s.meta?.category === 'security' || s.meta?.category === 'social') && (sev === 'critical' || sev === 'high');
  }
  return s.kind === 'panne' && s.level === 'rouge';
}
const crisisRank = (/** @type {Signal} */ s) => (s.level === 'rouge' || s.meta?.severity === 'critical' ? 0 : 1);

/**
 * Crises que le moteur n'avait pas anticipées : un signal grave dans un département où aucun scénario n'a été ouvert dans les 24 h
 * précédentes (ouverts, clos et déjà consignés compris). Un seul par département et par appel ; id stable `manque:<id du signal>`,
 * jamais consigné deux fois. Sans département, pas de comparaison possible : ignoré.
 * @param {Signal[]} signals
 * @param {Scenario[]} open
 * @param {Scenario[]} recent Scénarios récents, clos compris.
 * @param {number} now
 * @returns {Scenario[]}
 */
export function missedCrises(signals, open, recent, now) {
  const known = [...(Array.isArray(open) ? open : []), ...(Array.isArray(recent) ? recent : [])].filter((s) => s && typeof s === 'object');
  const knownIds = new Set(known.map((s) => s.id));
  /**
   * Un scénario couvre la crise s'il a été ouvert strictement avant elle (un scénario ouvert en réaction ne compte pas) et s'il était
   * encore ouvert à un moment de [t - 24 h, t) : un scénario de longue durée toujours ouvert couvre son département.
   */
  const covers = (/** @type {Scenario} */ sc, /** @type {string} */ dept, /** @type {number} */ t) => {
    if (!(Array.isArray(sc.zone?.dept) && sc.zone.dept.includes(dept))) return false;
    const opened = Date.parse(sc.openedAt ?? '');
    if (!Number.isFinite(opened) || !(opened < t)) return false;
    if (sc.closedAt == null) return true;
    const closed = Date.parse(sc.closedAt);
    return Number.isFinite(closed) && closed >= t - MISSED_LOOKBACK_MS;
  };
  /** @type {Set<string>} */
  const handled = new Set(); // départements déjà consignés pendant cet appel
  const nowIso = new Date(now).toISOString();
  /** @type {Scenario[]} */
  const out = [];
  for (const s of cleanSignals(signals).filter(isCrisis).sort((a, b) => crisisRank(a) - crisisRank(b))) {
    const dept = firstDept(s);
    const id = `manque:${s.id}`;
    const at = Date.parse(s.publishedAt ?? s.observedAt ?? '');
    if (!dept || handled.has(dept) || knownIds.has(id)) continue;
    if (Number.isFinite(at) && known.some((sc) => covers(sc, dept, at))) continue;
    handled.add(dept); // un seul par département et par appel
    const when = Number.isFinite(at) ? new Date(at).toISOString() : nowIso;
    out.push({
      id,
      ruleId: 'aucune',
      ruleVersion: 0,
      zone: { dept: [dept], communes: Array.isArray(s.communes) ? s.communes : [] },
      window: { from: when, to: when },
      title: 'Crise sans scénario anticipé',
      chain: [{ text: "Signal grave relevé dans un département où aucun scénario n'avait été ouvert dans les 24 h précédentes", signalIds: [s.id] }],
      word: '',
      why: '',
      unknowns: [],
      bascules: [],
      disconfirmers: [],
      verify: [],
      openedAt: nowIso,
      revisedAt: nowIso,
      status: 'manque',
      closedAt: nowIso,
      outcomeNote: "Manquée : aucune règle n'avait ouvert de scénario pour ce département.",
      feedback: { utile: 0, deja_su: 0, faux: 0 },
    });
  }
  return out;
}
