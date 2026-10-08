import { describe, expect, it } from 'vitest';
import { DEPARTEMENT_CENTROIDS, departementCentroid } from '../config/departements.ts';
import { AERONAUTICAL_MARGIN_MS, aeronauticalDay, aeronauticalLine, departementAeronauticalDay } from './aeronautical-day.ts';

const T = (iso: string): number => Date.parse(iso);
const NOW = T('2026-10-04T10:10:00+02:00');

/** Écart en minutes entre l'heure de Paris d'un instant et « hh:mm » le même jour de Paris. */
function minutesFrom(ms: number | null, hhmm: string): number {
  if (ms === null) return Number.POSITIVE_INFINITY;
  const [h, m] = new Date(ms).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).split(':').map(Number);
  const [eh, em] = hhmm.split(':').map(Number);
  return Math.abs(h * 60 + m - (eh * 60 + em));
}

describe('lever et coucher (formule NOAA), 4 octobre 2026, heures de Paris (fiche de faits § 6, à 2 min près)', () => {
  it.each([
    ['Paris', 48.8566, 2.3522, '07:54', '19:24'],
    ['Strasbourg', 48.5734, 7.7521, '07:32', '19:03'],
    ['Brest', 48.3904, -4.4861, '08:21', '19:52'],
    ['Marseille', 43.2965, 5.3698, '07:39', '19:15'],
    ['Bastia', 42.6977, 9.4508, '07:22', '18:59'],
  ] as const)('%s', (_name, lat, lon, rise, set) => {
    const d = aeronauticalDay(lat, lon, NOW);
    expect(d.day).toBe('2026-10-04');
    expect(minutesFrom(d.sunrise, rise)).toBeLessThanOrEqual(2);
    expect(minutesFrom(d.sunset, set)).toBeLessThanOrEqual(2);
    // Règle française : jour aéronautique de 30 min avant le lever à 30 min après le coucher (amendement 10).
    expect(d.aeroEnd).toBe((d.sunset ?? 0) + AERONAUTICAL_MARGIN_MS);
    expect(d.aeroStart).toBe((d.sunrise ?? 0) - AERONAUTICAL_MARGIN_MS);
  });
});

describe('changements d\'heure (25/10/2026 et 28/03/2027) : heure de Paris juste, jour de Paris retenu', () => {
  it('automne : le coucher recule d\'environ une heure à l\'affichage, pas en temps universel', () => {
    const before = aeronauticalDay(48.8566, 2.3522, T('2026-10-24T12:00:00+02:00'));
    const after = aeronauticalDay(48.8566, 2.3522, T('2026-10-25T12:00:00+01:00'));
    expect([before.day, after.day]).toEqual(['2026-10-24', '2026-10-25']);
    expect(minutesFrom(before.sunset, '18:44')).toBeLessThanOrEqual(2);
    expect(minutesFrom(after.sunset, '17:42')).toBeLessThanOrEqual(2);
    expect(((after.sunset ?? 0) - (before.sunset ?? 0)) / 60_000 - 24 * 60).toBeGreaterThan(-4); // 2 min de jour en moins par jour
    expect(aeronauticalLine(after, T('2026-10-25T12:00:00+01:00')).text).toBe('lever 07:26 · coucher 17:42 · fin du jour aéronautique 18:12');
  });
  it('printemps : lever et coucher avancés d\'une heure à l\'affichage le 28/03/2027', () => {
    const before = aeronauticalDay(48.8566, 2.3522, T('2027-03-27T12:00:00+01:00'));
    const after = aeronauticalDay(48.8566, 2.3522, T('2027-03-28T12:00:00+02:00'));
    expect(minutesFrom(before.sunrise, '06:39')).toBeLessThanOrEqual(2);
    expect(minutesFrom(after.sunrise, '07:37')).toBeLessThanOrEqual(2);
    expect(minutesFrom(after.sunset, '20:15')).toBeLessThanOrEqual(2);
  });
  it('minuit à Paris : un instant à 23 h 30 UTC le 04/10 est déjà le 05/10 à Paris', () => {
    expect(aeronauticalDay(48.8566, 2.3522, T('2026-10-04T23:30:00Z')).day).toBe('2026-10-05');
  });
});

describe('ligne du panneau', () => {
  const paris = aeronauticalDay(48.8566, 2.3522, NOW);
  it('jour : lever, coucher, fin du jour aéronautique (coucher + 30 min)', () => {
    expect(aeronauticalLine(paris, NOW)).toEqual({ text: 'lever 07:54 · coucher 19:23 · fin du jour aéronautique 19:53', lastHour: false, night: false });
  });
  it('moins d\'une heure avant la fin du jour aéronautique : dit', () => {
    const at = (paris.aeroEnd ?? 0) - 59 * 60_000;
    // Apostrophe typographique (’), comme le reste des textes du lot (vague finale, point 11).
    expect(aeronauticalLine(paris, at)).toEqual({ text: 'lever 07:54 · coucher 19:23 · fin du jour aéronautique 19:53 · moins d’une heure de jour', lastHour: true, night: false });
    expect(aeronauticalLine(paris, at).text).not.toContain("'");
  });
  it('après la fin, ou avant le début : nuit aéronautique', () => {
    expect(aeronauticalLine(paris, (paris.aeroEnd ?? 0) + 1).night).toBe(true);
    expect(aeronauticalLine(paris, (paris.aeroStart ?? 0) - 1).text).toBe('lever 07:54 · coucher 19:23 · fin du jour aéronautique 19:53 · nuit aéronautique');
  });
  it('aucun tiret cadratin ni « temps réel »', () => {
    expect(aeronauticalLine(paris, NOW).text).not.toMatch(/—|temps réel/i);
  });
});

describe('centroïdes des départements', () => {
  it('96 départements de métropole (2A, 2B) et 5 DROM, [lng, lat]', () => {
    expect(Object.keys(DEPARTEMENT_CENTROIDS)).toHaveLength(101);
    expect(departementCentroid('66')).toEqual([2.53, 42.6]);
    expect(departementCentroid('2A')).toEqual([8.92, 41.86]);
    expect(departementCentroid('2B')).toEqual([9.29, 42.4]);
    expect(departementCentroid('20')).toBeNull();
  });
  it('jour aéronautique au centroïde (Pyrénées-Orientales, Haute-Corse) ; code inconnu : null', () => {
    const po = departementAeronauticalDay('66', NOW);
    expect(po?.day).toBe('2026-10-04');
    expect(po === null ? '' : aeronauticalLine(po, NOW).text).toBe('lever 07:50 · coucher 19:26 · fin du jour aéronautique 19:56');
    expect(departementAeronauticalDay('2B', NOW)?.sunrise).not.toBeNull();
    expect(departementAeronauticalDay('XX', NOW)).toBeNull();
  });
});
