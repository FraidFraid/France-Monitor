// api/_lib/anticipation/rules/lycees-mobilisation.js : règle 7 (v1, 13/11/2026), incidents dans des lycées × mobilisation.
// Tirée des crises manquées de novembre 2026 : neuf incidents dans ou devant des lycées (tirs de mortier, casseurs, confinements)
// autour des mobilisations des 5 et 7 novembre, sans aucun scénario ouvert. Texte fixé par gabarit, aucun mot ni chiffre produit par une IA.
import { DEPT_NAMES } from '../../../_shared/departments.js';
import { arreteBascule, cleanSignals, evidenceOf, firstDept, inDept, inPlace, span } from './common.js';
import { parisDayBounds, parisDayLabel } from './paris-time.js';

/** @typedef {import('../probability.js').Signal} Signal */

export const RULE_ID = 'lycees-mobilisation';
const RALLY = new Set(['rassemblement_annonce', 'rassemblement_signale']);
const PRESS_UNKNOWN = 'Presse non lue';
const H = 3_600_000;
const DAY_MS = 24 * H;
/** Départements touchés en 24 h à partir desquels le mouvement est dit national. */
export const WAVE_MIN_DEPTS = 3;
/** Départements touchés à partir desquels l'extension est dite probable. */
const NATIONAL_PROBABLE_DEPTS = 5;
/** Heures de cours retenues (heure de Paris) : la fenêtre du scénario. */
const SCHOOL_FROM_H = 6, SCHOOL_TO_H = 18;

const published = (/** @type {Signal} */ s) => Date.parse(s.publishedAt ?? s.observedAt ?? '');
/** Incident dans un établissement scolaire, lu dans la presse, au lieu certain. */
const isIncident = (/** @type {Signal} */ s) => s.kind === 'presse' && s.meta?.topic === 'lycee' && s.meta?.placeDoubt !== true;
const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', weekday: 'short' });
const isSchoolDay = (/** @type {number} */ ms) => !['Sat', 'Sun'].includes(weekday.format(new Date(ms)));

/**
 * Prochaine journée de cours : aujourd'hui si c'est un jour de semaine et qu'il reste des heures de cours, sinon le prochain jour de
 * semaine. Les vacances et jours fériés ne sont pas lus (dit dans les inconnues du scénario).
 * @param {number} now
 * @returns {{ from: number, to: number }}
 */
export function nextSchoolWindow(now) {
  let day = parisDayBounds(now);
  for (let i = 0; i < 8; i += 1) {
    const from = day.from + SCHOOL_FROM_H * H, to = day.from + SCHOOL_TO_H * H;
    if (isSchoolDay(day.from + 12 * H) && now < to - 2 * H) return { from, to };
    day = parisDayBounds(day.to + H);
  }
  return { from: day.from + SCHOOL_FROM_H * H, to: day.from + SCHOOL_TO_H * H };
}

const meets = (/** @type {{from: number, to: number}|null} */ w, /** @type {number} */ from, /** @type {number} */ to) =>
  w !== null && w.from < to && Math.max(w.to, w.from + 1) > from;
const plural = (/** @type {number} */ n, /** @type {string} */ one, /** @type {string} */ many) => `${n} ${n > 1 ? many : one}`;

/** @type {import('./index.js').CrossRule} */
const rule = {
  id: RULE_ID,
  version: 1,
  title: 'Violences aux abords des lycées',
  domains: ['social', 'security'],
  arrivalTest: "Un nouvel incident dans ou devant un établissement scolaire (tirs de mortier, blocage, dégradations, évacuation) est relevé par la presse dans le département pendant la journée de cours annoncée ; pour le scénario national, dans un département sans incident à l'ouverture.",
  evaluate(signals, ctx) {
    const all = cleanSignals(signals);
    const incidents = all.filter((s) => isIncident(s) && ctx.now - published(s) <= DAY_MS && published(s) - ctx.now <= 5 * 60_000);
    if (!incidents.length) return [];
    const win = nextSchoolWindow(ctx.now);
    const rallies = all.filter((s) => RALLY.has(s.kind) && meets(span(s), win.from, win.to));
    const arretes = all.filter((s) => s.kind === 'arrete_prefectoral');
    const hitDepts = [...new Set(incidents.map(firstDept).filter((d) => typeof d === 'string'))].sort();
    const wave = hitDepts.length >= WAVE_MIN_DEPTS;
    const today = parisDayBounds(ctx.now);
    const when = win.from >= today.from && win.from < today.to ? "aujourd'hui" : `le ${parisDayLabel(win.from)}`;
    const unknown = Array.isArray(ctx.unknown) ? ctx.unknown : [];
    /** @type {import('./index.js').Candidate[]} */
    const out = [];
    for (const dept of hitDepts) {
      const local = incidents.filter((s) => inDept(s, dept));
      const rs = rallies.filter((s) => inDept(s, dept));
      const cited = [...local, ...rs];
      const arrete = arretes.find((a) => inDept(a, dept) && meets(span(a), win.from, win.to));
      const where = inPlace(dept, DEPT_NAMES);
      const chain = [
        { text: `${plural(local.length, 'incident relevé', 'incidents relevés')} dans un établissement scolaire ${where} en 24 h`, signalIds: local.map((s) => s.id) },
        ...(rs.length ? [{ text: `${plural(rs.length, 'rassemblement annoncé ou signalé', 'rassemblements annoncés ou signalés')} ${where}, ${when}`, signalIds: rs.map((s) => s.id) }] : []),
        { text: `Hypothèse : nouveaux blocages, tirs de mortier ou dégradations aux abords des lycées ${where}, ${when} aux heures de cours`, signalIds: cited.map((s) => s.id) },
      ];
      out.push({
        ruleId: RULE_ID,
        ruleVersion: 1,
        zone: { dept: [dept], communes: [...new Set(local.flatMap((s) => (Array.isArray(s.communes) ? s.communes : [])))] },
        window: { from: new Date(win.from).toISOString(), to: new Date(win.to).toISOString() },
        title: rule.title,
        chain,
        word: local.length >= 2 || (local.length >= 1 && rs.length >= 1) ? 'probable' : 'possibilite_reelle',
        why: '',
        unknowns: ['Établissements visés : aucun appel public recensé', 'Calendrier scolaire non lu : vacances ou jour sans cours possibles', ...unknown.filter((u) => u === PRESS_UNKNOWN || u === 'Manifestations non lues')],
        bascules: [
          arreteBascule(arrete),
          { id: 'mouvement_national', label: `Incidents dans au moins ${WAVE_MIN_DEPTS} départements en 24 h`, state: wave ? 'atteint' : 'surveille', at: wave ? new Date(Math.max(...incidents.map(published))).toISOString() : null },
        ],
        disconfirmers: ['Appel au blocage levé', 'Vacances scolaires ou jour sans cours', 'Rassemblement annulé ou interdit par arrêté préfectoral'],
        verify: ['Situation des établissements auprès du rectorat', 'Dispositif aux abords des lycées auprès de la préfecture'],
        evidence: evidenceOf(cited, { basculeHit: Boolean(arrete) || wave, precedentDay: ctx.precedent(RULE_ID, dept), nowMs: ctx.now }),
      });
    }
    // Mouvement national : un seul scénario pour le reste du pays (le rejeu du 04/11 a montré qu'un scénario par département où un
    // rassemblement est annoncé en ouvrait près de cent la veille d'une journée de mobilisation, ce qui ne dit plus rien).
    if (wave) {
      const ids = incidents.map((s) => s.id);
      out.push({
        ruleId: RULE_ID,
        ruleVersion: 1,
        zone: { dept: [], communes: [] },
        window: { from: new Date(win.from).toISOString(), to: new Date(win.to).toISOString() },
        title: 'Extension des incidents dans les lycées à d’autres départements',
        chain: [
          { text: `Incidents relevés dans des établissements scolaires de ${hitDepts.length} départements en 24 h (${hitDepts.join(', ')})`, signalIds: ids },
          ...(rallies.length ? [{ text: `${plural(rallies.length, 'rassemblement annoncé ou signalé', 'rassemblements annoncés ou signalés')} en France, ${when}`, signalIds: rallies.slice(0, 40).map((s) => s.id) }] : []),
          { text: `Hypothèse : incidents dans les lycées de départements encore épargnés, ${when} aux heures de cours`, signalIds: ids },
        ],
        word: hitDepts.length >= NATIONAL_PROBABLE_DEPTS ? 'probable' : 'possibilite_reelle',
        why: '',
        unknowns: ['Départements touchés ensuite : aucun appel public recensé', 'Calendrier scolaire non lu : vacances ou jour sans cours possibles', ...unknown.filter((u) => u === PRESS_UNKNOWN || u === 'Manifestations non lues')],
        bascules: [{ id: 'nouveau_departement', label: 'Incident dans un département encore épargné', state: 'surveille', at: null }],
        disconfirmers: ['Appel au blocage levé', 'Vacances scolaires ou jour sans cours'],
        verify: ["Remontées des rectorats auprès du ministère de l'Éducation nationale", "Dispositif auprès du ministère de l'Intérieur"],
        evidence: evidenceOf(incidents, { basculeHit: false, precedentDay: ctx.precedent(RULE_ID, 'national'), nowMs: ctx.now }),
      });
    }
    return out;
  },
  arrived(scenario, signals, ctx = {}) {
    const now = ctx.now ?? Date.now();
    const from = Date.parse(scenario?.window?.from ?? ''), to = Date.parse(scenario?.window?.to ?? '');
    const opened = Date.parse(scenario?.openedAt ?? '');
    const dept = scenario?.zone?.dept?.[0];
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    // Un incident déjà cité à l'ouverture ne compte pas : il faut un fait nouveau, publié après l'ouverture.
    const cited = new Set((scenario.chain ?? []).flatMap((c) => (Array.isArray(c.signalIds) ? c.signalIds : [])));
    const since = Number.isFinite(opened) ? Math.max(opened, from) : from;
    // Scénario national : le fait attendu est un incident dans un département sans incident cité à l'ouverture.
    const citedDepts = new Set(cleanSignals(signals).filter((s) => cited.has(s.id)).map(firstDept));
    const hit = cleanSignals(signals).some((s) => {
      if (!isIncident(s) || cited.has(s.id)) return false;
      if (dept ? !inDept(s, dept) : citedDepts.has(firstDept(s))) return false;
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
