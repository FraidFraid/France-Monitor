// api/_lib/anticipation/rules/social-cyber.js : règle 4 (v1, nationale), forte mobilisation sociale × signaux cyber dans les 24 h.
// Texte fixé par gabarit, fenêtre = jour de Paris en cours.
import { cleanSignals, evidenceOf } from './common.js';
import { parisDayBounds } from './paris-time.js';

export const RULE_ID = 'social-cyber';
const DAY_MS = 86_400_000;
const MIN_RALLIES = 20;
const CYBER_UNKNOWN = 'Veille cyber non lue';
const OUTAGES_UNKNOWN = 'Pannes non lues';
const PUBLIC_NETWORKS = new Set(['cloud', 'internet']);

/** @typedef {import('../probability.js').Signal} Signal */
const published = (/** @type {Signal} */ s) => Date.parse(s.publishedAt ?? '');
const overlapsDay = (/** @type {Signal} */ s, /** @type {{from: number, to: number}} */ day) => {
  const from = Date.parse(s.window?.from ?? ''), to = Date.parse(s.window?.to ?? '');
  return Number.isFinite(from) && Number.isFinite(to) && from < day.to && Math.max(to, from + 1) > day.from;
};

/** @type {import('./index.js').CrossRule} */
const rule = {
  id: RULE_ID,
  // Suspendue le 13/11/2026 : 5 scénarios émis en novembre, aucun arrivé. Le test d'arrivée est à revoir avant de la rouvrir.
  suspended: { since: '2026-11-13', reason: "5 scénarios émis, aucun arrivé : test d'arrivée à revoir" },
  version: 1,
  title: 'Forte mobilisation sociale et activité cyber hostile',
  domains: ['social', 'cyber'],
  arrivalTest: "Une nouvelle revendication cyber visant un site public en .fr, ou une panne d'un service public exposé (cloud ou internet), est relevée pendant la journée annoncée.",
  evaluate(signals, ctx) {
    const all = cleanSignals(signals);
    const day = parisDayBounds(ctx.now);
    const rallies = all.filter((s) => s.kind === 'rassemblement_annonce' && overlapsDay(s, day));
    const pressSocial = all.filter((s) => s.kind === 'presse' && s.meta?.category === 'social' && (s.meta?.severity === 'high' || s.meta?.severity === 'critical')
      && ctx.now - published(s) <= DAY_MS && published(s) - ctx.now <= 5 * 60_000);
    const social = rallies.length >= MIN_RALLIES || pressSocial.length > 0;
    if (!social) return [];
    const revendications = all.filter((s) => s.kind === 'cyber_revendication' && ctx.now - published(s) <= DAY_MS && published(s) - ctx.now <= 5 * 60_000);
    const pics = all.filter((s) => s.kind === 'cyber_pic');
    if (!revendications.length && !pics.length) return [];
    const socialSignals = [...(rallies.length >= MIN_RALLIES ? rallies : []), ...pressSocial];
    const cyber = [...revendications, ...pics];
    const cited = [...socialSignals, ...cyber];
    const chain = [
      { text: rallies.length >= MIN_RALLIES ? `${rallies.length} rassemblements annoncés en France aujourd'hui` : 'Événement social de gravité élevée relevé dans la presse', signalIds: socialSignals.map((s) => s.id) },
      { text: revendications.length ? `${revendications.length} revendication${revendications.length > 1 ? 's' : ''} cyber visant un site public en .fr dans les dernières 24 h` : 'Pic de trafic hostile relevé en France', signalIds: cyber.map((s) => s.id) },
      { text: 'Hypothèse : attaques contre des sites publics pendant une journée de forte mobilisation', signalIds: cited.map((s) => s.id) },
    ];
    const unknown = Array.isArray(ctx.unknown) ? ctx.unknown : [];
    return [{
      ruleId: RULE_ID,
      ruleVersion: 1,
      zone: { dept: [], communes: [] },
      window: { from: new Date(day.from).toISOString(), to: new Date(day.to).toISOString() },
      title: rule.title,
      chain,
      word: 'possibilite_reelle',
      why: '',
      unknowns: ['Lien entre les revendications cyber et la mobilisation : aucune donnée publique', 'Cibles réelles visées : non annoncées', ...unknown.filter((u) => u === CYBER_UNKNOWN || u === OUTAGES_UNKNOWN)],
      bascules: [
        { id: 'nouvelle_revendication', label: 'Nouvelle revendication cyber', state: 'surveille', at: null },
        { id: 'service_public', label: "Panne d'un service public exposé", state: 'surveille', at: null },
      ],
      disconfirmers: ['Revendications cyber retirées ou démenties', 'Mobilisation annulée ou fortement réduite'],
      verify: ["Revendications cyber auprès de l'ANSSI (CERT-FR)", 'Décompte des rassemblements auprès du ministère de l\'Intérieur'],
      evidence: evidenceOf(cited, { basculeHit: false, precedentDay: ctx.precedent(RULE_ID, 'national'), nowMs: ctx.now }),
    }];
  },
  arrived(scenario, signals, ctx = {}) {
    const now = ctx.now ?? Date.now();
    const from = Date.parse(scenario?.window?.from ?? ''), to = Date.parse(scenario?.window?.to ?? '');
    const opened = Date.parse(scenario?.openedAt ?? '');
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    const since = Number.isFinite(opened) ? Math.max(opened, from) : from;
    const hit = cleanSignals(signals).some((s) => {
      if (s.kind === 'cyber_revendication') { const t = published(s); return Number.isFinite(t) && t > since && t <= to; }
      if (s.kind === 'panne' && PUBLIC_NETWORKS.has(String(s.meta?.network)) && s.meta?.exposed === true) {
        const f = Date.parse(s.window?.from ?? ''), e = Date.parse(s.window?.to ?? '');
        // Une panne déjà en cours à l'ouverture du scénario ne compte pas.
        return Number.isFinite(f) && Number.isFinite(e) && f <= to && e >= from && (!Number.isFinite(opened) || f > opened);
      }
      return false;
    });
    if (hit) return 'arrive';
    if (now <= to) return null;
    const unknown = Array.isArray(ctx.unknown) ? ctx.unknown : [];
    return unknown.includes(CYBER_UNKNOWN) || unknown.includes(OUTAGES_UNKNOWN) ? 'indecidable' : 'pas_arrive';
  },
};

export default rule;
