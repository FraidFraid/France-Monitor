// api/_lib/anticipation/rules/evenement-mobilisation.js : règle 6 (v1, 04/11/2026), match de football × rassemblements ou mouvement social
// dans les transports, même département et même demi-journée. Texte fixé par gabarit, aucun mot ni chiffre produit par une IA.
// Un stade non reconnu (sans département) est nommé dans l'instantané, pas ici.
// Sans clé football-data, aucun signal sportif n'existe : la règle ne renvoie rien (le snapshot nomme « Calendrier sportif non configuré »).
import { DEPT_NAMES } from '../../../_shared/departments.js';
import { cleanSignals, evidenceOf, inDept, inPlace, span } from './common.js';
import { halfDaysOverlapping, parisDayBounds, parisDayLabel } from './paris-time.js';
import mobilisationTransports from './mobilisation-transports.js';

/** @typedef {import('../probability.js').Signal} Signal */

export const RULE_ID = 'evenement-mobilisation';
const RALLY = new Set(['rassemblement_annonce', 'rassemblement_signale']);
const DAY_MS = 86_400_000;
const meets = (/** @type {{from: number, to: number}|null} */ w, /** @type {number} */ from, /** @type {number} */ to) =>
  w !== null && w.from < to && Math.max(w.to, w.from + 1) > from;

/** Intervalle d'un mouvement social : sa fenêtre, ou le jour de Paris de sa publication (presse, moins de 24 h). */
function socialSpan(/** @type {Signal} */ s, /** @type {number} */ now) {
  const w = span(s);
  if (w) return w;
  if (!String(s.origin).startsWith('presse:')) return null;
  const t = Date.parse(s.publishedAt ?? '');
  if (!Number.isFinite(t) || now - t > DAY_MS || t - now > 5 * 60_000) return null;
  return parisDayBounds(t);
}

/** @type {import('./index.js').CrossRule} */
const rule = {
  id: RULE_ID,
  version: 1,
  title: "Saturation des transports et de l'espace public autour du stade",
  domains: ['event', 'social', 'transport'],
  arrivalTest: "Un événement de presse de sécurité ou social avec violences, ou une perturbation de transport, est relevé dans le département pendant la demi-journée du match.",
  evaluate(signals, ctx) {
    const all = cleanSignals(signals);
    const matches = all.filter((s) => s.kind === 'evenement_sportif' && span(s));
    const rallies = all.filter((s) => RALLY.has(s.kind) && span(s));
    const socials = all.filter((s) => s.kind === 'mouvement_social_transport' && socialSpan(s, ctx.now));
    const arretes = all.filter((s) => s.kind === 'arrete_prefectoral');
    /** @type {import('./index.js').Candidate[]} */
    const out = [];
    /** @type {Set<string>} */
    const seen = new Set();
    for (const match of matches.filter((s) => Array.isArray(s.dept) && s.dept.length).sort((a, b) => a.id.localeCompare(b.id))) {
      const dept = /** @type {string} */ (match.dept[0]);
      const w = /** @type {{from: number, to: number}} */ (span(match));
      const kickoff = w.from + 2 * 3_600_000;
      const slot = halfDaysOverlapping(kickoff, kickoff).find((h) => h.from <= kickoff && kickoff < h.to);
      if (!slot || slot.to <= ctx.now) continue;
      const key = `${dept}:${slot.from}`;
      if (seen.has(key)) continue;
      // Triés par id : le match nommé et le libellé ne dépendent pas de l'ordre d'arrivée des signaux.
      const byId = (/** @type {Signal} */ a, /** @type {Signal} */ b) => a.id.localeCompare(b.id);
      const sm = matches.filter((s) => inDept(s, dept) && meets(span(s), slot.from, slot.to)).sort(byId);
      const sr = rallies.filter((s) => inDept(s, dept) && meets(span(s), slot.from, slot.to)).sort(byId);
      const ss = socials.filter((s) => inDept(s, dept) && meets(socialSpan(s, ctx.now), slot.from, slot.to)).sort(byId);
      if (!sr.length && !ss.length) continue;
      seen.add(key);
      const cited = [...sm, ...sr, ...ss];
      const arrete = arretes.find((a) => inDept(a, dept) && meets(span(a), slot.from, slot.to));
      const name = /** @type {Record<string, string>} */ (DEPT_NAMES)[dept] ?? dept;
      const where = inPlace(dept, DEPT_NAMES);
      const today = parisDayBounds(ctx.now);
      const when = slot.from >= today.from && slot.from < today.to ? slot.label : `${slot.label} du ${parisDayLabel(slot.from)}`;
      // Match(s) du stade dans la demi-journée, nommés d'après leurs propres signaux (le match évalué en premier).
      const named = [match, ...sm.filter((s) => s.id !== match.id)];
      const label = named.map((s) => (s.meta?.home && s.meta?.away ? `${s.meta.home} contre ${s.meta.away}` : 'match')).join(' et ');
      out.push({
        ruleId: RULE_ID,
        ruleVersion: 1,
        zone: { dept: [dept], communes: [...new Set(named.flatMap((s) => (Array.isArray(s.communes) ? s.communes : [])))] },
        window: { from: new Date(slot.from).toISOString(), to: new Date(slot.to).toISOString() },
        title: rule.title,
        chain: [
          { text: `${named.length > 1 ? 'Matchs' : 'Match'} ${label} ${where}, ${when}`, signalIds: sm.map((s) => s.id) },
          { text: sr.length && ss.length
            ? `${sr.length} rassemblement${sr.length > 1 ? 's' : ''} et ${ss.length} mouvement${ss.length > 1 ? 's' : ''} social${ss.length > 1 ? 'aux' : ''} dans les transports, même département, même demi-journée`
            : sr.length
              ? `${sr.length} rassemblement${sr.length > 1 ? 's' : ''} annoncé${sr.length > 1 ? 's' : ''} ou signalé${sr.length > 1 ? 's' : ''} dans le même département, même demi-journée`
              : `${ss.length} mouvement${ss.length > 1 ? 's' : ''} social${ss.length > 1 ? 'aux' : ''} dans les transports, même département, même demi-journée`,
          signalIds: [...sr, ...ss].map((s) => s.id) },
          { text: "Hypothèse : saturation des transports et de l'espace public autour du stade si la mobilisation coïncide avec le match", signalIds: cited.map((s) => s.id) },
        ],
        word: sr.length && ss.length ? 'probable' : 'possibilite_reelle',
        why: '',
        unknowns: ["Affluence réelle au stade et en ville : aucune donnée publique", 'Dispositif de sécurité et plan de transport du jour'],
        bascules: [
          { id: 'arrete', label: 'Arrêté préfectoral publié', state: arrete ? 'atteint' : 'surveille', at: arrete ? (arrete.publishedAt ?? arrete.observedAt) : null },
        ],
        disconfirmers: ['Match reporté ou joué à huis clos', 'Rassemblement annulé ou interdit par arrêté préfectoral', 'Plan de transport finalement maintenu'],
        verify: [`Dispositif de sécurité auprès de la préfecture du ${name}`, "Plan de transport auprès de l'exploitant local"],
        evidence: evidenceOf(cited, { basculeHit: Boolean(arrete), precedentDay: ctx.precedent(RULE_ID, dept), nowMs: ctx.now }),
      });
    }
    return out;
  },
  // Même constat que la règle 1 : événement de presse ou perturbation de transport dans le département pendant la fenêtre.
  arrived(scenario, signals, ctx = {}) {
    return mobilisationTransports.arrived(scenario, signals, ctx);
  },
};

export default rule;
