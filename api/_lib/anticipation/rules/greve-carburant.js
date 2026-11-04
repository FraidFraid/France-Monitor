// api/_lib/anticipation/rules/greve-carburant.js : règle 5 (v1, nationale), grève ou blocage de raffinerie ou dépôt × tension carburants en hausse.
// Texte fixé par gabarit ; fenêtre J+2 (jour de Paris). La tendance vient du signal lui-même (`meta.previousValue`) : sans elle, aucun scénario.
import { cleanSignals, evidenceOf } from './common.js';
import { parisDayBounds } from './paris-time.js';

export const RULE_ID = 'greve-carburant';
const H = 3_600_000;
const STRIKE_RE = /grève|blocage/i;
const SITE_RE = /raffinerie|dépôt pétrolier|dépôt de carburant/i;
const FUEL_UNKNOWN = 'Carburants non lus';
const NATIONAL_THRESHOLD = 15;

/** @typedef {import('../probability.js').Signal} Signal */
const isNational = (/** @type {Signal} */ s) => s.kind === 'tension_carburant' && s.meta?.national === true;
const rising = (/** @type {Signal} */ s) => s.kind === 'tension_carburant' && s.meta?.national !== true && typeof s.value === 'number' && typeof s.meta?.previousValue === 'number' && s.value > s.meta.previousValue;

/** @type {import('./index.js').CrossRule} */
const rule = {
  id: RULE_ID,
  version: 1,
  title: 'Grève dans le raffinage et tension sur les carburants',
  domains: ['social', 'fuel'],
  arrivalTest: 'La part nationale des stations en rupture dépasse 15 % pendant la journée annoncée.',
  evaluate(signals, ctx) {
    const all = cleanSignals(signals);
    const press = all.filter((s) => {
      if (s.kind !== 'presse') return false;
      const title = String(s.meta?.title ?? '');
      const t = Date.parse(s.publishedAt ?? '');
      return STRIKE_RE.test(title) && SITE_RE.test(title) && Number.isFinite(t) && ctx.now - t <= 72 * H && t - ctx.now <= 5 * 60_000;
    });
    if (new Set(press.map((s) => s.origin)).size < 2) return [];
    const fuel = all.filter(rising);
    if (!fuel.length) return [];
    const today = parisDayBounds(ctx.now);
    const day = parisDayBounds(today.from + 2 * 24 * H + 12 * H);
    const cited = [...press, ...fuel];
    const unknown = Array.isArray(ctx.unknown) ? ctx.unknown : [];
    return [{
      ruleId: RULE_ID,
      ruleVersion: 1,
      zone: { dept: [], communes: [] },
      window: { from: new Date(day.from).toISOString(), to: new Date(day.to).toISOString() },
      title: rule.title,
      chain: [
        { text: `${press.length} événements de presse sur une grève ou un blocage de raffinerie ou de dépôt, dans les dernières 72 h`, signalIds: press.map((s) => s.id) },
        { text: `Part des stations en rupture en hausse dans ${fuel.length} département${fuel.length > 1 ? 's' : ''}`, signalIds: fuel.map((s) => s.id) },
        { text: 'Hypothèse : ruptures de carburant plus étendues dans deux jours si le blocage se prolonge', signalIds: cited.map((s) => s.id) },
      ],
      word: 'possibilite_reelle',
      why: '',
      unknowns: ['Niveau des stocks des dépôts : aucune donnée publique', 'Durée du blocage : non annoncée', ...unknown.filter((u) => u === FUEL_UNKNOWN)],
      bascules: [{ id: 'rupture_nationale', label: 'Plus de 15 % des stations en rupture au niveau national', state: 'surveille', at: null }],
      disconfirmers: ['Grève levée ou blocage levé', 'Part des stations en rupture repartie à la baisse'],
      verify: ['Préavis et blocages auprès des organisations syndicales', 'Ruptures auprès du ministère de la Transition écologique (prix-carburants)'],
      evidence: evidenceOf(cited, { basculeHit: false, precedentDay: ctx.precedent(RULE_ID, 'national'), nowMs: ctx.now }),
    }];
  },
  arrived(scenario, signals, ctx = {}) {
    const now = ctx.now ?? Date.now();
    const from = Date.parse(scenario?.window?.from ?? ''), to = Date.parse(scenario?.window?.to ?? '');
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    const nat = cleanSignals(signals).filter(isNational);
    const hit = nat.some((s) => {
      const t = Date.parse(s.observedAt ?? '');
      return typeof s.value === 'number' && s.value > NATIONAL_THRESHOLD && Number.isFinite(t) && t >= from && t <= to;
    });
    if (hit) return 'arrive';
    if (now <= to) return null;
    // Aucun relevé national à la fin de la fenêtre : on ne peut pas conclure.
    const unknown = Array.isArray(ctx.unknown) ? ctx.unknown : [];
    const read = nat.some((s) => { const t = Date.parse(s.observedAt ?? ''); return t >= from && t <= to; });
    return unknown.includes(FUEL_UNKNOWN) || !read ? 'indecidable' : 'pas_arrive';
  },
};

export default rule;
