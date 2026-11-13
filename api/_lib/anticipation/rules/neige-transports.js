// api/_lib/anticipation/rules/neige-transports.js : règle 11 (v1, 13/11/2026), vigilance neige-verglas orange ou rouge × transports.
// Signal qui devance l'événement : l'échéance est celle publiée par Météo-France (J ou J+1). Jamais déclenchée avant sa mise en service
// (une seule vigilance neige-verglas jaune depuis le 04/11/2026) : vérifiée par tests seulement, à rejouer sur l'archive des signaux au
// premier épisode. Texte fixé par gabarit, aucun mot produit par une IA.
import { DEPT_NAMES } from '../../../_shared/departments.js';
import { cleanSignals, evidenceOf, firstDept, inDept, inPlace, span } from './common.js';

/** @typedef {import('../probability.js').Signal} Signal */

export const RULE_ID = 'neige-transports';
const RAIL_UNKNOWN = 'SNCF non lue';
const PRESS_UNKNOWN = 'Presse non lue';

const isSnow = (/** @type {Signal} */ s) => s.kind === 'vigilance' && s.meta?.phenomenon === 'neige_verglas' && (s.level === 'orange' || s.level === 'rouge')
  && (s.meta?.echeance === 'J' || s.meta?.echeance === 'J1') && span(s) !== null;
const isRail = (/** @type {Signal} */ s) => s.kind === 'perturbation_sncf';
/** Blocages dus à la neige lus dans la presse (étiquette de press-tags.js), au lieu certain. */
const isSnowPress = (/** @type {Signal} */ s) => s.kind === 'presse' && s.meta?.topic === 'neige' && s.meta?.placeDoubt !== true;
const at = (/** @type {Signal} */ s) => Date.parse(s.publishedAt ?? s.observedAt ?? '');

/** @type {import('./index.js').CrossRule} */
const rule = {
  id: RULE_ID,
  version: 1,
  title: 'Routes bloquées et trains supprimés par la neige ou le verglas',
  domains: ['weather', 'transport'],
  arrivalTest: "Un blocage dû à la neige ou au verglas (route coupée, automobilistes bloqués, transports scolaires suspendus) est relevé par la presse dans le département, ou une perturbation ferroviaire y est relevée par la SNCF, pendant la fenêtre de la vigilance.",
  evaluate(signals, ctx) {
    const all = cleanSignals(signals);
    const snow = all.filter((s) => isSnow(s) && firstDept(s) && /** @type {{to: number}} */ (span(s)).to > ctx.now);
    const unknown = Array.isArray(ctx.unknown) ? ctx.unknown : [];
    /** @type {import('./index.js').Candidate[]} */
    const out = [];
    for (const dept of [...new Set(snow.map((s) => /** @type {string} */ (firstDept(s))))].sort()) {
      const vs = snow.filter((s) => inDept(s, dept));
      const from = Math.min(...vs.map((s) => /** @type {{from: number}} */ (span(s)).from));
      const to = Math.max(...vs.map((s) => /** @type {{to: number}} */ (span(s)).to));
      const win = vs.length === 1 ? /** @type {{from: string, to: string}} */ (vs[0].window) : { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
      const rouge = vs.some((s) => s.level === 'rouge');
      const overlaps = (/** @type {Signal} */ s) => { const w = span(s); return w !== null && w.from < to && Math.max(w.to, w.from + 1) > from; };
      const rail = all.filter((s) => isRail(s) && inDept(s, dept) && overlaps(s)).sort((a, b) => at(a) - at(b));
      const press = all.filter((s) => isSnowPress(s) && inDept(s, dept) && ctx.now - at(s) <= 86_400_000).sort((a, b) => at(a) - at(b));
      const name = /** @type {Record<string, string>} */ (DEPT_NAMES)[dept] ?? dept;
      const where = inPlace(dept, DEPT_NAMES);
      const cited = [...vs, ...rail, ...press];
      const chain = [{ text: `Vigilance ${rouge ? 'rouge' : 'orange'} neige-verglas ${where} (Météo-France)`, signalIds: vs.map((s) => s.id) }];
      if (rail.length) chain.push({ text: `${rail.length} perturbation${rail.length > 1 ? 's' : ''} ferroviaire${rail.length > 1 ? 's' : ''} relevée${rail.length > 1 ? 's' : ''} ${where} (SNCF)`, signalIds: rail.map((s) => s.id) });
      if (press.length) chain.push({ text: `Premiers blocages relevés par la presse ${where}`, signalIds: press.map((s) => s.id) });
      chain.push({ text: `Hypothèse : routes bloquées, automobilistes immobilisés et trains supprimés ${where} pendant la vigilance`, signalIds: cited.map((s) => s.id) });
      out.push({
        ruleId: RULE_ID,
        ruleVersion: 1,
        zone: { dept: [dept], communes: [] },
        window: win,
        title: rule.title,
        chain,
        word: rouge || (rail.length > 0 && press.length > 0) ? 'tres_probable' : 'probable',
        why: '',
        unknowns: ['Axes traités et moyens de salage engagés : aucune donnée publique en continu', 'Décision sur les transports scolaires : prise par département, souvent la veille au soir',
          ...unknown.filter((u) => u === RAIL_UNKNOWN || u === PRESS_UNKNOWN)],
        bascules: [
          { id: 'rail', label: 'Perturbation ferroviaire relevée par la SNCF', state: rail.length ? 'atteint' : 'surveille', at: rail.length ? (rail[0].publishedAt ?? rail[0].observedAt) : null },
          { id: 'blocages', label: 'Premiers blocages relevés (route coupée, automobilistes bloqués)', state: press.length ? 'atteint' : 'surveille', at: press.length ? (press[0].publishedAt ?? press[0].observedAt) : null },
        ],
        disconfirmers: ['Vigilance abaissée ou levée par Météo-France', 'Redoux ou limite pluie-neige plus haute que prévu'],
        verify: [`Bulletin de vigilance Météo-France pour le ${name}`, 'Restrictions de circulation des poids lourds auprès de la préfecture de zone', `Transports scolaires auprès du conseil régional pour le ${name}`],
        evidence: evidenceOf(cited, { basculeHit: rail.length > 0 || press.length > 0, precedentDay: ctx.precedent(RULE_ID, dept), nowMs: ctx.now }),
      });
    }
    return out;
  },
  arrived(scenario, signals, ctx = {}) {
    const now = ctx.now ?? Date.now();
    const from = Date.parse(scenario?.window?.from ?? ''), to = Date.parse(scenario?.window?.to ?? '');
    const dept = scenario?.zone?.dept?.[0];
    if (!Number.isFinite(from) || !Number.isFinite(to) || !dept) return null;
    // Blocage ou perturbation déjà cités à l'ouverture : ils ont nourri l'hypothèse, ils ne la confirment pas.
    const cited = new Set((scenario.chain ?? []).flatMap((c) => (Array.isArray(c.signalIds) ? c.signalIds : [])));
    const hit = cleanSignals(signals).some((s) => {
      if (!inDept(s, dept) || cited.has(s.id)) return false;
      if (isSnowPress(s)) { const t = at(s); return Number.isFinite(t) && t >= from && t <= to; }
      if (isRail(s)) { const w = span(s); return w !== null && w.from <= to && w.to >= from; }
      return false;
    });
    if (hit) return 'arrive';
    if (now <= to) return null;
    const unknown = Array.isArray(ctx.unknown) ? ctx.unknown : [];
    return unknown.includes(PRESS_UNKNOWN) && unknown.includes(RAIL_UNKNOWN) ? 'indecidable' : 'pas_arrive';
  },
};

export default rule;
