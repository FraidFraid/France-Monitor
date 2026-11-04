// api/_lib/anticipation/rules/mobilisation-transports.js : règle 1 (v1), rassemblements × transports, même département et même demi-journée.
// Texte fixé par gabarit, aucun mot ni chiffre produit par une IA. Les seuils sont ceux écrits dans la méthode.
import { DEPT_NAMES } from '../../../_shared/departments.js';
import { cleanSignals, evidenceOf, firstDept, inDept, span } from './common.js';
import { halfDaysOverlapping } from './paris-time.js';

/** @typedef {import('../probability.js').Signal} Signal */

export const RULE_ID = 'mobilisation-transports';
const RALLY = new Set(['rassemblement_annonce', 'rassemblement_signale']);
const TRANSPORT = new Set(['mouvement_social_transport', 'perturbation_sncf']);
const AFFLUENCE = 15_000;
const MIN_RALLIES_FOR_PROBABLE = 3;

const overlaps = (/** @type {Signal} */ s, /** @type {number} */ from, /** @type {number} */ to) => {
  const w = span(s);
  return w !== null && w.from < to && w.to >= from;
};
const participants = (/** @type {Signal} */ s) => {
  const p = s.meta?.participants ?? s.value;
  return typeof p === 'number' && Number.isFinite(p) ? p : 0;
};

/** @type {import('./index.js').CrossRule} */
const rule = {
  id: RULE_ID,
  version: 1,
  title: 'Foule bloquée ou débordements en fin de cortège',
  domains: ['social', 'transport'],
  arrivalTest: "Un événement de presse de sécurité ou social avec violences, ou une perturbation de transport, est relevé dans le département pendant la demi-journée annoncée.",
  evaluate(signals, ctx) {
    const all = cleanSignals(signals);
    const rallies = all.filter((s) => RALLY.has(s.kind) && span(s));
    const transports = all.filter((s) => TRANSPORT.has(s.kind) && span(s));
    const arretes = all.filter((s) => s.kind === 'arrete_prefectoral');
    /** @type {import('./index.js').Candidate[]} */
    const out = [];
    const depts = [...new Set(rallies.map(firstDept).filter((d) => typeof d === 'string'))].sort();
    for (const dept of depts) {
      const rs = rallies.filter((s) => inDept(s, dept));
      const ts = transports.filter((s) => inDept(s, dept));
      if (!ts.length) continue;
      const slotKeys = new Map();
      for (const r of rs) {
        const w = /** @type {{from: number, to: number}} */ (span(r));
        for (const h of halfDaysOverlapping(w.from, w.to)) slotKeys.set(h.from, h);
      }
      for (const slot of [...slotKeys.values()].sort((a, b) => a.from - b.from)) {
        if (slot.to <= ctx.now) continue;
        const sr = rs.filter((s) => overlaps(s, slot.from, slot.to));
        const st = ts.filter((s) => overlaps(s, slot.from, slot.to));
        if (!sr.length || !st.length) continue;
        const cited = [...sr, ...st];
        const people = Math.max(0, ...sr.map(participants));
        const arrete = arretes.find((a) => inDept(a, dept) && overlaps(a, slot.from, slot.to));
        const affluence = people >= AFFLUENCE;
        const name = /** @type {Record<string, string>} */ (DEPT_NAMES)[dept] ?? dept;
        const ids = cited.map((s) => s.id);
        const precedentDay = ctx.precedent(RULE_ID, dept);
        out.push({
          ruleId: RULE_ID,
          ruleVersion: 1,
          zone: { dept: [dept], communes: [...new Set(sr.flatMap((s) => (Array.isArray(s.communes) ? s.communes : [])))] },
          window: { from: new Date(slot.from).toISOString(), to: new Date(slot.to).toISOString() },
          title: rule.title,
          chain: [
            { text: `${sr.length} rassemblement${sr.length > 1 ? 's' : ''} annoncé${sr.length > 1 ? 's' : ''} ou signalé${sr.length > 1 ? 's' : ''} en ${name}, ${slot.label} du jour`, signalIds: sr.map((s) => s.id) },
            { text: `${st.length} perturbation${st.length > 1 ? 's' : ''} de transport relevée${st.length > 1 ? 's' : ''} dans le même département, même demi-journée`, signalIds: st.map((s) => s.id) },
            { text: 'Hypothèse : foule bloquée ou débordements en fin de cortège si les transports restent perturbés', signalIds: ids },
          ],
          word: rs.length >= MIN_RALLIES_FOR_PROBABLE || affluence ? 'probable' : 'possibilite_reelle',
          why: '',
          unknowns: ['Effectifs réels engagés : aucune donnée publique', 'Itinéraire exact du cortège et horaires de dispersion'],
          bascules: [
            { id: 'arrete', label: 'Arrêté préfectoral publié', state: arrete ? 'atteint' : 'surveille', at: arrete ? (arrete.publishedAt ?? arrete.observedAt) : null },
            { id: 'affluence', label: 'Plus de 15\u00a0000 participants signalés', state: affluence ? 'atteint' : 'surveille', at: affluence ? (sr.find((s) => participants(s) >= AFFLUENCE)?.observedAt ?? null) : null },
            { id: 'preavis_leve', label: 'Préavis levé', state: 'surveille', at: null },
          ],
          disconfirmers: ['Préavis de grève levé', 'Rassemblement annulé ou interdit par arrêté préfectoral', 'Plan de transport finalement maintenu'],
          verify: [`Effectifs auprès de la DDSP du ${name}`, 'Plan de transport auprès de SNCF Voyageurs'],
          evidence: evidenceOf(cited, { basculeHit: Boolean(arrete) || affluence, precedentDay, nowMs: ctx.now }),
        });
      }
    }
    return out;
  },
  arrived(scenario, signals, now = Date.now()) {
    const w = scenario?.window;
    const from = Date.parse(w?.from ?? ''), to = Date.parse(w?.to ?? '');
    const dept = scenario?.zone?.dept?.[0];
    if (!Number.isFinite(from) || !Number.isFinite(to) || !dept) return null;
    const press = cleanSignals(signals).filter((s) => s.kind === 'presse' || (s.origin?.startsWith('presse:') && TRANSPORT.has(s.kind)));
    const hit = press.some((s) => {
      if (!inDept(s, dept)) return false;
      const t = Date.parse(s.publishedAt ?? s.observedAt ?? '');
      if (!Number.isFinite(t) || t < from || t > to) return false;
      if (TRANSPORT.has(s.kind)) return true;
      const sev = s.meta?.severity;
      return (s.meta?.category === 'security' || s.meta?.category === 'social') && (sev === 'high' || sev === 'critical');
    });
    if (hit) return 'arrive';
    if (now < to) return null;
    return cleanSignals(signals).some((s) => s.kind === 'presse') ? 'pas_arrive' : 'indecidable';
  },
};

export default rule;
