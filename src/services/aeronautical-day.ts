// src/services/aeronautical-day.ts : lever, coucher et jour aéronautique d'un département (spec 2026-10-04 environnement E4 ;
// amendement 10 du contrôleur). Calcul local, sans appel réseau : formule NOAA (position du Soleil en siècles juliens, précision
// d'environ 1 min en France), zénith 90,833° pour le lever et le coucher. Règle française en métropole : la nuit aéronautique
// commence 30 min après le coucher du Soleil et finit 30 min avant son lever. Heures affichées à Paris, changements d'heure compris.
import { departementCentroid } from '../config/departements.ts';

export interface AeronauticalDay {
  /** Jour de Paris (AAAA-MM-JJ) du calcul. */
  day: string;
  /** ms UTC ; null si le Soleil ne se lève ni ne se couche ce jour-là (jamais en France). */
  sunrise: number | null;
  sunset: number | null;
  /** Début du jour aéronautique : lever moins 30 min. */
  aeroStart: number | null;
  /** Fin du jour aéronautique : coucher plus 30 min. */
  aeroEnd: number | null;
}

/** Marge de la règle française entre le lever (ou le coucher) et le jour aéronautique. */
export const AERONAUTICAL_MARGIN_MS = 30 * 60_000;
const HOUR_MS = 3_600_000;
const ZENITH_RISE_SET = 90.833;
const PARIS = 'Europe/Paris';
const PARIS_DAY = new Intl.DateTimeFormat('sv-SE', { timeZone: PARIS, year: 'numeric', month: '2-digit', day: '2-digit' });

const rad = (d: number): number => (d * Math.PI) / 180;
const deg = (r: number): number => (r * 180) / Math.PI;

/** Déclinaison (degrés) et équation du temps (minutes) à l'instant `ms` (formules NOAA). */
function solar(ms: number): { decl: number; eqTime: number } {
  const t = (ms / 86_400_000 + 2440587.5 - 2451545) / 36525;
  const l0 = ((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360 + 360) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c = Math.sin(rad(m)) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(rad(2 * m)) * (0.019993 - 0.000101 * t) + Math.sin(rad(3 * m)) * 0.000289;
  const omega = 125.04 - 1934.136 * t;
  const lambda = l0 + c - 0.00569 - 0.00478 * Math.sin(rad(omega));
  const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(rad(omega));
  const decl = deg(Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda))));
  const y = Math.tan(rad(eps / 2)) ** 2;
  const eqTime = 4 * deg(y * Math.sin(2 * rad(l0)) - 2 * e * Math.sin(rad(m)) + 4 * e * y * Math.sin(rad(m)) * Math.cos(2 * rad(l0))
    - 0.5 * y * y * Math.sin(4 * rad(l0)) - 1.25 * e * e * Math.sin(2 * rad(m)));
  return { decl, eqTime };
}

/** Lever (signe -1) ou coucher (+1) à minuit UTC `midnight` près ; deux passes pour recalculer le Soleil à l'heure de l'événement. */
function event(midnight: number, lat: number, lon: number, sign: -1 | 1): number | null {
  let at = midnight + 12 * HOUR_MS;
  for (let pass = 0; pass < 2; pass += 1) {
    const { decl, eqTime } = solar(at);
    const cosHa = Math.cos(rad(ZENITH_RISE_SET)) / (Math.cos(rad(lat)) * Math.cos(rad(decl))) - Math.tan(rad(lat)) * Math.tan(rad(decl));
    if (cosHa < -1 || cosHa > 1) return null;
    const minutes = 720 - 4 * lon - eqTime + sign * 4 * deg(Math.acos(cosHa));
    at = midnight + minutes * 60_000;
  }
  return Math.round(at / 60_000) * 60_000;
}

/** Lever, coucher et jour aéronautique au point (lat, lon) pour le jour de Paris de `date`. */
export function aeronauticalDay(lat: number, lon: number, date: Date | number): AeronauticalDay {
  const day = PARIS_DAY.format(new Date(typeof date === 'number' ? date : date.getTime()));
  const [y, m, d] = day.split('-').map(Number);
  const midnight = Date.UTC(y, m - 1, d);
  const sunrise = event(midnight, lat, lon, -1);
  const sunset = event(midnight, lat, lon, 1);
  return {
    day, sunrise, sunset,
    aeroStart: sunrise === null ? null : sunrise - AERONAUTICAL_MARGIN_MS,
    aeroEnd: sunset === null ? null : sunset + AERONAUTICAL_MARGIN_MS,
  };
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString('fr-FR', { timeZone: PARIS, hour: '2-digit', minute: '2-digit' });
}

/**
 * Ligne du panneau, heures de Paris : « lever 07:54 · coucher 19:24 · fin du jour aéronautique 19:54 » ; `lastHour` vrai à moins
 * d'une heure de la fin du jour aéronautique (la ligne ajoute « moins d'une heure de jour ») ; `night` vrai après la fin du jour
 * aéronautique ou avant son début (la ligne ajoute « nuit aéronautique »).
 */
export function aeronauticalLine(day: AeronauticalDay, now: number): { text: string; lastHour: boolean; night: boolean } {
  if (day.sunrise === null || day.sunset === null || day.aeroStart === null || day.aeroEnd === null) {
    return { text: 'lever et coucher du Soleil non calculables ce jour', lastHour: false, night: false };
  }
  const night = now >= day.aeroEnd || now < day.aeroStart;
  const lastHour = !night && day.aeroEnd - now <= HOUR_MS;
  const base = `lever ${clock(day.sunrise)} · coucher ${clock(day.sunset)} · fin du jour aéronautique ${clock(day.aeroEnd)}`;
  return { text: `${base}${night ? ' · nuit aéronautique' : lastHour ? ' · moins d\'une heure de jour' : ''}`, lastHour, night };
}

/** Raccourci au centroïde du département ; null pour un code inconnu. */
export function departementAeronauticalDay(code: string, now: number): AeronauticalDay | null {
  const c = departementCentroid(code);
  return c === null ? null : aeronauticalDay(c[1], c[0], now);
}
