// api/_lib/anticipation/rules/paris-time.js : demi-journées à l'heure de Paris (matin 06 h à 14 h, après-midi 14 h à 22 h, soir 22 h à 06 h le lendemain).
// Passage à l'heure d'été ou d'hiver géré par Intl (Europe/Paris), aucun décalage fixe.

const partsFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

/** Décalage de Paris par rapport à UTC, en ms, à l'instant donné. */
function parisOffset(/** @type {number} */ ms) {
  /** @type {Record<string, number>} */
  const p = {};
  for (const x of partsFmt.formatToParts(new Date(ms))) if (x.type !== 'literal') p[x.type] = Number(x.value);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000;
}

/** Instant UTC (ms) de l'heure murale `hour` h du jour de Paris `y-m-d` ; `d` peut déborder (jour suivant). */
export function parisInstant(/** @type {number} */ y, /** @type {number} */ m, /** @type {number} */ d, /** @type {number} */ hour) {
  const guess = Date.UTC(y, m - 1, d, hour);
  let t = guess - parisOffset(guess);
  t = guess - parisOffset(t);
  return t;
}

/** Jour de Paris (y, m, d) d'un instant. */
function parisYmd(/** @type {number} */ ms) {
  /** @type {Record<string, number>} */
  const p = {};
  for (const x of partsFmt.formatToParts(new Date(ms))) if (x.type !== 'literal') p[x.type] = Number(x.value);
  return { y: p.year, m: p.month, d: p.day };
}

const SLOTS = Object.freeze([
  { id: 'matin', start: 6, end: 14, label: 'matin' },
  { id: 'apres_midi', start: 14, end: 22, label: 'après-midi' },
  { id: 'soir', start: 22, end: 30, label: 'soir' },
]);

/**
 * Demi-journées de Paris qui recoupent l'intervalle [from, to] (ms), du jour de la veille au jour de la fin.
 * @param {number} from
 * @param {number} to
 * @returns {Array<{ id: string, label: string, from: number, to: number }>}
 */
export function halfDaysOverlapping(from, to) {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];
  const first = parisYmd(from);
  const last = parisYmd(to);
  const endKey = Date.UTC(last.y, last.m - 1, last.d);
  /** @type {Array<{ id: string, label: string, from: number, to: number }>} */
  const out = [];
  for (let day = Date.UTC(first.y, first.m - 1, first.d - 1); day <= endKey; day += 86_400_000) {
    const dt = new Date(day);
    const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate();
    for (const s of SLOTS) {
      const a = parisInstant(y, m, d, s.start);
      const b = parisInstant(y, m, d, s.end);
      if (a < to + 1 && b > from) out.push({ id: s.id, label: s.label, from: a, to: b });
    }
  }
  return out;
}
