// api/_lib/anticipation/rules/crue-inondation.js : règle 9 (v1, 13/11/2026), vigilance crues ou pluie-inondation orange ou rouge.
// Signal qui devance l'événement : l'échéance est celle publiée par Météo-France et Vigicrues (J ou J+1). Du 4 au 6 puis le
// 12 novembre 2026, onze vigilances orange ont été publiées sans qu'aucune règle n'ouvre de scénario. Les enjeux exposés (urgences,
// EHPAD, sites Seveso du département) sont joints à la fiche par exposure.js. Texte fixé par gabarit, aucun mot produit par une IA.
import { DEPT_NAMES } from '../../../_shared/departments.js';
import { cleanSignals, evidenceOf, firstDept, inDept, inPlace, span } from './common.js';

/** @typedef {import('../probability.js').Signal} Signal */

export const RULE_ID = 'crue-inondation';
const OUTAGES_UNKNOWN = 'Pannes non lues';
const PRESS_UNKNOWN = 'Presse non lue';
const WATER = new Set(['crues', 'pluie_inondation']);
const LABEL = { crues: 'crues', pluie_inondation: 'pluie-inondation' };
const RANK = /** @type {Record<string, number>} */ ({ jaune: 1, orange: 2, rouge: 3 });

const isWater = (/** @type {Signal} */ s) => s.kind === 'vigilance' && WATER.has(String(s.meta?.phenomenon)) && (s.meta?.echeance === 'J' || s.meta?.echeance === 'J1') && span(s) !== null;
const isElectric = (/** @type {Signal} */ s) => s.kind === 'panne' && s.meta?.network === 'electricite';
/** Dégâts d'inondation lus dans la presse (étiquette de press-tags.js), au lieu certain. */
const isFloodPress = (/** @type {Signal} */ s) => s.kind === 'presse' && s.meta?.topic === 'inondation' && s.meta?.placeDoubt !== true;
const at = (/** @type {Signal} */ s) => Date.parse(s.publishedAt ?? s.observedAt ?? '');

/** @type {import('./index.js').CrossRule} */
const rule = {
  id: RULE_ID,
  version: 1,
  title: 'Routes coupées, évacuations et coupures de courant par inondation',
  domains: ['weather', 'transport', 'energy'],
  arrivalTest: "Des dégâts d'inondation (route coupée, évacuation, habitations inondées) sont relevés par la presse dans le département, ou une panne d'électricité de niveau orange ou rouge y est relevée, pendant la fenêtre de la vigilance.",
  evaluate(signals, ctx) {
    const all = cleanSignals(signals);
    const water = all.filter((s) => isWater(s) && firstDept(s) && /** @type {{to: number}} */ (span(s)).to > ctx.now);
    const strong = water.filter((s) => s.level === 'orange' || s.level === 'rouge');
    const unknown = Array.isArray(ctx.unknown) ? ctx.unknown : [];
    /** @type {import('./index.js').Candidate[]} */
    const out = [];
    for (const dept of [...new Set(strong.map((s) => /** @type {string} */ (firstDept(s))))].sort()) {
      const vs = strong.filter((s) => inDept(s, dept));
      const from = Math.min(...vs.map((s) => /** @type {{from: number}} */ (span(s)).from));
      const to = Math.max(...vs.map((s) => /** @type {{to: number}} */ (span(s)).to));
      const win = vs.length === 1 ? /** @type {{from: string, to: string}} */ (vs[0].window) : { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
      const top = vs.reduce((a, b) => (RANK[String(b.level)] > RANK[String(a.level)] ? b : a));
      const rouge = top.level === 'rouge';
      // Les deux phénomènes sur le même département (l'un orange ou rouge, l'autre au moins jaune) : pluie sur des cours d'eau déjà hauts.
      const phenomena = new Set(water.filter((s) => inDept(s, dept)).map((s) => String(s.meta?.phenomenon)));
      const both = phenomena.size === 2;
      const others = water.filter((s) => inDept(s, dept) && !vs.includes(s));
      const overlaps = (/** @type {Signal} */ s) => { const w = span(s); return w !== null && w.from < to && Math.max(w.to, w.from + 1) > from; };
      const press = all.filter((s) => isFloodPress(s) && inDept(s, dept) && ctx.now - at(s) <= 86_400_000).sort((a, b) => at(a) - at(b));
      const electric = all.filter((s) => isElectric(s) && inDept(s, dept) && overlaps(s)).sort((a, b) => at(a) - at(b));
      const name = /** @type {Record<string, string>} */ (DEPT_NAMES)[dept] ?? dept;
      const where = inPlace(dept, DEPT_NAMES);
      const labels = [...new Set(vs.map((s) => /** @type {Record<string, string>} */ (LABEL)[String(s.meta?.phenomenon)]))].join(' et ');
      const cited = [...vs, ...others, ...press, ...electric];
      const chain = [{ text: `Vigilance ${rouge ? 'rouge' : 'orange'} ${labels} ${where} (Météo-France, Vigicrues)`, signalIds: vs.map((s) => s.id) }];
      if (others.length) chain.push({ text: `Vigilance ${/** @type {Record<string, string>} */ (LABEL)[String(others[0].meta?.phenomenon)]} ${others[0].level} sur le même département`, signalIds: others.map((s) => s.id) });
      if (press.length) chain.push({ text: `Premiers dégâts d'inondation relevés par la presse ${where}`, signalIds: press.map((s) => s.id) });
      if (electric.length) chain.push({ text: `Panne d'électricité relevée ${where}`, signalIds: electric.map((s) => s.id) });
      chain.push({ text: `Hypothèse : routes coupées, évacuations de riverains et coupures de courant ${where} pendant la vigilance`, signalIds: cited.map((s) => s.id) });
      out.push({
        ruleId: RULE_ID,
        ruleVersion: 1,
        zone: { dept: [dept], communes: [] },
        window: win,
        title: rule.title,
        chain,
        word: rouge || (both && press.length > 0) ? 'tres_probable' : 'probable',
        why: '',
        unknowns: ['Communes et quartiers touchés : la vigilance est publiée par département ou par tronçon', 'Tenue des digues et des ouvrages : aucune donnée publique en continu',
          ...unknown.filter((u) => u === OUTAGES_UNKNOWN || u === PRESS_UNKNOWN)],
        bascules: [
          { id: 'deux_phenomenes', label: 'Crues et pluie-inondation en vigilance sur le même département', state: both ? 'atteint' : 'surveille', at: both ? (top.publishedAt ?? top.observedAt) : null },
          { id: 'degats', label: "Premiers dégâts relevés (route coupée, évacuation)", state: press.length ? 'atteint' : 'surveille', at: press.length ? (press[0].publishedAt ?? press[0].observedAt) : null },
          { id: 'coupures', label: "Coupures d'électricité relevées", state: electric.length ? 'atteint' : 'surveille', at: electric.length ? (electric[0].publishedAt ?? electric[0].observedAt) : null },
        ],
        disconfirmers: ['Vigilance abaissée ou levée par Météo-France ou Vigicrues', 'Décrue amorcée aux stations de référence'],
        verify: [`Bulletin Vigicrues et hauteurs aux stations pour le ${name}`, `Routes fermées auprès du conseil départemental et de la DIR`, `Mise à l'abri des établissements exposés auprès de la préfecture et de l'ARS`],
        evidence: evidenceOf(cited, { basculeHit: both || press.length > 0 || electric.length > 0, precedentDay: ctx.precedent(RULE_ID, dept), nowMs: ctx.now }),
      });
    }
    return out;
  },
  arrived(scenario, signals, ctx = {}) {
    const now = ctx.now ?? Date.now();
    const from = Date.parse(scenario?.window?.from ?? ''), to = Date.parse(scenario?.window?.to ?? '');
    const opened = Date.parse(scenario?.openedAt ?? '');
    const dept = scenario?.zone?.dept?.[0];
    if (!Number.isFinite(from) || !Number.isFinite(to) || !dept) return null;
    // Dégâts ou panne déjà cités à l'ouverture : ils ont nourri l'hypothèse, ils ne la confirment pas.
    const cited = new Set((scenario.chain ?? []).flatMap((c) => (Array.isArray(c.signalIds) ? c.signalIds : [])));
    const since = Number.isFinite(opened) ? Math.min(opened, from) : from;
    const hit = cleanSignals(signals).some((s) => {
      if (!inDept(s, dept) || cited.has(s.id)) return false;
      if (isFloodPress(s)) { const t = at(s); return Number.isFinite(t) && t >= since && t <= to; }
      if (isElectric(s) && (s.level === 'orange' || s.level === 'rouge')) { const w = span(s); return w !== null && w.from <= to && w.to >= from; }
      return false;
    });
    if (hit) return 'arrive';
    if (now <= to) return null;
    const unknown = Array.isArray(ctx.unknown) ? ctx.unknown : [];
    return unknown.includes(PRESS_UNKNOWN) && unknown.includes(OUTAGES_UNKNOWN) ? 'indecidable' : 'pas_arrive';
  },
};

export default rule;
