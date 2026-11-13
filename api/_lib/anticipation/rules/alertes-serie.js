// api/_lib/anticipation/rules/alertes-serie.js : règle 8 (v1, 13/11/2026), série de fausses alertes à la bombe.
// Tirée des crises manquées de novembre 2026 : six alertes (avions déroutés, lycées évacués) en une semaine, sans scénario ouvert.
// Scénario national : la série se déplace d'un département à l'autre, le lieu de la suivante n'est pas annoncé.
// Texte fixé par gabarit, aucun mot ni chiffre produit par une IA.
import { cleanSignals, evidenceOf, firstDept } from './common.js';
import { parisDayBounds } from './paris-time.js';

/** @typedef {import('../probability.js').Signal} Signal */

export const RULE_ID = 'alertes-serie';
const PRESS_UNKNOWN = 'Presse non lue';
const DAY_MS = 86_400_000;
/** Alertes distinctes en 24 h à partir desquelles on parle de série, et seuil du mot « probable ». */
export const SERIES_MIN = 3;
export const SERIES_PROBABLE = 5;

const published = (/** @type {Signal} */ s) => Date.parse(s.publishedAt ?? s.observedAt ?? '');
const isAlert = (/** @type {Signal} */ s) => s.kind === 'presse' && s.meta?.topic === 'alerte_bombe';

/** @type {import('./index.js').CrossRule} */
const rule = {
  id: RULE_ID,
  version: 1,
  title: 'Série de fausses alertes à la bombe',
  domains: ['security', 'transport'],
  arrivalTest: "Une nouvelle alerte à la bombe ou fausse alerte, non citée à l'ouverture, est relevée par la presse en France avant la fin de la journée annoncée.",
  evaluate(signals, ctx) {
    const alerts = cleanSignals(signals).filter((s) => isAlert(s) && ctx.now - published(s) <= DAY_MS && published(s) - ctx.now <= 5 * 60_000);
    if (alerts.length < SERIES_MIN) return [];
    const depts = new Set(alerts.filter((s) => s.meta?.placeDoubt !== true).map(firstDept).filter((d) => typeof d === 'string'));
    const day = parisDayBounds(ctx.now);
    const unknown = Array.isArray(ctx.unknown) ? ctx.unknown : [];
    const ids = alerts.map((s) => s.id);
    return [{
      ruleId: RULE_ID,
      ruleVersion: 1,
      zone: { dept: [], communes: [] },
      window: { from: new Date(day.from).toISOString(), to: new Date(day.to).toISOString() },
      title: rule.title,
      chain: [
        { text: `${alerts.length} alertes à la bombe ou fausses alertes relevées par la presse en 24 h${depts.size > 1 ? `, dans ${depts.size} départements` : ''}`, signalIds: ids },
        { text: "Hypothèse : nouvelles alertes aujourd'hui contre des établissements scolaires, des gares ou des aéroports, avec évacuations et retards", signalIds: ids },
      ],
      word: alerts.length >= SERIES_PROBABLE ? 'probable' : 'possibilite_reelle',
      why: '',
      unknowns: ['Auteurs et lien entre les alertes : aucune donnée publique', 'Lieux visés ensuite : non annoncés', ...unknown.filter((u) => u === PRESS_UNKNOWN)],
      bascules: [
        { id: 'nouvelle_alerte', label: 'Nouvelle alerte relevée', state: 'surveille', at: null },
        { id: 'serie_etendue', label: `Au moins ${SERIES_PROBABLE} alertes en 24 h`, state: alerts.length >= SERIES_PROBABLE ? 'atteint' : 'surveille', at: alerts.length >= SERIES_PROBABLE ? new Date(Math.max(...alerts.map(published))).toISOString() : null },
      ],
      disconfirmers: ['Auteur interpellé', 'Aucune nouvelle alerte pendant 24 h'],
      verify: ['Levées de doute auprès de la préfecture du département visé', "Consignes aux établissements auprès du rectorat, plan de vol auprès de l'aéroport"],
      evidence: evidenceOf(alerts, { basculeHit: alerts.length >= SERIES_PROBABLE, precedentDay: ctx.precedent(RULE_ID, 'national'), nowMs: ctx.now }),
    }];
  },
  arrived(scenario, signals, ctx = {}) {
    const now = ctx.now ?? Date.now();
    const from = Date.parse(scenario?.window?.from ?? ''), to = Date.parse(scenario?.window?.to ?? '');
    const opened = Date.parse(scenario?.openedAt ?? '');
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    const cited = new Set((scenario.chain ?? []).flatMap((c) => (Array.isArray(c.signalIds) ? c.signalIds : [])));
    const since = Number.isFinite(opened) ? Math.max(opened, from) : from;
    const hit = cleanSignals(signals).some((s) => {
      if (!isAlert(s) || cited.has(s.id)) return false;
      const t = published(s);
      return Number.isFinite(t) && t > since && t <= to;
    });
    if (hit) return 'arrive';
    if (now <= to) return null;
    const pressRead = Array.isArray(ctx.unknown) ? !ctx.unknown.includes(PRESS_UNKNOWN) : cleanSignals(signals).some((s) => s.kind === 'presse');
    return pressRead ? 'pas_arrive' : 'indecidable';
  },
};

export default rule;
