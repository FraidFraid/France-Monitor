// api/_lib/anticipation/agenda.js : agenda de 7 jours à l'heure de Paris (04/11/2026, spec § 8).
// Aujourd'hui puis J+1 à J+6. Un scénario figure dans chaque jour de Paris que sa fenêtre recoupe ; aujourd'hui est coupé en trois
// demi-journées (matin jusqu'à 14 h, après-midi 14 h à 22 h, soir dès 22 h). Les échéances publiées par les sources sont listées par jour.
import { parisDay } from '../../_shared/paris-day.js';
import { parisDayBounds, parisInstant } from './rules/paris-time.js';

/** @typedef {import('./registry.js').Scenario} Scenario */
/**
 * @typedef {object} AgendaDay
 * @property {string} day Jour de Paris AAAA-MM-JJ.
 * @property {Array<{ half: 'matin'|'apres-midi'|'soir', scenarioIds: string[] }>} [halves] Aujourd'hui seulement.
 * @property {string[]} scenarioIds
 * @property {Array<{ day: string, level: string|null, title: string, detail: string|null, source: string }>} deadlines
 */

const DAYS = 7;
const DAY_MS = 86_400_000;

/** Intervalles [from, to) d'une fenêtre ; un point compte pour 1 ms. */
function bounds(/** @type {Scenario} */ s) {
  const from = Date.parse(s?.window?.from ?? ''), to = Date.parse(s?.window?.to ?? '');
  return Number.isFinite(from) && Number.isFinite(to) && to >= from ? { from, to: Math.max(to, from + 1) } : null;
}
const crosses = (/** @type {{from: number, to: number}} */ w, /** @type {number} */ a, /** @type {number} */ b) => w.from < b && w.to > a;

/**
 * @param {Scenario[]} open Scénarios (seuls les ouverts sont placés), dans l'ordre d'affichage voulu.
 * @param {AgendaDay['deadlines']} upcoming Échéances publiées (api/_shared/upcoming.js).
 * @param {number} now
 * @returns {AgendaDay[]}
 */
export function buildAgenda(open, upcoming, now) {
  const scenarios = (Array.isArray(open) ? open : []).filter((s) => s && s.status === 'ouvert').map((s) => ({ s, w: bounds(s) })).filter((x) => x.w !== null);
  const deadlines = Array.isArray(upcoming) ? upcoming.filter((u) => u && typeof u.day === 'string') : [];
  const today = parisDayBounds(now);
  /** @type {AgendaDay[]} */
  const days = [];
  for (let i = 0; i < DAYS; i++) {
    // Midi de Paris du jour i : le jour reste juste même si un jour de changement d'heure dure 23 ou 25 h.
    const noon = today.from + i * DAY_MS + 12 * 3_600_000;
    const day = parisDay(noon);
    const b = parisDayBounds(noon);
    const here = scenarios.filter((x) => crosses(/** @type {{from: number, to: number}} */ (x.w), b.from, b.to));
    /** @type {AgendaDay} */
    const entry = { day, scenarioIds: here.map((x) => x.s.id), deadlines: deadlines.filter((u) => u.day === day) };
    if (i === 0) {
      const [y, m, d] = day.split('-').map(Number);
      const cuts = [b.from, parisInstant(y, m, d, 14), parisInstant(y, m, d, 22), b.to];
      const names = /** @type {const} */ (['matin', 'apres-midi', 'soir']);
      entry.halves = names.map((half, k) => ({
        half,
        scenarioIds: here.filter((x) => crosses(/** @type {{from: number, to: number}} */ (x.w), cuts[k], cuts[k + 1])).map((x) => x.s.id),
      }));
    }
    days.push(entry);
  }
  return days;
}
