/**
 * paris-time.ts : conversion d'une heure locale de Paris en instant UTC.
 */

const PARIS_TZ = 'Europe/Paris';

function parisOffsetMs(ms: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PARIS_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms));
  const n = (t: string): number => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - Math.floor(ms / 1000) * 1000;
}

/**
 * Convertit « YYYY-MM-DD HH:MM[:SS] » (heure murale de Paris) en ISO UTC.
 * Juste aux changements d'heure (été UTC+2, hiver UTC+1). Renvoie null si absent ou illisible.
 */
export function parisLocalToIso(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? '0'].map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  if (Number.isNaN(wall)) return null;
  const first = wall - parisOffsetMs(wall);
  const utc = wall - parisOffsetMs(first);
  const date = new Date(utc);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
