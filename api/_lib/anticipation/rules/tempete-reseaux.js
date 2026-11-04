// api/_lib/anticipation/rules/tempete-reseaux.js : règle 2 (v1), vigilance vent ou orages orange/rouge × pannes électriques puis mobiles.
// Texte fixé par gabarit ; la fenêtre est celle de l'échéance publiée par Météo-France.
import { DEPT_NAMES } from '../../../_shared/departments.js';
import { cleanSignals, evidenceOf, firstDept, inDept, span } from './common.js';

export const RULE_ID = 'tempete-reseaux';
const PHENOMENA = new Set(['vent', 'orages']);
const PHENOMENON_LABEL = { vent: 'vent', orages: 'orages' };

const isElectric = (/** @type {import('../probability.js').Signal} */ s) => s.kind === 'panne' && s.meta?.network === 'electricite';
const isMobile = (/** @type {import('../probability.js').Signal} */ s) => s.kind === 'panne' && s.meta?.network === 'mobile';

/** @type {import('./index.js').CrossRule} */
const rule = {
  id: RULE_ID,
  version: 1,
  title: "Coupures d'électricité puis de réseau mobile",
  domains: ['weather', 'energy', 'telecom'],
  arrivalTest: "Une panne d'électricité de niveau orange ou rouge est relevée dans le département pendant la fenêtre de la vigilance.",
  evaluate(signals, ctx) {
    const all = cleanSignals(signals);
    const vigilances = all.filter((s) => s.kind === 'vigilance' && PHENOMENA.has(String(s.meta?.phenomenon)) && (s.level === 'orange' || s.level === 'rouge')
      && (s.meta?.echeance === 'J' || s.meta?.echeance === 'J1') && span(s) && firstDept(s));
    /** @type {import('./index.js').Candidate[]} */
    const out = [];
    for (const dept of [...new Set(vigilances.map((s) => /** @type {string} */ (firstDept(s))))].sort()) {
      const vs = vigilances.filter((s) => inDept(s, dept) && /** @type {{to: number}} */ (span(s)).to > ctx.now);
      if (!vs.length) continue;
      const from = Math.min(...vs.map((s) => /** @type {{from: number}} */ (span(s)).from));
      const to = Math.max(...vs.map((s) => /** @type {{to: number}} */ (span(s)).to));
      // Les créneaux publiés tels quels : une seule vigilance donne exactement son créneau.
      const win = vs.length === 1 ? /** @type {{from: string, to: string}} */ (vs[0].window) : { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
      const rouge = vs.some((s) => s.level === 'rouge');
      const pannes = all.filter((s) => inDept(s, dept) && (isElectric(s) || isMobile(s)));
      const electric = pannes.filter(isElectric).sort((a, b) => Date.parse(a.publishedAt ?? a.observedAt) - Date.parse(b.publishedAt ?? b.observedAt));
      const mobile = pannes.filter(isMobile).sort((a, b) => Date.parse(a.publishedAt ?? a.observedAt) - Date.parse(b.publishedAt ?? b.observedAt));
      const name = /** @type {Record<string, string>} */ (DEPT_NAMES)[dept] ?? dept;
      const labels = [...new Set(vs.map((s) => /** @type {Record<string, string>} */ (PHENOMENON_LABEL)[String(s.meta?.phenomenon)]))].join(' et ');
      const cited = [...vs, ...pannes];
      const chain = [{ text: `Vigilance ${rouge ? 'rouge' : 'orange'} ${labels} en ${name} (Météo-France)`, signalIds: vs.map((s) => s.id) }];
      if (electric.length) chain.push({ text: `Panne d'électricité relevée en ${name}`, signalIds: electric.map((s) => s.id) });
      if (mobile.length) chain.push({ text: `Panne de réseau mobile relevée en ${name}`, signalIds: mobile.map((s) => s.id) });
      out.push({
        ruleId: RULE_ID,
        ruleVersion: 1,
        zone: { dept: [dept], communes: [] },
        window: win,
        title: rule.title,
        chain,
        word: rouge ? 'tres_probable' : 'probable',
        why: '',
        unknowns: ["État réel du réseau électrique local : aucune donnée publique en continu", 'Effectifs de dépannage engagés : aucune donnée publique'],
        bascules: [
          { id: 'coupures', label: "Premières coupures d'électricité relevées", state: electric.length ? 'atteint' : 'surveille', at: electric.length ? (electric[0].publishedAt ?? electric[0].observedAt) : null },
          { id: 'mobile', label: 'Pannes de réseau mobile signalées', state: mobile.length ? 'atteint' : 'surveille', at: mobile.length ? (mobile[0].publishedAt ?? mobile[0].observedAt) : null },
        ],
        disconfirmers: ['Vigilance abaissée ou levée par Météo-France', 'Vents ou orages passés sans dégât relevé'],
        verify: [`Bulletin de vigilance Météo-France pour le ${name}`, `Incidents réseau auprès d'Enedis pour le ${name}`],
        evidence: evidenceOf(cited, { basculeHit: electric.length > 0 || mobile.length > 0, precedentDay: ctx.precedent(RULE_ID, dept), nowMs: ctx.now }),
      });
    }
    return out;
  },
  arrived(scenario, signals, now = Date.now()) {
    void now;
    const from = Date.parse(scenario?.window?.from ?? ''), to = Date.parse(scenario?.window?.to ?? '');
    const dept = scenario?.zone?.dept?.[0];
    if (!Number.isFinite(from) || !Number.isFinite(to) || !dept) return null;
    const hit = cleanSignals(signals).some((s) => {
      if (!isElectric(s) || !inDept(s, dept) || (s.level !== 'orange' && s.level !== 'rouge')) return false;
      const w = span(s);
      return w !== null && w.from <= to && w.to >= from;
    });
    if (hit) return 'arrive';
    return now > to ? 'pas_arrive' : null;
  },
};

export default rule;
