// api/_lib/paris-time.js : heure de Paris pour les sources qui publient en heure locale sans fuseau
// (Traficolor, CNIR, API SNCF) et pour les cadences et quotas calés sur la journée parisienne
// (collecte TomTom, compteurs du jour). Sans dépendance : Intl suffit (heure d'été comprise).

const PARTS = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

/** Date et heure murales à Paris d'un instant (ms). */
export function parisParts(instant) {
  const out = {};
  for (const p of PARTS.formatToParts(new Date(instant))) if (p.type !== 'literal') out[p.type] = Number(p.value);
  return { year: out.year, month: out.month, day: out.day, hour: out.hour, minute: out.minute, second: out.second };
}

/** « 2026-10-03 » : jour calendaire à Paris. */
export function parisDay(instant) {
  const p = parisParts(instant);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Heure (0 à 23) à Paris. */
export function parisHour(instant) {
  return parisParts(instant).hour;
}

/** Instant (ms) d'une heure murale de Paris ; NaN si les nombres sont illisibles. */
export function parisWallTime(year, month, day, hour = 0, minute = 0, second = 0) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  if (!Number.isFinite(guess)) return Number.NaN;
  let instant = guess;
  for (let i = 0; i < 2; i += 1) {
    const p = parisParts(instant);
    const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    instant += guess - wall;
  }
  return instant;
}

/**
 * Date de source en heure de Paris sans fuseau → ISO UTC. Formes lues : « 2026-10-03T15:44:40 »,
 * « 2026-10-03T15:44:40.123 », « 20261003T151029 ». Une date qui porte déjà son fuseau est rendue telle
 * quelle en ISO UTC. Null si illisible.
 * @param {string | null | undefined} text
 * @returns {string | null}
 */
export function parisLocalToIso(text) {
  const s = String(text ?? '').trim();
  if (!s) return null;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const t = Date.parse(s);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  const m = /^(\d{4})-?(\d{2})-?(\d{2})T(\d{2}):?(\d{2}):?(\d{2})(?:\.\d+)?$/.exec(s);
  if (!m) return null;
  const t = parisWallTime(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}
