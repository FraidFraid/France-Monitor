// api/_lib/anticipation/rules/chaleur-sante.js : règle 3 (v1), vigilance canicule orange/rouge × tension électrique (Écowatt ou panne).
// Texte fixé par gabarit ; la fenêtre est celle de l'échéance publiée par Météo-France. Les passages aux urgences (hebdomadaires) ne sont pas une entrée.
import { DEPT_NAMES } from '../../../_shared/departments.js';
import { cleanSignals, evidenceOf, firstDept, inDept, inPlace, span } from './common.js';

export const RULE_ID = 'chaleur-sante';
const OUTAGES_UNKNOWN = 'Pannes non lues';
const ECOWATT_UNKNOWN = 'Écowatt non lu';
const WEATHER_UNKNOWN = 'Météo-France non lue';
const HEALTH_UNKNOWN = 'Passages aux urgences de la semaine non encore publiés';
const RANK = { jaune: 1, orange: 2, rouge: 3 };
const STRONG = (/** @type {import('../probability.js').Signal} */ s) => s.level === 'orange' || s.level === 'rouge';
const isElectric = (/** @type {import('../probability.js').Signal} */ s) => s.kind === 'panne' && s.meta?.network === 'electricite';
const overlaps = (/** @type {{from: number, to: number}|null} */ w, /** @type {number} */ from, /** @type {number} */ to) => w !== null && w.from < to && Math.max(w.to, w.from + 1) > from;

/** @type {import('./index.js').CrossRule} */
const rule = {
  id: RULE_ID,
  version: 1,
  title: "Canicule et tension sur l'électricité",
  domains: ['weather', 'energy', 'health'],
  arrivalTest: "Un signal Écowatt rouge est publié, ou une panne d'électricité de niveau orange ou rouge est relevée dans le département, pendant la fenêtre de la vigilance canicule.",
  evaluate(signals, ctx) {
    const all = cleanSignals(signals);
    const vigilances = all.filter((s) => s.kind === 'vigilance' && s.meta?.phenomenon === 'canicule' && STRONG(s)
      && (s.meta?.echeance === 'J' || s.meta?.echeance === 'J1') && span(s) && firstDept(s));
    /** @type {import('./index.js').Candidate[]} */
    const out = [];
    for (const dept of [...new Set(vigilances.map((s) => /** @type {string} */ (firstDept(s))))].sort()) {
      const vs = vigilances.filter((s) => inDept(s, dept) && /** @type {{to: number}} */ (span(s)).to > ctx.now);
      if (!vs.length) continue;
      const from = Math.min(...vs.map((s) => /** @type {{from: number}} */ (span(s)).from));
      const to = Math.max(...vs.map((s) => /** @type {{to: number}} */ (span(s)).to));
      const win = vs.length === 1 ? /** @type {{from: string, to: string}} */ (vs[0].window) : { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
      const eco = all.filter((s) => s.kind === 'ecowatt' && STRONG(s) && overlaps(span(s), from, to));
      const pannes = all.filter((s) => isElectric(s) && inDept(s, dept) && STRONG(s) && overlaps(span(s), from, to));
      if (!eco.length && !pannes.length) continue;
      const rouge = vs.some((s) => s.level === 'rouge');
      const ecoRouge = eco.filter((s) => s.level === 'rouge');
      const panneHit = pannes.length > 0;
      const name = /** @type {Record<string, string>} */ (DEPT_NAMES)[dept] ?? dept;
      const where = inPlace(dept, DEPT_NAMES);
      const cited = [...vs, ...eco, ...pannes];
      // `levels` : niveau de chaque signal cité à l'écriture, pour reconnaître plus tard une montée de niveau (les ids ne portent pas le niveau).
      const step = (/** @type {string} */ text, /** @type {import('../probability.js').Signal[]} */ list) => ({ text, signalIds: list.map((s) => s.id), levels: Object.fromEntries(list.map((s) => [s.id, s.level ?? null])) });
      const chain = [step(`Vigilance canicule ${rouge ? 'rouge' : 'orange'} ${where} (Météo-France)`, vs)];
      if (eco.length) chain.push(step(`Écowatt ${eco.some((s) => s.level === 'rouge') ? 'rouge' : 'orange'} le même jour (RTE)`, eco));
      if (pannes.length) chain.push(step(`Panne d'électricité relevée ${where}`, pannes));
      chain.push(step("Hypothèse : tension sur l'électricité pendant la chaleur, avec un risque pour les personnes fragiles", cited));
      const unknown = Array.isArray(ctx.unknown) ? ctx.unknown : [];
      out.push({
        ruleId: RULE_ID,
        ruleVersion: 1,
        zone: { dept: [dept], communes: [] },
        window: win,
        title: rule.title,
        chain,
        word: rouge || ecoRouge.length ? 'probable' : 'possibilite_reelle',
        why: '',
        unknowns: [HEALTH_UNKNOWN, "État réel du réseau électrique local : aucune donnée publique en continu", ...unknown.filter((u) => [OUTAGES_UNKNOWN, ECOWATT_UNKNOWN, WEATHER_UNKNOWN].includes(u))],
        bascules: [
          { id: 'ecowatt_rouge', label: 'Écowatt rouge publié', state: ecoRouge.length ? 'atteint' : 'surveille', at: ecoRouge.length ? (ecoRouge[0].publishedAt ?? ecoRouge[0].observedAt) : null },
          { id: 'panne', label: "Panne d'électricité orange ou rouge relevée", state: panneHit ? 'atteint' : 'surveille', at: panneHit ? (pannes[0].publishedAt ?? pannes[0].observedAt) : null },
        ],
        disconfirmers: ['Vigilance canicule abaissée ou levée par Météo-France', 'Écowatt repassé au vert'],
        verify: [`Bulletin de vigilance Météo-France pour le ${name}`, "Signal Écowatt auprès de RTE", `Passages aux urgences auprès de l'ARS pour le ${name}`],
        evidence: evidenceOf(cited, { basculeHit: ecoRouge.length > 0 || panneHit, precedentDay: ctx.precedent(RULE_ID, dept), nowMs: ctx.now }),
      });
    }
    return out;
  },
  arrived(scenario, signals, ctx = {}) {
    const now = ctx.now ?? Date.now();
    const from = Date.parse(scenario?.window?.from ?? ''), to = Date.parse(scenario?.window?.to ?? '');
    const dept = scenario?.zone?.dept?.[0];
    if (!Number.isFinite(from) || !Number.isFinite(to) || !dept) return null;
    // Ni les signaux cités par le scénario ni ceux antérieurs à son ouverture ne comptent : sinon l'ouverture vaudrait arrivée.
    const opened = Date.parse(scenario?.openedAt ?? '');
    const steps = Array.isArray(scenario?.chain) ? scenario.chain : [];
    const cited = new Set(steps.flatMap((c) => (Array.isArray(c?.signalIds) ? c.signalIds : [])));
    // Niveau le plus bas écrit pour un id cité (0 si inconnu) : un niveau actuel strictement plus haut est un fait nouveau.
    const citedRank = (/** @type {string} */ id) => {
      const ranks = steps.map((c) => c?.levels?.[id]).filter((l) => l !== undefined).map((l) => /** @type {Record<string, number>} */ (RANK)[String(l)] ?? 0);
      return ranks.length ? Math.min(...ranks) : null;
    };
    const hit = cleanSignals(signals).some((s) => {
      let escalated = false;
      if (cited.has(s.id)) {
        const before = citedRank(s.id);
        escalated = before !== null && ((/** @type {Record<string, number>} */ (RANK))[String(s.level)] ?? 0) > before;
        if (!escalated) return false;
      }
      const seen = Date.parse(s.publishedAt ?? s.observedAt ?? '');
      if (!escalated && Number.isFinite(opened) && !(seen > opened)) return false;
      if (!overlaps(span(s), from, to)) return false;
      if (s.kind === 'ecowatt') return s.level === 'rouge';
      return isElectric(s) && inDept(s, dept) && STRONG(s);
    });
    if (hit) return 'arrive';
    if (now <= to) return null;
    const unknown = Array.isArray(ctx.unknown) ? ctx.unknown : [];
    return unknown.includes(OUTAGES_UNKNOWN) || unknown.includes(ECOWATT_UNKNOWN) ? 'indecidable' : 'pas_arrive';
  },
};

export default rule;
